from __future__ import annotations

import json
from datetime import timedelta

import pytest
from sqlalchemy import update

from app import create_app
from app.extensions import db
from app.models import (
    AiJob,
    Attempt,
    AttemptSettlement,
    DailyProgress,
    LedgerEntry,
    Passage,
    PlayerAsset,
    PlayerClientContract,
    PlayerProfile,
    PlayerStoryState,
    Question,
    QuestionChoice,
    SessionItem,
    SkillProgress,
    StudySession,
    User,
    utcnow,
)
from app.seed import SOURCE_PREFIX, _iter_snapshot_rows, seed_questions


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


def test_development_auth_fails_closed(monkeypatch):
    monkeypatch.setenv("FLASK_ENV", "development")
    monkeypatch.setenv("DEV_AUTH_ENABLED", "false")
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
        }
    )
    assert application.test_client().post("/v1/auth/dev").status_code == 404

    monkeypatch.setenv("FLASK_ENV", "production")
    monkeypatch.setenv("DEV_AUTH_ENABLED", "true")
    with pytest.raises(RuntimeError, match="DEV_AUTH_ENABLED"):
        create_app({"TESTING": True, "AUTO_SEED": False})


def test_custom_instance_path_supports_read_only_deployment_layout(tmp_path):
    instance_path = tmp_path / "lambda-instance"
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
        },
        instance_path=str(instance_path),
    )

    assert application.instance_path == str(instance_path)
    assert instance_path.is_dir()


def create_game(client, headers, gender: str = "female"):
    response = client.post(
        "/v1/game/profile",
        json={"lawyer_name": "Alex Morgan", "firm_name": "Morgan Legal", "character_gender": gender},
        headers=headers,
    )
    assert response.status_code == 201
    return response.json["game"]


def add_historical_attempt(user_id: str, question_id: str, suffix: str) -> str:
    """Create an already-attempted question without invoking game settlement."""
    user = db.session.get(User, user_id)
    session = StudySession(
        user_id=user_id,
        mode="practice",
        status="completed",
        target_minutes=user.target_minutes,
        total_items=1,
        current_index=1,
        completed_at=utcnow(),
    )
    db.session.add(session)
    db.session.flush()
    item = SessionItem(
        session_id=session.id,
        question_id=question_id,
        position=0,
        requires_reasoning=True,
        target_time_seconds=150,
        completed_at=utcnow(),
    )
    db.session.add(item)
    db.session.flush()
    question = db.session.get(Question, question_id)
    attempt = Attempt(
        user_id=user_id,
        session_item_id=item.id,
        idempotency_key=f"history-{suffix}",
        selected_label=question.correct_answer,
        is_correct=True,
        reasoning_text="Historical reasoning.",
        server_elapsed_ms=60_000,
        capm_points=0,
        pace_scored=False,
        xp_earned=0,
        feedback_json={"is_correct": True, "correct_label": question.correct_answer},
        coaching_status="pending",
    )
    db.session.add(attempt)
    db.session.flush()
    return attempt.id


def test_account_onboards_then_goes_to_random_cases(app, monkeypatch):
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
    assert me.json["user"]["next_route"] == "/onboarding"
    assert "diagnostic_complete" not in me.json["user"]
    game = create_game(client, headers)
    assert game["character_gender"] == "female"
    assert game["cash"] == 250
    assert game["next_milestone"] == {
        "kind": "asset",
        "name": "Repaired oak desk",
        "cost": 350,
        "reputation": 0,
    }
    assert client.get("/v1/me").json["user"]["next_route"] == "/office"

    response = client.post("/v1/study-sessions", headers=headers)
    assert response.status_code == 201
    session = response.json["session"]
    assert session["mode"] == "practice"
    assert session["total_items"] == 3
    assert session["current_item"]["question"]["id"] == chosen_ids[0]
    assert session["current_item"]["case_terms"] == {
        "client_key": "walk_in",
        "client_name": "Walk-in client",
        "base_fee": 100,
    }
    duplicate_start = client.post("/v1/study-sessions", headers=headers)
    assert duplicate_start.status_code == 201
    assert duplicate_start.json["session"]["id"] == session["id"]

    with app.app_context():
        items = SessionItem.query.filter_by(session_id=session["id"]).order_by(SessionItem.position).all()
        assert [item.question_id for item in items] == chosen_ids
        assert all(item.question.source.startswith(SOURCE_PREFIX) for item in items)
        assert all(not hasattr(item, "story_json") for item in items)
        assert all(item.requires_reasoning is True for item in items)
        assert all(item.target_time_seconds in {135, 150, 330} for item in items)
        assert items[0].game_context_json
        assert all(item.game_context_json is None for item in items[1:])

    assert client.get("/v1/diagnostics/current").status_code == 404
    assert client.get("/v1/story/progress").status_code == 404


