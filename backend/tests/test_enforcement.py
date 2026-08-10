"""Strategy gates: does choosing an approach actually commit you to it.

This module runs at the production default (`STRATEGY_ENFORCEMENT_ENABLED` is
left alone) precisely because the rest of the suite turns enforcement off. Its
job is the enforced path: every gate kind, every anti-gaming check, the pieces
of the strategy trial that enforcement is not allowed to disturb, and the ways
out for a student the gate is not helping.
"""

from __future__ import annotations

import pytest

from app import create_app
from app.enforcement import (
    ENFORCEMENT_VERSION,
    GATES,
    LEVEL_FULL,
    LEVEL_LIGHT,
    LEVEL_NONE,
    MASTERY_MIN_SATISFIED,
    build_gate,
    split_sentences,
)
from app.extensions import db
from app.models import Attempt, Passage, Question, QuestionChoice, SessionItem, StudySession, utcnow
from app.seed import SOURCE_PREFIX
from app.strategies import (
    STRATEGIES,
    _candidate_keys,
    detect_comparative,
    is_comparative,
    strategy_performance,
)


LR_STIMULUS = (
    "Residents of Halford drink far more coffee than residents of Denby. "
    "Halford also reports more insomnia than Denby does. "
    "The coffee habit in Halford must therefore be producing the insomnia."
)

RC_PASSAGE = (
    "Whitlock maintains that municipal archives belong to the public and should be digitized without charge.\n\n"
    "Grimes objects that digitization costs money and that the fee protects the collection from neglect.\n\n"
    "The dispute is less about money than about who the archive is understood to serve."
)

CHOICE_TEXTS = {
    "A": "Every single household in the region always suffers the same sleeplessness.",
    "B": "Some households in the region reduced their spending last winter.",
    "C": "Sleeplessness may itself lead people to drink more of the beverage.",
    "D": "No municipal survey has ever measured beverage habits anywhere.",
    "E": "The regional council intends to publish a report next year.",
}


def add_lr_question(index: int) -> str:
    question_id = f"hf-lsat-lr:enforce-{index}"
    db.session.add(
        Question(
            id=question_id,
            section="Logical Reasoning",
            question_type="Flaw",
            difficulty=3,
            stimulus=LR_STIMULUS,
            stem="Which one of the following most weakens the argument?",
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
                canonical_text=CHOICE_TEXTS[label],
                position=position,
            )
        )
    return question_id


def add_rc_question(index: int) -> str:
    passage_id = "enforce-passage"
    if not db.session.get(Passage, passage_id):
        db.session.add(
            Passage(
                id=passage_id,
                canonical_text=RC_PASSAGE,
                passage_type="Reading Comprehension",
                source=f"{SOURCE_PREFIX}rc",
                review_status="published",
            )
        )
    question_id = f"hf-lsat-rc:enforce-{index}"
    db.session.add(
        Question(
            id=question_id,
            passage_id=passage_id,
            section="Reading Comprehension",
            question_type="Main Point",
            difficulty=3,
            stimulus=None,
            stem="Which one of the following states the main point of the passage?",
            correct_answer="C",
            source=f"{SOURCE_PREFIX}rc · train",
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
                canonical_text=CHOICE_TEXTS[label],
                position=position,
            )
        )
    return question_id


@pytest.fixture()
def app():
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
            "DEV_AUTH_ENABLED": True,
            "PRACTICE_SESSION_SIZE": 4,
            "TFY_URL": "",
            "TFY_API_KEY": "",
            "AI_JOBS_MODE": "sync",
        }
    )
    with application.app_context():
        for index in range(6):
            add_lr_question(index)
        for index in range(6, 10):
            add_rc_question(index)
        db.session.commit()
    return application


def login(client, email: str = "gate@example.test") -> dict[str, str]:
    assert client.post("/v1/auth/dev", json={"email": email, "display_name": "Gate Student"}).status_code == 200
    csrf = client.get_cookie("lsat_csrf")
    assert csrf
    return {"X-CSRF-Token": csrf.value}


def create_game(client, headers):
    response = client.post(
        "/v1/game/profile",
        json={"lawyer_name": "Alex Morgan", "firm_name": "Morgan Legal", "character_gender": "female"},
        headers=headers,
    )
    assert response.status_code == 201


def explanation(marker: str) -> str:
    return (
        f"The conclusion depends on the link that {marker} makes explicit, and the credited "
        "choice supplies exactly that connection while every other option either widens "
        "the scope or swaps the term the argument actually needs."
    )


def start(client, headers) -> dict:
    return client.post("/v1/study-sessions", headers=headers).json["session"]


def arm(app, session_id: str, strategy_key: str, *, level: str = LEVEL_FULL, variant: str = "prompt", section: str = "Logical Reasoning"):
    """Put a chosen strategy and gate level on the current question.

    The bandit in `assign_strategy_trial` decides which approach a real question
    offers, so a test that wants to exercise one specific gate has to say so.
    """
    with app.app_context():
        session = db.session.get(StudySession, session_id)
        item = next(value for value in session.items if value.position == session.current_index)
        if item.question.section != section:
            item.question_id = next(
                question.id
                for question in Question.query.filter_by(section=section).all()
            )
        item.strategy_key = strategy_key
        item.strategy_variant = variant
        item.strategy_enforcement_level = level
        item.strategy_propensity = 0.75
        item.strategy_candidates_n = 3
        db.session.commit()


def gate_of(client, headers, session_id: str) -> dict:
    item = client.get(f"/v1/study-sessions/{session_id}", headers=headers).json["session"]["current_item"]
    return item["strategy_gate"]


def submit(client, headers, session_id: str, item_id: str, fields, *, label: str = "C", key: str = "gate-1", applied: bool = True, gate_ms: int = 0):
    body = {
        "item_id": item_id,
        "selected_label": label,
        "reasoning": explanation(key),
        "confidence": 3,
        "strategy_applied": applied,
        "strategy_prompt_ms": 1200,
        "strategy_gate_ms": gate_ms,
    }
    if fields is not None:
        body["strategy_artifact"] = {"fields": fields}
    return client.post(
        f"/v1/study-sessions/{session_id}/attempts",
        json=body,
        headers={**headers, "Idempotency-Key": key},
    )


def field_error(response) -> str:
    return " ".join(entry["message"] for entry in response.json["error"]["fields"])


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------


def test_every_published_strategy_carries_a_gate_and_an_honest_strength_rating():
    assert set(GATES) == set(STRATEGIES)
    for key, gate in GATES.items():
        assert gate["strength"] in {"strong", "moderate"}
        assert gate["fields"], f"{key} has no required operation"
        assert gate["instruction"] and gate["confirm"]
        # A gate rated below `strong` has to say why in the catalog rather than
        # letting a reader assume every one of these is airtight.
        if gate["strength"] != "strong":
            assert gate["weakness"], f"{key} is not strong and does not say why"
        assert "—" not in gate["instruction"] + gate["confirm"]


