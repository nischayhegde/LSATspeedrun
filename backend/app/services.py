from __future__ import annotations

import random
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from flask import current_app
from sqlalchemy import or_
from sqlalchemy.orm import joinedload

from .coaching import CoachingProviderError, generate_attempt_coaching
from .extensions import db
from .focus import diagnostic_focus, diagnostic_focus_detail
from .game import (
    CLIENT_BY_KEY,
    explanation_band,
    grant_mega_litigation_promotion,
    lock_user_profile,
    mega_litigation_promotion_state,
    serialize_settlement,
    settle_attempt,
    snapshot_case_context,
)
from . import enforcement, scheduling
from .models import AiJob, Attempt, Question, ReviewQueueItem, SessionItem, SkillProgress, StudySession, User, utcnow
from .scoring import (
    FORM_ITEMS,
    FORM_RC_ITEMS,
    project_score,
    projection_snapshot,
    record_projection,
)
from .seed import SOURCE_PREFIX
from .trial import trial_plan
from .enforcement import (
    ENFORCEMENT_VERSION,
    GateRejection,
    LEVEL_LIGHT,
    LEVEL_NONE,
    STATUS_ATTESTED,
    STATUS_SATISFIED,
    STATUS_SKIPPED,
    STATUS_UNENFORCED,
    assign_enforcement_level,
    build_gate,
    validate_artifact,
)
from .strategies import assign_strategy_trial, serialize_strategy, strategy_performance


PRACTICE_STYLES = {"cases"}
FEEDBACK_POLICIES = {"immediate", "delayed"}
EVIDENCE_CLASS = {
    "cases": "coached_practice",
    "diagnostic": "diagnostic",
}
# Retained for the seed scripts and for reading historical `interval_index`
# values; scheduling itself is now `app/scheduling.py` (FSRS-6).
REVIEW_INTERVAL_DAYS = (1, 3, 7, 21)
# A card whose next FSRS interval already exceeds this is not going to be
# forgotten before the student's test date, so it stops taking a review slot.
# Not deleted: one lapse pulls it straight back into rotation.
MASTERED_STABILITY_DAYS = 21
REASONING_MIN_CHARS = 120
ASSISTANCE_LEVELS = {"full", "focus"}
MIN_TARGET_SCORE = 120
MAX_TARGET_SCORE = 180
# A declared target at or above this, or a test date inside this many weeks,
# defaults a new user straight into Focus Mode — no office, map, or economy
# chrome. Only ever applied once, at onboarding; the student's own toggle
# always wins after that. [00-implementation-plan.md P0-4]
FOCUS_MODE_TARGET_SCORE = 168
FOCUS_MODE_WEEKS_OUT = 8


def default_assistance_level(target_score: int | None, target_test_date: date | None) -> str:
    if target_score is not None and target_score >= FOCUS_MODE_TARGET_SCORE:
        return "focus"
    if target_test_date is not None:
        weeks_out = (target_test_date - date.today()).days / 7
        if weeks_out < FOCUS_MODE_WEEKS_OUT:
            return "focus"
    return "full"
# Clearing this share of the whole form — not of the questions reached — promotes
# the firm one tier. See `finalize_diagnostic`.
MEGA_LITIGATION_PROMOTION_ACCURACY = 0.70
# Share of a practice run's fresh questions drawn from measured weaknesses. The
# rest stay random so practice keeps covering the whole test.
FOCUS_FILL_RATIO = 0.6


def reasoning_min_chars(session: StudySession) -> int:
    """Characters of written explanation a session demands before an answer counts."""
    if session.mode == "diagnostic":
        return 0
    return REASONING_MIN_CHARS