def test_completed_docket_returns_resolution_instead_of_silently_starting_another(app):
    client = app.test_client()
    headers = login(client, "resolution@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    expected_summary = {
        "kind": "practice",
        "accuracy": 67,
        "correct": 2,
        "questions_completed": 3,
        "elapsed_minutes": 4.5,
        "explanation_accuracy": 80,
        "skills": [],
    }
    with app.app_context():
        stored = db.session.get(StudySession, session["id"])
        stored.status = "completed"
        stored.completed_at = utcnow()
        stored.summary_json = expected_summary
        db.session.commit()

    response = client.post(f"/v1/study-sessions/{session['id']}/debrief/acknowledge", headers=headers)
    assert response.status_code == 200
    assert response.json["session"]["id"] == session["id"]
    assert response.json["session"]["status"] == "completed"
    assert response.json["summary"] == expected_summary


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
    create_game(client, headers)
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    item = session["current_item"]
    response = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": item["id"],
            "selected_label": "B",
            "reasoning": "The premises support B, and C appears to go beyond the evidence provided.",
            "confidence": 3,
        },
        headers={**headers, "Idempotency-Key": "first-answer"},
    )
    assert response.status_code == 200
    result = response.json["result"]
    assert result["feedback"]["correct_label"] == "C"
    assert result["confidence"] == 3

    coaching_response = client.post(f"/v1/attempts/{result['attempt_id']}/coaching", headers=headers)
    assert coaching_response.status_code == 200
    coaching = coaching_response.json["coaching"]
    assert coaching["explanation_grade"] == 84
    assert coaching["reasoning_verdict"] == "mostly_correct"
    assert len(coaching["answer_analysis"]["choice_explanations"]) == 5
    assert {choice["label"] for choice in coaching["answer_analysis"]["choice_explanations"]} == set("ABCDE")
    assert coaching["prompt_version"] == "coaching-v2-plain-language"
    assert captured["request"]["reasoning_effort"] == "xhigh"
    assert "one decisive bottom-line sentence" in captured["request"]["messages"][0]["content"]
    assert coaching_response.json["reward"]["explanation_grade"] == "Excellent"
    assert coaching_response.json["reward"]["score"] == 3
    assert coaching_response.json["game"]["total_cases"] == 1

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
            "QUESTION_BANK_DIR": "",
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


def test_repository_snapshot_is_used_without_hugging_face(tmp_path, monkeypatch):
    bank_dir = tmp_path / "question_bank"
    for dataset_slug in ("lsat-lr", "lsat-rc"):
        for split in ("train", "validation", "test"):
            split_dir = bank_dir / dataset_slug
            split_dir.mkdir(parents=True, exist_ok=True)
            row = {
                "context": "A reading passage." if dataset_slug == "lsat-rc" else "A reasoning stimulus.",
                "id_string": f"{split}-{dataset_slug}",
                "answers": ["one", "two", "three", "four", "five"],
                "label": 1,
                "question": "Which answer is supported?",
            }
            (split_dir / f"{split}.jsonl").write_text(json.dumps(row) + "\n", encoding="utf-8")

    def unexpected_download(_dataset: str, _split: str):
        raise AssertionError("Hugging Face should not be called when the repository snapshot is complete")

    monkeypatch.setattr("app.seed._iter_dataset_rows", unexpected_download)
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
            "DEV_AUTH_ENABLED": True,
            "QUESTION_BANK_DIR": str(bank_dir),
        }
    )
    with application.app_context():
        assert seed_questions() == 6
        assert Question.query.count() == 6


