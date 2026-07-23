from __future__ import annotations

import json
from datetime import timedelta

import pytest
from sqlalchemy import update

from app import create_app
from app.extensions import db
from app.game import ASSETS, ASSET_BY_KEY, CLIENT_BY_KEY, FIRM_TIERS, TIER_GATED_ASSET_TYPES
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
    StudySession,
    User,
    utcnow,
)
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


def test_firm_advance_is_blocked_until_every_prior_upgrade_hire_and_acquisition_is_owned(app):
    client = app.test_client()
    headers = login(client, "tier-gate@example.test")
    created = create_game(client, headers)
    required = [
        asset
        for asset in ASSETS
        if asset["type"] in TIER_GATED_ASSET_TYPES and asset["tier"] == 0
    ]

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.cash = FIRM_TIERS[1]["cost"]
        profile.reputation = FIRM_TIERS[1]["reputation"]
        db.session.commit()

    locked_game = client.get("/v1/game").json["game"]
    next_tier = next(tier for tier in locked_game["catalog"]["tiers"] if tier["next"])
    assert set(next_tier["missing_assets"]) == {asset["key"] for asset in required}
    assert next_tier["available"] is False
    blocked = client.post("/v1/game/advance", json={"target_tier": 1}, headers=headers)
    assert blocked.status_code == 409
    assert blocked.json["error"]["code"] == "requirements_not_met"

    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        for asset in required:
            db.session.add(
                PlayerAsset(
                    profile_id=profile.id,
                    asset_key=asset["key"],
                    asset_type=asset["type"],
                    purchase_price=asset["cost"],
                )
            )
        db.session.commit()

    advanced = client.post("/v1/game/advance", json={"target_tier": 1}, headers=headers)
    assert advanced.status_code == 200
    assert advanced.json["game"]["office_tier"] == 1
    assert advanced.json["game"]["cash"] == 0


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
        "cost": ASSET_BY_KEY["repaired_desk"]["cost"],
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
        "base_fee": CLIENT_BY_KEY["walk_in"]["base_fee"],
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
        assert attempt.settlement.payout == 0
        assert profile.cash == 250
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
        profile.story_state.active_quest_key = "market_whisper"
        profile.story_state.quest_progress = 0
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
        # A wrong answer with an Excellent explanation is a well-reasoned miss:
        # standing still drops (accuracy matters) but far less than a careless
        # guess, and it now earns a modest consultation fee instead of nothing.
        assert 78 < profile.reputation < 80
        assert profile.current_streak == 0
        assert profile.total_cases == 1
        assert attempt.settlement.payout > 0
        assert profile.cash == 250 + attempt.settlement.payout
        assert profile.story_state.quest_progress == 0
        # A miss never advances the client's contract, preserving win-based pacing.
        assert contract.cases_remaining == starting_contract_cases

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
        desk_cost = ASSET_BY_KEY["repaired_desk"]["cost"]
        profile.cash = desk_cost + 650
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
    cap_hours = collected.json["game"]["passive_income"]["cap_hours"]
    assert cap_hours == 8
    assert collected.json["collected"] == ASSET_BY_KEY["junior_associate"]["passive_hourly"] * cap_hours
    manager = next(
        asset for asset in collected.json["game"]["catalog"]["assets"] if asset["key"] == "office_manager"
    )
    assert manager["benefit"] == ASSET_BY_KEY["office_manager"]["benefit"]


def test_locked_economy_action_refreshes_a_stale_profile(app):
    client = app.test_client()
    headers = login(client, "lock-refresh@example.test")
    create_game(client, headers)
    with app.app_context():
        from app.game import purchase_asset

        profile = PlayerProfile.query.join(PlayerProfile.user).filter(User.email == "lock-refresh@example.test").one()
        assert profile.cash == 250
        desk_cost = ASSET_BY_KEY["repaired_desk"]["cost"]
        db.session.execute(
            update(PlayerProfile).where(PlayerProfile.id == profile.id).values(cash=desk_cost + 650),
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
    rival = ASSET_BY_KEY["neighborhood_practice"]
    operation_cost = max(500, round(rival["cost"] * .02))
    discounted_cost = round(rival["cost"] * .95)
    assert operated.status_code == 200
    assert operated.json["result"]["cost"] == operation_cost
    target = next(item for item in operated.json["game"]["story"]["rival_targets"] if item["key"] == "neighborhood_practice")
    assert target["list_cost"] == rival["cost"]
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


def _settle_wrong_answer(app, monkeypatch, email: str, grade: int, *, reputation: float = 80.0) -> dict:
    """Answer one case incorrectly, coach it with the given grade, settle, and

    report the resulting economy state. The correct answer is always ``C``.
    """
    client = app.test_client()
    headers = login(client, email)
    create_game(client, headers)
    with app.app_context():
        profile = PlayerProfile.query.join(PlayerProfile.user).filter(User.email == email).one()
        profile.reputation = reputation
        db.session.commit()

    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    submitted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "B",
            "reasoning": (
                f"Choice B is tempting for {email}, but it only holds if we assume an "
                "unstated premise about scope that the stimulus never actually supplies."
            ),
        },
        headers={**headers, "Idempotency-Key": f"{email}-wrong"},
    ).json["result"]

    coaching = {
        "explanation_grade": grade,
        "reasoning_verdict": "mostly_correct",
        "reasoning_summary": "A specific analysis that isolates the decisive inference and the scope gap.",
        "model": "test-model",
    }
    monkeypatch.setattr("app.services.generate_attempt_coaching", lambda _attempt: (coaching, {}))
    with app.app_context():
        from app.services import run_attempt_coaching

        attempt = db.session.get(Attempt, submitted["attempt_id"])
        run_attempt_coaching(attempt)
        profile = PlayerProfile.query.filter_by(user_id=attempt.user_id).one()
        daily = DailyProgress.query.filter_by(profile_id=profile.id).one()
        return {
            "grade": attempt.settlement.explanation_grade,
            "payout": attempt.settlement.payout,
            "cash": profile.cash,
            "reputation": profile.reputation,
            "streak": profile.current_streak,
            "total_cases": profile.total_cases,
            "daily_cases": daily.cases_completed,
        }


