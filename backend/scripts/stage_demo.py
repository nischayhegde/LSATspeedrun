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
  5. Stages a single-question run that the in-app driver plays end to end —
     strategy applied, question read, reasoning already written, answer in,
     graded feedback back — with its attempt pre-answered and pre-graded, so
     the one slide that carries the whole product loop has no model call in it.
     See `_stage_solo_case` for why the attempt exists before the demo submits.
  6. Stages a separate fifteen-question run for the in-app autoplay driver and
     prints its credited answers, which is the one thing the client is never
     sent (`serialize_question` omits it on purpose). `prepare-demo.mjs` pins
     that key into `deck/demo.config.ts`, and the driver is handed it in the
     iframe URL — so a demo can answer fifteen real questions through the real
     endpoints without anyone touching the keyboard.

Local only, idempotent, and safe to run between rehearsals: every run rewinds
the open case, the solo case and the autoplay run to their pre-answer state.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import defaultdict
from datetime import timedelta
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import func  # noqa: E402

from app import create_app  # noqa: E402
from app.coaching import CoachingProviderError, generate_attempt_coaching  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models import (  # noqa: E402
    Attempt,
    Question,
    QuestionChoice,
    ReviewQueueItem,
    SessionItem,
    StudySession,
    User,
    utcnow,
)
from app.seed import SOURCE_PREFIX  # noqa: E402
from app.services import (  # noqa: E402
    _feedback,
    create_study_session,
    find_resumable_session,
    list_resumable_sessions,
    run_attempt_coaching,
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

# Marks the pre-graded attempt behind the one-question driven sequence.
STAGE_SOLO_KEY = "stage:solo:"

# What the solo case reports as its own elapsed time. A plausible working pace
# for one Assumption question with written reasoning — the number the case
# timer and the fee calculation both read, so it has to look like a person
# rather than like a script.
SOLO_ELAPSED_MS = 108_000

# How many questions the in-app autoplay driver answers unattended. Fifteen is
# the top of the range the driver was built for: long enough that the room stops
# watching the mechanism and starts watching the product, short enough to sit
# inside a talk that is about five minutes long.
AUTOPLAY_ITEM_COUNT = 15

# How much text one autoplay question may carry. The deck gives the app a
# 1250x781 logical viewport (measured off the running deck, not assumed), and
# the driver's reading beat has to put the stimulus, the stem and all five
# choices on screen together — a question the room is still reading when the app
# answers it proves nothing. Measured against the bank: 866 of the 4,520 Logical
# Reasoning questions clear both bounds, spread across all eleven question
# types, so this is a comfortable filter rather than a scrape of the shortest
# outliers.
AUTOPLAY_MAX_PROMPT_CHARS = 620
AUTOPLAY_MAX_CHOICE_CHARS = 430

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


def _open_case_session(user: User, *, avoid_ids: set[str] | None = None) -> StudySession:
    """The in-progress session the case slide deep-links into.

    Resolved through the same helper `/v1/study-sessions/current` uses, because
    the deck resolves its session id from that endpoint at runtime. Selecting
    any other way risks staging a session the deck will never open.

    `avoid_ids` holds this script's other two staged runs, and excluding them is
    load-bearing rather than defensive. Creating the twin pauses every other
    practice run, so by the time this runs nothing is `in_progress` and the
    helper falls back to the most recent resumable session — which is one of
    them. Staging the open case on top of the twin would clear the very
    `pending_attempt_id` that makes the verdict slide a read instead of a live
    model call; staging it on top of the autoplay run would hand the presenter's
    slide a fifteen-question drill with no reasoning box.
    """
    avoid = avoid_ids or set()
    session = find_resumable_session(user)
    if session is not None and session.id in avoid:
        session = next(
            (other for other in list_resumable_sessions(user) if other.id not in avoid),
            None,
        )
    if session is None:
        raise SystemExit("No open case session found. Run seed_demo.py --apply first.")
    return session


def _pending_item(session: StudySession, *, or_last_answered: bool = False) -> SessionItem:
    """The first unanswered item — not `current_index`, which counts answers.

    `or_last_answered` falls back to the most recently answered item when the
    session has none left. That is the whole point of `_rewind`: a rehearsal that
    reaches the end of the seeded session would otherwise leave this script with
    nothing to stage, and "run it again before the next rehearsal" has to work
    every time, not just the first time. The caller rewinds whatever it gets, so
    an answered item is as good as a fresh one.
    """
    item = (
        SessionItem.query.filter_by(session_id=session.id, completed_at=None)
        .order_by(SessionItem.position)
        .first()
    )
    if item is None and or_last_answered:
        item = (
            SessionItem.query.filter_by(session_id=session.id)
            .order_by(SessionItem.position.desc())
            .first()
        )
    if item is None:
        raise SystemExit(
            f"Session {session.id} has no items at all. Run seed_demo.py --apply first."
        )
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


def _silence_guided_tour(user: User) -> bool:
    """Mark the demo account as already oriented.

    The app's 21-step guided tour opens for any account that has never finished
    it, and inside a demo slide's iframe it opens *over* the thing being
    demonstrated. It was suppressed by having the presenter paste a localStorage
    key into devtools by hand — which is per-browser-profile invisible state, so
    it silently stopped working on a fresh profile, another browser, or a borrowed
    laptop, and the failure landed on stage.

    `GuidedTour` checks `oriented || dismissed`: the server's
    `guided_tour_completed` or the local key. Setting the server side fixes it for
    every browser at once and needs nobody to remember anything.

    Idempotent: returns whether it had to change anything.
    """
    if user.guided_tour_completed_at is not None:
        return False
    user.guided_tour_completed_at = utcnow()
    db.session.commit()
    return True


def _stage_open_case(user: User, question: Question, *, avoid_ids: set[str] | None = None) -> dict:
    """The screen the audience sees first: question up, reasoning already in."""
    session = _open_case_session(user, avoid_ids=avoid_ids)
    item = _pending_item(session, or_last_answered=True)
    _rewind(item)

    item.question_id = question.id
    item.requires_reasoning = True
    item.strategy_key = DEMO_STRATEGY_KEY
    item.strategy_variant = "prompt"
    item.target_time_seconds = 150
    session.pending_attempt_id = None
    session.status = "in_progress"
    # The API only treats an item as the live one when its position matches
    # `current_index` (see `app/routes.py` and `app/services.py`), so rewinding an
    # already-answered item is not enough on its own — without this the case opens
    # read-only and the presenter cannot click anything.
    session.current_index = item.position
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
    # `--no-model` means "do not spend 20-40s on the model", and it used to be
    # implemented as "build a fresh twin and skip the grading" — which deleted a
    # good graded verdict and replaced it with an ungraded one. That is the
    # opposite of what the flag is for: `stage-demo:fast` is the tight
    # rehearsal-loop command, documented as leaving the verdict in place, and it
    # was quietly emptying the payoff slide every time it ran. So when there is
    # already a graded twin for this question, keep it.
    if not live_model:
        for existing in Attempt.query.filter(
            Attempt.user_id == user.id,
            Attempt.idempotency_key.like(f"{STAGE_VERDICT_KEY}%"),
            Attempt.coaching_status == "completed",
        ).all():
            item = existing.session_item
            session = StudySession.query.get(item.session_id) if item else None
            if session is None or item.question_id != question.id:
                continue
            return {
                "session_id": session.id,
                "attempt_id": existing.id,
                "route": f"/cases/{session.id}",
                "coaching": {
                    "mechanism": "kept — already graded, and --no-model was asked for",
                    "grade": (existing.feedback_json or {}).get("coaching", {}).get("explanation_grade"),
                    "model": existing.coaching_model,
                },
            }

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


# The solo sequence's written case theory, and deliberately *not* the paragraph
# above.
#
# Two reasons, one of them load-bearing. The soft one: the open case and the
# solo case can end up on adjacent slides, and the same paragraph appearing
# twice reads as a template rather than as a person thinking. The hard one:
# `_is_reused_reasoning` compares an attempt's normalised reasoning against the
# user's last fifty attempts and, on a match, forces the Invalid band — zero
# fee, "this explanation repeats reasoning used on an earlier case". The
# pre-graded twin already holds `DEMO_REASONING`, so reusing it here settles the
# demo's payoff case at nothing and puts a plagiarism notice on the projector.
# Measured, not guessed: the first staging of this run did exactly that.
#
# Same voice and the same job as the other one — reaches C by its own route,
# records a real near-miss on B, and dismisses D in a line — but it leaves E
# unexamined, which is the strongest distractor on this question and is
# therefore the substantive thing the coach has to say about it.
SOLO_REASONING = (
    "The conclusion is about predictions being untrustworthy, and the only premise "
    "is that discoveries have considerable effects on how a society develops. "
    "Effects on their own don't make anything unpredictable - plenty of things have "
    "considerable effects and are still forecastable. So the argument needs the "
    "discoveries themselves to be the part nobody can forecast: if I could reliably "
    "forecast the discoveries, I could forecast the development they drive, and a "
    "prediction about that society would be no worse than any other. That is C. B "
    "tempted me for a minute because it also ties development to discovery, but B is "
    "a claim about what development requires, not about whether anyone can see the "
    "discoveries coming, and requirement is not what the conclusion trades on. D is "
    "a benefit claim and never touches prediction at all."
)


def _find_solo_case(user: User, question: Question) -> StudySession | None:
    """The one-question sequence this script staged last time.

    Found rather than rebuilt, for the same reason the driven run is: the deck
    pins this session id, and handing it a new one on every `stage-demo:fast`
    would break the slide several times an hour. Identified by the idempotency
    key its attempt carries, which is the only durable marker a StudySession
    can be given from outside the app.
    """
    for attempt in Attempt.query.filter(
        Attempt.user_id == user.id,
        Attempt.idempotency_key.like(f"{STAGE_SOLO_KEY}%"),
    ).all():
        item = attempt.session_item
        if item is None or item.question_id != question.id:
            continue
        session = StudySession.query.get(item.session_id)
        if session is not None:
            return session
    return None


def _release_attempt(attempt: Attempt) -> None:
    """Drop the spaced-review references to an attempt about to be deleted.

    SQLite runs here with foreign keys unenforced, so a deleted attempt leaves
    the review queue holding ids that resolve to nothing rather than raising.
    """
    for stale in ReviewQueueItem.query.filter(
        db.or_(
            ReviewQueueItem.last_attempt_id == attempt.id,
            ReviewQueueItem.source_attempt_id == attempt.id,
        )
    ).all():
        if stale.last_attempt_id == attempt.id:
            stale.last_attempt_id = None
        if stale.source_attempt_id == attempt.id:
            stale.source_attempt_id = None


def _stage_solo_case(user: User, question: Question) -> dict:
    """One case, staged so it can be played end to end with no model on stage.

    ## What the slide has to show

    The strategy being applied to a real question, the written case theory, an
    answer going in, and the AI's reading of that reasoning coming back. All of
    it in one continuous sequence, because splitting the submit away from its
    own verdict is what forced the deck's "do not submit on this slide" note in
    the first place.

    ## Why the attempt already exists

    Explanation grading is a 19-38 second frontier call, and there is no
    arrangement of a live submit that makes it land inside a slide. So the
    attempt is answered and graded *here*, through the real coaching pipeline,
    exactly as the verdict twin already is — and the item is then rewound to
    look untouched, so the case opens as an open case.

    Submitting on stage takes `submit_attempt`'s duplicate branch: it finds the
    attempt already on the item and hands it straight back, feedback, grade and
    settled fee included. The endpoint is real, the request is real, the
    reasoning is the reasoning on screen, and the verdict is the one the model
    actually wrote about it. The only thing that happened early is the waiting.

    ## Why the fee is settled here too

    `serialize_attempt_result` carries the settlement, and the case screen only
    calls the coaching endpoint when the submit response arrives without one.
    Settling during staging therefore removes the last request from the beat —
    the payoff renders from the submit response alone — and it stops a
    rehearsal from banking the same fee once per run-through, which would show
    up on the office slides as an account that grows every time anyone
    practises the talk.
    """
    session = _find_solo_case(user, question)
    if session is None:
        session = create_study_session(user, count=1, practice_style="cases")
    item = sorted(session.items, key=lambda entry: entry.position)[0]

    item.question_id = question.id
    item.requires_reasoning = True
    item.from_review_queue = False
    item.strategy_key = DEMO_STRATEGY_KEY
    item.strategy_variant = "prompt"
    item.target_time_seconds = 150
    session.status = "in_progress"
    session.current_index = item.position
    session.pending_attempt_id = None
    session.completed_at = None
    session.summary_json = None
    session.results_seen_at = None
    session.summary_seen_at = None
    session.ended_by_user = False
    db.session.commit()

    # Serving freezes the case terms and computes the gate. Done here, from a
    # script, so the enforcement level cannot be recomputed by a mastery change
    # when the page is opened on stage — then overwrite what serving chose.
    # "light" keeps the strategy card and its steps on screen, which is the
    # mechanic the slide is about, without hiding the choices behind a typed
    # prediction the driver would have to invent.
    item.served_at = None
    serialize_item(item)
    item.strategy_enforcement_level = "light"
    item.draft_reasoning_text = SOLO_REASONING
    item.draft_selected_label = None
    item.draft_updated_at = utcnow()
    db.session.commit()

    attempt = item.attempt
    # An attempt whose reasoning no longer matches what the page will show is a
    # grade of some other text, and its settlement is a fee for some other work.
    # Both are worse than no grade at all, because they are wrong quietly.
    if attempt is not None and (attempt.reasoning_text or "") != SOLO_REASONING:
        _release_attempt(attempt)
        db.session.delete(attempt)
        db.session.commit()
        attempt = None
    if attempt is None:
        attempt = Attempt(
            user_id=user.id,
            session_item_id=item.id,
            idempotency_key=f"{STAGE_SOLO_KEY}{session.id}",
            selected_label=question.correct_answer,
            is_correct=True,
            confidence=4,
            reasoning_text=SOLO_REASONING,
            strategy_key=DEMO_STRATEGY_KEY,
            strategy_variant="prompt",
            strategy_applied=True,
            strategy_prompt_ms=0,
            server_elapsed_ms=SOLO_ELAPSED_MS,
            client_elapsed_ms=SOLO_ELAPSED_MS,
            coaching_status="pending",
        )
        db.session.add(attempt)
        db.session.commit()

    coaching = (attempt.feedback_json or {}).get("coaching")
    mechanism = "kept — already graded, and a staged grade outlives a rehearsal"
    model = attempt.coaching_model
    if coaching is None:
        # Graded even under `--no-model`, which the twin above does not do, and
        # the difference is deliberate. `--no-model` exists so `stage-demo:fast`
        # can rewind state between run-throughs in six seconds; skipping a grade
        # that already exists costs nothing. But an *ungraded* solo case is not a
        # slower demo, it is a demo with no payoff — the slide's entire subject
        # is the feedback. Spending 20-40 seconds once, on the first staging
        # after a database rebuild, buys every later `stage-demo:fast` the fast
        # path and spares whoever is rehearsing at midnight the job of noticing
        # a flag. The grade persists; this branch runs once.
        #
        # Survivable, because it is one network call to a model that sometimes
        # returns prose where the schema wants JSON. An exception here used to
        # abort the whole script, which meant a flaky grading call left the
        # *open case* unstaged too: one slide's optional payoff taking out four
        # slides' worth of setup.
        #
        # Four tries, not two. Two consecutive refusals were observed in one
        # afternoon, and the cost of another try is a few seconds on a path that
        # runs once per database rebuild, against a payoff of not handing the
        # presenter a grading placeholder where the coach should be.
        for remaining in (3, 2, 1, 0):
            try:
                coaching, meta = generate_attempt_coaching(attempt)
                mechanism = "pre-generated by the real coaching pipeline, stored on the attempt"
                model = meta.get("model") or "stage-pregrade"
                break
            except CoachingProviderError as failure:
                mechanism = f"ungraded — the coach refused ({failure}). Re-run to try again."
                if not remaining:
                    break
                time.sleep(2)

    # Rebuilt through the app's own writer rather than assembled here, so the
    # staged attempt is shaped exactly like a live one — the choice marks and
    # the diagnosis line on the verdict screen read fields that a hand-written
    # dict would have to guess the names of.
    feedback = _feedback(question, attempt.selected_label, True, DEMO_REASONING)
    if coaching is not None:
        feedback["coaching"] = coaching
        attempt.coaching_status = "completed"
        attempt.coaching_model = model
        attempt.coached_at = utcnow()
    attempt.feedback_json = feedback
    db.session.commit()
    if coaching is not None and not attempt.settlement:
        run_attempt_coaching(attempt)

    # The settlement is computed from the grade, but not only from it: a
    # reasoning band of Invalid against a high grade means the economy refused
    # this write-up for a reason the grade cannot see — reuse, most likely. That
    # combination renders as a strong verdict beside a zero fee, which is the
    # kind of quietly incoherent screen that costs more than a missing one.
    settlement = attempt.settlement
    if settlement is not None and coaching is not None:
        graded = coaching.get("explanation_grade")
        if settlement.explanation_grade == "Invalid" and (graded or 0) >= 50:
            raise SystemExit(
                f"The solo case graded {graded} but settled as Invalid, so the demo would show "
                "a strong verdict beside a zero fee. This is what a repeated explanation looks "
                "like: check that SOLO_REASONING is not also on another attempt for this user."
            )

    # Everything above answered the case; this un-answers the *presentation* of
    # it. The attempt stays in the database — that is the point — but the item
    # stops looking finished, so `serialize_session` serves it as the live
    # question rather than as a debrief.
    item.completed_at = None
    item.active_elapsed_ms = 0
    item.timer_started_at = None
    item.timer_activated_at = None
    item.paused_at = None
    item.timer_compromised = False
    db.session.commit()

    return {
        "session_id": session.id,
        "item_id": item.id,
        "attempt_id": attempt.id,
        "route": f"/cases/{session.id}",
        "answer_key": question.correct_answer,
        "strategy_enforcement_level": item.strategy_enforcement_level,
        "reasoning_chars": len(SOLO_REASONING),
        "coaching": {
            "mechanism": mechanism,
            "grade": (coaching or {}).get("explanation_grade"),
            "verdict": (coaching or {}).get("reasoning_verdict"),
            "model": model,
        },
        "settled_payout": attempt.settlement.payout if attempt.settlement else None,
    }


def _autoplay_questions(count: int, *, exclude_ids: set[str]) -> list[Question]:
    """Short Logical Reasoning items for the driven run, one per type in turn.

    Deterministic, and ordered by id rather than sampled, because the credited
    answers are pinned into `deck/demo.config.ts` and handed to the driver in
    the iframe URL. A run that re-rolled its questions on every staging would
    invalidate that key, and a driver holding a stale key answers fifteen
    questions wrong in front of an audience — the one failure mode that looks
    like the product is broken rather than like the demo is.

    Reading Comprehension is excluded outright. An RC item drags a
    thousand-character passage into the frame, which cannot be read in the beat
    the driver has and cannot be shown at all without scrolling past the passage
    the question is about. The deck already shows a full-length case with its
    passage on the hero slide; this run is the volume, not the specimen.

    Types are taken round-robin so fifteen questions visibly cover the test
    rather than fifteen variations of one skill — which is the claim the founders
    are making while this plays.
    """
    lengths = (
        db.session.query(Question.id, Question.question_type)
        .filter(Question.source.like(f"{SOURCE_PREFIX}%"))
        .filter(Question.section == "Logical Reasoning")
        .filter(Question.passage_id.is_(None))
        .filter(
            func.coalesce(func.length(Question.stimulus), 0) + func.length(Question.stem)
            <= AUTOPLAY_MAX_PROMPT_CHARS
        )
        .order_by(Question.id)
        .all()
    )
    candidate_ids = [row.id for row in lengths if row.id not in exclude_ids]
    choices = dict(
        db.session.query(
            QuestionChoice.question_id,
            func.count(QuestionChoice.id),
        )
        .filter(QuestionChoice.question_id.in_(candidate_ids))
        .group_by(QuestionChoice.question_id)
        .all()
    )
    choice_chars = dict(
        db.session.query(
            QuestionChoice.question_id,
            func.sum(func.length(QuestionChoice.canonical_text)),
        )
        .filter(QuestionChoice.question_id.in_(candidate_ids))
        .group_by(QuestionChoice.question_id)
        .all()
    )

    by_type: dict[str, list[str]] = defaultdict(list)
    for row in lengths:
        if row.id in exclude_ids:
            continue
        if choices.get(row.id) != 5:
            continue
        if (choice_chars.get(row.id) or 0) > AUTOPLAY_MAX_CHOICE_CHARS:
            continue
        by_type[row.question_type or "Unknown"].append(row.id)

    ordered: list[str] = []
    types = sorted(by_type)
    depth = 0
    while len(ordered) < count and types:
        placed = False
        for question_type in types:
            bucket = by_type[question_type]
            if depth < len(bucket):
                ordered.append(bucket[depth])
                placed = True
                if len(ordered) == count:
                    break
        if not placed:
            break
        depth += 1

    if len(ordered) < count:
        raise SystemExit(
            f"Only {len(ordered)} questions in this bank are short enough for the autoplay run "
            f"(needed {count}). Raise AUTOPLAY_MAX_PROMPT_CHARS, or run seed_demo.py first."
        )
    found = {question.id: question for question in Question.query.filter(Question.id.in_(ordered)).all()}
    return [found[question_id] for question_id in ordered]


def _find_autoplay_run(user: User, count: int) -> StudySession | None:
    """The driven run this script staged last time, found by what it is.

    `StudySession` carries no free-text marker, so — exactly as
    `prepare-demo.mjs` identifies the pre-graded twin — this identifies the
    autoplay run structurally. `create_study_session` writes
    `requires_reasoning=True` on every practice item it ever creates, so a
    *practice* run whose items ask for no written reasoning is one this script
    built and nothing else.

    Found rather than rebuilt because the id has to survive a rehearsal. The
    answer key in `demo.config.ts` is pinned against this session id; rebuilding
    the run on every `stage-demo:fast` would hand the deck a new id and a new key
    several times an hour, and `stage-demo:fast` is precisely the command that is
    meant to be safe to run between run-throughs.
    """
    return (
        StudySession.query.join(SessionItem, SessionItem.session_id == StudySession.id)
        .filter(
            StudySession.user_id == user.id,
            StudySession.mode == "practice",
            StudySession.total_items == count,
            SessionItem.requires_reasoning.is_(False),
        )
        .order_by(StudySession.started_at.desc())
        .first()
    )


def _rewind_autoplay_run(session: StudySession) -> None:
    """Put a driven run back to question one, attempts and all.

    A rehearsal consumes the whole run — fifteen answers, fifteen settled cases,
    fifteen rows in the spaced-review queue pointing at attempts that are about
    to stop existing. Clearing the references first matters: this database is
    SQLite with foreign keys unenforced, so a deleted attempt would otherwise
    leave the review queue holding an id that resolves to nothing.
    """
    attempt_ids = [item.attempt.id for item in session.items if item.attempt]
    if attempt_ids:
        for stale in ReviewQueueItem.query.filter(
            db.or_(
                ReviewQueueItem.last_attempt_id.in_(attempt_ids),
                ReviewQueueItem.source_attempt_id.in_(attempt_ids),
            )
        ).all():
            if stale.last_attempt_id in attempt_ids:
                stale.last_attempt_id = None
            if stale.source_attempt_id in attempt_ids:
                stale.source_attempt_id = None
    for item in session.items:
        _rewind(item)
        # Serving freezes the case terms and starts the clock; both have to go,
        # or the second run-through opens on a stopwatch that is already running.
        item.served_at = None
        item.game_context_json = None
        item.draft_selected_label = None
        item.draft_reasoning_text = None
        item.draft_updated_at = None
    session.current_index = 0
    session.pending_attempt_id = None
    session.completed_at = None
    session.summary_json = None
    session.results_seen_at = None
    session.summary_seen_at = None
    session.ended_by_user = False
    db.session.commit()


def _stage_autoplay_run(user: User, *, count: int, exclude_ids: set[str]) -> dict:
    """The run the in-app driver answers unattended, with its answer key.

    Two departures from an ordinary practice run, both of them about what the
    room can see in three seconds:

      * `requires_reasoning=False`. Coached practice asks for 120 characters of
        written case theory, and there is no honest way to produce fifteen of
        those in a minute — typing them on stage is the thing this whole
        mechanism exists to remove, and pasting the same paragraph fifteen times
        would be a demo lying about its own product. Without it the entire
        interaction — stimulus, stem, five choices, confidence, submit — fits in
        one frame, so the driver never has to scroll away from the question to
        answer it. It also means the settlement pays nothing (see
        `settle_attempt`: no reasoning is an Invalid band, which earns no fee and
        no reputation), so rehearsing this run does not quietly inflate the
        tycoon account the office slides are showing.
      * No strategy trial. A prompted technique demands a Use it / Skip decision
        before the choices unlock, which is a click the driver would have to fake
        an opinion for on every question. The strategy mechanic already has the
        deck's undivided attention on the hero case slide.
    """
    session = _find_autoplay_run(user, count)
    if session is None:
        session = create_study_session(user, count=count, practice_style="cases")
        questions = _autoplay_questions(count, exclude_ids=exclude_ids)
        for item, question in zip(sorted(session.items, key=lambda entry: entry.position), questions):
            item.question_id = question.id
            item.requires_reasoning = False
            item.from_review_queue = False
            item.strategy_key = None
            item.strategy_variant = None
            item.strategy_propensity = None
            item.strategy_candidates_n = None
            item.strategy_enforcement_level = "none"
            item.target_time_seconds = 150
        db.session.commit()
    _rewind_autoplay_run(session)

    items = sorted(session.items, key=lambda entry: entry.position)
    return {
        "session_id": session.id,
        "route": f"/cases/{session.id}",
        "questions": len(items),
        # By position, which is what the driver indexes with. Position comes from
        # the server on every render, so a run that is resumed half-finished
        # stays in step instead of replaying the key from the top.
        "answer_key": "".join(item.question.correct_answer for item in items),
        "question_types": sorted({item.question.question_type for item in items}),
    }


def _park_driven_run(session_id: str, behind: StudySession, *, minutes: int) -> None:
    """Leave a driven run open, and older than the case the presenter answers.

    It has to be `in_progress`: a paused run opens on "Return to the case", and
    the only way past that is the Resume endpoint, which pauses every other run —
    which would be this script's own staged open case, on the slide before.

    Two runs being in progress at once is a state the app never creates for
    itself, so the tie-break matters. `find_resumable_session` walks the queue
    newest-first and returns the first in-progress run it meets — the most
    recently *started* one — and `/v1/study-sessions/current` is what the
    deck's preflight resolves the case slide's session from. Backdating this one
    keeps that answer pointing at the open case, which is what every other demo
    surface — the office's walk-in client, the daily docket, `next_route` — reads
    too.

    `minutes` separates the driven runs from each other as well as from the
    open case, so the ordering is total rather than a tie the database breaks
    however it likes.
    """
    session = StudySession.query.get(session_id)
    session.status = "in_progress"
    session.started_at = _aware(behind.started_at) - timedelta(minutes=minutes)
    db.session.commit()


def _surface_in_answer_log(attempt_id: str) -> None:
    """Make the driven case the newest answer this account has.

    The review slide's whole beat is "that same question, waiting in review",
    and the way it gets there is the presenter clicking the FIRST tile in the
    Answer Log. The log is newest-first by `Attempt.created_at`, so being first
    is the requirement, not a nicety.

    Left alone, it is not first. Two attempts on the pinned question are staged
    — the driven case and the graded twin — and the twin is rebuilt on every
    run while the driven case's attempt is kept once it has a grade worth
    keeping. So each `stage-demo:fast` pushes the twin above the case the room
    is about to watch. Both tiles are the same question, both are correct, and
    both open on a real reasoning-and-coaching pair: the wrong one is not
    detectable by looking at it, only by reading the reasoning and noticing it
    is not the text that was on screen thirty seconds ago. Measured, not
    theorised — the twin was on top on a live stack.

    The submit on the slide before cannot fix this, and this is the part that
    is easy to get wrong: the attempt is replayed through an idempotency key,
    so no row is written and no timestamp moves. Nothing about playing the demo
    changes the log's order. It has to be correct before the talk starts.

    Stamped explicitly rather than by shuffling the staging order, because an
    ordering that is only correct while three calls stay in one sequence is an
    ordering that breaks silently the first time somebody reorders them.
    """
    attempt = Attempt.query.get(attempt_id)
    attempt.created_at = utcnow()
    db.session.commit()


def _aware(value):
    return value if value.tzinfo else value.replace(tzinfo=utcnow().tzinfo)


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
        # presenter would have to click "Resume" on stage. Build the runs that
        # are allowed to end up paused first, then stage the open case so it
        # ends up in_progress, then re-open the driven run behind it.
        tour_silenced = _silence_guided_tour(user)
        autoplay = _stage_autoplay_run(
            user,
            count=AUTOPLAY_ITEM_COUNT,
            exclude_ids={question.id},
        )
        twin = _stage_graded_twin(user, question, live_model=not args.no_model)
        solo = _stage_solo_case(user, question)
        open_case = _stage_open_case(
            user,
            question,
            avoid_ids={twin["session_id"], autoplay["session_id"], solo["session_id"]},
        )
        if open_case["session_id"] in {twin["session_id"], autoplay["session_id"], solo["session_id"]}:
            raise SystemExit(
                "The open case collided with another staged run, so the verdict slide "
                "would wait on a live model call. "
                "Run seed_demo.py --apply to restore a second practice run."
            )
        anchor = StudySession.query.get(open_case["session_id"])
        _park_driven_run(autoplay["session_id"], behind=anchor, minutes=30)
        _park_driven_run(solo["session_id"], behind=anchor, minutes=45)
        _surface_in_answer_log(solo["attempt_id"])
        current = find_resumable_session(user)
        if current is None or current.id != open_case["session_id"]:
            raise SystemExit(
                "Staging the autoplay run displaced the open case as the current "
                "session, which would send the case slide to the wrong run."
            )
        print(json.dumps(
            {
                "answer_key": _answer_key(question, open_case, twin),
                "open_case": open_case,
                "verdict": twin,
                "solo": solo,
                "autoplay": autoplay,
                "guided_tour": "silenced now" if tour_silenced else "already silenced",
            },
            indent=2,
            default=str,
        ))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
