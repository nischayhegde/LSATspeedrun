"""Inspect or repair the staged live strategy-trial session.

The demo leaves one Infinite session parked on the question that carries the
strategy brief. This reports that session's state and can reset it back to
"parked" if a previous run of the demo advanced or closed it.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app  # noqa: E402
from app.models import Attempt, SessionItem, StudySession, User, db  # noqa: E402

DEFAULT_EMAIL = "student@localhost.test"
TRIAL_POSITION = 2


def _describe(session: StudySession) -> dict:
    items = (
        SessionItem.query.filter_by(session_id=session.id)
        .order_by(SessionItem.position)
        .all()
    )
    return {
        "id": session.id,
        "practice_style": session.practice_style,
        "status": session.status,
        "current_index": session.current_index,
        "total_items": session.total_items,
        "ended_by_user": session.ended_by_user,
        "completed_at": session.completed_at,
        "results_seen_at": session.results_seen_at,
        "pending_attempt_id": session.pending_attempt_id,
        "items": [
            {
                "position": item.position,
                "variant": item.strategy_variant,
                "key": item.strategy_key,
                "answered": item.completed_at is not None,
                "timer_started_at": item.timer_started_at,
            }
            for item in items
        ],
    }


def _find(user: User, session_id: str | None) -> StudySession | None:
    if session_id:
        return StudySession.query.filter_by(id=session_id, user_id=user.id).first()
    # The staged run is the newest Infinite session carrying a prompt at the
    # trial position.
    candidates = (
        StudySession.query.filter_by(user_id=user.id, practice_style="infinite")
        .order_by(StudySession.started_at.desc())
        .all()
    )
    for session in candidates:
        item = SessionItem.query.filter_by(
            session_id=session.id, position=TRIAL_POSITION
        ).first()
        if item and item.strategy_variant == "prompt":
            return session
    return None


def repair(session: StudySession) -> list[str]:
    """Park the session on the trial question again."""
    changes: list[str] = []

    # `find_resumable_session` returns the newest open practice session, so any
    # other open run would hijack "Continue current run" and the post-login
    # redirect. The staged session has to be the only candidate.
    for other in StudySession.query.filter(
        StudySession.user_id == session.user_id,
        StudySession.mode == "practice",
        StudySession.id != session.id,
    ).all():
        if other.status in {"in_progress", "paused"} or other.pending_attempt_id:
            db.session.delete(other)
            changes.append(f"deleted rival open session {other.id} ({other.practice_style})")

    if session.status != "in_progress":
        changes.append(f"status {session.status} -> in_progress")
        session.status = "in_progress"
    if session.completed_at is not None:
        changes.append("cleared completed_at")
        session.completed_at = None
    if session.results_seen_at is not None:
        changes.append("cleared results_seen_at")
        session.results_seen_at = None
    if session.summary_seen_at is not None:
        changes.append("cleared summary_seen_at")
        session.summary_seen_at = None
    if session.summary_json is not None:
        changes.append("cleared summary_json")
        session.summary_json = None
    if session.ended_by_user:
        changes.append("cleared ended_by_user")
        session.ended_by_user = False
    if session.pending_attempt_id is not None:
        changes.append("cleared pending_attempt_id")
        session.pending_attempt_id = None

    # Drop anything answered at or past the trial position so the brief is
    # unseen again, then re-park the cursor.
    for item in SessionItem.query.filter(
        SessionItem.session_id == session.id,
        SessionItem.position >= TRIAL_POSITION,
    ).all():
        attempt = Attempt.query.filter_by(session_item_id=item.id).first()
        if attempt is not None:
            db.session.delete(attempt)
            changes.append(f"deleted attempt at position {item.position}")
        if item.completed_at is not None:
            item.completed_at = None
            changes.append(f"reopened position {item.position}")
        item.timer_started_at = None
        item.active_elapsed_ms = 0
        item.draft_selected_label = None
        item.draft_reasoning_text = None
        item.draft_updated_at = None

    if session.current_index != TRIAL_POSITION:
        changes.append(f"current_index {session.current_index} -> {TRIAL_POSITION}")
        session.current_index = TRIAL_POSITION
    if session.total_items <= TRIAL_POSITION:
        session.total_items = max(session.total_items, TRIAL_POSITION + 6)
        changes.append(f"total_items -> {session.total_items}")

    db.session.commit()
    return changes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", default=DEFAULT_EMAIL)
    parser.add_argument("--session-id", default=None)
    parser.add_argument("--repair", action="store_true", help="Re-park the session.")
    args = parser.parse_args()

    app = create_app({"AUTO_SEED": False})
    with app.app_context():
        user = User.query.filter_by(email=args.email).one()
        session = _find(user, args.session_id)
        if session is None:
            print("no staged infinite trial session found")
            return 1
        if args.repair:
            changes = repair(session)
            print("repairs:", changes or "none needed")
        state = _describe(session)
        for key, value in state.items():
            if key == "items":
                continue
            print(f"{key}: {value}")
        for item in state["items"]:
            print("  ", item)
        print()
        print("other open sessions:")
        for other in StudySession.query.filter(
            StudySession.user_id == user.id,
            StudySession.status.in_(["in_progress", "paused"]),
            StudySession.id != session.id,
        ).all():
            print(
                f"   {other.id} {other.practice_style} {other.status} "
                f"idx={other.current_index}"
            )
        print(f"\nurl: http://localhost:5173/cases/{session.id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