def test_gate_copy_holds_the_house_style():
    """No em dashes anywhere, and every failure message actually says something."""
    from app.enforcement import GATE_COPY

    strings = list(GATE_COPY.values())
    for gate in GATES.values():
        strings.extend([gate["instruction"], gate["confirm"], gate["weakness"]])
        for field in gate["fields"]:
            strings.extend(value for value in field.values() if isinstance(value, str))
    for value in strings:
        assert "—" not in value
        assert "–" not in value
    # Every field that can fail carries authored copy for the failure, so a
    # student never meets a generic refusal on a gate they opted into.
    for key, gate in GATES.items():
        for field in gate["fields"]:
            failures = [
                field[name]
                for name in field
                if name.endswith("_message") or name == "message"
            ]
            assert any(failures), f"{key}.{field['key']} has no authored failure copy"


# ---------------------------------------------------------------------------
# Sequencing: the choices are not in the page yet
# ---------------------------------------------------------------------------


def test_prephrase_withholds_the_choices_and_refuses_an_answer_without_a_prediction(app):
    client = app.test_client()
    headers = login(client)
    create_game(client, headers)
    session = start(client, headers)
    arm(app, session["id"], "prephrase")

    gate = gate_of(client, headers, session["id"])
    assert gate["kind"] == "sequence_reveal"
    assert gate["hides_choices"] is True
    assert gate["blocking"] is True
    assert gate["version"] == ENFORCEMENT_VERSION

    refused = submit(client, headers, session["id"], session["current_item"]["id"], None, key="no-prediction")
    assert refused.status_code == 409
    assert refused.json["error"]["code"] == "strategy_gate_unsatisfied"

    accepted = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {"prediction": "It has to give a rival explanation for the sleeplessness that does not run through the drink."},
        key="with-prediction",
    )
    assert accepted.status_code == 200

    with app.app_context():
        attempt = Attempt.query.one()
        assert attempt.strategy_gate_status == "satisfied"
        assert attempt.strategy_enforcement_version == ENFORCEMENT_VERSION
        assert attempt.strategy_artifact_json["prediction"].startswith("It has to give")


@pytest.mark.parametrize(
    "prediction",
    [
        "asdf",
        "aaaa bbbb",
        # The cheapest way to clear a word count is to repeat one word past it.
        "asdf asdf asdf asdf asdf asdf asdf asdf",
        "coffee coffee coffee coffee coffee coffee coffee",
        "Which one of the following most weakens the argument?",
    ],
)
def test_a_prediction_that_is_noise_or_the_stem_read_back_is_rejected(app, prediction):
    client = app.test_client()
    headers = login(client)
    create_game(client, headers)
    session = start(client, headers)
    arm(app, session["id"], "prephrase")

    response = submit(
        client, headers, session["id"], session["current_item"]["id"], {"prediction": prediction}, key=f"junk-{len(prediction)}"
    )
    assert response.status_code == 409
    assert response.json["error"]["fields"][0]["field"] == "prediction"
    with app.app_context():
        # A refused gate leaves nothing behind. There is no half-graded attempt
        # and no penalty for having tried.
        assert Attempt.query.count() == 0


def test_flaw_abstraction_rejects_the_topics_own_words(app):
    client = app.test_client()
    headers = login(client)
    create_game(client, headers)
    session = start(client, headers)
    arm(app, session["id"], "flaw_abstraction")

    borrowed = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {"abstraction": "The coffee in Halford is treated as the source of the insomnia among those residents."},
        key="topic-words",
    )
    assert borrowed.status_code == 409
    assert "topic" in field_error(borrowed).lower()

    abstract = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {"abstraction": "Treats two things that appear together as proof that one of them produces the other."},
        key="abstracted",
    )
    assert abstract.status_code == 200


# ---------------------------------------------------------------------------
# Per-choice operations: the elimination gate the request named
# ---------------------------------------------------------------------------


def test_the_final_answer_is_blocked_until_three_choices_are_struck(app):
    client = app.test_client()
    headers = login(client)
    create_game(client, headers)
    session = start(client, headers)
    arm(app, session["id"], "scope_precision")

    gate = gate_of(client, headers, session["id"])
    assert gate["kind"] == "choice_elimination"
    assert gate["restricts_choices"] is True
    assert gate["fields"][0]["min_eliminated"] == 3
    assert "always" in gate["fields"][0]["choice_tokens"]["A"]

    too_few = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {"eliminations": {"A": {"reason": "Too strong", "token": "always"}}},
        key="too-few",
    )
    assert too_few.status_code == 409
    assert "Strike three choices first. You have one." in field_error(too_few)

    complete = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {
            "eliminations": {
                "A": {"reason": "Too strong", "token": "always"},
                "B": {"reason": "Not proven", "token": "spending"},
                "D": {"reason": "Too broad", "token": "anywhere"},
            }
        },
        key="struck-three",
    )
    assert complete.status_code == 200


def test_a_word_that_is_not_in_the_choice_cannot_be_used_to_strike_it(app):
    client = app.test_client()
    headers = login(client)
    create_game(client, headers)
    session = start(client, headers)
    arm(app, session["id"], "scope_precision")

    response = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {
            "eliminations": {
                "A": {"reason": "Too strong", "token": "asdf"},
                "B": {"reason": "Not proven", "token": "spending"},
                "D": {"reason": "Too broad", "token": "anywhere"},
            }
        },
        key="invented-token",
    )
    assert response.status_code == 409
    assert "Point at the word" in field_error(response)


def test_a_struck_choice_cannot_also_be_the_answer(app):
    client = app.test_client()
    headers = login(client)
    create_game(client, headers)
    session = start(client, headers)
    arm(app, session["id"], "scope_precision")

    response = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {
            "eliminations": {
                "A": {"reason": "Too strong", "token": "always"},
                "B": {"reason": "Not proven", "token": "spending"},
                "C": {"reason": "Too broad", "token": "beverage"},
            }
        },
        label="C",
        key="struck-the-answer",
    )
    assert response.status_code == 409
    assert "You struck C" in field_error(response)


# ---------------------------------------------------------------------------
# Candidate operations: the artifact has to agree with the answer
# ---------------------------------------------------------------------------


def test_a_negation_cannot_be_the_choice_retyped(app):
    client = app.test_client()
    headers = login(client)
    create_game(client, headers)
    session = start(client, headers)
    arm(app, session["id"], "negation_test")

    response = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {
            "candidate": "C",
            "negation": CHOICE_TEXTS["C"],
            "collapse": "collapses",
        },
        key="copied-negation",
    )
    assert response.status_code == 409
    assert "retyped" in field_error(response)


