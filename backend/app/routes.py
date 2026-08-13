from __future__ import annotations

import uuid

from flask import Blueprint, current_app, g, jsonify, make_response, request
from google.auth.exceptions import GoogleAuthError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from .auth import clear_auth_cookies, issue_auth_cookies, issue_mobile_token, require_auth
from .coaching import CoachingProviderError, provider_ready
from .enforcement import GateRejection
from . import history
from .extensions import db
from .game import (
    activate_quest,
    advance_firm,
    claim_daily_reward,
    choose_story,
    collect_passive_income,
    create_profile,
    pending_review_attempts,
    purchase_asset,
    run_rival_operation,
    secure_district,
    select_client,
    set_wardrobe,
    settle_upkeep_for_user,
    serialize_game,
    serialize_settlement,
    serialize_wardrobe,
    update_profile,
)
from .history import attempt_detail, attempt_history, history_facets, session_history
from .jobs import (
    JobQueueError,
    async_jobs_enabled,
    enqueue_coaching_job,
    queue_ready,
    serialize_job,
)
from .models import AiJob, Attempt, Question, SessionItem, StudySession, User, utcnow
from .scoring import projection_snapshot
from .seed import SOURCE_PREFIX
from .story import ensure_story_state
from .services import (
    abandon_study_session,
    answers_available,
    UNGRADED_COACHING_NOTICE,
    calculate_session_summary,
    coaching_handed_off,
    create_blind_review_session,
    create_diagnostic_session,
    create_study_session,
    daily_docket_snapshot,
    eligible_question_count,
    find_active_diagnostic,
    find_resumable_session,
    list_resumable_sessions,
    pause_study_session,
    performance_snapshot,
    resume_study_session,
    review_queue_snapshot,
    run_attempt_coaching,
    serialize_attempt_result,
    serialize_session,
    session_review,
    serialize_user,
    submit_attempt,
    trial_plan_snapshot,
    update_user_preferences,
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
    db.session.commit()
    return user


def _verified_google_claims(credential: str, *, allow_mobile_audiences: bool = False):
    client_id = current_app.config["GOOGLE_CLIENT_ID"]
    if not client_id:
        return None, error("google_not_configured", "Set GOOGLE_CLIENT_ID in backend/.env.", 503)
    if not credential:
        return None, error("missing_credential", "Google did not return a credential.")
    accepted_audiences = {client_id}
    if allow_mobile_audiences:
        accepted_audiences.update(current_app.config["GOOGLE_MOBILE_CLIENT_IDS"])
    try:
        # Verify Google's signature and issuer first. Audience is checked below
        # so the native endpoint can accept explicitly configured iOS/Android
        # OAuth client IDs without weakening the browser endpoint.
        claims = id_token.verify_oauth2_token(credential, google_requests.Request(), audience=None)
    except ValueError:
        return None, error("invalid_google_credential", "Google sign-in could not be verified.", 401)
    except GoogleAuthError:
        return None, error("google_unavailable", "Google sign-in could not be reached. Please try again.", 503)
    if claims.get("aud") not in accepted_audiences:
        return None, error("invalid_google_credential", "Google sign-in was issued for a different application.", 401)
    subject = claims.get("sub")
    email_address = claims.get("email")
    if not isinstance(subject, str) or not subject or len(subject) > 255:
        return None, error("invalid_google_credential", "Google did not provide a valid account identifier.", 401)
    if not isinstance(email_address, str) or not email_address or len(email_address) > 320:
        return None, error("invalid_google_credential", "Google did not provide a valid email address.", 401)
    if claims.get("email_verified") not in {True, "true"}:
        return None, error("unverified_email", "A verified Google email is required.", 401)
    return claims, None


def _mobile_auth_response(user: User):
    token, expires_at = issue_mobile_token(user)
    return jsonify(
        {
            "user": serialize_user(user),
            "access_token": token,
            "expires_at": expires_at.isoformat(),
        }
    )


@api.get("/health")
def health():
    lr_count = Question.query.filter(
        Question.source.like(f"{SOURCE_PREFIX}%"),
        Question.section == "Logical Reasoning",
    ).count()
    rc_count = Question.query.filter(
        Question.source.like(f"{SOURCE_PREFIX}%"),
        Question.section == "Reading Comprehension",
    ).count()
    return jsonify(
        {
            "status": "ok",
            "questions": {"total": lr_count + rc_count, "lr": lr_count, "rc": rc_count},
            "datasets": ["tasksource/lsat-lr", "tasksource/lsat-rc"],
            "coaching": {
                "ready": provider_ready(),
                "model": current_app.config["COACHING_MODEL"],
                "reasoning_effort": current_app.config["COACHING_REASONING_EFFORT"],
            },
            "async_jobs": {
                "mode": current_app.config["AI_JOBS_MODE"],
                "ready": queue_ready() if async_jobs_enabled() else True,
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
    claims, failure = _verified_google_claims(credential)
    if failure:
        return failure
    try:
        user = _upsert_google_user(claims)
    except ValueError as exc:
        if str(exc) == "google_identity_conflict":
            return error(
                "google_identity_conflict",
                "That email is already linked to a different Google account.",
                409,
            )
        raise
    response = make_response(jsonify({"user": serialize_user(user)}))
    return issue_auth_cookies(response, user)


@api.post("/auth/mobile/google")
def mobile_google_login():
    """Exchange a verified Google credential for a revocable device token."""

    credential = (request.get_json(silent=True) or {}).get("credential")
    claims, failure = _verified_google_claims(credential, allow_mobile_audiences=True)
    if failure:
        return failure
    try:
        user = _upsert_google_user(claims)
    except ValueError as exc:
        if str(exc) == "google_identity_conflict":
            return error(
                "google_identity_conflict",
                "That email is already linked to a different Google account.",
                409,
            )
        raise
    return _mobile_auth_response(user)


@api.post("/auth/dev")
def dev_login():
    if not current_app.config["DEV_AUTH_ENABLED"]:
        return error("not_found", "Development sign-in is disabled.", 404)
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "student@localhost.test").strip().lower()
    display_name = (payload.get("display_name") or "Local Student").strip()[:120]
    user = User.query.filter_by(email=email).first()
    if not user:
        user = User(email=email, display_name=display_name)
        db.session.add(user)
        db.session.commit()
    response = make_response(jsonify({"user": serialize_user(user)}))
    return issue_auth_cookies(response, user)


@api.post("/auth/mobile/dev")
def mobile_dev_login():
    """Local-only mobile bootstrap. This endpoint is unavailable in production."""

    if not current_app.config["DEV_AUTH_ENABLED"]:
        return error("not_found", "Development sign-in is disabled.", 404)
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "student@localhost.test").strip().lower()
    display_name = (payload.get("display_name") or "Local Student").strip()[:120]
    user = User.query.filter_by(email=email).first()
    if not user:
        user = User(email=email, display_name=display_name)
        db.session.add(user)
        db.session.commit()
    return _mobile_auth_response(user)


@api.post("/auth/logout")
@require_auth
def logout():
    g.auth_session.revoked_at = utcnow()
    db.session.commit()
    return clear_auth_cookies(make_response(jsonify({"ok": True})))


@api.get("/me")
@require_auth
def me():
    return jsonify({"user": serialize_user(g.current_user)})


@api.patch("/me")
@require_auth
def update_me():
    payload = request.get_json(silent=True) or {}
    try:
        user = update_user_preferences(g.current_user, payload)
    except ValueError as exc:
        code = str(exc)
        messages = {
            "invalid_target_score": "Enter a target score between 120 and 180.",
            "invalid_target_test_date": "Enter a valid test date.",
            "invalid_assistance_level": "Assistance level must be 'full' or 'focus'.",
        }
        return error(code, messages.get(code, "Those preferences could not be saved."), 400)
    return jsonify({"user": serialize_user(user)})


def _game_profile():
    """The account's firm, settled up to now, in one locking statement."""
    return settle_upkeep_for_user(g.current_user.id)


@api.get("/game")
@require_auth
def game_state():
    profile = _game_profile()
    return jsonify(
        {
            "game": serialize_game(profile) if profile else None,
            "pending_reviews": pending_review_attempts(g.current_user.id) if profile else [],
        }
    )


@api.post("/game/profile")
@require_auth
def start_game_profile():
    try:
        profile = create_profile(g.current_user, request.get_json(silent=True) or {})
    except ValueError as exc:
        code = str(exc)
        messages = {
            "profile_exists": "Your law firm has already been created.",
            "invalid_character": "Choose the male or female character.",
            "invalid_name": "Enter a name between 2 and 80 characters.",
        }
        return error(code, messages.get(code, "The firm could not be created."), 409 if code == "profile_exists" else 400)
    return jsonify({"game": serialize_game(profile), "pending_reviews": []}), 201


@api.patch("/game/profile")
@require_auth
def edit_game_profile():
    profile = _game_profile()
    if not profile:
        return error("onboarding_required", "Create your lawyer before editing the firm.", 409)
    try:
        update_profile(profile, request.get_json(silent=True) or {})
    except ValueError as exc:
        code = str(exc)
        return error(code, "Choose a valid character and names between 2 and 80 characters.")
    return jsonify({"game": serialize_game(profile)})


def _game_error(code: str):
    messages = {
        "asset_not_found": "That firm item does not exist.",
        "already_owned": "Your firm already owns that item.",
        "requirements_not_met": "Your firm does not meet the listed requirements yet.",
        "insufficient_cash": "Your firm does not have enough cash for that purchase.",
        "maximum_tier": "Your firm has already reached the highest tier.",
        "invalid_target_tier": "Firm tiers must be unlocked in order.",
        "client_not_found": "That client is not available.",
        "invalid_milestone": "That daily goal does not exist.",
        "already_claimed": "That daily reward has already been claimed.",
        "goal_incomplete": "Complete the daily goal before claiming its reward.",
        "chapter_not_pending": "That chapter is not the firm's current story decision.",
        "choice_not_found": "Choose one of the available responses.",
        "quest_not_found": "That caseboard file does not exist.",
        "quest_already_active": "Finish the active caseboard file before opening another.",
        "quest_already_completed": "That caseboard file has already been closed.",
        "quest_locked": "That caseboard file is still sealed. Play its chapter and close the file before it to open it.",
        "insufficient_intel": "The firm needs more Intel to open that shadow file.",
        "operation_not_found": "That rival operation does not exist.",
        "operation_already_completed": "That operation has already been used against this rival.",
        "operation_requirements_not_met": "The firm does not meet this operation's cash or intelligence requirements.",
        "rival_not_found": "That rival firm does not exist.",
        "rival_already_owned": "That rival has already joined your firm.",
        "cosmetic_not_found": "That wardrobe piece does not exist.",
        "cosmetic_category_not_found": "That wardrobe category does not exist.",
        "cosmetic_locked": "Your counsel has not earned that piece yet.",
        "invalid_cosmetic": "Send a wardrobe category and the piece to wear.",
        "district_not_found": "That district is not on the map.",
        "district_already_held": "Your firm already holds that district's retainer.",
        "district_locked": "That district will not sign with a firm of this standing yet.",
    }
    status = 404 if code in {
        "asset_not_found",
        "client_not_found",
        "quest_not_found",
        "rival_not_found",
        "operation_not_found",
        "cosmetic_not_found",
        "cosmetic_category_not_found",
        "district_not_found",
    } else 409
    if code == "invalid_cosmetic":
        status = 400
    return error(code, messages.get(code, "That game action could not be completed."), status)


@api.post("/game/purchases")
@require_auth
def buy_game_asset():
    profile = _game_profile()
    if not profile:
        return error("onboarding_required", "Create your lawyer before making purchases.", 409)
    asset_key = str((request.get_json(silent=True) or {}).get("asset_key") or "")
    try:
        purchase_asset(profile, asset_key)
    except ValueError as exc:
        return _game_error(str(exc))
    return jsonify({"game": serialize_game(profile)})


@api.post("/game/territory")
@require_auth
def secure_game_district():
    profile = _game_profile()
    if not profile:
        return error("onboarding_required", "Create your lawyer before taking on districts.", 409)
    district_key = str((request.get_json(silent=True) or {}).get("district_key") or "")
    try:
        result = secure_district(profile, district_key)
    except ValueError as exc:
        return _game_error(str(exc))
    return jsonify({"retainer": result, "game": serialize_game(profile)})


@api.get("/trial")
@require_auth
def trial_calendar():
    return jsonify(trial_plan_snapshot(g.current_user))


@api.get("/game/cosmetics")
@require_auth
def game_cosmetics():
    profile = _game_profile()
    if not profile:
        return error("onboarding_required", "Create your lawyer before opening the wardrobe.", 409)
    return jsonify({"cosmetics": serialize_wardrobe(profile)})


@api.patch("/game/cosmetics")
@require_auth
def edit_game_cosmetics():
    profile = _game_profile()
    if not profile:
        return error("onboarding_required", "Create your lawyer before opening the wardrobe.", 409)
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return _game_error("invalid_cosmetic")
    try:
        set_wardrobe(profile, payload.get("selection") if isinstance(payload.get("selection"), dict) else payload)
    except ValueError as exc:
        return _game_error(str(exc))
    return jsonify({"cosmetics": serialize_wardrobe(profile), "game": serialize_game(profile)})


@api.post("/game/advance")
@require_auth
def advance_game_firm():
    profile = _game_profile()
    if not profile:
        return error("onboarding_required", "Create your lawyer before advancing the firm.", 409)
    payload = request.get_json(silent=True) or {}
    try:
        target_tier = int(payload.get("target_tier"))
    except (TypeError, ValueError):
        return error("invalid_target_tier", "Choose the next firm tier.")
    try:
        advance_firm(profile, target_tier)
    except ValueError as exc:
        return _game_error(str(exc))
    return jsonify({"game": serialize_game(profile)})


@api.post("/game/client")
@require_auth
def activate_game_client():
    profile = _game_profile()
    if not profile:
        return error("onboarding_required", "Create your lawyer before choosing clients.", 409)
    client_key = str((request.get_json(silent=True) or {}).get("client_key") or "")
    try:
        select_client(profile, client_key)
    except ValueError as exc:
        return _game_error(str(exc))
    return jsonify({"game": serialize_game(profile)})


@api.post("/game/passive-income/collect")
@require_auth
def collect_game_passive_income():
    profile = _game_profile()
    if not profile:
        return error("onboarding_required", "Create your lawyer before collecting income.", 409)
    amount = collect_passive_income(profile)
    return jsonify({"collected": amount, "game": serialize_game(profile)})


@api.post("/game/daily-rewards/<int:milestone>/claim")
@require_auth
def claim_game_daily_reward(milestone: int):
    profile = _game_profile()
    if not profile:
        return error("onboarding_required", "Create your lawyer before claiming rewards.", 409)
    try:
        amount = claim_daily_reward(profile, milestone)
    except ValueError as exc:
        return _game_error(str(exc))
    return jsonify({"claimed": amount, "game": serialize_game(profile)})


@api.post("/game/story/choice")
@require_auth
def choose_game_story():
    profile = _game_profile()
    if not profile:
        return error("onboarding_required", "Create your lawyer before entering the campaign.", 409)
    payload = request.get_json(silent=True) or {}
    try:
        result = choose_story(profile, str(payload.get("chapter_key") or ""), str(payload.get("choice_key") or ""))
    except ValueError as exc:
        return _game_error(str(exc))
    return jsonify({"result": result, "game": serialize_game(profile)})


@api.get("/game/story/epilogue")
@require_auth
def get_game_epilogue_acknowledgement():
    """Whether this account has already read the closing record.

    Additive and deliberately tiny: the epilogue is a full-screen once-ever
    layer, and the frontend used to remember "already read" in localStorage
    alone, so a finished player met the whole final record again on a second
    device or after clearing site data. This is the same policy the guided tour
    already follows with `users.guided_tour_completed_at`, kept out of the game
    serializer so the change stays confined to these two endpoints.
    """
    profile = _game_profile()
    state = profile.story_state if profile else None
    return jsonify({"read": bool(state and state.epilogue_read_at)})


@api.post("/game/story/epilogue/read")
@require_auth
def mark_game_epilogue_read():
    """Record that the closing record has been read. Idempotent; first read wins."""
    profile = _game_profile()
    if not profile:
        return error("onboarding_required", "Create your lawyer before closing the campaign.", 409)
    state = ensure_story_state(profile)
    if state.epilogue_read_at is None:
        state.epilogue_read_at = utcnow()
    db.session.commit()
    return jsonify({"read": True})


@api.post("/game/quests/start")
@require_auth
def start_game_quest():
    profile = _game_profile()
    if not profile:
        return error("onboarding_required", "Create your lawyer before opening the caseboard.", 409)
    quest_key = str((request.get_json(silent=True) or {}).get("quest_key") or "")
    try:
        result = activate_quest(profile, quest_key)
    except ValueError as exc:
        return _game_error(str(exc))
    return jsonify({"result": result, "game": serialize_game(profile)})


@api.post("/game/rival-operations")
@require_auth
def launch_game_rival_operation():
    profile = _game_profile()
    if not profile:
        return error("onboarding_required", "Create your lawyer before planning rival operations.", 409)
    payload = request.get_json(silent=True) or {}
    try:
        result = run_rival_operation(
            profile,
            str(payload.get("rival_key") or ""),
            str(payload.get("operation_key") or ""),
        )
    except ValueError as exc:
        return _game_error(str(exc))
    return jsonify({"result": result, "game": serialize_game(profile)})


def _owned_session(session_id: str) -> StudySession | None:
    return StudySession.query.filter(
        StudySession.id == session_id,
        StudySession.user_id == g.current_user.id,
        StudySession.mode.in_(["practice", "diagnostic", "blind_review"]),
    ).first()


@api.get("/performance")
@require_auth
def get_performance():
    return jsonify({"performance": performance_snapshot(g.current_user)})


@api.get("/projection")
@require_auth
def get_projection():
    """The projected 120-180 score, its band, and the snapshot trend behind it.

    Read-only. Snapshots are written when a run completes, not when this is
    polled — `?record=1` is kept for a caller that explicitly wants to pin a
    point, and nothing in the client uses it.
    """
    record = str(request.args.get("record") or "").strip().lower() in {"1", "true", "yes"}
    return jsonify({"projection": projection_snapshot(g.current_user, record=record)})


@api.get("/history/sessions")
@require_auth
def get_session_history():
    """Every past run, newest first. Paginated — a heavy account has hundreds."""
    try:
        payload = session_history(
            g.current_user,
            limit=request.args.get("limit", 20),
            offset=request.args.get("offset", 0),
            mode=request.args.get("mode"),
        )
    except history.InvalidHistoryParameter as exc:
        return error("invalid_parameter", str(exc), 400)
    return jsonify(payload)


@api.get("/history/attempts")
@require_auth
def get_attempt_history():
    """Previously answered questions, filterable and paginated.

    `detail=1` returns the whole question, the student's written reasoning, and
    the stored coaching alongside each row; the page ceiling drops accordingly.

    A parameter that cannot be understood is a 400 rather than a 200 with the
    default silently substituted — see `history.InvalidHistoryParameter`.
    """
    try:
        payload = attempt_history(
            g.current_user,
            limit=request.args.get("limit", history.DEFAULT_PAGE_SIZE),
            offset=request.args.get("offset", 0),
            correct=request.args.get("correct"),
            question_type=(request.args.get("question_type") or "").strip()[:100] or None,
            section=(request.args.get("section") or "").strip()[:60] or None,
            session_id=(request.args.get("session_id") or "").strip()[:36] or None,
            from_review_queue=request.args.get("from_review_queue"),
            evidence_class=(request.args.get("evidence_class") or "").strip()[:32] or None,
            since=request.args.get("since"),
            until=request.args.get("until"),
            detail=request.args.get("detail"),
        )
    except history.InvalidHistoryParameter as exc:
        return error("invalid_parameter", str(exc), 400)
    return jsonify(payload)


@api.get("/history/attempts/<attempt_id>")
@require_auth
def get_attempt_detail(attempt_id: str):
    payload = attempt_detail(g.current_user, attempt_id)
    if not payload:
        return error("not_found", "That answer is not in your history.", 404)
    return jsonify({"attempt": payload})


@api.get("/history/facets")
@require_auth
def get_history_facets():
    """Which filters this account has data for, so the UI offers no dead ends."""
    return jsonify(history_facets(g.current_user))


@api.get("/diagnostics/current")
@require_auth
def current_diagnostic():
    active = find_active_diagnostic(g.current_user)
    latest = (
        StudySession.query.filter_by(user_id=g.current_user.id, mode="diagnostic", status="completed")
        .order_by(StudySession.completed_at.desc())
        .first()
    )
    return jsonify(
        {
            "session": serialize_session(active) if active else None,
            "latest": (
                {"session": serialize_session(latest, False), "summary": latest.summary_json or calculate_session_summary(latest)}
                if latest
                else None
            ),
        }
    )


@api.post("/diagnostics")
@require_auth
def start_diagnostic():
    if not _game_profile():
        return error("onboarding_required", "Create your profile before starting the diagnostic.", 409)
    if not eligible_question_count():
        return error(
            "content_unavailable",
            "No Hugging Face LSAT questions are loaded. Run `flask seed` first.",
            503,
        )
    payload = request.get_json(silent=True) or {}
    try:
        accommodation = float(payload.get("accommodation_multiplier", 1))
        session = create_diagnostic_session(g.current_user, accommodation_multiplier=accommodation)
    except ValueError as exc:
        if str(exc) == "invalid_accommodation":
            return error("invalid_accommodation", "Choose standard, 1.5×, or 2× diagnostic timing.")
        raise
    return jsonify({"session": serialize_session(session)}), 201


@api.post("/diagnostics/<diagnostic_id>/blind-review")
@require_auth
def start_blind_review(diagnostic_id: str):
    diagnostic = StudySession.query.filter_by(
        id=diagnostic_id,
        user_id=g.current_user.id,
        mode="diagnostic",
    ).first()
    if not diagnostic:
        return error("diagnostic_not_found", "That diagnostic was not found.", 404)
    try:
        session = create_blind_review_session(g.current_user, diagnostic)
    except ValueError as exc:
        code = str(exc)
        messages = {
            "diagnostic_in_progress": "Finish the diagnostic before starting its blind review.",
            "blind_review_not_required": "This diagnostic does not require a blind review.",
        }
        return error(code, messages.get(code, "The blind review could not be started."), 409)
    if session is None:
        return jsonify({"session": None, "blind_review_complete": True})
    return jsonify({"session": serialize_session(session)}), 201


@api.post("/study-sessions")
@require_auth
def start_practice_session():
    if not _game_profile():
        return error("onboarding_required", "Create your lawyer before starting cases.", 409)
    if not eligible_question_count():
        return error(
            "content_unavailable",
            "No Hugging Face LSAT questions are loaded. Run `flask seed` first.",
            503,
        )
    payload = request.get_json(silent=True) or {}
    try:
        requested_size = int(payload.get("size", current_app.config["PRACTICE_SESSION_SIZE"]))
    except (TypeError, ValueError):
        return error("invalid_session_size", "Choose a run between 1 and 50 questions.")
    if requested_size < 1 or requested_size > 50:
        return error("invalid_session_size", "Choose a run between 1 and 50 questions.")
    question_type = str(payload.get("question_type") or "").strip()[:100] or None
    try:
        session = create_study_session(
            g.current_user,
            count=requested_size,
            question_type=question_type,
        )
    except ValueError as exc:
        code = str(exc)
        if code == "queue_full":
            cap = int(current_app.config["PRACTICE_QUEUE_MAX"])
            return error(
                code,
                f"You already have {cap} practice runs queued. Discard one to start another.",
                409,
            )
        messages = {
            "onboarding_required": "Create your lawyer before starting cases.",
        }
        if code in messages:
            return error(code, messages[code], 409)
        raise
    return jsonify({"session": serialize_session(session)}), 201


@api.get("/study-sessions/current")
@require_auth
def current_study_session():
    session = find_resumable_session(g.current_user)
    return jsonify({"session": serialize_session(session) if session else None})


@api.get("/study-sessions/active")
@require_auth
def active_study_sessions():
    """List every queued practice run (in progress, paused, or awaiting a
    debrief) so the Practice tab can render more than one run at a time.

    Diagnostics are intentionally excluded — they remain single-active, per
    `find_active_diagnostic` / `/diagnostics/current`.
    """
    sessions = list_resumable_sessions(g.current_user)
    return jsonify(
        {
            "sessions": [serialize_session(session, False) for session in sessions],
            "queue_cap": int(current_app.config["PRACTICE_QUEUE_MAX"]),
        }
    )


@api.patch("/study-sessions/<session_id>/items/<item_id>/draft")
@require_auth
def save_item_draft(session_id: str, item_id: str):
    session = _owned_session(session_id)
    if not session:
        return error("session_not_found", "That practice session was not found.", 404)
    if session.pending_attempt_id:
        return error("review_required", "Continue after reviewing the current answer.", 409)
    item = SessionItem.query.filter_by(id=item_id, session_id=session.id).first()
    if session.status not in {"in_progress", "paused"} or not item or item.position != session.current_index:
        return error("invalid_session_item", "Drafts can only be saved for the current question.", 409)
    payload = request.get_json(silent=True) or {}
    selected = str(payload.get("selected_label") or "").strip().upper() or None
    if selected and selected not in {choice.label for choice in item.question.choices}:
        return error("invalid_choice", "Choose one of the available answers.")
    item.draft_selected_label = selected
    item.draft_reasoning_text = str(payload.get("reasoning") or "")[:4000] or None
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


@api.get("/study-sessions/<session_id>")
@require_auth
def get_session(session_id: str):
    session = _owned_session(session_id)
    if not session:
        return error("session_not_found", "That practice session was not found.", 404)
    payload = {"session": serialize_session(session)}
    if session.status == "completed":
        payload["summary"] = session.summary_json or calculate_session_summary(session)
    return jsonify(payload)


@api.post("/study-sessions/<session_id>/pause")
@require_auth
def pause_session(session_id: str):
    session = _owned_session(session_id)
    if not session:
        return error("session_not_found", "That practice session was not found.", 404)
    try:
        pause_study_session(session)
    except ValueError as exc:
        if str(exc) == "diagnostic_no_pause":
            return error(
                "diagnostic_no_pause",
                "A mega-litigation runs in one sitting — its clock cannot be paused.",
                409,
            )
        return error("session_complete", "This practice session is already complete.", 409)
    return jsonify({"session": serialize_session(session, False)})


@api.post("/study-sessions/<session_id>/resume")
@require_auth
def resume_session(session_id: str):
    session = _owned_session(session_id)
    if not session:
        return error("session_not_found", "That practice session was not found.", 404)
    try:
        resume_study_session(session)
    except ValueError as exc:
        if str(exc) == "diagnostic_no_pause":
            return error(
                "diagnostic_no_pause",
                "A mega-litigation runs in one sitting — its clock never stopped.",
                409,
            )
        return error("session_complete", "This practice session is already complete.", 409)
    return jsonify({"session": serialize_session(session)})


@api.post("/study-sessions/<session_id>/abandon")
@require_auth
def abandon_session(session_id: str):
    session = _owned_session(session_id)
    if not session:
        return error("session_not_found", "That practice session was not found.", 404)
    try:
        abandon_study_session(session)
    except ValueError as exc:
        code = str(exc)
        if code == "debrief_required":
            return error(code, "Finish reviewing the current answer before discarding this run.", 409)
        return error("session_complete", "This practice session is already finished.", 409)
    return jsonify({"session": serialize_session(session, False)})




@api.get("/study-sessions/<session_id>/review")
@require_auth
def get_session_review(session_id: str):
    session = _owned_session(session_id)
    if not session:
        return error("session_not_found", "That practice session was not found.", 404)
    try:
        review = session_review(session)
        if session.results_seen_at is None:
            session.results_seen_at = utcnow()
            db.session.commit()
        return jsonify({"review": review})
    except ValueError as exc:
        if str(exc) == "blind_review_required":
            return error(
                "blind_review_required",
                "Finish the blind review before revealing the diagnostic answers.",
                409,
            )
        return error("session_in_progress", "Finish the run before opening its review.", 409)


@api.post("/study-sessions/<session_id>/review/acknowledge")
@require_auth
def acknowledge_session_review(session_id: str):
    session = _owned_session(session_id)
    if not session:
        return error("session_not_found", "That practice session was not found.", 404)
    if session.status != "completed":
        return error("session_in_progress", "Finish the run before closing its brief.", 409)
    session.results_seen_at = session.results_seen_at or utcnow()
    session.summary_seen_at = session.summary_seen_at or utcnow()
    db.session.commit()
    return jsonify({"session": serialize_session(session, False), "brief_complete": True})


@api.get("/reviews")
@require_auth
def get_review_queue():
    return jsonify({"review_queue": review_queue_snapshot(g.current_user)})


@api.get("/daily-docket")
@require_auth
def get_daily_docket():
    timezone_name = str(request.args.get("timezone") or "UTC")[:80]
    return jsonify({"daily_docket": daily_docket_snapshot(g.current_user, timezone_name)})


@api.post("/study-sessions/<session_id>/debrief/acknowledge")
@require_auth
def acknowledge_answer_review(session_id: str):
    session = _owned_session(session_id)
    if not session:
        return error("session_not_found", "That practice session was not found.", 404)
    pending_attempt = db.session.get(Attempt, session.pending_attempt_id) if session.pending_attempt_id else None
    settlement_pending = False
    if (
        pending_attempt
        and pending_attempt.session_item.game_context_json is not None
        and not pending_attempt.settlement
    ):
        # Explanation grading takes 20-30 seconds and is not on the answer's
        # critical path: once it has been handed off, the case settles on its own
        # and the player may move to the next question. Only a debrief whose case
        # was never sent for grading is still blocked here.
        if not coaching_handed_off(pending_attempt):
            return error(
                "settlement_required",
                "Finish the case review and settlement before continuing.",
                409,
            )
        settlement_pending = True
    completed_batch = session.status == "completed"
    session.pending_attempt_id = None
    db.session.commit()
    pending_payload = {"settlement_pending": True, "pending_attempt_id": pending_attempt.id} if settlement_pending else {}
    if completed_batch:
        if session.mode == "diagnostic":
            summary = session.summary_json or calculate_session_summary(session)
            return jsonify(
                {
                    "session": serialize_session(session, False),
                    "diagnostic_complete": True,
                    "summary": summary,
                    "promotion": summary.get("promotion"),
                    **pending_payload,
                }
            )
        return jsonify({"session": serialize_session(session, False), "run_complete": True, **pending_payload})
    return jsonify({"session": serialize_session(session), **pending_payload})


@api.post("/study-sessions/<session_id>/attempts")
@require_auth
def create_attempt(session_id: str):
    session = _owned_session(session_id)
    if not session:
        return error("session_not_found", "That practice session was not found.", 404)
    payload = request.get_json(silent=True) or {}
    idempotency_key = request.headers.get("Idempotency-Key") or str(uuid.uuid4())
    if len(idempotency_key) > 80:
        return error("invalid_idempotency_key", "The request identifier is too long.")
    try:
        attempt, duplicate = submit_attempt(g.current_user, session, payload, idempotency_key)
    except GateRejection as rejection:
        # The student opted into an approach and the required work is not done.
        # Field-level messages come back so the interface can point at the box
        # that failed instead of showing one generic refusal.
        return (
            jsonify(
                {
                    "error": {
                        "code": "strategy_gate_unsatisfied",
                        "message": "Finish the approach you chose, or drop it and answer without it.",
                        "fields": rejection.errors,
                    }
                }
            ),
            409,
        )
    except ValueError as exc:
        code = str(exc)
        messages = {
            "onboarding_required": "Create your lawyer before starting cases.",
            "game_context_required": "Reload the current case before submitting it.",
            "idempotency_conflict": "That request identifier was already used.",
            "debrief_required": "Review the current answer before continuing.",
            "diagnostic_expired": "Time is up. Your mega-litigation has been submitted as it stood.",
            "session_complete": "This practice session is already complete.",
            "invalid_session_item": "This is not the current question. Refresh and try again.",
            "invalid_choice": "Choose one of the available answers.",
            "reasoning_required": "Explain your reasoning before submitting the case.",
            "reasoning_too_short": "Your explanation is too short to grade — add the reasoning that decided your answer.",
            "invalid_confidence": "Choose a confidence level from 1 to 5.",
            "strategy_decision_required": "Choose whether to use the assigned method before submitting.",
            "invalid_strategy_prompt_time": "The strategy decision time could not be recorded.",
        }
        status = 400 if code in {"invalid_choice", "reasoning_required", "reasoning_too_short", "invalid_confidence", "strategy_decision_required", "invalid_strategy_prompt_time"} else 409
        return error(code, messages.get(code, "The answer could not be saved."), status)
    return jsonify({"result": serialize_attempt_result(attempt, duplicate)})


@api.post("/attempts/<attempt_id>/coaching")
@require_auth
def coach_attempt(attempt_id: str):
    attempt = Attempt.query.filter_by(id=attempt_id, user_id=g.current_user.id).first()
    if not attempt:
        return error("attempt_not_found", "That answer was not found.", 404)
    if not answers_available(attempt.session_item.session):
        return error(
            "answers_withheld",
            "Answers stay hidden until this diagnostic and its blind review are complete.",
            409,
        )
    saved = (attempt.feedback_json or {}).get("coaching")
    if attempt.coaching_status == "completed" and saved:
        if not attempt.settlement:
            run_attempt_coaching(attempt)
        return jsonify(
            {
                "status": "completed",
                "coaching": saved,
                "reward": serialize_settlement(attempt.settlement),
                "game": serialize_game(g.current_user.game_profile) if g.current_user.game_profile else None,
            }
        )
    if attempt.coaching_status == "failed" and attempt.settlement:
        # Grading is out of retries but the case was settled from the verified
        # answer key anyway (see `settle_uncoached_attempt`). This is a terminal
        # state, so the client stops polling and explains itself instead.
        return jsonify(
            {
                "status": "unavailable",
                "coaching": None,
                "notice": (attempt.feedback_json or {}).get("coaching_unavailable") or UNGRADED_COACHING_NOTICE,
                "reward": serialize_settlement(attempt.settlement),
                "game": serialize_game(g.current_user.game_profile) if g.current_user.game_profile else None,
            }
        )
    if not provider_ready():
        return error("coaching_not_configured", "AI coaching is not configured.", 503)
    if async_jobs_enabled():
        if not queue_ready():
            return error("job_queue_not_configured", "The AI job queue is not configured.", 503)
        try:
            job = enqueue_coaching_job(attempt)
        except JobQueueError as exc:
            return error("job_queue_failed", str(exc), 503)
        if job.status == "completed":
            return jsonify(
                {
                    "status": "completed",
                    "coaching": job.result_json,
                    "reward": serialize_settlement(attempt.settlement),
                    "game": serialize_game(g.current_user.game_profile) if g.current_user.game_profile else None,
                }
            )
        return jsonify({"status": job.status, "job": serialize_job(job)}), 202
    try:
        coaching = run_attempt_coaching(attempt)
    except ValueError as exc:
        if str(exc) == "coaching_in_progress":
            return error("coaching_in_progress", "The AI coach is already reviewing this answer.", 409)
        raise
    except CoachingProviderError as exc:
        return error("coaching_failed", str(exc), 502)
    return jsonify(
        {
            "status": "completed",
            "coaching": coaching,
            "reward": serialize_settlement(attempt.settlement),
            "game": serialize_game(g.current_user.game_profile) if g.current_user.game_profile else None,
        }
    )


@api.get("/attempts/<attempt_id>/reward")
@require_auth
def attempt_game_reward(attempt_id: str):
    attempt = Attempt.query.filter_by(id=attempt_id, user_id=g.current_user.id).first()
    if not attempt:
        return error("attempt_not_found", "That answer was not found.", 404)
    return jsonify(
        {
            "reward": serialize_settlement(attempt.settlement),
            "game": serialize_game(g.current_user.game_profile) if g.current_user.game_profile else None,
        }
    )


@api.get("/jobs/<job_id>")
@require_auth
def get_ai_job(job_id: str):
    job = AiJob.query.filter_by(id=job_id, user_id=g.current_user.id).first()
    if not job:
        return error("job_not_found", "That AI job was not found.", 404)
    return jsonify({"job": serialize_job(job)})


@api.get("/study-sessions/<session_id>/summary")
@require_auth
def session_summary(session_id: str):
    session = _owned_session(session_id)
    if not session:
        return error("session_not_found", "That practice session was not found.", 404)
    if session.status != "completed":
        return error("session_in_progress", "Finish the session to view its summary.", 409)
    if not session.summary_json:
        session.summary_json = calculate_session_summary(session)
        db.session.commit()
    return jsonify({"summary": session.summary_json, "session": serialize_session(session, False)})
