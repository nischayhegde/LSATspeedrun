from __future__ import annotations

import gzip
import os
import sqlite3
from pathlib import Path

import click
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from dotenv import load_dotenv
from flask import Flask, current_app, jsonify, request
from flask_cors import CORS
from flask_migrate import Migrate
from sqlalchemy import event
from sqlalchemy.engine import Engine

from .auth import init_auth
from .db_secret import DatabaseSecret, attach_rotation_recovery
from .extensions import db
from .game import SITTING_QUESTIONS
from .routes import api
from .scoring import FORM_ITEMS
from .seed import seed_questions

MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"

# How much unfinished practice a student may have queued at once, in questions.
# Eighty is the eight ten-question runs the queue used to allow; see
# PRACTICE_QUEUE_MAX for why the cap converts rather than staying at eight.
PRACTICE_QUEUE_QUESTIONS = 80


@event.listens_for(Engine, "connect")
def _sqlite_concurrency_pragmas(dbapi_connection, _connection_record):
    """Put SQLite in WAL mode. Postgres connections are left untouched.

    The local default is the rollback journal, which takes an exclusive lock on
    the whole database for the duration of every write and gives readers no way
    through it. That is survivable for a single-threaded server and it is not
    what this app runs: with `AI_JOBS_MODE=local` the 20-30 second explanation
    grading happens on background threads *in the same process*, so a grader
    committing while the player answers the next question is the normal case
    rather than the exception. QA saw `database is locked` 500s out of exactly
    that overlap. WAL lets readers proceed against the last committed snapshot
    while a writer is active, which removes the collision instead of waiting it
    out, and `busy_timeout` still covers writer-versus-writer.

    Registered against the `Engine` class rather than one engine because
    Flask-SQLAlchemy builds its engines lazily, and at module scope so repeated
    `create_app` calls (every test module) do not stack duplicate listeners.
    `synchronous=NORMAL` is the documented companion setting for WAL: durable
    across process crashes, and only at risk in a power loss on a dev machine.
    """
    if not isinstance(dbapi_connection, sqlite3.Connection):
        return
    cursor = dbapi_connection.cursor()
    try:
        # An in-memory database has no journal file to write and reports back
        # "memory"; asking is harmless and keeps the branch out of here.
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=5000")
    except sqlite3.DatabaseError:
        # A read-only or otherwise locked file cannot be switched. Losing the
        # optimisation is not a reason to fail the connection.
        pass
    finally:
        cursor.close()


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