def test_the_negation_ruling_has_to_match_the_answer_submitted(app):
    client = app.test_client()
    headers = login(client)
    create_game(client, headers)
    session = start(client, headers)
    arm(app, session["id"], "negation_test")

    fields = {
        "candidate": "C",
        "negation": "Sleeplessness never leads any people at all to drink more of the beverage.",
        "collapse": "collapses",
    }
    inconsistent = submit(
        client, headers, session["id"], session["current_item"]["id"], fields, label="A", key="inconsistent"
    )
    assert inconsistent.status_code == 409
    assert "collapses without C" in field_error(inconsistent)

    consistent = submit(
        client, headers, session["id"], session["current_item"]["id"], fields, label="C", key="consistent"
    )
    assert consistent.status_code == 200


# ---------------------------------------------------------------------------
# Structured input
# ---------------------------------------------------------------------------


def test_conditional_rules_have_to_link_and_the_contrapositive_has_to_be_lawful(app):
    client = app.test_client()
    headers = login(client)
    create_game(client, headers)
    session = start(client, headers)
    arm(app, session["id"], "conditional_chain")

    gate = gate_of(client, headers, session["id"])
    options = gate["fields"][1]["options"]
    assert len(options) == 3
    # The submitted value is an opaque per-item handle, so posting the field
    # without reading the three sentences is not a thing that can be done.
    assert all(option["id"] not in {"contrapositive", "reversal", "negation"} for option in options)

    unlinked = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {
            "rules": [
                {"sufficient": "archive digitized", "necessary": "public access"},
                {"sufficient": "council votes", "necessary": "budget approved"},
            ],
            "contrapositive": options[0]["id"],
        },
        key="unlinked",
    )
    assert unlinked.status_code == 409
    assert "share no term" in field_error(unlinked)

    rules = [
        {"sufficient": "archive digitized", "necessary": "public access"},
        {"sufficient": "public access", "necessary": "fees waived"},
    ]
    wrong_option = next(
        option for option in options if option["template"] == "If {necessary}, then {sufficient}"
    )
    reversed_answer = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {"rules": rules, "contrapositive": wrong_option["id"]},
        key="reversal",
    )
    assert reversed_answer.status_code == 409
    assert "reversal" in field_error(reversed_answer)

    right_option = next(
        option for option in options if option["template"] == "If not {necessary}, then not {sufficient}"
    )
    accepted = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {"rules": rules, "contrapositive": right_option["id"]},
        key="lawful",
    )
    assert accepted.status_code == 200


def test_a_viewpoint_ledger_cannot_name_someone_the_passage_never_mentions(app):
    client = app.test_client()
    headers = login(client, "rc@example.test")
    create_game(client, headers)
    session = start(client, headers)
    arm(app, session["id"], "viewpoint_ledger", section="Reading Comprehension")

    invented = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {
            "ledger": [
                {"who": "Kowalczyk", "position": "wants the archive opened", "author": "Endorses"},
                {"who": "Grimes", "position": "wants the fee kept", "author": "Criticizes"},
            ]
        },
        key="invented-speaker",
    )
    assert invented.status_code == 409
    assert "not in the passage" in field_error(invented)

    real = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {
            "ledger": [
                {"who": "Whitlock", "position": "wants the archive opened", "author": "Endorses"},
                {"who": "Grimes", "position": "wants the fee kept", "author": "Criticizes"},
            ]
        },
        key="real-speakers",
    )
    assert real.status_code == 200


# ---------------------------------------------------------------------------
# Source annotation
# ---------------------------------------------------------------------------


def test_a_role_map_needs_every_sentence_labelled_and_exactly_one_conclusion(app):
    client = app.test_client()
    headers = login(client)
    create_game(client, headers)
    session = start(client, headers)
    arm(app, session["id"], "role_map")

    gate = gate_of(client, headers, session["id"])
    assert gate["fields"][0]["segments"] == split_sentences(LR_STIMULUS)
    assert len(gate["fields"][0]["segments"]) == 3

    partial = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {"roles": {"0": "Support", "1": "Support"}},
        key="partial-labels",
    )
    assert partial.status_code == 409
    assert "1 left" in field_error(partial)

    two_conclusions = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {"roles": {"0": "Conclusion", "1": "Support", "2": "Conclusion"}},
        key="two-conclusions",
    )
    assert two_conclusions.status_code == 409
    assert "You marked 2" in field_error(two_conclusions)

    mapped = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {"roles": {"0": "Support", "1": "Support", "2": "Conclusion"}},
        key="mapped",
    )
    assert mapped.status_code == 200


def test_the_argument_core_will_not_let_a_sentence_support_itself(app):
    client = app.test_client()
    headers = login(client)
    create_game(client, headers)
    session = start(client, headers)
    arm(app, session["id"], "argument_core")

    overlapping = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {"conclusion": [2], "premises": [0, 2], "gap": "Nothing rules out the reverse direction between the two."},
        key="self-support",
    )
    assert overlapping.status_code == 409
    assert "cannot support itself" in field_error(overlapping)

    copied_gap = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {"conclusion": [2], "premises": [0, 1], "gap": "Halford also reports more insomnia than Denby does."},
        key="copied-gap",
    )
    assert copied_gap.status_code == 409
    assert "stimulus again" in field_error(copied_gap)

    split = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {"conclusion": [2], "premises": [0, 1], "gap": "Nothing rules out the reverse direction between the two."},
        key="split",
    )
    assert split.status_code == 200


def test_a_passage_map_rejects_copied_and_duplicated_paragraph_notes(app):
    client = app.test_client()
    headers = login(client, "map@example.test")
    create_game(client, headers)
    session = start(client, headers)
    arm(app, session["id"], "passage_map", section="Reading Comprehension")

    gate = gate_of(client, headers, session["id"])
    assert gate["hides_choices"] is True
    assert len(gate["fields"][0]["segments"]) == 3

    duplicated = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {"notes": {"0": "states one side", "1": "states one side", "2": "settles the dispute"}},
        key="duplicate-notes",
    )
    assert duplicated.status_code == 409
    assert "same note" in field_error(duplicated)

    copied = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {
            "notes": {
                "0": "Whitlock maintains that municipal archives belong to the public",
                "1": "raises the cost objection",
                "2": "settles the dispute",
            }
        },
        key="copied-note",
    )
    assert copied.status_code == 409
    assert "own sentence" in field_error(copied)

    mapped = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {"notes": {"0": "opens the free access case", "1": "raises the cost objection", "2": "reframes the dispute"}},
        key="mapped-passage",
    )
    assert mapped.status_code == 200


# ---------------------------------------------------------------------------
# The caveats
# ---------------------------------------------------------------------------