def _iso_utc(value) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _aware_utc(value):
    """Normalize database timestamps before Python-side comparisons.

    SQLite drops timezone information even for timezone-aware columns, while
    PostgreSQL preserves it. Treat a naive value as UTC so review scheduling
    behaves identically in tests, local development, and production.
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def list_resumable_sessions(user: User) -> list[StudySession]:
    """All practice runs still occupying a queue slot, most recent first.

    A run occupies a slot while it is in progress or paused, or while it is
    sitting on an unresolved debrief (`pending_attempt_id` set) even after its
    status has flipped to "completed" — the student still owes that run an
    explicit acknowledgement. This list backs both the queue-cap check in
    `create_study_session` and the `/study-sessions/active` endpoint.
    """
    return (
        StudySession.query.filter(
            StudySession.user_id == user.id,
            StudySession.mode == "practice",
            or_(
                StudySession.status.in_(["in_progress", "paused"]),
                StudySession.pending_attempt_id.isnot(None),
            ),
        )
        .order_by(StudySession.started_at.desc())
        .all()
    )


def find_resumable_session(user: User) -> StudySession | None:
    """The one queued practice run a single-run surface should treat as current.

    Kept for call sites that only ever cared about one representative active
    run (the `next_route` shortcut, the daily docket's "resume" action, the
    Office/Training pages' one-tap continue, and the office's walk-in client
    visualization).

    `_pause_other_active_practice_sessions` guarantees at most one queued run
    is ever `in_progress` at a time, and that is always the run the student is
    actively working — created just now, or explicitly resumed from the run
    queue. Falling back to "most recently *started*" here (as a plain
    `started_at desc` sort would) picks the wrong run whenever an older,
    already-in-progress run is resumed after a newer run was created: the
    newer-but-now-paused run would keep winning, so the Office's walk-in
    client would silently stay stuck on it instead of following whichever
    case the student actually switched to.
    """
    sessions = list_resumable_sessions(user)
    for session in sessions:
        if session.status == "in_progress":
            return session
    return sessions[0] if sessions else None


def diagnostic_remaining_ms(session: StudySession) -> int | None:
    """Milliseconds left on a mega-litigation's whole-form clock.

    None for anything without a deadline: coached practice, and diagnostics
    started before the whole-form clock existed.
    """
    if session.mode != "diagnostic" or not session.deadline_at:
        return None
    return max(0, int((_aware_utc(session.deadline_at) - utcnow()).total_seconds() * 1000))


def enforce_diagnostic_deadline(session: StudySession) -> bool:
    """Close out a mega-litigation whose clock has run out.

    Called at the top of every path that can touch a diagnostic, which is what
    makes the deadline real without a background sweeper: a run that expires
    while the student is away is finalized by whichever request next looks at
    it, and until then nothing can be written to it.

    Returns True when this call finalized the run.
    """
    if session.mode != "diagnostic" or not session.deadline_at:
        return False
    if session.status not in {"in_progress", "paused"}:
        return False
    if _aware_utc(session.deadline_at) > utcnow():
        return False
    finalize_diagnostic(session, completed_at=_aware_utc(session.deadline_at))
    return True


def find_active_diagnostic(user: User) -> StudySession | None:
    session = (
        StudySession.query.filter(
            StudySession.user_id == user.id,
            StudySession.mode == "diagnostic",
            or_(
                StudySession.status.in_(["in_progress", "paused"]),
                StudySession.pending_attempt_id.isnot(None),
            ),
        )
        .order_by(StudySession.started_at.desc())
        .first()
    )
    if session and enforce_diagnostic_deadline(session):
        # The clock decided this run is over. It is no longer the active one, and
        # the student is free to start another.
        return None
    return session


def serialize_user(user: User) -> dict:
    active = find_resumable_session(user)
    diagnostic = find_active_diagnostic(user)
    diagnostic_complete = bool(
        StudySession.query.filter_by(user_id=user.id, mode="diagnostic", status="completed").first()
    )
    if not user.game_profile:
        next_route = "/onboarding"
    elif active:
        next_route = f"/cases/{active.id}"
    elif diagnostic:
        next_route = f"/cases/{diagnostic.id}"
    else:
        next_route = "/progress"
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "next_route": next_route,
        "game_ready": bool(user.game_profile),
        "diagnostic_complete": diagnostic_complete,
        "target_score": user.target_score,
        "target_test_date": user.target_test_date.isoformat() if user.target_test_date else None,
        "assistance_level": user.assistance_level,
        # Authoritative "has this account been oriented?" so a cleared browser
        # store, a second device, or a private window cannot re-block the app.
        "guided_tour_completed": user.guided_tour_completed_at is not None,
    }


def update_user_preferences(user: User, payload: dict) -> User:
    """Handle the onboarding intent question and the always-visible Focus Mode toggle.

    Declaring a target score/test date only ever *sets* `assistance_level` as a
    side effect while onboarding is still in progress (no game profile yet) —
    the cold-start lever from P0-4. Once onboarding is done, this function only
    ever changes `assistance_level` when the caller asks for it explicitly, so
    a returning user's own toggle is never silently overridden by an old
    declared target score.
    """
    onboarding_stage = user.game_profile is None
    touched_intent = False
    if "target_score" in payload:
        raw = payload["target_score"]
        if raw is None:
            user.target_score = None
        else:
            try:
                score = int(raw)
            except (TypeError, ValueError):
                raise ValueError("invalid_target_score")
            if score < MIN_TARGET_SCORE or score > MAX_TARGET_SCORE:
                raise ValueError("invalid_target_score")
            user.target_score = score
        touched_intent = True
    if "target_test_date" in payload:
        raw = payload["target_test_date"]
        if raw is None:
            user.target_test_date = None
        else:
            try:
                user.target_test_date = date.fromisoformat(str(raw))
            except ValueError:
                raise ValueError("invalid_target_test_date")
        touched_intent = True
    if "guided_tour_completed" in payload:
        # Finishing and skipping are the same fact — the account has been offered
        # the tour and does not need it forced again. Only ever set, never cleared
        # by a client; replaying is a local action that leaves this alone.
        if payload["guided_tour_completed"] and user.guided_tour_completed_at is None:
            user.guided_tour_completed_at = utcnow()
    if "assistance_level" in payload:
        level = payload["assistance_level"]
        if level not in ASSISTANCE_LEVELS:
            raise ValueError("invalid_assistance_level")
        user.assistance_level = level
    elif touched_intent and onboarding_stage:
        user.assistance_level = default_assistance_level(user.target_score, user.target_test_date)
    db.session.commit()
    return user


def serialize_question(question: Question) -> dict:
    return {
        "id": question.id,
        "section": question.section,
        "question_type": question.question_type,
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
    }


def _elapsed_ms(item: SessionItem) -> int:
    elapsed_ms = item.active_elapsed_ms or 0
    if item.timer_started_at and item.session.status == "in_progress":
        started = item.timer_started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        elapsed_ms += max(0, int((utcnow() - started).total_seconds() * 1000))
    return elapsed_ms


def _target_time_seconds(item: SessionItem) -> int:
    """Return the case target, including passage reuse for RC questions."""
    if item.question.section == "Logical Reasoning":
        return 150
    previous = None
    if item.position > 0:
        previous = SessionItem.query.filter_by(
            session_id=item.session_id,
            position=item.position - 1,
        ).first()
    if (
        item.question.passage_id
        and previous
        and previous.question.passage_id == item.question.passage_id
    ):
        return 135
    return 330


def _is_unfinished_current_item(item: SessionItem) -> bool:
    session = item.session
    return (
        session.status in {"in_progress", "paused"}
        and session.pending_attempt_id is None
        and item.position == session.current_index
        and item.completed_at is None
        and item.attempt is None
    )


def _freeze_current_case(item: SessionItem, user: User) -> bool:
    """Adopt only the visible unfinished case into the tycoon economy."""
    if (
        item.session.mode == "diagnostic"
        or item.game_context_json is not None
        or not user.game_profile
        or not _is_unfinished_current_item(item)
    ):
        return False
    # Migration 0012 gave old rows the LR default. Recompute RC timing when an
    # unfinished legacy item first enters the tycoon flow.
    item.target_time_seconds = _target_time_seconds(item)
    item.game_context_json = snapshot_case_context(user.game_profile)
    return True


def serialize_item(item: SessionItem, commit: bool = True) -> dict:
    changed = False
    now = utcnow()
    if not item.served_at:
        item.served_at = now
        changed = True
    if _freeze_current_case(item, item.session.user):
        changed = True
    if (
        item.session.status == "in_progress"
        and not item.session.pending_attempt_id
        and item.position == item.session.current_index
        and not item.completed_at
        and not item.timer_started_at
    ):
        item.timer_activated_at = item.timer_activated_at or now
        item.timer_started_at = now
        item.paused_at = None
        changed = True
    if changed and commit:
        db.session.commit()
    context = item.game_context_json or {}
    client_key = str(context.get("client_key") or "walk_in")
    client = CLIENT_BY_KEY.get(client_key, CLIENT_BY_KEY["walk_in"])
    strategy_trial = (
        serialize_strategy(item.strategy_key)
        if item.strategy_key and item.strategy_variant == "prompt"
        else None
    )
    return {
        "id": item.id,
        "position": item.position,
        "section_index": item.section_index,
        "requires_reasoning": item.requires_reasoning,
        "reasoning_min_chars": reasoning_min_chars(item.session),
        "strategy_trial": ({**strategy_trial, "variant": "prompt"} if strategy_trial else None),
        "strategy_gate": build_gate(item) if strategy_trial else None,
        "served_at": _iso_utc(item.served_at),
        "elapsed_ms": _elapsed_ms(item),
        "target_time_seconds": item.target_time_seconds,
        "case_terms": (
            {
                "client_key": client["key"],
                "client_name": client["name"],
                "base_fee": int(context.get("base_fee") or client["base_fee"]),
            }
            if context
            else None
        ),
        "timer_active": bool(item.timer_started_at and item.session.status == "in_progress"),
        "draft": {
            "selected_label": item.draft_selected_label,
            "reasoning": item.draft_reasoning_text or "",
            "updated_at": _iso_utc(item.draft_updated_at),
        },
        "question": serialize_question(item.question),
    }


def serialize_session(session: StudySession, include_item: bool = True) -> dict:
    enforce_diagnostic_deadline(session)
    payload = {
        "id": session.id,
        "mode": session.mode,
        "practice_style": session.practice_style,
        "feedback_policy": session.feedback_policy,
        "status": session.status,
        "target_minutes": session.target_minutes,
        "accommodation_multiplier": session.accommodation_multiplier,
        "section_plan": session.section_plan_json or [],
        "ended_by_user": session.ended_by_user,
        "total_items": session.total_items,
        "current_index": session.current_index,
        "progress_percent": round(100 * session.current_index / max(1, session.total_items)),
        "started_at": _iso_utc(session.started_at),
        "deadline_at": _iso_utc(session.deadline_at),
        # The client counts down between polls, but it never decides when the
        # form is over: the server hands it the remaining time and rejects
        # anything that arrives after zero.
        "remaining_ms": diagnostic_remaining_ms(session),
        "time_limit_seconds": session.target_minutes * 60 if session.deadline_at else None,
        "completed_at": _iso_utc(session.completed_at),
    }
    if session.pending_attempt_id:
        pending_attempt = db.session.get(Attempt, session.pending_attempt_id)
        if pending_attempt:
            payload["pending_result"] = serialize_attempt_result(pending_attempt)
            payload["pending_item"] = serialize_item(pending_attempt.session_item, commit=False)
            return payload
    if include_item and session.status == "in_progress":
        item = SessionItem.query.filter_by(
            session_id=session.id,
            position=session.current_index,
        ).first()
        payload["current_item"] = serialize_item(item) if item else None
    return payload


def eligible_question_count() -> int:
    return Question.query.filter(Question.source.like(f"{SOURCE_PREFIX}%")).count()


def _seen_question_ids(user_id: str) -> set[str]:
    return {
        question_id
        for (question_id,) in (
            db.session.query(SessionItem.question_id)
            .join(Attempt, Attempt.session_item_id == SessionItem.id)
            .filter(Attempt.user_id == user_id)
            .all()
        )
    }


def select_random_questions(
    count: int,
    question_type: str | None = None,
    *,
    user_id: str | None = None,
    exclude_ids: set[str] | None = None,
    focus_types: list[str] | None = None,
) -> list[Question]:
    query = Question.query.filter(Question.source.like(f"{SOURCE_PREFIX}%"))
    if question_type:
        query = query.filter(Question.question_type == question_type)
    # Excluding here rather than from `unseen` alone matters: the fallback below
    # widens the pool to already-seen questions, and a question seeded as a
    # repair is by definition seen. Filtering only `unseen` would let it come
    # back through the fallback and appear twice in one run.
    blocked = exclude_ids or set()
    eligible = [question for question in query.all() if question.id not in blocked]
    if not eligible:
        return []
    # Hoisted out of the comprehension below: calling this once here instead of
    # once per candidate question turned a single-query lookup into an N+1 that
    # ran thousands of times per session creation on the full bank.
    seen_ids = _seen_question_ids(user_id) if user_id else set()
    unseen = [question for question in eligible if question.id not in seen_ids]
    pool = unseen if len(unseen) >= count else unseen + [question for question in eligible if question not in unseen]
    return _weight_toward_focus(pool, count, focus_types)


def _passage_blocks(pool: list[Question]) -> list[list[Question]]:
    """Group a candidate pool into the units a run may serve.

    A Reading Comprehension question is not a question on its own — the passage
    is most of the work — so passage-mates form one indivisible block and
    everything else is a block of one. The mega-litigation path has always done
    this; the practice path did not, which is how a student could be handed one
    lone question that required reading 450 words. That both inflates the run's
    length and corrupts the pace metrics the same run records, since the target
    times assume the first question on a passage pays for the reading and the
    rest do not.
    """
    grouped: dict[str, list[Question]] = defaultdict(list)
    for question in pool:
        grouped[question.passage_id or f"solo:{question.id}"].append(question)
    return [sorted(block, key=lambda question: question.id) for block in grouped.values()]


def _fill_blocks(blocks: list[list[Question]], budget: int, selected: list[list[Question]]) -> None:
    """Add whole blocks to `selected` until `budget` questions are chosen.

    Never overshoots and never splits a block, so a run comes out at the
    requested size whenever the pool contains any single-question material to
    round it out — which, with an LR bank in the thousands, is always.
    """
    chosen = {id(block) for block in selected}
    total = sum(len(block) for block in selected)
    for block in blocks:
        if total >= budget:
            return
        if id(block) in chosen or total + len(block) > budget:
            continue
        selected.append(block)
        total += len(block)


def _weight_toward_focus(pool: list[Question], count: int, focus_types: list[str] | None) -> list[Question]:
    """Fill most of a run from the mega-litigation's weak types, the rest at random.

    Deliberately a bias and not a filter. Drilling only the weak types would
    stop measuring everything else and would make one bad run self-reinforcing;
    a majority share is enough to move the needle while practice still covers
    the whole test. Falls back to a plain sample when there is no focus, or too
    little focus material to reach the quota.

    Selection happens over passage blocks rather than over questions, so the
    focus bias can never separate passage-mates. A block counts as focus
    material if any of its questions is a focus type, which is the only sensible
    reading for a passage whose questions are of several types.
    """
    if count <= 0:
        return []
    blocks = _passage_blocks(pool)
    random.shuffle(blocks)
    wanted = set(focus_types or ())
    selected: list[list[Question]] = []
    if wanted:
        preferred = [block for block in blocks if any(question.question_type in wanted for question in block)]
        preferred_ids = {id(block) for block in preferred}
        others = [block for block in blocks if id(block) not in preferred_ids]
        _fill_blocks(preferred, round(count * FOCUS_FILL_RATIO), selected)
        _fill_blocks(others, count, selected)
        # Not enough off-focus material to round the run out; top up from focus.
        _fill_blocks(preferred, count, selected)
    else:
        _fill_blocks(blocks, count, selected)
    if not selected and blocks:
        # The only material left is a passage longer than the whole run. Serving
        # it whole and slightly long beats serving a fragment of it, and beats
        # refusing to build a session at all.
        selected.append(min(blocks, key=len))
    random.shuffle(selected)
    return [question for block in selected for question in block]


def select_diagnostic_questions(count: int) -> tuple[list[Question], list[int], list[dict]]:
    """Build LR / intact RC / LR blocks without revealing or coaching mid-form.

    The blocks no longer carry their own clocks — the mega-litigation runs on one
    whole-form deadline — but they still keep RC passages intact, order the form
    like a real test, and give the results screen a per-block breakdown. Each
    block reports the `minutes` it would be worth on a real LSAT, which is what
    the whole-form budget is summed from.

    The form is a **fixed length**, and getting there is the whole shape of this
    function. It used to test `len(selected_rc) >= rc_target` *before* extending
    by a whole passage, so the last passage always overshot and the negative
    remainder clamped to zero: a nominally 75-item form came out at 76, 77, 78,
    79, 80, 81, or 82 depending on how the passage sizes happened to land. That
    is not a cosmetic wobble. The projected score converts against a fixed-size
    reference form, and the practice panel promises the player the previous run's
    count. So RC is chosen first, from whole passages only, up to its share of
    the form; LR — which is single-item and therefore divisible — fills the exact
    remainder. No passage is ever partially included.
    """
    eligible = Question.query.filter(Question.source.like(f"{SOURCE_PREFIX}%")).all()
    if not eligible:
        return [], [], []
    lr = [question for question in eligible if question.section == "Logical Reasoning"]
    rc = [question for question in eligible if question.section == "Reading Comprehension"]
    target = min(count, len(eligible))
    # The reference form's own mix (27 of 77 items) rather than a rounded
    # two-thirds. RC lands within one passage of that share — passages run 4 to
    # 16 questions in this bank and are indivisible — and LR, which is
    # single-item, absorbs the difference so the *total* is exact. Measured over
    # 200 seeds on the full bank: 77 items every time, 24-27 of them RC.
    rc_share = min(len(rc), round(target * FORM_RC_ITEMS / FORM_ITEMS))

    passage_groups: dict[str, list[Question]] = defaultdict(list)
    for question in rc:
        passage_groups[question.passage_id or question.id].append(question)
    groups = [sorted(group, key=lambda question: question.id) for group in passage_groups.values()]
    random.shuffle(groups)

    selected_rc: list[Question] = []
    taken: set[int] = set()
    # Every group is offered, not just a prefix, so a short passage can still
    # close a gap a long one would have overrun.
    for index, group in enumerate(groups):
        if len(selected_rc) + len(group) <= rc_share:
            selected_rc.extend(group)
            taken.add(index)
    # A bank thin on LR is the one case where RC has to carry more than its
    # share; whole passages still, and never past the target.
    for index, group in enumerate(groups):
        if index in taken or target - len(selected_rc) <= len(lr):
            continue
        if len(selected_rc) + len(group) <= target:
            selected_rc.extend(group)
            taken.add(index)
    # If LR still cannot round the form out, the form is short by construction
    # rather than padded with a fragment of a passage.
    lr_needed = min(target - len(selected_rc), len(lr))
    selected_lr = random.sample(lr, k=lr_needed) if lr_needed > 0 else []

    split = (len(selected_lr) + 1) // 2
    blocks = [selected_lr[:split], selected_rc, selected_lr[split:]]
    questions: list[Question] = []
    section_indexes: list[int] = []
    plan: list[dict] = []
    labels = ["Logical Reasoning I", "Reading Comprehension", "Logical Reasoning II"]
    for section_index, block in enumerate(blocks):
        if not block:
            continue
        start = len(questions)
        questions.extend(block)
        section_indexes.extend([section_index] * len(block))
        minutes = 35 if len(block) >= 18 else max(8, round(len(block) * 1.55))
        plan.append(
            {
                "index": section_index,
                "label": labels[section_index],
                "start": start,
                "end": len(questions) - 1,
                "questions": len(block),
                "minutes": minutes,
            }
        )
    return questions, section_indexes, plan


def _questions_due_for_review(user_id: str, count: int) -> list[Question]:
    """The weakest cards in this student's queue, ranked by retrievability.

    Delegates to `scheduling.due_for_review`, which deliberately does not gate
    on `due_at <= now`: a student who sits down to work at any hour is handed
    the material they are closest to forgetting rather than an empty queue and
    a date. See the module docstring in `app/scheduling.py`.
    """
    return scheduling.due_for_review(user_id, count)


def _pause_other_active_practice_sessions(user_id: str, *, exclude_id: str | None = None) -> None:
    """Enforce "at most one actively-ticking practice timer per student".

    Multiple practice runs may be queued (paused) at once, but an item's
    `timer_started_at` only means anything while the student is actually
    looking at that item. Whenever a run is about to become "in_progress"
    (freshly created, or explicitly resumed), every other run that is still
    marked in_progress must be paused first — otherwise its last item would
    keep silently accumulating wall-clock elapsed time while the student is on
    a different run, corrupting pace/evidence data downstream.
    """
    others = StudySession.query.filter(
        StudySession.user_id == user_id,
        StudySession.mode == "practice",
        StudySession.status == "in_progress",
    )
    if exclude_id:
        others = others.filter(StudySession.id != exclude_id)
    for other in others.all():
        pause_study_session(other)


def create_study_session(
    user: User,
    *,
    count: int | None = None,
    question_type: str | None = None,
    practice_style: str = "cases",
) -> StudySession:
    # The account row is the cross-request mutex for the single active case
    # batch. Both POST /study-sessions and final acknowledgement use this path.
    profile = lock_user_profile(user.id)
    if not profile:
        raise ValueError("onboarding_required")
    queue_cap = int(current_app.config["PRACTICE_QUEUE_MAX"])
    if len(list_resumable_sessions(user)) >= queue_cap:
        db.session.commit()
        raise ValueError("queue_full")

    if practice_style not in PRACTICE_STYLES:
        raise ValueError("invalid_practice_style")
    policy = "immediate"

    session_size = count if count is not None else int(current_app.config["PRACTICE_SESSION_SIZE"])
    # Repairs fill at most half a run so a large queue can never turn practice
    # into pure repetition. A type-filtered run is a focused drill; mixing
    # off-type repairs into it would defeat the filter the student asked for.
    repairs = [] if question_type else _questions_due_for_review(user.id, session_size // 2)
    # Due passage-mates travel together so the run reads the passage once. Only
    # the ones the scheduler already chose — see `cluster_passage_mates`.
    repairs = scheduling.cluster_passage_mates(repairs)
    # A type-filtered run is the student overriding the weighting by hand, so the
    # last mega-litigation only steers an unfiltered one.
    focus_types = [] if question_type else diagnostic_focus(user.id)
    repair_ids = {question.id for question in repairs}
    # A fresh question sharing a passage with a review item would have the run
    # read that passage twice, because reviews and fresh material are placed
    # independently. Blocking the whole passage keeps one rule: inside a run, a
    # passage is either served whole as fresh material or represented only by
    # the review items the scheduler picked.
    blocked_ids = set(repair_ids)
    repair_passages = {question.passage_id for question in repairs if question.passage_id}
    if repair_passages:
        blocked_ids |= {
            question_id
            for (question_id,) in db.session.query(Question.id).filter(
                Question.passage_id.in_(repair_passages)
            )
        }
    fresh = select_random_questions(
        session_size - len(repairs),
        question_type,
        user_id=user.id,
        exclude_ids=blocked_ids,
        focus_types=focus_types,
    )
    # Genuine interleaving, not front-loading. Reviews are distributed through
    # the run instead of stacked at the start, which is what the old
    # `repairs + fresh` concatenation did — and which leaks "these first four
    # are the ones you got wrong" before the student has read a word.
    questions = scheduling.interleave(repairs, fresh, question_type=question_type)
    if not questions:
        raise RuntimeError("No Hugging Face LSAT questions are available")

    # A new run always starts in_progress (see the StudySession default), so
    # whatever else was ticking must be paused first — see
    # `_pause_other_active_practice_sessions` for why this matters. Deferred
    # to this point so a validation failure above never has the side effect
    # of pausing a run that was otherwise left untouched.
    _pause_other_active_practice_sessions(user.id)

    session = StudySession(
        user_id=user.id,
        mode="practice",
        practice_style=practice_style,
        feedback_policy=policy,
        target_minutes=user.target_minutes,
        total_items=len(questions),
    )
    db.session.add(session)
    db.session.flush()
    previous_passage_id = None
    for position, question in enumerate(questions):
        if question.section == "Logical Reasoning":
            target_time_seconds = 150
        else:
            target_time_seconds = 135 if question.passage_id and question.passage_id == previous_passage_id else 330
        strategy_trial = assign_strategy_trial(user.id, question, practice_style, position, focus_types=focus_types)
        db.session.add(
            SessionItem(
                session_id=session.id,
                question_id=question.id,
                position=position,
                requires_reasoning=True,
                from_review_queue=question.id in repair_ids,
                strategy_key=strategy_trial["key"] if strategy_trial else None,
                strategy_variant=strategy_trial["variant"] if strategy_trial else None,
                strategy_propensity=strategy_trial["propensity"] if strategy_trial else None,
                strategy_candidates_n=strategy_trial["candidates_n"] if strategy_trial else None,
                # Fixed here rather than at serve time so the gate a student
                # meets is the one their history at session start earned. Only
                # the prompt arm is ever enforced: leaving the control arm
                # untouched is what keeps the trial a comparison between an
                # offer and no offer instead of a comparison between two
                # different interfaces. See app/enforcement.py.
                strategy_enforcement_level=assign_enforcement_level(user.id, strategy_trial, "practice"),
                target_time_seconds=target_time_seconds,
            )
        )
        previous_passage_id = question.passage_id
    db.session.commit()
    return session


def create_diagnostic_session(user: User, *, accommodation_multiplier: float = 1.0) -> StudySession:
    profile = lock_user_profile(user.id)
    if not profile:
        raise ValueError("onboarding_required")
    active = find_active_diagnostic(user)
    if active:
        db.session.commit()
        return active
    if accommodation_multiplier not in {1.0, 1.5, 2.0}:
        raise ValueError("invalid_accommodation")
    questions, section_indexes, section_plan = select_diagnostic_questions(int(current_app.config["DIAGNOSTIC_SESSION_SIZE"]))
    if not questions:
        raise RuntimeError("No Hugging Face LSAT questions are available")
    target_minutes = max(1, round(sum(section["minutes"] for section in section_plan) * accommodation_multiplier))
    started_at = utcnow()
    session = StudySession(
        user_id=user.id,
        mode="diagnostic",
        practice_style="diagnostic",
        feedback_policy="delayed",
        accommodation_multiplier=accommodation_multiplier,
        # The blocks keep their labels and boundaries but lose their minutes:
        # under one whole-form clock a per-section budget would be a number the
        # server does not enforce and the student cannot act on.
        section_plan_json=[
            {key: value for key, value in section.items() if key != "minutes"}
            for section in section_plan
        ],
        target_minutes=target_minutes,
        total_items=len(questions),
        started_at=started_at,
        deadline_at=started_at + timedelta(minutes=target_minutes),
    )
    db.session.add(session)
    db.session.flush()
    # One clock for the form means one budget per question: the student is free
    # to spend it unevenly, and the even split is what "on pace" is measured
    # against. The old 150s/330s targets belong to coached practice, where a
    # written explanation is part of the work, and summed to well over twice
    # this form's budget.
    per_question_seconds = max(30, round(target_minutes * 60 / len(questions)))
    for position, question in enumerate(questions):
        db.session.add(
            SessionItem(
                session_id=session.id,
                question_id=question.id,
                position=position,
                section_index=section_indexes[position],
                requires_reasoning=False,
                target_time_seconds=per_question_seconds,
            )
        )
    db.session.commit()
    return session


def finalize_diagnostic(session: StudySession, *, completed_at=None) -> dict:
    """Close a mega-litigation and pay out whatever the score earned.

    Reached from two directions — the last answer, and the deadline passing with
    questions still unanswered — so it has to be safe to arrive at twice. The
    summary is idempotent by construction and the promotion is guarded by the
    ledger's `uq_ledger_source` constraint.
    """
    if session.status != "completed":
        session.status = "completed"
        session.completed_at = completed_at or utcnow()
    db.session.flush()
    summary = calculate_session_summary(session)
    session.summary_json = summary
    db.session.commit()
    # A sat form is the strongest evidence this app ever collects, so it always
    # gets a snapshot — from here rather than from the read path, and reached
    # from both the last answer and the deadline. Safe to arrive at twice: the
    # throttle in `record_projection` collapses the second call.
    record_projection(session.user)

    profile = session.user.game_profile
    if not profile:
        return summary
    # Against the whole form, not the questions reached: a student who answers
    # four correctly and walks away has not cleared anything.
    cleared = summary.get("correct", 0) > MEGA_LITIGATION_PROMOTION_ACCURACY * max(1, session.total_items)
    if not cleared:
        return summary
    promotion = grant_mega_litigation_promotion(profile, session.id)
    if promotion:
        session.summary_json = {**summary, "promotion": promotion}
        db.session.commit()
        return session.summary_json
    # The form was cleared but the bonus was not on offer — the day's promotion
    # is spent, the lifetime allowance is gone, or the firm is already at the
    # top. Say which, so the results screen can explain the absence instead of
    # leaving the student to conclude the score did not count.
    session.summary_json = {**summary, "promotion_status": mega_litigation_promotion_state(profile)}
    db.session.commit()
    return session.summary_json


def pause_study_session(session: StudySession) -> StudySession:
    # A mega-litigation is one sitting. Its clock is wall-clock and nothing stops
    # it, so "paused" would be a lie the interface told about a run that is
    # still burning down.
    if session.mode == "diagnostic" and session.deadline_at:
        raise ValueError("diagnostic_no_pause")
    if session.status == "paused":
        return session
    if session.status == "completed" and session.pending_attempt_id:
        return session
    if session.status != "in_progress":
        raise ValueError("session_complete")
    item = SessionItem.query.filter_by(session_id=session.id, position=session.current_index).first()
    if item and item.timer_started_at:
        started = item.timer_started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        item.active_elapsed_ms = (item.active_elapsed_ms or 0) + max(
            0, int((utcnow() - started).total_seconds() * 1000)
        )
        item.timer_started_at = None
        item.paused_at = utcnow()
        item.timer_compromised = True
    session.status = "paused"
    db.session.commit()
    return session


def resume_study_session(session: StudySession) -> StudySession:
    if session.mode == "diagnostic" and session.deadline_at:
        # Nothing pauses it, so nothing resumes it. An expired run finalizes here
        # rather than pretending it can be picked back up.
        enforce_diagnostic_deadline(session)
        raise ValueError("diagnostic_no_pause")
    if session.status == "in_progress":
        return session
    if session.status != "paused":
        raise ValueError("session_complete")
    if session.mode == "practice":
        _pause_other_active_practice_sessions(session.user_id, exclude_id=session.id)
    session.status = "in_progress"
    db.session.commit()
    return session


def abandon_study_session(session: StudySession) -> StudySession:
    """Let a student discard an unfinished run instead of letting it sit.

    Already-graded attempts inside the run are untouched, so nothing already
    scored or recorded for spaced review is lost; this only frees the queue
    slot the run was occupying (see `list_resumable_sessions`), which matters
    once the queue is at its cap and a new run cannot start otherwise.
    """
    if session.status not in {"in_progress", "paused"}:
        raise ValueError("session_complete")
    if session.pending_attempt_id:
        raise ValueError("debrief_required")
    # Deliberately leave completed_at unset: daily_docket_snapshot treats any
    # non-null completed_at as "done today" without checking status, and an
    # abandoned Sprint or Review run must not silently mark that slot cleared.
    session.status = "abandoned"
    session.ended_by_user = True
    db.session.commit()
    return session


def session_review(session: StudySession) -> dict:
    if session.status != "completed":
        raise ValueError("session_in_progress")
    attempts = (
        Attempt.query.join(SessionItem)
        .filter(SessionItem.session_id == session.id)
        .order_by(SessionItem.position.asc())
        .all()
    )
    return {
        "session": serialize_session(session, False),
        "summary": session.summary_json or calculate_session_summary(session),
        "items": [
            {
                "position": attempt.session_item.position,
                "question": serialize_question(attempt.session_item.question),
                "attempt_id": attempt.id,
                "selected_label": attempt.selected_label,
                "correct_label": attempt.session_item.question.correct_answer,
                "is_correct": attempt.is_correct,
                "confidence": attempt.confidence,
                "elapsed_ms": attempt.server_elapsed_ms,
                "target_time_seconds": attempt.session_item.target_time_seconds,
                "priority_reason": (
                    "high_confidence_miss"
                    if not attempt.is_correct and (attempt.confidence or 0) >= 4
                    else "miss"
                    if not attempt.is_correct
                    else "low_confidence_correct"
                    if (attempt.confidence or 3) <= 2
                    else "slow_correct"
                    if attempt.server_elapsed_ms > attempt.session_item.target_time_seconds * 1000
                    else None
                ),
                "evidence_class": attempt.evidence_class,
                "feedback": attempt.feedback_json,
                "coaching_status": attempt.coaching_status,
            }
            for attempt in attempts
        ],
    }


def daily_docket_snapshot(user: User, timezone_name: str = "UTC") -> dict:
    """Derive today's learning queue without creating a second mission system."""
    try:
        local_zone = ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError):
        local_zone = timezone.utc
        timezone_name = "UTC"
    now = utcnow()
    local_date = now.astimezone(local_zone).date()
    day_start = datetime.combine(local_date, time.min, tzinfo=local_zone).astimezone(timezone.utc)
    day_end = datetime.combine(local_date + timedelta(days=1), time.min, tzinfo=local_zone).astimezone(timezone.utc)
    completed_today = (
        StudySession.query.filter(
            StudySession.user_id == user.id,
            StudySession.completed_at.isnot(None),
            StudySession.completed_at >= day_start,
            StudySession.completed_at < day_end,
        )
        .order_by(StudySession.completed_at.desc())
        .all()
    )
    completed_cases = next(
        (item for item in completed_today if item.mode == "practice" and item.total_items >= 5),
        None,
    )
    active = find_resumable_session(user)
    queue = review_queue_snapshot(user)

    cases_state = "active" if active else "complete" if completed_cases else "ready"
    priority_count = 0
    if completed_cases:
        priority_count = sum(bool(item["priority_reason"]) for item in session_review(completed_cases)["items"])
    brief_state = (
        "complete" if completed_cases and completed_cases.summary_seen_at
        else "ready" if completed_cases
        else "locked"
    )

    if active:
        next_action = {"kind": "resume", "session_id": active.id, "label": "Resume active run"}
    elif brief_state == "ready":
        next_action = {"kind": "open_brief", "session_id": completed_cases.id, "label": "Open Deep Brief"}
    elif cases_state == "ready":
        next_action = {"kind": "start_cases", "label": "Start 10 cases"}
    else:
        next_action = {"kind": "done", "label": "Daily docket complete"}

    return {
        "date": local_date.isoformat(),
        "timezone": timezone_name,
        "active_session": serialize_session(active, False) if active else None,
        "cases": {
            "state": cases_state,
            "target": 10,
            "repairs_due": queue["due"],
            "session_id": (active.id if active else completed_cases.id if completed_cases else None),
            "summary": completed_cases.summary_json if completed_cases else None,
        },
        "deep_brief": {
            "state": brief_state,
            "session_id": completed_cases.id if completed_cases else None,
            "priority_count": priority_count,
        },
        "next_action": next_action,
        # The docket is the one screen a learner opens with the intention of
        # working, so it is where the trial calendar is worth a line. It rides
        # along on a request that is already made rather than adding a fetch.
        "trial": trial_plan_snapshot(user),
    }


