"""What the rolling weak-type signal must and must not notice.

The product's promise, as a student reads it, is that the app notices the kinds
of question they keep getting wrong and serves them more of those. The old
signal read one run — the last completed mega-litigation — so a student who was
consistently poor at a category across ordinary practice was not noticed as weak
at it by anything.

These tests are about the four ways the replacement could be quietly wrong: by
counting a wrong answer that three other mechanisms have already counted, by
picking up the section gradient the section-mix knob already owns, by branding a
category on four answers, and by making the still-untyped eighth of the bank
disappear.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from app import create_app
from app.extensions import db
from app.models import Attempt, Question, QuestionChoice, SessionItem, StudySession, User, utcnow
from app.question_types import SOURCE_INFERRED, SOURCE_PLACEHOLDER
from app.seed import SOURCE_PREFIX
from app.type_focus import MAX_FOCUS_TYPES, rolling_focus, rolling_focus_detail


LOGICAL = "Logical Reasoning"
READING = "Reading Comprehension"


@pytest.fixture()
def app():
    return create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
            "TFY_URL": "",
            "TFY_API_KEY": "",
            "AI_JOBS_MODE": "sync",
        }
    )


_COUNTER = [0]


def _question(question_type: str, section: str = LOGICAL, *, placeholder: bool = False) -> Question:
    _COUNTER[0] += 1
    question_id = f"hf-lsat-tf:{_COUNTER[0]}"
    question = Question(
        id=question_id,
        section=section,
        question_type=section if placeholder else question_type,
        question_type_source=SOURCE_PLACEHOLDER if placeholder else SOURCE_INFERRED,
        difficulty=3,
        stimulus="A stimulus.",
        stem="Which one of the following is most accurate?",
        correct_answer="C",
        source=f"{SOURCE_PREFIX}lr · train",
        license_status="upstream_terms_apply",
        review_status="published",
    )
    db.session.add(question)
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
    db.session.flush()
    return question


def _user(email: str) -> User:
    user = User(email=email, display_name=email.split("@")[0])
    db.session.add(user)
    db.session.flush()
    return user


def _answers(
    user: User,
    question_type: str,
    *,
    correct: int,
    wrong: int,
    section: str = LOGICAL,
    days_ago: float = 0.0,
    review: bool = False,
    evidence: str = "coached_practice",
    placeholder: bool = False,
) -> None:
    when = utcnow() - timedelta(days=days_ago)
    run = StudySession(
        user_id=user.id,
        mode="practice",
        practice_style="cases",
        feedback_policy="immediate",
        target_minutes=10,
        total_items=correct + wrong,
    )
    db.session.add(run)
    db.session.flush()
    for index in range(correct + wrong):
        _COUNTER[0] += 1
        question = _question(question_type, section, placeholder=placeholder)
        item = SessionItem(
            session_id=run.id,
            question_id=question.id,
            position=index,
            from_review_queue=review,
            target_time_seconds=150,
        )
        db.session.add(item)
        db.session.flush()
        db.session.add(
            Attempt(
                user_id=user.id,
                session_item_id=item.id,
                idempotency_key=f"tf-{_COUNTER[0]}",
                selected_label="C",
                is_correct=index < correct,
                server_elapsed_ms=60_000,
                evidence_class=evidence,
                created_at=when,
            )
        )
    db.session.commit()


def test_a_weakness_spread_across_ordinary_practice_is_noticed(app):
    """The finding the old signal could not make.

    Nothing here is a mega-litigation. The student has answered forty Logical
    Reasoning questions across ordinary cases at 70%, and twenty Assumption
    questions at 25%. `focus.diagnostic_focus` would return an empty list — it
    reads one diagnostic and there is not one — and the student would never be
    served more Assumption questions by anything.
    """
    with app.app_context():
        user = _user("spread@example.test")
        _answers(user, "Flaw", correct=28, wrong=12)
        _answers(user, "Assumption", correct=5, wrong=15)

        detail = rolling_focus_detail(user.id)
        assert detail["types"] == ["Assumption"]
        weak = detail["weak"][0]
        assert weak["section"] == LOGICAL
        assert weak["gap"] > 5
        # Shrunk, so the reported figure is not the raw 25%.
        assert weak["raw_accuracy"] == 25.0
        assert weak["shrunk_accuracy"] > 25.0


def test_a_student_who_has_improved_stops_being_fed_the_old_weakness(app):
    """Recent and total accuracy answer different questions.

    This student was bad at Assumption four months ago and is fine at it now.
    Under a total rate the old answers never leave and they would be served
    Assumption questions forever. The 30-day half-life puts a four-month-old
    answer at about a sixteenth of a fresh one, so the recent record wins.
    """
    with app.app_context():
        user = _user("improved@example.test")
        _answers(user, "Flaw", correct=28, wrong=12)
        _answers(user, "Assumption", correct=2, wrong=18, days_ago=120)

        assert rolling_focus(user.id) == ["Assumption"]

        _answers(user, "Assumption", correct=16, wrong=4)
        assert rolling_focus(user.id) == []


def test_a_wrong_answer_is_not_counted_again_when_its_card_comes_back(app):
    """The double-count the economy agent's review-share knob avoids.

    A question returns through the queue *because* it was missed, and it will
    keep returning until it is not. Scoring those returns as evidence about the
    type counts one wrong answer once in creating the card, again in its decay
    rate, and a third time here — and lets a single hard question brand its
    whole category permanently.

    Both students below have the same first-encounter record and differ only in
    how much review the queue has sent them. They must get the same answer.
    """
    with app.app_context():
        quiet = _user("quiet@example.test")
        _answers(quiet, "Flaw", correct=28, wrong=12)
        _answers(quiet, "Assumption", correct=9, wrong=11)

        busy = _user("busy@example.test")
        _answers(busy, "Flaw", correct=28, wrong=12)
        _answers(busy, "Assumption", correct=9, wrong=11)
        # The queue is doing its job: the same missed Assumption questions keep
        # coming back and keep being missed.
        _answers(busy, "Assumption", correct=1, wrong=19, review=True)

        assert rolling_focus(quiet.id) == rolling_focus(busy.id)
        assert rolling_focus(busy.id) == []
        assert rolling_focus_detail(busy.id)["first_encounters"] == 60


def test_the_section_gradient_is_left_to_the_section_knob(app):
    """A type is weak relative to its own section, not to the student.

    This student is uniformly worse at Reading Comprehension: every RC type
    runs at 45% against 75% in Logical Reasoning, and no RC type is unusual
    within RC. The section-mix knob already reads that gap. If this module
    compared each type to the student's overall rate, every RC type would be
    flagged and the two mechanisms would push the same student the same way on
    the same evidence — the gain-control-wound-too-far failure.
    """
    with app.app_context():
        user = _user("gradient@example.test")
        _answers(user, "Flaw", correct=15, wrong=5)
        _answers(user, "Assumption", correct=15, wrong=5)
        _answers(user, "Detail", correct=9, wrong=11, section=READING)
        _answers(user, "Main Point", correct=9, wrong=11, section=READING)

        detail = rolling_focus_detail(user.id)
        assert detail["types"] == []
        assert detail["section_baselines"][LOGICAL] > detail["section_baselines"][READING]

        # And a type that *is* unusual within Reading Comprehension is found,
        # at a rate well above the student's Logical Reasoning weak bar.
        _answers(user, "Passage Relationship", correct=3, wrong=17, section=READING)
        assert rolling_focus(user.id) == ["Passage Relationship"]


def test_three_wrong_out_of_four_is_not_a_weakness(app):
    """Shrinkage, the house pattern, doing the job it is there for.

    A rare type at 25% on four answers is pulled almost all the way back to the
    section baseline, because four answers is not evidence. The same type at
    the same rate on forty answers is not.
    """
    with app.app_context():
        thin = _user("thin@example.test")
        _answers(thin, "Flaw", correct=28, wrong=12)
        _answers(thin, "Parallel Reasoning", correct=1, wrong=3)
        assert rolling_focus(thin.id) == []

        thick = _user("thick@example.test")
        _answers(thick, "Flaw", correct=28, wrong=12)
        _answers(thick, "Parallel Reasoning", correct=10, wrong=30)
        assert rolling_focus(thick.id) == ["Parallel Reasoning"]


def test_a_placeholder_type_can_never_be_a_weakness_but_still_counts_as_evidence(app):
    """The 12.5% residue, on both sides of the requirement.

    A placeholder type is the section's own name, written when no rule matched.
    Returning it as a weakness would steer a run toward an eighth of the bank
    and call that targeting, so it cannot be returned however badly the student
    does on it.

    It must not become invisible either. Those answers are real answers in that
    section, so they stay in the section baseline: dropping them would draw the
    bar every real type is measured against over a biased subset of the work.
    """
    with app.app_context():
        user = _user("placeholder@example.test")
        _answers(user, LOGICAL, correct=2, wrong=38, placeholder=True)
        _answers(user, "Flaw", correct=12, wrong=8)

        detail = rolling_focus_detail(user.id)
        assert LOGICAL not in detail["types"]
        assert detail["placeholder_answers"] == 40
        # The forty placeholder answers dragged the section baseline down, so
        # Flaw at 60% is now *above* its section and is correctly not weak.
        assert detail["section_baselines"][LOGICAL] < 60
        assert detail["types"] == []
        assert all(entry["type"] != LOGICAL for entry in detail["considered"])


def test_the_mega_litigation_still_counts_for_more_than_a_coached_case(app):
    """What survives of the old signal.

    The diagnostic is the one surface that does not pay, prompt or coach, which
    is why it was the only thing the old signal read. It is now weighted rather
    than exclusive: `scoring.EVIDENCE_WEIGHT` puts it at 1.0 against 0.55 for
    coached practice, so where the two records disagree the sitting wins.

    The disagreement is the interesting case and it is not hypothetical.
    Strategy prompts are matched to question type, so a student can look
    competent at Flaw questions in coached practice largely because the app
    keeps handing them `flaw_abstraction`. The mega-litigation is the one place
    that is not happening, and a signal that averaged the two flat would let the
    coaching hide the weakness it is compensating for.

    Note what this does *not* assert: that the diagnostic buys more effective
    sample. It does not, and should not. See `type_focus._weight` — the
    evidence-class discount tilts the estimate and is deliberately kept out of
    the sample size, because it cancels between a type and the section baseline
    it is compared against.
    """
    with app.app_context():
        user = _user("mixed@example.test")
        _answers(user, "Flaw", correct=28, wrong=12)
        # Twenty answers each way, disagreeing completely.
        _answers(user, "Assumption", correct=16, wrong=4)
        _answers(user, "Assumption", correct=4, wrong=16, evidence="diagnostic")

        considered = rolling_focus_detail(user.id)["considered"]
        assumption = next(entry for entry in considered if entry["type"] == "Assumption")
        # A flat average of the two records would be 50%. The sitting counts
        # 1.0 against coached practice's 0.55, so the estimate lands below it.
        assert assumption["answers"] == 40
        assert assumption["raw_accuracy"] < 45.0


def test_a_cold_student_has_no_weaknesses_and_that_is_the_right_answer(app):
    with app.app_context():
        user = _user("cold@example.test")
        detail = rolling_focus_detail(user.id)
        assert detail["types"] == []
        assert detail["first_encounters"] == 0
        assert detail["section_baselines"] == {}


def test_the_list_is_capped_so_a_run_still_covers_the_rest_of_the_test(app):
    with app.app_context():
        user = _user("many@example.test")
        _answers(user, "Flaw", correct=38, wrong=2)
        for question_type in (
            "Assumption",
            "Inference",
            "Parallel Reasoning",
            "Principle",
            "Method",
            "Weaken",
        ):
            _answers(user, question_type, correct=3, wrong=17)

        detail = rolling_focus_detail(user.id)
        assert len(detail["types"]) == MAX_FOCUS_TYPES
        # Sorted by how far below the section they sit, so the cap keeps the
        # worst rather than an arbitrary five.
        gaps = [entry["gap"] for entry in detail["weak"]]
        assert gaps == sorted(gaps, reverse=True)
