from __future__ import annotations

import copy
import json
from types import SimpleNamespace

import pytest
from flask import Flask

from app.story_engine import (
    StoryGenerationError,
    _provider_story_beat,
    _question_payload,
    fallback_story_beat,
    validate_story_beat,
)


def story_item(*, mode: str = "daily", position: int = 1):
    question = SimpleNamespace(
        id="question-safe-boundary",
        section="Logical Reasoning",
        question_type="Flaw",
        difficulty=4,
        passage=None,
        stimulus="A research team compares two instrument readings before publishing a report.",
        stem="Which response most accurately describes the flaw in the reasoning?",
        correct_answer="D",
        choices=[
            SimpleNamespace(label="A", canonical_text="SENTINEL-CHOICE-TEXT"),
            SimpleNamespace(label="D", canonical_text="SENTINEL-CORRECT-TEXT"),
        ],
    )
    session = SimpleNamespace(mode=mode, total_items=8)
    return SimpleNamespace(
        id="item-story-boundary",
        position=position,
        question=question,
        session=session,
    )


def test_question_payload_never_exposes_choices_or_key():
    payload = _question_payload(story_item())
    serialized = json.dumps(payload)

    assert set(payload) == {
        "id",
        "section",
        "question_type",
        "difficulty_1_to_5",
        "canonical_passage",
        "canonical_stimulus",
        "canonical_stem",
    }
    assert "SENTINEL-CHOICE-TEXT" not in serialized
    assert "SENTINEL-CORRECT-TEXT" not in serialized
    assert "correct_answer" not in serialized
    assert "choices" not in serialized


def test_fallback_carries_prior_scene_and_safe_question_motif():
    item = story_item(position=1)
    continuity = {
        "last_case_title": "The Copper Index",
        "last_hook": "A rain-marked drawer opens onto a route beneath the archive.",
        "last_location_id": "rain_archive",
        "last_outcome": "correct",
        "featured_cast": ["rowan_vale", "aria_lux", "not-a-character"],
    }

    beat = fallback_story_beat(item, chapter=1, cases_solved=1, continuity=continuity)

    assert beat["source"] == "fallback"
    assert beat["location_id"] == "rain_archive"
    assert "The Copper Index" in beat["continuity_beat"]
    assert "rain-marked drawer" in beat["continuity_beat"]
    assert "instrument readout" in beat["evidence_motif"].lower()
    assert "aria_lux" in {member["id"] for member in beat["cast"]}
    assert beat["next_hook"] != "A second mark on the stolen Compass points beneath the oldest wing of the Bureau."


def test_story_validation_rejects_solution_claims():
    item = story_item()
    leaky = copy.deepcopy(fallback_story_beat(item, chapter=1, cases_solved=0))
    leaky["dialogue"][0]["line"] = "The correct answer is now obvious from the record."

    with pytest.raises(StoryGenerationError, match="solution claim"):
        validate_story_beat(leaky, item, source="fallback")


def test_provider_receives_typed_continuity_but_no_answer_data(monkeypatch):
    item = story_item(position=2)
    provider_beat = fallback_story_beat(item, chapter=1, cases_solved=2)
    provider_beat["source"] = "truefoundry"
    captured: dict = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"choices": [{"message": {"content": json.dumps(provider_beat)}}]}

    def fake_post(_url, *, headers, json, timeout):
        captured["headers"] = headers
        captured["body"] = json
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr("app.story_engine.requests.post", fake_post)
    app = Flask(__name__)
    app.config.update(
        TFY_URL="https://truefoundry.example/v1",
        TFY_API_KEY="test-key",
        COACHING_MODEL="gpt-5.6-luna",
        COACHING_REASONING_EFFORT="xhigh",
    )
    continuity = {
        "last_case_title": "<The Prior File>",
        "last_hook": "A prior hook survives. " * 40,
        "last_location_id": "cipher_lab",
        "last_outcome": "incorrect",
        "featured_cast": ["zoya_ember", "invalid-cast"],
        "unexpected_secret": "must never cross the boundary",
    }

    with app.app_context():
        result = _provider_story_beat(item, 1, 2, continuity)

    context = json.loads(captured["body"]["messages"][1]["content"].split("\n\n", 1)[1])
    serialized_question = json.dumps(context["question_data"])
    assert result["source"] == "truefoundry"
    assert context["episode_plan"]["beat_number"] == 3
    assert context["story_lens"]["logical_task_label"] == "Broken Inference"
    assert context["continuity"]["featured_cast"] == ["zoya_ember"]
    assert len(context["continuity"]["last_hook"]) <= 300
    assert "<" not in context["continuity"]["last_case_title"]
    assert "unexpected_secret" not in context["continuity"]
    assert "SENTINEL-CHOICE-TEXT" not in serialized_question
    assert "SENTINEL-CORRECT-TEXT" not in serialized_question
    assert {"continuity_beat", "evidence_motif"}.issubset(
        captured["body"]["response_format"]["json_schema"]["schema"]["required"]
    )


def test_persisted_plan_locks_provider_and_fallback_to_canonical_scene(monkeypatch):
    item = story_item(position=3)
    plan_context = {
        "source": "truefoundry",
        "featured_cast": ["rowan_vale", "zoya_ember", "imani_cross"],
        "arc": {
            "title": "The Glass Signal",
            "objective": "Trace one signal across the Bureau without losing its source.",
        },
        "beat": {
            "story_role": "Scope reversal",
            "setup_hook": "A coded signal reaches the Court of Glass through a witness ledger.",
            "payoff_hook": "The ledger opens a route back toward the Bureau map room.",
            "location_id": "glass_court",
            "featured_cast": ["rowan_vale", "zoya_ember", "imani_cross"],
        },
        "total_beats": 6,
    }
    fallback = fallback_story_beat(
        item,
        chapter=2,
        cases_solved=3,
        plan_context=plan_context,
    )
    assert fallback["location_id"] == "glass_court"
    assert {member["id"] for member in fallback["cast"]} == {
        "rowan_vale",
        "zoya_ember",
        "imani_cross",
    }

    provider_beat = copy.deepcopy(fallback)
    provider_beat["source"] = "truefoundry"
    captured: dict = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"choices": [{"message": {"content": json.dumps(provider_beat)}}]}

    def fake_post(_url, *, headers, json, timeout):
        captured["body"] = json
        return FakeResponse()

    monkeypatch.setattr("app.story_engine.requests.post", fake_post)
    app = Flask(__name__)
    app.config.update(
        TFY_URL="https://truefoundry.example/v1",
        TFY_API_KEY="test-key",
        COACHING_MODEL="gpt-5.6-luna",
        COACHING_REASONING_EFFORT="xhigh",
    )
    with app.app_context():
        result = _provider_story_beat(
            item,
            2,
            3,
            plan_context=plan_context,
        )

    submitted = json.loads(captured["body"]["messages"][1]["content"].split("\n\n", 1)[1])
    schema = captured["body"]["response_format"]["json_schema"]["schema"]["properties"]
    assert submitted["suggested_location_id"] == "glass_court"
    assert submitted["suggested_cast_ids"] == ["rowan_vale", "zoya_ember", "imani_cross"]
    assert schema["location_id"]["enum"] == ["glass_court"]
    assert schema["cast"]["items"]["enum"] == ["rowan_vale", "zoya_ember", "imani_cross"]
    assert result["location_id"] == "glass_court"
    assert {member["id"] for member in result["cast"]} == {
        "rowan_vale",
        "zoya_ember",
        "imani_cross",
    }
