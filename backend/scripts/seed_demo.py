"""Install a lived-in demo account: months of study history, a differentiated
strategy A/B record, and an advanced firm.

The script is deterministic and re-runnable. Every run replaces only the target
learner's study and game state, so repeated runs converge on the same account.

    .venv/bin/python backend/scripts/seed_demo.py            # dry run report
    .venv/bin/python backend/scripts/seed_demo.py --apply    # install

Study history is written directly rather than replayed through submit_attempt.
The demo needs an exact accuracy curve, an exact strategy-trial ledger, and
backdated timestamps across eleven weeks, none of which the live request path
can express. Everything the read models depend on is still produced here:
evidence classes, session summaries, skill rollups, and the spaced-review queue.

The economy is built through the real game module instead, so purchases, firm
advancement, story choices, and settlements all write consistent ledger rows.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import shutil
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import delete

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import create_app
from app import calibration
from app.enforcement import (
    ENFORCEMENT_VERSION,
    LEVEL_FULL,
    MASTERY_MIN_SATISFIED,
    STAND_DOWN_AFTER_REJECTIONS,
    STATUS_SATISFIED,
    STATUS_SKIPPED,
    STATUS_STOOD_DOWN,
)
from app.extensions import db
from app.game import (
    ASSET_BY_KEY,
    FIRM_TIERS,
    LedgerEntry,
    _missing_tier_assets,
    _tier_required_asset_keys,
    advance_firm,
    choose_story,
    create_profile,
    purchase_asset,
    select_client,
    serialize_game,
    settle_attempt,
    snapshot_case_context,
)
from app.models import (
    AiJob,
    Attempt,
    AttemptSettlement,
    DailyProgress,
    LearnerRating,
    PlayerProfile,
    Question,
    QuestionCalibration,
    ReviewQueueItem,
    SessionItem,
    SkillProgress,
    StudySession,
    User,
    utcnow,
)
from app.services import (
    EVIDENCE_CLASS,
    calculate_session_summary,
    create_study_session,
    performance_snapshot,
    serialize_item,
)
from app.story import QUEST_BY_KEY, ensure_story_state
from app.strategies import (
    SESSION_FORCED_CAP,
    STRATEGIES,
    VARIANT_PROMPT_REQUIRED,
    _candidate_keys,
    strategy_performance,
    stratum_key,
)

SEED_VERSION = "demo-seed-v2"
DEFAULT_EMAIL = "student@localhost.test"
RANDOM_SEED = 20260731

# Only Hugging Face `tasksource/lsat-*` rows are eligible. The OCR'd questions
# were removed from this database for licensing reasons and must never return.
ALLOWED_SOURCE_PREFIX = "https://huggingface.co/datasets/tasksource/lsat-"

HISTORY_DAYS = 77  # eleven weeks
DIAGNOSTIC_QUESTIONS = 78
TARGET_TIER = 4
DEMO_GRANT = 8_000_000
SETTLED_ATTEMPTS = 40

ACCURACY_START = .56
ACCURACY_END = .81
# The dashboard's headline delta compares the last twenty attempts against the
# twenty before them. Sampling accuracy from a probability cannot control a
# window that small - at n=20 the draw routinely lands both windows on the same
# number - so the closing attempts are assigned outcomes outright.
#
# `_stage_live_trial` appends two answered questions, so the recent window is
# the last 18 history attempts plus those two. Distances below are 1-indexed
# from the end of the written history.
LIVE_TAIL_ATTEMPTS = 2
RECENT_WINDOW = 20
TAIL_ATTEMPTS = 38
# Two misses in the recent window and four in the prior one, for a clearly
# positive delta that still leaves no session sitting on a suspicious 100%.
TAIL_FORCED_MISSES = frozenset({5, 12, 21, 25, 31, 35})

# Cosmetics the account already owns. `trophy_shelf` is deliberately left
# unowned and affordable so a purchase can be performed live on stage.
SEEDED_COSMETICS = (
    "bar_certificate",
    "banker_lamp",
    "persian_rug",
    "fig_tree",
    "chesterfield",
    "reporter_wall",
    "grandfather_clock",
    "skyline_painting",
)
LIVE_PURCHASE_COSMETIC = "trophy_shelf"

# Connections are not gates for firm advancement, but owning them unlocks the
# client book, which is what makes the firm screen look worked-in.
SEEDED_CONNECTIONS = ("local_bar", "business_network", "board_network", "civic_referral_council")


# --------------------------------------------------------------------------
# Strategy A/B plan
# --------------------------------------------------------------------------
# (key, prompted_n, prompted_correct, control_n, control_correct, skips)
#
# Six strategies clear the `supported` bar (8+ prompted and 4+ control) with
# deliberately differentiated lift: two strong winners, two solid, one roughly
# neutral, and one slightly negative, so the panel reads as a real experiment.
STRATEGY_PLAN = (
    ("prephrase", 16, 13, 7, 4, 2),            # +24 pts · the headline winner
    ("passage_map", 15, 12, 8, 5, 1),          # +18 pts
    ("viewpoint_ledger", 13, 10, 5, 3, 1),     # +17 pts
    ("argument_core", 18, 14, 8, 5, 2),        # +16 pts
    ("conditional_chain", 13, 9, 6, 4, 1),     # +2 pts  · roughly neutral
    ("textual_proof", 12, 8, 7, 5, 1),         # -4 pts  · costs this learner time
    ("flaw_abstraction", 7, 6, 3, 2, 0),       # directional
    ("causal_audit", 6, 5, 2, 1, 0),           # directional
    ("main_point_synthesis", 6, 4, 3, 2, 0),   # directional
    ("scope_precision", 4, 3, 1, 1, 0),        # forming
    ("negation_test", 3, 2, 1, 1, 0),          # forming
    ("paragraph_function", 2, 2, 0, 0, 0),     # forming, control arm not yet open
)

# Session schedule: (practice_style, questions). Every practice session is a
# "cases" run and every question in one carries a strategy trial. The sizes
# still vary so the demo history does not look mechanically uniform.
CASES_SIZES = (12, 16, 10, 8)

# How often a seeded run deals mandatory approaches, and how wide the pool it
# draws them from.
#
# The history writer lays its own rows down rather than calling
# `create_study_session`, so nothing here ever went past `plan_forced_arms` and
# the mandatory sub-arm was absent from the account entirely: not a thin sample
# but no rows at all, which left the panel that contrasts insisted-upon
# approaches against merely offered ones with nothing to draw and the whole
# read path unexercised. These deal it at roughly the rate the planner does —
# `SESSION_FORCED_CAP` of a three-question pool, in one run out of five, which
# stays inside the daily cap even on the two-sitting days.
FORCED_EVERY_NTH_RUN = 5
FORCED_POOL = 3
# How often a mandatory approach is taken as far as the way out of it.
FORCED_STAND_DOWN_EVERY = 4


def _fraction(*parts: object) -> float:
    """Stable pseudo-random value in [0, 1) for reproducible seeding."""
    digest = hashlib.sha256("|".join(str(part) for part in parts).encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") / float(2**64)


def _assert_local_only(app, email: str) -> None:
    uri = str(app.config["SQLALCHEMY_DATABASE_URI"])
    if app.config.get("ENV") == "production" or not app.config.get("DEV_AUTH_ENABLED"):
        raise RuntimeError("Demo seeding requires DEV_AUTH_ENABLED=true outside production.")
    if not uri.startswith("sqlite:"):
        raise RuntimeError("Demo seeding is restricted to a local SQLite database.")
    if not email.endswith("@localhost.test"):
        raise RuntimeError("Demo seeding only accepts an @localhost.test account.")


def _backup_database() -> str | None:
    database = db.engine.url.database
    if not database:
        return None
    source = Path(database).resolve()
    if not source.exists():
        return None
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = source.parent / f"{source.stem}.pre-demo-seed-{stamp}{source.suffix}"
    shutil.copy2(source, target)
    return str(target)


def _reset_calibration(user: User) -> None:
    """Undo the difficulty ratings a previous run of this script invented.

    Deleting the attempts is not enough: a rating is an accumulator, so a second
    seeding would stack another eleven weeks of invented answers on top of the
    first and hand the bank a confidence nothing earned. Every row this removes
    is one whose origin says it came from a seeder, and the demo seeder is the
    only thing in the repository that writes those, so a real cohort's ratings
    in the same database survive untouched.
    """
    db.session.execute(delete(LearnerRating).where(LearnerRating.user_id == user.id))
    db.session.execute(
        delete(QuestionCalibration).where(
            QuestionCalibration.origin.notin_(tuple(calibration.TRUSTED_ORIGINS))
        )
    )


def _reset_learner(user: User) -> None:
    """Remove this learner's study and game state, keeping the account itself.

    Review rows reference attempts and daily rows reference the profile, so the
    order here matters. Auth sessions are preserved so an open browser tab stays
    signed in across a re-run.
    """
    db.session.execute(delete(ReviewQueueItem).where(ReviewQueueItem.user_id == user.id))
    db.session.execute(delete(SkillProgress).where(SkillProgress.user_id == user.id))
    _reset_calibration(user)
    db.session.execute(delete(AiJob).where(AiJob.user_id == user.id))
    db.session.execute(delete(AttemptSettlement).where(AttemptSettlement.user_id == user.id))
    for session in StudySession.query.filter_by(user_id=user.id).all():
        db.session.delete(session)
    db.session.execute(delete(LedgerEntry).where(LedgerEntry.user_id == user.id))
    if user.game_profile:
        db.session.execute(delete(DailyProgress).where(DailyProgress.profile_id == user.game_profile.id))
        db.session.delete(user.game_profile)
    db.session.commit()
    db.session.expire_all()


# --------------------------------------------------------------------------
# Question pool
# --------------------------------------------------------------------------


class QuestionPool:
    """Licensed questions, indexed by section, type, and eligible strategy."""

    def __init__(self) -> None:
        rows = (
            Question.query.filter(Question.source.like(f"{ALLOWED_SOURCE_PREFIX}%"))
            .order_by(Question.id.asc())
            .all()
        )
        if not rows:
            raise RuntimeError("No Hugging Face tasksource LSAT questions are available.")
        self.all = rows
        self.by_type: dict[tuple[str, str], list[Question]] = defaultdict(list)
        self.by_strategy: dict[str, list[Question]] = defaultdict(list)
        for question in rows:
            self.by_type[(question.section, question.question_type)].append(question)
            for key in _candidate_keys(question):
                self.by_strategy[key].append(question)
        self.used: set[str] = set()

    def take_for_strategy(self, key: str, salt: object) -> Question:
        """A question for which `key` is a genuine candidate strategy."""
        candidates = self.by_strategy.get(key) or self.all
        return self._pick(candidates, salt)

    def take_for_type(self, section: str, question_type: str, salt: object) -> Question:
        candidates = self.by_type.get((section, question_type)) or self.all
        return self._pick(candidates, salt)

    def _pick(self, candidates: list[Question], salt: object) -> Question:
        start = int(_fraction(SEED_VERSION, salt) * len(candidates))
        for offset in range(len(candidates)):
            question = candidates[(start + offset) % len(candidates)]
            if question.id not in self.used:
                self.used.add(question.id)
                return question
        # Every candidate is spent; reuse is harmless because the read models
        # score only the first attempt per question.
        return candidates[start % len(candidates)]

    def type_cycle(self) -> list[tuple[str, str]]:
        """Section/type pairs ordered so every skill bar stays densely filled.

        Frequency-weighted, but with a floor for the rare types so no bar on the
        breakdown is left with a one-attempt sample.
        """
        pairs = sorted(self.by_type, key=lambda pair: (-len(self.by_type[pair]), pair))
        weighted: list[tuple[str, str]] = []
        for pair in pairs:
            share = len(self.by_type[pair]) / len(self.all)
            weighted.extend([pair] * max(3, round(share * 40)))
        return weighted


# --------------------------------------------------------------------------
# Trial plan
# --------------------------------------------------------------------------


def _build_trial_tokens() -> list[dict]:
    """Expand STRATEGY_PLAN into individual trial records.

    Each strategy's own tokens are ordered so its misses land in the earliest
    slots it receives. That keeps the account's accuracy curve rising even
    though the aggregate per-strategy accuracy is fixed by the plan.
    """
    tokens: list[dict] = []
    for key, prompted_n, prompted_correct, control_n, control_correct, skips in STRATEGY_PLAN:
        own: list[dict] = []
        for index in range(prompted_n):
            own.append(
                {
                    "key": key,
                    "variant": "prompt",
                    "applied": True,
                    # Misses first, so they can be pushed to early slots.
                    "correct": index >= (prompted_n - prompted_correct),
                }
            )
        for index in range(control_n):
            own.append(
                {
                    "key": key,
                    "variant": "control",
                    "applied": None,
                    "correct": index >= (control_n - control_correct),
                }
            )
        for _ in range(skips):
            own.append({"key": key, "variant": "prompt", "applied": False, "correct": False})
        own.sort(key=lambda token: token["correct"])
        tokens.append(own)

    # Interleave strategies so early slots cover many methods (matching the
    # coverage-forcing phase of assign_strategy_trial) and later slots
    # concentrate on the strategies with the most observations.
    ordered: list[dict] = []
    for depth in range(max(len(group) for group in tokens)):
        for group in tokens:
            if depth < len(group):
                ordered.append(group[depth])
    return ordered


# --------------------------------------------------------------------------
# Session construction
# --------------------------------------------------------------------------


def _study_calendar(now: datetime) -> list[datetime]:
    """Realistic session start times across eleven weeks.

    Real study looks like streaks and gaps, not a uniform grid: weekends are
    lighter, a couple of weeks go quiet, and busy days hold two sittings.
    """
    starts: list[datetime] = []
    for day in range(HISTORY_DAYS, 0, -1):
        date = now - timedelta(days=day)
        weekday = date.weekday()
        draw = _fraction(SEED_VERSION, "day", day)
        # Two deliberate quiet stretches: a travel week and a lighter mid-block.
        if 52 <= day <= 58 or 27 <= day <= 30:
            if draw > .22:
                continue
        elif weekday >= 5:
            if draw > .48:
                continue
        elif draw > .86:
            continue
        sittings = 2 if _fraction(SEED_VERSION, "sittings", day) > .62 else 1
        for index in range(sittings):
            slot = _fraction(SEED_VERSION, "hour", day, index)
            if index == 0:
                hour = 7 + int(slot * 3) if slot < .4 else 19 + int(slot * 3) % 3
            else:
                hour = 12 + int(slot * 2)
            minute = int(_fraction(SEED_VERSION, "minute", day, index) * 60)
            starts.append(date.replace(hour=min(22, hour), minute=minute, second=0, microsecond=0))
    starts.sort()
    return starts


def _session_plan(slot_count: int) -> list[tuple[str, int]]:
    """Assign a run size to each calendar slot.

    Every slot after the diagnostic is a cases run. Sizes cycle so the seeded
    history reads like real sittings rather than one repeated shape.
    """
    plan: list[tuple[str, int]] = [("diagnostic", DIAGNOSTIC_QUESTIONS)]
    body = slot_count - 1
    for index in range(body):
        plan.append(("cases", CASES_SIZES[index % len(CASES_SIZES)]))
    return plan[:slot_count]


def _accuracy_for(phase: float, salt: object) -> float:
    """Improving curve with natural noise, plus occasional bad days."""
    base = ACCURACY_START + (ACCURACY_END - ACCURACY_START) * phase
    noise = (_fraction(SEED_VERSION, "acc", salt) - .5) * .13
    if _fraction(SEED_VERSION, "slump", salt) > .90:
        noise -= .11
    return max(.34, min(.94, base + noise))


def _tail_outcome(attempts_from_end: int) -> bool | None:
    """Fixed outcome for a closing attempt, or None to use the session curve."""
    if attempts_from_end < 1 or attempts_from_end > TAIL_ATTEMPTS:
        return None
    return attempts_from_end not in TAIL_FORCED_MISSES


def _elapsed_ms(target_seconds: int, phase: float, salt: object) -> int:
    """Per-question time against target, including a credible overtime tail."""
    draw = _fraction(SEED_VERSION, "pace", salt)
    if draw > .87:
        # Roughly one question in eight runs over target.
        ratio = 1.02 + (draw - .87) * 2.4
    else:
        ratio = (.94 - .24 * phase) * (.70 + draw * .70)
    return max(18_000, min(900_000, round(target_seconds * 1000 * ratio)))


def _confidence(is_correct: bool, phase: float, salt: object) -> int:
    """Confidence that carries real calibration signal.

    High-confidence errors are what make a calibration display meaningful, so a
    deliberate minority of misses are rated 4 or 5, decreasing as skill grows.
    """
    draw = _fraction(SEED_VERSION, "conf", salt)
    if is_correct:
        if draw < .08:
            return 3
        if draw < .16:
            return 2 if phase < .4 else 3
        return 4 if draw < .62 else 5
    overconfident = .30 - .14 * phase
    if draw < overconfident:
        return 4 if draw < overconfident * .7 else 5
    return 1 if draw > .93 else 2 if draw < overconfident + .45 else 3


def _explanation_score(is_correct: bool, phase: float, salt: object) -> float:
    base = .58 + .30 * phase + (_fraction(SEED_VERSION, "expl", salt) - .5) * .18
    if not is_correct:
        base -= .12
    return max(.30, min(.97, round(base, 4)))


def _wrong_label(question: Question) -> str:
    labels = [choice.label for choice in question.choices]
    if not labels:
        return "A"
    index = labels.index(question.correct_answer) if question.correct_answer in labels else 0
    return labels[(index + 1) % len(labels)]


def _reasoning_text(question: Question) -> str:
    """Unique per question: `_is_reused_reasoning` invalidates duplicates."""
    correct = next((choice for choice in question.choices if choice.label == question.correct_answer), None)
    claim = (correct.canonical_text if correct else "")[:240]
    return (
        f"Case {question.id}: the stem asks me to {(question.stem or '').strip()[:180]} "
        f"I marked the conclusion, then separated it from the support offered for it. "
        f"Choice {question.correct_answer} is the credited answer because {claim} "
        "stays inside the evidence given, while every other option adds, reverses, or drops a required step."
    )


def _coaching_payload(question: Question, selected_label: str, is_correct: bool, grade: int | None) -> dict:
    correct = next((choice for choice in question.choices if choice.label == question.correct_answer), None)
    selected = next((choice for choice in question.choices if choice.label == selected_label), None)
    return {
        "provider": "Local deterministic demo",
        "model": SEED_VERSION,
        "reasoning_effort": "fixture",
        "prompt_version": SEED_VERSION,
        "explanation_grade": grade,
        "reasoning_verdict": (
            "strong" if grade is not None and grade >= 84 and is_correct
            else "mostly_correct" if grade is not None and is_correct
            else "partial" if grade is not None
            else "not_provided"
        ),
        "reasoning_summary": (
            "The response matched the verified answer and completed the stem's task."
            if is_correct
            else "The response chose a plausible distractor but missed the stem's controlling distinction."
        ),
        "understood_correctly": (
            "The comparison stayed tied to the stated task."
            if is_correct
            else "The response found a relevant option without finishing the task."
        ),
        "first_error": (
            None
            if is_correct or grade is None
            else {
                "code": "attractive_distractor",
                "description": "The comparison stopped at relevance instead of testing the exact task.",
                "repair": "Restate the stem as a one-line test, then reject any option failing one word of it.",
            }
        ),
        "answer_analysis": {
            "correct_answer_explanation": (
                f"Choice {question.correct_answer} is credited because it completes the stem's task: "
                f"{(correct.canonical_text if correct else '')[:320]}"
            ),
            "selected_answer_explanation": (
                f"Choice {selected_label} is the credited response."
                if is_correct
                else f"Choice {selected_label} echoes the topic, but {(selected.canonical_text if selected else '')[:260]} does not complete the task."
            ),
            "choice_explanations": [
                {
                    "label": choice.label,
                    "is_correct": choice.label == question.correct_answer,
                    "explanation": (
                        "This choice satisfies the verified task."
                        if choice.label == question.correct_answer
                        else "This choice is related to the text but changes a step the stem requires."
                    ),
                }
                for choice in question.choices
            ],
        },
        "next_step_hint": "If a choice is merely relevant, test it again against every operative word in the stem.",
        "solution_method": "1) Translate the stem. 2) Locate the controlling evidence. 3) Eliminate choices that change the task.",
        "debrief": "Keep the task visible while comparing choices. Relevance alone is not enough for credit.",
    }


def _feedback_payload(question: Question, selected_label: str, is_correct: bool, grade: int | None) -> dict:
    return {
        "correct_answer": question.correct_answer,
        "selected_answer": selected_label,
        "is_correct": is_correct,
        "coaching": _coaching_payload(question, selected_label, is_correct, grade),
    }


def _target_seconds(question: Question, previous_passage_id: str | None) -> int:
    if question.section == "Logical Reasoning":
        return 150
    if question.passage_id and question.passage_id == previous_passage_id:
        return 135
    return 330


# --------------------------------------------------------------------------
# History writer
# --------------------------------------------------------------------------


def _repair_question(
    review_pool: list[tuple[str, str]],
    trial: dict | None,
    salt: object,
    candidates: dict[str, list[str]],
) -> Question | None:
    """A review-queue question this run's planned approach genuinely fits.

    The bug this closes. A trial token is drawn first and a question is then
    chosen for it, but a repair *replaced* that question without the token being
    reconsidered — so an approach picked for a Logical Reasoning question landed
    on whatever the review queue happened to offer, and "Compare the two
    passages" ended up recorded against a Logical Reasoning question. It made 85
    such rows on the demo account, and they show in the Methods panel.

    The live path cannot do this: `services.create_study_session` settles the
    whole question list first and only then calls `assign_strategy_trial` on
    each question. This restores the same ordering the only way a script that
    plans its arms in advance can — by keeping the plan and moving the question,
    scanning the pool from a stable offset for one the approach is a candidate
    for. Returns None when the pool holds none, which leaves the position as
    fresh material rather than as a mismatch.
    """
    if not review_pool:
        return None
    start = int(_fraction(SEED_VERSION, "review", salt) * len(review_pool))
    for offset in range(len(review_pool)):
        question_id, _reason = review_pool[(start + offset) % len(review_pool)]
        question = db.session.get(Question, question_id)
        if question is None:
            continue
        if trial is None:
            return question
        if question_id not in candidates:
            candidates[question_id] = _candidate_keys(question)
        if trial["key"] in candidates[question_id]:
            return question
    return None


def _stage_forced_arms(
    rows: list[tuple[SessionItem, Attempt, Question, dict]],
    salt: object,
    satisfied_by_key: dict[str, int],
    stats: dict,
) -> None:
    """Make some of a run's approaches mandatory, the way the planner would.

    Takes `FORCED_POOL` of the run's prompted questions as the pool, gives every
    member of it the one inclusion probability the pool had, and draws
    `SESSION_FORCED_CAP` of them on a hash of the run — the same shape as
    `plan_forced_arms`, so the rows support the same weighted contrast rather
    than merely carrying its column names.

    One drawn question in every `FORCED_STAND_DOWN_EVERY` staged run is let out
    of the approach instead of working it, which is the only part of this that
    overrides the A/B plan: that attempt's takeup flips to declined. It has to,
    because a stand-down *is* a declined offer — the student met the gate, was
    refused twice, and took the way out — and a mandatory arm in which nobody
    ever reaches the exit would leave the one path here that cannot be tested by
    inspection looking like it works.

    Every other gate outcome follows from what the token already says the learner
    did, so the takeup and accuracy the A/B plan fixes stay as written: a
    question they worked is `satisfied` and one they declined is `skipped`.

    Runs are skipped rather than trimmed when a member would carry an approach
    past `MASTERY_MIN_SATISFIED` cleared gates, because that is the point at
    which the live gate relaxes to an attestation. Leaving the demo below it
    keeps the operations on screen where they can be shown.
    """
    if len(rows) < FORCED_POOL:
        return
    pool = rows[:FORCED_POOL]
    would_satisfy: dict[str, int] = defaultdict(int)
    for item, _attempt, _question, trial in pool:
        if trial["applied"] is not False:
            would_satisfy[item.strategy_key] += 1
    if any(
        satisfied_by_key.get(key, 0) + count >= MASTERY_MIN_SATISFIED
        for key, count in would_satisfy.items()
    ):
        return

    propensity = SESSION_FORCED_CAP / len(pool)
    drawn = sorted(
        range(len(pool)), key=lambda index: _fraction(SEED_VERSION, "force", salt, index)
    )[:SESSION_FORCED_CAP]
    stands_down = drawn[0] if stats["forced_runs"] % FORCED_STAND_DOWN_EVERY == 0 else None
    stats["forced_runs"] += 1

    for index, (item, attempt, question, trial) in enumerate(pool):
        required = index in set(drawn)
        item.strategy_stratum = attempt.strategy_stratum = stratum_key(item.strategy_key, question)
        item.strategy_forcing_propensity = attempt.strategy_forcing_propensity = propensity
        item.strategy_enforcement_level = attempt.strategy_enforcement_level = LEVEL_FULL
        attempt.strategy_enforcement_version = ENFORCEMENT_VERSION
        if required:
            item.strategy_variant = attempt.strategy_variant = VARIANT_PROMPT_REQUIRED
        # Time inside the panel is part of the question's recorded time, not
        # added to it, because pace scoring subtracts it back out.
        gate_ms = min(50_000, int(attempt.server_elapsed_ms * .34))
        if index == stands_down:
            attempt.strategy_applied = False
            attempt.strategy_gate_status = STATUS_STOOD_DOWN
            attempt.strategy_gate_ms = gate_ms
            item.strategy_gate_rejections = attempt.strategy_gate_rejections = (
                STAND_DOWN_AFTER_REJECTIONS
            )
            stats["stood_down"] += 1
        elif trial["applied"] is not False:
            attempt.strategy_gate_status = STATUS_SATISFIED
            attempt.strategy_gate_ms = gate_ms
            satisfied_by_key[item.strategy_key] = satisfied_by_key.get(item.strategy_key, 0) + 1
        else:
            attempt.strategy_gate_status = STATUS_SKIPPED
        stats["forced" if required else "forced_pool"] += 1


def _write_history(user: User, pool: QuestionPool, now: datetime) -> dict:
    calendar = _study_calendar(now)
    plan = _session_plan(len(calendar))
    tokens = _build_trial_tokens()
    token_index = 0
    type_cycle = pool.type_cycle()
    type_cursor = 0
    review_pool: list[tuple[str, str]] = []  # (question_id, reason_code)
    # Candidate approaches per question, for the repair scan below. The pool's
    # own index cannot answer this: it is keyed the other way round, approach to
    # questions, and it only holds unspent questions.
    candidates: dict[str, list[str]] = {}
    stats = {
        "sessions": 0,
        "attempts": 0,
        "trials": 0,
        "controls": 0,
        "skips": 0,
        "repairs": 0,
        "repairs_declined": 0,
        "mismatched": 0,
        "forced": 0,
        "forced_pool": 0,
        "forced_runs": 0,
        "stood_down": 0,
        "by_style": defaultdict(int),
    }
    satisfied_by_key: dict[str, int] = {}

    # Count eligible slots up front so the trial plan can be stretched to fill
    # every one of them; every question in a cases run carries a trial in the
    # live code path, so leaving one empty would be a lie.
    eligible_slots = sum(size for style, size in plan if style == "cases")
    planned_tokens = len(tokens)
    if eligible_slots > planned_tokens:
        # Repeat the plan cyclically. Duplicating a balanced cross-section keeps
        # every status and lift directionally intact rather than inventing arms.
        tokens += [dict(tokens[index % planned_tokens]) for index in range(eligible_slots - planned_tokens)]

    # Running attempt totals let the closing questions be shaped by their
    # distance from the end of the whole history rather than their session.
    planned_total = sum(size for _style, size in plan)
    attempts_before: list[int] = []
    running = 0
    for _style, size in plan:
        attempts_before.append(running)
        running += size

    for slot_index, (started_at, (style, size)) in enumerate(zip(calendar, plan)):
        phase = slot_index / max(1, len(plan) - 1)
        accuracy = _accuracy_for(phase, slot_index)
        mode = "diagnostic" if style == "diagnostic" else "practice"
        requires_reasoning = style != "diagnostic"
        feedback_policy = "delayed" if style == "diagnostic" else "immediate"
        evidence_class = EVIDENCE_CLASS[style]

        section_plan = None
        if style == "diagnostic":
            section_plan = [
                {"index": 0, "label": "Logical Reasoning I", "minutes": 35, "questions": 25},
                {"index": 1, "label": "Reading Comprehension", "minutes": 35, "questions": 27},
                {"index": 2, "label": "Logical Reasoning II", "minutes": 35, "questions": 26},
            ]

        session = StudySession(
            user_id=user.id,
            mode=mode,
            practice_style=style,
            feedback_policy=feedback_policy,
            status="completed",
            target_minutes=105 if style == "diagnostic" else 20,
            total_items=size,
            section_plan_json=section_plan,
            started_at=started_at,
        )
        db.session.add(session)
        db.session.flush()

        cursor = started_at
        previous_passage_id: str | None = None
        prompted_rows: list[tuple[SessionItem, Attempt, Question, dict]] = []
        for position in range(size):
            salt = (slot_index, position)
            trial: dict | None = None
            if style == "cases" and token_index < len(tokens):
                trial = tokens[token_index]
                token_index += 1

            # Repairs occupy the first positions of a run, capped at half of it,
            # mirroring how create_study_session seeds them.
            is_repair = bool(
                style == "cases" and review_pool and position < size // 2 and position % 3 == 0
            )
            repair_question = None
            if is_repair:
                repair_question = _repair_question(review_pool, trial, salt, candidates)
                stats["repairs" if repair_question is not None else "repairs_declined"] += 1
            if repair_question is not None:
                question = repair_question
            elif trial:
                question = pool.take_for_strategy(trial["key"], salt)
            elif style == "diagnostic":
                section = "Reading Comprehension" if 25 <= position < 52 else "Logical Reasoning"
                choices = [pair for pair in type_cycle if pair[0] == section]
                question = pool.take_for_type(*choices[type_cursor % len(choices)], salt)
                type_cursor += 1
            else:
                question = pool.take_for_type(*type_cycle[type_cursor % len(type_cycle)], salt)
                type_cursor += 1

            target_seconds = _target_seconds(question, previous_passage_id)
            previous_passage_id = question.passage_id
            section_index = 0
            if style == "diagnostic":
                section_index = 0 if position < 25 else 1 if position < 52 else 2

            # Counted rather than asserted, so one stale row cannot stop a seed
            # that takes minutes — but `_verify` refuses to report success while
            # it is non-zero, which is what makes this a check.
            if trial and STRATEGIES[trial["key"]]["section"] != question.section:
                stats["mismatched"] += 1

            item = SessionItem(
                session_id=session.id,
                question_id=question.id,
                position=position,
                section_index=section_index,
                requires_reasoning=requires_reasoning,
                from_review_queue=is_repair and repair_question is not None,
                strategy_key=trial["key"] if trial else None,
                strategy_variant=trial["variant"] if trial else None,
                target_time_seconds=target_seconds,
            )
            db.session.add(item)
            db.session.flush()

            attempts_from_end = planned_total - (attempts_before[slot_index] + position)
            if trial:
                # A trial's outcome is fixed by the A/B plan, which owns the lift
                # numbers, so it always wins over the closing-window shaping.
                is_correct = bool(trial["correct"])
            else:
                forced = _tail_outcome(attempts_from_end)
                is_correct = (
                    forced
                    if forced is not None
                    else _fraction(SEED_VERSION, "outcome", salt) < accuracy
                )

            elapsed = _elapsed_ms(target_seconds, phase, salt)
            prompt_ms = 0
            if trial and trial["variant"] == "prompt":
                # Time spent reading the brief is recorded separately so pace
                # analysis can subtract it, exactly as the live client does.
                prompt_ms = 4_000 + int(_fraction(SEED_VERSION, "promptms", salt) * 11_000)
                if trial["applied"] is False:
                    prompt_ms = 1_500 + int(_fraction(SEED_VERSION, "skipms", salt) * 2_500)
                elapsed += prompt_ms

            selected_label = question.correct_answer if is_correct else _wrong_label(question)
            confidence = _confidence(is_correct, phase, salt)
            grade = None
            explanation_score = None
            if requires_reasoning:
                explanation_score = _explanation_score(is_correct, phase, salt)
                grade = round(explanation_score * 100)

            completed_at = cursor + timedelta(milliseconds=elapsed)
            item.served_at = cursor
            item.timer_activated_at = cursor
            item.active_elapsed_ms = elapsed
            item.completed_at = completed_at

            attempt = Attempt(
                user_id=user.id,
                session_item_id=item.id,
                idempotency_key=f"{SEED_VERSION}:{session.id}:{position}",
                selected_label=selected_label,
                is_correct=is_correct,
                reasoning_text=_reasoning_text(question) if requires_reasoning else None,
                confidence=confidence,
                answer_changed=_fraction(SEED_VERSION, "changed", salt) > .84,
                strategy_key=trial["key"] if trial else None,
                strategy_variant=trial["variant"] if trial else None,
                strategy_applied=trial["applied"] if trial else None,
                strategy_prompt_ms=prompt_ms,
                evidence_class=evidence_class,
                explanation_score=explanation_score,
                explanation_score_applied=explanation_score is not None,
                server_elapsed_ms=elapsed,
                client_elapsed_ms=elapsed,
                capm_points=0,
                pace_scored=False,
                xp_earned=0,
                feedback_json=_feedback_payload(question, selected_label, is_correct, grade),
                coaching_status="completed",
                coaching_model=SEED_VERSION,
                coached_at=completed_at + timedelta(seconds=18),
                created_at=completed_at,
            )
            db.session.add(attempt)
            # This path builds its attempts by hand rather than going through
            # `submit_attempt`, so the difficulty rating has to be told about
            # them here or eleven weeks of demo history would leave the bank as
            # uncalibrated as it started. `seed_demo` runs inside
            # `responses_marked`, which is what stops these counting as earned.
            calibration.record_response(
                user.id,
                question,
                is_correct,
                exposure=item.exposure_policy or calibration.EXPOSURE_BLIND,
                now=completed_at,
            )

            if trial:
                stats["trials"] += trial["variant"] == "prompt" and trial["applied"] is True
                stats["controls"] += trial["variant"] == "control"
                stats["skips"] += trial["applied"] is False
                if trial["variant"] == "prompt":
                    prompted_rows.append((item, attempt, question, trial))

            # Mirror _schedule_review's reason codes so the queue looks earned.
            if not (is_repair and repair_question is not None):
                reason = None
                if not is_correct:
                    reason = "high_confidence_error" if confidence >= 4 else "incorrect"
                elif confidence <= 2:
                    reason = "low_confidence_correct"
                elif elapsed > target_seconds * 1000:
                    reason = "slow_correct"
                if reason:
                    review_pool.append((question.id, reason))

            cursor = completed_at
            stats["attempts"] += 1

        if style == "cases" and slot_index % FORCED_EVERY_NTH_RUN == 0:
            _stage_forced_arms(prompted_rows, slot_index, satisfied_by_key, stats)

        session.completed_at = cursor
        session.current_index = size
        session.results_seen_at = cursor + timedelta(minutes=2)
        session.summary_seen_at = cursor + timedelta(minutes=2)
        db.session.flush()
        session.summary_json = calculate_session_summary(session)
        stats["sessions"] += 1
        stats["by_style"][style] += 1
        db.session.commit()
        if stats["sessions"] % 10 == 0:
            print(
                f"  … {stats['sessions']}/{len(plan)} sessions, {stats['attempts']} attempts",
                file=sys.stderr,
                flush=True,
            )

    stats["by_style"] = dict(stats["by_style"])
    stats["trial_slots"] = eligible_slots
    # A non-zero value means the schedule has fewer eligible slots than the
    # strategy plan needs, which would silently weaken the A/B panel.
    stats["trials_unplaced"] = max(0, len(tokens) - token_index)
    stats["review_candidates"] = len(review_pool)
    return {"stats": stats, "review_pool": review_pool}


# --------------------------------------------------------------------------
# Derived learner tables
# --------------------------------------------------------------------------


def _rebuild_skill_progress(user: User) -> int:
    """Recompute SkillProgress with the same semantics as _update_skill."""
    db.session.execute(delete(SkillProgress).where(SkillProgress.user_id == user.id))
    db.session.flush()
    attempts = (
        Attempt.query.filter_by(user_id=user.id)
        .join(SessionItem)
        .order_by(Attempt.created_at.asc())
        .all()
    )
    rollup: dict[str, dict] = {}
    for attempt in attempts:
        name = attempt.session_item.question.question_type
        row = rollup.setdefault(
            name,
            {"attempts": 0, "correct": 0, "total_time_ms": 0, "explanation_total": 0.0, "explanation_count": 0, "recent_mistakes": 0},
        )
        row["attempts"] += 1
        row["correct"] += int(attempt.is_correct)
        row["total_time_ms"] += attempt.server_elapsed_ms
        row["recent_mistakes"] = 0 if attempt.is_correct else row["recent_mistakes"] + 1
        if attempt.explanation_score is not None:
            row["explanation_total"] += attempt.explanation_score
            row["explanation_count"] += 1
    for name, row in rollup.items():
        db.session.add(SkillProgress(user_id=user.id, skill_name=name, **row))
    db.session.commit()
    return len(rollup)


def _build_review_queue(user: User, review_pool: list[tuple[str, str]], now: datetime) -> dict:
    """Populate the spaced-repetition queue with a realistic mix of states."""
    db.session.execute(delete(ReviewQueueItem).where(ReviewQueueItem.user_id == user.id))
    db.session.flush()

    attempt_by_question: dict[str, Attempt] = {}
    for attempt in (
        Attempt.query.filter_by(user_id=user.id)
        .join(SessionItem)
        .order_by(Attempt.created_at.asc())
        .all()
    ):
        attempt_by_question[attempt.session_item.question_id] = attempt

    seen: set[str] = set()
    entries: list[tuple[str, str]] = []
    for question_id, reason in reversed(review_pool):
        if question_id in seen:
            continue
        seen.add(question_id)
        entries.append((question_id, reason))
        if len(entries) >= 34:
            break

    counts = {"due": 0, "scheduled": 0, "mastered": 0}
    for index, (question_id, reason) in enumerate(entries):
        attempt = attempt_by_question.get(question_id)
        if index < 9:
            # Overdue, so the review surface has work waiting on stage.
            status, interval, due_at = "due", 0, now - timedelta(days=1, hours=index * 3)
            counts["due"] += 1
        elif index < 24:
            status, interval = "due", 1 + index % 3
            due_at = now + timedelta(days=1 + (index - 9) * .6, hours=index)
            counts["scheduled" if due_at > now else "due"] += 1
        else:
            status, interval, due_at = "mastered", 4, now + timedelta(days=21 + index)
            counts["mastered"] += 1
        db.session.add(
            ReviewQueueItem(
                user_id=user.id,
                question_id=question_id,
                source_attempt_id=attempt.id if attempt else None,
                last_attempt_id=attempt.id if attempt else None,
                status=status,
                reason_code=reason,
                interval_index=interval,
                due_at=due_at,
                created_at=attempt.created_at if attempt else now,
            )
        )
    db.session.commit()
    counts["total"] = len(entries)
    return counts


# --------------------------------------------------------------------------
# Economy
# --------------------------------------------------------------------------


def _prepare_profile(user: User, now: datetime) -> PlayerProfile:
    profile = create_profile(
        user,
        {
            "lawyer_name": user.display_name or "Local Student",
            "firm_name": "Mercer & Vale",
            "character_gender": "female",
        },
    )
    profile.cash += DEMO_GRANT
    profile.lifetime_earnings += DEMO_GRANT
    # Reputation has to clear each purchase gate before the catalog will sell.
    # A months-old winning record is exactly what would have produced this.
    profile.reputation = 78.0
    profile.last_passive_collected_at = now
    profile.upkeep_settled_at = now
    profile.last_active_at = now
    db.session.add(
        LedgerEntry(
            user_id=user.id,
            kind="demo_seed_grant",
            # Profile-scoped, matching _scoped_source, so a re-run with a new
            # profile cannot collide on UNIQUE (user_id, kind, source_id).
            source_id=f"{profile.id}:{SEED_VERSION}",
            amount=DEMO_GRANT,
            balance_after=profile.cash,
            detail_json={"label": "Retained earnings from prior representation"},
        )
    )
    db.session.commit()
    return db.session.get(PlayerProfile, profile.id)


def _purchase_in_order(profile: PlayerProfile, keys: list[str]) -> list[str]:
    """Buy every asset whose gates are currently satisfied.

    Ordering is not simply by tier: a tier-gated rival can depend on a
    connection, which is not itself a tier requirement. So this repeats until it
    stops making progress and silently leaves anything still gated by office
    tier, reputation, or an unowned prerequisite for a later pass.
    """
    pending = list(keys)
    bought: list[str] = []
    while pending:
        progressed = False
        deferred: list[str] = []
        for key in pending:
            owned = {asset.asset_key for asset in profile.assets}
            if key in owned:
                continue
            item = ASSET_BY_KEY[key]
            gated = (
                profile.office_tier < item.get("tier", 0)
                or profile.reputation < item.get("reputation", 0)
                or any(requirement not in owned for requirement in item.get("requires", []))
                or profile.cash < item["cost"]
            )
            if gated:
                deferred.append(key)
                continue
            purchase_asset(profile, key)
            bought.append(key)
            progressed = True
            db.session.refresh(profile)
        if not progressed:
            break
        pending = deferred
    return bought


def _build_firm(user: User) -> dict:
    profile = user.game_profile
    bought: list[str] = []
    for tier in range(1, TARGET_TIER + 1):
        # Connections open up as the office tier rises and are prerequisites for
        # some tier-gated rivals, so they are retried on every step.
        bought += _purchase_in_order(profile, [*SEEDED_CONNECTIONS, *_tier_required_asset_keys(tier)])
        db.session.refresh(profile)
        missing = _missing_tier_assets(tier, {asset.asset_key for asset in profile.assets})
        if missing:
            raise RuntimeError(f"Cannot reach tier {tier}; still missing {missing}")
        advance_firm(profile, tier)
        db.session.refresh(profile)
    bought += _purchase_in_order(profile, [*SEEDED_CONNECTIONS, *SEEDED_COSMETICS])
    db.session.refresh(profile)

    # A signed client at the current tier makes the case terms on every question
    # read like real work rather than a walk-in.
    for client_key in ("property_developer", "wealthy_client", "small_business"):
        try:
            select_client(profile, client_key)
            break
        except ValueError:
            continue
    db.session.refresh(profile)
    return {"purchased": bought, "office_tier": profile.office_tier}


def _advance_story(user: User) -> dict:
    profile = user.game_profile
    ensure_story_state(profile)
    db.session.commit()
    resolved = []
    # Principled choices, matching an account with high reputation.
    for chapter_key, choice_key in (
        ("one_light_on", "open_door"),
        ("the_harrow_file", "share_file"),
        ("city_hall_cipher", "publish_cipher"),
    ):
        try:
            resolved.append(choose_story(profile, chapter_key, choice_key))
        except ValueError:
            continue
        db.session.refresh(profile)

    state = profile.story_state
    state.intel = max(state.intel, 6)
    state.influence = max(state.influence, 7)
    db.session.commit()
    return {"chapters": [entry["chapter"] for entry in resolved]}


def _stage_active_quest(user: User) -> dict:
    """Leave a quest in flight, after settlements have stopped consuming them.

    Settlement runs `advance_quest`, so anything set active before that point is
    completed by the recent case history instead of staying open for the demo.
    """
    state = user.game_profile.story_state
    history = [key for key in (state.quest_history_json or []) if key in QUEST_BY_KEY]
    for key in ("mercer_overflow", "harrow_missing_deed"):
        if key not in history:
            history.append(key)
    active = next(
        (
            quest["key"]
            for quest in (QUEST_BY_KEY[key] for key in ("innocence_archive", "city_hall_trail", "clinic_coverup"))
            if quest["key"] not in history and quest["tier"] <= user.game_profile.office_tier
        ),
        None,
    )
    state.quest_history_json = history
    state.active_quest_key = active
    state.quest_progress = 2 if active else 0
    db.session.commit()
    return {"completed_quests": history, "active_quest": active}


def _settle_recent(user: User) -> dict:
    """Run real settlements on the most recent coached attempts.

    This is what makes the ledger, reputation, streaks, and case counters real
    rather than hand-written: every row goes through game.settle_attempt.
    """
    profile = user.game_profile
    attempts = (
        Attempt.query.filter_by(user_id=user.id)
        .join(SessionItem)
        .join(StudySession)
        .filter(StudySession.practice_style == "cases")
        .order_by(Attempt.created_at.desc())
        .limit(SETTLED_ATTEMPTS)
        .all()
    )
    settled = 0
    for attempt in reversed(attempts):
        item = attempt.session_item
        if item.game_context_json is None:
            item.game_context_json = snapshot_case_context(profile)
            db.session.commit()
        coaching = (attempt.feedback_json or {}).get("coaching") or {}
        if settle_attempt(attempt, coaching) is not None:
            settled += 1
        db.session.commit()
        db.session.refresh(profile)
    return {"settled": settled, "cash": profile.cash, "reputation": profile.reputation}


def _align_profile_counters(user: User) -> None:
    """Make the firm's lifetime counters match the full study history.

    Settlements only cover the recent window, but the account is supposed to
    look like months of work, so the case counters are extended to the whole
    attempt history while streaks stay consistent with the recent record.
    """
    profile = user.game_profile
    attempts = Attempt.query.filter_by(user_id=user.id).all()
    correct = sum(attempt.is_correct for attempt in attempts)
    validated = sum(
        1
        for attempt in attempts
        if attempt.is_correct and (attempt.explanation_score or 0) >= .5
    )
    profile.total_cases = max(profile.total_cases, len(attempts))
    profile.total_correct = max(profile.total_correct, correct)
    profile.total_validated_correct = max(profile.total_validated_correct, validated)
    profile.best_streak = max(profile.best_streak, 14)
    profile.lifetime_rent_paid = max(profile.lifetime_rent_paid, 96_000)
    db.session.commit()


def _refresh_daily(user: User) -> None:
    profile = user.game_profile
    today = utcnow().date()
    daily = DailyProgress.query.filter_by(profile_id=profile.id, activity_date=today).first()
    if not daily:
        daily = DailyProgress(profile_id=profile.id, activity_date=today)
        db.session.add(daily)
    # Two of the three daily goals already met and unclaimed, so a reward can be
    # collected live without needing to finish a case first.
    daily.cases_completed = max(daily.cases_completed, 12)
    daily.claimed_json = [5]
    db.session.commit()


# --------------------------------------------------------------------------
# Live A/B staging
# --------------------------------------------------------------------------


def _stage_live_trial(user: User, *, attempts: int = 60) -> dict:
    """Leave one live session whose third question carries a prompted trial.

    Variant assignment is a hash of user, question, position and the run's own
    id, so a fresh session lands on the control arm about a quarter of the
    time. Sessions are created and discarded here until one has a `prompt`
    variant at position 2, and that session is left open. `create_study_session`
    returns the resumable session, so the demo cannot draw a different one.

    The run id in that hash is what makes the retry loop below terminate
    quickly. Before it was there, the arm was a function of the student, the
    question and the slot alone, so every discarded session redrew exactly the
    same arm and the loop's only source of variation was the questions the
    sampler happened to pick.

    Positions 0 and 1 are pre-answered, leaving the learner one question away
    from the brief.
    """
    for existing in StudySession.query.filter(
        StudySession.user_id == user.id,
        StudySession.status.in_(["in_progress", "paused"]),
    ).all():
        db.session.delete(existing)
    db.session.commit()

    for round_index in range(attempts):
        session = create_study_session(user, count=8)
        item = SessionItem.query.filter_by(session_id=session.id, position=2).first()
        if item and item.strategy_variant == "prompt" and item.strategy_key:
            for position in (0, 1):
                pre = SessionItem.query.filter_by(session_id=session.id, position=position).one()
                serialize_item(pre)
                question = pre.question
                elapsed = 62_000 + position * 9_000
                pre.active_elapsed_ms = elapsed
                pre.timer_started_at = None
                pre.completed_at = utcnow()
                db.session.add(
                    Attempt(
                        user_id=user.id,
                        session_item_id=pre.id,
                        idempotency_key=f"{SEED_VERSION}:live:{session.id}:{position}",
                        selected_label=question.correct_answer,
                        is_correct=True,
                        confidence=4,
                        strategy_key=pre.strategy_key,
                        strategy_variant=pre.strategy_variant,
                        strategy_prompt_ms=0,
                        evidence_class=EVIDENCE_CLASS["cases"],
                        server_elapsed_ms=elapsed,
                        client_elapsed_ms=elapsed,
                        feedback_json=_feedback_payload(question, question.correct_answer, True, None),
                        coaching_status="completed",
                        coaching_model=SEED_VERSION,
                        coached_at=utcnow(),
                    )
                )
                calibration.record_response(
                    user.id,
                    question,
                    True,
                    exposure=pre.exposure_policy or calibration.EXPOSURE_BLIND,
                )
                db.session.flush()
            session.current_index = 2
            session.pending_attempt_id = None
            session.status = "in_progress"
            db.session.commit()
            # Serve the trial question so the item is frozen and timing starts
            # only when the demo actually opens the tab.
            payload = serialize_item(item)
            return {
                "session_id": session.id,
                "practice_style": "cases",
                "position": item.position,
                "question_number": item.position + 1,
                "strategy_key": item.strategy_key,
                "strategy_title": STRATEGIES[item.strategy_key]["title"],
                "strategy_section": STRATEGIES[item.strategy_key]["section"],
                "variant": item.strategy_variant,
                "renders_prompt": bool(payload.get("strategy_trial")),
                "attempts_needed": round_index + 1,
                "url": f"http://localhost:5173/cases/{session.id}",
            }
        # Discard and draw a different question set.
        db.session.delete(session)
        db.session.commit()
    raise RuntimeError("Could not stage a prompted strategy trial after repeated attempts.")


# --------------------------------------------------------------------------
# Verification
# --------------------------------------------------------------------------

# `strategy_performance` used to label each result `supported` / `directional` /
# `forming`. It no longer does: the panel deliberately refuses to publish a
# per-strategy verdict, so it now returns a `leader` and a `ranking_score` and
# nothing else. These thresholds are the retired bar, kept here because this
# report is the only thing that still needs it — STRATEGY_PLAN above is written
# to clear exactly this line, and without it the plan's arms cannot be checked.
SUPPORTED_PROMPTED = 8
SUPPORTED_CONTROL = 4
DIRECTIONAL_PROMPTED = 5


def _lab_status(result: dict) -> str:
    if result["sample"] >= SUPPORTED_PROMPTED and result["control_sample"] >= SUPPORTED_CONTROL:
        return "supported"
    if result["sample"] >= DIRECTIONAL_PROMPTED and result["control_sample"] >= 1:
        return "directional"
    return "forming"


def _cross_section_rows(user: User) -> int:
    """Rows recording an approach against a question from the other section.

    Read back off the database rather than trusted from the writer, because the
    thing being checked is what a student would see in the Methods panel. The
    live path cannot produce one of these — it picks the question first — so any
    count above zero is this script having put it there.
    """
    rows = (
        SessionItem.query.with_entities(SessionItem.strategy_key, Question.section)
        .join(Question, Question.id == SessionItem.question_id)
        .join(StudySession, SessionItem.session_id == StudySession.id)
        .filter(StudySession.user_id == user.id, SessionItem.strategy_key.isnot(None))
        .all()
    )
    return sum(
        1
        for key, section in rows
        if key in STRATEGIES and STRATEGIES[key]["section"] != section
    )


def _forced_arm_rows(user: User) -> dict:
    """What the mandatory sub-arm looks like on the record, read back.

    The sub-arm had no rows anywhere before this seed wrote them, so the panel
    that contrasts insisted-upon approaches against offered ones has never been
    seen with data in it. These counts are checked rather than reported so an
    empty one is a seeding failure instead of an empty panel in a demo.
    """
    rows = (
        Attempt.query.with_entities(
            Attempt.strategy_variant, Attempt.strategy_gate_status, Attempt.strategy_forcing_propensity
        )
        .filter(Attempt.user_id == user.id, Attempt.strategy_key.isnot(None))
        .all()
    )
    return {
        "required": sum(variant == VARIANT_PROMPT_REQUIRED for variant, _status, _p in rows),
        "stood_down": sum(status == STATUS_STOOD_DOWN for _variant, status, _p in rows),
        "pooled": sum(propensity is not None for _variant, _status, propensity in rows),
    }


def _verify(user: User, live: dict, unplaced: int = 0) -> dict:
    performance = performance_snapshot(user)
    game = serialize_game(user.game_profile, include_catalog=True)
    lab = performance["strategy_lab"]
    statuses = {result["key"]: _lab_status(result) for result in lab["results"]}
    supported = [result for result in lab["results"] if statuses[result["key"]] == "supported"]
    leader = lab.get("leader")
    problems: list[str] = []

    if performance["overall"]["attempts"] < 400:
        problems.append(f"only {performance['overall']['attempts']} scored attempts")
    if (performance["overall"].get("accuracy_delta") or 0) <= 0:
        problems.append("recent accuracy is not trending up")
    if len(supported) < 4:
        problems.append(f"only {len(supported)} supported strategies")
    lifts = [result["lift"] for result in supported if result["lift"] is not None]
    if not any(lift <= 2 for lift in lifts):
        problems.append("no neutral or negative strategy arm")
    if not any(lift >= 12 for lift in lifts):
        problems.append("no clearly winning strategy arm")
    if not leader:
        problems.append("no leading strategy named")
    if sum(result["skipped"] for result in lab["results"]) == 0:
        problems.append("no skipped strategy prompts")
    if unplaced:
        problems.append(f"{unplaced} planned strategy trials had no eligible session slot")
    mismatched = _cross_section_rows(user)
    if mismatched:
        problems.append(
            f"{mismatched} questions carry an approach from the other section — "
            "a Reading Comprehension approach on a Logical Reasoning question, or the reverse"
        )
    forced = _forced_arm_rows(user)
    if not forced["required"]:
        problems.append("no mandatory approaches on the record")
    elif forced["pooled"] <= forced["required"]:
        problems.append("mandatory approaches with nothing in their pool to compare against")
    if not forced["stood_down"]:
        problems.append("nobody was ever let out of a mandatory approach")
    if len(performance["skills"]) < 12:
        problems.append(f"only {len(performance['skills'])} skills in the breakdown")
    thin = [skill["name"] for skill in performance["skills"] if skill["attempts"] < 5]
    if thin:
        problems.append(f"thin skill samples: {thin}")
    if performance["review"]["due"] < 5:
        problems.append("review queue has too little due work")
    if not game["story"]["active_quest"]:
        problems.append("no quest left in flight for the story screen")
    if performance["readiness"]["status"] != "ready":
        problems.append("readiness did not reach 'ready'")
    if not user.onboarding_complete:
        problems.append("onboarding overlay would gate the demo")
    if game["office_tier"] < TARGET_TIER:
        problems.append(f"office tier is {game['office_tier']}")
    cosmetics = [
        key for key in game["owned_assets"]
        if ASSET_BY_KEY.get(key, {}).get("type") == "cosmetic"
    ]
    if len(cosmetics) < 6:
        problems.append(f"only {len(cosmetics)} cosmetics owned")
    affordable = [
        asset for asset in game["catalog"]["assets"]
        if asset["available"] and not asset["owned"] and asset["cost"] <= game["cash"]
    ]
    if not affordable:
        problems.append("nothing is affordable for a live purchase")
    if not live.get("renders_prompt"):
        problems.append("staged live session does not render a prompt")
    bank = calibration.bank_summary()
    if bank["synthetic"] != bank["provisional"] + bank["estimated"] + bank["calibrated"]:
        # A rated row this seeder did not mark would be one a demo answer had
        # smuggled into the earned pile.
        problems.append("a rated question is not marked as seeded")

    return {
        "problems": problems,
        "difficulty_bank": bank,
        "attempts": performance["overall"]["attempts"],
        "accuracy": performance["overall"]["accuracy"],
        "accuracy_delta": performance["overall"]["accuracy_delta"],
        "pace_adherence": performance["overall"]["pace_adherence"],
        "reasoning": performance["overall"]["reasoning"],
        "speedrun_index": performance["overall"]["speedrun_index"],
        "evidence": performance["overall"]["evidence"],
        "skills": len(performance["skills"]),
        "trend_sessions": len(performance["trend"]),
        "readiness": performance["readiness"],
        "review": {key: performance["review"][key] for key in ("due", "scheduled", "mastered", "recovery_rate")},
        "confidence": performance["confidence"],
        "strategy_lab": {
            "trials_completed": lab["trials_completed"],
            "strategies_tested": lab["strategies_tested"],
            "cross_section_rows": mismatched,
            "mandatory": forced,
            "supported": [
                {
                    "title": result["title"],
                    "section": "LR" if result["section"] == "Logical Reasoning" else "RC",
                    "accuracy": result["accuracy"],
                    "control_accuracy": result["control_accuracy"],
                    "lift": result["lift"],
                    "sample": result["sample"],
                    "control_sample": result["control_sample"],
                    "skipped": result["skipped"],
                }
                for result in supported
            ],
            "leader": leader["title"] if leader else None,
            "statuses": {
                status: sum(value == status for value in statuses.values())
                for status in ("supported", "directional", "forming")
            },
        },
        "firm": {
            "office": game["office"]["name"],
            "tier": game["office_tier"],
            "region": game["office"]["region"],
            "cash": game["cash"],
            "reputation": game["reputation"],
            "valuation": game["firm_valuation"],
            "total_cases": game["total_cases"],
            "owned_assets": len(game["owned_assets"]),
            "cosmetics_owned": len(cosmetics),
            "staff_owned": sum(
                ASSET_BY_KEY.get(key, {}).get("type") == "staff" for key in game["owned_assets"]
            ),
            "regions_unlocked": sorted({FIRM_TIERS[tier]["region"] for tier in range(game["office_tier"] + 1)}),
            "story": {
                "alignment": game["story"]["alignment"],
                "ethics": game["story"]["ethics"],
                "chapters_seen": sum(chapter["seen"] for chapter in game["story"]["chapters"]),
                "completed_quests": game["story"]["completed_quests"],
                "active_quest": (game["story"]["active_quest"] or {}).get("title"),
            },
            "live_purchase_options": [
                {"key": asset["key"], "name": asset["name"], "cost": asset["cost"], "type": asset["type"]}
                for asset in sorted(affordable, key=lambda asset: asset["cost"])[:6]
            ],
        },
        "live_demo": live,
    }


def seed_demo(email: str) -> dict:
    # Everything below invents answers, so everything below is declared
    # synthetic before it writes one. The marker reaches the ratings written
    # through `submit_attempt` inside `_stage_live_trial` as well as the ones
    # written by hand in `_write_history`, which is why it sits here and not at
    # the individual call sites.
    with calibration.responses_marked(calibration.ORIGIN_SIMULATED):
        return _seed_demo(email)


def _seed_demo(email: str) -> dict:
    user = User.query.filter_by(email=email).first()
    if not user:
        user = User(email=email, display_name="Local Student")
        db.session.add(user)
        db.session.commit()
    _reset_learner(user)
    user = User.query.filter_by(email=email).one()
    # The onboarding overlay gates every route on a fresh profile.
    user.onboarding_complete = True
    user.story_intro_seen = True
    user.target_minutes = 20
    db.session.commit()

    random.seed(RANDOM_SEED)
    now = datetime.now(timezone.utc).replace(microsecond=0)

    _prepare_profile(user, now)
    pool = QuestionPool()
    history = _write_history(user, pool, now)
    skills = _rebuild_skill_progress(user)
    review = _build_review_queue(user, history["review_pool"], now)
    firm = _build_firm(user)
    story = _advance_story(user)
    settled = _settle_recent(user)
    story |= _stage_active_quest(user)
    _align_profile_counters(user)
    _refresh_daily(user)
    live = _stage_live_trial(user)

    report = _verify(user, live, history["stats"].get("trials_unplaced", 0))
    report["seeded"] = {
        **history["stats"],
        "skills_tracked": skills,
        "review_queue": review,
        "questions_used": len(pool.used),
        "assets_purchased": len(firm["purchased"]),
        "story": story,
        "settlements": settled["settled"],
    }
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed the local LSAT Tycoon demo account.")
    parser.add_argument("--email", default=DEFAULT_EMAIL)
    parser.add_argument("--apply", action="store_true", help="Write the demo state. Without this flag nothing changes.")
    parser.add_argument("--no-backup", action="store_true", help="Skip the automatic pre-seed database copy.")
    args = parser.parse_args()

    app = create_app({"AUTO_SEED": False, "DIAGNOSTIC_SESSION_SIZE": DIAGNOSTIC_QUESTIONS})
    with app.app_context():
        _assert_local_only(app, args.email)
        if not args.apply:
            user = User.query.filter_by(email=args.email).first()
            print(json.dumps(
                {
                    "email": args.email,
                    "exists": bool(user),
                    "database": str(db.engine.url.database),
                    "sessions": StudySession.query.filter_by(user_id=user.id).count() if user else 0,
                    "attempts": Attempt.query.filter_by(user_id=user.id).count() if user else 0,
                    "eligible_questions": Question.query.filter(Question.source.like(f"{ALLOWED_SOURCE_PREFIX}%")).count(),
                    "next": "Re-run with --apply to install the demo account.",
                },
                indent=2,
            ))
            return 0
        backup = None if args.no_backup else _backup_database()
        report = seed_demo(args.email)
        report["database_backup"] = backup
        print(json.dumps(report, indent=2, default=str))
        return 1 if report["problems"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
