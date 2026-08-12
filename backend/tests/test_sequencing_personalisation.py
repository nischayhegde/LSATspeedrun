"""A run's shape is read off the student, within stated bounds.

Three knobs decided the shape of every run and all three were constants, so two
students of the same length got byte-identical treatment however differently
they were doing. The audit's phrase was "responsive rather than adaptive": the
system reacted correctly to the signals it had and it had almost none.

What these tests are really guarding is the *bounds*, not the responsiveness.
Responsiveness is easy and dangerous — a knob wired straight to a signal will
find its own extreme and stay there, and the failure looks like a student who
has stopped seeing new questions, or stopped seeing reading, and no error
anywhere. So every one of these has a floor and a ceiling, every one is centred
on the value it replaced so that an ordinary student is treated as they were
before, and each of the three has a test here for the centre and a test for both
ends.

The end-to-end measurement, per cohort, is
`tools/audit/rc_reachability_probe.py`. The figures quoted below came from it.
"""

from __future__ import annotations

import random
from collections import Counter

import pytest

from app import create_app
from app.extensions import db
from app.models import PlayerProfile, Question, QuestionChoice, ReviewQueueItem, User, utcnow
from app.scheduling import _review_slots
from app.seed import SOURCE_PREFIX
from app.services import (
    QUEUE_SLIPPED_AT_REVIEW_CENTRE,
    RC_CASE_SHARE,
    RC_CASE_SHARE_SPREAD,
    REVIEW_SHARE,
    REVIEW_SHARE_CEILING,
    REVIEW_SHARE_FLOOR,
    SECTION_GAP_AT_FULL_SHIFT,
    _reading_case_share,
    _review_share,
    sequencing_profile,
)


SITTING = 6


@pytest.fixture()
def app():
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
            "DEV_AUTH_ENABLED": True,
            "PRACTICE_SESSION_SIZE": SITTING,
            "TFY_URL": "",
            "TFY_API_KEY": "",
            "AI_JOBS_MODE": "sync",
            "STRATEGY_ENFORCEMENT_ENABLED": False,
        }
    )
    with application.app_context():
        db.create_all()
    return application


# --- The review share: how much of a run is repair work ----------------------


def test_a_student_with_nothing_slipping_still_sees_review(app):
    """The floor. Review never switches off for a student who is keeping up.

    A queue in good order is not a queue that can be left alone — every card in
    it is on its way back below target, and a run that stops testing them stops
    finding out which. What the floor buys is that the discovery keeps happening
    at the cheapest possible rate rather than stopping.
    """
    assert _review_share(overdue=0, tracked=200, session_size=SITTING) == pytest.approx(
        REVIEW_SHARE_FLOOR, abs=0.05
    )
    assert _review_share(overdue=0, tracked=200, session_size=SITTING) >= REVIEW_SHARE_FLOOR


def test_a_student_who_has_stopped_answering_repairs_still_sees_new_questions(app):
    """The ceiling. Practice never collapses into pure repetition.

    This is the failure the ceiling exists for, and it is the one that would be
    hardest to notice: a student in trouble gets more review, more review means
    fewer fresh questions, fewer fresh questions means the bank stops opening
    up — and nothing about that reads as broken from the outside. At the
    ceiling, two questions in six are still new.
    """
    share = _review_share(overdue=100_000, tracked=100_000, session_size=SITTING)
    assert share == pytest.approx(REVIEW_SHARE_CEILING, abs=0.001)
    served = max(1, int(SITTING * share + 0.5))
    assert served < SITTING, "a run of nothing but repeats"
    assert SITTING - served >= 2


def test_an_ordinary_queue_gets_exactly_the_half_it_always_got(app):
    """The centre, and the reason this change is safe to ship.

    A quarter of the queue below target is what a student who plays regularly
    and answers their repairs actually looks like — measured on the probe's
    warmed cohort, 485 cards slipping out of 1,719. That student gets three
    repairs in six, which is exactly what the fixed `session_size // 2` gave
    them. Personalisation is a deviation from the old behaviour, not a
    replacement for it, so the ordinary case is unchanged and only the two ends
    are new.
    """
    tracked = 1000
    share = _review_share(
        overdue=int(tracked * QUEUE_SLIPPED_AT_REVIEW_CENTRE),
        tracked=tracked,
        session_size=SITTING,
    )
    assert share == pytest.approx(REVIEW_SHARE, abs=0.01)
    assert max(1, int(SITTING * share + 0.5)) == SITTING // 2


