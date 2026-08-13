"""The last mega-litigation's weak types, as a sitting report.

Practice selection no longer reads this module. `type_focus.rolling_focus`
is what `services.create_study_session` and `strategies.assign_strategy_trial`
consult: every first encounter, recency-weighted, compared to the rest of its
own section. This file still turns one completed mega-litigation into a short
list of types, because a student who has just sat one wants to know what that
form said. That list is a report of the sitting, not a statement about what
the next case run will contain.

It imports models and nothing else. `services` already imports `strategies`, so
a shared helper living in either of them would close an import cycle.
"""

from __future__ import annotations

from collections import defaultdict

from .models import Attempt, Question, SessionItem, StudySession


# Enough of a sample that one unlucky question cannot brand a type a weakness,
# and few enough types that practice still covers the rest of the test.
MIN_TYPE_ATTEMPTS = 2
MAX_FOCUS_TYPES = 5


def _latest_completed_diagnostic(user_id: str) -> StudySession | None:
    return (
        StudySession.query.filter_by(user_id=user_id, mode="diagnostic", status="completed")
        .order_by(StudySession.completed_at.desc())
        .first()
    )


def diagnostic_focus_detail(user_id: str) -> dict:
    """The weak question types from the student's latest mega-litigation.

    A type qualifies when it was answered at least `MIN_TYPE_ATTEMPTS` times and
    came in below the accuracy of the run as a whole. Measuring against the run
    rather than a fixed bar keeps the list meaningful at both ends: a strong
    student still gets their relatively weakest types, and a struggling one is
    not handed every type they saw.
    """
    session = _latest_completed_diagnostic(user_id)
    if not session:
        return {"types": [], "session_id": None, "completed_at": None, "baseline_accuracy": None}

    # Two columns, joined in the database. Loading mapped `Attempt` rows and
    # walking `.session_item.question` to reach the type instead cost two lazy
    # statements per answer: 162 of the 174 statements `GET /performance` issued
    # on a 77-item form came from this loop, and `select_random_questions` and
    # `assign_strategy_trial` pay the same bill every time a question is served.
    rows = (
        Attempt.query.with_entities(Attempt.is_correct, Question.question_type)
        .join(SessionItem, Attempt.session_item_id == SessionItem.id)
        .join(Question, Question.id == SessionItem.question_id)
        .filter(SessionItem.session_id == session.id)
        .all()
    )
    if not rows:
        return {"types": [], "session_id": session.id, "completed_at": session.completed_at, "baseline_accuracy": None}

    baseline = sum(row.is_correct for row in rows) / len(rows)
    grouped: dict[str, list[bool]] = defaultdict(list)
    for row in rows:
        grouped[row.question_type].append(row.is_correct)

    scored = [
        (sum(values) / len(values), -len(values), name)
        for name, values in grouped.items()
        if len(values) >= MIN_TYPE_ATTEMPTS
    ]
    weak = sorted(entry for entry in scored if entry[0] < baseline)
    return {
        "types": [name for _accuracy, _size, name in weak[:MAX_FOCUS_TYPES]],
        "session_id": session.id,
        "completed_at": session.completed_at,
        "baseline_accuracy": round(baseline * 100),
    }


def diagnostic_focus(user_id: str) -> list[str]:
    return diagnostic_focus_detail(user_id)["types"]