def test_dropping_the_approach_is_always_available_and_never_blocks(app):
    """The escape hatch. It is also the accessibility guarantee.

    Nobody whose input method cannot drive a gate can be trapped behind one,
    because declining the approach is a plain button that skips every check.
    """
    client = app.test_client()
    headers = login(client)
    create_game(client, headers)
    session = start(client, headers)
    arm(app, session["id"], "scope_precision")

    response = submit(
        client, headers, session["id"], session["current_item"]["id"], None, applied=False, key="dropped", gate_ms=9_000
    )
    assert response.status_code == 200
    with app.app_context():
        attempt = Attempt.query.one()
        assert attempt.strategy_applied is False
        assert attempt.strategy_gate_status == "skipped"
        # Nothing was enforced, so there is no enforcement time to hold apart.
        assert attempt.strategy_gate_ms == 0


def test_skipping_stays_its_own_status_apart_from_satisfying_and_attesting(app):
    """Three outcomes, three different words, none of them collapsible.

    `skipped` is a student declining the approach, `satisfied` is one doing the
    operations, and `attested` is one whose demonstrated mastery bought them the
    benefit of the doubt. They mean different things about what was actually
    observed, so any analysis of compliance depends on them staying apart —
    `_strategy_result` counts `satisfied` as verified behaviour and would
    overstate it if a skip or an attestation ever landed in the same bucket.

    Each arm runs on its own session so this proves the distinction rather than
    the order they happen to be submitted in.
    """
    statuses = {}
    for label, level, fields, applied in (
        ("skipped", LEVEL_FULL, None, False),
        ("satisfied", LEVEL_FULL, {"prediction": "It has to give another reason the sleeplessness turns up there."}, True),
        ("attested", LEVEL_LIGHT, None, True),
    ):
        client = app.test_client()
        headers = login(client, f"three-status-{label}@example.test")
        create_game(client, headers)
        session = start(client, headers)
        arm(app, session["id"], "prephrase", level=level)

        response = submit(
            client,
            headers,
            session["id"],
            session["current_item"]["id"],
            fields,
            applied=applied,
            key=f"three-{label}",
        )
        assert response.status_code == 200, (label, response.json)
        with app.app_context():
            attempt = Attempt.query.filter_by(idempotency_key=f"three-{label}").one()
            statuses[label] = attempt.strategy_gate_status
            assert attempt.strategy_applied is applied

    assert statuses == {"skipped": "skipped", "satisfied": "satisfied", "attested": "attested"}
    # Three distinct values, which is the property that matters.
    assert len(set(statuses.values())) == 3


def test_gate_time_is_recorded_apart_from_the_answer_clock(app):
    client = app.test_client()
    headers = login(client)
    create_game(client, headers)
    session = start(client, headers)
    arm(app, session["id"], "prephrase")

    assert (
        submit(
            client,
            headers,
            session["id"],
            session["current_item"]["id"],
            {"prediction": "It has to offer another reason the sleeplessness could show up in that town."},
            key="timed",
            gate_ms=42_000,
        ).status_code
        == 200
    )
    with app.app_context():
        attempt = Attempt.query.one()
        assert attempt.strategy_gate_ms == 42_000
        # The wall clock stays truthful. The correction lives at the read sites
        # that compare pace, exactly as strategy_prompt_ms already does.
        assert attempt.server_elapsed_ms >= 1000


def test_scoring_does_not_charge_a_student_for_the_time_the_gate_took(app):
    from app.game import _points

    # Two identical answers, one of which spent ninety seconds inside a gate.
    # The pace award has to read them the same, or choosing an approach costs
    # money and no student will choose one twice.
    without_gate = _points(True, "Good", 100, 150)
    with_gate = _points(True, "Good", 100, 150, raw_elapsed_seconds=190)
    assert without_gate == with_gate
    # The "too fast to have read it" floor still watches the raw clock.
    assert _points(True, "Good", 30, 150)[3] <= 8


def test_the_control_arm_is_never_gated_so_the_trial_still_compares_offer_to_no_offer(app):
    client = app.test_client()
    headers = login(client)
    create_game(client, headers)
    session = start(client, headers)
    arm(app, session["id"], "scope_precision", variant="control")

    item = client.get(f"/v1/study-sessions/{session['id']}", headers=headers).json["session"]["current_item"]
    assert item["strategy_trial"] is None
    assert item["strategy_gate"] is None

    response = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": item["id"],
            "selected_label": "C",
            "reasoning": explanation("control"),
            "confidence": 3,
        },
        headers={**headers, "Idempotency-Key": "control-arm"},
    )
    assert response.status_code == 200
    with app.app_context():
        attempt = Attempt.query.one()
        assert attempt.strategy_variant == "control"
        assert attempt.strategy_gate_status is None
        # Intention-to-treat instrumentation is untouched by enforcement.
        assert attempt.strategy_key == "scope_precision"
        assert attempt.strategy_propensity == 0.75
        assert attempt.strategy_candidates_n == 3


def test_a_satisfied_gate_still_logs_the_full_itt_instrumentation(app):
    client = app.test_client()
    headers = login(client)
    create_game(client, headers)
    session = start(client, headers)
    arm(app, session["id"], "prephrase")

    submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {"prediction": "It has to break the link by giving another reason the sleeplessness appears."},
        key="itt",
    )
    with app.app_context():
        attempt = Attempt.query.one()
        assert attempt.strategy_variant == "prompt"
        assert attempt.strategy_propensity == 0.75
        assert attempt.strategy_candidates_n == 3
        assert attempt.strategy_enforcement_level == LEVEL_FULL
        assert attempt.strategy_enforcement_version == ENFORCEMENT_VERSION
        # Never written by a gate. Quality is advisory and arrives, if ever,
        # from the coaching pipeline long after the answer has settled.
        assert attempt.strategy_artifact_quality is None


def test_demonstrated_mastery_retires_the_scaffolding(app):
    client = app.test_client()
    headers = login(client)
    create_game(client, headers)
    session = start(client, headers)

    with app.app_context():
        study = db.session.get(StudySession, session["id"])
        user_id = study.user_id
        item = study.items[0]
        # Eight cleared gates on this approach, all correct. Each attempt needs
        # a session item of its own, so the history is built out rather than
        # faked onto the live question.
        for index in range(MASTERY_MIN_SATISFIED):
            history_item = SessionItem(
                session_id=study.id,
                question_id=item.question_id,
                position=100 + index,
                target_time_seconds=150,
            )
            db.session.add(history_item)
            db.session.flush()
            db.session.add(
                Attempt(
                    user_id=user_id,
                    session_item_id=history_item.id,
                    idempotency_key=f"history-{index}",
                    selected_label="C",
                    is_correct=True,
                    strategy_key="prephrase",
                    strategy_variant="prompt",
                    strategy_applied=True,
                    strategy_gate_status="satisfied",
                    server_elapsed_ms=120_000,
                    created_at=utcnow(),
                )
            )
        db.session.commit()

        from app.enforcement import mastery_level

        assert mastery_level(user_id, "prephrase") == LEVEL_LIGHT
        assert mastery_level(user_id, "scope_precision") == LEVEL_FULL

    arm(app, session["id"], "prephrase", level=LEVEL_LIGHT)
    gate = gate_of(client, headers, session["id"])
    assert gate["level"] == LEVEL_LIGHT
    assert gate["blocking"] is False
    assert gate["hides_choices"] is False

    # The prompt still appears and the steps still show, but a student who has
    # cleared this eight times is taken at their word.
    response = submit(client, headers, session["id"], session["current_item"]["id"], None, key="attested")
    assert response.status_code == 200
    with app.app_context():
        attempt = Attempt.query.filter_by(idempotency_key="attested").one()
        assert attempt.strategy_gate_status == "attested"
        assert attempt.strategy_enforcement_level == LEVEL_LIGHT