def test_the_review_share_only_ever_rises_with_pressure_and_stays_inside_its_bounds(app):
    """Monotone and bounded, for every queue that can exist.

    Bounded is the safety property. Monotone is the honesty one: a knob that
    was not would mean some student, somewhere, gets *less* review for falling
    further behind, and that student would be very hard to find by hand.
    """
    previous = -1.0
    for slipped in range(0, 101):
        share = _review_share(overdue=slipped * 10, tracked=1000, session_size=SITTING)
        assert REVIEW_SHARE_FLOOR - 1e-9 <= share <= REVIEW_SHARE_CEILING + 1e-9
        assert share >= previous - 1e-9, f"{slipped}% slipping got less review"
        previous = share


def test_a_thin_queue_cannot_swing_the_share_to_an_extreme(app):
    """Three cards, all slipping, is not evidence of a student in trouble.

    Without shrinkage this reads 100% slipping and hands back the ceiling on a
    student's third answer. The queue is shrunk by a run's worth of pseudo-cards
    sitting at the centre for the same reason the section rates are shrunk
    toward the population: a proportion measured on three observations is not a
    proportion, and letting it drive a knob makes the knob loudest exactly when
    it knows least.
    """
    thin = _review_share(overdue=3, tracked=3, session_size=SITTING)
    established = _review_share(overdue=300, tracked=300, session_size=SITTING)
    assert thin < established
    assert thin < REVIEW_SHARE_CEILING


def test_an_empty_queue_reports_the_floor_rather_than_a_number_it_cannot_serve(app):
    """A student with no cards at all is not "behind", and is not average either.

    `due_for_review` returns nothing whatever it is asked for, so the only
    honest thing for the profile to report is the least it would ever ask.
    """
    assert _review_share(overdue=0, tracked=0, session_size=SITTING) == REVIEW_SHARE_FLOOR


# --- The section mix: how often a case is a reading case ---------------------


def test_a_student_whose_reading_trails_their_arguments_sees_more_reading(app):
    assert _reading_case_share(lr_accuracy=0.75, rc_accuracy=0.55) > RC_CASE_SHARE
    assert _reading_case_share(lr_accuracy=0.55, rc_accuracy=0.75) < RC_CASE_SHARE
    assert _reading_case_share(lr_accuracy=0.65, rc_accuracy=0.65) == pytest.approx(RC_CASE_SHARE)


def test_the_reading_share_bends_but_never_breaks_free_of_the_exam_it_imitates(app):
    """The bound, and the reason there is one.

    A third is not an arbitrary default that a student's record is free to
    overwrite. It is what the bank is (34.4% Reading Comprehension), what the
    scored exam is, and what the form the mega-litigation imitates is — reasons
    about the *test*, which do not stop being true because a particular student
    finds reading hard. So the record buys a lean and not a veto. At the far end
    of the strongest possible evidence a student still gets a quarter of their
    cases as reading, and a student who is excellent at it still cannot drop
    below that.
    """
    for lr in [value / 100 for value in range(0, 101)]:
        for rc in [value / 100 for value in range(0, 101, 5)]:
            share = _reading_case_share(lr_accuracy=lr, rc_accuracy=rc)
            assert RC_CASE_SHARE - RC_CASE_SHARE_SPREAD - 1e-9 <= share
            assert share <= RC_CASE_SHARE + RC_CASE_SHARE_SPREAD + 1e-9

    # A gap that large is not reachable in practice, which is the point: the
    # bound binds long before the arithmetic runs out.
    assert _reading_case_share(1.0, 0.0) == pytest.approx(RC_CASE_SHARE + RC_CASE_SHARE_SPREAD)
    assert _reading_case_share(0.0, 1.0) == pytest.approx(RC_CASE_SHARE - RC_CASE_SHARE_SPREAD)


def test_the_lean_is_proportional_to_the_gap_rather_than_a_switch(app):
    """A student half a gap behind gets half the adjustment.

    A threshold would mean one answer, somewhere, flips a student between two
    visibly different diets. Proportional means the shape moves as the evidence
    does.
    """
    half = _reading_case_share(0.65, 0.65 - SECTION_GAP_AT_FULL_SHIFT / 2)
    full = _reading_case_share(0.65, 0.65 - SECTION_GAP_AT_FULL_SHIFT)
    assert half - RC_CASE_SHARE == pytest.approx((full - RC_CASE_SHARE) / 2)