def trial_plan_snapshot(user: User) -> dict:
    """The trial calendar, read off the account's existing target and projection."""
    return trial_plan(
        user,
        projection=project_score(user),
        profile=user.game_profile,
    )


def review_queue_snapshot(user: User) -> dict:
    """Queue state for the dashboard, measured in retrievability rather than dates.

    "Due" now means *has decayed below the retention target*, which is what the
    scheduler actually serves on, instead of "its calendar date has passed".
    The two agree most of the time; where they differ, the retrievability
    reading is the one that matches what practice will hand the student next.
    """
    rows = (
        ReviewQueueItem.query.options(joinedload(ReviewQueueItem.question))
        .filter_by(user_id=user.id)
        .all()
    )
    now = utcnow()
    ranked = sorted(
        ((scheduling.card_retrievability(row, now), row) for row in rows),
        key=lambda pair: pair[0],
    )
    active = [(value, row) for value, row in ranked if row.status != "mastered"]
    due = [(value, row) for value, row in active if value < scheduling.DESIRED_RETENTION]
    return {
        "due": len(due),
        "scheduled": len(active) - len(due),
        "mastered": sum(row.status == "mastered" for row in rows),
        "tracked": len(rows),
        "desired_retention": scheduling.DESIRED_RETENTION,
        "weakest_retrievability": round(ranked[0][0], 3) if ranked else None,
        "items": [
            {
                "id": row.id,
                "question_id": row.question_id,
                "question_type": row.question.question_type,
                "section": row.question.section,
                "reason_code": row.reason_code,
                "interval_index": row.interval_index,
                "retrievability": round(value, 3),
                "due_at": _iso_utc(row.due_at),
            }
            for value, row in due[:12]
        ],
    }