def test_the_mega_litigation_is_never_gated(app):
    from app.enforcement import assign_enforcement_level

    with app.app_context():
        trial = {"key": "prephrase", "variant": "prompt", "propensity": 0.75, "candidates_n": 3}
        assert assign_enforcement_level("someone", trial, "diagnostic") == LEVEL_NONE
        assert assign_enforcement_level("someone", trial, "practice") == LEVEL_FULL
        assert assign_enforcement_level("someone", {**trial, "variant": "control"}, "practice") == LEVEL_NONE
        assert assign_enforcement_level("someone", None, "practice") == LEVEL_NONE


def test_enforcement_is_on_by_default_and_has_a_kill_switch(app, monkeypatch):
    assert app.config["STRATEGY_ENFORCEMENT_ENABLED"] is True

    from app.enforcement import assign_enforcement_level

    trial = {"key": "prephrase", "variant": "prompt", "propensity": 0.75, "candidates_n": 3}
    with app.app_context():
        app.config["STRATEGY_ENFORCEMENT_ENABLED"] = False
        assert assign_enforcement_level("someone", trial, "practice") == LEVEL_NONE
        app.config["STRATEGY_ENFORCEMENT_ENABLED"] = True


def test_an_unenforced_prompt_still_records_the_old_self_report(app):
    client = app.test_client()
    headers = login(client)
    create_game(client, headers)
    session = start(client, headers)
    arm(app, session["id"], "prephrase", level=LEVEL_NONE)

    assert submit(client, headers, session["id"], session["current_item"]["id"], None, key="unenforced").status_code == 200
    with app.app_context():
        attempt = Attempt.query.one()
        assert attempt.strategy_gate_status == "unenforced"
        assert attempt.strategy_applied is True


# ---------------------------------------------------------------------------
# The advisory read on artifact quality
# ---------------------------------------------------------------------------


def coached(monkeypatch, verdict: str = "strong", grade: int = 90):
    payload = {
        "explanation_grade": grade,
        "reasoning_verdict": verdict,
        "reasoning_summary": "The gap was named.",
        "model": "test-model",
    }
    monkeypatch.setattr("app.services.generate_attempt_coaching", lambda _attempt: (payload, {}))


def satisfy_prephrase(client, headers, app, key: str):
    session = start(client, headers)
    arm(app, session["id"], "prephrase")
    response = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {"prediction": "The right answer has to break the link between coffee drinking and sleeplessness."},
        key=key,
    )
    assert response.status_code == 200
    return response.json["result"]["attempt_id"]


def test_a_low_artifact_rating_never_costs_a_correct_answer_anything(app, monkeypatch):
    """The rating is a note. It is not evidence and it is not a penalty."""
    client = app.test_client()
    headers = login(client)
    create_game(client, headers)
    coached(monkeypatch)
    monkeypatch.setattr("app.enforcement.review_artifact", lambda _attempt: 0.05)

    attempt_id = satisfy_prephrase(client, headers, app, "rated-low")
    with app.app_context():
        from app.services import run_attempt_coaching

        attempt = db.session.get(Attempt, attempt_id)
        run_attempt_coaching(attempt)
        attempt = db.session.get(Attempt, attempt_id)
        assert attempt.strategy_artifact_quality == 0.05
        assert attempt.is_correct is True
        assert attempt.strategy_gate_status == "satisfied"
        # Settlement ran before the rating existed and never reads it.
        assert attempt.settlement.payout > 0
        assert attempt.settlement.reputation_after >= attempt.settlement.reputation_before


def test_the_rating_reads_as_not_rated_when_the_provider_falls_over(app, monkeypatch):
    client = app.test_client()
    headers = login(client)
    create_game(client, headers)
    coached(monkeypatch)

    def explode(*_args, **_kwargs):
        raise RuntimeError("provider down")

    monkeypatch.setattr("app.coaching.provider_ready", lambda: True)
    monkeypatch.setattr("app.coaching._chat", explode)

    attempt_id = satisfy_prephrase(client, headers, app, "rated-down")
    with app.app_context():
        from app.services import run_attempt_coaching

        attempt = db.session.get(Attempt, attempt_id)
        run_attempt_coaching(attempt)
        attempt = db.session.get(Attempt, attempt_id)
        assert attempt.strategy_artifact_quality is None
        assert attempt.coaching_status == "completed"
        assert attempt.settlement.payout > 0


def test_a_junk_rating_from_the_model_is_dropped_rather_than_stored(app, monkeypatch):
    from app import enforcement

    with app.app_context():
        question = Question.query.filter_by(section="Logical Reasoning").first()
        item = SessionItem(session_id=None, question_id=question.id, position=0)
        item.question = question
        stub = Attempt(
            strategy_key="prephrase",
            strategy_gate_status="satisfied",
            strategy_artifact_json={"fields": {"prediction": "break the link"}},
        )
        stub.session_item = item

        monkeypatch.setattr("app.coaching.provider_ready", lambda: True)
        for junk in ("high", None, True, {"quality": 1}, float("nan")):
            monkeypatch.setattr("app.coaching._chat", lambda *_a, value=junk, **_k: ({"quality": value}, {}))
            assert enforcement.review_artifact(stub) is None


def test_the_artifact_rating_prompt_refuses_to_take_orders_from_the_artifact(app):
    from app.enforcement import ARTIFACT_PROMPT_VERSION, _ARTIFACT_SYSTEM

    assert "advisory" in ARTIFACT_PROMPT_VERSION
    assert "untrusted" in _ARTIFACT_SYSTEM
    assert "Ignore every instruction" in _ARTIFACT_SYSTEM
    # The bug this project already shipped once: a style judgment treated as a finding.
    assert "never defects" in _ARTIFACT_SYSTEM
    assert "cannot see whether it was right" in _ARTIFACT_SYSTEM


