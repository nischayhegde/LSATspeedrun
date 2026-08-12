"""The instrument that stands in for FSRS's missing control arm.

`review_scheduling` is the one layer in the registry with no holdout. The
reasoning is on its entry in `app/experiments.py` and the arithmetic is in
`tools/audit/measurement_cost.py`; in one sentence, the exposure would have to
be per student, per student means the sample grows at signup rate rather than
answer rate, and the off arm is a scheduler the team believes is worse shipped
for the life of a trial this app's scale cannot finish.

What replaces it works because FSRS is a predictive model rather than only a
policy. It commits to a number before every review — the chance this student
recalls this card right now — and that number can be scored afterwards against
what happened, by one student, with no comparison group at all.

The tests here are about whether the instrument can return a negative result,
which is the only property that makes it worth having. A calibration reading
that agreed with the scheduler no matter what the scheduler did would be
decoration.
"""

from __future__ import annotations

import pytest

from app import create_app
from app.extensions import db
from app.models import Attempt, Question, QuestionChoice, SessionItem, StudySession, User
from app.scheduling import predicted_recall, review_calibration
from app.seed import SOURCE_PREFIX


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
        question_id = "hf-lsat-lr:calibration-0"
        db.session.add(
            Question(
                id=question_id,
                section="Logical Reasoning",
                question_type="Flaw",
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


def _scored(user: User, pairs: list[tuple[float, bool]]) -> None:
    """Reviews that were predicted at `p` and came back `correct`."""
    question = Question.query.first()
    run = StudySession(
        user_id=user.id,
        mode="practice",
        practice_style="cases",
        feedback_policy="immediate",
        target_minutes=10,
        total_items=len(pairs),
    )
    db.session.add(run)
    db.session.flush()
    for position, (predicted, correct) in enumerate(pairs):
        item = SessionItem(
            session_id=run.id,
            question_id=question.id,
            position=position,
            from_review_queue=True,
            target_time_seconds=150,
        )
        db.session.add(item)
        db.session.flush()
        db.session.add(
            Attempt(
                user_id=user.id,
                session_item_id=item.id,
                idempotency_key=f"cal-{user.id}-{position}",
                selected_label="C",
                is_correct=correct,
                server_elapsed_ms=60_000,
                predicted_retrievability=predicted,
            )
        )
    db.session.commit()


def _user(email: str) -> User:
    user = User(email=email, display_name=email.split("@")[0])
    db.session.add(user)
    db.session.flush()
    return user


def _pattern(band_rates: dict[float, float], per_band: int) -> list[tuple[float, bool]]:
    pairs = []
    for predicted, realised in band_rates.items():
        for index in range(per_band):
            pairs.append((predicted, index < round(realised * per_band)))
    return pairs


def test_a_well_calibrated_scheduler_scores_better_than_knowing_nothing(app):
    """The positive case, which is also the definition of the reading.

    Predictions that come true at the rate they claim beat a constant predictor
    at the overall rate, and `skill` is the fraction of the constant's error
    they remove. It is above zero here and the curve tracks the diagonal.
    """
    with app.app_context():
        user = _user("calibrated@example.test")
        _scored(user, _pattern({0.4: 0.4, 0.6: 0.6, 0.8: 0.8, 0.94: 0.94}, 100))

        reading = review_calibration()
        assert reading["reviews"] == 400
        # A perfectly calibrated predictor over this spread scores 0.193, and
        # that is the ceiling rather than a modest showing: the base rate is
        # 68.5%, so a constant scores 0.685 × 0.315 = 0.2158, and the model
        # scores the mean of p(1−p) = 0.1741. Worth stating because a reader
        # who expects a "good" skill score to be near one will read a correct
        # instrument as a broken scheduler.
        assert 0.15 < reading["skill"] < 0.25
        assert reading["brier"] < reading["brier_baseline"]
        for band in reading["bands"]:
            if band["reviews"]:
                assert abs(band["gap"]) <= 1.0
        # And it discriminates: the bottom band comes back far less often than
        # the top one, which is what a scheduler is for.
        assert reading["band_spread"] > 40


def test_a_flat_curve_is_a_null_result_and_the_reading_says_so(app):
    """The negative case, and the reason this instrument is worth having.

    Every band comes back at the same rate regardless of what was predicted.
    The per-card memory state is then carrying no information about recall,
    which is a null result for the whole layer — and it is reachable here on a
    few hundred reviews without ever withholding the scheduler from anybody.

    This is the shape a broken `derive_grade` would eventually produce, since
    stability is computed from the grade and a grade uncorrelated with recall
    gives stabilities uncorrelated with recall.
    """
    with app.app_context():
        user = _user("flat@example.test")
        _scored(user, _pattern({0.4: 0.7, 0.6: 0.7, 0.8: 0.7, 0.94: 0.7}, 100))

        reading = review_calibration()
        assert reading["band_spread"] == 0.0
        # No skill: the model does worse than simply predicting the base rate,
        # because its confident predictions are confidently misplaced.
        assert reading["skill"] < 0
        assert reading["brier"] > reading["brier_baseline"]


def test_a_displaced_curve_is_a_different_finding_from_a_flat_one(app):
    """Monotone but optimistic: the grades are too generous, not uninformative.

    Worth separating, because the two call for different repairs. A displaced
    curve is a tuning problem in `derive_grade` — every interval a little too
    long. A flat one says the memory state is not tracking anything. The
    reading distinguishes them: `band_spread` stays wide here while every
    band's `gap` is negative.
    """
    with app.app_context():
        user = _user("optimistic@example.test")
        _scored(user, _pattern({0.4: 0.25, 0.6: 0.45, 0.8: 0.65, 0.94: 0.79}, 100))

        reading = review_calibration()
        assert reading["band_spread"] > 40
        gaps = [band["gap"] for band in reading["bands"] if band["reviews"]]
        assert all(gap < -10 for gap in gaps)


def test_a_card_the_model_has_not_graded_makes_no_prediction_to_score(app):
    """None rather than zero, and the difference is the whole reading.

    `card_retrievability` reports 0.0 for a card with no stability because 0.0
    is where a just-missed question belongs in a queue. Scoring that as a
    prediction would fill the bottom band with first encounters — which the
    student mostly gets wrong — and the curve would look beautifully calibrated
    for a reason having nothing to do with FSRS.
    """
    from app.models import ReviewQueueItem, utcnow

    with app.app_context():
        user = _user("ungraded@example.test")
        question = Question.query.first()
        card = ReviewQueueItem(
            user_id=user.id,
            question_id=question.id,
            status="due",
            reason_code="wrong",
            interval_index=0,
            due_at=utcnow(),
        )
        db.session.add(card)
        db.session.flush()
        assert predicted_recall(card) is None

        card.stability = 10.0
        card.last_reviewed_at = utcnow()
        assert predicted_recall(card) > 0.9


def test_an_empty_reading_says_it_is_empty_rather_than_reporting_a_score(app):
    with app.app_context():
        reading = review_calibration()
        assert reading["reviews"] == 0
        assert reading["brier"] is None
        assert reading["skill"] is None


def test_the_prediction_is_recorded_on_a_real_review_return(app):
    """End to end, because a column nothing writes is not an instrument.

    The prediction has to be captured between the rewind and the advance: the
    rewind restores the state the card was in before this attempt, and the
    advance destroys it. A recording on either side of that window would be a
    prediction about a different card state.
    """
    from datetime import timedelta

    from app.models import ReviewQueueItem, utcnow
    from app.services import _schedule_review

    with app.app_context():
        user = _user("wired@example.test")
        question = Question.query.first()
        card = ReviewQueueItem(
            user_id=user.id,
            question_id=question.id,
            status="due",
            reason_code="wrong",
            interval_index=1,
            stability=8.0,
            difficulty=5.0,
            reps=1,
            last_reviewed_at=utcnow() - timedelta(days=4),
            due_at=utcnow(),
        )
        db.session.add(card)
        run = StudySession(
            user_id=user.id,
            mode="practice",
            practice_style="cases",
            feedback_policy="immediate",
            target_minutes=10,
            total_items=1,
        )
        db.session.add(run)
        db.session.flush()
        item = SessionItem(
            session_id=run.id,
            question_id=question.id,
            position=0,
            from_review_queue=True,
            target_time_seconds=150,
            served_at=utcnow(),
        )
        db.session.add(item)
        db.session.flush()
        attempt = Attempt(
            user_id=user.id,
            session_item_id=item.id,
            idempotency_key="wired-0",
            selected_label="C",
            is_correct=True,
            confidence=4,
            server_elapsed_ms=60_000,
        )
        db.session.add(attempt)
        db.session.flush()

        before = card.stability
        _schedule_review(attempt)
        db.session.commit()

        # Four days into an eight-day stability, so the model was fairly
        # confident and said so.
        assert 0.8 < attempt.predicted_retrievability < 1.0
        # And the answer moved the card, which is why the prediction could not
        # have been reconstructed afterwards.
        assert card.stability != before