def test_repository_snapshot_manifest_rejects_tampered_hugging_face_rows(tmp_path):
    bank_dir = tmp_path / "question_bank"
    split_dir = bank_dir / "lsat-lr"
    split_dir.mkdir(parents=True)
    (split_dir / "train.jsonl").write_text('{"context":"tampered"}\n', encoding="utf-8")
    (bank_dir / "manifest.json").write_text(
        json.dumps(
            {
                "source": "Hugging Face Dataset Server",
                "total_questions": 1,
                "datasets": {
                    "tasksource/lsat-lr": {
                        "revision": "test-revision",
                        "splits": {
                            "train": {
                                "path": "lsat-lr/train.jsonl",
                                "questions": 1,
                                "sha256": "0" * 64,
                            }
                        },
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
            "QUESTION_BANK_DIR": str(bank_dir),
        }
    )
    with application.app_context(), pytest.raises(RuntimeError, match="integrity check failed"):
        list(_iter_snapshot_rows("tasksource/lsat-lr", "train"))


def test_coaching_can_run_as_a_durable_async_job(app, monkeypatch):
    from app.jobs import process_ai_job

    client = app.test_client()
    headers = login(client, "async@example.test")
    create_game(client, headers, "male")
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    item = session["current_item"]
    attempt = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": item["id"],
            "selected_label": "C",
            "reasoning": "The credited choice follows directly from the stated evidence in this stimulus.",
        },
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


def test_current_ai_job_lease_keeps_sqs_redelivery_retryable(app, monkeypatch):
    from app.jobs import JobLeaseActive, enqueue_coaching_job, process_ai_job

    client = app.test_client()
    headers = login(client, "current-lease@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    submitted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "reasoning": "The credited answer is supported by the final premise and stays within its scope.",
        },
        headers={**headers, "Idempotency-Key": "current-lease-answer"},
    ).json["result"]

    sent = []
    monkeypatch.setattr("app.jobs._send_job_message", lambda job: sent.append(job.id))
    with app.app_context():
        attempt = db.session.get(Attempt, submitted["attempt_id"])
        job = AiJob(
            user_id=attempt.user_id,
            kind="coaching",
            resource_id=attempt.id,
            dedup_key=f"coaching:{attempt.id}",
            status="processing",
            attempt_count=1,
            queue_message_id="original-message",
            started_at=utcnow(),
            payload_json={},
        )
        db.session.add(job)
        db.session.commit()
        job_id = job.id

        with pytest.raises(JobLeaseActive):
            process_ai_job(job_id)
        stored = db.session.get(AiJob, job_id)
        assert stored.status == "processing"
        assert stored.attempt_count == 1

        retried = enqueue_coaching_job(attempt)
        assert retried.status == "processing"
        assert retried.attempt_count == 1
        assert sent == []


def test_stale_ai_job_is_resent_and_redelivery_settles_once(app, monkeypatch):
    from app.jobs import enqueue_coaching_job, process_ai_job

    client = app.test_client()
    headers = login(client, "stale-lease@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    submitted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "reasoning": "Choice C follows from the stated evidence without adding a new assumption.",
        },
        headers={**headers, "Idempotency-Key": "stale-lease-answer"},
    ).json["result"]
    coaching = {
        "explanation_grade": 86,
        "reasoning_verdict": "strong",
        "reasoning_summary": "The decisive inference was identified.",
        "model": "test-model",
    }
    monkeypatch.setattr("app.services.generate_attempt_coaching", lambda _attempt: (coaching, {}))
    sent = []

    def fake_send(job):
        sent.append(job.id)
        job.queue_message_id = "replacement-message"
        db.session.commit()

    monkeypatch.setattr("app.jobs._send_job_message", fake_send)
    with app.app_context():
        attempt = db.session.get(Attempt, submitted["attempt_id"])
        job = AiJob(
            user_id=attempt.user_id,
            kind="coaching",
            resource_id=attempt.id,
            dedup_key=f"coaching:{attempt.id}",
            status="processing",
            attempt_count=1,
            queue_message_id="lost-message",
            started_at=utcnow() - timedelta(seconds=300),
            payload_json={},
        )
        db.session.add(job)
        db.session.commit()
        job_id = job.id

        reclaimed = enqueue_coaching_job(attempt)
        assert reclaimed.status == "queued"
        assert reclaimed.started_at is None
        assert reclaimed.attempt_count == 1
        assert reclaimed.queue_message_id == "replacement-message"
        assert sent == [job_id]

        # Simulate a worker that claimed the replacement and crashed. The
        # stale SQS redelivery may safely execute it again.
        reclaimed.status = "processing"
        reclaimed.started_at = utcnow() - timedelta(seconds=300)
        db.session.commit()
        completed = process_ai_job(job_id)
        assert completed.status == "completed"
        assert completed.attempt_count == 2
        assert AttemptSettlement.query.filter_by(attempt_id=attempt.id).count() == 1
        assert LedgerEntry.query.filter_by(
            user_id=attempt.user_id,
            kind="case_payout",
            source_id=attempt.id,
        ).count() == 1

        duplicate = process_ai_job(job_id)
        assert duplicate.status == "completed"
        assert duplicate.attempt_count == 2
        assert AttemptSettlement.query.filter_by(attempt_id=attempt.id).count() == 1


def test_tycoon_scoring_gates_speed_and_reasoning():
    from app.game import _points

    assert _points(True, "Invalid", 100, 150) == (4, 0, 0, 4)
    assert _points(True, "Weak", 100, 150) == (4, 4, 0, 8)
    assert _points(True, "Good", 75, 150) == (4, 10, 4, 18)
    assert _points(True, "Excellent", 75, 150) == (4, 12, 4, 20)
    assert _points(True, "Excellent", 20, 150)[3] == 8
    assert _points(False, "Excellent", 75, 150) == (1, 2, 0, 3)
    assert _points(True, "Excellent", 75, 150, time_eligible=False) == (4, 12, 0, 16)


def test_reasoning_is_required_server_side(app):
    client = app.test_client()
    headers = login(client, "required@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    response = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={"item_id": session["current_item"]["id"], "selected_label": "C"},
        headers={**headers, "Idempotency-Key": "blank-reasoning"},
    )
    assert response.status_code == 400
    assert response.json["error"]["code"] == "reasoning_required"


def test_case_settlement_and_ledger_are_exactly_once(app, monkeypatch):
    client = app.test_client()
    headers = login(client, "settlement@example.test")
    created = create_game(client, headers)
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    item = session["current_item"]
    submitted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": item["id"],
            "selected_label": "C",
            "reasoning": "The conclusion follows because the stated premise directly supports choice C.",
        },
        headers={**headers, "Idempotency-Key": "settle-once"},
    ).json["result"]

    coaching = {
        "provider": "test",
        "model": "test-model",
        "reasoning_effort": "test",
        "prompt_version": "test",
        "explanation_grade": 86,
        "reasoning_verdict": "strong",
        "reasoning_summary": "The decisive inference was identified.",
        "understood_correctly": "The decisive inference was identified.",
        "first_error": None,
        "answer_analysis": {
            "correct_answer_explanation": "C follows.",
            "selected_answer_explanation": "C follows.",
            "choice_explanations": [],
        },
        "next_step_hint": "Repeat the same disciplined comparison.",
        "solution_method": "Identify the exact inference and test each option.",
        "debrief": "Sound work.",
    }
    monkeypatch.setattr("app.services.generate_attempt_coaching", lambda _attempt: (coaching, {}))
    with app.app_context():
        from app.services import run_attempt_coaching

        attempt = db.session.get(Attempt, submitted["attempt_id"])
        first = run_attempt_coaching(attempt)
        second = run_attempt_coaching(attempt)
        assert first == second
        assert AttemptSettlement.query.filter_by(attempt_id=attempt.id).count() == 1
        assert LedgerEntry.query.filter_by(user_id=attempt.user_id, kind="case_payout", source_id=attempt.id).count() == 1
        profile = PlayerProfile.query.filter_by(user_id=attempt.user_id).one()
        assert profile.cash == created["cash"] + attempt.settlement.payout
        assert profile.total_cases == 1