def _feedback(question: Question, selected_label: str, is_correct: bool, reasoning: str | None) -> dict:
    return {
        "is_correct": is_correct,
        "selected_label": selected_label,
        "correct_label": question.correct_answer,
        "headline": "Correct" if is_correct else "Not quite",
        "diagnosis": (
            "Your answer matches the verified key."
            if is_correct
            else f"The verified answer is {question.correct_answer}."
        ),
        "coaching_notice": (
            "Your reasoning will be graded, and every answer choice will be explained."
        ),
    }


def _update_skill(user_id: str, question: Question, is_correct: bool, elapsed_ms: int) -> None:
    stat = SkillProgress.query.filter_by(
        user_id=user_id,
        skill_name=question.question_type,
    ).first()
    if not stat:
        stat = SkillProgress(
            user_id=user_id,
            skill_name=question.question_type,
            attempts=0,
            correct=0,
            explanation_total=0,
            explanation_count=0,
            total_time_ms=0,
            recent_mistakes=0,
        )
        db.session.add(stat)
    stat.attempts += 1
    stat.correct += int(is_correct)
    stat.total_time_ms += elapsed_ms
    stat.recent_mistakes = 0 if is_correct else stat.recent_mistakes + 1


def _attempt_band(attempt: Attempt) -> str | None:
    """Economy band for a graded explanation, or None while the grade is missing.

    ``Attempt.explanation_score`` is normalized 0-1; ``explanation_band`` wants a
    raw 0-100 score. Reuse is already handled upstream: ``settle_attempt`` zeroes
    a recycled explanation's grade before it is written here.
    """
    if attempt.explanation_score is None:
        return None
    return explanation_band(round(attempt.explanation_score * 100), bool(attempt.reasoning_text))


