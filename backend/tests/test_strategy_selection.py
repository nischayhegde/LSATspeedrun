"""Which approach the selector can actually deal, and which arm it deals it on.

`test_strategy_matching.py` next door asks whether the right approaches are
*candidates* for a question. This module asks what becomes of them, because a
candidate the selector can never choose is worth exactly what a candidate that
was never eligible is worth.

Both defects pinned here were measured by the interleaving audit and both were
silent — nothing crashed, no card looked wrong, and the bank-wide statistics a
reviewer would check all read correctly. They are here so that they regress
loudly:

* the exploit phase could reach only the leader and the runner-up, so on a
  six-candidate question four approaches were unreachable, and permanently,
  because an approach that is never dealt never gains an observation;
* every draw hashed (student, question, slot, style) and nothing else, so a
  question returning to the same slot repeated its whole assignment forever —
  invisible bank-wide, where control still measures 25% across the hash space,
  and severe for a student whose practice is half review.

The measurements behind the numbers here live in
`scripts/audit_strategy_selection.py`.
"""

from __future__ import annotations

import pytest

from app import create_app
from app.extensions import db
from app.models import (
    Attempt,
    PlayerProfile,
    Question,
    QuestionChoice,
    SessionItem,
    StudySession,
    User,
)
from app.seed import SOURCE_PREFIX
from app.strategies import (
    BASE_COVERAGE_TRIALS,
    CONTROL_PROBABILITY,
    CONTROL_VARIANTS,
    EXPLORE_PROBABILITY,
    UNCERTAINTY_WEIGHT,
    VARIANT_PROMPT,
    _candidate_keys,
    _weighted_pick,
    assign_strategy_trial,
)


# Modelled on the widest question in the live bank
# (`hf-lsat-lr:199512_3-LR2_20_23`, six candidates): a reply between two
# speakers, carrying conditional language, a causal claim and a principle stem
# all at once. A wide candidate set is the precondition for the defect — with
# only two candidates, ranks 0 and 1 are the whole set and nothing is out of
# reach — so the tests assert the width they depend on.
WIDE_STIMULUS = (
    "Arnold: If an airline overbooks a flight, then some passenger holding a confirmed "
    "reservation is denied a seat. I was denied a seat, and that denial caused me to miss "
    "an important meeting. The airline should compensate me. "
    "Jamie: The airline is not obligated to compensate you. Unless a passenger is denied a "
    "seat through the airline's own negligence, the delay is not brought about by the airline at all."
)
WIDE_STEM = (
    "A principle that, if established, justifies Jamie's response to Arnold is that an "
    "airline is obligated to compensate a passenger only if the airline caused the delay"
)


@pytest.fixture()
def app():
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
            "STRATEGY_ENFORCEMENT_ENABLED": False,
        }
    )
    with application.app_context():
        db.session.add(
            Question(
                id="hf-lsat-lr:selection-wide",
                section="Logical Reasoning",
                question_type="Principle",
                difficulty=3,
                stimulus=WIDE_STIMULUS,
                stem=WIDE_STEM,
                correct_answer="C",
                source=f"{SOURCE_PREFIX}lr · train",
                license_status="upstream_terms_apply",
                review_status="published",
            )
        )
        for position, label in enumerate("ABCDE"):
            db.session.add(
                QuestionChoice(
                    id=f"hf-lsat-lr:selection-wide-{label}",
                    question_id="hf-lsat-lr:selection-wide",
                    label=label,
                    canonical_text=f"Choice {label} about compensation and negligence.",
                    position=position,
                )
            )
        db.session.commit()
    return application


class Student:
    """A student, their question, and a way to give them a track record on it."""

    def __init__(self) -> None:
        self.user = User(email="selection@example.test", display_name="Selection")
        db.session.add(self.user)
        db.session.flush()
        self.session = StudySession(
            user_id=self.user.id,
            mode="practice",
            practice_style="cases",
            feedback_policy="immediate",
            status="completed",
            target_minutes=20,
            total_items=0,
        )
        db.session.add(self.session)
        db.session.flush()
        self.question = db.session.get(Question, "hf-lsat-lr:selection-wide")
        self.candidates = _candidate_keys(self.question)
        self._index = 0

    def observe(self, key: str, *, correct: bool) -> None:
        """One prompt-arm attempt on `key`, which is what the selector counts."""
        item = SessionItem(
            session_id=self.session.id,
            question_id=self.question.id,
            position=self._index,
            target_time_seconds=150,
            strategy_key=key,
            strategy_variant=VARIANT_PROMPT,
        )
        db.session.add(item)
        db.session.flush()
        db.session.add(
            Attempt(
                user_id=self.user.id,
                session_item_id=item.id,
                idempotency_key=f"selection-{key}-{self._index}",
                selected_label="A",
                is_correct=correct,
                confidence=3,
                server_elapsed_ms=100_000,
                client_elapsed_ms=100_000,
                strategy_key=key,
                strategy_variant=VARIANT_PROMPT,
                strategy_propensity=1 - CONTROL_PROBABILITY,
            )
        )
        db.session.flush()
        self._index += 1

    def clear_coverage(self, *, worst: str | None = None) -> None:
        """Put every candidate past the coverage bar, `worst` on a losing record."""
        for key in self.candidates:
            for trial in range(BASE_COVERAGE_TRIALS):
                self.observe(key, correct=key != worst and trial < 2)
        db.session.commit()

    def deal(self, exposure: str, position: int = 1) -> dict:
        return assign_strategy_trial(
            self.user.id, self.question, "cases", position, exposure=exposure
        )


