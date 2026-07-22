from __future__ import annotations

import json

import pytest

from app import create_app
from app.extensions import db
from app.models import Passage, Question, QuestionChoice, SessionItem
from app.seed import SOURCE_PREFIX, seed_questions


def add_question(index: int, section: str) -> None:
    question_id = f"hf-lsat-{'lr' if section == 'Logical Reasoning' else 'rc'}:sample-{index}"
    passage_id = None
    stimulus = f"Argument stimulus {index}."
    if section == "Reading Comprehension":
        passage_id = f"sample-passage-{index // 2}"
        passage = db.session.get(Passage, passage_id)
        if not passage:
            db.session.add(
                Passage(
                    id=passage_id,
                    canonical_text=f"Reading passage {index // 2}. It contains enough text for a sample question.",
                    passage_type="Reading Comprehension",
                    source=f"{SOURCE_PREFIX}rc",
                    review_status="published",
                )
            )
        stimulus = None
    question = Question(
        id=question_id,
        passage_id=passage_id,
        section=section,
        question_type="Inference",
        difficulty=3,
        stimulus=stimulus,
        stem=f"Which answer is best for sample question {index}?",
        correct_answer="C",
        source=f"{SOURCE_PREFIX}{'lr' if section == 'Logical Reasoning' else 'rc'} · train",
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
                canonical_text=f"Answer {label} for question {index}",
                position=position,
            )
        )


@pytest.fixture()
def app():
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
            "DEV_AUTH_ENABLED": True,
            "PRACTICE_SESSION_SIZE": 3,
            "TFY_URL": "",
            "TFY_API_KEY": "",
        }
    )
    with application.app_context():
        for index in range(8):
            add_question(index, "Logical Reasoning")
        for index in range(8, 12):
            add_question(index, "Reading Comprehension")
        db.session.commit()
    return application


def login(client, email: str = "student@example.test") -> dict[str, str]:
    response = client.post("/v1/auth/dev", json={"email": email, "display_name": "Test Student"})
    assert response.status_code == 200
    csrf = client.get_cookie("lsat_csrf")
    assert csrf
    return {"X-CSRF-Token": csrf.value}


def test_account_goes_directly_to_random_practice(app, monkeypatch):
    chosen_ids = []

    def reverse_sample(values, k):
        chosen = list(reversed(values))[:k]
        chosen_ids.extend(question.id for question in chosen)
        return chosen

    monkeypatch.setattr("app.services.random.sample", reverse_sample)
    client = app.test_client()
    headers = login(client)

    me = client.get("/v1/me")
    assert me.status_code == 200
    assert me.json["user"]["next_route"] == "/practice"
    assert "diagnostic_complete" not in me.json["user"]

    response = client.post("/v1/study-sessions", headers=headers)
    assert response.status_code == 201
    session = response.json["session"]
    assert session["mode"] == "practice"
    assert session["total_items"] == 3
    assert session["current_item"]["question"]["id"] == chosen_ids[0]

    with app.app_context():
        items = SessionItem.query.filter_by(session_id=session["id"]).order_by(SessionItem.position).all()
        assert [item.question_id for item in items] == chosen_ids
        assert all(item.question.source.startswith(SOURCE_PREFIX) for item in items)
        assert all(not hasattr(item, "story_json") for item in items)
        assert all(item.requires_reasoning is False for item in items)

    assert client.get("/v1/diagnostics/current").status_code == 404
    assert client.get("/v1/story/progress").status_code == 404


