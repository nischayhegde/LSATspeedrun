"""The bandit's choice of *which* approach, and the two ways it could be wrong.

`strategy_selection` is the layer that decides whether the approach a student
is dealt comes from the student's own record or from a coin over the same
candidate set. It is the third of the three that shipped deciding and were
compared against nothing, and it is the one whose structure took the most
argument, because the obvious design breaks the trial it sits inside.

The obvious design is to draw this arm only when the offer arm came out
`prompt`, on the ground that a student shown nothing has no approach to choose.
That is true of what the student *experiences* and false of what the row
*records*. A control row carries the approach that would have been offered, and
`_section_reading` compares an approach's prompt rows against that same
approach's control rows. Choose the treated side's approaches by a mixture of
ranked and uniform and the control side's by ranked alone, and the two arms are
no longer labelled by the same process: approach A on the treated side would
include occasions where A is not the student's leader, and A on the control
side would not.

So the draw happens in both offer arms and the *reading* is restricted to the
treated one, which is safe only because the two draws are independent — the
offer hash no longer takes the chosen approach as an input. Every one of those
sentences is a property something could quietly break, and each has a test
here.
"""

from __future__ import annotations

import pytest

from app import create_app
from app.extensions import db
from app.models import Attempt, Question, QuestionChoice, SessionItem, StudySession, User
from app.seed import SOURCE_PREFIX
from app.strategies import (
    BASE_COVERAGE_TRIALS,
    CONTROL_VARIANTS,
    EXPLORE_PROBABILITY,
    PROMPT_VARIANTS,
    _candidate_keys,
    assign_strategy_trial,
    strategy_selection_health,
    strategy_selection_reading,
)


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
        for index in range(6):
            question_id = f"hf-lsat-lr:selection-{index}"
            db.session.add(
                Question(
                    id=question_id,
                    section="Logical Reasoning",
                    question_type="Flaw",
                    stimulus=f"Argument stimulus {index}.",
                    # Worded so `_candidate_keys` offers several approaches;
                    # the layer only has arms where there is a choice.
                    stem=f"The reasoning in argument {index} is most vulnerable to criticism on which ground?",
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
                        canonical_text=f"Answer {label} for {index}",
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


def _past_coverage(user: User, question: Question) -> list[str]:
    """Give this student enough history that the selector starts exploiting.

    Under the coverage target both arms of `strategy_selection` draw uniformly
    over the least-sampled candidates, so there is nothing to compare and no
    arm is drawn. Every test below that is about the arms has to get past it
    first.
    """
    candidates = _candidate_keys(question)
    run = StudySession(
        user_id=user.id,
        mode="practice",
        practice_style="cases",
        feedback_policy="immediate",
        target_minutes=10,
        total_items=len(candidates) * (BASE_COVERAGE_TRIALS + 1),
    )
    db.session.add(run)
    db.session.flush()
    position = 0
    for rank, key in enumerate(candidates):
        for index in range(BASE_COVERAGE_TRIALS + 1):
            item = SessionItem(
                session_id=run.id,
                question_id=question.id,
                position=position,
                strategy_key=key,
                strategy_variant="prompt",
                target_time_seconds=150,
            )
            db.session.add(item)
            db.session.flush()
            db.session.add(
                Attempt(
                    user_id=user.id,
                    session_item_id=item.id,
                    idempotency_key=f"cover-{key}-{index}",
                    selected_label="C",
                    # A clear leader, so "ranked" and "uniform" are visibly
                    # different procedures rather than two names for a
                    # coin flip.
                    is_correct=rank == 0,
                    confidence=3,
                    server_elapsed_ms=60_000,
                    strategy_key=key,
                    strategy_variant="prompt",
                    strategy_applied=True,
                )
            )
            position += 1
    db.session.commit()
    return candidates


def _draws(user: User, question: Question, runs: int) -> list[dict]:
    return [
        assign_strategy_trial(user.id, question, 0, exposure=f"run-{index}")
        for index in range(runs)
    ]


def _wide_question() -> Question:
    question = (
        Question.query.filter_by(section="Logical Reasoning")
        .order_by(Question.id)
        .all()
    )
    for candidate in question:
        if len(_candidate_keys(candidate)) > 1:
            return candidate
    raise AssertionError("no multi-candidate question in the seeded bank")


def test_the_two_offer_arms_choose_their_approach_by_the_same_process(app):
    """The contamination the nested-mechanism version would cause.

    If the selection arm were drawn only inside the treated arm, control rows
    would all carry ranked-chosen approaches while treated rows carried a
    mixture. The offer trial compares an approach against itself across those
    two groups, so the comparison would stop being about the offer and start
    being partly about how the approach was picked — and nothing downstream
    could see it, because both groups would still be the right size.

    What this asserts is the fix: the uniform share is the same on both sides.
    """
    with app.app_context():
        user = _user("both-arms@example.test")
        question = _wide_question()
        _past_coverage(user, question)

        trials = _draws(user, question, 400)
        assert all(trial["selection_arm"] in {"ranked", "uniform"} for trial in trials)

        prompted = [t for t in trials if t["variant"] in PROMPT_VARIANTS]
        controls = [t for t in trials if t["variant"] in CONTROL_VARIANTS]
        assert len(controls) > 50, "the control arm should be about a quarter of 400"

        def uniform_share(rows):
            return sum(row["selection_arm"] == "uniform" for row in rows) / len(rows)

        assert abs(uniform_share(prompted) - uniform_share(controls)) < 0.12
        # And both sit near the design, so neither side is being starved.
        assert 0.15 < uniform_share(prompted) < 0.35
        assert 0.15 < uniform_share(controls) < 0.35


def test_the_offer_arm_no_longer_depends_on_which_approach_was_chosen(app):
    """The independence the restricted reading rests on.

    The offer hash used to include the chosen approach. That was harmless while
    the approach was a deterministic function of history; it is not harmless
    now that the approach depends on a second randomisation, because two draws
    sharing an input are not independent and conditioning on one would then
    disturb the other.

    Measured as it would be in production: the offer's control share must not
    move with the selection arm.
    """
    with app.app_context():
        user = _user("independent@example.test")
        question = _wide_question()
        _past_coverage(user, question)

        trials = _draws(user, question, 400)
        by_selection = {"ranked": [], "uniform": []}
        for trial in trials:
            by_selection[trial["selection_arm"]].append(trial)

        def control_share(rows):
            return sum(row["variant"] in CONTROL_VARIANTS for row in rows) / len(rows)

        assert abs(control_share(by_selection["ranked"]) - control_share(by_selection["uniform"])) < 0.12


def test_the_uniform_arm_really_stops_consulting_the_record(app):
    """An arm that is never off measures nothing; an arm that is nominally off
    while still consulting the ranking measures worse than nothing.

    The student here has one clear leader. Pinned to ranked, the draws
    concentrate on that leader. Pinned to uniform, they spread evenly over the
    candidates — if they did not, the comparison would fill up, report no
    difference, and read as evidence that ranking the candidates does not help.

    The discriminator is the leader's *share*, not how many distinct keys each
    arm reaches. It was the latter when this test was written, on the reasoning
    that the ranked arm could only ever deal rank 0 or rank 1 and so had to be
    the narrower set. That is no longer true and deliberately so: the challenger
    is now drawn from the whole tail weighted by uncertainty, precisely so that
    no candidate is permanently unreachable — see `assign_strategy_trial`. Both
    arms therefore reach every candidate given enough draws, and a set-size
    comparison now says nothing about whether either one is reading the record.
    Concentration still separates them cleanly: measured here, the leader takes
    roughly 0.69 of the ranked draws against 0.43 of the uniform ones.
    """
    with app.app_context():
        user = _user("off-arm@example.test")
        question = _wide_question()
        candidates = _past_coverage(user, question)
        leader = candidates[0]

        app.config["ADAPTIVE_LAYERS"] = {"strategy_selection": {"holdback": 0.0}}
        ranked = [trial["key"] for trial in _draws(user, question, 200)]

        app.config["ADAPTIVE_LAYERS"] = {"strategy_selection": {"holdback": 1.0}}
        uniform = [trial["key"] for trial in _draws(user, question, 200)]

        # The uniform arm is a coin over the candidate set, so it reaches all of
        # it and favours nothing: its leader share sits near 1/len(candidates).
        assert set(uniform) == set(candidates)
        uniform_share = uniform.count(leader) / len(uniform)
        assert uniform_share < 2 / len(candidates)
        # The ranked arm consults the record, so the leader takes the exploit
        # draws — `1 - EXPLORE_PROBABILITY` of them in expectation, and none of
        # the explore draws, which go to the tail. That is the mean rather than
        # a floor, so the same 0.1 sampling allowance the sibling module uses
        # applies here.
        ranked_share = ranked.count(leader) / len(ranked)
        assert ranked_share > 1 - EXPLORE_PROBABILITY - 0.1
        assert ranked_share > uniform_share + 0.2


def test_a_question_with_nothing_to_choose_between_draws_no_arm(app):
    """Two eligibility rules, both of them the no-counterfactual rule.

    Under the coverage target the selector is already drawing uniformly over
    the least-sampled candidates, so the two arms are two names for one
    procedure. On a single-candidate question both arms return that candidate.
    Enrolling either would add rows on which the treatment cannot act and pull
    the difference toward zero — the same dilution `information_need` spends
    mandatory questions to avoid.
    """
    with app.app_context():
        user = _user("nothing-to-choose@example.test")
        question = _wide_question()

        cold = assign_strategy_trial(user.id, question, 0, exposure="run-1")
        assert cold["selection_arm"] is None
        assert cold["selection_propensity"] is None

        _past_coverage(user, question)
        warm = assign_strategy_trial(user.id, question, 0, exposure="run-1")
        assert warm["selection_arm"] in {"ranked", "uniform"}

        narrow = next(
            (
                candidate
                for candidate in Question.query.all()
                if len(_candidate_keys(candidate)) == 1
            ),
            None,
        )
        if narrow is not None:
            single = assign_strategy_trial(user.id, narrow, 0, exposure="run-1")
            assert single["selection_arm"] is None


def _answered(user: User, *, selection_arm: str, variant: str, correct: bool, index: int):
    question = _wide_question()
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
        strategy_key="argument_core",
        strategy_variant=variant,
        strategy_propensity=0.75 if variant in PROMPT_VARIANTS else 0.25,
        strategy_selection_arm=selection_arm,
        strategy_selection_propensity=0.75 if selection_arm == "ranked" else 0.25,
        target_time_seconds=150,
    )
    db.session.add(item)
    db.session.flush()
    db.session.add(
        Attempt(
            user_id=user.id,
            session_item_id=item.id,
            idempotency_key=f"sel-{user.id}-{index}",
            selected_label="C",
            is_correct=correct,
            server_elapsed_ms=60_000,
            strategy_key="argument_core",
            strategy_variant=variant,
            strategy_propensity=0.75 if variant in PROMPT_VARIANTS else 0.25,
            strategy_selection_arm=selection_arm,
            strategy_selection_propensity=0.75 if selection_arm == "ranked" else 0.25,
        )
    )


def test_the_reading_is_restricted_to_offered_questions(app):
    """Control rows carry a selection arm and must not be read through it.

    They are built here to point the *opposite* way, so a reading that included
    them would not merely be noisier — it would come out with the wrong sign.
    That is deliberate: an assertion that survives a rounding error is not an
    assertion about the restriction.
    """
    with app.app_context():
        user = _user("restricted@example.test")
        index = 0
        for _ in range(30):
            # Offered: ranked beats uniform.
            _answered(user, selection_arm="ranked", variant="prompt", correct=True, index=index)
            index += 1
            _answered(user, selection_arm="uniform", variant="prompt", correct=False, index=index)
            index += 1
            # Not offered: the arm changed nothing the student saw, and this
            # history points the other way to prove the rows are excluded.
            _answered(
                user, selection_arm="ranked", variant="control_visible", correct=False, index=index
            )
            index += 1
            _answered(
                user, selection_arm="uniform", variant="control_visible", correct=True, index=index
            )
            index += 1
        db.session.commit()

        reading = strategy_selection_reading()
        section = next(
            entry for entry in reading["sections"] if entry["section"] == "Logical Reasoning"
        )
        assert section["ranked_sample"] == 30
        assert section["uniform_sample"] == 30
        assert section["pooled_lift"] > 0
        assert section["within_student_lift"] > 0
        assert reading["population"].startswith("questions in the prompt arm")


def test_health_sees_two_coupled_draws_that_the_pooled_share_calls_healthy(app):
    """The instrument, pointed at the failure the nesting argument was about.

    Rows are built by hand, because the mechanism cannot produce this state any
    more and an instrument that has only been pointed at working data has not
    been tested. The shape is a selection arm correlated with the offer arm:
    inside the prompt arm it is nearly always ranked, inside the control arm
    nearly always uniform. Pooled it reads a perfectly healthy quarter.
    """
    with app.app_context():
        user = _user("coupled@example.test")
        index = 0
        for step in range(120):
            _answered(
                user,
                selection_arm="ranked" if step % 20 else "uniform",
                variant="prompt",
                correct=True,
                index=index,
            )
            index += 1
        for step in range(40):
            _answered(
                user,
                selection_arm="uniform" if step % 5 else "ranked",
                variant="control_visible",
                correct=True,
                index=index,
            )
            index += 1
        db.session.commit()

        health = strategy_selection_health()
        # What an aggregate says, and why nobody would notice: 24.4% against a
        # design of 25%, which reads as ordinary sampling noise.
        assert 0.20 <= health["pooled_uniform_share"] <= 0.30
        # What the per-student, per-offer-arm reading says.
        assert health["students_with_both_offer_arms"] == 1
        assert health["max_arm_gap"] > 0.5