def test_the_wide_question_this_module_rests_on_is_actually_wide(app):
    """If eligibility ever narrows this question, these tests stop testing anything."""
    with app.app_context():
        question = db.session.get(Question, "hf-lsat-lr:selection-wide")
        assert len(_candidate_keys(question)) >= 4


def test_every_candidate_is_reachable_and_not_only_the_top_two(app):
    """The rank-1 ceiling: four of six approaches took zero of 400 draws.

    The old exploit branch was `ranked[1 if explore else 0]`, so rank 2 and below
    could not be dealt at all. The exclusion was permanent as well as total,
    which is the part that makes it serious: a candidate that is never dealt
    never gains an observation, so its rank can never change.
    """
    with app.app_context():
        student = Student()
        assert len(student.candidates) >= 4
        student.clear_coverage()

        dealt = {student.deal(f"run-{index}")["key"] for index in range(400)}
        assert dealt == set(student.candidates)


def test_a_candidate_starved_of_samples_does_not_stay_starved(app):
    """The worst performer on three observations keeps a share of the draws.

    Three observations is a thin basis for a verdict, and the old selector made
    it a final one. The share is deliberately not large — the leader should still
    take most of the draws — but it has to be non-zero, because that is what
    turns the exclusion from permanent into revisable.
    """
    with app.app_context():
        student = Student()
        worst = student.candidates[-1]
        student.clear_coverage(worst=worst)
        # And the leader has a long winning record, which is exactly the state in
        # which a mean-only score keeps choosing it forever.
        leader = student.candidates[0]
        for _ in range(60):
            student.observe(leader, correct=True)
        db.session.commit()

        draws = 400
        dealt = [student.deal(f"run-{index}")["key"] for index in range(draws)]
        assert dealt.count(worst) > 0
        # The leader still leads: this is exploration, not a reshuffle.
        assert dealt.count(leader) / draws > 1 - EXPLORE_PROBABILITY - 0.1


def test_an_approach_unlucky_on_its_first_three_observations_can_climb_back(app):
    """Reachability on one draw is the weak claim; this is the one that matters.

    One candidate is the best in the set and answered every coverage observation
    wrong. The selector is then driven for 200 encounters and each assignment is
    answered according to the candidate's true accuracy, so the record it builds
    is its own. Under the old rule it was dealt zero times out of 240 and its
    share of the last quarter was 0.0%.
    """
    with app.app_context():
        student = Student()
        best = student.candidates[-1]
        student.clear_coverage(worst=best)

        encounters = 200
        dealt: list[str] = []
        for index in range(encounters):
            key = student.deal(f"climb-{index}", position=index % 10)["key"]
            dealt.append(key)
            # The unlucky candidate is genuinely the better approach; every other
            # one is mediocre. Deterministic so the test cannot flake.
            student.observe(key, correct=index % 10 < (8 if key == best else 5))
        db.session.commit()

        quarter = encounters // 4
        early = dealt[:quarter].count(best) / quarter
        late = dealt[-quarter:].count(best) / quarter
        assert late > early
        assert late > 0.5


def test_the_uncertainty_term_cancels_when_every_candidate_is_equally_measured(app):
    """It reorders nothing a plain mean would have got right.

    The bonus is a function of a candidate's own observation count, so when the
    counts are equal it is the same number for everybody and drops out of the
    ranking. That is what keeps this a tie-breaker on evidence rather than a
    thumb on the scale, and it is why the existing test that separates candidates
    on explanation quality still separates them.
    """
    with app.app_context():
        student = Student()
        winner = student.candidates[-1]
        # Equal counts throughout, and one candidate plainly better than the rest.
        for key in student.candidates:
            for trial in range(6):
                student.observe(key, correct=key == winner or trial < 1)
        db.session.commit()

        dealt = [student.deal(f"run-{index}")["key"] for index in range(200)]
        leader = max(set(dealt), key=dealt.count)
        assert leader == winner


def test_one_exposure_asked_twice_gives_the_same_assignment(app):
    """The property the fix had to preserve: nobody is flipped mid-question."""
    with app.app_context():
        student = Student()
        student.clear_coverage()

        repeated = [student.deal("run-7", position=3) for _ in range(20)]
        assert len({trial["key"] for trial in repeated}) == 1
        assert len({trial["variant"] for trial in repeated}) == 1
        assert len({trial["propensity"] for trial in repeated}) == 1


