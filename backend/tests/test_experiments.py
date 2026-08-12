"""The measurement spine, and the failure it exists to make unrepeatable.

The strategy trial's control arm was a hash of (student, question, slot, style).
Across the hash space it drew 25%, exactly as designed, and every bank-wide
check agreed with it. For an individual heavy user it collapsed to 2%, because a
review question returning to the same slot re-drew the same arm forever and the
review half of a run is a small recirculating set.

Two properties would each have caught that, and both are asserted here: the
draw cannot be made without naming the encounter, and the health check reads the
realised share *per student* rather than pooled over students. The last test in
this file feeds the health check a hand-built collapse and requires it to
notice, because an instrument that has only ever been pointed at working data
has not been tested.
"""

from __future__ import annotations

import random

import pytest

from app import create_app
from app.experiments import (
    HEALTH_MIN_DRAWS,
    LAYERS,
    Exposure,
    assign,
    assignment_health,
    layer_reading,
    registry_reading,
)
from app.extensions import db
from app.models import (
    LayerAssignment,
    PlayerProfile,
    Question,
    QuestionChoice,
    StudySession,
    User,
)
from app.seed import SOURCE_PREFIX
from app.services import create_study_session


LAYER = "weak_type_targeting"


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
    return application


def make_user(email: str) -> User:
    user = User(email=email, display_name=email.split("@")[0])
    db.session.add(user)
    db.session.flush()
    return user


def test_a_layer_randomised_per_run_refuses_a_student_exposure(app):
    """The substitution that produced the original defect is a type error.

    Handing "the student" to a layer whose effect is a property of a run is
    precisely the coarsening that made the strategy trial's draw stop being a
    draw. It cannot be written here: the argument is not a string.
    """
    with app.app_context():
        user = make_user("unit@example.test")
        with pytest.raises(ValueError, match="randomised per run"):
            assign(LAYER, user.id, exposure=Exposure.student(user.id))
        with pytest.raises(ValueError, match="randomised per run"):
            assign(LAYER, user.id, exposure=Exposure.item("session-1", 0))


def test_an_unknown_layer_is_a_loud_error_rather_than_a_silent_default(app):
    with app.app_context():
        user = make_user("unknown@example.test")
        with pytest.raises(KeyError, match="unknown adaptive layer"):
            assign("no_such_layer", user.id, exposure=Exposure.run("session-1"))


def test_the_same_exposure_returns_the_same_arm_and_writes_one_row(app):
    """A student is never flipped mid-run, and asking twice is not two draws."""
    with app.app_context():
        user = make_user("stable@example.test")
        first = assign(LAYER, user.id, exposure=Exposure.run("session-1"))
        db.session.commit()
        second = assign(LAYER, user.id, exposure=Exposure.run("session-1"))
        db.session.commit()

        assert (first.arm, first.propensity) == (second.arm, second.propensity)
        assert LayerAssignment.query.filter_by(subject_id=user.id).count() == 1


def test_a_new_run_is_a_new_draw_and_one_student_sees_both_arms(app):
    """The property the old scheme lost.

    A student running two hundred sittings must not be locked into whichever
    arm their first one drew. This is asserted on one student's realised share,
    not on the pooled share across students, because the pooled share was
    correct throughout the failure.
    """
    with app.app_context():
        user = make_user("heavy@example.test")
        arms = [
            assign(LAYER, user.id, exposure=Exposure.run(f"session-{index}")).arm
            for index in range(200)
        ]
        db.session.commit()

        off = arms.count(LAYERS[LAYER].off_arm) / len(arms)
        design = LAYERS[LAYER].share(LAYERS[LAYER].off_arm)
        assert abs(off - design) < 0.08, f"one student's realised holdback was {off:.3f}"
        assert LayerAssignment.query.filter_by(subject_id=user.id).count() == 200


def test_the_recorded_propensity_is_the_share_actually_in_force(app):
    """Not the design's nominal share: the one this draw was made under.

    A later inverse-propensity fit divides by this column, so a deployment that
    narrows a holdback must not leave earlier rows claiming a probability
    nobody was drawn at — and must not have its own rows rewritten when the
    dial moves again.
    """
    with app.app_context():
        user = make_user("propensity@example.test")
        arms = [
            assign(LAYER, user.id, exposure=Exposure.run(f"wide-{index}")) for index in range(60)
        ]
        db.session.commit()
        assert {round(value.propensity, 3) for value in arms} == {0.75, 0.25}

        app.config["ADAPTIVE_LAYERS"] = {LAYER: {"holdback": 0.5}}
        narrow = [
            assign(LAYER, user.id, exposure=Exposure.run(f"narrow-{index}")) for index in range(60)
        ]
        db.session.commit()
        assert {round(value.propensity, 3) for value in narrow} == {0.5}

        # The earlier rows still say what they were drawn under.
        old = LayerAssignment.query.filter(LayerAssignment.exposure.like("wide-%")).all()
        assert {round(row.propensity, 3) for row in old} == {0.75, 0.25}
        # And a re-read of an old exposure returns the recorded row, not a
        # fresh draw under the new shares.
        again = assign(LAYER, user.id, exposure=Exposure.run("wide-0"))
        assert round(again.propensity, 3) in {0.75, 0.25}