def _entry_reason(attempt: Attempt, band: str | None) -> str | None:
    """First matching reason this attempt belongs in the review queue."""
    confidence = attempt.confidence or 3
    slow = attempt.server_elapsed_ms > attempt.session_item.target_time_seconds * 1000
    if not attempt.is_correct:
        return "high_confidence_error" if confidence >= 4 else "incorrect"
    if band in {"Invalid", "Weak"}:
        return "unsupported_correct"
    if confidence <= 2:
        return "low_confidence_correct"
    if slow:
        return "slow_correct"
    return None


def _advance_review(existing: ReviewQueueItem, attempt: Attempt) -> None:
    """Advance one card's FSRS memory state from this attempt.

    The grade is derived from the attempt itself (correctness, pace against the
    item's target, confidence, explanation quality, whether the answer was
    changed) — see `scheduling.derive_grade`. The student is never asked.

    "Mastered" is now a statement about stability rather than about surviving
    four rungs of a ladder: once a card's next interval exceeds
    `MASTERED_STABILITY_DAYS`, the student is not going to forget it before
    their test, and it stops occupying a review slot. It is not deleted, so a
    lapse can still pull it straight back.
    """
    grade = scheduling.apply_review(existing, attempt)
    if grade == scheduling.GRADE_AGAIN:
        existing.status = "due"
        existing.reason_code = "repeat_error"
        return
    if existing.stability and scheduling.interval_days(existing.stability) >= MASTERED_STABILITY_DAYS:
        existing.status = "mastered"
    else:
        existing.status = "due"