def test_the_same_gap_earns_a_bigger_lean_when_more_answers_stand_behind_it(app):
    """Shrinkage, end to end, through the profile rather than the pure function.

    Two students with the *same* observed rates — 80% arguments against 20%
    reading — and twenty answers between them against two hundred. The second
    has established a section gap; the first has a run of luck that happens to
    point the same way. Both sections are pulled toward the same population
    prior with the same strength, so the estimate the thin student produces sits
    nearer the middle and earns a smaller lean.

    Without this a student's third answer would decide their diet.
    """
    with app.app_context():
        thin = _student("thin-evidence@example.test")
        _answer(thin, section="Logical Reasoning", correct=8, wrong=2)
        _answer(thin, section="Reading Comprehension", correct=2, wrong=8)
        thin_profile = sequencing_profile(thin.id, SITTING)

        firm = _student("firm-evidence@example.test")
        _answer(firm, section="Logical Reasoning", correct=80, wrong=20)
        _answer(firm, section="Reading Comprehension", correct=20, wrong=80)
        firm_profile = sequencing_profile(firm.id, SITTING)

    thin_gap = thin_profile.lr_accuracy - thin_profile.rc_accuracy
    firm_gap = firm_profile.lr_accuracy - firm_profile.rc_accuracy
    assert 0 < thin_gap < firm_gap, (thin_gap, firm_gap)
    assert RC_CASE_SHARE < thin_profile.reading_case_share <= firm_profile.reading_case_share
    # And neither of them, however sure, gets past the bound.
    assert firm_profile.reading_case_share <= RC_CASE_SHARE + RC_CASE_SHARE_SPREAD + 1e-9


# --- Review placement --------------------------------------------------------


def test_review_slots_stay_inside_the_run_and_never_lose_one(app):
    """Every review asked for gets a distinct position inside the run.

    A collision would not raise; the interleave loop would quietly append the
    leftover at the end, which is both a lost slot and the front-loading bug
    wearing a different hat. Checked across every length and count a run can
    take rather than the one the sitting happens to be today.
    """
    for total in range(1, 21):
        for count in range(1, total + 1):
            for _ in range(50):
                slots = _review_slots(total, count)
                assert len(slots) == count, (total, count, slots)
                assert all(0 <= slot < total for slot in slots), (total, count, slots)


def test_review_placement_is_not_the_same_run_twice(app):
    """The jitter is actually random, not a rearranged constant."""
    seen = {frozenset(_review_slots(10, 3)) for _ in range(200)}
    assert len(seen) > 1


def test_every_position_is_equally_likely_to_be_a_repeat(app):
    """The defect, stated as a number.

    Measured on the real bank before this change, the per-position review rate
    inside an argument case was 0:0%, 1:92%, 2:14%, 3:73%, 4:21%, 5:99%. The
    last question of a run was a repeat essentially always and the first never
    was. A student does not need to be told that to learn it, and once learned
    it lets them answer from where a question sits rather than from what it
    says — which is the exact failure Rohrer's result is about, quoted in
    `scheduling.py` two functions above the code that was producing it.

    Systematic sampling with a random start makes the rate `count / total` at
    every position, so there is nothing left to learn. Same measurement after:
    43% to 58%.
    """
    for total, count in [(6, 2), (6, 3), (6, 4), (10, 3), (10, 5), (7, 3)]:
        draws = 6000
        hits = Counter()
        for _ in range(draws):
            hits.update(_review_slots(total, count))
        expected = count / total
        for position in range(total):
            rate = hits[position] / draws
            assert rate == pytest.approx(expected, abs=0.03), (
                f"{total}/{count}: position {position} is a repeat {rate:.0%} of the time, "
                f"against {expected:.0%} everywhere else"
            )


# --- The whole profile -------------------------------------------------------


def test_a_type_filtered_drill_is_not_personalised_at_all(app):
    """A student who asked for twenty Assumption questions has set the shape.

    Nothing here should apply to a run whose shape the student chose by hand,
    and the two queries it would take to work that out are wasted.

    Asserted by watching whether the profile is read at all, rather than by
    inspecting the run that comes out: "these signals were not consulted" is the
    property, and a drill that happened to look unpersonalised would satisfy a
    test of its contents without satisfying that.
    """
    from app import services

    with app.app_context():
        user = _student("drill@example.test")
        _answer(user, section="Logical Reasoning", correct=4, wrong=6)
        _bank(20, question_type="Assumption")
        db.session.add(
            PlayerProfile(
                user_id=user.id,
                lawyer_name="Ada Rowan",
                firm_name="Rowan Legal",
                character_gender="female",
            )
        )
        db.session.commit()

        calls = []
        original = services.sequencing_profile
        services.sequencing_profile = lambda *args: calls.append(args) or original(*args)
        try:
            services.create_study_session(user, count=SITTING, question_type="Assumption")
        finally:
            services.sequencing_profile = original
    assert calls == []


