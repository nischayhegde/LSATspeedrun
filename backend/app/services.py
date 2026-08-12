from __future__ import annotations

import random
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import NamedTuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from flask import current_app
from sqlalchemy import case, func, or_
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
from . import calibration, enforcement, exam, experiments, scheduling
from .experiments import Exposure
from .models import (
    AiJob,
    Attempt,
    Question,
    ReviewQueueItem,
    SessionItem,
    SkillProgress,
    StudySession,
    User,
    new_id,
    utcnow,
)
from .scoring import (
    AttemptFact,
    FORM_ITEMS,
    FORM_RC_ITEMS,
    attempt_facts,
    project_score,
    projection_snapshot,
    record_projection,
    shrink_toward_prior,
)
from .seed import SOURCE_PREFIX
from .trial import trial_plan
from .enforcement import (
    ENFORCEMENT_VERSION,
    GATE_COPY,
    GateRejection,
    LEVEL_LIGHT,
    LEVEL_NONE,
    STATUS_ATTESTED,
    STATUS_SATISFIED,
    STATUS_SKIPPED,
    STATUS_STOOD_DOWN,
    STATUS_UNENFORCED,
    assign_enforcement_level,
    build_gate,
    stand_down_available,
    validate_artifact,
)
from .strategies import (
    PROMPT_VARIANTS,
    VARIANT_CONTROL_VISIBLE,
    VARIANT_PROMPT_REQUIRED,
    assign_strategy_trial,
    plan_forced_arms,
    serialize_strategy,
    strategy_performance,
)


PRACTICE_STYLES = {"cases"}
FEEDBACK_POLICIES = {"immediate", "delayed"}
EVIDENCE_CLASS = {
    "cases": "coached_practice",
    "diagnostic": "diagnostic",
    "blind_review": "blind_review",
}

