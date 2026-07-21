from __future__ import annotations

import uuid

from flask import Blueprint, current_app, g, jsonify, make_response, request
from google.auth.exceptions import GoogleAuthError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from .auth import clear_auth_cookies, issue_auth_cookies, require_auth
from .coaching import CoachingProviderError, provider_ready
from .extensions import db
from .models import Attempt, Question, SessionItem, StudySession, User, utcnow
from .services import (
    archive_case_detail,
    archive_cases,
    boss_case_status,
    calculate_session_summary,
    cold_case_dashboard,
    create_study_session,
    enrich_item_story,
    pause_study_session,
    progress_dashboard,
    public_item_story,
    request_item_hint,
    resume_study_session,
    run_attempt_coaching,
    serialize_attempt_result,
    serialize_session,
    serialize_user,
    story_progress_for,
    story_dashboard,
    start_item_timer,
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
            display_name=(claims.get("name") or claims["email"].split("@")[0])[:120],
            avatar_url=claims.get("picture"),
        )
        db.session.add(user)
    else:
        if user.google_sub and user.google_sub != claims["sub"]:
            raise ValueError("google_identity_conflict")
        user.google_sub = claims["sub"]
        user.display_name = (claims.get("name") or user.display_name)[:120]
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
    except GoogleAuthError:
        return error("google_unavailable", "Google sign-in could not be reached. Please try again.", 503)
    subject = claims.get("sub")
    email_address = claims.get("email")
    if not isinstance(subject, str) or not subject or len(subject) > 255:
        return error("invalid_google_credential", "Google sign-in did not include a valid account identifier.", 401)
    if not isinstance(email_address, str) or not email_address or len(email_address) > 320:
        return error("invalid_google_credential", "Google sign-in did not include a valid email address.", 401)
    if claims.get("email_verified") not in {True, "true"}:
        return error("unverified_email", "A verified Google email is required.", 401)
    try:
        user = _upsert_google_user(claims)
    except ValueError as exc:
        if str(exc) == "google_identity_conflict":
            return error("google_identity_conflict", "That email is already linked to a different Google account.", 409)
        raise
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
        if session.pending_attempt_id:
            return jsonify({"status": "debrief", "session": serialize_session(session), "results": None})
        return jsonify({"status": "completed", "session": serialize_session(session, False), "results": session.summary_json})
    return jsonify({"status": session.status, "session": serialize_session(session), "results": None})


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
    if diagnostic.pending_attempt_id:
        return error("debrief_required", "Finish the final diagnostic debrief before opening daily case files.", 409)
    if not g.current_user.story_intro_seen:
        return error("story_introduction_required", "Enter the Lantern Bureau story before opening daily case files.", 409)
    pending_daily = (
        StudySession.query.filter(
            StudySession.user_id == g.current_user.id,
            StudySession.mode == "daily",
            StudySession.pending_attempt_id.isnot(None),
        )
        .order_by(StudySession.started_at.desc())
        .first()
    )
    if pending_daily:
        return error("debrief_required", f"Finish the pending case debrief at /study/{pending_daily.id}.", 409)
    unseen_summary = (
        StudySession.query.filter_by(user_id=g.current_user.id, mode="daily", status="completed", summary_seen_at=None)
        .order_by(StudySession.completed_at.desc())
        .first()
    )
    if unseen_summary:
        return error("summary_required", f"Review the saved session summary at /session/{unseen_summary.id}/summary.", 409)
    try:
        session = create_study_session(g.current_user, "daily")
    except RuntimeError:
        return error("content_unavailable", "No reviewed and licensed case content is available.", 503)
    return jsonify({"session": serialize_session(session)}), 201


@api.get("/cold-cases")
@require_auth
def cold_cases():
    payload = cold_case_dashboard(g.current_user)
    db.session.commit()
    return jsonify(payload)


@api.post("/review-sessions")
@require_auth
def start_review_session():
    diagnostic = StudySession.query.filter_by(
        user_id=g.current_user.id,
        mode="diagnostic",
        status="completed",
    ).first()
    if not diagnostic:
        return error("diagnostic_required", "Complete the diagnostic before reopening cold cases.", 409)
    cold_case_dashboard(g.current_user)
    try:
        session = create_study_session(g.current_user, "review")
    except RuntimeError:
        return error("no_cold_cases", "No cold cases are due for review.", 409)
    return jsonify({"session": serialize_session(session)}), 201


@api.get("/boss-case")
@require_auth
def boss_case():
    return jsonify(boss_case_status(g.current_user))


@api.post("/boss-sessions")
@require_auth
def start_boss_session():
    status = boss_case_status(g.current_user)
    if status["active_session_id"]:
        session = _owned_session(status["active_session_id"])
        return jsonify({"session": serialize_session(session)})
    if not status["available"]:
        return error("boss_locked", "Close more daily cases before confronting Professor Quill.", 409)
    try:
        session = create_study_session(g.current_user, "boss")
    except RuntimeError:
        return error("content_unavailable", "No boss-case evidence is available.", 503)
    return jsonify({"session": serialize_session(session)}), 201


