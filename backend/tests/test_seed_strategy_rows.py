"""The strategy rows the demo seed writes, which nothing else writes for it.

`scripts/seed_demo.py` lays session rows down directly instead of going through
`create_study_session`, which is the only reason either of these bugs was
possible: an approach could end up recorded against a question from the other
section, and the mandatory sub-arm could be missing from the account entirely.
Both are invisible in the app's own tests, because the app's own code path
cannot produce either one — and both are visible on stage in the Methods panel.

The seed itself takes minutes and needs the licensed bank, so what is pinned
here is the two decisions it makes about strategy rows, driven directly.
"""

from __future__ import annotations

import pytest

from app import create_app
from app.enforcement import (
    LEVEL_FULL,
    MASTERY_MIN_SATISFIED,
    STATUS_SATISFIED,
    STATUS_SKIPPED,
    STATUS_STOOD_DOWN,
)
from app.extensions import db
from app.models import Attempt, Question, SessionItem
from app.seed import SOURCE_PREFIX
from app.strategies import SESSION_FORCED_CAP, STRATEGIES, VARIANT_PROMPT_REQUIRED, _candidate_keys
from scripts.seed_demo import FORCED_POOL, _repair_question, _stage_forced_arms

LR_STIMULUS = (
    "Residents of Halford drink far more coffee than residents of Denby, and Halford "
    "reports more insomnia. The coffee habit must therefore be producing the insomnia."
)
RC_PASSAGE = (
    "Critics of the reform argue that it transferred costs onto tenants.\n\n"
    "Proponents reply that the same figures show a fall in vacancy."
)


def make_question(index: int, section: str) -> Question:
    reading = section == "Reading Comprehension"
    question = Question(
        id=f"hf-lsat-seed:{index}",
        section=section,
        question_type="Flaw" if not reading else "Reading Comprehension",
        difficulty=3,
        stimulus=None if reading else LR_STIMULUS,
        stem=(
            "The primary purpose of the passage is to"
            if reading
            else "The reasoning in the argument is most vulnerable to criticism on the grounds that it"
        ),
        correct_answer="C",
        source=f"{SOURCE_PREFIX}lr · train",
        license_status="upstream_terms_apply",
        review_status="published",
    )
    return question


@pytest.fixture()
def app():
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
            "DEV_AUTH_ENABLED": True,
        }
    )
    with application.app_context():
        for index in range(3):
            db.session.add(make_question(index, "Logical Reasoning"))
        for index in range(3, 6):
            db.session.add(make_question(index, "Reading Comprehension"))
        db.session.commit()
    return application


# ---------------------------------------------------------------------------
# A repair question the run's approach actually fits
# ---------------------------------------------------------------------------


def test_a_repair_only_replaces_the_question_the_approach_fits(app):
    """The bug: the approach was drawn first and the question swapped under it.

    A repair takes the front of a run, and it used to take whatever the review
    queue offered next, which is how "Compare the two passages" came to be
    recorded against a Logical Reasoning question 85 times on one account.
    """
    with app.app_context():
        reading = Question.query.filter_by(section="Reading Comprehension").all()
        reasoning = Question.query.filter_by(section="Logical Reasoning").all()
        key = next(key for key in _candidate_keys(reasoning[0]) if STRATEGIES[key]["section"] == "Logical Reasoning")
        trial = {"key": key, "variant": "prompt", "applied": True, "correct": True}
        # The reading questions come first in the queue, and are what the old
        # code would have taken.
        pool = [(question.id, "incorrect") for question in reading + reasoning]

        chosen = _repair_question(pool, trial, (0, 0), {})
        assert chosen is not None
        assert chosen.section == "Logical Reasoning"
        assert key in _candidate_keys(chosen)


def test_a_repair_is_declined_rather_than_mismatched(app):
    """No fit in the queue means fresh material, not a mismatched card."""
    with app.app_context():
        reading = Question.query.filter_by(section="Reading Comprehension").all()
        pool = [(question.id, "incorrect") for question in reading]
        trial = {"key": "prephrase", "variant": "prompt", "applied": True, "correct": True}
        assert _repair_question(pool, trial, (0, 0), {}) is None


def test_a_position_with_no_trial_takes_any_review_question(app):
    """Control-arm and untrialled positions have no approach to satisfy."""
    with app.app_context():
        pool = [(question.id, "incorrect") for question in Question.query.all()]
        assert _repair_question(pool, None, (0, 0), {}) is not None