def test_switching_a_layer_off_is_not_recorded_as_a_draw(app):
    """A deployment-wide kill switch is not a randomisation.

    Writing it down as one would put a pool of size one into an estimator that
    weights by the inverse of the propensity, which is a row that claims to
    stand for itself alone and quietly outvotes nothing.
    """
    with app.app_context():
        user = make_user("switched@example.test")
        app.config["ADAPTIVE_LAYERS"] = {LAYER: {"enabled": False}}
        result = assign(LAYER, user.id, exposure=Exposure.run("session-1"))
        db.session.commit()

        assert result.randomised is False
        assert result.on is False
        assert LayerAssignment.query.count() == 0


def test_two_layers_on_one_run_are_independent_draws(app):
    """Same student, same run, different layers: not the same coin read twice."""
    with app.app_context():
        user = make_user("independent@example.test")
        pairs = []
        for index in range(120):
            exposure = Exposure.run(f"session-{index}")
            pairs.append(
                (
                    assign("weak_type_targeting", user.id, exposure=exposure).arm,
                    assign("run_sequencing", user.id, exposure=exposure).arm,
                )
            )
        db.session.commit()
        agreement = sum(
            (first == "targeted") == (second == "personalised") for first, second in pairs
        ) / len(pairs)
        # Independent draws at the same shares agree about 62.5% of the time
        # (0.75² + 0.25²); a shared coin would agree on every run.
        assert 0.45 < agreement < 0.80, agreement


def test_health_reads_a_broken_allocation_that_the_pooled_share_calls_healthy(app):
    """The instrument, pointed at the failure it was built for.

    Rows are written by hand rather than drawn, because what is under test is
    whether the check can see a collapse — and the spine's own draw cannot
    produce one. This is the shape the strategy trial was in last night: pooled
    across students the holdback reads a healthy quarter, while the two heaviest
    accounts, the ones with enough history for their questions to recirculate,
    sit near zero.
    """
    with app.app_context():
        healthy = [make_user(f"healthy-{index}@example.test") for index in range(40)]
        for user in healthy:
            for index in range(HEALTH_MIN_DRAWS):
                db.session.add(
                    LayerAssignment(
                        layer=LAYER,
                        subject_id=user.id,
                        unit="run",
                        exposure=f"{user.id}-{index}",
                        arm="untargeted" if index % 4 == 0 else "targeted",
                        propensity=0.25 if index % 4 == 0 else 0.75,
                        design_version=LAYERS[LAYER].design_version,
                    )
                )
        stuck = [make_user(f"stuck-{index}@example.test") for index in range(2)]
        for user in stuck:
            for index in range(100):
                db.session.add(
                    LayerAssignment(
                        layer=LAYER,
                        subject_id=user.id,
                        unit="run",
                        exposure=f"{user.id}-{index}",
                        arm="untargeted" if index % 50 == 0 else "targeted",
                        propensity=0.25 if index % 50 == 0 else 0.75,
                        design_version=LAYERS[LAYER].design_version,
                    )
                )
        db.session.commit()

        health = assignment_health(LAYER)
        off = next(entry for entry in health["arms"] if entry["arm"] == "untargeted")
        # What the aggregate says, and why nobody noticed for months: 20.4%
        # against a design of 25%, which reads as ordinary sampling noise.
        assert 0.18 <= off["pooled_share"] <= 0.25
        # What the per-student reading says.
        assert off["min_student_share"] <= 0.05
        assert off["students_off_design"] == 2


def test_health_ignores_students_with_too_few_draws_to_read(app):
    """Ten runs at a quarter holdback expects 2.5 controls, so zero is ordinary.

    A check that flagged those would cry wolf on every new account and be
    switched off within a week, which is the failure mode of a monitor rather
    than of a mechanism.
    """
    with app.app_context():
        user = make_user("new@example.test")
        for index in range(HEALTH_MIN_DRAWS - 1):
            db.session.add(
                LayerAssignment(
                    layer=LAYER,
                    subject_id=user.id,
                    unit="run",
                    exposure=f"{user.id}-{index}",
                    arm="targeted",
                    propensity=0.75,
                    design_version=LAYERS[LAYER].design_version,
                )
            )
        db.session.commit()

        health = assignment_health(LAYER)
        off = next(entry for entry in health["arms"] if entry["arm"] == "untargeted")
        assert health["draws"] == HEALTH_MIN_DRAWS - 1
        assert off["students_measured"] == 0
        assert off["students_off_design"] == 0