def test_invalid_reasoning_does_not_advance_cash_daily_goals(app, monkeypatch):
    client = app.test_client()
    headers = login(client, "invalid-daily@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    submitted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "reasoning": "This answer is right because it is the right answer.",
        },
        headers={**headers, "Idempotency-Key": "invalid-daily-answer"},
    ).json["result"]
    coaching = {
        "explanation_grade": 0,
        "reasoning_verdict": "unsupported",
        "reasoning_summary": "The explanation is generic and does not analyze this question.",
        "model": "test-model",
    }
    monkeypatch.setattr("app.services.generate_attempt_coaching", lambda _attempt: (coaching, {}))
    with app.app_context():
        from app.services import run_attempt_coaching

        attempt = db.session.get(Attempt, submitted["attempt_id"])
        run_attempt_coaching(attempt)
        profile = PlayerProfile.query.filter_by(user_id=attempt.user_id).one()
        daily = DailyProgress.query.filter_by(profile_id=profile.id).one()
        assert attempt.settlement.explanation_grade == "Invalid"
        assert profile.total_cases == 1
        assert daily.cases_completed == 0


def test_tycoon_review_cannot_skip_wrong_answer_settlement(app, monkeypatch):
    client = app.test_client()
    headers = login(client, "no-skip@example.test")
    create_game(client, headers)
    with app.app_context():
        profile = PlayerProfile.query.join(PlayerProfile.user).filter(User.email == "no-skip@example.test").one()
        profile.reputation = 80
        profile.current_streak = 4
        profile.best_streak = 4
        contract = PlayerClientContract.query.filter_by(
            profile_id=profile.id,
            client_key="walk_in",
        ).one()
        starting_contract_cases = contract.cases_remaining
        db.session.commit()

    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    submitted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "B",
            "reasoning": "Choice B seems plausible because it appears to follow from the final premise.",
        },
        headers={**headers, "Idempotency-Key": "wrong-cannot-skip"},
    ).json["result"]

    blocked = client.post(f"/v1/study-sessions/{session['id']}/debrief/acknowledge", headers=headers)
    assert blocked.status_code == 409
    assert blocked.json["error"]["code"] == "settlement_required"
    with app.app_context():
        profile = PlayerProfile.query.join(PlayerProfile.user).filter(User.email == "no-skip@example.test").one()
        contract = PlayerClientContract.query.filter_by(profile_id=profile.id, client_key="walk_in").one()
        stored_session = db.session.get(StudySession, session["id"])
        assert stored_session.pending_attempt_id == submitted["attempt_id"]
        assert profile.reputation == 80
        assert profile.current_streak == 4
        assert profile.total_cases == 0
        assert contract.cases_remaining == starting_contract_cases

    coaching = {
        "explanation_grade": 88,
        "reasoning_verdict": "mostly_correct",
        "reasoning_summary": "The explanation missed the credited inference.",
        "model": "test-model",
    }
    monkeypatch.setattr("app.services.generate_attempt_coaching", lambda _attempt: (coaching, {}))
    with app.app_context():
        from app.services import run_attempt_coaching

        attempt = db.session.get(Attempt, submitted["attempt_id"])
        run_attempt_coaching(attempt)
        profile = PlayerProfile.query.filter_by(user_id=attempt.user_id).one()
        contract = PlayerClientContract.query.filter_by(profile_id=profile.id, client_key="walk_in").one()
        assert attempt.settlement is not None
        assert profile.reputation < 80
        assert profile.current_streak == 0
        assert profile.total_cases == 1
        assert contract.cases_remaining == starting_contract_cases - 1

    continued = client.post(f"/v1/study-sessions/{session['id']}/debrief/acknowledge", headers=headers)
    assert continued.status_code == 200
    assert continued.json["session"]["current_item"]["position"] == 1


def test_finished_legacy_attempt_is_not_adopted_or_paid_retroactively(app):
    client = app.test_client()
    headers = login(client, "legacy-finished@example.test")
    create_game(client, headers)
    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    submitted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "B",
            "reasoning": "This is a historical explanation created before the tycoon economy existed.",
        },
        headers={**headers, "Idempotency-Key": "finished-legacy"},
    ).json["result"]
    with app.app_context():
        attempt = db.session.get(Attempt, submitted["attempt_id"])
        attempt.session_item.game_context_json = None
        db.session.commit()

    resumed = client.get(f"/v1/study-sessions/{session['id']}")
    assert resumed.status_code == 200
    assert resumed.json["session"]["pending_result"]["game_reward"] is None
    with app.app_context():
        attempt = db.session.get(Attempt, submitted["attempt_id"])
        profile = PlayerProfile.query.filter_by(user_id=attempt.user_id).one()
        assert attempt.session_item.game_context_json is None
        assert attempt.settlement is None
        assert profile.total_cases == 0

    acknowledged = client.post(f"/v1/study-sessions/{session['id']}/debrief/acknowledge", headers=headers)
    assert acknowledged.status_code == 200