# ---------------------------------------------------------------------------
# The mandatory sub-arm, which had no rows anywhere
# ---------------------------------------------------------------------------


def rows(count: int, *, key: str = "prephrase", applied: bool = True):
    """Prompted rows in the shape `_write_history` hands them over."""
    built = []
    for index in range(count):
        question = make_question(100 + index, STRATEGIES[key]["section"])
        item = SessionItem(question_id=question.id, position=index, strategy_key=key, strategy_variant="prompt")
        attempt = Attempt(
            strategy_key=key,
            strategy_variant="prompt",
            strategy_applied=applied,
            server_elapsed_ms=90_000,
        )
        built.append((item, attempt, question, {"key": key, "variant": "prompt", "applied": applied, "correct": True}))
    return built


def counters() -> dict:
    return {"forced": 0, "forced_pool": 0, "forced_runs": 0, "stood_down": 0}


def test_a_pool_is_drawn_from_and_every_member_carries_the_same_probability():
    """What makes these rows analysable rather than merely labelled.

    The mandatory contrast is restricted to the pool and weighted by the draw's
    own probability, so a required row without losers to compare against, or a
    pool whose members disagree about their inclusion probability, is a row the
    panel has to throw away.
    """
    built = rows(FORCED_POOL)
    stats = counters()
    _stage_forced_arms(built, "run-1", {}, stats)

    required = [item for item, _attempt, _question, _trial in built if item.strategy_variant == VARIANT_PROMPT_REQUIRED]
    assert len(required) == SESSION_FORCED_CAP
    assert stats["forced"] == SESSION_FORCED_CAP
    assert stats["forced_pool"] == FORCED_POOL - SESSION_FORCED_CAP
    propensities = {item.strategy_forcing_propensity for item, _a, _q, _t in built}
    assert propensities == {SESSION_FORCED_CAP / FORCED_POOL}
    for item, attempt, _question, _trial in built:
        assert item.strategy_stratum == attempt.strategy_stratum
        assert item.strategy_forcing_propensity == attempt.strategy_forcing_propensity
        assert item.strategy_enforcement_level == LEVEL_FULL
        assert attempt.strategy_gate_status in {STATUS_SATISFIED, STATUS_STOOD_DOWN}


def test_the_way_out_is_only_ever_recorded_on_a_mandatory_question():
    """A stand-down is what a required question does instead of a skip.

    It is also the path with no other evidence that it works, so the seed has
    to produce it, and it has to produce it in the shape the server writes:
    declined, with the refusals that are the only thing which opens the door.
    """
    stood_down = []
    for run in range(8):
        built = rows(FORCED_POOL)
        _stage_forced_arms(built, f"run-{run}", {}, counters())
        stood_down += [
            (item, attempt)
            for item, attempt, _question, _trial in built
            if attempt.strategy_gate_status == STATUS_STOOD_DOWN
        ]
    assert stood_down, "no run ever reached the way out of a mandatory approach"
    for item, attempt in stood_down:
        assert item.strategy_variant == VARIANT_PROMPT_REQUIRED
        assert attempt.strategy_applied is False
        assert item.strategy_gate_rejections == attempt.strategy_gate_rejections >= 2


def test_a_declined_offer_that_was_never_mandatory_is_a_skip():
    built = rows(FORCED_POOL, applied=False)
    _stage_forced_arms(built, "declined", {}, counters())
    for item, attempt, _question, _trial in built:
        if item.strategy_variant != VARIANT_PROMPT_REQUIRED:
            assert attempt.strategy_gate_status == STATUS_SKIPPED


def test_a_run_is_left_alone_rather_than_carry_an_approach_into_mastery():
    """Eight cleared gates and the live gate relaxes to an attestation.

    Which is a real state and a good one, but it takes the operations off the
    screen, and a demo account that has quietly aged past them cannot show the
    thing being demonstrated.
    """
    built = rows(FORCED_POOL)
    stats = counters()
    _stage_forced_arms(built, "mastered", {"prephrase": MASTERY_MIN_SATISFIED - 1}, stats)
    assert stats["forced"] == 0
    assert all(item.strategy_variant == "prompt" for item, _a, _q, _t in built)
    assert all(attempt.strategy_gate_status is None for _i, attempt, _q, _t in built)


def test_a_run_too_short_to_hold_a_pool_forces_nothing():
    built = rows(FORCED_POOL - 1)
    stats = counters()
    _stage_forced_arms(built, "short", {}, stats)
    assert stats == counters()
