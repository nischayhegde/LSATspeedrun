"""The trial read across students, which the app has never done.

`strategy_performance(user_id)` is the only reading of the strategy trial in
the application and every query inside it filters on that student. Its own
comments say a per-student verdict needs thousands of observations, and it
honours that by never claiming one. So the app has been running a randomised
trial whose per-student output it knows is unusable, while never computing the
estimate the same randomisation fully supports.

`strategy_population_reading` is that estimate. It changes no behaviour: no
route, no cache, no draw. What is tested here is that it is a *cohort* reading
rather than the per-student one with the filter taken off — the distinction
being that a cohort reading has to survive students who differ wildly in
ability and in how much they answered.
"""

from __future__ import annotations

import pytest

from app import create_app
from app.extensions import db
from app.models import Attempt, Question, QuestionChoice, SessionItem, StudySession, User
from app.seed import SOURCE_PREFIX
from app.strategies import MIN_CONTRAST_SAMPLE, strategy_population_reading


@pytest.fixture()
def app():
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
            "TFY_URL": "",
            "TFY_API_KEY": "",
            "AI_JOBS_MODE": "sync",
        }
    )
    with application.app_context():
        for index, section in enumerate(("Logical Reasoning", "Reading Comprehension")):
            question_id = f"hf-lsat-pop-{index}"
            db.session.add(
                Question(
                    id=question_id,
                    section=section,
                    question_type="Flaw" if index == 0 else "Detail",
                    stimulus="A stimulus.",
                    stem="Which one of the following is most accurate?",
                    correct_answer="C",
                    source=f"{SOURCE_PREFIX}lr · train",
                    license_status="upstream_terms_apply",
                    review_status="published",
                )
            )
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
        db.session.commit()
    return application


def _user(email: str) -> User:
    user = User(email=email, display_name=email.split("@")[0])
    db.session.add(user)
    db.session.flush()
    return user


def _answers(user, key, section, rows, counter=[0]):
    """`rows` is a list of (variant, correct)."""
    question = Question.query.filter_by(section=section).one()
    run = StudySession(
        user_id=user.id,
        mode="practice",
        practice_style="cases",
        feedback_policy="immediate",
        target_minutes=10,
        total_items=len(rows),
    )
    db.session.add(run)
    db.session.flush()
    for position, (variant, correct) in enumerate(rows):
        counter[0] += 1
        propensity = 0.75 if variant == "prompt" else 0.25
        item = SessionItem(
            session_id=run.id,
            question_id=question.id,
            position=position,
            strategy_key=key,
            strategy_variant=variant,
            strategy_propensity=propensity,
            target_time_seconds=150,
        )
        db.session.add(item)
        db.session.flush()
        db.session.add(
            Attempt(
                user_id=user.id,
                session_item_id=item.id,
                idempotency_key=f"pop-{counter[0]}",
                selected_label="C",
                is_correct=correct,
                server_elapsed_ms=60_000,
                strategy_key=key,
                strategy_variant=variant,
                strategy_propensity=propensity,
            )
        )


def _split(prompt_n, prompt_rate, control_n, control_rate):
    rows = [("prompt", index < round(prompt_n * prompt_rate)) for index in range(prompt_n)]
    rows += [
        ("control_visible", index < round(control_n * control_rate)) for index in range(control_n)
    ]
    return rows


def test_a_cohort_names_an_approach_no_single_student_could(app):
    """The whole point, in one assertion.

    Twelve students, each with far too little evidence to name anything on
    their own — the per-student panel would report "not enough evidence" for
    every one of them — and a pooled comparison that clears the same threshold
    comfortably. The randomisation supporting this was already in place; the
    query was not.
    """
    with app.app_context():
        for index in range(12):
            user = _user(f"cohort-{index}@example.test")
            _answers(
                user,
                "argument_core",
                "Logical Reasoning",
                _split(9, 0.78, 3, 0.44),
            )
        db.session.commit()

        reading = strategy_population_reading()
        assert reading["students"] == 12
        section = next(
            entry for entry in reading["sections"] if entry["section"] == "Logical Reasoning"
        )
        result = next(entry for entry in section["results"] if entry["key"] == "argument_core")

        # No individual student is close: nine against three is an effective
        # sample of 2.25.
        assert 3 / (1 / 9 + 1 / 3) < MIN_CONTRAST_SAMPLE
        assert result["contrast_sample"] >= MIN_CONTRAST_SAMPLE
        assert result["eligible"]
        assert result["pooled_lift"] > 0
        assert result["students"] == 12
        assert result["students_with_both_arms"] == 12
        assert "argument_core" in section["measured"]
        assert "argument_core" in section["leading"]