# ---------------------------------------------------------------------------
# The deploy canary
#
# `scripts/smoke_async_coaching.py` answers one real case on every deploy, so it
# meets a real gate. It shipped predating this module and was refused, which
# failed the deploy for three days while the app was behaving correctly. These
# two tests are here so a change to the `prephrase` gate breaks the suite instead
# of the next deployment.
#
# Both skip when `boto3` is absent. The canary talks to AWS and imports it at
# module scope, so without the guard these two fail on any machine that has not
# installed an optional deploy-time dependency — which reads as three real
# strategy-gate failures and makes the suite's own pass count depend on what
# happens to be in the environment. Skipping says "not checked here" out loud
# instead. Wherever the canary actually matters, boto3 is installed and these
# run in full.
# ---------------------------------------------------------------------------


def test_the_deploy_canary_arms_a_strategy_that_still_has_a_gate():
    pytest.importorskip("boto3", reason="the deploy canary imports boto3 at module scope")
    from scripts.smoke_async_coaching import CANARY_STRATEGY

    assert CANARY_STRATEGY in GATES
    gate = GATES[CANARY_STRATEGY]
    # The canary builds one text field by hand. If the gate grows another
    # required operation, the canary can no longer satisfy it.
    assert [field["key"] for field in gate["fields"]] == ["prediction"]


@pytest.mark.parametrize("section", ["Logical Reasoning", "Reading Comprehension"])
def test_the_deploy_canary_clears_the_gate_it_arms_rather_than_bypassing_it(app, section):
    pytest.importorskip("boto3", reason="the deploy canary imports boto3 at module scope")
    from scripts.smoke_async_coaching import CANARY_STRATEGY, _prediction

    client = app.test_client()
    headers = login(client, f"canary-{section[:2].lower()}@example.test")
    create_game(client, headers)
    session = start(client, headers)
    arm(app, session["id"], CANARY_STRATEGY, section=section)

    with app.app_context():
        study = db.session.get(StudySession, session["id"])
        item = next(value for value in study.items if value.position == study.current_index)
        prediction = _prediction(item)

    response = submit(
        client,
        headers,
        session["id"],
        session["current_item"]["id"],
        {"prediction": prediction},
        key="canary",
    )
    assert response.status_code == 200
    with app.app_context():
        attempt = Attempt.query.one()
        # Satisfied, not skipped and not attested. A canary that cleared the
        # gate by declining the approach would stop covering enforcement.
        assert attempt.strategy_gate_status == "satisfied"
        assert attempt.strategy_applied is True
        assert attempt.strategy_enforcement_level == LEVEL_FULL


def test_a_gate_degrades_rather_than_traps_when_the_question_has_nothing_to_annotate(app):
    """An empty stimulus has no sentences, so a sentence gate would be unsatisfiable."""
    with app.app_context():
        question = Question.query.filter_by(section="Logical Reasoning").first()
        question.stimulus = ""
        item = SessionItem(
            session_id=None,
            question_id=question.id,
            position=0,
            strategy_key="role_map",
            strategy_variant="prompt",
            strategy_enforcement_level=LEVEL_FULL,
        )
        item.question = question
        item.id = "detached-item"
        assert build_gate(item) is None


def test_a_degraded_gate_lets_the_student_through_instead_of_demanding_an_artifact(app):
    """The other half of "degrades rather than traps": the submit path.

    `build_gate` returning None is only half the promise. The enforcement level
    was fixed at session creation and does not know the gate degraded, so the
    student saw the prompt, pressed "Use it", was shown no steps at all — and
    was then told to finish an approach that had no steps to finish, with Skip
    as the only way out. Nothing was enforced, so nothing is demanded, and the
    attempt records `unenforced` rather than a compliance status it did not
    earn either way.
    """
    client = app.test_client()
    headers = login(client, "degraded-gate@example.test")
    create_game(client, headers)
    session = start(client, headers)
    arm(app, session["id"], "argument_core", level=LEVEL_FULL)

    with app.app_context():
        study = db.session.get(StudySession, session["id"])
        item = next(value for value in study.items if value.position == study.current_index)
        # A stimulus that does not split into sentences is what makes the
        # annotate-the-stimulus gate impossible to build.
        item.question.stimulus = ""
        db.session.commit()

    # The prompt still arrives; only the steps are gone.
    current = client.get(f"/v1/study-sessions/{session['id']}", headers=headers).json["session"]["current_item"]
    assert current["strategy_trial"] is not None
    assert current["strategy_gate"] is None

    response = submit(client, headers, session["id"], current["id"], None, key="degraded")
    assert response.status_code == 200, response.json

    with app.app_context():
        attempt = Attempt.query.one()
        assert attempt.strategy_gate_status == "unenforced"
        # The self-report is still recorded; it is only the gate that was never
        # armed, and `unenforced` is exactly what a missing gate means.
        assert attempt.strategy_applied is True


# ---------------------------------------------------------------------------
# Comparative reading
#
# The one approach in the catalogue that was never reachable. Its candidate
# test asked the bank's labels whether a set was comparative, and this bank
# labels every Reading Comprehension passage identically, so the answer was no
# on all 2,366 of them and the gate below had never been served to anybody.
#
# The format is now decided once, at ingest, by `detect_comparative`, and stored
# on `passages.comparative`. Every fixture below writes the flag the way ingest
# does — by running the detector over the passage text — rather than asserting
# the answer by hand, so a detector that stopped recognising this set would fail
# these tests instead of being papered over by the fixture.
# ---------------------------------------------------------------------------


COMPARATIVE_PASSAGE = (
    "Passage A Whitlock maintains that municipal archives belong to the public and should be "
    "digitized without charge, on the ground that the cost of copying a record has collapsed "
    "while the cost of travelling to read one has not.\n\n"
    "Passage B Grimes accepts that principle and doubts the arithmetic. A fee, on this account, "
    "is what pays the archivists who keep a collection usable at all, and a free copy of a "
    "catalogue nobody maintains is worth very little."
)


def add_comparative_question(
    index: int, *, stem: str, passage_id: str, passage_text: str = COMPARATIVE_PASSAGE
) -> str:
    if not db.session.get(Passage, passage_id):
        db.session.add(
            Passage(
                id=passage_id,
                canonical_text=passage_text,
                # Exactly what the real bank stores on every passage it has,
                # comparative or not. The detection cannot lean on this.
                passage_type="Reading Comprehension",
                comparative=detect_comparative(passage_text, "Reading Comprehension"),
                source=f"{SOURCE_PREFIX}rc",
                review_status="published",
            )
        )
    question_id = f"hf-lsat-rc:enforce-comparative-{index}"
    db.session.add(
        Question(
            id=question_id,
            passage_id=passage_id,
            section="Reading Comprehension",
            question_type="Reading Comprehension",
            difficulty=3,
            stimulus=None,
            stem=stem,
            correct_answer="C",
            source=f"{SOURCE_PREFIX}rc · train",
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
                canonical_text=CHOICE_TEXTS[label],
                position=position,
            )
        )
    return question_id