def test_well_reasoned_wrong_answer_earns_consolation_and_protects_reputation(app, monkeypatch):
    result = _settle_wrong_answer(app, monkeypatch, "excellent-miss@example.test", 88)
    assert result["grade"] == "Excellent"
    # A thoughtful miss is no longer a total loss: it earns a modest fee...
    assert result["payout"] > 0
    assert result["cash"] == 250 + result["payout"]
    # ...counts as a completed case toward daily goals...
    assert result["total_cases"] == 1
    assert result["daily_cases"] == 1
    # ...but still breaks the streak and dents reputation only slightly.
    assert result["streak"] == 0
    assert 78.0 < result["reputation"] < 80.0


def test_only_strong_reasoning_is_rewarded_on_a_wrong_answer(app, monkeypatch):
    excellent = _settle_wrong_answer(app, monkeypatch, "reward-excellent@example.test", 88)
    weak = _settle_wrong_answer(app, monkeypatch, "reward-weak@example.test", 40)
    invalid = _settle_wrong_answer(app, monkeypatch, "reward-invalid@example.test", 0)

    assert weak["grade"] == "Weak"
    assert invalid["grade"] == "Invalid"
    # A thin or unsupported rationale on a wrong answer still earns nothing, so
    # genuine reasoning — not just "showing up" — is what the consolation rewards.
    assert weak["payout"] == 0 and weak["cash"] == 250 and weak["daily_cases"] == 0
    assert invalid["payout"] == 0 and invalid["cash"] == 250 and invalid["daily_cases"] == 0
    # And a well-argued miss protects standing better than a careless one.
    assert excellent["payout"] > 0
    assert excellent["reputation"] > weak["reputation"]
    assert excellent["reputation"] > invalid["reputation"]


def test_completed_contract_auto_renews_so_a_client_can_be_replayed(app, monkeypatch):
    client = app.test_client()
    headers = login(client, "renew@example.test")
    created = create_game(client, headers)
    walk_in_length = CLIENT_BY_KEY["walk_in"]["length"]
    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        contract = PlayerClientContract.query.filter_by(profile_id=profile.id, client_key="walk_in").one()
        contract.cases_remaining = 1  # one decisive case away from finishing the contract
        profile.client_cases_remaining = 1
        db.session.commit()

    session = client.post("/v1/study-sessions", headers=headers).json["session"]
    submitted = client.post(
        f"/v1/study-sessions/{session['id']}/attempts",
        json={
            "item_id": session["current_item"]["id"],
            "selected_label": "C",
            "reasoning": "Choice C follows directly from the final premise without importing an unstated assumption.",
        },
        headers={**headers, "Idempotency-Key": "renew-final-case"},
    ).json["result"]
    coaching = {
        "explanation_grade": 88,
        "reasoning_verdict": "strong",
        "reasoning_summary": "The decisive inference was identified.",
        "model": "test-model",
    }
    monkeypatch.setattr("app.services.generate_attempt_coaching", lambda _attempt: (coaching, {}))
    with app.app_context():
        from app.services import run_attempt_coaching

        attempt = db.session.get(Attempt, submitted["attempt_id"])
        run_attempt_coaching(attempt)
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        contract = PlayerClientContract.query.filter_by(profile_id=profile.id, client_key="walk_in").one()
        # Finishing the contract pays the completion bonus and immediately re-signs
        # the client, so a full fresh docket is always ready to be worked again.
        assert contract.completed_contracts == 1
        assert contract.cases_remaining == walk_in_length
        assert profile.client_cases_remaining == walk_in_length
        assert attempt.settlement.contract_bonus > 0


def test_player_is_never_stranded_without_an_available_client(app):
    client = app.test_client()
    headers = login(client, "stranded@example.test")
    created = create_game(client, headers)
    with app.app_context():
        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        profile.reputation = 0  # rock bottom: nothing new can be unlocked
        profile.office_tier = 0
        db.session.commit()

    game = client.get("/v1/game").json["game"]
    walk_in = next(c for c in game["catalog"]["clients"] if c["key"] == "walk_in")
    assert walk_in["unlocked"] is True
    # This is exactly the dead-end scenario: no client other than the always-open
    # walk-in is unlockable here.
    unlocked_beyond_walk_in = [
        c["key"] for c in game["catalog"]["clients"] if c["unlocked"] and c["key"] != "walk_in"
    ]
    assert unlocked_beyond_walk_in == []

    with app.app_context():
        from app.game import select_client

        profile = PlayerProfile.query.filter_by(id=created["id"]).one()
        contract = PlayerClientContract.query.filter_by(profile_id=profile.id, client_key="walk_in").one()
        contract.cases_remaining = 0  # simulate a fully spent contract
        db.session.commit()
        # Re-selecting the client refills the docket, guaranteeing there is always
        # a case to work and progress never halts.
        select_client(profile, "walk_in")
        contract = PlayerClientContract.query.filter_by(profile_id=profile.id, client_key="walk_in").one()
        assert contract.cases_remaining == CLIENT_BY_KEY["walk_in"]["length"]