def test_a_well_measured_cell_that_is_only_noise_is_not_named(app):
    """The threshold and the interval are different questions.

    `MIN_CONTRAST_SAMPLE` is set for a student's running total — is this worth
    printing at all. At cohort scale a cell clears it by an order of magnitude
    and can still be indistinguishable from zero, and the first version of this
    reading duly named a three-point difference sitting on a ±8-point interval.

    Both arms here run at exactly the same rate, so the true difference is
    zero, and the cell is measured to the hilt. It must appear in `measured`
    and not in `leading`.
    """
    with app.app_context():
        for index in range(10):
            user = _user(f"noise-{index}@example.test")
            _answers(user, "argument_core", "Logical Reasoning", _split(40, 0.60, 20, 0.60))
        db.session.commit()

        section = strategy_population_reading()["sections"][0]
        result = next(entry for entry in section["results"] if entry["key"] == "argument_core")
        assert result["contrast_sample"] > 10 * MIN_CONTRAST_SAMPLE
        assert result["eligible"]
        assert abs(result["pooled_lift"]) < result["half_width"]
        assert result["separates_from_zero"] is False
        assert section["measured"] == ["argument_core"]
        assert section["leading"] == []


def test_the_two_estimators_disagree_when_one_student_dominates(app):
    """The reason there are two of them.

    The plain pooled difference is unbiased — the trial randomises within a
    student — but it weights the answer toward whoever answered most. Here one
    heavy, weak student supplies most of the rows and has a lopsided arm mix,
    while eleven ordinary students all show the approach helping. Pooling drags
    the estimate toward the heavy student; the within-student average cannot,
    because each student is only ever compared against themselves.

    The gap is reported rather than resolved. A large one is a statement about
    the allocation, and quietly preferring either estimate would hide it.
    """
    with app.app_context():
        for index in range(11):
            user = _user(f"ordinary-{index}@example.test")
            _answers(user, "argument_core", "Logical Reasoning", _split(20, 0.80, 20, 0.50))
        heavy = _user("heavy@example.test")
        _answers(heavy, "argument_core", "Logical Reasoning", _split(400, 0.30, 20, 0.30))
        db.session.commit()

        reading = strategy_population_reading()
        section = next(
            entry for entry in reading["sections"] if entry["section"] == "Logical Reasoning"
        )
        result = next(entry for entry in section["results"] if entry["key"] == "argument_core")

        assert result["pooled_lift"] < result["within_student_lift"]
        assert result["estimator_gap"] > 5
        # And the within-student figure still sees what the eleven saw.
        assert result["within_student_lift"] > 10


def test_the_cohort_reading_keeps_the_two_sections_apart(app):
    """Same rule as the per-student panel, same reason.

    The two sections are measured on different approaches, so a single number
    over both would be an average of two different questions. Each section also
    gets its own baseline, since a shrunk difference has to be centred on the
    accuracy it is being read against.
    """
    with app.app_context():
        for index in range(6):
            user = _user(f"sections-{index}@example.test")
            _answers(user, "argument_core", "Logical Reasoning", _split(10, 0.80, 10, 0.50))
            _answers(user, "main_point_synthesis", "Reading Comprehension", _split(10, 0.40, 10, 0.40))
        db.session.commit()

        reading = strategy_population_reading()
        assert [entry["section"] for entry in reading["sections"]] == [
            "Logical Reasoning",
            "Reading Comprehension",
        ]
        logical, reading_comp = reading["sections"]
        assert logical["baseline_accuracy"] != reading_comp["baseline_accuracy"]
        assert logical["measured"] == logical["leading"] == ["argument_core"]
        # Reading Comprehension is well measured here and flat, which is a
        # result. Reporting it as "nothing to say yet" would be a different
        # and false claim.
        assert reading_comp["measured"] == ["main_point_synthesis"]
        assert reading_comp["leading"] == []
        # No pooled-across-sections figure exists to be misread.
        assert "lift" not in reading


def test_the_cohort_reading_changes_nothing_a_student_sees(app):
    """It is a query. Asserting that is cheap and the alternative is expensive.

    Read twice with an assignment in between and nothing moves: no rows
    written, no arms redrawn, no panel touched.
    """
    from app.models import LayerAssignment

    with app.app_context():
        user = _user("readonly@example.test")
        _answers(user, "argument_core", "Logical Reasoning", _split(10, 0.8, 10, 0.5))
        db.session.commit()

        before = {
            "attempts": Attempt.query.count(),
            "items": SessionItem.query.count(),
            "assignments": LayerAssignment.query.count(),
        }
        first = strategy_population_reading()
        second = strategy_population_reading()
        db.session.commit()

        assert first == second
        assert before == {
            "attempts": Attempt.query.count(),
            "items": SessionItem.query.count(),
            "assignments": LayerAssignment.query.count(),
        }