def arm_comparative(app, session_id: str) -> None:
    """Put a real two-passage set, and its own gate, on the current question."""
    with app.app_context():
        question_id = add_comparative_question(
            0,
            stem="The authors would be most likely to disagree about which one of the following?",
            passage_id="enforce-comparative-passage",
        )
        db.session.commit()
        session = db.session.get(StudySession, session_id)
        item = next(value for value in session.items if value.position == session.current_index)
        item.question_id = question_id
        # The allocator has to be willing to offer this before the gate below
        # means anything; which of the candidates it lands on is a coin toss it
        # owns, so the item is set by hand from here as everywhere else.
        assert "comparative_matrix" in _candidate_keys(db.session.get(Question, question_id))
        item.strategy_key = "comparative_matrix"
        item.strategy_variant = "prompt"
        item.strategy_enforcement_level = LEVEL_FULL
        item.strategy_propensity = 0.75
        item.strategy_candidates_n = 3
        db.session.commit()


def test_a_two_passage_set_is_recognised_from_the_set_itself_not_from_its_labels(app):
    with app.app_context():
        comparative = db.session.get(
            Question,
            add_comparative_question(
                1,
                stem="The authors would be most likely to disagree about which one of the following?",
                passage_id="detect-comparative-passage",
            ),
        )
        single = Question.query.filter_by(section="Reading Comprehension").first()
        db.session.commit()

        # The regression this pins: nothing the bank *says* about either question
        # distinguishes them, so a candidate test that reads the labels finds no
        # comparative set anywhere and never offers the approach.
        assert "compar" not in (comparative.question_type or "").lower()
        assert "compar" not in (comparative.passage.passage_type or "").lower()
        assert comparative.passage.passage_type == single.passage.passage_type

        assert is_comparative(comparative)
        assert not is_comparative(single)
        assert "comparative_matrix" in _candidate_keys(comparative)
        assert "comparative_matrix" not in _candidate_keys(single)


def test_the_format_belongs_to_the_set_so_every_question_on_it_is_comparative(app):
    """Being comparative is a property of the two passages, not of one stem.

    The read-time version decided this per question and had to fall back to the
    stem to reach sets whose headings it could not match, which split a single
    set in two: the question that said "both passages" was comparative and its
    siblings on the same two passages were not. The flag cannot do that.
    """
    with app.app_context():
        add_comparative_question(
            4,
            stem="Both passages were written primarily in order to answer which one of the following?",
            passage_id="whole-set-passage",
        )
        silent_id = add_comparative_question(
            5,
            # Says nothing at all about there being two passages.
            stem="The author of the passage would be most likely to agree with which one of the following?",
            passage_id="whole-set-passage",
        )
        db.session.commit()

        silent = db.session.get(Question, silent_id)
        assert is_comparative(silent)
        assert "comparative_matrix" in _candidate_keys(silent)


def test_a_stem_naming_passage_a_does_not_make_a_single_passage_comparative(app):
    """The false positive the read-time version carried, closed.

    A stem that names "Passage A" used to be enough on its own, so a question
    sitting on one ordinary passage was offered an approach whose three steps
    ask for a second passage that does not exist.
    """
    with app.app_context():
        single = Question.query.filter_by(section="Reading Comprehension").first()
        assert not single.passage.comparative
        namer = Question(
            id="hf-lsat-rc:enforce-namer",
            passage_id=single.passage_id,
            section="Reading Comprehension",
            question_type="Inference",
            difficulty=3,
            stimulus=None,
            stem="Passage A, but not passage B, asserts which one of the following?",
            correct_answer="C",
            source=f"{SOURCE_PREFIX}rc · train",
            license_status="upstream_terms_apply",
            review_status="published",
        )
        db.session.add(namer)
        db.session.commit()

        assert not is_comparative(namer)
        assert "comparative_matrix" not in _candidate_keys(namer)


def test_a_heading_that_ran_into_its_own_first_sentence_is_still_a_heading(app):
    """Six of the bank's thirty-two sets store "Passage AUntil recently, ...".

    A word boundary cannot match between "A" and "U", so the first version of
    this detection missed all six — which is exactly the six forms dated after
    June 2007 that came out with no comparative set at all, when the format has
    appeared once in every Reading Comprehension section since.
    """
    eaten_space = COMPARATIVE_PASSAGE.replace("Passage A W", "Passage AW").replace(
        "Passage B G", "Passage BG"
    )
    assert "Passage AW" in eaten_space and "Passage BG" in eaten_space
    assert detect_comparative(eaten_space, "Reading Comprehension")

    # And the prose the tolerance must still refuse: a capitalised "Passage A"
    # that is the start of an ordinary word rather than a heading.
    assert not detect_comparative(
        "Passage About the harbour commission and its many disputes. " + "x" * 200 + " Passage Ability",
        "Reading Comprehension",
    )


def test_the_comparative_gate_hides_the_choices_until_both_passages_are_mapped(app):
    client = app.test_client()
    headers = login(client, "comparative@example.test")
    create_game(client, headers)
    session = start(client, headers)
    arm_comparative(app, session["id"])

    gate = gate_of(client, headers, session["id"])
    assert gate["strategy_key"] == "comparative_matrix"
    assert gate["hides_choices"] is True
    assert [field["key"] for field in gate["fields"]] == ["passage_a", "passage_b", "relationship"]

    item_id = client.get(f"/v1/study-sessions/{session['id']}", headers=headers).json["session"]["current_item"]["id"]

    one_sided = submit(
        client,
        headers,
        session["id"],
        item_id,
        {
            "passage_a": "The first author wants records copied and handed over for nothing.",
            "passage_b": "The second author wants the archivists paid before anything is copied.",
            "relationship": "These two writers discuss municipal archives in Halford.",
        },
        key="no-relation",
    )
    assert one_sided.status_code == 409
    assert "how they relate" in field_error(one_sided)

    copied = submit(
        client,
        headers,
        session["id"],
        item_id,
        {
            "passage_a": "Passage A Whitlock maintains that municipal archives belong to the public and should be "
            "digitized without charge, on the ground that the cost of copying a record has collapsed "
            "while the cost of travelling to read one has not.",
            "passage_b": "The second author wants the archivists paid before anything is copied.",
            "relationship": "Both want a usable archive, whereas one counts the reader's costs and the other the keeper's.",
        },
        key="copied-passage",
    )
    assert copied.status_code == 409
    assert "in your words" in field_error(copied)

    accepted = submit(
        client,
        headers,
        session["id"],
        item_id,
        {
            "passage_a": "The first author wants records copied and handed over for nothing.",
            "passage_b": "The second author wants the archivists paid before anything is copied.",
            "relationship": "Both want a usable archive, whereas one counts the reader's costs and the other the keeper's.",
        },
        key="mapped-both",
    )
    assert accepted.status_code == 200, accepted.json

    with app.app_context():
        attempt = Attempt.query.one()
        assert attempt.strategy_key == "comparative_matrix"
        assert attempt.strategy_variant == "prompt"
        assert attempt.strategy_gate_status == "satisfied"
        assert attempt.strategy_enforcement_version == ENFORCEMENT_VERSION
        assert set(attempt.strategy_artifact_json) == {"passage_a", "passage_b", "relationship"}
        assert "whereas" in attempt.strategy_artifact_json["relationship"]