def test_a_reading_with_no_answers_reports_an_empty_denominator(app):
    """Not a difference of zero. The two are opposite claims."""
    with app.app_context():
        user = make_user("empty@example.test")
        assign(LAYER, user.id, exposure=Exposure.run("session-1"))
        db.session.commit()

        reading = layer_reading(LAYER)
        assert reading["answers"] == 0
        assert reading["adjusted_lift"] is None
        assert reading["contrast_sample"] == 0.0
        assert all(entry["accuracy"] is None for entry in reading["arms"])


def _stock_bank() -> None:
    """A bank wide enough that a focus bias has somewhere to bias toward."""
    for index in range(60):
        question_type = "Flaw" if index % 3 == 0 else "Strengthen"
        question_id = f"hf-lsat-lr:layer-{index}"
        db.session.add(
            Question(
                id=question_id,
                section="Logical Reasoning",
                question_type=question_type,
                difficulty=3,
                stimulus=f"Stimulus {index}.",
                stem=f"Which one of the following is most accurate about argument {index}?",
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
                    canonical_text=f"Choice {label} for {index}",
                    position=position,
                )
            )


def _runs_with_focus(app, monkeypatch, *, holdback: float, runs: int) -> tuple[list[str], list[str]]:
    """Practice runs for students whose diagnostic named one weak type."""
    app.config["ADAPTIVE_LAYERS"] = {LAYER: {"holdback": holdback}}
    monkeypatch.setattr("app.services.diagnostic_focus", lambda _user_id: ["Flaw"])
    served: list[str] = []
    users: list[str] = []
    for index in range(runs):
        user = make_user(f"wired-{holdback}-{index}@example.test")
        db.session.add(
            PlayerProfile(user_id=user.id, lawyer_name="A", firm_name="B", character_gender="male")
        )
        db.session.commit()
        session = create_study_session(user, count=6)
        served.extend(item.question.question_type for item in session.items)
        users.append(user.id)
    return users, served


def test_the_run_records_its_arm_and_the_off_arm_really_stops_the_steering(app, monkeypatch):
    """End to end, through the path a student actually takes.

    Both arms forced by configuration rather than by hoping the hash lands the
    right way, and the assertion is about what the students were served rather
    than about what the code intended: a holdback that records an arm and
    steers the run anyway would satisfy a mock and fail a person.

    Pooled over four runs an arm, and the global RNG is pinned, because
    selection shuffles: a single six-question run can land at two thirds focus
    material by luck, and a test that flakes one time in fifty teaches people
    to re-run it.
    """
    with app.app_context():
        random.seed(20260812)
        _stock_bank()
        db.session.commit()

        on_users, on_types = _runs_with_focus(app, monkeypatch, holdback=0.0, runs=4)
        off_users, off_types = _runs_with_focus(app, monkeypatch, holdback=1.0, runs=4)

        on_row = LayerAssignment.query.filter_by(subject_id=on_users[0]).one()
        assert on_row.arm == "targeted"
        assert on_row.exposure == on_row.session_id
        assert StudySession.query.filter_by(id=on_row.session_id).one().user_id == on_users[0]

        off_row = LayerAssignment.query.filter_by(subject_id=off_users[0]).one()
        assert off_row.arm == "untargeted"

        # A third of this bank is the focus type, and the targeted arm fills
        # 60% of a run's fresh material from it. The off arm must land near the
        # bank's own mix instead.
        assert on_types.count("Flaw") / len(on_types) >= 0.6
        assert off_types.count("Flaw") / len(off_types) <= 0.5


def test_a_run_with_nothing_to_target_is_left_out_of_the_comparison(app, monkeypatch):
    """No diagnostic, no focus types, no draw.

    Enrolling those runs would fill both arms with sittings on which the
    treatment is a no-op and pull any real difference toward zero — the same
    dilution `strategies.information_need` spends mandatory questions to avoid.
    """
    with app.app_context():
        _stock_bank()
        monkeypatch.setattr("app.services.diagnostic_focus", lambda _user_id: [])
        user = make_user("nofocus@example.test")
        db.session.add(
            PlayerProfile(user_id=user.id, lawyer_name="A", firm_name="B", character_gender="male")
        )
        db.session.commit()

        create_study_session(user, count=6)
        assert LayerAssignment.query.filter_by(subject_id=user.id).count() == 0


def test_the_registry_describes_every_layer_including_the_ones_it_does_not_draw(app):
    """The census is the point: one list of what decides what a student sees."""
    with app.app_context():
        reading = registry_reading()
        keys = {entry["layer"] for entry in reading}
        assert {"strategy_offer", "strategy_forcing"} <= keys
        for entry in reading:
            assert entry["off_arm"] in entry["arms"]
            assert entry["signal"] and entry["without_signal"] and entry["question"]
        external = [entry for entry in reading if entry["assigned_by"] != "app/experiments.py"]
        assert external, "the strategy trial is part of the system and belongs in the census"
        assert layer_reading("strategy_offer")["measured_elsewhere"] is True
