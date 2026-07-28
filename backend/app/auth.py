from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta, timezone
from functools import wraps

from flask import current_app, g, jsonify, request

from .extensions import db
from .models import AuthSession, utcnow


AUTH_EXEMPT_PATHS = {
    "/v1/auth/google",
    "/v1/auth/dev",
    "/v1/auth/mobile/google",
    "/v1/auth/mobile/dev",
}


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def init_auth(app):
    @app.before_request
    def load_identity_and_check_csrf():
        g.current_user = None
        g.auth_session = None
        g.auth_via_bearer = False

        # Native clients cannot rely on browser cookies (nor should they put a
        # cookie-derived CSRF token in device storage). A device token is an
        # opaque random secret: only its SHA-256 hash is persisted, exactly as
        # for the web session cookie. Prefer an explicitly supplied bearer
        # token, falling back to the established cookie session for the web.
        authorization = request.headers.get("Authorization", "")
        bearer_prefix = "Bearer "
        raw_token = ""
        if authorization.startswith(bearer_prefix):
            raw_token = authorization[len(bearer_prefix) :].strip()
            g.auth_via_bearer = bool(raw_token)
        if not raw_token:
            raw_token = request.cookies.get(app.config["AUTH_COOKIE"])
        if raw_token:
            session = AuthSession.query.filter_by(token_hash=_hash(raw_token), revoked_at=None).first()
            if session:
                expires_at = session.expires_at
                if expires_at.tzinfo is None:
                    expires_at = expires_at.replace(tzinfo=timezone.utc)
                if expires_at > utcnow():
                    g.current_user = session.user
                    g.auth_session = session

        if (
            request.method in {"POST", "PUT", "PATCH", "DELETE"}
            and request.path not in AUTH_EXEMPT_PATHS
            and not g.auth_via_bearer
        ):
            cookie_token = request.cookies.get(app.config["CSRF_COOKIE"])
            header_token = request.headers.get("X-CSRF-Token")
            if not cookie_token or not header_token or not secrets.compare_digest(cookie_token, header_token):
                return jsonify({"error": {"code": "csrf_failed", "message": "Refresh the page and try again."}}), 403


def require_auth(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not g.current_user:
            return jsonify({"error": {"code": "unauthorized", "message": "Sign in to continue."}}), 401
        return view(*args, **kwargs)

    return wrapped


def issue_auth_cookies(response, user):
    raw_token = secrets.token_urlsafe(48)
    auth_session = AuthSession(
        user_id=user.id,
        token_hash=_hash(raw_token),
        expires_at=utcnow() + timedelta(days=14),
    )
    db.session.add(auth_session)
    db.session.commit()

    secure = current_app.config["COOKIE_SECURE"]
    response.set_cookie(
        current_app.config["AUTH_COOKIE"],
        raw_token,
        max_age=14 * 24 * 60 * 60,
        httponly=True,
        secure=secure,
        samesite="Lax",
        path="/",
    )
    response.set_cookie(
        current_app.config["CSRF_COOKIE"],
        secrets.token_urlsafe(32),
        max_age=14 * 24 * 60 * 60,
        httponly=False,
        secure=secure,
        samesite="Lax",
        path="/",
    )
    return response


def issue_mobile_token(user):
    """Issue an opaque bearer token for an iOS/Android installation.

    The raw token is returned exactly once to the device. Its server-side
    representation uses the same hashed, revocable AuthSession table as the
    browser cookie flow, so account deletion, expiry, and logout behave
    consistently across platforms.
    """

    raw_token = secrets.token_urlsafe(48)
    expires_at = utcnow() + timedelta(days=current_app.config["MOBILE_AUTH_DAYS"])
    auth_session = AuthSession(
        user_id=user.id,
        token_hash=_hash(raw_token),
        expires_at=expires_at,
    )
    db.session.add(auth_session)
    db.session.commit()
    return raw_token, expires_at


def clear_auth_cookies(response):
    response.delete_cookie(current_app.config["AUTH_COOKIE"], path="/")
    response.delete_cookie(current_app.config["CSRF_COOKIE"], path="/")
    return response