def test_unfinished_legacy_rc_item_is_adopted_with_correct_target(app):
    client = app.test_client()
    headers = login(client, "legacy-rc@example.test")
    assert client.post("/v1/study-sessions", headers=headers).status_code == 409

    with app.app_context():
        user = User.query.filter_by(email="legacy-rc@example.test").one()
        rc_questions = Question.query.filter_by(section="Reading Comprehension").order_by(Question.id).limit(2).all()
        assert len(rc_questions) == 2
        assert rc_questions[0].passage_id == rc_questions[1].passage_id
        legacy_session = StudySession(
            user_id=user.id,
            mode="practice",
            status="in_progress",
            target_minutes=user.target_minutes,
            total_items=2,
            current_index=1,
        )
        db.session.add(legacy_session)
        db.session.flush()
        db.session.add_all(
            [
                SessionItem(
                    session_id=legacy_session.id,
                    question_id=rc_questions[0].id,
                    position=0,
                    requires_reasoning=False,
                    target_time_seconds=150,
                    completed_at=utcnow(),
                ),
                SessionItem(
                    session_id=legacy_session.id,
                    question_id=rc_questions[1].id,
                    position=1,
                    requires_reasoning=False,
                    target_time_seconds=150,
                ),
            ]
        )
        db.session.commit()
        session_id = legacy_session.id
        current_item_id = legacy_session.items[1].id

    rejected = client.post(
        f"/v1/study-sessions/{session_id}/attempts",
        json={
            "item_id": current_item_id,
            "selected_label": "C",
            "reasoning": "The passage directly supports this choice.",
        },
        headers={**headers, "Idempotency-Key": "legacy-before-onboarding"},
    )
    assert rejected.status_code == 409
    assert rejected.json["error"]["code"] == "onboarding_required"

    create_game(client, headers)
    resumed = client.get(f"/v1/study-sessions/{session_id}")
    assert resumed.status_code == 200
    assert resumed.json["session"]["current_item"]["target_time_seconds"] == 135
    with app.app_context():
        items = SessionItem.query.filter_by(session_id=session_id).order_by(SessionItem.position).all()
        assert items[0].game_context_json is None
        assert items[1].game_context_json
        assert items[1].target_time_seconds == 135


def test_purchases_and_passive_income_are_account_bound(app):
    first = app.test_client()
    first_headers = login(first, "owner@example.test")
    create_game(first, first_headers)
    second = app.test_client()
    second_headers = login(second, "other@example.test")
    second_game = create_game(second, second_headers, "male")

    with app.app_context():
        profile = PlayerProfile.query.join(PlayerProfile.user).filter(User.email == "owner@example.test").one()
        profile.cash = 1_000
        db.session.commit()

    bought = first.post("/v1/game/purchases", json={"asset_key": "repaired_desk"}, headers=first_headers)
    assert bought.status_code == 200
    assert bought.json["game"]["cash"] == 650
    assert first.post("/v1/game/purchases", json={"asset_key": "repaired_desk"}, headers=first_headers).status_code == 409
    assert second.get("/v1/game").json["game"]["cash"] == second_game["cash"]
    assert "repaired_desk" not in second.get("/v1/game").json["game"]["owned_assets"]

    with app.app_context():
        profile = PlayerProfile.query.join(PlayerProfile.user).filter(User.email == "owner@example.test").one()
        db.session.add(
            PlayerAsset(
                profile_id=profile.id,
                asset_key="junior_associate",
                asset_type="staff",
                purchase_price=8_000,
            )
        )
        db.session.add(
            PlayerAsset(
                profile_id=profile.id,
                asset_key="office_manager",
                asset_type="staff",
                purchase_price=25_000,
            )
        )
        profile.last_passive_collected_at = utcnow() - timedelta(hours=20)
        db.session.commit()
    collected = first.post("/v1/game/passive-income/collect", headers=first_headers)
    assert collected.status_code == 200
    assert collected.json["collected"] == 240
    assert collected.json["game"]["passive_income"]["cap_hours"] == 8
    manager = next(
        asset for asset in collected.json["game"]["catalog"]["assets"] if asset["key"] == "office_manager"
    )
    assert manager["benefit"] == "+5% active case payout"


def test_locked_economy_action_refreshes_a_stale_profile(app):
    client = app.test_client()
    headers = login(client, "lock-refresh@example.test")
    create_game(client, headers)
    with app.app_context():
        from app.game import purchase_asset

        profile = PlayerProfile.query.join(PlayerProfile.user).filter(User.email == "lock-refresh@example.test").one()
        assert profile.cash == 250
        db.session.execute(
            update(PlayerProfile).where(PlayerProfile.id == profile.id).values(cash=1_000),
            execution_options={"synchronize_session": False},
        )
        assert profile.cash == 250
        purchase_asset(profile, "repaired_desk")
        assert profile.cash == 650


