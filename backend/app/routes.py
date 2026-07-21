from __future__ import annotations

import uuid

from flask import Blueprint, current_app, g, jsonify, make_response, request
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from .auth import clear_auth_cookies, issue_auth_cookies, require_auth
from .coaching import CoachingProviderError, provider_ready
from .extensions import db
from .models import Attempt, AuthSession, Question, SessionItem, StudySession, User, utcnow
from .services import (
    calculate_session_summary,
    create_study_session,
    progress_dashboard,
    request_item_hint,
    run_attempt_coaching,
    serialize_attempt_result,
    serialize_session,
    serialize_user,
    story_progress_for,
    submit_attempt,
)

api = Blueprint("api", __name__)


def error(code: str, message: str, status: int = 400):
    return jsonify({"error": {"code": code, "message": message}}), status


def _upsert_google_user(claims: dict) -> User:
    user = User.query.filter_by(google_sub=claims["sub"]).first()
    if not user:
        user = User.query.filter_by(email=claims["email"].lower()).first()
    if not user:
        user = User(
            google_sub=claims["sub"],
            email=claims["email"].lower(),
            display_name=claims.get("name") or claims["email"].split("@")[0],
            avatar_url=claims.get("picture"),
        )
        db.session.add(user)
    else:
        user.google_sub = claims["sub"]
        user.display_name = claims.get("name") or user.display_name
        user.avatar_url = claims.get("picture") or user.avatar_url
    db.session.flush()
    story_progress_for(user)
    db.session.commit()
    return user


@api.get("/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "questions": Question.query.count(),
            "coaching": {
                "ready": provider_ready(),
                "model": current_app.config["COACHING_MODEL"],
                "reasoning_effort": current_app.config["COACHING_REASONING_EFFORT"],
            },
        }
    )


@api.get("/auth/config")
def auth_config():
    return jsonify(
        {
            "google_client_id": current_app.config["GOOGLE_CLIENT_ID"] or None,
            "dev_auth_enabled": bool(current_app.config["DEV_AUTH_ENABLED"]),
        }
    )


@api.post("/auth/google")
def google_login():
    credential = (request.get_json(silent=True) or {}).get("credential")
    client_id = current_app.config["GOOGLE_CLIENT_ID"]
    if not client_id:
        return error("google_not_configured", "Set GOOGLE_CLIENT_ID in backend/.env.", 503)
    if not credential:
        return error("missing_credential", "Google did not return a credential.")
    try:
        claims = id_token.verify_oauth2_token(credential, google_requests.Request(), client_id)
    except ValueError:
        return error("invalid_google_credential", "Google sign-in could not be verified.", 401)
    if not claims.get("email_verified"):
        return error("unverified_email", "A verified Google email is required.", 401)
    user = _upsert_google_user(claims)
    response = make_response(jsonify({"user": serialize_user(user)}))
    return issue_auth_cookies(response, user)


@api.post("/auth/dev")
def dev_login():
    if not current_app.config["DEV_AUTH_ENABLED"]:
        return error("not_found", "Development sign-in is disabled.", 404)
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "detective@localhost.test").strip().lower()
    display_name = (payload.get("display_name") or "Local Detective").strip()[:120]
    user = User.query.filter_by(email=email).first()
    if not user:
        user = User(email=email, display_name=display_name)
        db.session.add(user)
        db.session.flush()
        story_progress_for(user)
        db.session.commit()
    response = make_response(jsonify({"user": serialize_user(user)}))
    return issue_auth_cookies(response, user)


@api.post("/auth/logout")
@require_auth
def logout():
    if g.auth_session:
        g.auth_session.revoked_at = utcnow()
        db.session.commit()
    return clear_auth_cookies(make_response(jsonify({"ok": True})))


@api.get("/me")
@require_auth
def me():
    payload = serialize_user(g.current_user)
    db.session.commit()
    return jsonify({"user": payload})


@api.patch("/me/preferences")
@require_auth
def preferences():
    payload = request.get_json(silent=True) or {}
    try:
        target = int(payload.get("target_minutes"))
    except (TypeError, ValueError):
        return error("invalid_target", "Choose a daily session between 20 and 60 minutes.")
    if target < 20 or target > 60:
        return error("invalid_target", "Choose a daily session between 20 and 60 minutes.")
    g.current_user.target_minutes = target
    g.current_user.onboarding_complete = True
    db.session.commit()
    return jsonify({"user": serialize_user(g.current_user)})


@api.get("/diagnostics/current")
@require_auth
def current_diagnostic():
    session = (
        StudySession.query.filter_by(user_id=g.current_user.id, mode="diagnostic")
        .order_by(StudySession.started_at.desc())
        .first()
    )
    if not session:
        return jsonify({"status": "not_started", "session": None, "results": None})
    if session.status == "completed":
        return jsonify({"status": "completed", "session": serialize_session(session, False), "results": session.summary_json})
    return jsonify({"status": "in_progress", "session": serialize_session(session), "results": None})