def _owned_session(session_id: str) -> StudySession | None:
    return StudySession.query.filter_by(id=session_id, user_id=g.current_user.id).first()


@api.get("/study-sessions/current")
@require_auth
def current_study_session():
    mode = request.args.get("mode", "daily")
    if mode not in {"daily", "diagnostic"}:
        return error("invalid_mode", "Session mode must be daily or diagnostic.")
    session = (
        StudySession.query.filter(
            StudySession.user_id == g.current_user.id,
            StudySession.mode == mode,
            StudySession.status.in_(["in_progress", "paused"]),
        )
        .order_by(StudySession.started_at.desc())
        .first()
    )
    return jsonify({"session": serialize_session(session, False) if session else None})


@api.patch("/study-sessions/<session_id>/items/<item_id>/draft")
@require_auth
def save_item_draft(session_id: str, item_id: str):
    session = _owned_session(session_id)
    if not session:
        return error("session_not_found", "That case session was not found.", 404)
    if session.pending_attempt_id:
        return error("debrief_required", "Finish the current debrief before opening the next evidence file.", 409)
    item = SessionItem.query.filter_by(id=item_id, session_id=session.id).first()
    if session.status not in {"in_progress", "paused"} or not item or item.position != session.current_index or item.completed_at:
        return error("invalid_session_item", "Drafts can only be saved for the active evidence file.", 409)
    payload = request.get_json(silent=True) or {}
    selected = (payload.get("selected_label") or "").strip().upper() or None
    valid_labels = {choice.label for choice in item.question.choices}
    if selected and selected not in valid_labels:
        return error("invalid_choice", "Choose one of the available answers.")
    reasoning = str(payload.get("reasoning") or "")[:4000]
    item.draft_selected_label = selected
    item.draft_reasoning_text = reasoning or None
    item.draft_updated_at = utcnow()
    db.session.commit()
    return jsonify(
        {
            "saved": True,
            "draft": {
                "selected_label": item.draft_selected_label,
                "reasoning": item.draft_reasoning_text or "",
                "updated_at": item.draft_updated_at.isoformat(),
            },
        }
    )


@api.post("/study-sessions/<session_id>/items/<item_id>/timer/start")
@require_auth
def start_evidence_timer(session_id: str, item_id: str):
    session = _owned_session(session_id)
    if not session:
        return error("session_not_found", "That case session was not found.", 404)
    item = SessionItem.query.filter_by(id=item_id, session_id=session.id).first()
    if not item:
        return error("invalid_session_item", "That evidence file was not found.", 404)
    try:
        start_item_timer(session, item)
    except ValueError as exc:
        if str(exc) == "debrief_required":
            return error("debrief_required", "Finish the current debrief before opening the next evidence file.", 409)
        return error("invalid_session_item", "Only the active evidence file can start its timer.", 409)
    return jsonify({"item": serialize_session(session)["current_item"]})


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


@api.post("/study-sessions/<session_id>/pause")
@require_auth
def pause_session(session_id: str):
    session = _owned_session(session_id)
    if not session:
        return error("session_not_found", "That case session was not found.", 404)
    try:
        pause_study_session(session)
    except ValueError:
        return error("session_complete", "This session is already complete.", 409)
    return jsonify({"session": serialize_session(session, False)})


@api.post("/study-sessions/<session_id>/resume")
@require_auth
def resume_session(session_id: str):
    session = _owned_session(session_id)
    if not session:
        return error("session_not_found", "That case session was not found.", 404)
    try:
        resume_study_session(session)
    except ValueError:
        return error("session_complete", "This session is already complete.", 409)
    return jsonify({"session": serialize_session(session)})


@api.post("/study-sessions/<session_id>/debrief/acknowledge")
@require_auth
def acknowledge_debrief(session_id: str):
    session = _owned_session(session_id)
    if not session:
        return error("session_not_found", "That case session was not found.", 404)
    session.pending_attempt_id = None
    db.session.commit()
    return jsonify({"session": serialize_session(session)})


@api.post("/study-sessions/<session_id>/summary/acknowledge")
@require_auth
def acknowledge_summary(session_id: str):
    session = _owned_session(session_id)
    if not session:
        return error("session_not_found", "That case session was not found.", 404)
    if session.status != "completed":
        return error("session_in_progress", "Finish the session before acknowledging its summary.", 409)
    session.summary_seen_at = utcnow()
    db.session.commit()
    return jsonify({"ok": True})