def _rewind_pending(existing: ReviewQueueItem) -> None:
    """Undo a provisional pre-grade FSRS step so the graded one can replace it.

    ``grade_pending`` means the stored ``pre_grade_*`` triple is the state this
    card was in before the un-graded attempt moved it. Restoring that triple
    lets the second pass apply exactly one transition instead of two.
    """
    if not existing.grade_pending:
        return
    existing.stability = existing.pre_grade_stability
    existing.difficulty = existing.pre_grade_difficulty
    existing.last_reviewed_at = existing.pre_grade_reviewed_at
    existing.reps = max(0, (existing.reps or 0) - 1)
    if existing.last_grade == scheduling.GRADE_AGAIN:
        existing.lapses = max(0, (existing.lapses or 0) - 1)


def _hold_pending(existing: ReviewQueueItem, pending: bool) -> None:
    """Snapshot (or clear) the pre-grade memory state around a provisional step."""
    existing.grade_pending = pending
    existing.pre_grade_stability = existing.stability if pending else None
    existing.pre_grade_difficulty = existing.difficulty if pending else None
    existing.pre_grade_reviewed_at = existing.last_reviewed_at if pending else None


def _schedule_review(attempt: Attempt) -> None:
    """Place or move this question in the spaced-review queue.

    Safe to call twice for the same attempt: once on submit, when the
    explanation grade is still missing, and again from ``run_attempt_coaching``
    once the grade lands. The second call rewinds the provisional memory state
    first, so the advance is recomputed rather than compounded.
    """
    band = _attempt_band(attempt)
    pending = band is None and attempt.session_item.requires_reasoning
    existing = ReviewQueueItem.query.filter_by(
        user_id=attempt.user_id,
        question_id=attempt.session_item.question_id,
    ).first()

    # Per item, not per session: one run now carries both seeded repairs and
    # fresh questions, and each is scheduled by what it actually is.
    if attempt.session_item.from_review_queue:
        if not existing:
            return
        existing.last_attempt_id = attempt.id
        _rewind_pending(existing)
        _hold_pending(existing, pending)
        _advance_review(existing, attempt)
        return

    reason_code = _entry_reason(attempt, band)
    if not reason_code:
        return
    if not existing:
        existing = ReviewQueueItem(
            user_id=attempt.user_id,
            question_id=attempt.session_item.question_id,
            source_attempt_id=attempt.id,
            status="due",
            reason_code=reason_code,
            interval_index=0,
            due_at=utcnow(),
        )
        db.session.add(existing)
        db.session.flush()
    else:
        existing.source_attempt_id = existing.source_attempt_id or attempt.id
        existing.last_attempt_id = attempt.id
        _rewind_pending(existing)
    existing.status = "due"
    existing.reason_code = reason_code
    _hold_pending(existing, pending)
    # First contact with the memory model. A card entering the queue is by
    # definition one the student did not have — the FSRS step gives it a real
    # stability and difficulty instead of parking it on rung zero.
    scheduling.apply_review(existing, attempt)


def submit_attempt(
    user: User,
    session: StudySession,
    payload: dict,
    idempotency_key: str,
) -> tuple[Attempt, bool]:
    if not user.game_profile:
        raise ValueError("onboarding_required")
    requested_item_id = payload.get("item_id")
    existing = Attempt.query.filter_by(idempotency_key=idempotency_key).first()
    if existing:
        if (
            existing.user_id != user.id
            or existing.session_item.session_id != session.id
            or existing.session_item_id != requested_item_id
        ):
            raise ValueError("idempotency_conflict")
        return existing, True
    if session.pending_attempt_id:
        raise ValueError("debrief_required")
    if enforce_diagnostic_deadline(session):
        raise ValueError("diagnostic_expired")
    if session.status != "in_progress":
        raise ValueError("session_complete")

    item = SessionItem.query.filter_by(id=requested_item_id, session_id=session.id).first()
    if not item or item.position != session.current_index:
        raise ValueError("invalid_session_item")
    if item.attempt:
        return item.attempt, True
    _freeze_current_case(item, user)
    if (
        item.game_context_json is None
        and session.mode == "practice"
        and session.practice_style == "deep"
    ):
        raise ValueError("game_context_required")

    selected_label = str(payload.get("selected_label", "")).strip().upper()
    if selected_label not in {choice.label for choice in item.question.choices}:
        raise ValueError("invalid_choice")
    reasoning = str(payload.get("reasoning") or "").strip()[:4000] or None
    if item.requires_reasoning:
        if not reasoning:
            raise ValueError("reasoning_required")
        if len(reasoning) < reasoning_min_chars(session):
            raise ValueError("reasoning_too_short")
    try:
        confidence = int(payload.get("confidence", 3))
    except (TypeError, ValueError):
        raise ValueError("invalid_confidence")
    if confidence < 1 or confidence > 5:
        raise ValueError("invalid_confidence")
    strategy_applied = None
    strategy_prompt_ms = 0
    strategy_gate_ms = 0
    strategy_gate_status = None
    strategy_artifact = None
    enforcement_level = item.strategy_enforcement_level or LEVEL_NONE
    if item.strategy_key and item.strategy_variant == "prompt":
        raw_strategy_applied = payload.get("strategy_applied")
        if not isinstance(raw_strategy_applied, bool):
            raise ValueError("strategy_decision_required")
        strategy_applied = raw_strategy_applied
        try:
            strategy_prompt_ms = max(0, min(int(payload.get("strategy_prompt_ms") or 0), 60_000))
            strategy_gate_ms = max(0, min(int(payload.get("strategy_gate_ms") or 0), 10 * 60 * 1000))
        except (TypeError, ValueError):
            raise ValueError("invalid_strategy_prompt_time")
        if enforcement_level == LEVEL_NONE:
            strategy_gate_status = STATUS_UNENFORCED
        elif not strategy_applied:
            # Declining the approach is a legitimate answer, not a failure. It
            # is also the accessibility escape hatch and the way out for anyone
            # the gate is fighting rather than helping, so it never blocks and
            # never costs anything beyond being recorded honestly.
            strategy_gate_status = STATUS_SKIPPED
            strategy_gate_ms = 0
        else:
            # `validate_artifact` raises `GateRejection`, which the route turns
            # into per-field messages. The browser runs the same checks for
            # instant feedback, but this is the copy that decides, because a
            # gate enforced only in the client enforces nothing.
            try:
                strategy_artifact = validate_artifact(item, payload.get("strategy_artifact"), selected_label)
                strategy_gate_status = STATUS_SATISFIED
            except GateRejection:
                if enforcement_level != LEVEL_LIGHT:
                    raise
                # A student who has already cleared this gate eight times is
                # taken at their word. The prompt still shows, the steps are
                # optional, and the attempt is marked so no analysis confuses
                # an attestation with a demonstration.
                strategy_gate_status = STATUS_ATTESTED
                strategy_artifact = None
    elapsed_ms = max(1000, min(_elapsed_ms(item), 15 * 60 * 1000))
    is_correct = selected_label == item.question.correct_answer
    _update_skill(user.id, item.question, is_correct, elapsed_ms)

    attempt = Attempt(
        user_id=user.id,
        session_item_id=item.id,
        idempotency_key=idempotency_key,
        selected_label=selected_label,
        is_correct=is_correct,
        reasoning_text=reasoning,
        confidence=confidence,
        answer_changed=bool(payload.get("answer_changed", False)),
        strategy_key=item.strategy_key,
        strategy_variant=item.strategy_variant,
        strategy_applied=strategy_applied,
        strategy_prompt_ms=strategy_prompt_ms,
        strategy_gate_ms=strategy_gate_ms,
        strategy_gate_status=strategy_gate_status,
        strategy_enforcement_level=(enforcement_level if item.strategy_key else None),
        strategy_enforcement_version=(ENFORCEMENT_VERSION if strategy_gate_status else None),
        strategy_artifact_json=strategy_artifact or None,
        strategy_propensity=item.strategy_propensity,
        strategy_candidates_n=item.strategy_candidates_n,
        evidence_class=EVIDENCE_CLASS.get(session.practice_style, EVIDENCE_CLASS.get(session.mode, "coached_practice")),
        server_elapsed_ms=elapsed_ms,
        client_elapsed_ms=None,
        capm_points=0,
        pace_scored=False,
        xp_earned=0,
        feedback_json=_feedback(item.question, selected_label, is_correct, reasoning),
        coaching_status="pending",
    )
    db.session.add(attempt)
    db.session.flush()
    _schedule_review(attempt)
    item.completed_at = utcnow()
    item.active_elapsed_ms = elapsed_ms
    item.timer_started_at = None
    item.paused_at = None
    item.draft_selected_label = None
    item.draft_reasoning_text = None
    item.draft_updated_at = None
    session.current_index += 1
    session.pending_attempt_id = attempt.id if session.feedback_policy == "immediate" else None
    if session.current_index >= session.total_items:
        session.status = "completed"
        session.completed_at = utcnow()
        db.session.flush()
        session.summary_json = calculate_session_summary(session)
    db.session.commit()
    if session.status == "completed" and session.mode == "diagnostic":
        # Answering the last question closes the form the same way the clock
        # does, promotion included.
        finalize_diagnostic(session)
    elif session.status == "completed":
        # The trend line gains a point when the evidence changes, not when the
        # dashboard is opened — see `scoring.projection_snapshot`.
        record_projection(session.user)
    return attempt, False


