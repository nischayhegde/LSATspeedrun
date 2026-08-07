"""A brand-new database must be able to migrate itself.

This is the one path the rest of the suite cannot see. Every other test builds
its schema with `create_all()` and stamps nothing, so the migration chain is
never executed and `create_app`'s boot behaviour against an *unmigrated*
database was never exercised at all. The bug that hid there: `create_app` seeded
the question bank unconditionally, which queries the `questions` table, so on an
empty database it raised

    sqlalchemy.exc.OperationalError: no such table: questions

before `flask db upgrade` could create that table -- and `create_app` runs for
every entrypoint, `flask db upgrade` included. A new environment could not reach
its first migration, and the only way through was the undocumented
`AUTO_SEED=false`.

So these tests point a real Flask app at a real empty file and run the real
thirty-two migrations. The seeder itself is stubbed out: what is under test is
*whether* it is called and whether the schema is ready when it is, not what it
loads. Seeding for real would either read the whole 6,886-question bank or, if
pointed at an empty one, fall through to downloading from Hugging Face.
"""

from __future__ import annotations

import logging

import pytest
from alembic.script import ScriptDirectory
from flask_migrate import upgrade
from sqlalchemy import inspect, text

from app import MIGRATIONS_DIR, create_app, schema_is_at_migration_head
from app.extensions import db


@pytest.fixture
def restored_logging():
    """Undo the logging reconfiguration a migration run performs.

    `migrations/env.py` calls `logging.config.fileConfig`, which defaults to
    disabling every logger it does not name. That is harmless inside the
    migration but it would quietly mute the rest of the pytest session, so the
    disabled flags are snapshotted and put back.
    """
    before = {
        name: item.disabled
        for name, item in logging.Logger.manager.loggerDict.items()
        if isinstance(item, logging.Logger)
    }
    yield
    for name, disabled in before.items():
        item = logging.Logger.manager.loggerDict.get(name)
        if isinstance(item, logging.Logger):
            item.disabled = disabled


@pytest.fixture
def empty_database(tmp_path, monkeypatch):
    """A database file that has never been created, let alone migrated."""
    path = tmp_path / "fresh.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{path}")
    monkeypatch.delenv("DATABASE_SECRET_ARN", raising=False)
    # The bug only appears with seeding on, which is the default everywhere
    # outside production. Set explicitly so a change to backend/.env cannot
    # quietly turn this test into a no-op.
    monkeypatch.setenv("AUTO_SEED", "true")
    monkeypatch.setenv("FLASK_ENV", "development")
    assert not path.exists()
    return path


@pytest.fixture
def seed_calls(monkeypatch):
    calls = []

    def _stub(force: bool = False) -> int:
        calls.append(force)
        return 0

    monkeypatch.setattr("app.seed_questions", _stub)
    return calls


def _head_revision() -> str:
    heads = ScriptDirectory(str(MIGRATIONS_DIR)).get_heads()
    # `schema_is_at_migration_head` compares against the full set of heads, so a
    # second head would silently make it unsatisfiable. The chain is meant to be
    # linear and this is the assumption the helper rests on.
    assert len(heads) == 1, f"the migration chain has {len(heads)} heads: {heads}"
    return heads[0]


def test_create_app_on_an_empty_database_neither_seeds_nor_raises(
    tmp_path, empty_database, seed_calls
):
    """Booting must not touch a table that no migration has created yet."""
    app = create_app(instance_path=str(tmp_path))

    assert app.config["AUTO_SEED"] is True
    assert not app.config.get("TESTING")
    # The precondition the seeder now waits for, and the reason it waited.
    assert seed_calls == []
    with app.app_context():
        assert schema_is_at_migration_head() is False
        assert inspect(db.engine).get_table_names() == []


def test_migrations_take_an_empty_database_all_the_way_to_head(
    tmp_path, empty_database, seed_calls, restored_logging
):
    """The whole point: `flask db upgrade` works on a database with nothing in it."""
    app = create_app(instance_path=str(tmp_path))

    with app.app_context():
        upgrade(directory=str(MIGRATIONS_DIR))

        assert schema_is_at_migration_head() is True
        with db.engine.connect() as connection:
            stamped = connection.execute(text("select version_num from alembic_version")).scalars().all()
        assert stamped == [_head_revision()]
        # The table whose absence used to abort the upgrade now exists and is
        # queryable through the ORM the seeder would have used.
        tables = inspect(db.engine).get_table_names()
        assert "questions" in tables
        assert len(tables) > 20


def test_every_revision_id_fits_the_column_that_records_it():
    """Revision ids must fit VARCHAR(32), which Alembic hardcodes and cannot widen.

    Postgres enforces that width and SQLite ignores it, so a too-long id passes
    every test above -- they all run on SQLite -- and then fails on the real
    database with

        psycopg.errors.StringDataRightTruncation: value too long for type
        character varying(32)

    at the moment Alembic records the offending revision. That is a failed
    deploy, not a failed test run, and it happened twice:
    `0024_mega_litigation_promotion_limits` was 37 characters. The name is not
    cosmetic, so this asserts on the one property that has to hold.
    """
    script = ScriptDirectory(str(MIGRATIONS_DIR))
    too_long = {
        revision.revision: len(revision.revision)
        for revision in script.walk_revisions()
        if len(revision.revision) > 32
    }
    assert not too_long, (
        "these revision ids do not fit alembic_version.version_num, so Postgres "
        f"will reject the upgrade that records them: {too_long}"
    )


def test_boot_seeds_as_soon_as_the_database_is_at_head(
    tmp_path, empty_database, seed_calls, restored_logging
):
    """Skipping the seed is a deferral, not a new way to end up unseeded.

    The deployment order is upgrade-then-serve, so the web process must still
    find itself seeding on boot once the migrations have been applied.
    """
    with create_app(instance_path=str(tmp_path)).app_context():
        upgrade(directory=str(MIGRATIONS_DIR))
    assert seed_calls == []

    create_app(instance_path=str(tmp_path))
    assert seed_calls == [False]


def test_seed_command_refuses_to_run_before_migrations_and_works_after(
    tmp_path, empty_database, seed_calls, restored_logging
):
    """`flask seed` on an unmigrated database says what to do instead of crashing."""
    app = create_app(instance_path=str(tmp_path))

    result = app.test_cli_runner().invoke(args=["seed"])
    assert result.exit_code == 1
    assert "not at the latest migration" in result.output
    assert "flask db upgrade" in result.output
    assert seed_calls == []

    with app.app_context():
        upgrade(directory=str(MIGRATIONS_DIR))

    result = app.test_cli_runner().invoke(args=["seed"])
    assert result.exit_code == 0, result.output
    assert "Seeded" in result.output
    assert seed_calls == [False]