@api.post("/story/introduction/complete")
@require_auth
def complete_story_introduction():
    diagnostic = StudySession.query.filter_by(user_id=g.current_user.id, mode="diagnostic", status="completed").first()
    if not diagnostic:
        return error("diagnostic_required", "Complete the diagnostic before entering the story.", 409)
    if diagnostic.pending_attempt_id:
        return error("debrief_required", "Finish the final diagnostic debrief before entering the Bureau.", 409)
    entering_story_for_first_time = not g.current_user.story_intro_seen
    g.current_user.story_intro_seen = True
    diagnostic.results_seen_at = diagnostic.results_seen_at or utcnow()
    if entering_story_for_first_time:
        story = story_progress_for(g.current_user)
        story_state = dict(story.state_json or {})
        story_state.update(
            {
                "active_chapter_title": "Chapter 1: The Compass in Shadow",
                "last_case_title": "The Lantern Trials",
                "last_location_id": "lantern_atrium",
                "last_hook": (
                    "Chief Voss has opened your first assignment: trace the vanished premise "
                    "before Professor Quill's false trail reaches the city record."
                ),
                "featured_cast": ["rowan_vale", "mira_voss", "mori_quill"],
                "last_outcome": "recruited",
            }
        )
        story.state_json = story_state
    db.session.commit()
    return jsonify({"user": serialize_user(g.current_user)})


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
            "debrief_required": "Finish the current debrief before filing the next answer.",
            "session_complete": "This session is already complete.",
            "invalid_session_item": "This is not the active question. Refresh to resume safely.",
            "invalid_choice": "Choose one of the available answers.",
            "reasoning_required": "Add at least one or two sentences of reasoning before filing this answer.",
            "evidence_not_started": "Open the evidence file to start its scored timer before answering.",
        }
        status = 409 if code in {"idempotency_conflict", "debrief_required", "session_complete", "invalid_session_item"} else 400
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
    if session.mode == "diagnostic":
        return error("hints_disabled", "Hints are disabled during the baseline diagnostic.", 409)
    if session.pending_attempt_id:
        return error("debrief_required", "Finish the current debrief before requesting another hint.", 409)
    item = SessionItem.query.filter_by(id=item_id, session_id=session.id).first()
    if not item or session.status != "in_progress" or item.position != session.current_index:
        return error("invalid_session_item", "Hints are available only for the active evidence file.", 409)
    if item.attempt:
        return error("answer_already_filed", "This answer has already been filed.", 409)
    if not item.timer_activated_at:
        return error("evidence_not_started", "Open the evidence file before requesting a hint.", 409)
    if not provider_ready():
        return error("coaching_not_configured", "TrueFoundry coaching is not configured.", 503)
    try:
        hint = request_item_hint(g.current_user, item)
    except ValueError as exc:
        if str(exc) == "hint_limit_reached":
            return error("hint_limit_reached", "All three controlled hints have been used.", 409)
        if str(exc) == "answer_already_filed":
            return error("answer_already_filed", "The answer was filed before this hint finished.", 409)
        raise
    except CoachingProviderError as exc:
        return error("hint_failed", str(exc), 502)
    return jsonify({"hint": hint})


@api.post("/study-sessions/<session_id>/items/<item_id>/story")
@require_auth
def generate_item_story(session_id: str, item_id: str):
    session = _owned_session(session_id)
    if not session:
        return error("session_not_found", "That case session was not found.", 404)
    item = SessionItem.query.filter_by(id=item_id, session_id=session.id).first()
    pending_item_id = None
    if session.pending_attempt_id:
        pending_attempt = db.session.get(Attempt, session.pending_attempt_id)
        pending_item_id = pending_attempt.session_item_id if pending_attempt else None
    is_current = item and item.position == session.current_index
    if not item or (pending_item_id and item.id != pending_item_id) or (not pending_item_id and not is_current):
        return error("invalid_session_item", "Story generation is available for the active evidence file.", 409)
    beat = enrich_item_story(g.current_user, item)
    return jsonify({"story": public_item_story(item, beat)})


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


@api.get("/archive")
@require_auth
def case_archive():
    try:
        page = max(1, int(request.args.get("page", 1)))
        per_page = max(1, min(50, int(request.args.get("per_page", 20))))
    except (TypeError, ValueError):
        return error("invalid_pagination", "Page values must be numbers.")
    return jsonify(
        archive_cases(
            g.current_user,
            correctness=request.args.get("correctness") or None,
            section=request.args.get("section") or None,
            question_type=request.args.get("question_type") or None,
            page=page,
            per_page=per_page,
        )
    )


@api.get("/archive/<attempt_id>")
@require_auth
def case_archive_detail(attempt_id: str):
    payload = archive_case_detail(g.current_user, attempt_id)
    if not payload:
        return error("case_not_found", "That archived case was not found.", 404)
    return jsonify(payload)


@api.get("/story/progress")
@require_auth
def story_progress():
    payload = story_dashboard(g.current_user)
    db.session.commit()
    return jsonify(payload)