def serialize_attempt_result(attempt: Attempt, duplicate: bool = False) -> dict:
    session = attempt.session_item.session
    feedback_released = session.feedback_policy == "immediate"
    if not feedback_released:
        return {
            "attempt_id": attempt.id,
            "duplicate": duplicate,
            "recorded": True,
            "feedback_released": False,
            "elapsed_ms": attempt.server_elapsed_ms,
            "coaching_status": attempt.coaching_status,
            "has_reasoning": bool(attempt.reasoning_text),
            "game_reward": None,
            "session_complete": session.status == "completed",
            "session_id": session.id,
        }
    return {
        "attempt_id": attempt.id,
        "duplicate": duplicate,
        "recorded": True,
        "feedback_released": True,
        "is_correct": attempt.is_correct,
        "elapsed_ms": attempt.server_elapsed_ms,
        "feedback": attempt.feedback_json,
        "coaching_status": attempt.coaching_status,
        "has_reasoning": bool(attempt.reasoning_text),
        "game_reward": serialize_settlement(attempt.settlement),
        "session_complete": session.status == "completed",
        "session_id": session.id,
    }


def run_attempt_coaching(attempt: Attempt) -> dict:
    existing_feedback = (attempt.feedback_json or {}).get("coaching")
    if attempt.coaching_status == "completed" and existing_feedback:
        if not attempt.settlement:
            settle_attempt(attempt, existing_feedback)
            db.session.commit()
        return existing_feedback
    if attempt.coaching_status == "processing" and attempt.coaching_started_at:
        started = attempt.coaching_started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        if (utcnow() - started).total_seconds() < 150:
            raise ValueError("coaching_in_progress")

    attempt.coaching_status = "processing"
    attempt.coaching_started_at = utcnow()
    db.session.commit()
    try:
        coaching, _metadata = generate_attempt_coaching(attempt)
    except CoachingProviderError:
        attempt.coaching_status = "failed"
        attempt.coaching_started_at = None
        db.session.commit()
        raise

    settle_attempt(attempt, coaching)

    # Deliberately after settlement. The rating is a note in the debrief and
    # nothing downstream reads it, so it cannot cost a correct answer anything.
    attempt.strategy_artifact_quality = enforcement.review_artifact(attempt)

    if coaching["explanation_grade"] is not None and not attempt.explanation_score_applied:
        normalized_score = coaching["explanation_grade"] / 100
        stat = SkillProgress.query.filter_by(
            user_id=attempt.user_id,
            skill_name=attempt.session_item.question.question_type,
        ).first()
        if stat:
            stat.explanation_total += normalized_score
            stat.explanation_count += 1
        attempt.explanation_score = normalized_score
        attempt.explanation_score_applied = True
        # The submit-time schedule was written without a grade. Redo it now.
        _schedule_review(attempt)

    feedback = dict(attempt.feedback_json or {})
    feedback["coaching"] = coaching
    attempt.feedback_json = feedback
    attempt.coaching_status = "completed"
    attempt.coaching_started_at = None
    attempt.coaching_model = coaching["model"]
    attempt.coached_at = utcnow()
    session = attempt.session_item.session
    if session.status == "completed":
        session.summary_json = calculate_session_summary(session)
    db.session.commit()
    return coaching


UNGRADED_COACHING_NOTICE = (
    "The AI coach could not be reached for this case. Your answer was checked against the "
    "verified key and the case was settled without a grade on your written reasoning."
)


def settle_uncoached_attempt(attempt_id: str) -> bool:
    """Pay and close a case whose explanation grading gave up.

    Correctness comes from the verified answer key, not from the coach, so an
    outage must never strand a finished case unsettled — the player has already
    moved on by then. The write-up simply goes ungraded: with no grade the band is
    Invalid, which for a correct answer is the thin-win path and for a wrong one
    is what an ungradable explanation was always worth. Nothing is written to
    skill stats or the review schedule, because no grade exists to write.
    """
    attempt = db.session.get(Attempt, attempt_id)
    if not attempt or attempt.settlement:
        return False
    if attempt.session_item.game_context_json is None:
        return False
    settlement = settle_attempt(attempt, {"explanation_grade": None, "model": None})
    feedback = dict(attempt.feedback_json or {})
    feedback["coaching_unavailable"] = UNGRADED_COACHING_NOTICE
    attempt.feedback_json = feedback
    attempt.coaching_status = "failed"
    attempt.coaching_started_at = None
    db.session.commit()
    return settlement is not None


def coaching_handed_off(attempt: Attempt) -> bool:
    """True once explanation grading for this attempt has actually been requested.

    The debrief can then be closed while the grade is still resolving: the
    settlement lands on its own, from the worker or from the fallback above. What
    stays blocked is closing a debrief for a case that was never sent for grading
    at all, which is the API-level skip the settlement gate exists to prevent.
    """
    if attempt.coaching_status in {"processing", "completed", "failed"}:
        return True
    return AiJob.query.filter_by(dedup_key=f"coaching:{attempt.id}").first() is not None


def _join_types(names: list[str]) -> str:
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + f" and {names[-1]}"


def _skill_breakdown(attempts: list[Attempt]) -> list[dict]:
    grouped: dict[str, list[Attempt]] = defaultdict(list)
    for attempt in attempts:
        grouped[attempt.session_item.question.question_type].append(attempt)
    return [
        {
            "name": name,
            "attempts": len(values),
            "accuracy": round(sum(value.is_correct for value in values) / len(values) * 100),
        }
        for name, values in grouped.items()
    ]


def calculate_session_summary(session: StudySession) -> dict:
    attempts = (
        Attempt.query.join(SessionItem)
        .filter(SessionItem.session_id == session.id)
        .order_by(Attempt.created_at)
        .all()
    )
    explanation_scores = [
        attempt.explanation_score
        for attempt in attempts
        if attempt.explanation_score is not None
    ]
    sections = []
    section_plan = {int(section["index"]): section for section in (session.section_plan_json or [])}
    grouped_sections: dict[int, list[Attempt]] = defaultdict(list)
    for attempt in attempts:
        grouped_sections[attempt.session_item.section_index].append(attempt)
    for section_index, values in sorted(grouped_sections.items()):
        plan = section_plan.get(section_index, {})
        sections.append(
            {
                "index": section_index,
                "label": plan.get("label") or values[0].session_item.question.section,
                "correct": sum(value.is_correct for value in values),
                "questions": len(values),
                "accuracy": round(sum(value.is_correct for value in values) / max(1, len(values)) * 100),
                "elapsed_minutes": round(sum(value.server_elapsed_ms for value in values) / 60_000, 1),
                "timing_compromised": any(value.session_item.timer_compromised for value in values),
            }
        )
    confidence_values = [attempt.confidence for attempt in attempts if attempt.confidence is not None]
    high_confidence = [attempt for attempt in attempts if (attempt.confidence or 0) >= 4]
    correct = sum(attempt.is_correct for attempt in attempts)
    summary = {
        "kind": session.mode,
        "practice_style": session.practice_style,
        "feedback_policy": session.feedback_policy,
        "accuracy": round(correct / max(1, len(attempts)) * 100),
        # Accuracy scores what was answered; the form score scores the paper,
        # counting everything left blank against the student. The promotion bar
        # reads this one.
        "form_accuracy": round(correct / max(1, session.total_items) * 100),
        "correct": correct,
        "questions_completed": len(attempts),
        "elapsed_minutes": round(sum(attempt.server_elapsed_ms for attempt in attempts) / 60_000, 1),
        "explanation_accuracy": (
            round(sum(explanation_scores) / len(explanation_scores) * 100)
            if explanation_scores
            else None
        ),
        "skills": _skill_breakdown(attempts),
        "sections": sections,
        "omitted": max(0, session.total_items - len(attempts)),
        "confidence": {
            "average": round(sum(confidence_values) / len(confidence_values), 1) if confidence_values else None,
            "high_confidence_errors": sum(not attempt.is_correct for attempt in high_confidence),
            "high_confidence_attempts": len(high_confidence),
        },
        "timing_compromised": any(attempt.session_item.timer_compromised for attempt in attempts),
    }
    # A promotion is granted once and recorded on the run that earned it. This
    # function is called again whenever a summary is refreshed, so carry it
    # across rather than dropping the one field that is not recomputable.
    promotion = (session.summary_json or {}).get("promotion")
    if promotion:
        summary["promotion"] = promotion
    return summary