def test_a_question_returning_to_the_same_slot_draws_its_arm_again(app):
    """The control arm collapse, and it only shows up on repeats.

    A review question comes back at a fixed slot, so before the exposure existed
    its arm was settled the first time it was met and never redrawn: measured at
    0.0% control across 400 encounters of one (question, slot), against 25% by
    design. Fresh questions were always fine, which is why a bank-wide check saw
    nothing wrong.
    """
    with app.app_context():
        student = Student()
        student.clear_coverage()

        # The same question at the same slot, met once per run over many runs.
        repeats = [student.deal(f"run-{index}", position=3) for index in range(400)]
        control = sum(1 for trial in repeats if trial["variant"] in CONTROL_VARIANTS)
        assert control / len(repeats) == pytest.approx(CONTROL_PROBABILITY, abs=0.06)


def test_the_recorded_propensity_is_the_rate_the_mechanism_actually_produced(app):
    """`strategy_propensity` has to be the number the draw used, not the design's.

    On a repeated (question, slot) the old mechanism's probability of control had
    collapsed to 0 or 1 while the column went on recording 0.25 or 0.75 — on
    exactly the rows a heavy user has most of, which is what would have misled a
    later IPW or CACE fit. Asserting the two agree is the whole point.
    """
    with app.app_context():
        student = Student()
        student.clear_coverage()

        repeats = [student.deal(f"run-{index}", position=3) for index in range(400)]
        for trial in repeats:
            expected = (
                CONTROL_PROBABILITY
                if trial["variant"] in CONTROL_VARIANTS
                else 1 - CONTROL_PROBABILITY
            )
            assert trial["propensity"] == expected
        realised = sum(1 for trial in repeats if trial["variant"] in CONTROL_VARIANTS) / len(repeats)
        recorded = next(
            trial["propensity"] for trial in repeats if trial["variant"] in CONTROL_VARIANTS
        )
        assert realised == pytest.approx(recorded, abs=0.06)


def test_the_selector_cannot_be_called_without_saying_which_encounter_it_is(app):
    """`exposure` is required, which is what stops the defect being reinstated.

    A default would have been the whole bug back: the draws below it are hashes,
    and a hash that cannot distinguish this encounter from the last one does not
    randomise anything. Since it is required, every call site in the application
    is checked by the interpreter, and the one call site that matters is covered
    by the run-building tests throughout the suite.
    """
    with app.app_context():
        student = Student()
        with pytest.raises(TypeError):
            assign_strategy_trial(student.user.id, student.question, "cases", 0)


def test_two_runs_meeting_the_same_question_at_the_same_slot_are_two_encounters(app):
    """A real run supplies its own id, so a returning review question is redrawn.

    Driven through `create_study_session` because what has to be true is
    specifically that the token *varies per run*: a constant would satisfy the
    signature and leave every repeat frozen exactly as before. There is one
    question in this fixture, so every run below meets the same question at the
    same slot — the condition a fixed review slot creates — and any variation in
    the assignment can only have come from the run.
    """
    with app.app_context():
        from app.services import create_study_session

        user = User(email="exposure-run@example.test", display_name="Exposure")
        db.session.add(user)
        db.session.flush()
        db.session.add(
            PlayerProfile(
                user_id=user.id,
                lawyer_name="Exposure",
                firm_name="Exposure & Co",
                character_gender="female",
            )
        )
        db.session.commit()

        exposures: set[str] = set()
        arms: set[tuple[str, str]] = set()
        for _ in range(20):
            session = create_study_session(user, count=1, practice_style="cases")
            item = SessionItem.query.filter_by(session_id=session.id).one()
            assert item.position == 0
            assert item.strategy_variant is not None
            exposures.add(session.id)
            arms.add((item.strategy_key, item.strategy_variant))
            # Retired so the next run is not refused by the resumable-queue cap.
            session.status = "completed"
            db.session.commit()

        assert len(exposures) == 20
        assert len(arms) > 1


@pytest.mark.parametrize(
    "weights,fraction,expected",
    [
        # A dominant weight takes almost the whole interval.
        ([9.0, 1.0], 0.5, "a"),
        ([9.0, 1.0], 0.95, "b"),
        # Equal weights split it evenly.
        ([1.0, 1.0], 0.25, "a"),
        ([1.0, 1.0], 0.75, "b"),
        # All-zero weights degenerate to a uniform pick rather than raising.
        ([0.0, 0.0], 0.75, "b"),
        # And a fraction at the very top of the range stays in bounds.
        ([1.0, 1.0], 1.0, "b"),
    ],
)
def test_the_weighted_pick_respects_its_weights(weights, fraction, expected):
    assert _weighted_pick(["a", "b"], weights, fraction) == expected


def test_the_uncertainty_weight_stays_small_enough_to_be_a_tie_breaker():
    """A guard on the constant, not on the arithmetic.

    The performance terms are all in [0, 1]. If this bonus ever grew to the point
    where it could overturn a decisive performance gap, the selector would be
    exploring at the student's expense rather than at the margin, and no other
    test in this file would notice.
    """
    assert 0 < UNCERTAINTY_WEIGHT <= 0.25
