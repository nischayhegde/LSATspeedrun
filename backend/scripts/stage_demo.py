"""Stage-prep for the pitch: pin the demo question and remove every wait.

`seed_demo.py` builds a believable *account* — history, skill rollups, an
advanced firm. This script does the last mile for a four-minute talk, where
live demo seconds are the most expensive thing in the deck. It:

  1. Pins the case question by id, so every rehearsal and the talk itself
     surface the same stem, the same credited answer, and the same strategy.
     `create_study_session` is adaptive by design; the seeder re-rolls sessions
     until one happens to carry a strategy trial. Neither is safe on stage.
  2. Pre-pastes the student reasoning into the draft, so nobody types in front
     of an audience. The text is deliberately genuine-sounding: the coaching
     model has to have something interesting to say about it.
  3. Downgrades the strategy gate from "full" to "light". The full gate hides
     the answer choices until a prediction is typed, which is exactly the
     on-stage typing we are eliminating. "light" keeps the real strategy card
     visible — the audience still sees the mechanic — but unlocks the choices.
  4. Pre-grades a twin attempt on the same question through the *real* coaching
     pipeline, and stores the result. Explanation grading is a 20-30 second
     frontier-model call; `routes.py` returns `feedback_json["coaching"]`
     verbatim when `coaching_status == "completed"`, so a pre-grade turns the
     payoff beat into a database read. The audience sees the real feedback UI
     rendering real model output, with no live call to lose.

Local only, idempotent, and safe to run between rehearsals: every run rewinds
the open case session to its pre-answer state.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app import create_app  # noqa: E402
from app.coaching import generate_attempt_coaching  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models import Attempt, Question, SessionItem, StudySession, User, utcnow  # noqa: E402
from app.services import (  # noqa: E402
    create_study_session,
    find_resumable_session,
    serialize_item,
)
from app.strategies import STRATEGIES  # noqa: E402

# The account the deck's browser is logged into on stage. This is the account
# that owns the open case session `/v1/study-sessions/current` resolves to, so
# staging any other account changes nothing the audience will see.
DEFAULT_EMAIL = "student@localhost.test"

# The pinned case question. An Assumption stem whose credited answer is a
# single clean necessary-assumption gap, which is what makes it explicable in
# one spoken sentence: the argument moves from "discoveries drive development"
# to "forecasts of such societies are untrustworthy", and that move only works
# if the discoveries themselves resist forecasting.
DEMO_QUESTION_ID = "hf-lsat-lr:199809_3-LR2_8_9"

# `prephrase` carries the shortest gate in the catalogue — one text field,
# rather than the multi-step boxing and negation sequences — so the scratchpad
# step cannot eat the clock even if it is exercised.
DEMO_STRATEGY_KEY = "prephrase"

# Marks the pre-graded twin attempt so a rerun can find and replace it.
STAGE_VERDICT_KEY = "stage:verdict:"

# Pre-pasted student reasoning. Deliberately written in a first-person,
# thinking-out-loud voice rather than the tidy voice of a published explanation:
# the grader penalises reasoning that reads as a memorised sample ("cannot count
# as an independent justification"), and a textbook-shaped paragraph scores in
# the twenties no matter how correct it is. This version reaches C by its own
# route, records a genuine near-miss on A, and leaves one hand-wavy joint (the
# dismissal of E) for the coaching model to catch, so the feedback on stage is
# substantive rather than a victory lap. Over the 120-character API floor.
DEMO_REASONING = (
    "Okay, the author's move is: discoveries shape how a society turns out, therefore "
    "forecasts about societies with frequent discovery are especially shaky. I kept "
    "getting stuck on \"especially\" - plenty of things shape societies, so what makes "
    "discovery different? It has to be that we can't see it coming. If someone could hand "
    "me a reliable list of the next twenty breakthroughs, a high-discovery society would "
    "be easier to forecast, not harder. So the author is quietly leaning on us not being "
    "able to forecast the discoveries themselves. That's C. I almost took A because "
    "harmful consequences felt relevant, but the argument is about whether predictions can "
    "be trusted, not whether they hurt anyone. E felt close too, but it's a comparison "
    "between two societies and I don't think the author needs one."
)


def _assert_local_only(app) -> None:
    """Refuse to touch anything that is not an obvious local database."""
    url = db.engine.url
    host = (url.host or "").lower()
    if url.drivername.startswith("postgresql") and host not in {"", "localhost", "127.0.0.1"}:
        raise SystemExit(f"Refusing to stage against a non-local database host: {host!r}")
    if os.getenv("FLASK_ENV") == "production" or app.config.get("IS_PRODUCTION"):
        raise SystemExit("Refusing to stage against a production config.")


def _pinned_question(question_id: str) -> Question:
    question = Question.query.filter_by(id=question_id).first()
    if question is None:
        raise SystemExit(
            f"Pinned demo question {question_id!r} is not in this question bank. "
            "Run seed_demo.py first, or repin with --question-id."
        )
    return question


def _open_case_session(user: User) -> StudySession:
    """The in-progress session the case slide deep-links into.

    Resolved through the same helper `/v1/study-sessions/current` uses, because
    the deck resolves its session id from that endpoint at runtime. Selecting
    any other way risks staging a session the deck will never open.
    """
    session = find_resumable_session(user)
    if session is None:
        raise SystemExit("No open case session found. Run seed_demo.py --apply first.")
    return session


def _pending_item(session: StudySession) -> SessionItem:
    """The first unanswered item — not `current_index`, which counts answers."""
    item = (
        SessionItem.query.filter_by(session_id=session.id, completed_at=None)
        .order_by(SessionItem.position)
        .first()
    )
    if item is None:
        raise SystemExit(f"Session {session.id} has no unanswered item left.")
    return item


def _rewind(item: SessionItem) -> None:
    """Return a served item to its pre-answer state.

    Rehearsals consume the seeded state: the case gets answered, the timer
    runs. Clearing the attempt and the timing fields is what makes this script
    runnable in a loop rather than once.
    """
    if item.attempt:
        db.session.delete(item.attempt)
    item.completed_at = None
    item.active_elapsed_ms = 0
    item.timer_started_at = None
    item.timer_activated_at = None
    item.paused_at = None
    item.timer_compromised = False


def _stage_open_case(user: User, question: Question) -> dict:
    """The screen the audience sees first: question up, reasoning already in."""
    session = _open_case_session(user)
    item = _pending_item(session)
    _rewind(item)

    item.question_id = question.id
    item.requires_reasoning = True
    item.strategy_key = DEMO_STRATEGY_KEY
    item.strategy_variant = "prompt"
    item.target_time_seconds = 150
    session.pending_attempt_id = None
    session.status = "in_progress"
    db.session.commit()

    # Serving freezes the item and computes the gate. Do it here, from a
    # script, so the enforcement level cannot be recomputed by a mastery change
    # when the page is opened on stage — then overwrite what serving chose.
    item.served_at = None
    serialize_item(item)
    item.strategy_enforcement_level = "light"
    item.draft_reasoning_text = DEMO_REASONING
    item.draft_selected_label = None
    item.draft_updated_at = utcnow()
    # Serving started the clock. The presenter should walk up to a fresh timer.
    item.timer_started_at = None
    item.timer_activated_at = None
    item.active_elapsed_ms = 0
    db.session.commit()

    return {
        "session_id": session.id,
        "item_id": item.id,
        "position": item.position,
        "route": f"/cases/{session.id}",
        "strategy_enforcement_level": item.strategy_enforcement_level,
        "reasoning_chars": len(DEMO_REASONING),
    }


def _stage_graded_twin(user: User, question: Question, *, live_model: bool) -> dict:
    """A completed session whose verdict is already in the database.

    The verdict beat is the deck's payoff and its biggest latency risk. Rather
    than submit live and wait on the model, the same question is answered and
    graded here, ahead of time, so the review screen is a read.
    """
    # StudySession carries no free-text marker, so previous twins are found by
    # the idempotency key their attempt was written with.
    for stale_attempt in Attempt.query.filter(
        Attempt.user_id == user.id,
        Attempt.idempotency_key.like(f"{STAGE_VERDICT_KEY}%"),
    ).all():
        stale_item = stale_attempt.session_item
        if stale_item is not None:
            stale_session = StudySession.query.get(stale_item.session_id)
            if stale_session is not None:
                db.session.delete(stale_session)
    db.session.commit()

    session = create_study_session(user, count=1, practice_style="cases")
    item = _pending_item(session)
    item.question_id = question.id
    item.requires_reasoning = True
    item.strategy_key = DEMO_STRATEGY_KEY
    item.strategy_variant = "prompt"
    db.session.commit()
    serialize_item(item)

    elapsed = 96_000
    item.active_elapsed_ms = elapsed
    item.timer_started_at = None
    item.completed_at = utcnow()
    attempt = Attempt(
        user_id=user.id,
        session_item_id=item.id,
        idempotency_key=f"{STAGE_VERDICT_KEY}{session.id}",
        selected_label=question.correct_answer,
        is_correct=True,
        confidence=4,
        reasoning_text=DEMO_REASONING,
        strategy_key=DEMO_STRATEGY_KEY,
        strategy_variant="prompt",
        strategy_applied=True,
        strategy_prompt_ms=0,
        server_elapsed_ms=elapsed,
        client_elapsed_ms=elapsed,
        coaching_status="pending",
    )
    db.session.add(attempt)
    db.session.commit()

    graded = {"mechanism": "skipped", "grade": None}
    if live_model:
        payload, meta = generate_attempt_coaching(attempt)
        attempt.feedback_json = {
            "correct_answer": question.correct_answer,
            "selected_answer": attempt.selected_label,
            "is_correct": attempt.is_correct,
            "coaching": payload,
        }
        attempt.coaching_status = "completed"
        attempt.coaching_model = meta.get("model") or "stage-pregrade"
        attempt.coached_at = utcnow()
        graded = {
            "mechanism": "pre-generated by the real coaching pipeline, stored on the attempt",
            "grade": payload.get("explanation_grade"),
            "verdict": payload.get("reasoning_verdict"),
            "model": attempt.coaching_model,
        }

    # Not "completed": a completed session serves no item, so opening its URL
    # lands on a summary rather than on the verdict. `serialize_session` returns
    # `pending_result` for any session with a `pending_attempt_id`, whatever its
    # status — so a *paused* session holding this attempt renders exactly the
    # post-submit verdict screen, with the coaching already in the payload.
    # Paused rather than in_progress because only one run may be in_progress,
    # and that one has to stay the open case the presenter answers in.
    session.status = "paused"
    session.current_index = 1
    session.pending_attempt_id = attempt.id
    db.session.commit()

    return {
        "session_id": session.id,
        "attempt_id": attempt.id,
        "route": f"/cases/{session.id}",
        "coaching": graded,
    }


def _answer_key(question: Question, open_case: dict, twin: dict) -> dict:
    strategy = STRATEGIES[DEMO_STRATEGY_KEY]
    return {
        "question_id": question.id,
        "question_type": question.question_type,
        "stem": question.stem,
        "correct_answer": question.correct_answer,
        "strategy_key": DEMO_STRATEGY_KEY,
        "strategy_name": strategy.get("name"),
        "strategy_short": strategy.get("short_label") or strategy.get("imperative"),
        "open_case_route": open_case["route"],
        "verdict_route": twin["route"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Pin the demo question, pre-paste reasoning, and pre-grade the verdict."
    )
    parser.add_argument("--email", default=DEFAULT_EMAIL)
    parser.add_argument("--question-id", default=DEMO_QUESTION_ID)
    parser.add_argument(
        "--no-model",
        action="store_true",
        help="Skip the one-time coaching call (leaves the verdict ungraded).",
    )
    parser.add_argument("--apply", action="store_true", help="Write the changes.")
    args = parser.parse_args()

    app = create_app({"AUTO_SEED": False})
    with app.app_context():
        _assert_local_only(app)
        user = User.query.filter_by(email=args.email).first()
        if user is None:
            raise SystemExit(f"No local demo user {args.email!r}. Run seed_demo.py --apply.")
        question = _pinned_question(args.question_id)

        if not args.apply:
            print(json.dumps(
                {
                    "email": args.email,
                    "question": {
                        "id": question.id,
                        "type": question.question_type,
                        "correct_answer": question.correct_answer,
                    },
                    "strategy": DEMO_STRATEGY_KEY,
                    "next": "Re-run with --apply to stage the demo.",
                },
                indent=2,
            ))
            return 0

        # Order matters: `create_study_session` pauses every other active
        # practice run, and a paused session serves no pending item — the
        # presenter would have to click "Resume" on stage. Build the twin
        # first, then stage the open case so it ends up in_progress.
        twin = _stage_graded_twin(user, question, live_model=not args.no_model)
        open_case = _stage_open_case(user, question)
        print(json.dumps(
            {
                "answer_key": _answer_key(question, open_case, twin),
                "open_case": open_case,
                "verdict": twin,
            },
            indent=2,
            default=str,
        ))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