def performance_snapshot(user: User) -> dict:
    attempts = (
        Attempt.query.filter_by(user_id=user.id)
        .join(SessionItem)
        .options(
            joinedload(Attempt.session_item).joinedload(SessionItem.question),
        )
        .order_by(Attempt.created_at.asc())
        .all()
    )

    def summarize(values: list[Attempt]) -> dict:
        reasoning = [attempt.explanation_score * 100 for attempt in values if attempt.explanation_score is not None]
        pace_values = [attempt for attempt in values if not attempt.session_item.timer_compromised]
        pace_hits = [
            attempt.server_elapsed_ms <= attempt.session_item.target_time_seconds * 1000
            for attempt in pace_values
        ]
        return {
            "attempts": len(values),
            "accuracy": round(sum(attempt.is_correct for attempt in values) / max(1, len(values)) * 100),
            "average_seconds": round(sum(attempt.server_elapsed_ms for attempt in pace_values) / max(1, len(pace_values)) / 1000),
            "pace_adherence": round(sum(pace_hits) / max(1, len(pace_hits)) * 100),
            "reasoning": round(sum(reasoning) / len(reasoning)) if reasoning else None,
        }

    # One first attempt per question prevents memorized repeats from inflating the
    # headline evidence while review attempts remain available in their own class.
    first_by_question: dict[str, Attempt] = {}
    for attempt in attempts:
        first_by_question.setdefault(attempt.session_item.question_id, attempt)
    first_attempts = list(first_by_question.values())
    overall = summarize(first_attempts)
    recent = summarize(attempts[-20:])
    previous = summarize(attempts[-40:-20]) if len(attempts) > 20 else None
    reasoning_value = overall["reasoning"] if overall["reasoning"] is not None else 0
    overall["speedrun_index"] = round(overall["accuracy"] * .55 + reasoning_value * .25 + overall["pace_adherence"] * .20)
    has_comparison = bool(previous and previous["attempts"])
    overall["accuracy_delta"] = recent["accuracy"] - previous["accuracy"] if has_comparison else None
    overall["pace_delta"] = recent["pace_adherence"] - previous["pace_adherence"] if has_comparison else None
    overall["average_seconds_delta"] = previous["average_seconds"] - recent["average_seconds"] if has_comparison else None
    overall["reasoning_delta"] = (
        recent["reasoning"] - previous["reasoning"]
        if has_comparison and recent["reasoning"] is not None and previous["reasoning"] is not None
        else None
    )
    overall["evidence"] = "baseline" if len(attempts) < 10 else "emerging" if len(attempts) < 30 else "directional" if len(attempts) < 80 else "stable"

    grouped: dict[str, list[Attempt]] = defaultdict(list)
    for attempt in first_attempts:
        grouped[attempt.session_item.question.question_type].append(attempt)
    skills = []
    for name, values in grouped.items():
        skill = summarize(values)
        skill["name"] = name
        skill["priority"] = round(skill["accuracy"] * .65 + (skill["reasoning"] or 0) * .2 + skill["pace_adherence"] * .15)
        skills.append(skill)
    skills.sort(key=lambda skill: (skill["priority"], -skill["attempts"], skill["name"]))

    sessions = (
        StudySession.query.filter(
            StudySession.user_id == user.id,
            StudySession.status == "completed",
            StudySession.mode.in_(["practice", "diagnostic"]),
        )
        .order_by(StudySession.completed_at.desc())
        .limit(10)
        .all()
    )
    trend = []
    for session in reversed(sessions):
        summary = session.summary_json or calculate_session_summary(session)
        trend.append(
            {
                "id": session.id,
                "kind": session.mode,
                "date": _iso_utc(session.completed_at),
                "accuracy": summary.get("accuracy", 0),
                "reasoning": summary.get("explanation_accuracy"),
                "questions": summary.get("questions_completed", 0),
                "minutes": summary.get("elapsed_minutes", 0),
            }
        )

    latest_diagnostic = (
        StudySession.query.filter_by(user_id=user.id, mode="diagnostic", status="completed")
        .order_by(StudySession.completed_at.desc())
        .first()
    )
    diagnostic = None
    if latest_diagnostic:
        summary = latest_diagnostic.summary_json or calculate_session_summary(latest_diagnostic)
        elapsed_minutes = summary.get("elapsed_minutes", 0)
        diagnostic = {
            "session_id": latest_diagnostic.id,
            "completed_at": _iso_utc(latest_diagnostic.completed_at),
            "summary": summary,
            "raw_correct": summary.get("correct", 0),
            "raw_total": summary.get("questions_completed", 0),
            "form_total": latest_diagnostic.total_items,
            "form_accuracy": summary.get("form_accuracy"),
            "sections": summary.get("sections", []),
            "promotion": summary.get("promotion"),
            # One clock means pace is a property of the sitting, not of any one
            # question: how much of the budget went out, and how much of the
            # paper it bought.
            "time_limit_minutes": latest_diagnostic.target_minutes,
            "elapsed_minutes": elapsed_minutes,
            "budget_used_percent": round(100 * elapsed_minutes / max(1, latest_diagnostic.target_minutes)),
            "completion_percent": round(
                100 * summary.get("questions_completed", 0) / max(1, latest_diagnostic.total_items)
            ),
            "projection_available": False,
            "projection_note": "A scaled score is withheld until the form has a validated conversion.",
        }

    by_evidence: dict[str, list[Attempt]] = defaultdict(list)
    for attempt in attempts:
        by_evidence[attempt.evidence_class].append(attempt)
    evidence_classes = {name: summarize(values) for name, values in by_evidence.items()}
    # The diagnostic pays nothing and prompts nothing, so it is the only surface
    # the economy and the strategy prompts cannot reach. Everything else is
    # coached practice and reports in its own panel, where the cash incentive on
    # every question is a known property of the number rather than a hidden one.
    test_values = [attempt for attempt in first_attempts if attempt.evidence_class == "diagnostic"]
    test_performance = summarize(test_values)
    coached_practice = summarize(
        [attempt for attempt in first_attempts if attempt.evidence_class == "coached_practice"]
    )
    lr_samples = sum(attempt.session_item.question.section == "Logical Reasoning" for attempt in test_values)
    rc_samples = sum(attempt.session_item.question.section == "Reading Comprehension" for attempt in test_values)
    completed_diagnostics = StudySession.query.filter_by(user_id=user.id, mode="diagnostic", status="completed").count()
    readiness_status = "ready" if lr_samples >= 40 and rc_samples >= 20 and completed_diagnostics else "forming"
    queue = review_queue_snapshot(user)
    review_values = [attempt for attempt in attempts if attempt.session_item.from_review_queue]
    review_recovery = round(sum(value.is_correct for value in review_values) / len(review_values) * 100) if review_values else None
    confidence_values = [attempt for attempt in first_attempts if attempt.confidence is not None]
    high_confidence = [attempt for attempt in confidence_values if (attempt.confidence or 0) >= 4]
    confidence = {
        "average": round(sum(attempt.confidence or 0 for attempt in confidence_values) / len(confidence_values), 1) if confidence_values else None,
        "high_confidence_error_rate": round(sum(not attempt.is_correct for attempt in high_confidence) / len(high_confidence) * 100) if high_confidence else None,
        "sample": len(confidence_values),
    }
    recommendation_skill = next((skill for skill in skills if skill["attempts"] >= 3), None)
    strategy_lab = strategy_performance(user.id)
    focus_detail = diagnostic_focus_detail(user.id)
    focus = {
        "types": focus_detail["types"],
        "session_id": focus_detail["session_id"],
        "completed_at": _iso_utc(focus_detail["completed_at"]) if focus_detail["completed_at"] else None,
        "baseline_accuracy": focus_detail["baseline_accuracy"],
        "explanation": (
            "Your last mega-litigation came in under its own average on "
            + _join_types(focus_detail["types"])
            + ". Most of each new case run is drawn from those, and their strategy trials keep testing "
            "approaches for longer before settling."
            if focus_detail["types"]
            else "Finish a mega-litigation and practice will start weighting itself toward whatever it "
            "shows you are weakest at."
        ),
    }

    # The attempt list is handed over rather than re-read: this function has
    # already paid for every row the projection needs.
    projection = projection_snapshot(user, attempts=attempts)
    return {
        "overall": overall,
        "recent": recent,
        "skills": skills,
        "trend": trend,
        "projection": projection,
        "trial": trial_plan(user, projection=projection, profile=user.game_profile),
        "diagnostic": diagnostic,
        "test_performance": test_performance,
        "coached_practice": coached_practice,
        "evidence_classes": evidence_classes,
        "readiness": {
            "status": readiness_status,
            "lr_samples": lr_samples,
            "rc_samples": rc_samples,
            "completed_diagnostics": completed_diagnostics,
        },
        "review": {**queue, "recovery_rate": review_recovery},
        "confidence": confidence,
        "strategy_lab": strategy_lab,
        "focus": focus,
        "recommendation": (
            {
                "skill": recommendation_skill["name"],
                "accuracy": recommendation_skill["accuracy"],
                "reason": "lowest combined accuracy, reasoning, and pace signal",
            }
            if recommendation_skill
            else None
        ),
    }