def test_campaign_choice_is_persistent_and_cannot_be_replayed(app):
    client = app.test_client()
    headers = login(client, "campaign@example.test")
    game = create_game(client, headers)
    assert game["story"]["alignment"] == "Pragmatic"
    assert game["story"]["pending_chapter"]["key"] == "one_light_on"

    decided = client.post(
        "/v1/game/story/choice",
        json={"chapter_key": "one_light_on", "choice_key": "open_door"},
        headers=headers,
    )
    assert decided.status_code == 200
    story = decided.json["game"]["story"]
    assert story["ethics"] == 78
    assert story["influence"] == 2
    assert story["pending_chapter"] is None
    assert story["chapters"][0]["seen"] is True
    assert story["chapters"][0]["choice"] == "open_door"

    replay = client.post(
        "/v1/game/story/choice",
        json={"chapter_key": "one_light_on", "choice_key": "build_fast"},
        headers=headers,
    )
    assert replay.status_code == 409
    assert replay.json["error"]["code"] == "chapter_not_pending"
    with app.app_context():
        state = PlayerStoryState.query.one()
        assert state.seen_chapters_json == ["one_light_on"]


def test_ethics_and_intel_reveal_and_fund_a_hidden_quest(app):
    client = app.test_client()
    headers = login(client, "shadow@example.test")
    created = create_game(client, headers)
    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.office_tier = 4
        profile.story_state.ethics = 60
        profile.story_state.intel = 3
        db.session.commit()

    game = client.get("/v1/game").json["game"]
    hidden = next(quest for quest in game["story"]["quests"] if quest["key"] == "market_whisper")
    assert hidden["available"] is True
    opened = client.post("/v1/game/quests/start", json={"quest_key": "market_whisper"}, headers=headers)
    assert opened.status_code == 200
    assert opened.json["result"]["advance"] == 100_000
    assert opened.json["game"]["story"]["active_quest"]["key"] == "market_whisper"
    assert opened.json["game"]["story"]["heat"] == 10
    assert opened.json["game"]["cash"] == created["cash"] + 100_000


def test_rival_operation_reduces_the_real_purchase_price(app):
    from app.game import ASSET_BY_KEY

    list_cost = ASSET_BY_KEY["neighborhood_practice"]["cost"]
    operation_cost = round(list_cost * .02)
    discounted_cost = round(list_cost * .95)
    client = app.test_client()
    headers = login(client, "rival-ops@example.test")
    created = create_game(client, headers)
    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.cash = 1_000_000
        profile.reputation = 80
        profile.office_tier = 2
        profile.story_state.influence = 5
        db.session.add(PlayerAsset(profile_id=profile.id, asset_key="local_bar", asset_type="connection", purchase_price=1))
        db.session.commit()

    operated = client.post(
        "/v1/game/rival-operations",
        json={"rival_key": "neighborhood_practice", "operation_key": "public_case_challenge"},
        headers=headers,
    )
    assert operated.status_code == 200
    assert operated.json["result"]["cost"] == operation_cost
    target = next(item for item in operated.json["game"]["story"]["rival_targets"] if item["key"] == "neighborhood_practice")
    assert target["list_cost"] == list_cost
    assert target["cost"] == discounted_cost
    assert target["discount_bps"] == 500

    bought = client.post("/v1/game/purchases", json={"asset_key": "neighborhood_practice"}, headers=headers)
    assert bought.status_code == 200
    assert bought.json["game"]["cash"] == 1_000_000 - operation_cost - discounted_cost
    with app.app_context():
        acquired = PlayerAsset.query.filter_by(asset_key="neighborhood_practice").one()
        assert acquired.purchase_price == discounted_cost


def test_pro_bono_win_and_caseboard_completion_change_the_settlement(app, monkeypatch):
    client = app.test_client()
    headers = login(client, "pro-bono@example.test")
    created = create_game(client, headers)
    selected = client.post("/v1/game/client", json={"client_key": "eviction_defense_clinic"}, headers=headers)
    assert selected.status_code == 200
    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.story_state.active_quest_key = "mercer_overflow"
        profile.story_state.quest_progress = 2
        db.session.commit()

    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    submitted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "reasoning": "Choice C follows from the decisive premise while the other choices require facts not supplied.",
        },
        headers={**headers, "Idempotency-Key": "pro-bono-completion"},
    ).json["result"]
    coaching = {
        "explanation_grade": 88,
        "reasoning_verdict": "strong",
        "reasoning_summary": "The decisive premise and scope were identified.",
        "model": "test-model",
    }
    monkeypatch.setattr("app.services.generate_attempt_coaching", lambda _attempt: (coaching, {}))
    with app.app_context():
        from app.services import run_attempt_coaching

        attempt = db.session.get(Attempt, submitted["attempt_id"])
        run_attempt_coaching(attempt)
        settlement = attempt.settlement
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        assert settlement.quest_bonus == 650
        assert settlement.payout >= settlement.quest_bonus
        assert settlement.reputation_after >= settlement.reputation_before + 2
        assert profile.story_state.active_quest_key is None
        assert "mercer_overflow" in profile.story_state.quest_history_json
        cash_after = profile.cash
        run_attempt_coaching(attempt)
        assert PlayerProfile.query.filter_by(id=created["id"]).one().cash == cash_after