def schema_is_at_migration_head() -> bool:
    """Whether the connected database matches the models the code is holding.

    Must be called inside an app context. True only when Alembic's version table
    exists and names exactly the head revision(s) in ``migrations/versions``.

    This is the precondition for touching any table through the ORM outside a
    migration, and the two failure modes it covers are different. An *empty*
    database has no tables at all, so a query raises "no such table". A database
    stamped *behind* head has the tables but not every column the mapped classes
    select, so a query raises "no such column". Checking the revision instead of
    probing for individual tables covers both without needing to know which
    migration introduced what.
    """
    try:
        heads = set(ScriptDirectory(str(MIGRATIONS_DIR)).get_heads())
        with db.engine.connect() as connection:
            # Returns an empty tuple rather than raising when the database has
            # never been migrated and has no alembic_version table.
            stamped = set(MigrationContext.configure(connection).get_current_heads())
    except Exception:  # pragma: no cover - unreachable database, bad script dir
        current_app.logger.exception("Could not determine the database migration revision")
        return False
    return bool(heads) and stamped == heads


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
        # How many questions one practice run asks for. Defaulted from
        # `game.SITTING_QUESTIONS` rather than repeated as a literal here,
        # because the economy counts contract lengths and daily goals in
        # sittings and the two must not be able to disagree. A run may finish
        # slightly over this to serve a Reading Comprehension passage whole —
        # see `services.PASSAGE_OVERSHOOT_ALLOWANCE`.
        PRACTICE_SESSION_SIZE=max(1, int(os.getenv("PRACTICE_SESSION_SIZE", str(SITTING_QUESTIONS)))),
        # A student may keep this many practice runs (Sprint/Infinite/Method Lab/
        # Review) queued at once — paused or in progress — before another start
        # request is rejected with "queue_full". Diagnostics are unaffected;
        # they keep the single-active-run rule enforced separately.
        #
        # The cap is a limit on *queued work*, not on how many times the student
        # has pressed start, so it is quoted in questions and converted. Eight
        # ten-question runs was eighty questions of unfinished work; leaving the
        # cap at eight while the run shortens would silently cut that to
        # forty-eight and would bite precisely the student a shorter run is meant
        # to help — the one who picks a case up often.
        PRACTICE_QUEUE_MAX=max(
            1,
            int(
                os.getenv("PRACTICE_QUEUE_MAX")
                or round(PRACTICE_QUEUE_QUESTIONS / SITTING_QUESTIONS)
            ),
        ),
        # Whether choosing a suggested approach also commits the student to
        # doing it (see app/enforcement.py). On by default. This is a kill
        # switch rather than an experiment knob: enforcement changes what the
        # prompt arm of a live strategy trial actually *is*, so a deployment
        # has to be able to stop producing the new treatment without a code
        # change, and every attempt records the version it was collected under.
        STRATEGY_ENFORCEMENT_ENABLED=os.getenv("STRATEGY_ENFORCEMENT_ENABLED", "true").lower() == "true",
        # `DIAGNOSTIC_SIZE` is the name every .env file has always documented,
        # while the code only ever read `DIAGNOSTIC_SESSION_SIZE` — so the
        # documented setting silently did nothing and every mega-litigation ran
        # at the hard-coded default. Both names are honoured now, the sibling of
        # PRACTICE_SESSION_SIZE first, so existing deployments keep working
        # whichever one they set.
        #
        # The default is `scoring.FORM_ITEMS`, not the 75 it used to be. Those
        # were two different numbers describing one thing: the mega-litigation is
        # what the projected score anchors on, and the projection converts a raw
        # score against a 77-item reference form (two LR sections of 25 and one
        # RC of 27). A 75-item form scored against a 77-item table is a quiet
        # two-item handicap, so the form size is now the reference form size by
        # construction and `select_diagnostic_questions` hits it exactly.
        DIAGNOSTIC_SESSION_SIZE=max(
            6,
            int(os.getenv("DIAGNOSTIC_SESSION_SIZE") or os.getenv("DIAGNOSTIC_SIZE") or str(FORM_ITEMS)),
        ),
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
        # Explanation grading is a 20-30 second frontier-model call. Running it
        # inside the request blocks the player's next question on it, so a single
        # process defaults to the in-process background worker ("local"): same
        # AiJob row, same retries, no broker to deploy. Production is left as it
        # was — it declares "sqs" (durable, multi-instance) or "worker" explicitly
        # — because a request-scoped thread is the wrong shape for a serverless
        # container that may be frozen the moment the response is written.
        AI_JOBS_MODE=os.getenv("AI_JOBS_MODE", "sync" if is_production else "local").strip().lower(),
        AI_JOB_QUEUE_URL=os.getenv("AI_JOB_QUEUE_URL", "").strip(),
        AI_JOB_MAX_ATTEMPTS=max(1, int(os.getenv("AI_JOB_MAX_ATTEMPTS", "3"))),
        SQLALCHEMY_ENGINE_OPTIONS={"pool_pre_ping": True, "pool_recycle": 300},
    )
    if test_config:
        app.config.update(test_config)

    if app.config["DIAGNOSTIC_SESSION_SIZE"] != FORM_ITEMS:
        # Deliberately loud rather than silent. A short form still scores
        # correctly — the projection converts a *rate* reweighted to form
        # composition, not a raw count — but "the mega-litigation is a
        # {FORM_ITEMS}-item form" stops being true, and the two numbers
        # disagreeing without anyone noticing is what this warning exists for.
        app.logger.warning(
            "DIAGNOSTIC_SESSION_SIZE is %s but the scoring reference form is %s items; "
            "the mega-litigation is a short form.",
            app.config["DIAGNOSTIC_SESSION_SIZE"],
            FORM_ITEMS,
        )

    if is_production and not os.getenv("AI_JOBS_MODE") and app.config["AI_JOBS_MODE"] == "sync":
        # Falling back to "sync" is correct — it needs no broker and no worker —
        # but it puts a 20-30 second frontier-model call inside the request the
        # player is waiting on. Every deployment under `deploy/` names the mode
        # explicitly, so reaching this line means a new one has not, and the
        # symptom (every answered question takes half a minute) is a long way
        # from the cause. Warn rather than choose: "local" is wrong for a
        # serverless container that may be frozen once the response is written,
        # and "sqs" without a consumer would leave explanations ungraded forever,
        # so which mode is safe is a property of the deployment, not of the code.
        app.logger.warning(
            "AI_JOBS_MODE is not set, so explanation grading will run inside the "
            "request and block it for 20-30 seconds. Set AI_JOBS_MODE=sqs together "
            "with AI_JOB_QUEUE_URL when a worker drains the queue, or "
            "AI_JOBS_MODE=local to grade on a background thread in a long-lived "
            "server process."
        )

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
        if not schema_is_at_migration_head():
            raise click.ClickException(
                "The database is not at the latest migration. "
                "Run `flask db upgrade` first, then seed."
            )
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
        elif app.config["AUTO_SEED"]:
            # `create_app` runs for *every* entrypoint, including `flask db
            # upgrade` — which is the first thing a new environment runs, and
            # the Procfile's own web command. Seeding queries the `questions`
            # table, so on a fresh database it used to raise "no such table"
            # before a single migration had a chance to create it, and the only
            # way through was the undocumented `AUTO_SEED=false`. Populating
            # data is not the app object's job when the schema it needs may not
            # exist yet, so boot-time seeding now waits until the database is
            # actually at head and says so when it is not. `flask seed` remains
            # the explicit path, and the deployment order (upgrade, then serve)
            # means the web process still finds a seeded bank.
            if schema_is_at_migration_head():
                seed_questions()
            else:
                app.logger.warning(
                    "Skipping automatic question seeding: the database is not at the "
                    "latest migration. Run `flask db upgrade`, then `flask seed`."
                )

    return app
