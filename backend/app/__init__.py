from __future__ import annotations

import gzip
import os
from pathlib import Path

import click
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_migrate import Migrate

from .auth import init_auth
from .db_secret import DatabaseSecret, attach_rotation_recovery
from .extensions import db
from .routes import api
from .seed import seed_questions


def _database_secret() -> DatabaseSecret | None:
    """The rotating RDS credentials, or None when the URL is supplied directly."""

    if os.getenv("DATABASE_URL", "").strip():
        return None
    secret_arn = os.getenv("DATABASE_SECRET_ARN", "").strip()
    if not secret_arn:
        return None
    return DatabaseSecret(
        secret_arn,
        host=os.getenv("DATABASE_HOST"),
        port=os.getenv("DATABASE_PORT"),
        name=os.getenv("DATABASE_NAME"),
    )


def _database_url(secret: DatabaseSecret | None) -> str:
    configured = os.getenv("DATABASE_URL", "").strip()
    if configured:
        return configured
    if secret is None:
        return "sqlite:///lsat_sherlock.db"
    return secret.url()


def create_app(test_config: dict | None = None, *, instance_path: str | None = None) -> Flask:
    backend_dir = Path(__file__).resolve().parents[1]
    load_dotenv(backend_dir / ".env")
    load_dotenv(backend_dir.parent / ".env")

    app = Flask(
        __name__,
        instance_relative_config=True,
        instance_path=instance_path,
    )
    is_production = os.getenv("FLASK_ENV", "development") == "production"
    auto_seed_default = "false" if is_production else "true"
    dev_auth_requested = os.getenv("DEV_AUTH_ENABLED", "false").lower() == "true"
    if is_production and dev_auth_requested:
        raise RuntimeError("DEV_AUTH_ENABLED must be false in production.")
    database_secret = _database_secret()
    database_url = _database_url(database_secret)
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql+psycopg://", 1)
    elif database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)

    app.config.from_mapping(
        SECRET_KEY=os.getenv("SECRET_KEY", "local-only-change-me"),
        SQLALCHEMY_DATABASE_URI=database_url,
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        FRONTEND_ORIGIN=os.getenv("FRONTEND_ORIGIN", "http://localhost:5173"),
        GOOGLE_CLIENT_ID=os.getenv("GOOGLE_CLIENT_ID", ""),
        GOOGLE_MOBILE_CLIENT_IDS=tuple(
            client_id.strip()
            for client_id in os.getenv("GOOGLE_MOBILE_CLIENT_IDS", "").split(",")
            if client_id.strip()
        ),
        # Development login can impersonate an email address by design, so it
        # must be enabled explicitly and can never run in production.
        DEV_AUTH_ENABLED=dev_auth_requested and not is_production,
        AUTO_SEED=os.getenv("AUTO_SEED", auto_seed_default).lower() == "true",
        PRACTICE_SESSION_SIZE=max(1, int(os.getenv("PRACTICE_SESSION_SIZE", "10"))),
        # A student may keep this many practice runs (Sprint/Infinite/Method Lab/
        # Review) queued at once — paused or in progress — before another start
        # request is rejected with "queue_full". Diagnostics are unaffected;
        # they keep the single-active-run rule enforced separately.
        PRACTICE_QUEUE_MAX=max(1, int(os.getenv("PRACTICE_QUEUE_MAX", "8"))),
        DIAGNOSTIC_SESSION_SIZE=max(6, int(os.getenv("DIAGNOSTIC_SESSION_SIZE", "75"))),
        HUGGINGFACE_REQUEST_INTERVAL_SECONDS=max(
            0.0,
            float(os.getenv("HUGGINGFACE_REQUEST_INTERVAL_SECONDS", "1.1")),
        ),
        QUESTION_BANK_DIR=os.getenv(
            "QUESTION_BANK_DIR",
            str(backend_dir / "data" / "question_bank"),
        ),
        AUTH_COOKIE="lsat_session",
        CSRF_COOKIE="lsat_csrf",
        COOKIE_SECURE=is_production,
        MOBILE_AUTH_DAYS=max(1, int(os.getenv("MOBILE_AUTH_DAYS", "90"))),
        REPO_ROOT=str(backend_dir.parent),
        TFY_API_KEY=os.getenv("TFY_API_KEY", "").strip().strip('"'),
        TFY_URL=os.getenv("TFY_URL", "").strip().strip('"'),
        COACHING_MODEL="gpt-5.6-luna",
        COACHING_REASONING_EFFORT="xhigh",
        AI_JOBS_MODE=os.getenv("AI_JOBS_MODE", "sync").strip().lower(),
        AI_JOB_QUEUE_URL=os.getenv("AI_JOB_QUEUE_URL", "").strip(),
        AI_JOB_MAX_ATTEMPTS=max(1, int(os.getenv("AI_JOB_MAX_ATTEMPTS", "3"))),
        SQLALCHEMY_ENGINE_OPTIONS={"pool_pre_ping": True, "pool_recycle": 300},
    )
    if test_config:
        app.config.update(test_config)

    Path(app.instance_path).mkdir(parents=True, exist_ok=True)
    db.init_app(app)
    # Only when the app really is talking to the rotating secret. A test or a
    # local run that overrides the URI is pointed at SQLite, which has no
    # password to supply and no dialect that would accept one.
    if database_secret is not None and app.config["SQLALCHEMY_DATABASE_URI"] == database_url:
        with app.app_context():
            attach_rotation_recovery(db.engine, database_secret)
    Migrate(app, db)
    CORS(
        app,
        origins=[app.config["FRONTEND_ORIGIN"]],
        supports_credentials=True,
        allow_headers=["Authorization", "Content-Type", "X-CSRF-Token", "Idempotency-Key"],
    )
    init_auth(app)
    app.register_blueprint(api, url_prefix="/v1")

    @app.cli.command("seed")
    @click.option("--force", is_flag=True, help="Refresh records from the repository question snapshot.")
    def seed_command(force: bool):
        count = seed_questions(force=force)
        click.echo(f"Seeded {count} questions.")

    @app.after_request
    def security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.after_request
    def compress_response(response):
        """Nothing in front of this app compresses for us. The game state is the
        largest payload on the client's critical path and is mostly repetitive
        catalog JSON, so it shrinks by roughly 85%."""
        response.headers.add("Vary", "Accept-Encoding")
        if response.direct_passthrough or response.status_code < 200 or response.status_code >= 300:
            return response
        if "gzip" not in request.headers.get("Accept-Encoding", "").lower():
            return response
        if response.headers.get("Content-Encoding"):
            return response
        mimetype = (response.mimetype or "").lower()
        compressible = mimetype.startswith("text/") or mimetype in {
            "application/json",
            "application/javascript",
            "image/svg+xml",
        }
        if not compressible or response.content_length is None or response.content_length < 1024:
            return response
        payload = gzip.compress(response.get_data(), compresslevel=6)
        response.set_data(payload)
        response.headers["Content-Encoding"] = "gzip"
        response.headers["Content-Length"] = str(len(payload))
        return response

    @app.errorhandler(404)
    def not_found(_error):
        return jsonify({"error": {"code": "not_found", "message": "That endpoint does not exist."}}), 404

    @app.errorhandler(500)
    def server_error(error):
        app.logger.exception("Unhandled API error", exc_info=error)
        return jsonify({"error": {"code": "server_error", "message": "Something went wrong."}}), 500

    with app.app_context():
        # Outside tests, schema changes are owned by Alembic. Calling create_all on an
        # older stamped database can pre-create future tables and make upgrades collide.
        if app.config.get("TESTING"):
            db.create_all()
        if app.config["AUTO_SEED"]:
            seed_questions()

    return app
