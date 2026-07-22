from __future__ import annotations

import json
import os
from pathlib import Path

import click
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_migrate import Migrate
from sqlalchemy.engine import URL

from .auth import init_auth
from .extensions import db
from .routes import api
from .seed import seed_questions


def _database_url() -> str:
    configured = os.getenv("DATABASE_URL", "").strip()
    if configured:
        return configured
    secret_arn = os.getenv("DATABASE_SECRET_ARN", "").strip()
    if not secret_arn:
        return "sqlite:///lsat_sherlock.db"

    import boto3

    response = boto3.client("secretsmanager").get_secret_value(SecretId=secret_arn)
    secret = json.loads(response["SecretString"])
    host = os.getenv("DATABASE_HOST") or secret.get("host")
    port = int(os.getenv("DATABASE_PORT") or secret.get("port") or 5432)
    name = os.getenv("DATABASE_NAME") or secret.get("dbname") or "lsatspeedrun"
    if not host or not secret.get("username") or not secret.get("password"):
        raise RuntimeError("The configured database secret is incomplete.")
    return URL.create(
        "postgresql+psycopg",
        username=secret["username"],
        password=secret["password"],
        host=host,
        port=port,
        database=name,
        query={"sslmode": "require"},
    ).render_as_string(hide_password=False)


def create_app(test_config: dict | None = None) -> Flask:
    backend_dir = Path(__file__).resolve().parents[1]
    load_dotenv(backend_dir / ".env")
    load_dotenv(backend_dir.parent / ".env")

    app = Flask(__name__, instance_relative_config=True)
    is_production = os.getenv("FLASK_ENV", "development") == "production"
    safe_dev_default = "false" if is_production else "true"
    database_url = _database_url()
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
        DEV_AUTH_ENABLED=os.getenv("DEV_AUTH_ENABLED", safe_dev_default).lower() == "true",
        AUTO_SEED=os.getenv("AUTO_SEED", safe_dev_default).lower() == "true",
        PRACTICE_SESSION_SIZE=max(1, int(os.getenv("PRACTICE_SESSION_SIZE", "10"))),
        HUGGINGFACE_REQUEST_INTERVAL_SECONDS=max(
            0.0,
            float(os.getenv("HUGGINGFACE_REQUEST_INTERVAL_SECONDS", "1.1")),
        ),
        AUTH_COOKIE="lsat_session",
        CSRF_COOKIE="lsat_csrf",
        COOKIE_SECURE=is_production,
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
    Migrate(app, db)
    CORS(
        app,
        origins=[app.config["FRONTEND_ORIGIN"]],
        supports_credentials=True,
        allow_headers=["Content-Type", "X-CSRF-Token", "Idempotency-Key"],
    )
    init_auth(app)
    app.register_blueprint(api, url_prefix="/v1")

    @app.cli.command("seed")
    @click.option("--force", is_flag=True, help="Refresh records from the Hugging Face datasets.")
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

    @app.errorhandler(404)
    def not_found(_error):
        return jsonify({"error": {"code": "not_found", "message": "That endpoint does not exist."}}), 404

    @app.errorhandler(500)
    def server_error(error):
        app.logger.exception("Unhandled API error", exc_info=error)
        return jsonify({"error": {"code": "server_error", "message": "Something went wrong."}}), 500

    with app.app_context():
        if app.config["AUTO_SEED"] or app.config.get("TESTING"):
            db.create_all()
        if app.config["AUTO_SEED"]:
            seed_questions()

    return app