def test_rapid_review_uses_distinct_owned_hf_history_and_allows_optional_reasoning(app):
    owner = app.test_client()
    owner_headers = login(owner, "review-owner@example.test")
    owner_game = create_game(owner, owner_headers)
    intruder = app.test_client()
    intruder_headers = login(intruder, "review-intruder@example.test")
    intruder_game = create_game(intruder, intruder_headers)

    with app.app_context():
        owner_profile = db.session.get(PlayerProfile, owner_game["id"])
        intruder_profile = db.session.get(PlayerProfile, intruder_game["id"])
        questions = Question.query.order_by(Question.id).limit(3).all()
        owner_question_ids = {questions[0].id, questions[1].id}
        add_historical_attempt(owner_profile.user_id, questions[0].id, "owner-first")
        add_historical_attempt(owner_profile.user_id, questions[0].id, "owner-duplicate")
        add_historical_attempt(owner_profile.user_id, questions[1].id, "owner-second")
        mismatched_attempt_id = add_historical_attempt(
            intruder_profile.user_id,
            questions[2].id,
            "intruder-only",
        )
        # A malformed row cannot leak a question from somebody else's session
        # merely because its denormalized attempt owner is wrong.
        db.session.get(Attempt, mismatched_attempt_id).user_id = owner_profile.user_id
        rogue = StudySession(
            user_id=owner_profile.user_id,
            mode="diagnostic",
            target_minutes=owner_profile.user.target_minutes,
            total_items=0,
        )
        db.session.add(rogue)
        db.session.commit()
        rogue_id = rogue.id

    available = owner.get("/v1/study-sessions/review/available")
    assert available.status_code == 200
    assert available.json == {"available_questions": 2, "session": None}

    started = owner.post("/v1/study-sessions/review", headers=owner_headers)
    assert started.status_code == 201
    session = started.json["session"]
    assert session["mode"] == "review"
    assert session["total_items"] == 2
    assert session["current_item"]["case_terms"] is None
    assert session["current_item"]["question"]["id"] in owner_question_ids
    assert owner.post("/v1/study-sessions/review", headers=owner_headers).json["session"]["id"] == session["id"]

    with app.app_context():
        items = SessionItem.query.filter_by(session_id=session["id"]).order_by(SessionItem.position).all()
        assert {item.question_id for item in items} == owner_question_ids
        assert len(items) == len({item.question_id for item in items})
        assert all(item.question.source.startswith(SOURCE_PREFIX) for item in items)
        assert all(item.requires_reasoning is False for item in items)
        assert all(item.game_context_json is None for item in items)

    assert intruder.get(f"/v1/study-sessions/{session['id']}").status_code == 404
    rejected = intruder.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={"item_id": session["current_item"]["id"], "selected_label": "A"},
        headers=intruder_headers,
    )
    assert rejected.status_code == 404
    assert owner.get(f"/v1/study-sessions/{rogue_id}").status_code == 404

    first = owner.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={"item_id": session["current_item"]["id"], "selected_label": "A"},
        headers={**owner_headers, "Idempotency-Key": "review-without-reasoning"},
    )
    assert first.status_code == 200
    first_result = first.json["result"]
    assert first_result["has_reasoning"] is False
    assert first_result["game_reward"] is None
    assert first_result["feedback"]["correct_label"] == "C"
    assert first_result["feedback"]["diagnosis"] == "The verified answer is C."
    assert "immediately" in first_result["feedback"]["coaching_notice"]

    next_response = owner.post(
        f"/v1/study-sessions/{session['id']}/debrief/acknowledge",
        headers=owner_headers,
    )
    assert next_response.status_code == 200
    next_item = next_response.json["session"]["current_item"]
    second = owner.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": next_item["id"],
            "selected_label": "C",
            "reasoning": "The credited choice follows directly from the stated rule.",
        },
        headers={**owner_headers, "Idempotency-Key": "review-with-reasoning"},
    )
    assert second.status_code == 200
    assert second.json["result"]["has_reasoning"] is True
    assert second.json["result"]["feedback"]["correct_label"] == "C"