def test_answer_choice_explanations_and_reasoning_grade_are_preserved(app, monkeypatch):
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "model": "gpt-5.6-luna",
                "choices": [{"message": {"content": json.dumps(self.content)}}],
                "usage": {},
            }

        def __init__(self, content):
            self.content = content

    captured = {}

    def fake_post(_url, headers, json: dict, timeout):
        captured["request"] = json
        submitted = __import__("json").loads(json["messages"][1]["content"].split("\n\n", 1)[1])
        question = submitted["question"]
        correct = question["verified_correct_label"]
        selected = submitted["student_submission"]["selected_label"]
        return FakeResponse(
            {
                "explanation_grade": 84,
                "reasoning_verdict": "mostly_correct",
                "reasoning_summary": "The reasoning identified the key inference but could distinguish the distractor more explicitly.",
                "first_error": {
                    "code": "incomplete_elimination",
                    "description": "The nearest distractor was not fully eliminated.",
                    "repair": "State the unsupported leap in that option.",
                },
                "answer_analysis": {
                    "correct_answer_explanation": f"Choice {correct} follows from the supplied evidence.",
                    "selected_answer_explanation": f"Choice {selected} is evaluated against the exact task.",
                    "choice_explanations": [
                        {"label": choice["label"], "explanation": f"Choice {choice['label']} receives a specific explanation."}
                        for choice in question["choices"]
                    ],
                },
                "next_step_hint": "Name the exact task before comparing options.",
                "debrief": "Keep the valid inference and make elimination explicit.",
            }
        )

    monkeypatch.setattr("app.coaching.requests.post", fake_post)
    monkeypatch.setitem(app.config, "TFY_URL", "https://truefoundry.example/v1")
    monkeypatch.setitem(app.config, "TFY_API_KEY", "test-key")

    client = app.test_client()
    headers = login(client, "coaching@example.test")
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    item = session["current_item"]
    response = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": item["id"],
            "selected_label": "B",
            "reasoning": "The premises support B, and C appears to go beyond the evidence provided.",
        },
        headers={**headers, "Idempotency-Key": "first-answer"},
    )
    assert response.status_code == 200
    result = response.json["result"]
    assert result["feedback"]["correct_label"] == "C"

    coaching_response = client.post(f"/v1/attempts/{result['attempt_id']}/coaching", headers=headers)
    assert coaching_response.status_code == 200
    coaching = coaching_response.json["coaching"]
    assert coaching["explanation_grade"] == 84
    assert coaching["reasoning_verdict"] == "mostly_correct"
    assert len(coaching["answer_analysis"]["choice_explanations"]) == 5
    assert {choice["label"] for choice in coaching["answer_analysis"]["choice_explanations"]} == set("ABCDE")
    assert captured["request"]["reasoning_effort"] == "xhigh"

    resumed = client.get(f"/v1/study-sessions/{session['id']}").json["session"]
    assert resumed["pending_result"]["feedback"]["coaching"]["explanation_grade"] == 84
    continued = client.post(f"/v1/study-sessions/{session['id']}/debrief/acknowledge", headers=headers)
    assert continued.status_code == 200
    assert continued.json["session"]["current_item"]["position"] == 1


def test_hugging_face_schema_is_mapped_to_questions_and_passages(monkeypatch):
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
            "DEV_AUTH_ENABLED": True,
        }
    )

    def fake_rows(dataset: str, split: str):
        is_rc = dataset.endswith("lsat-rc")
        yield {
            "context": "A shared reading passage." if is_rc else "A logical reasoning stimulus.",
            "id_string": f"{split}-{'RC' if is_rc else 'LR'}-1",
            "answers": ["one", "two", "three", "four", "five"],
            "label": 2,
            "question": "Which one of the following is most strongly supported?",
        }

    monkeypatch.setattr("app.seed._iter_dataset_rows", fake_rows)
    with application.app_context():
        assert seed_questions() == 6
        assert Question.query.count() == 6
        lr = Question.query.filter_by(section="Logical Reasoning").first()
        rc = Question.query.filter_by(section="Reading Comprehension").first()
        assert lr.stimulus == "A logical reasoning stimulus."
        assert lr.passage is None
        assert rc.stimulus is None
        assert rc.passage.canonical_text == "A shared reading passage."
        assert rc.correct_answer == "C"
        assert [choice.label for choice in rc.choices] == list("ABCDE")
        assert all(question.source.startswith(SOURCE_PREFIX) for question in Question.query.all())


def test_coaching_can_run_as_a_durable_async_job(app, monkeypatch):
    from app.jobs import process_ai_job

    client = app.test_client()
    headers = login(client, "async@example.test")
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    item = session["current_item"]
    attempt = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={"item_id": item["id"], "selected_label": "C"},
        headers={**headers, "Idempotency-Key": "async-answer"},
    ).json["result"]

    monkeypatch.setitem(app.config, "TFY_URL", "https://truefoundry.example/v1")
    monkeypatch.setitem(app.config, "TFY_API_KEY", "test-key")
    monkeypatch.setitem(app.config, "AI_JOBS_MODE", "sqs")
    monkeypatch.setitem(app.config, "AI_JOB_QUEUE_URL", "https://sqs.example/jobs")
    monkeypatch.setattr("app.jobs._send_job_message", lambda _job: None)
    expected = {"model": "test-model", "reasoning_summary": "Processed by the worker."}
    monkeypatch.setattr("app.services.run_attempt_coaching", lambda _attempt: expected)

    accepted = client.post(f"/v1/attempts/{attempt['attempt_id']}/coaching", headers=headers)
    assert accepted.status_code == 202
    job_id = accepted.json["job"]["id"]
    with app.app_context():
        assert process_ai_job(job_id).status == "completed"
    status = client.get(f"/v1/jobs/{job_id}")
    assert status.json["job"]["result"] == expected