# The control arm's card. It names no technique, because that is the condition
# being measured, so it has to read as a deliberate instruction rather than as
# a prompt that failed to arrive — a student who reads it as a bug learns the
# wrong thing about the feature, and a student who waits for it to load loses
# time this arm is supposed to spend the same way the prompt arm does.
NEUTRAL_STRATEGY_CARD = {
    "variant": VARIANT_CONTROL_VISIBLE,
    "plain_title": "No set approach for this one",
    "plain_line": "Work this one however you want. Nothing is being suggested here on purpose.",
    "note": "Some questions come with an approach and some deliberately do not. This is one that does not.",
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

# The two sections this bank ships, spelled once. Both are compared against
# `Question.section` all over this module as bare strings; these are here because
# the case-shape code below turns on them and a typo would silently produce a
# run with no Reading Comprehension in it, which is the exact bug being fixed.
LOGICAL_REASONING = "Logical Reasoning"
READING_COMPREHENSION = "Reading Comprehension"

# What share of practice cases are Reading Comprehension cases.
#
# A third, and the number is over-determined: the bank is 34.4% Reading
# Comprehension (2,366 of 6,886), the scored exam is about the same (27 RC
# against 51 LR), and the form the mega-litigation imitates is literally one
# section in three — LR I, RC, LR II. A practice diet of one reading case in
# three is the same diet, at the scale of a sitting.
#
# In *questions* that is about 36%, not 34.4%, because a reading case is a
# little longer than an argument case: a passage averages 6.8 questions where an
# argument case is 6. Stated rather than tuned away. Landing exactly on the bank
# share would want a share of 0.316, and buying 1.6 points of precision with a
# number nobody can read off the design is a bad trade — particularly for a
# section that was being served at 0.0%.
#
# It exists because the general filler cannot reach Reading Comprehension at
# all. A passage is indivisible and 88.3% of passages are six questions or
# longer, so a whole passage has to win a slot race against ~4,520 single
# Logical Reasoning questions inside a budget that is usually 3. Measured with
# `tools/audit/rc_reachability_probe.py` before this change, at fresh budgets of
# 2, 3 and 5 the RC share was 0.0% over 40 runs each. Since fresh selection
# served no RC, no new RC entered the review queue either, so the section
# emptied out of practice entirely from about a student's tenth question onward.
#
# Raising the overshoot allowance was the first attempt and it is not enough: at
# a budget of 3 an allowance of 2 admits passages of five or fewer, which is 41
# of 349, and those still have to win the same race. Measured, budget 3 stayed
# at 0.0%. The section needs its own case shape, not a bigger crack to squeeze
# through.
RC_CASE_SHARE = 1 / 3

# The shortest sitting that can be a reading case at all.
#
# A reading case is one passage, so the sitting has to be able to hold one. Six,
# because `reading_case_ceiling(6)` is 8 and the passages in this bank run 4 to
# 16 with a median of 7 — at five the ceiling is 6 and the median passage no
# longer fits, so what came back would be either a runt passage or nothing.
#
# Below this the ordinary argument shape is used. That is the right answer
# rather than a concession: the entry points that ask for fewer than six are the
# three-question quick drill and the "continue review" button, and a passage
# does not fit in three questions under any rule. The sitting the game actually
# hands out, and the one the daily goals are denominated in, is six.
RC_CASE_MIN_SITTING = 6

# Share of a case's questions that come from the review queue rather than fresh
# material. Half, which is what `create_study_session` has always used for the
# Logical Reasoning case (`session_size // 2`), named here because the Reading
# Comprehension case has to apply the same split across cases rather than inside
# one — a passage is one unit and cannot be half review.
#
# This is now the *centre* of a range rather than a fixed value — the share a
# student with an ordinary queue gets, which is what makes personalising it a
# safe change rather than a re-pacing. See `_review_share`.
REVIEW_SHARE = 0.5

# How far the review share may move from REVIEW_SHARE, and where it lands.
#
# The floor exists so review never disappears: a student who is on top of their
# queue today still has cards that will decay, and a run that stops testing them
# stops finding out. One question in six is small enough not to pad a run and
# large enough that the queue keeps turning over.
#
# The ceiling exists so practice never becomes pure repetition. Two thirds means
# a student in real trouble still meets two new questions a run, so the bank
# keeps opening up and the queue keeps getting new material to work with. It is
# also self-correcting: more review drains the queue, which lowers the pressure,
# which lowers the share.
REVIEW_SHARE_FLOOR = 1 / 6
REVIEW_SHARE_CEILING = 2 / 3

# The share of a student's queue that has decayed below target retention at
# which they get the old fixed half. A quarter, which is where a student who
# plays regularly and answers their repairs actually sits — measured, on the
# probe's warmed cohort: 81 cards slipping out of 331 tracked.
#
# A *share* and not a count, which was the first attempt and was wrong. A queue
# only grows, so the number of cards below target grows with how long someone
# has been playing whether or not they are keeping up: the warmed cohort has
# thirteen runs' worth of overdue material and is not thirteen runs behind, it
# has simply answered two thousand questions. Any threshold in cards is one that
# every committed student crosses and then sits above forever, which is a knob
# that reads "how long have you been here" while claiming to read "how far
# behind are you". The share does not have that failure: it can only reach the
# top when a student has genuinely stopped answering their repairs.
QUEUE_SLIPPED_AT_REVIEW_CENTRE = 0.25

# How far RC_CASE_SHARE may move for a student whose two sections have come
# apart. A twelfth, so the share runs 1/4 to 5/12 and the reading diet runs from
# one case in four to one case in two and a half.
#
# Bounded deliberately and bounded tightly. The reasons a third is the right
# default — the bank is 34.4% Reading Comprehension, the scored exam is about
# the same, and the form is literally one section in three — are reasons about
# the *test*, and they do not stop being true because a particular student is
# weak at reading. What a student's own record earns is a lean, not a veto: at
# the extreme this serves half again as much reading as the default, which is
# a large intervention, and it still cannot turn practice into a reading course
# or let a strong reader stop practising the section they will be examined on.
RC_CASE_SHARE_SPREAD = 1 / 12

# The gap in section accuracy at which the reading share reaches its bound.
# Fifteen points. Section accuracies live between about 0.4 and 0.8, so fifteen
# points is a real difference in kind rather than a run of luck — and because
# both sections are shrunk toward the same population prior, a student without
# the evidence to establish a gap that size cannot produce one.
SECTION_GAP_AT_FULL_SHIFT = 0.15


def reasoning_min_chars(session: StudySession) -> int:
    """Characters of written explanation a session demands before an answer counts."""
    if session.mode != "practice":
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
    """Milliseconds left on whichever mega-litigation clock is running.

    On a sectioned form that is the current section's thirty-five minutes, or
    the intermission's ten, or nothing at all while the form waits for the
    student to begin the next section. On a form started before sections
    existed it is the whole-form deadline it was created under. None for
    anything with no clock: coached practice and blind reviews.
    """
    if session.mode != "diagnostic":
        return None
    if exam.is_sectioned(session):
        return exam.remaining_ms(session)
    if not session.deadline_at:
        return None
    return max(0, int((_aware_utc(session.deadline_at) - utcnow()).total_seconds() * 1000))


def _blind_review_record(diagnostic: StudySession) -> StudySession | None:
    return StudySession.query.filter_by(diagnostic_session_id=diagnostic.id).first()


def blind_review_status(diagnostic: StudySession) -> dict:
    """Describe the answer-release stage attached to a completed diagnostic."""
    if diagnostic.mode != "diagnostic" or diagnostic.status != "completed":
        return {"state": "unavailable", "session_id": None, "total_items": 0}
    if not diagnostic.blind_review_required:
        return {"state": "not_required", "session_id": None, "total_items": 0}

    missed = (
        Attempt.query.join(SessionItem)
        .filter(SessionItem.session_id == diagnostic.id, Attempt.is_correct.is_(False))
        .count()
    )
    if not missed:
        return {"state": "not_needed", "session_id": None, "total_items": 0}

    review = _blind_review_record(diagnostic)
    if not review:
        return {"state": "ready", "session_id": None, "total_items": missed}
    # An abandoned review is offered again rather than treated as spent: the
    # answers are still sealed, so "ready" is the only honest state left.
    state = "ready" if review.status == "abandoned" else review.status
    return {"state": state, "session_id": review.id, "total_items": review.total_items}


def answers_available(session: StudySession) -> bool:
    """Whether a delayed-feedback attempt may reveal its answer or coaching."""
    if session.feedback_policy == "immediate":
        return True
    if session.status != "completed":
        return False
    if session.mode == "diagnostic":
        return blind_review_status(session)["state"] in {"completed", "not_needed", "not_required"}
    return True


def enforce_diagnostic_deadline(session: StudySession) -> bool:
    """Close out a mega-litigation whose clock has run out.

    Called at the top of every path that can touch a diagnostic, which is what
    makes the deadline real without a background sweeper: a run that expires
    while the student is away is finalized by whichever request next looks at
    it, and until then nothing can be written to it.

    Returns True when this call finalized the run.

    A sectioned form has three clocks rather than one and its own state machine
    to advance, so it delegates; forms started before sections existed keep the
    single whole-form deadline below, unchanged.
    """
    if session.mode != "diagnostic":
        return False
    if exam.is_sectioned(session):
        return exam.enforce_exam_clock(session)
    if not session.deadline_at:
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
            StudySession.mode.in_(["diagnostic", "blind_review"]),
            or_(
                StudySession.status.in_(["in_progress", "paused"]),
                StudySession.pending_attempt_id.isnot(None),
            ),
        )
        .order_by(StudySession.started_at.desc())
        .first()
    )
    if session and session.mode == "diagnostic" and enforce_diagnostic_deadline(session):
        # The clock decided this run is over. It is no longer the active one, and
        # the diagnostic's blind-review state now decides what comes next.
        session = None
    if session:
        return session

    # A finished form whose answers are still sealed is the thing the student
    # owes the app, so it keeps the "active diagnostic" slot until its blind
    # review is done. That is what routes them back into the review instead of
    # letting them start a second form on top of an unreleased one.
    pending_diagnostics = (
        StudySession.query.filter_by(
            user_id=user.id,
            mode="diagnostic",
            status="completed",
            blind_review_required=True,
        )
        .order_by(StudySession.completed_at.desc())
        .all()
    )
    return next(
        (diagnostic for diagnostic in pending_diagnostics if blind_review_status(diagnostic)["state"] == "ready"),
        None,
    )


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
        item.session.mode != "practice"
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
        # On a sectioned form the question at `current_index` during an
        # intermission is the *next* section's first one. Starting its timer
        # there would charge a student for a question they have not been shown
        # and are not allowed to see yet.
        and (not exam.is_sectioned(item.session) or exam.active_section(item.session) is not None)
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
        if item.strategy_key and item.strategy_variant in PROMPT_VARIANTS
        else None
    )
    strategy_gate = build_gate(item) if strategy_trial else None
    # A mandatory question whose gate could not be built has nothing to be
    # mandatory about — `build_gate` returns None when the stimulus does not
    # split into anything the operations can annotate — so the card falls back
    # to the ordinary suggestion rather than refusing a skip for steps that
    # were never shown. The arm label on the row still says what was assigned;
    # `strategy_gate_status` records that no gate was met.
    required = bool(strategy_gate and strategy_gate.get("required"))
    return {
        "id": item.id,
        "position": item.position,
        "section_index": item.section_index,
        "requires_reasoning": item.requires_reasoning,
        "reasoning_min_chars": reasoning_min_chars(item.session),
        "strategy_trial": (
            {
                **strategy_trial,
                "variant": item.strategy_variant,
                "required": required,
            }
            if strategy_trial
            else None
        ),
        "strategy_gate": strategy_gate,
        # Kept as its own field rather than folded into `strategy_trial`, which
        # means "a named technique was offered" everywhere on both sides of the
        # wire — the submit path keys the required decision off it, and a
        # neutral card asks for no decision because there is nothing to apply
        # or to skip.
        "strategy_neutral": (
            dict(NEUTRAL_STRATEGY_CARD)
            if item.strategy_variant == VARIANT_CONTROL_VISIBLE
            else None
        ),
        "served_at": _iso_utc(item.served_at),
        "elapsed_ms": _elapsed_ms(item),
        "target_time_seconds": item.target_time_seconds,
        "flagged": bool(item.flagged),
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
        "diagnostic_session_id": session.diagnostic_session_id,
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
    if session.mode == "diagnostic" and session.status == "completed":
        payload["blind_review"] = blind_review_status(session)
    if exam.is_sectioned(session):
        payload["exam"] = exam.serialize_exam(session)
        # Progress on a form is how much of the paper is filled in, not how far
        # the cursor has travelled: with free navigation the cursor can be
        # anywhere and mean nothing.
        payload["progress_percent"] = round(
            100 * payload["exam"]["answered"] / max(1, session.total_items)
        )
    if session.pending_attempt_id:
        pending_attempt = db.session.get(Attempt, session.pending_attempt_id)
        if pending_attempt:
            payload["pending_result"] = serialize_attempt_result(pending_attempt)
            payload["pending_item"] = serialize_item(pending_attempt.session_item, commit=False)
            return payload
    if include_item and session.status == "in_progress":
        # Between sections there is no current question, and saying so is the
        # point: the next section's first item must not cross the wire before
        # its clock has started.
        if exam.is_sectioned(session) and not exam.active_section(session):
            payload["current_item"] = None
            return payload
        item = SessionItem.query.filter_by(
            session_id=session.id,
            position=session.current_index,
        ).first()
        payload["current_item"] = serialize_item(item) if item else None
    return payload


def eligible_question_count() -> int:
    # `Query.count()` would wrap the whole entity — twelve columns including three
    # text bodies — in a `SELECT count(*) FROM (…)`. Nothing is transferred either
    # way, but naming the column keeps the statement honest about what it reads,
    # which is what the query-budget test can then hold everything else to.
    return db.session.query(func.count(Question.id)).filter(Question.source.like(f"{SOURCE_PREFIX}%")).scalar() or 0


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


class QuestionFact(NamedTuple):
    """The four columns choosing a run actually reads.

    Building a session used to load every eligible question as a full ORM
    instance — 7,101 of them on this bank — with each one's stimulus, stem and
    explanation attached, only to pick eight and discard the rest. The selection
    never looks at any of that text: it groups by `passage_id`, biases by
    `question_type`, times by `section`, and identifies by `id`.

    Four scalar columns instead of twelve, and a tuple instead of an instrumented
    ORM object, is the whole difference between a 720 ms selection and a 25 ms
    one. The questions that survive selection are loaded whole in
    `_load_questions_in_order`, because deciding which techniques a question can
    be paired with does read the stimulus.
    """

    id: str
    question_type: str | None
    passage_id: str | None
    section: str | None


def _eligible_question_facts(
    question_type: str | None, section: str | None = None
) -> list[QuestionFact]:
    query = db.session.query(
        Question.id,
        Question.question_type,
        Question.passage_id,
        Question.section,
    ).filter(Question.source.like(f"{SOURCE_PREFIX}%"))
    if question_type:
        query = query.filter(Question.question_type == question_type)
    if section:
        query = query.filter(Question.section == section)
    return [QuestionFact(*row) for row in query.all()]


def _load_questions_in_order(facts: list[QuestionFact]) -> list[Question]:
    """The chosen questions, whole, in the order selection put them in.

    One `IN (…)` for the eight that were picked, rather than a lazy load apiece:
    the bank scan used to leave every candidate in the identity map, so the
    per-question reads downstream were free by accident. They are real queries
    now, so they are batched here on purpose.

    The passage comes with them. `strategies._candidate_keys` reads
    `question.passage.canonical_text` on every Reading Comprehension question to
    decide whether a comparative or viewpoint technique applies, which was a
    lazy load per RC question in the run.
    """
    return _questions_by_id([fact.id for fact in facts])


def _questions_by_id(ids: list[str]) -> list[Question]:
    if not ids:
        return []
    by_id = {
        question.id: question
        for question in Question.query.options(joinedload(Question.passage)).filter(Question.id.in_(ids))
    }
    return [by_id[question_id] for question_id in ids if question_id in by_id]


def select_random_questions(
    count: int,
    question_type: str | None = None,
    *,
    user_id: str | None = None,
    exclude_ids: set[str] | None = None,
    focus_types: list[str] | None = None,
    section: str | None = None,
) -> list[Question]:
    # Excluding here rather than from `unseen` alone matters: the fallback below
    # widens the pool to already-seen questions, and a question seeded as a
    # repair is by definition seen. Filtering only `unseen` would let it come
    # back through the fallback and appear twice in one run.
    blocked = exclude_ids or set()
    eligible = [
        fact for fact in _eligible_question_facts(question_type, section) if fact.id not in blocked
    ]
    if not eligible:
        return []
    # Hoisted out of the comprehension below: calling this once here instead of
    # once per candidate question turned a single-query lookup into an N+1 that
    # ran thousands of times per session creation on the full bank.
    seen_ids = _seen_question_ids(user_id) if user_id else set()
    unseen = [fact for fact in eligible if fact.id not in seen_ids]
    # `fact.id in seen_ids` rather than `fact not in unseen`: the two describe the
    # same complement, but the second is a list scan inside a list comprehension,
    # so widening the pool on the full bank was fifty million comparisons.
    pool = unseen if len(unseen) >= count else unseen + [fact for fact in eligible if fact.id in seen_ids]
    return _load_questions_in_order(_weight_toward_focus(pool, count, focus_types))


def _passage_blocks(pool: list[QuestionFact]) -> list[list[QuestionFact]]:
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
    grouped: dict[str, list[QuestionFact]] = defaultdict(list)
    for question in pool:
        grouped[question.passage_id or f"solo:{question.id}"].append(question)
    return [sorted(block, key=lambda question: question.id) for block in grouped.values()]


# How far past its target a run may run to finish a Reading Comprehension
# passage whole.
#
# A block is indivisible and RC passages in this bank are 4 to 16 questions with
# a median of 7, so a run that may never exceed its target can only ever serve a
# passage shorter than the target. At the ten-question runs this app used to
# serve that cost nothing visible: 98.6% of the RC bank fitted. At six it is
# ruinous — a flat six-question run can reach 33.5% of the RC bank, and a flat
# five-question run 8.6%. The rest of Reading Comprehension simply stops being
# served.
#
# That is not only a content problem, it moves the campaign's length. Reading
# Comprehension is budgeted at 330s for the first question on a passage against
# 150s for a Logical Reasoning question (`_target_time_seconds`), so squeezing RC
# out of the mix makes the average question cheaper in wall-clock time and the
# whole campaign quietly shorter. Reproduce the table below with
# `scripts/measure_served_section_mix.py` at its defaults (4,000 generated runs
# per setting against the real bank, seed 20260811):
#
#     target 10, no allowance (was)   10.00 q/run   18.2% RC   152.7 s/q   25.5 min
#     target  6, no allowance          6.00 q/run    3.4% RC   150.7 s/q   15.1 min
#     target  5, no allowance          5.00 q/run    0.9% RC   150.2 s/q   12.5 min
#     target  5, allowance 3           5.32 q/run   18.0% RC   152.8 s/q   13.6 min
#     target  6, allowance 2           6.20 q/run   16.7% RC   152.6 s/q   15.8 min
#     target  6, allowance 4           6.59 q/run   26.5% RC   153.9 s/q   16.9 min
#
# Six with an allowance of two is the setting that holds the served mix, and so
# the campaign's wall-clock length, closest to what ships: 152.6s against 152.7s,
# a difference of 0.1%. It also keeps the run tight, 6 to 8 questions, where a
# five-question target puts a 5-question run beside an 8-question one.
#
# And it does the thing this change exists to do: the run goes from 25.5 budgeted
# minutes to 15.8.
#
# The four passages longer than eight questions (one of 9, one of 10, two of 16;
# 51 questions, 2.2% of the RC bank) are not reachable at this target and were
# reachable at ten. That is the price of the shorter run and it is paid
# knowingly: a sixteen-question passage is not a six-question case under any
# allowance that leaves the run short.
PASSAGE_OVERSHOOT_ALLOWANCE = 2


def passage_overshoot_allowance(count: int) -> int:
    """How far past ``count`` a run of that size may go to finish a passage.

    PASSAGE_OVERSHOOT_ALLOWANCE, but never more than a third of the run. The
    flat allowance is sized for the run the app actually serves and is nonsense
    applied to a small one: a caller asking for two questions and being handed
    four has not had its run stretched, it has had a different run built. Runs
    that small are only ever requested explicitly — by the queue-cap path and by
    tests — and they must come back the length they asked for.

    A third is exactly PASSAGE_OVERSHOOT_ALLOWANCE at the shipped six-question
    run, so this bounds the small cases without changing the shipped one.
    """
    return max(0, min(PASSAGE_OVERSHOOT_ALLOWANCE, count // 3))


def reading_case_ceiling(count: int) -> int:
    """The most questions one Reading Comprehension case may serve.

    The same ceiling the overshoot allowance already defines, reused rather than
    given a constant of its own, because it answers the same question: how long
    a sitting may run when a passage is what it is made of. At the shipped
    six-question case that is 8, which serves 345 of 349 passages (97.8% of the
    Reading Comprehension bank) whole in a single case.

    In time rather than questions, 8 is where the two case shapes stay
    comparable. `_target_time_seconds` budgets 330s for the first question on a
    passage and 135s for each one after it, so an eight-question reading case is
    21.3 minutes against a six-question argument case's 15.0. The common
    passage, six or seven questions, is 16.8 to 18.1 minutes — near enough the
    same sitting. Serving all sixteen questions of the longest passage in one go
    would be 39 minutes, which is worse than the ten-question run this whole
    change removed.
    """
    return count + passage_overshoot_allowance(count)


class SequencingProfile(NamedTuple):
    """What this student's own record says the shape of their next run should be.

    Everything the sequencer knows about an individual, computed once per run
    and in one place. Until now the answer was the same for every student at a
    given length: half review, a third reading, review at fixed positions. The
    audit's phrase for that was "responsive rather than adaptive" — the system
    reacted correctly to the signals it had and it had almost none.

    The fields are shares rather than counts so that the same profile applies
    whatever length was asked for, and the raw signals are carried alongside
    them so a caller — or a probe — can say *why* a run came out the shape it
    did without recomputing anything.

    **Where question difficulty would go.** There is now a per-item rating,
    earned per response in `app/calibration.py`, but nothing in the adaptive
    path reads it and this profile does not either. When it is consumed, this
    is where it belongs: a `target_difficulty` beside these, derived from the
    same accuracy evidence, read by `select_random_questions` and by the
    passage choice in `select_reading_comprehension_case` to bias *which*
    questions a run draws rather than how many of each kind. Wiring it means
    randomising exposure at the same time — see `docs/question-difficulty.md`
    — which is why it is still left open. It is also why the two selection
    functions take their inputs as arguments instead of reaching for the
    profile themselves: adding a field here should not mean rewriting them.
    """

    review_share: float
    reading_case_share: float
    # The evidence, kept for reporting rather than used again below.
    overdue: int
    tracked: int
    lr_accuracy: float
    rc_accuracy: float


def _section_accuracy(user_id: str) -> tuple[float, float, int, int]:
    """This student's accuracy in each section, shrunk toward the population.

    One aggregate, two rows. Deliberately not `scoring.project_score`, which
    computes the same two rates far more carefully — time-weighted, weighted by
    evidence class, with a full uncertainty band — at the cost of reading every
    answer the account has ever filed. That is the right trade for a number
    shown to a student as a projected score and the wrong one for a number that
    decides whether this run has two reading cases or three.

    The shrinkage is not optional and is the whole reason this is safe. Both
    sections are pulled toward the same population prior with the same strength
    (`scoring.PRIOR_STRENGTH`, ten answers' worth), so a student with four
    Reading Comprehension answers, three of them wrong, does not thereby earn a
    reading-heavy diet — the estimate barely moves off the prior, the gap
    against their Logical Reasoning rate stays small, and the share stays near
    its default. Evidence buys deviation, in proportion to how much of it there
    is.

    Returns both rates and both counts; the counts are what the profile reports
    so that "no gap" and "no evidence" can be told apart downstream.
    """
    rows = (
        db.session.query(
            Question.section,
            func.count(Attempt.id),
            func.sum(case((Attempt.is_correct, 1), else_=0)),
        )
        .join(SessionItem, SessionItem.id == Attempt.session_item_id)
        .join(Question, Question.id == SessionItem.question_id)
        .filter(Attempt.user_id == user_id)
        .group_by(Question.section)
        .all()
    )
    counts = {section: (total or 0, correct or 0) for section, total, correct in rows}
    accuracies = {}
    for section in (LOGICAL_REASONING, READING_COMPREHENSION):
        total, correct = counts.get(section, (0, 0))
        observed = (correct / total) if total else 0.0
        accuracies[section] = shrink_toward_prior(observed, float(total))
    return (
        accuracies[LOGICAL_REASONING],
        accuracies[READING_COMPREHENSION],
        counts.get(LOGICAL_REASONING, (0, 0))[0],
        counts.get(READING_COMPREHENSION, (0, 0))[0],
    )


def _review_share(overdue: int, tracked: int, session_size: int) -> float:
    """How much of a run should be review, given how much of the queue is slipping.

    Two straight segments through REVIEW_SHARE, so the student with an ordinary
    queue gets exactly what the fixed `session_size // 2` used to give them and
    the personalisation is a deviation from that rather than a replacement for
    it. Below the centre it falls to REVIEW_SHARE_FLOOR at a queue with nothing
    slipping; above it, it rises to REVIEW_SHARE_CEILING at a queue where
    everything has.

    The signal is the fraction of cards that have actually decayed below the
    retention target. Not the size of the queue: a student with two hundred
    cards all comfortably above target is not behind on anything, and asking
    them to spend two thirds of every run proving it would be the "chore list
    with a date attached" that `scheduling.queue_pressure` exists to avoid.

    Shrunk by a run's worth of pseudo-cards sitting at the centre, for the same
    reason the section rates are shrunk: a student with three cards, two of them
    slipping, has not established that they are behind. It also makes the knob
    move smoothly at the start of an account rather than swinging on the third
    answer.

    **Accuracy is deliberately not a second input here.** It looks like an
    obvious one — answer badly, get more consolidation — but it is already in
    this number twice over. A wrong answer is what puts a card in the queue in
    the first place, and a failed review is what makes a card's retrievability
    decay faster afterwards, so a student who is struggling arrives here with a
    larger overdue count *because* they are struggling. Adding their accuracy on
    top would count the same evidence a second time and make the knob react
    roughly twice as hard as intended to exactly the students it should be
    gentlest with. Accuracy earns its own knob below, where it is not already
    represented.
    """
    if tracked <= 0:
        # Nothing tracked, nothing to be behind on. The floor, so that the
        # number this reports matches what the student will actually be served:
        # `due_for_review` returns an empty queue whatever is asked of it.
        return REVIEW_SHARE_FLOOR
    prior = max(1.0, float(session_size))
    centre = QUEUE_SLIPPED_AT_REVIEW_CENTRE
    slipped = (overdue + centre * prior) / (tracked + prior)
    if slipped <= centre:
        return REVIEW_SHARE_FLOOR + (REVIEW_SHARE - REVIEW_SHARE_FLOOR) * (slipped / centre)
    over = (slipped - centre) / (1.0 - centre)
    return REVIEW_SHARE + (REVIEW_SHARE_CEILING - REVIEW_SHARE) * min(1.0, over)


def _reading_case_share(lr_accuracy: float, rc_accuracy: float) -> float:
    """How often a case should be a reading case, given where this student is weak.

    RC_CASE_SHARE, leaned by the gap between the two sections and bounded by
    RC_CASE_SHARE_SPREAD. A student whose reading trails their arguments sees
    more reading; a student whose reading is the stronger half sees less, but
    never little.

    Signed the way round it reads: `lr_accuracy - rc_accuracy` positive means
    reading is the weaker section, so the share goes up.

    Note what this does *not* do. It does not chase the weakest section to the
    exclusion of the other, and it does not compound: the share is recomputed
    from the student's whole record on every run, so a stretch of reading cases
    that fixes the gap moves the share straight back. A knob that ratcheted —
    that read only recent performance, or only performance since the last
    adjustment — would find its own extreme and stay there.
    """
    gap = (lr_accuracy - rc_accuracy) / SECTION_GAP_AT_FULL_SHIFT
    lean = max(-1.0, min(1.0, gap))
    return RC_CASE_SHARE + RC_CASE_SHARE_SPREAD * lean


def sequencing_profile(user_id: str, session_size: int) -> SequencingProfile:
    """Read the student's record and say what shape their next run should be.

    One call site, `create_study_session`, and one place to look when a run
    comes out unexpected. Two queries: the review queue, and one aggregate over
    answers grouped by section.
    """
    pressure = scheduling.queue_pressure(user_id)
    lr_accuracy, rc_accuracy, _lr_seen, _rc_seen = _section_accuracy(user_id)
    return SequencingProfile(
        review_share=_review_share(pressure["below_target"], pressure["tracked"], session_size),
        reading_case_share=_reading_case_share(lr_accuracy, rc_accuracy),
        overdue=pressure["below_target"],
        tracked=pressure["tracked"],
        lr_accuracy=lr_accuracy,
        rc_accuracy=rc_accuracy,
    )


def reading_case_floor(count: int) -> int:
    """The fewest questions a passage must carry to be a case on its own.

    Half the sitting that was asked for. A reading case is as long as its
    passage, which is the point — but a passage has to be enough of a sitting to
    be worth sitting down to, and two questions is not a case, it is an
    interruption.

    On the shipped bank this never fires: passages run 4 to 16 questions and the
    floor at a six-question sitting is 3. It exists for the banks that are not
    the shipped one — most of the test suite runs on a handful of hand-written
    questions, and a deployment could ship stub content — where the alternative
    is that asking for six questions quietly returns two.
    """
    return max(2, count // 2)


def _reading_case_from_passage(
    block: list[QuestionFact],
    ceiling: int,
    *,
    prefer_first: set[str],
) -> list[QuestionFact]:
    """One passage's questions, in the order this case should serve them.

    `prefer_first` is whatever this case is being built around — the unseen
    questions on a fresh-led case, the due review cards on a review-led one.
    Everything else follows in the passage's own order, and the case is cut at
    `ceiling`.

    This is what happens when a sixteen-question passage meets a six-question
    sitting, and it is why nothing needs to be stored to make it work. The
    passage is not split into a fragment and an orphan: each visit serves that
    one passage and nothing else, and because the questions the student has not
    answered sort first, a second visit picks up where the first left off. The
    passage text is attached to every one of its questions, so no question is
    ever served without it — the invariant the passage-mate fix established.
    Four passages in this bank need a second visit (one of 9, one of 10, two of
    16); the other 345 are finished in one.
    """
    preferred = [question for question in block if question.id in prefer_first]
    rest = [question for question in block if question.id not in prefer_first]
    return (preferred + rest)[:ceiling]


def select_reading_comprehension_case(
    count: int,
    *,
    user_id: str | None = None,
    exclude_ids: set[str] | None = None,
    due_ids: list[str] | None = None,
    review_share: float | None = None,
) -> list[Question]:
    """One passage, whole, as a case in its own right.

    The Reading Comprehension case exists because a passage cannot compete for
    slots in a mixed run: it is indivisible, it is usually longer than the whole
    fresh budget, and it is outnumbered roughly thirteen to one by single
    Logical Reasoning questions in the shuffle. See RC_CASE_SHARE for the
    measurement. Rather than widen the crack, this builds the case out of the
    passage and lets the passage decide how long the case is.

    Which passage, and the one rule that keeps this honest:

    * **Review-led**, when the student has due Reading Comprehension cards and
      the coin (REVIEW_SHARE) says so: build on the passage carrying the weakest
      due card, oldest memory first. Re-reading a passage you are close to
      forgetting and answering its questions again is the strongest form review
      can take in this section, and it is the *only* way an RC card ever comes
      back — an argument case will not take one, because a lone reading question
      dropped among six arguments is the 450-words-with-no-warning bug that was
      fixed once already.
    * **Fresh-led** otherwise: a passage the student still has unseen questions
      on.

    Splitting it this way, across cases rather than inside one, is forced: a
    passage is one unit, so a case built on it cannot be half review the way an
    argument case is. Half of reading cases being re-reads is the same diet, and
    it is what stops the section collapsing in either direction — all-fresh
    would never return an RC card, all-review would never put a new one in.

    Returns [] when there is no Reading Comprehension material to build on, and
    the caller falls back to an ordinary run. A bank with no passages in it is a
    real configuration: most of the test suite runs on one.
    """
    if count <= 0:
        return []
    blocked = exclude_ids or set()
    ceiling = reading_case_ceiling(count)
    floor = reading_case_floor(count)
    facts = [
        fact
        for fact in _eligible_question_facts(None, READING_COMPREHENSION)
        if fact.passage_id and fact.id not in blocked
    ]
    if not facts:
        return []
    grouped: dict[str, list[QuestionFact]] = defaultdict(list)
    for fact in facts:
        grouped[fact.passage_id].append(fact)
    passages = {
        passage_id: sorted(block, key=lambda question: question.id)
        for passage_id, block in grouped.items()
        if len(block) >= floor
    }
    if not passages:
        return []

    seen_ids = _seen_question_ids(user_id) if user_id else set()

    # Review-led: the passage under the weakest due card. `due_ids` arrives
    # already ranked by retrievability, so the first one whose passage is still
    # available is the weakest memory this case can rebuild.
    if due_ids and random.random() < (REVIEW_SHARE if review_share is None else review_share):
        due_by_passage = {fact.id: fact.passage_id for fact in facts}
        for question_id in due_ids:
            passage_id = due_by_passage.get(question_id)
            if passage_id and passage_id in passages:
                return _load_questions_in_order(
                    _reading_case_from_passage(
                        passages[passage_id], ceiling, prefer_first=set(due_ids)
                    )
                )

    # Fresh-led: a passage with unseen questions, or any passage at all if the
    # student has worked the whole section. Shuffled rather than ranked, because
    # there is no signal here worth ranking on and a stable order would serve
    # the same passages to everybody.
    with_unseen = [
        passage_id
        for passage_id, block in passages.items()
        if any(question.id not in seen_ids for question in block)
    ]
    candidates = with_unseen or list(passages)
    passage_id = random.choice(candidates)
    unseen = {question.id for question in passages[passage_id] if question.id not in seen_ids}
    return _load_questions_in_order(
        _reading_case_from_passage(passages[passage_id], ceiling, prefer_first=unseen)
    )


def _fill_blocks(
    blocks: list[list[QuestionFact]],
    budget: int,
    selected: list[list[QuestionFact]],
    *,
    ceiling: int | None = None,
) -> None:
    """Add whole blocks to `selected` until `budget` questions are chosen.

    Never splits a block. Stops as soon as the budget is met, and never admits a
    block that would take the run past `ceiling` — which defaults to the budget,
    the no-overshoot rule this had before, and is raised by
    PASSAGE_OVERSHOOT_ALLOWANCE on the practice path so a passage can be served
    whole. A run therefore comes out at exactly the requested size whenever the
    pool contains single-question material to round it out — which, with an LR
    bank in the thousands, is always — or a little over it when the block that
    reached the budget was a passage.
    """
    limit = budget if ceiling is None else max(budget, ceiling)
    chosen = {id(block) for block in selected}
    total = sum(len(block) for block in selected)
    for block in blocks:
        if total >= budget:
            return
        if id(block) in chosen or total + len(block) > limit:
            continue
        selected.append(block)
        total += len(block)


def _weight_toward_focus(
    pool: list[QuestionFact], count: int, focus_types: list[str] | None
) -> list[QuestionFact]:
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

    Every fill shares one ceiling — `count` plus the whole-passage allowance —
    rather than each stage carrying its own. The focus stage's budget is a share
    of the run, but the *run* is what may not overrun, so a passage admitted to
    satisfy the focus quota still has to fit the run it is being built for.
    """
    if count <= 0:
        return []
    blocks = _passage_blocks(pool)
    random.shuffle(blocks)
    wanted = set(focus_types or ())
    ceiling = count + passage_overshoot_allowance(count)
    selected: list[list[QuestionFact]] = []
    if wanted:
        preferred = [block for block in blocks if any(question.question_type in wanted for question in block)]
        preferred_ids = {id(block) for block in preferred}
        others = [block for block in blocks if id(block) not in preferred_ids]
        _fill_blocks(preferred, round(count * FOCUS_FILL_RATIO), selected, ceiling=ceiling)
        _fill_blocks(others, count, selected, ceiling=ceiling)
        # Not enough off-focus material to round the run out; top up from focus.
        _fill_blocks(preferred, count, selected, ceiling=ceiling)
    else:
        _fill_blocks(blocks, count, selected, ceiling=ceiling)
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


def _questions_due_for_review(
    user_id: str, count: int, *, section: str | None = None
) -> list[Question]:
    """The weakest cards in this student's queue, ranked by retrievability.

    Delegates to `scheduling.due_for_review`, which deliberately does not gate
    on `due_at <= now`: a student who sits down to work at any hour is handed
    the material they are closest to forgetting rather than an empty queue and
    a date. See the module docstring in `app/scheduling.py`.

    `section` narrows the queue to one section, because the two case shapes take
    their review from different halves of it.
    """
    return scheduling.due_for_review(user_id, count, section=section)


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

    session_size = count if count is not None else int(current_app.config["PRACTICE_SESSION_SIZE"])
    # The run's id, minted here rather than by the insert below, because two
    # decisions taken before the run exists need something that names *this
    # sitting*: the layer draws further down, and the arm each question is
    # dealt by the strategy trial. See `experiments.Exposure`. It is passed to
    # the `StudySession` constructor below, and it has to stay passed: nothing
    # references `layer_assignments.session_id`, so a run built without it
    # writes assignment rows naming an id that was never inserted and
    # `layer_reading` quietly reports nothing.
    #
    # A reading case returns before the draw below, so this id goes unused on
    # that path and the case builds its own run. That is correct rather than a
    # gap: reading cases do not read `focus_types`, so the layer cannot act on
    # them and enrolling them would dilute the comparison.
    session_id = new_id()

    # Which shape of case this is. A reading case is one passage and is built
    # entirely differently — see `select_reading_comprehension_case` for why the
    # section needs a case of its own rather than a bigger share of a mixed one.
    #
    # Drawn per run rather than rotated. A rotation would need a counter that
    # survives across sessions, and up to PRACTICE_QUEUE_MAX runs can be queued
    # and abandoned before any of them is answered, so the only counter cheap
    # enough to reach here (`profile.total_cases`, which moves on settlement)
    # would hand every queued run the same shape. A draw needs no state and
    # converges on RC_CASE_SHARE over the 347 sittings a campaign takes; the
    # cost is variance early on, where a student has a (1 - 1/3)^5 = 13% chance
    # of seeing no reading case in their first five. That is worth saying out
    # loud, and it is still the entire section arriving instead of none of it.
    #
    # A type-filtered run is the student overriding the weighting by hand, so it
    # keeps the ordinary shape whatever the draw says, and so does any sitting
    # too short to hold a passage.
    #
    # What this student's own record says the run should look like: how much of
    # it is review, and how often a case is a reading case. Read once, here, and
    # nowhere else. See `SequencingProfile`.
    #
    # A type-filtered drill skips the read entirely — the student has overridden
    # the shape by hand, so nothing personal applies and the queries are wasted.
    sequencing = None if question_type else sequencing_profile(user.id, session_size)

    # The share is read from config so a test can pin the shape it means to
    # exercise. Nothing sets it; the default is the student's own.
    rc_share = float(
        current_app.config.get(
            "PRACTICE_RC_CASE_SHARE",
            sequencing.reading_case_share if sequencing else RC_CASE_SHARE,
        )
    )
    reading_case = (
        not question_type and session_size >= RC_CASE_MIN_SITTING and random.random() < rc_share
    )
    if reading_case:
        # Ranked review cards for this section, handed to the case builder so it
        # can decide between a re-read and a new passage. Asked for generously
        # rather than at the review budget: the builder needs enough ranked
        # candidates to find one whose passage is still available, and it serves
        # a whole passage regardless of how many of its cards are due.
        due = _questions_due_for_review(
            user.id, reading_case_ceiling(session_size), section=READING_COMPREHENSION
        )
        questions = select_reading_comprehension_case(
            session_size,
            user_id=user.id,
            due_ids=[question.id for question in due],
            # The same review share the argument case uses, applied across
            # reading cases instead of inside one: a passage is a single unit,
            # so "half this run is review" has to become "half of these runs are
            # re-reads". A student behind on their queue therefore gets both
            # more repairs per argument case and more re-read passages.
            review_share=sequencing.review_share,
        )
        if questions:
            return _build_practice_session(
                user,
                profile,
                questions,
                session_id=session_id,
                practice_style=practice_style,
                question_type=None,
                # Whichever of the passage's questions were already due. A
                # reading case does not have review *slots* — the passage is the
                # run — but the questions in it that came off the queue are
                # review in every sense the rest of the app cares about, and
                # leaving them unflagged meant `apply_review` never advanced
                # their memory state and the recovery rate never counted them.
                # The whole of Reading Comprehension was invisible to the review
                # machinery it had just been given access to.
                repair_ids={question.id for question in due},
            )
        # No Reading Comprehension in this bank. Most of the test suite runs on
        # one of those, and so would a deployment that shipped LR only.

    # How much of this run is repair work. Bounded well short of the whole run
    # in both directions, so a large queue can never turn practice into pure
    # repetition and a small one can never turn review off. A type-filtered run
    # is a focused drill; mixing off-type repairs into it would defeat the
    # filter the student asked for.
    #
    # Restricted to Logical Reasoning cards now that reading has a case of its
    # own. An RC card arriving alone in an argument case is a passage the
    # student has to re-read for one question, which is the cost the passage-
    # mate fix removed from fresh material and should not be reintroduced here;
    # RC cards come back on their own passage, in a reading case.
    #
    # At least one whenever there is a queue to draw from, which is what the
    # floor means once it meets a whole number of questions: a share of a sixth
    # rounds to zero on any run shorter than four, and "review is never off" has
    # to survive the short runs too. `due_for_review` returns nothing when the
    # queue is empty, so this cannot invent repairs for a student who has none.
    #
    # `int(x + .5)` rather than `round`, which is banker's rounding — round(0.5)
    # is 0 and round(2.5) is 2, so a budget could land a question below what the
    # share asked for depending on whether the product happened to be even.
    repair_budget = (
        0 if question_type else max(1, int(session_size * sequencing.review_share + 0.5))
    )
    repairs = (
        []
        if question_type
        else _questions_due_for_review(user.id, repair_budget, section=LOGICAL_REASONING)
    )
    # Due passage-mates travel together so the run reads the passage once. Only
    # the ones the scheduler already chose — see `cluster_passage_mates`.
    repairs = scheduling.cluster_passage_mates(repairs)
    # A type-filtered run is the student overriding the weighting by hand, so the
    # last mega-litigation only steers an unfiltered one.
    focus_types = [] if question_type else diagnostic_focus(user.id)
    # Weak-type targeting is an adaptive layer like any other, and until now it
    # was one nobody could evaluate: it has steered every eligible run since it
    # shipped, so there has never been a run to compare a steered one against.
    # A quarter of eligible runs now draw the untargeted arm. See
    # `app/experiments.py` for why the run's id is the exposure and why the
    # propensity is written down.
    #
    # The draw happens only where the layer could act — a run with no focus
    # types is the same run either way, and enrolling it would dilute the
    # comparison with runs on which the treatment is a no-op. Eligibility is
    # decided from the student's diagnostic history, which is fixed before this
    # run starts and cannot be an outcome of the arm.
    if focus_types:
        targeting = experiments.assign(
            "weak_type_targeting", user.id, exposure=Exposure.run(session_id)
        )
        # The strategy trial still sees the unblanked list. Its `focus_types`
        # only lengthens the coverage runway on weak types, which is a decision
        # about a different layer; letting this arm move it too would bundle
        # two treatments into one label and make the reading below the effect
        # of neither.
        selection_focus_types = focus_types if targeting.on else []
    else:
        selection_focus_types = focus_types
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
    # Logical Reasoning only, when the shape draw chose an argument case. Not a
    # restriction so much as the other half of the split: with reading served as
    # whole passages, leaving RC in the general filler as well would put the
    # section's share back at the mercy of the review queue's size — measured,
    # 46.5% RC for a student with no queue against 41.5% for one with a queue,
    # neither of them the 34.4% asked for — and would do it by serving the
    # occasional stray passage inside an argument case, which is the shape this
    # change exists to stop building.
    #
    # A type-filtered drill is exempt. `question_type` is its own filter and
    # 1,373 questions in this bank carry "Reading Comprehension" as their type,
    # so narrowing by section as well would hand those drills an empty pool.
    fresh = select_random_questions(
        session_size - len(repairs),
        question_type,
        user_id=user.id,
        exclude_ids=blocked_ids,
        focus_types=selection_focus_types,
        section=None if question_type else LOGICAL_REASONING,
    )
    # Genuine interleaving, not front-loading. Reviews are distributed through
    # the run instead of stacked at the start, which is what the old
    # `repairs + fresh` concatenation did — and which leaks "these first four
    # are the ones you got wrong" before the student has read a word.
    questions = scheduling.interleave(repairs, fresh, question_type=question_type)
    return _build_practice_session(
        user,
        profile,
        questions,
        session_id=session_id,
        practice_style=practice_style,
        question_type=question_type,
        repair_ids=repair_ids,
        focus_types=focus_types,
    )


def _build_practice_session(
    user: User,
    profile,
    questions: list[Question],
    *,
    session_id: str,
    practice_style: str,
    question_type: str | None,
    repair_ids: set[str] | None = None,
    focus_types: list[str] | None = None,
) -> StudySession:
    """Write a chosen list of questions out as a run.

    Everything from here down is the same whichever shape chose the questions —
    the strategy trial, the forced-arm plan, the pace budget and the row writes.
    Extracted when the reading case arrived so the two shapes share it rather
    than growing a second copy that drifts.

    `session_id` is minted by the caller before the run is built, because the
    adaptive layers draw on it — see `create_study_session`. It is required
    rather than defaulted on purpose: `layer_assignments.session_id` has no
    foreign key behind it, so a caller that let this row generate its own id
    would write assignment rows naming a run that was never inserted, and
    nothing would raise. `layer_reading` would simply return nothing, for ever.
    """
    repair_ids = repair_ids or set()
    focus_types = focus_types or []
    policy = "immediate"
    if not questions:
        raise RuntimeError("No Hugging Face LSAT questions are available")

    # A new run always starts in_progress (see the StudySession default), so
    # whatever else was ticking must be paused first — see
    # `_pause_other_active_practice_sessions` for why this matters. Deferred
    # to this point so a validation failure above never has the side effect
    # of pausing a run that was otherwise left untouched.
    # Read before the pause below, which commits. A commit expires every instance
    # in the session, and an expired instance reloads in full on the first
    # attribute read — including its own primary key — so asking these objects
    # what they are afterwards costs one statement each. Their ids are plain
    # strings and survive.
    chosen_ids = [question.id for question in questions]

    _pause_other_active_practice_sessions(user.id)
    # One statement to bring the whole run back, rather than eight refreshes and
    # eight passage reads spread through the loop below.
    questions = _questions_by_id(chosen_ids)

    session = StudySession(
        id=session_id,
        user_id=user.id,
        mode="practice",
        practice_style=practice_style,
        feedback_policy=policy,
        target_minutes=user.target_minutes,
        total_items=len(questions),
    )
    db.session.add(session)
    db.session.flush()
    # The run's own id is the exposure token: it is what distinguishes meeting a
    # question in this run from meeting the same question at the same slot in the
    # next one, which is the difference every draw inside the trial is a draw
    # over. Passing the session means a returning review question is randomised
    # afresh each time it comes back rather than repeating the arm it drew the
    # first time — see `assign_strategy_trial`. It is available here because the
    # session was flushed above, and it is stable for the encounter because the
    # assignment is written onto the item below and never recomputed.
    trials = [
        (
            position,
            question,
            assign_strategy_trial(
                user.id, question, practice_style, position,
                exposure=session.id, focus_types=focus_types,
            ),
        )
        for position, question in enumerate(questions)
    ]
    # Which questions make their approach mandatory is decided for the run as a
    # whole rather than question by question, because the per-run cap is a
    # property of the run: a fixed quota drawn from a fixed pool gives every
    # pool member one exact, writable probability, where a position-by-position
    # draw would leave each one carrying a different probability for reasons
    # that have nothing to do with what is being measured. See
    # `strategies.plan_forced_arms`.
    forcing = plan_forced_arms(user.id, session.id, trials)
    previous_passage_id = None
    for position, question, strategy_trial in trials:
        if question.section == "Logical Reasoning":
            target_time_seconds = 150
        else:
            target_time_seconds = 135 if question.passage_id and question.passage_id == previous_passage_id else 330
        drawn = forcing.get(position) or {}
        if drawn.get("required"):
            strategy_trial = {**strategy_trial, "variant": VARIANT_PROMPT_REQUIRED}
        db.session.add(
            SessionItem(
                session_id=session.id,
                question_id=question.id,
                position=position,
                requires_reasoning=True,
                from_review_queue=question.id in repair_ids,
                strategy_key=strategy_trial["key"] if strategy_trial else None,
                strategy_variant=strategy_trial["variant"] if strategy_trial else None,
                # Still the propensity of being *offered a technique*, which is
                # the draw the dashboard's ranking rests on and which the
                # mandatory draw deliberately does not touch. The probability
                # of the second draw is its own column beside it.
                strategy_propensity=strategy_trial["propensity"] if strategy_trial else None,
                strategy_candidates_n=strategy_trial["candidates_n"] if strategy_trial else None,
                strategy_stratum=drawn.get("stratum"),
                strategy_forcing_propensity=drawn.get("forcing_propensity"),
                # Fixed here rather than at serve time so the gate a student
                # meets is the one their history at session start earned. Only
                # the prompt arms are ever enforced: leaving the control arm
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
    # A finished form still owing a blind review holds the "active diagnostic"
    # slot for routing, but it is not a run this can hand back: asking for a
    # new sitting has to produce one. Sealing the old form's answers is what
    # the blind review protects, and a fresh form reveals nothing about it.
    if active and active.status != "completed":
        db.session.commit()
        return active
    if accommodation_multiplier not in {1.0, 1.5, 2.0}:
        raise ValueError("invalid_accommodation")
    questions, section_indexes, section_plan = select_diagnostic_questions(int(current_app.config["DIAGNOSTIC_SESSION_SIZE"]))
    if not questions:
        raise RuntimeError("No Hugging Face LSAT questions are available")
    # Thirty-five minutes a section, plus the intermission, exactly as the real
    # administration is budgeted. `target_minutes` stays the sum of the working
    # sections — the break is not time a student is being measured over, and
    # every pace figure downstream divides by this.
    section_seconds = max(60, round(exam.SECTION_SECONDS * accommodation_multiplier))
    target_minutes = max(1, round(len(section_plan) * section_seconds / 60))
    started_at = utcnow()
    session = StudySession(
        user_id=user.id,
        mode="diagnostic",
        practice_style="diagnostic",
        feedback_policy="delayed",
        blind_review_required=True,
        accommodation_multiplier=accommodation_multiplier,
        # The blocks are the sections now, and each one carries its own clock
        # on its own row. What stays here is the map the results screen reads:
        # which questions belong to which section, and in what order.
        section_plan_json=[
            {key: value for key, value in section.items() if key != "minutes"}
            for section in section_plan
        ],
        target_minutes=target_minutes,
        total_items=len(questions),
        started_at=started_at,
    )
    db.session.add(session)
    db.session.flush()
    sections = exam.build_sections(session, section_plan, multiplier=accommodation_multiplier)
    by_index = {section.section_index: section for section in sections}
    for position, question in enumerate(questions):
        section = by_index[section_indexes[position]]
        db.session.add(
            SessionItem(
                session_id=session.id,
                question_id=question.id,
                position=position,
                section_index=section_indexes[position],
                requires_reasoning=False,
                # An even split of *this section's* clock across *this
                # section's* questions. Under section timing that is the only
                # target that can actually run out on a student, which is what
                # makes "over target" mean something on the results screen.
                target_time_seconds=exam.section_target_seconds(section),
            )
        )
    db.session.commit()
    # The POST that creates a form is the student saying they are sitting it
    # now — the confirmation gate happens in the client before it — so section
    # one starts here rather than leaving an armed-but-not-started state to
    # reason about. Sections two and three are begun explicitly.
    exam.start_section(session, sections[0].section_index)
    return session


def create_blind_review_session(user: User, diagnostic: StudySession) -> StudySession | None:
    """Create the diagnostic's one untimed retry set from incorrect answers.

    Returns None when the form was clean and there is nothing to retry, which
    is not an error: the caller releases the answers instead.
    """
    if not lock_user_profile(user.id):
        raise ValueError("onboarding_required")
    if diagnostic.user_id != user.id or diagnostic.mode != "diagnostic":
        raise ValueError("diagnostic_not_found")
    if diagnostic.status != "completed":
        raise ValueError("diagnostic_in_progress")
    if not diagnostic.blind_review_required:
        raise ValueError("blind_review_not_required")

    existing = _blind_review_record(diagnostic)
    if existing:
        if existing.status == "abandoned":
            existing.status = "in_progress"
            existing.ended_by_user = False
            db.session.commit()
        return existing

    missed_attempts = (
        Attempt.query.join(SessionItem)
        .filter(SessionItem.session_id == diagnostic.id, Attempt.is_correct.is_(False))
        .order_by(SessionItem.position.asc())
        .all()
    )
    if not missed_attempts:
        return None

    session = StudySession(
        user_id=user.id,
        diagnostic_session_id=diagnostic.id,
        mode="blind_review",
        practice_style="blind_review",
        feedback_policy="delayed",
        target_minutes=0,
        total_items=len(missed_attempts),
        section_plan_json=[],
    )
    db.session.add(session)
    db.session.flush()
    for position, attempt in enumerate(missed_attempts):
        original_item = attempt.session_item
        db.session.add(
            SessionItem(
                session_id=session.id,
                question_id=original_item.question_id,
                position=position,
                section_index=original_item.section_index,
                requires_reasoning=False,
                from_review_queue=True,
                target_time_seconds=original_item.target_time_seconds,
                # A blind review is deliberately untimed. We still retain
                # elapsed time for continuity, but it is never pace evidence.
                timer_compromised=True,
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
    # A mega-litigation is one sitting. Its clocks are wall-clock and nothing
    # stops them, so "paused" would be a lie the interface told about a run
    # that is still burning down. On a sectioned form this holds between
    # sections too, where no section clock is running but the sitting's own
    # grace period is.
    if session.mode == "diagnostic" and (session.deadline_at or exam.is_sectioned(session)):
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
    if session.mode == "diagnostic" and (session.deadline_at or exam.is_sectioned(session)):
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
    if session.mode == "diagnostic" and not answers_available(session):
        raise ValueError("blind_review_required")
    attempts = (
        Attempt.query.join(SessionItem)
        .filter(SessionItem.session_id == session.id)
        .order_by(SessionItem.position.asc())
        .all()
    )

    # Both halves of the pair open onto the same comparison: the diagnostic's
    # review and its blind review's review each show the timed answer beside
    # the untimed one.
    diagnostic = (
        session.diagnostic_session
        if session.mode == "blind_review"
        else session
        if session.mode == "diagnostic"
        else None
    )
    blind_review = _blind_review_record(diagnostic) if diagnostic else None
    diagnostic_attempts = (
        Attempt.query.join(SessionItem)
        .filter(SessionItem.session_id == diagnostic.id)
        .all()
        if diagnostic
        else []
    )
    blind_attempts = (
        Attempt.query.join(SessionItem)
        .filter(SessionItem.session_id == blind_review.id)
        .all()
        if blind_review and blind_review.status == "completed"
        else []
    )
    diagnostic_by_question = {
        attempt.session_item.question_id: attempt for attempt in diagnostic_attempts
    }
    blind_by_question = {
        attempt.session_item.question_id: attempt for attempt in blind_attempts
    }

    return {
        "session": serialize_session(session, False),
        "summary": session.summary_json or calculate_session_summary(session),
        "comparison": (
            {
                "diagnostic": {
                    "session_id": diagnostic.id,
                    "summary": diagnostic.summary_json or calculate_session_summary(diagnostic),
                },
                "blind_review": (
                    {
                        "session_id": blind_review.id,
                        "summary": blind_review.summary_json or calculate_session_summary(blind_review),
                    }
                    if blind_review and blind_review.status == "completed"
                    else None
                ),
            }
            if diagnostic
            else None
        ),
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
                "diagnostic_selected_label": (
                    diagnostic_by_question[attempt.session_item.question_id].selected_label
                    if attempt.session_item.question_id in diagnostic_by_question
                    else None
                ),
                "blind_review_selected_label": (
                    blind_by_question[attempt.session_item.question_id].selected_label
                    if attempt.session_item.question_id in blind_by_question
                    else None
                ),
                "blind_review_is_correct": (
                    blind_by_question[attempt.session_item.question_id].is_correct
                    if attempt.session_item.question_id in blind_by_question
                    else None
                ),
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
    session_size = int(current_app.config["PRACTICE_SESSION_SIZE"])
    # "A real run rather than a one-off", expressed as most of a run rather than
    # as a literal five, which was most of a ten-question run and is more than
    # one of six.
    substantial_run = max(2, round(session_size / 2))
    completed_cases = next(
        (item for item in completed_today if item.mode == "practice" and item.total_items >= substantial_run),
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
        next_action = {"kind": "start_cases", "label": f"Start {session_size} cases"}
    else:
        next_action = {"kind": "done", "label": "Daily docket complete"}

    return {
        "date": local_date.isoformat(),
        "timezone": timezone_name,
        "active_session": serialize_session(active, False) if active else None,
        "cases": {
            "state": cases_state,
            "target": session_size,
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


def _record_response(user_id: str, item: SessionItem, is_correct: bool, elapsed_ms: int) -> None:
    """Everything one answered question teaches, other than the attempt row itself.

    Two ledgers, kept together because they must never diverge: the per-type
    accuracy the dashboard reads, and the item's difficulty rating. Both are
    written before the `Attempt` exists, and both are reached only after the
    idempotency and already-graded guards in the two callers, so replaying a
    submit cannot double-count either.

    `exposure_policy` travels with the item rather than being inferred here.
    Today it is 'blind' on every row because selection does not read difficulty;
    the day it does, this is the value that keeps the estimate honest, and
    inferring it at this point would be inventing it.
    """
    _update_skill(user_id, item.question, is_correct, elapsed_ms)
    calibration.record_response(
        user_id,
        item.question,
        is_correct,
        exposure=item.exposure_policy or calibration.EXPOSURE_BLIND,
    )


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


def grade_exam_answer(session: StudySession, item: SessionItem, *, ended_at) -> Attempt | None:
    """Turn one filled-in answer on a closed section's sheet into an attempt.

    The counterpart to `submit_attempt` for a sectioned mega-litigation, and
    the reason it is separate: on the real test an answer is not an event. It
    is a mark on a sheet that can be changed until the bell, and only the bell
    decides what was written. So nothing here is reachable while the section is
    open, and everything here runs for the whole section at once.

    Deliberately absent, and each one for the same reason — it is not part of
    the administration and would cost a student clock they are being measured
    on: no confidence rating, no written reasoning, no game context, no fee, no
    strategy prompt. What is recorded instead is what the section itself
    produced: the answer, the time spent on that question across every visit to
    it, whether it was flagged, and how many times the answer was changed.

    Returns None if the item was already graded, so closing a section twice
    cannot double-count it.
    """
    if item.attempt:
        return item.attempt
    label = item.draft_selected_label
    if not label:
        return None
    question = item.question
    # Clamped the same way `submit_attempt` clamps, so pace statistics pool
    # across practice and exam attempts without one of them carrying outliers
    # the other cannot produce.
    elapsed_ms = max(1000, min(item.active_elapsed_ms or 0, 15 * 60 * 1000))
    is_correct = label == question.correct_answer
    _record_response(session.user_id, item, is_correct, elapsed_ms)
    attempt = Attempt(
        user_id=session.user_id,
        session_item_id=item.id,
        # One key per item, so a retried close is idempotent by construction
        # rather than by the caller remembering to check.
        idempotency_key=f"exam:{item.id}",
        selected_label=label,
        is_correct=is_correct,
        reasoning_text=None,
        confidence=None,
        # Measured rather than reported: free navigation means the server sees
        # every replacement.
        answer_changed=bool(item.answer_revisions),
        exposure_policy=item.exposure_policy or calibration.EXPOSURE_BLIND,
        evidence_class=EVIDENCE_CLASS.get(session.practice_style, EVIDENCE_CLASS.get(session.mode, "diagnostic")),
        server_elapsed_ms=elapsed_ms,
        client_elapsed_ms=None,
        capm_points=0,
        pace_scored=False,
        xp_earned=0,
        feedback_json=_feedback(question, label, is_correct, None),
        coaching_status="pending",
    )
    db.session.add(attempt)
    db.session.flush()
    _schedule_review(attempt)
    item.completed_at = item.completed_at or ended_at
    item.draft_updated_at = item.draft_updated_at or ended_at
    return attempt


def submit_attempt(
    user: User,
    session: StudySession,
    payload: dict,
    idempotency_key: str,
) -> tuple[Attempt, bool]:
    if not user.game_profile:
        raise ValueError("onboarding_required")
    if exam.is_sectioned(session):
        # A sectioned form has no per-question submit. Answers go onto the
        # sheet and the section's close grades them, which is what lets an
        # answer be changed and what makes the bell final.
        raise ValueError("exam_uses_answer_sheet")
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
    required_arm = item.strategy_variant == VARIANT_PROMPT_REQUIRED
    if item.strategy_key and item.strategy_variant in PROMPT_VARIANTS:
        raw_strategy_applied = payload.get("strategy_applied")
        if not isinstance(raw_strategy_applied, bool):
            # The mandatory arm asks for no decision, so a client that sends
            # none is answered rather than refused: the approach was ordered,
            # and not saying otherwise is taking it.
            if not required_arm:
                raise ValueError("strategy_decision_required")
            raw_strategy_applied = True
        strategy_applied = raw_strategy_applied
        try:
            strategy_prompt_ms = max(0, min(int(payload.get("strategy_prompt_ms") or 0), 60_000))
            strategy_gate_ms = max(0, min(int(payload.get("strategy_gate_ms") or 0), 10 * 60 * 1000))
        except (TypeError, ValueError):
            raise ValueError("invalid_strategy_prompt_time")
        # A gate whose operations annotate the stimulus has nothing to annotate
        # when the stimulus does not split, and `build_gate` returns None rather
        # than serve steps that could never be satisfied. The level was fixed at
        # session creation and cannot know that, so asking `validate_artifact`
        # for an artifact here would reject a student who was shown no steps to
        # produce one from — "Finish the approach first", with nothing to
        # finish, escapable only by skipping. The gate the student actually met
        # is the one that decides, and they met none.
        if enforcement_level == LEVEL_NONE or build_gate(item) is None:
            strategy_gate_status = STATUS_UNENFORCED
        elif not strategy_applied and required_arm:
            # The way out of a mandatory approach. It exists because forcing is
            # meant to shape behaviour rather than to build dead ends, and it
            # is refused until the student has actually run into the thing —
            # two refusals from the checks in `enforcement`, or a long enough
            # spell inside the panel. Nothing is charged either way; the only
            # consequence is that the file says the method was not filed.
            if not stand_down_available(item, strategy_gate_ms):
                raise GateRejection(
                    [{"field": None, "message": GATE_COPY["stand_down_locked"]}],
                    stand_down=False,
                )
            strategy_gate_status = STATUS_STOOD_DOWN
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
            except GateRejection as rejection:
                if enforcement_level == LEVEL_LIGHT:
                    # A student who has already cleared this gate eight times
                    # is taken at their word. The prompt still shows, the steps
                    # are optional, and the attempt is marked so no analysis
                    # confuses an attestation with a demonstration.
                    strategy_gate_status = STATUS_ATTESTED
                    strategy_artifact = None
                else:
                    # Counted on the server because it is what opens the way
                    # out above, and committed before the refusal leaves
                    # because the request is about to unwind. Every refusal is
                    # counted, mandatory or not: it is the same fact either
                    # way, and only the mandatory arm reads it.
                    item.strategy_gate_rejections = (item.strategy_gate_rejections or 0) + 1
                    db.session.commit()
                    if required_arm:
                        rejection.stand_down = stand_down_available(item, strategy_gate_ms)
                    raise
    elapsed_ms = max(1000, min(_elapsed_ms(item), 15 * 60 * 1000))
    is_correct = selected_label == item.question.correct_answer
    _record_response(user.id, item, is_correct, elapsed_ms)

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
        strategy_stratum=item.strategy_stratum,
        strategy_forcing_propensity=item.strategy_forcing_propensity,
        strategy_gate_rejections=item.strategy_gate_rejections or 0,
        strategy_enforcement_level=(enforcement_level if item.strategy_key else None),
        strategy_enforcement_version=(ENFORCEMENT_VERSION if strategy_gate_status else None),
        strategy_artifact_json=strategy_artifact or None,
        strategy_propensity=item.strategy_propensity,
        strategy_candidates_n=item.strategy_candidates_n,
        exposure_policy=item.exposure_policy or calibration.EXPOSURE_BLIND,
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
    # Eager, and narrowed to the four joined columns the summary reads. Left
    # lazy this fired two extra statements per answer — the item, then its
    # question — which for a 77-item mega-litigation is 155 statements to
    # summarise one run. It went unnoticed because `/performance` used to load
    # the whole account's attempt graph before calling this eleven times over,
    # so the identity map happened to be warm; narrowing that load to the
    # columns it actually needed left this one exposed, which is what an
    # accidental dependency on someone else's eager load looks like.
    attempts = (
        Attempt.query.join(SessionItem)
        .filter(SessionItem.session_id == session.id)
        .options(
            joinedload(Attempt.session_item)
            .load_only(SessionItem.section_index, SessionItem.timer_compromised)
            .joinedload(SessionItem.question)
            .load_only(Question.section, Question.question_type)
        )
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
    if exam.is_sectioned(session):
        report = exam.exam_summary(session)
        summary["exam"] = report
        # The section block the results screen already renders, but built from
        # the sections themselves rather than from whichever attempts happen to
        # exist — otherwise a section the clock ended with eight blanks reports
        # the accuracy of the seventeen that got answered.
        summary["sections"] = [
            {
                "index": entry["index"],
                "label": entry["label"],
                "correct": entry["correct"],
                "questions": entry["questions"],
                "answered": entry["answered"],
                "accuracy": entry["accuracy"],
                "elapsed_minutes": round(entry["seconds_on_questions"] / 60, 1),
                "timing_compromised": False,
            }
            for entry in report["sections"]
        ]
    # A promotion is granted once and recorded on the run that earned it. This
    # function is called again whenever a summary is refreshed, so carry it
    # across rather than dropping the one field that is not recomputable.
    promotion = (session.summary_json or {}).get("promotion")
    if promotion:
        summary["promotion"] = promotion
    return summary


def performance_snapshot(user: User) -> dict:
    # The twelve columns the aggregates below read, not the mapped graph they
    # used to be read off. See `scoring.AttemptFact`.
    attempts = attempt_facts(user.id)

    def summarize(values: list[AttemptFact]) -> dict:
        reasoning = [attempt.explanation_score * 100 for attempt in values if attempt.explanation_score is not None]
        pace_values = [attempt for attempt in values if not attempt.timer_compromised]
        pace_hits = [
            attempt.server_elapsed_ms <= attempt.target_time_seconds * 1000
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
    first_by_question: dict[str, AttemptFact] = {}
    for attempt in attempts:
        first_by_question.setdefault(attempt.question_id, attempt)
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

    grouped: dict[str, list[AttemptFact]] = defaultdict(list)
    for attempt in first_attempts:
        grouped[attempt.question_type].append(attempt)
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
            # The administration's own read-out, absent on a form sat before
            # sections existed. The dashboard branches on its presence rather
            # than back-filling one, because the numbers in it — blanks at the
            # bell, the split between the halves of a section — are not
            # recoverable from a sitting that had no bell and no halves.
            "exam": summary.get("exam"),
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

    by_evidence: dict[str, list[AttemptFact]] = defaultdict(list)
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
    lr_samples = sum(attempt.section == "Logical Reasoning" for attempt in test_values)
    rc_samples = sum(attempt.section == "Reading Comprehension" for attempt in test_values)
    completed_diagnostics = StudySession.query.filter_by(user_id=user.id, mode="diagnostic", status="completed").count()
    readiness_status = "ready" if lr_samples >= 40 and rc_samples >= 20 and completed_diagnostics else "forming"
    queue = review_queue_snapshot(user)
    review_values = [attempt for attempt in attempts if attempt.from_review_queue]
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