def test_rapid_review_never_changes_progression_or_economy(app, monkeypatch):
    client = app.test_client()
    headers = login(client, "review-safety@example.test")
    created = create_game(client, headers)

    with app.app_context():
        profile = db.session.get(PlayerProfile, created["id"])
        question = Question.query.order_by(Question.id).first()
        add_historical_attempt(profile.user_id, question.id, "safety-source")
        profile.cash = 9_000
        profile.reputation = 72
        profile.current_streak = 3
        profile.best_streak = 5
        profile.total_cases = 11
        profile.total_correct = 7
        profile.total_validated_correct = 6
        profile.lifetime_earnings = 12_000
        profile.lifetime_spending = 3_250
        profile.client_cases_remaining = 7
        contract = PlayerClientContract.query.filter_by(
            profile_id=profile.id,
            client_key="walk_in",
        ).one()
        contract.cases_remaining = 7
        contract.completed_contracts = 2
        contract.loyalty = 4
        daily = DailyProgress.query.filter_by(profile_id=profile.id).one()
        daily.cases_completed = 4
        daily.claimed_json = [1, 3]
        story = profile.story_state
        story.ethics = 61
        story.heat = 12
        story.influence = 5
        story.intel = 6
        story.seen_chapters_json = ["one_light_on"]
        story.choices_json = {"one_light_on": "open_door"}
        story.active_quest_key = "mercer_overflow"
        story.quest_progress = 2
        story.quest_history_json = ["first_brief"]
        story.rival_discounts_json = {"neighborhood_practice": 500}
        story.operations_json = ["neighborhood_practice:public_case_challenge"]
        db.session.add(
            SkillProgress(
                user_id=profile.user_id,
                skill_name=question.question_type,
                attempts=9,
                correct=6,
                explanation_total=4.5,
                explanation_count=5,
                total_time_ms=420_000,
                recent_mistakes=2,
            )
        )
        db.session.commit()
        user_id = profile.user_id

        def progression_snapshot():
            current = db.session.get(PlayerProfile, created["id"])
            current_story = current.story_state
            return {
                "profile": (
                    current.cash,
                    current.reputation,
                    current.office_tier,
                    current.current_streak,
                    current.best_streak,
                    current.total_cases,
                    current.total_correct,
                    current.total_validated_correct,
                    current.lifetime_earnings,
                    current.lifetime_spending,
                    current.active_client_key,
                    current.client_cases_remaining,
                    current.updated_at.isoformat(),
                ),
                "daily": [
                    (
                        row.id,
                        row.activity_date.isoformat(),
                        row.cases_completed,
                        json.dumps(row.claimed_json, sort_keys=True),
                        row.updated_at.isoformat(),
                    )
                    for row in DailyProgress.query.filter_by(profile_id=current.id).order_by(DailyProgress.id)
                ],
                "contracts": [
                    (
                        row.id,
                        row.client_key,
                        row.cases_remaining,
                        row.completed_contracts,
                        row.loyalty,
                        row.updated_at.isoformat(),
                    )
                    for row in PlayerClientContract.query.filter_by(profile_id=current.id).order_by(PlayerClientContract.id)
                ],
                "story": (
                    current_story.ethics,
                    current_story.heat,
                    current_story.influence,
                    current_story.intel,
                    json.dumps(current_story.seen_chapters_json, sort_keys=True),
                    json.dumps(current_story.choices_json, sort_keys=True),
                    current_story.active_quest_key,
                    current_story.quest_progress,
                    json.dumps(current_story.quest_history_json, sort_keys=True),
                    json.dumps(current_story.rival_discounts_json, sort_keys=True),
                    json.dumps(current_story.operations_json, sort_keys=True),
                    current_story.updated_at.isoformat(),
                ),
                "settlements": [
                    (row.id, row.attempt_id, row.payout, row.created_at.isoformat())
                    for row in AttemptSettlement.query.filter_by(user_id=user_id).order_by(AttemptSettlement.id)
                ],
                "ledger": [
                    (
                        row.id,
                        row.kind,
                        row.source_id,
                        row.amount,
                        row.balance_after,
                        json.dumps(row.detail_json, sort_keys=True),
                        row.created_at.isoformat(),
                    )
                    for row in LedgerEntry.query.filter_by(user_id=user_id).order_by(LedgerEntry.id)
                ],
                "skills": [
                    (
                        row.id,
                        row.skill_name,
                        row.attempts,
                        row.correct,
                        row.explanation_total,
                        row.explanation_count,
                        row.total_time_ms,
                        row.recent_mistakes,
                        row.updated_at.isoformat(),
                    )
                    for row in SkillProgress.query.filter_by(user_id=user_id).order_by(SkillProgress.id)
                ],
            }

        before = progression_snapshot()

    started = client.post("/v1/study-sessions/review", headers=headers)
    assert started.status_code == 201
    session = started.json["session"]
    assert session["mode"] == "review"
    # Mode, not the incidental absence of game context, is the safety
    # boundary. Simulate a malformed legacy row that carries frozen terms.
    with app.app_context():
        review_item = db.session.get(SessionItem, session["current_item"]["id"])
        review_item.game_context_json = {"client_key": "walk_in", "base_fee": 100}
        db.session.commit()
    submitted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={"item_id": session["current_item"]["id"], "selected_label": "A"},
        headers={**headers, "Idempotency-Key": "review-safety-submit"},
    )
    assert submitted.status_code == 200
    result = submitted.json["result"]
    assert result["feedback"]["correct_label"] == "C"
    assert result["game_reward"] is None
    assert result["has_reasoning"] is False

    coaching = {
        "explanation_grade": None,
        "reasoning_verdict": "not_provided",
        "reasoning_summary": "No written explanation was submitted.",
        "model": "test-model",
    }
    monkeypatch.setattr("app.routes.provider_ready", lambda: True)
    monkeypatch.setattr("app.services.generate_attempt_coaching", lambda _attempt: (coaching, {}))
    coached = client.post(f"/v1/attempts/{result['attempt_id']}/coaching", headers=headers)
    assert coached.status_code == 200
    assert coached.json["status"] == "completed"
    assert coached.json["reward"] is None
    coached_again = client.post(f"/v1/attempts/{result['attempt_id']}/coaching", headers=headers)
    assert coached_again.status_code == 200
    assert coached_again.json["reward"] is None
    reward = client.get(f"/v1/attempts/{result['attempt_id']}/reward")
    assert reward.status_code == 200
    assert reward.json["reward"] is None
    acknowledged = client.post(
        f"/v1/study-sessions/{session['id']}/debrief/acknowledge",
        headers=headers,
    )
    assert acknowledged.status_code == 200
    assert acknowledged.json["summary"]["kind"] == "review"

    with app.app_context():
        attempt = db.session.get(Attempt, result["attempt_id"])
        assert attempt.settlement is None
        assert attempt.explanation_score_applied is False
        after = progression_snapshot()
        assert after == before