def test_the_profile_carries_the_evidence_it_decided_from(app):
    """The signals travel with the decision.

    Both shares are derived numbers, and a derived number with its inputs thrown
    away cannot be checked, explained to a student, or debugged from a support
    request. It is also the seam: question difficulty, when there is a signal
    for it, is another field here read off the same evidence.
    """
    with app.app_context():
        user = _student("evidence@example.test")
        _answer(user, section="Logical Reasoning", correct=40, wrong=10)
        _answer(user, section="Reading Comprehension", correct=10, wrong=40)
        profile = sequencing_profile(user.id, SITTING)

    assert profile.lr_accuracy > profile.rc_accuracy
    assert profile.tracked == 50
    assert 0 <= profile.overdue <= profile.tracked
    assert profile.reading_case_share == _reading_case_share(
        profile.lr_accuracy, profile.rc_accuracy
    )
    assert profile.review_share == _review_share(profile.overdue, profile.tracked, SITTING)


# --- Fixtures ----------------------------------------------------------------


def _bank(count: int, *, question_type: str) -> None:
    """Unanswered Logical Reasoning questions for a run to actually draw from."""
    for index in range(count):
        question = Question(
            id=f"{SOURCE_PREFIX}bank-{question_type}-{index}",
            source=f"{SOURCE_PREFIX}test",
            section="Logical Reasoning",
            question_type=question_type,
            stimulus="Stimulus.",
            stem="Stem?",
            correct_answer="A",
        )
        db.session.add(question)
        db.session.flush()
        _choices(question.id)
    db.session.commit()


def _choices(question_id: str) -> None:
    for position, label in enumerate("ABCDE"):
        db.session.add(
            QuestionChoice(
                id=f"{question_id}-{label}",
                question_id=question_id,
                label=label,
                canonical_text=f"Answer {label}",
                position=position,
            )
        )


def _student(email: str) -> User:
    user = User(email=email, display_name="Student")
    db.session.add(user)
    db.session.commit()
    return user


def _answer(user: User, *, section: str, correct: int, wrong: int) -> None:
    """Give this student a history in one section, with cards for the misses.

    Writes attempts through a minimal session rather than through the API: what
    is under test reads two aggregates off `attempts` and `review_queue_items`,
    and building the history by playing would take a bank, a game profile and a
    thousand requests to say the same thing.
    """
    from app.models import Attempt, SessionItem, StudySession

    session = StudySession(
        user_id=user.id,
        mode="practice",
        status="completed",
        total_items=correct + wrong,
        target_minutes=15,
    )
    db.session.add(session)
    db.session.flush()
    for index in range(correct + wrong):
        question = Question(
            id=f"{SOURCE_PREFIX}{section[:2]}-{user.id}-{index}",
            source=f"{SOURCE_PREFIX}test",
            section=section,
            question_type="Assumption" if section == "Logical Reasoning" else "Main Point",
            stimulus="Stimulus.",
            stem="Stem?",
            correct_answer="A",
        )
        db.session.add(question)
        db.session.flush()
        _choices(question.id)
        item = SessionItem(
            session_id=session.id, question_id=question.id, position=index, target_time_seconds=150
        )
        db.session.add(item)
        db.session.flush()
        is_correct = index < correct
        db.session.add(
            Attempt(
                user_id=user.id,
                session_item_id=item.id,
                idempotency_key=f"seq-{question.id}",
                selected_label="A" if is_correct else "B",
                is_correct=is_correct,
                server_elapsed_ms=120_000,
                confidence=3,
            )
        )
        if not is_correct:
            # Cards come from misses, as they do in the app. Queueing every
            # question instead would make `tracked` a synonym for "answered" and
            # quietly destroy the thing the review share is computed from.
            db.session.add(
                ReviewQueueItem(user_id=user.id, question_id=question.id, due_at=utcnow())
            )
    db.session.commit()