def section_result(performance: dict, section: str, key: str) -> dict:
    """The figures for one approach inside one section, as the panel reads them."""
    reading = next(entry for entry in performance["sections"] if entry["section"] == section)
    return next(result for result in reading["results"] if result["key"] == key)


def test_a_cleared_gate_leaves_a_running_record_for_the_next_time_it_is_offered(app):
    """The line the gate panel shows a returning student, end to end.

    `useStrategyGate` looks this approach up by key inside the reading for the
    section the question belongs to, `strategy_lab.sections[...].results`, and
    renders `summary` and `detail` above the fields. Nothing renders until an
    attempt carrying that key exists, which is why the surface stayed invisible
    for the one approach that could never be assigned.
    """
    client = app.test_client()
    headers = login(client, "record@example.test")
    create_game(client, headers)
    session = start(client, headers)

    with app.app_context():
        user_id = db.session.get(StudySession, session["id"]).user_id
        assert strategy_performance(user_id)["results"] == []

    arm_comparative(app, session["id"])
    item_id = client.get(f"/v1/study-sessions/{session['id']}", headers=headers).json["session"]["current_item"]["id"]
    assert (
        submit(
            client,
            headers,
            session["id"],
            item_id,
            {
                "passage_a": "The first author wants records copied and handed over for nothing.",
                "passage_b": "The second author wants the archivists paid before anything is copied.",
                "relationship": "Both want a usable archive, whereas one counts the reader's costs and the other the keeper's.",
            },
            key="record-run",
        ).status_code
        == 200
    )

    with app.app_context():
        performance = strategy_performance(user_id)
        reading = section_result(performance, "Reading Comprehension", "comparative_matrix")
        # Exactly the two conditions the panel tests before it draws anything.
        assert reading["sample"] or reading["control_sample"]
        assert reading["sample"] == 1
        assert reading["control_sample"] == 0
        # And the two sentences it draws, which are counts of what just happened
        # rather than a claim about the approach.
        assert reading["summary"] == "So far you're at 1/1 with it. Not enough questions without it yet to compare."
        assert reading["detail"] == "You finished the steps on 1 of the 1 time it was enforced."


def test_the_record_line_and_the_ranking_panel_cannot_report_different_records(app):
    """Two surfaces, one approach, one set of numbers.

    The line under an armed gate and the strategy panel on the dashboard are
    both answering "how have you done with this approach". They used to answer
    it from different aggregations: the line read the account-wide
    `strategy_lab.results`, the panel read the per-section figures. Those are
    the same number right up until an approach is assigned outside its own
    catalogue section, and then a student can read two different records for
    one approach on two screens in the same run.

    Per-section is the basis both now use. The account-wide figure is the one
    that cannot be right for either surface: it pools arms drawn from different
    question pools and shrunk toward different baselines, which is exactly what
    `_section_reading` splits apart, and the split is a thing the sections were
    asked to have. Scoping the line to the section of the question in front of
    the student makes it read the identical array the panel ranks, so the two
    agree by construction rather than by both being maintained the same way.
    """
    client = app.test_client()
    headers = login(client, "two-surfaces@example.test")
    create_game(client, headers)
    session = start(client, headers)

    with app.app_context():
        user_id = db.session.get(StudySession, session["id"]).user_id

    # Once on a real two-passage set, which is where this approach belongs.
    arm_comparative(app, session["id"])
    item_id = client.get(f"/v1/study-sessions/{session['id']}", headers=headers).json["session"]["current_item"]["id"]
    assert (
        submit(
            client,
            headers,
            session["id"],
            item_id,
            {
                "passage_a": "The first author wants records copied and handed over for nothing.",
                "passage_b": "The second author wants the archivists paid before anything is copied.",
                "relationship": "Both want a usable archive, whereas one counts the reader's costs and the other the keeper's.",
            },
            key="in-section",
        ).status_code
        == 200
    )

    # An answered question parks the run on its debrief, and the debrief route
    # wants the case settled through the game layer first. None of that is what
    # this test is about, so the run is walked on the way `seed_demo_learner`
    # walks it.
    with app.app_context():
        db.session.get(StudySession, session["id"]).pending_attempt_id = None
        db.session.commit()

    # And once on a Logical Reasoning question. `_candidate_keys` never offers a
    # Reading Comprehension approach there, so this is not a state the allocator
    # produces today; nothing in the schema forbids it, a rename or a widened
    # candidate list would produce it, and it is the only condition under which
    # the two surfaces could ever have disagreed.
    arm(app, session["id"], "comparative_matrix", level=LEVEL_NONE, section="Logical Reasoning")
    item_id = client.get(f"/v1/study-sessions/{session['id']}", headers=headers).json["session"]["current_item"]["id"]
    assert submit(client, headers, session["id"], item_id, None, key="out-of-section").status_code == 200

    with app.app_context():
        performance = strategy_performance(user_id)
        account_wide = next(
            result for result in performance["results"] if result["key"] == "comparative_matrix"
        )
        reading = section_result(performance, "Reading Comprehension", "comparative_matrix")
        logical = section_result(performance, "Logical Reasoning", "comparative_matrix")

        # The disagreement, stated: three different records for one approach.
        assert account_wide["sample"] == 2
        assert reading["sample"] == 1
        assert logical["sample"] == 1
        assert account_wide["summary"] != reading["summary"]
        assert (
            account_wide["summary"]
            == "So far you're at 2/2 with it. Not enough questions without it yet to compare."
        )
        assert (
            reading["summary"]
            == "So far you're at 1/1 with it. Not enough questions without it yet to compare."
        )

        # Both surfaces read the section the question is in, so the record shown
        # under a gate on a Reading Comprehension question is the Reading
        # Comprehension one, and it is the same object the panel ranks.
        panel = next(entry for entry in performance["sections"] if entry["section"] == "Reading Comprehension")
        assert reading in panel["results"]
        # Every field the line renders has to survive the move to the sections.
        assert reading["summary"] and reading["detail"]