@api.post("/diagnostics")
@require_auth
def start_diagnostic():
    if not g.current_user.onboarding_complete:
        return error("onboarding_required", "Choose a daily study target first.", 409)
    completed = StudySession.query.filter_by(user_id=g.current_user.id, mode="diagnostic", status="completed").first()
    if completed:
        return jsonify({"session": serialize_session(completed, False), "results": completed.summary_json})
    try:
        session = create_study_session(g.current_user, "diagnostic")
    except RuntimeError:
        return error("content_unavailable", "No reviewed and licensed diagnostic content is available.", 503)
    return jsonify({"session": serialize_session(session)}), 201


@api.post("/study-sessions")
@require_auth
def start_daily_session():
    diagnostic = StudySession.query.filter_by(user_id=g.current_user.id, mode="diagnostic", status="completed").first()
    if not diagnostic:
        return error("diagnostic_required", "Complete the diagnostic before opening daily case files.", 409)
    try:
        session = create_study_session(g.current_user, "daily")
    except RuntimeError:
        return error("content_unavailable", "No reviewed and licensed case content is available.", 503)
    return jsonify({"session": serialize_session(session)}), 201


def _owned_session(session_id: str) -> StudySession | None:
    return StudySession.query.filter_by(id=session_id, user_id=g.current_user.id).first()


@api.get("/study-sessions/<session_id>")
@require_auth
def get_session(session_id: str):
    session = _owned_session(session_id)
    if not session:
        return error("session_not_found", "That case session was not found.", 404)
    payload = {"session": serialize_session(session)}
    if session.status == "completed":
        payload["summary"] = session.summary_json or calculate_session_summary(session)
    return jsonify(payload)


@api.post("/study-sessions/<session_id>/attempts")
@require_auth
def create_attempt(session_id: str):
    session = _owned_session(session_id)
    if not session:
        return error("session_not_found", "That case session was not found.", 404)
    payload = request.get_json(silent=True) or {}
    idempotency_key = request.headers.get("Idempotency-Key") or payload.get("idempotency_key")
    if not idempotency_key:
        idempotency_key = str(uuid.uuid4())
    if len(idempotency_key) > 80:
        return error("invalid_idempotency_key", "The request identifier is too long.")
    try:
        attempt, duplicate = submit_attempt(g.current_user, session, payload, idempotency_key)
    except ValueError as exc:
        code = str(exc)
        messages = {
            "idempotency_conflict": "That request identifier was already used.",
            "session_complete": "This session is already complete.",
            "invalid_session_item": "This is not the active question. Refresh to resume safely.",
            "invalid_choice": "Choose one of the available answers.",
            "reasoning_required": "Add at least one or two sentences of reasoning before filing this answer.",
        }
        status = 409 if code in {"idempotency_conflict", "session_complete", "invalid_session_item"} else 400
        return error(code, messages.get(code, "The attempt could not be saved."), status)
    return jsonify({"result": serialize_attempt_result(attempt, duplicate)})


@api.post("/attempts/<attempt_id>/coaching")
@require_auth
def coach_attempt(attempt_id: str):
    attempt = Attempt.query.filter_by(id=attempt_id, user_id=g.current_user.id).first()
    if not attempt:
        return error("attempt_not_found", "That filed answer was not found.", 404)
    if not provider_ready():
        return error("coaching_not_configured", "TrueFoundry coaching is not configured.", 503)
    try:
        coaching = run_attempt_coaching(attempt)
    except ValueError as exc:
        if str(exc) == "coaching_in_progress":
            return error("coaching_in_progress", "The AI coach is already reviewing this explanation.", 409)
        raise
    except CoachingProviderError as exc:
        return error("coaching_failed", str(exc), 502)
    return jsonify({"status": "completed", "coaching": coaching})


@api.post("/study-sessions/<session_id>/items/<item_id>/hints")
@require_auth
def create_hint(session_id: str, item_id: str):
    session = _owned_session(session_id)
    if not session:
        return error("session_not_found", "That case session was not found.", 404)
    item = SessionItem.query.filter_by(id=item_id, session_id=session.id).first()
    if not item or session.status != "in_progress" or item.position != session.current_index:
        return error("invalid_session_item", "Hints are available only for the active evidence file.", 409)
    if item.attempt:
        return error("answer_already_filed", "This answer has already been filed.", 409)
    if not provider_ready():
        return error("coaching_not_configured", "TrueFoundry coaching is not configured.", 503)
    try:
        hint = request_item_hint(g.current_user, item)
    except ValueError as exc:
        if str(exc) == "hint_limit_reached":
            return error("hint_limit_reached", "All three controlled hints have been used.", 409)
        raise
    except CoachingProviderError as exc:
        return error("hint_failed", str(exc), 502)
    return jsonify({"hint": hint})


@api.get("/study-sessions/<session_id>/summary")
@require_auth
def session_summary(session_id: str):
    session = _owned_session(session_id)
    if not session:
        return error("session_not_found", "That case session was not found.", 404)
    if session.status != "completed":
        return error("session_in_progress", "Finish the session to open its debrief.", 409)
    if not session.summary_json:
        session.summary_json = calculate_session_summary(session)
        db.session.commit()
    return jsonify({"summary": session.summary_json, "session": serialize_session(session, False)})


@api.get("/progress")
@require_auth
def progress():
    payload = progress_dashboard(g.current_user)
    db.session.commit()
    return jsonify(payload)
