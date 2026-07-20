from __future__ import annotations

import pytest

from app import create_app
from app.extensions import db
from app.models import SessionItem


@pytest.fixture(scope="module")
def app():
    return create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": True,
            "DIAGNOSTIC_SIZE": 6,
            "DEV_AUTH_ENABLED": True,
        }
    )


def login(client, email="detective@example.test"):
    response = client.post("/v1/auth/dev", json={"email": email, "display_name": "Test Detective"})
    assert response.status_code == 200
    csrf = client.get_cookie("sherlock_csrf").value
    return {"X-CSRF-Token": csrf}


def correct_label(app, item_id):
    with app.app_context():
        return db.session.get(SessionItem, item_id).question.correct_answer


def test_csrf_protects_writes(app):
    client = app.test_client()
    login(client, "csrf@example.test")
    response = client.patch("/v1/me/preferences", json={"target_minutes": 20})
    assert response.status_code == 403
    assert response.json["error"]["code"] == "csrf_failed"


def test_diagnostic_to_story_flow_and_progress(app):
    client = app.test_client()
    headers = login(client, "flow@example.test")
    assert client.patch("/v1/me/preferences", json={"target_minutes": 20}, headers=headers).status_code == 200

    session = client.post("/v1/diagnostics", headers=headers).json["session"]
    assert session["total_items"] == 6
    assert "correct_answer" not in session["current_item"]["question"]
    assert session["current_item"]["served_at"].endswith("Z")

    first_item = session["current_item"]
    first_payload = {
        "item_id": first_item["id"],
        "selected_label": correct_label(app, first_item["id"]),
        "elapsed_ms": 45_000,
    }
    if first_item["requires_reasoning"]:
        first_payload["reasoning"] = "This answer performs the logical task required by the question stem."
    idempotent_headers = {**headers, "Idempotency-Key": "first-attempt-key"}
    first = client.post(f"/v1/study-sessions/{session['id']}/attempts", json=first_payload, headers=idempotent_headers)
    duplicate = client.post(f"/v1/study-sessions/{session['id']}/attempts", json=first_payload, headers=idempotent_headers)
    assert first.status_code == duplicate.status_code == 200
    assert duplicate.json["result"]["duplicate"] is True

    for index in range(1, session["total_items"]):
        state = client.get("/v1/diagnostics/current").json["session"]
        item = state["current_item"]
        payload = {
            "item_id": item["id"],
            "selected_label": correct_label(app, item["id"]),
            "elapsed_ms": 45_000,
        }
        if item["requires_reasoning"]:
            payload["reasoning"] = "I identified the conclusion and connected it to the answer choice."
        response = client.post(
            f"/v1/study-sessions/{session['id']}/attempts",
            json=payload,
            headers={**headers, "Idempotency-Key": f"diagnostic-{index}"},
        )
        assert response.status_code == 200

    results = client.get("/v1/diagnostics/current").json
    assert results["status"] == "completed"
    assert results["results"]["estimated_score"] == 180
    assert results["results"]["questions_completed"] == 6

    daily = client.post("/v1/study-sessions", headers=headers)
    assert daily.status_code == 201
    assert daily.json["session"]["mode"] == "daily"
    assert daily.json["session"]["current_item"]["story"]["title"]

    progress = client.get("/v1/progress").json
    assert progress["readiness"]["estimated_score"] == 180
    assert progress["totals"]["attempts"] == 6


def test_google_identity_is_verified_server_side(app, monkeypatch):
    app.config["GOOGLE_CLIENT_ID"] = "local-google-client"
    monkeypatch.setattr(
        "app.routes.id_token.verify_oauth2_token",
        lambda credential, transport, audience: {
            "sub": "google-subject-1",
            "email": "google@example.test",
            "email_verified": True,
            "name": "Google Detective",
        },
    )
    client = app.test_client()
    response = client.post("/v1/auth/google", json={"credential": "verified-by-test"})
    assert response.status_code == 200
    assert response.json["user"]["email"] == "google@example.test"
    assert client.get_cookie("sherlock_session").http_only is True
