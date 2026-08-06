"""Read paths over the permanent attempt record.

Every answer a student has ever submitted is already durable: `Attempt` keeps
the choice, the written reasoning, the coach's whole response, the timings, and
the evidence class, and its `SessionItem` keeps the question, the position, the
target time, and whether the item was a review repeat. Until this module the
only way back into any of it was one completed session at a time, so a student
could not look at "every Assumption question I have ever missed".

Two properties matter more than the shape of the payload here:

* **Pagination.** A heavy user accumulates thousands of attempts. Nothing in
  this module ever materializes the whole history; the browse endpoint is
  offset/limit with a hard ceiling and a separate `COUNT(*)`.
* **No N+1.** Rendering one row touches `attempt.session_item.question`, and a
  full row also touches the question's choices and passage. Left lazy that is
  three extra round trips per row, which is what `/performance` was fixed for
  once already. Every query below eager-loads exactly the relationships its
  serializer reads.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import joinedload, selectinload

from .extensions import db
from .models import Attempt, Question, SessionItem, StudySession, User


# A page the client asks for, and the ceiling it cannot argue past. 200 rows of
# compact history is ~40 KB; the full-detail variant carries whole passages and
# coach responses, so it gets a much lower ceiling of its own. Both ceilings are
# reported back on every response as `max_limit`, and a request above one is
# clamped rather than rejected — an oversized page is a well-formed ask for more
# than the server will send, which is a different thing from `limit=abc`.
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200
MAX_DETAIL_PAGE_SIZE = 25
MAX_SESSION_PAGE_SIZE = 100
MAX_OFFSET = 1_000_000

TRUE_WORDS = {"1", "true", "yes", "correct"}
FALSE_WORDS = {"0", "false", "no", "incorrect"}


class InvalidHistoryParameter(ValueError):
    """A query parameter that cannot mean anything at all.

    Distinguished on purpose from one that is merely out of range. `limit=500`
    is a coherent request the server declines to honour in full, so it clamps;
    `limit=abc`, `since=not-a-date` and `correct=maybe` are client bugs, and
    answering them with a 200 and a silent default hides the bug in whatever is
    generating the request. These raise, and the routes turn them into a 400
    naming the parameter and what it would have accepted.
    """

    def __init__(self, parameter: str, value, expected: str):
        self.parameter = parameter
        self.value = value
        self.expected = expected
        super().__init__(f"`{parameter}` must be {expected}. Received {value!r}.")


def _iso(value) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _absent(value) -> bool:
    """An omitted parameter and an empty one mean the same thing: no filter."""
    return value is None or (isinstance(value, str) and not value.strip())


def _parse_bool(value, parameter: str, *, extra_true: frozenset[str] = frozenset()) -> bool | None:
    if isinstance(value, bool):
        return value
    if _absent(value):
        return None
    text = str(value).strip().lower()
    if text in TRUE_WORDS or text in extra_true:
        return True
    if text in FALSE_WORDS:
        return False
    raise InvalidHistoryParameter(
        parameter,
        value,
        f"one of {', '.join(sorted(TRUE_WORDS | extra_true | FALSE_WORDS))}",
    )


def _parse_datetime(value, parameter: str) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if _absent(value):
        return None
    text = str(value).strip()
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        raise InvalidHistoryParameter(parameter, value, "an ISO-8601 date or timestamp") from None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _clamp(value, default: int, maximum: int, minimum: int = 1, *, parameter: str = "limit") -> int:
    """An integer within [minimum, maximum], or a 400 if it is not an integer."""
    if _absent(value):
        return default
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        raise InvalidHistoryParameter(
            parameter, value, f"a whole number between {minimum} and {maximum}"
        ) from None
    return max(minimum, min(maximum, number))


def session_history(user: User, *, limit: int = 20, offset: int = 0) -> dict:
    """Past runs, newest first, with the per-run counts already aggregated.

    The counts come from one grouped query over the page's session ids rather
    than from walking `session.items` — a 77-question mega-litigation would
    otherwise load 77 items and 77 attempts just to print "58/77".
    """
    limit = _clamp(limit, 20, MAX_SESSION_PAGE_SIZE, parameter="limit")
    offset = _clamp(offset, 0, MAX_OFFSET, minimum=0, parameter="offset")
    base = StudySession.query.filter(
        StudySession.user_id == user.id,
        StudySession.mode.in_(["practice", "diagnostic"]),
    )
    total = base.with_entities(func.count(StudySession.id)).scalar() or 0
    rows = (
        base.order_by(
            func.coalesce(StudySession.completed_at, StudySession.started_at).desc(),
            StudySession.started_at.desc(),
        )
        .limit(limit)
        .offset(offset)
        .all()
    )
    session_ids = [row.id for row in rows]
    stats: dict[str, dict] = {}
    if session_ids:
        aggregate = db.session.execute(
            select(
                SessionItem.session_id,
                func.count(Attempt.id),
                func.sum(func.cast(Attempt.is_correct, db.Integer)),
                func.sum(Attempt.server_elapsed_ms),
                func.sum(func.cast(SessionItem.from_review_queue, db.Integer)),
            )
            .select_from(Attempt)
            .join(SessionItem, Attempt.session_item_id == SessionItem.id)
            .where(SessionItem.session_id.in_(session_ids))
            .group_by(SessionItem.session_id)
        ).all()
        for session_id, answered, correct, elapsed_ms, repeats in aggregate:
            stats[session_id] = {
                "answered": int(answered or 0),
                "correct": int(correct or 0),
                "elapsed_ms": int(elapsed_ms or 0),
                "review_repeats": int(repeats or 0),
            }

    items = []
    for row in rows:
        stat = stats.get(row.id, {"answered": 0, "correct": 0, "elapsed_ms": 0, "review_repeats": 0})
        answered = stat["answered"]
        items.append(
            {
                "id": row.id,
                "mode": row.mode,
                "practice_style": row.practice_style,
                "status": row.status,
                "started_at": _iso(row.started_at),
                "completed_at": _iso(row.completed_at),
                "total_items": row.total_items,
                "answered": answered,
                "correct": stat["correct"],
                "accuracy": round(stat["correct"] / answered * 100) if answered else None,
                "elapsed_minutes": round(stat["elapsed_ms"] / 60_000, 1),
                "review_repeats": stat["review_repeats"],
                # Only a completed run has a review page to open; an abandoned
                # or in-progress one still lists, because its answered items are
                # real history and reachable through the attempt browser.
                "reviewable": row.status == "completed",
            }
        )
    return {
        "sessions": items,
        "total": total,
        "limit": limit,
        "max_limit": MAX_SESSION_PAGE_SIZE,
        "offset": offset,
        "has_more": offset + len(items) < total,
    }


def _compact_attempt(attempt: Attempt) -> dict:
    item = attempt.session_item
    question = item.question
    target_ms = item.target_time_seconds * 1000
    return {
        "attempt_id": attempt.id,
        "session_id": item.session_id,
        "position": item.position,
        "question_id": question.id,
        "question_type": question.question_type,
        "section": question.section,
        "is_correct": attempt.is_correct,
        "selected_label": attempt.selected_label,
        "correct_label": question.correct_answer,
        "confidence": attempt.confidence,
        "answer_changed": attempt.answer_changed,
        "evidence_class": attempt.evidence_class,
        "from_review_queue": item.from_review_queue,
        "elapsed_ms": attempt.server_elapsed_ms,
        "target_time_seconds": item.target_time_seconds,
        # Precomputed so a 200-row grid does not do 200 divisions in the client
        # and so "over time" means the same thing everywhere it is shown.
        "over_target": attempt.server_elapsed_ms > target_ms,
        "pace_ratio": round(attempt.server_elapsed_ms / target_ms, 2) if target_ms else None,
        "explanation_score": attempt.explanation_score,
        "coaching_status": attempt.coaching_status,
        "has_reasoning": bool(attempt.reasoning_text),
        "created_at": _iso(attempt.created_at),
    }


def _full_attempt(attempt: Attempt) -> dict:
    """Everything needed to re-read the question and the coaching, offline."""
    item = attempt.session_item
    question = item.question
    payload = _compact_attempt(attempt)
    payload.update(
        {
            "question": {
                "id": question.id,
                "section": question.section,
                "question_type": question.question_type,
                "difficulty": question.difficulty,
                "passage": (
                    {
                        "id": question.passage.id,
                        "text": question.passage.canonical_text,
                        "type": question.passage.passage_type,
                    }
                    if question.passage
                    else None
                ),
                "stimulus": question.stimulus,
                "stem": question.stem,
                "choices": [
                    {"label": choice.label, "text": choice.canonical_text}
                    for choice in question.choices
                ],
            },
            "reasoning_text": attempt.reasoning_text,
            "feedback": attempt.feedback_json,
            "strategy_key": attempt.strategy_key,
            "strategy_applied": attempt.strategy_applied,
            "session": {
                "id": item.session_id,
                "mode": item.session.mode,
                "status": item.session.status,
                "completed_at": _iso(item.session.completed_at),
            },
        }
    )
    return payload


def attempt_history(
    user: User,
    *,
    limit: int = DEFAULT_PAGE_SIZE,
    offset: int = 0,
    correct=None,
    question_type: str | None = None,
    section: str | None = None,
    session_id: str | None = None,
    from_review_queue=None,
    evidence_class: str | None = None,
    since=None,
    until=None,
    detail: bool = False,
) -> dict:
    """One page of previously answered questions, newest first.

    `detail=True` swaps the compact row for the whole question, the student's
    written reasoning, and the coach's stored response — enough to re-read the
    item without a second request per row — and drops the page ceiling to match
    the much heavier payload.

    Every parameter is either understood or refused: see `InvalidHistoryParameter`.
    """
    detail = bool(_parse_bool(detail, "detail", extra_true=frozenset({"full"})))
    ceiling = MAX_DETAIL_PAGE_SIZE if detail else MAX_PAGE_SIZE
    limit = _clamp(limit, min(DEFAULT_PAGE_SIZE, ceiling), ceiling, parameter="limit")
    offset = _clamp(offset, 0, MAX_OFFSET, minimum=0, parameter="offset")

    query = Attempt.query.join(SessionItem, Attempt.session_item_id == SessionItem.id).join(
        Question, SessionItem.question_id == Question.id
    ).filter(Attempt.user_id == user.id)

    correct_filter = _parse_bool(correct, "correct")
    if correct_filter is not None:
        query = query.filter(Attempt.is_correct.is_(correct_filter))
    review_filter = _parse_bool(from_review_queue, "from_review_queue")
    if review_filter is not None:
        query = query.filter(SessionItem.from_review_queue.is_(review_filter))
    if question_type:
        query = query.filter(Question.question_type == question_type)
    if section:
        query = query.filter(Question.section == section)
    if session_id:
        query = query.filter(SessionItem.session_id == session_id)
    if evidence_class:
        query = query.filter(Attempt.evidence_class == evidence_class)
    since_at = _parse_datetime(since, "since")
    until_at = _parse_datetime(until, "until")
    if since_at:
        query = query.filter(Attempt.created_at >= since_at)
    if until_at:
        query = query.filter(Attempt.created_at <= until_at)

    total = query.with_entities(func.count(Attempt.id)).scalar() or 0

    # The joins above only exist to filter. Loading is declared separately so
    # each serialized field arrives with the page instead of one row at a time.
    loaders = [joinedload(Attempt.session_item).joinedload(SessionItem.question)]
    if detail:
        loaders = [
            joinedload(Attempt.session_item)
            .joinedload(SessionItem.question)
            .options(
                selectinload(Question.choices),
                joinedload(Question.passage),
            ),
            joinedload(Attempt.session_item).joinedload(SessionItem.session),
        ]
    rows = (
        query.options(*loaders)
        .order_by(Attempt.created_at.desc(), Attempt.id.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    serialize = _full_attempt if detail else _compact_attempt
    return {
        "attempts": [serialize(row) for row in rows],
        "total": total,
        "limit": limit,
        "max_limit": ceiling,
        "offset": offset,
        "has_more": offset + len(rows) < total,
        "filters": {
            "correct": correct_filter,
            "question_type": question_type or None,
            "section": section or None,
            "session_id": session_id or None,
            "from_review_queue": review_filter,
            "evidence_class": evidence_class or None,
            "since": _iso(since_at),
            "until": _iso(until_at),
        },
    }


def attempt_detail(user: User, attempt_id: str) -> dict | None:
    """One attempt, fully hydrated, for drill-down out of the history grid."""
    attempt = (
        Attempt.query.options(
            joinedload(Attempt.session_item)
            .joinedload(SessionItem.question)
            .options(selectinload(Question.choices), joinedload(Question.passage)),
            joinedload(Attempt.session_item).joinedload(SessionItem.session),
        )
        .filter(Attempt.id == attempt_id, Attempt.user_id == user.id)
        .first()
    )
    if not attempt:
        return None
    return _full_attempt(attempt)


def history_facets(user: User) -> dict:
    """The filter values this account actually has data for.

    Offering "Parallel Reasoning" as a filter to a student who has never seen
    one is a dead end, so the counts are derived rather than taken from the
    static question-type catalog.
    """
    rows = db.session.execute(
        select(
            Question.question_type,
            Question.section,
            func.count(Attempt.id),
            func.sum(func.cast(Attempt.is_correct, db.Integer)),
        )
        .select_from(Attempt)
        .join(SessionItem, Attempt.session_item_id == SessionItem.id)
        .join(Question, SessionItem.question_id == Question.id)
        .where(Attempt.user_id == user.id)
        .group_by(Question.question_type, Question.section)
        .order_by(func.count(Attempt.id).desc())
    ).all()
    types = [
        {
            "question_type": question_type,
            "section": section,
            "attempts": int(attempts or 0),
            "correct": int(correct or 0),
        }
        for question_type, section, attempts, correct in rows
    ]
    totals = db.session.execute(
        select(
            func.count(Attempt.id),
            func.sum(func.cast(Attempt.is_correct, db.Integer)),
            func.min(Attempt.created_at),
            func.max(Attempt.created_at),
        ).where(Attempt.user_id == user.id)
    ).first()
    attempts_total = int((totals[0] if totals else 0) or 0)
    correct_total = int((totals[1] if totals else 0) or 0)
    return {
        "question_types": types,
        "sections": sorted({row["section"] for row in types}),
        "attempts": attempts_total,
        "correct": correct_total,
        "incorrect": attempts_total - correct_total,
        "first_attempt_at": _iso(totals[2] if totals else None),
        "last_attempt_at": _iso(totals[3] if totals else None),
    }
