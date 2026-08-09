"""Upgrading an existing SQLite database must not delete anybody's history.

The hazard is specific and it has already cost real data. SQLite cannot alter a
table in place, so Alembic's `batch_alter_table` builds a replacement, copies the
rows across, and drops the original. `app/extensions.py` enables
`PRAGMA foreign_keys` on every SQLite connection — correct for the running app —
and with enforcement on, SQLite's `DROP TABLE` performs an implicit `DELETE FROM`
before removing the table. If the table being recreated is a cascade parent, that
implicit delete walks `ON DELETE CASCADE` into the children and empties them.

`study_sessions` is exactly such a parent: `session_items` cascades from it and
`attempts` cascades from `session_items`. Migration `0023_blind_review` batch-
altered it without disabling foreign keys, and applying it to the local
development database took 3,543 attempts and 3,543 session items to zero while
reporting a successful upgrade. `0013_empire_expansion` had already met the same
hazard and guarded against it; nothing enforced that the next migration would.

This test enforces it, and it does so without naming any revision: it stops
partway down the chain, plants a row in each cascade child, runs the rest of the
chain, and requires the rows to still be there. Any future migration that
recreates a cascade parent unguarded fails here rather than in production.
"""

from __future__ import annotations

import logging

import pytest
from alembic.script import ScriptDirectory
from flask_migrate import upgrade
from sqlalchemy import text

from app import MIGRATIONS_DIR, create_app
from app.extensions import db

# The revision to plant data at. It has to be old enough that `study_sessions`,
# `session_items` and `attempts` all exist, and it must sit below the revisions
# under test. Everything from here to head then runs against populated tables.
PLANT_AT = "0012_lawyer_tycoon"

# The cascade chain under test, parents first. Only the columns that identify a
# row or point at its parent are spelled out; every other NOT NULL column is
# filled from the schema as it stands at `PLANT_AT`, so this test does not have to
# be revised each time an unrelated column is added.
PLANTED: dict[str, dict[str, object]] = {
    "users": {"id": "u-keep", "email": "keep@localhost.test"},
    "questions": {"id": "q-keep", "section": "Logical Reasoning", "correct_answer": "A"},
    "study_sessions": {"id": "s-keep", "user_id": "u-keep", "mode": "practice", "status": "completed"},
    "session_items": {"id": "i-keep", "session_id": "s-keep", "question_id": "q-keep"},
    "attempts": {
        "id": "a-keep",
        "user_id": "u-keep",
        "session_item_id": "i-keep",
        "idempotency_key": "k-keep",
        "selected_label": "A",
    },
}


def _placeholder(declared_type: str) -> object:
    kind = (declared_type or "").upper()
    if "INT" in kind:
        return 1
    if any(marker in kind for marker in ("REAL", "FLOA", "DOUB", "NUMERIC")):
        return 1.0
    if "BOOL" in kind:
        return 0
    if "DATE" in kind or "TIME" in kind:
        return "2026-01-01 00:00:00"
    if "JSON" in kind:
        return "{}"
    return "x"


def _plant(connection, table: str, given: dict[str, object]) -> None:
    """Insert one row, filling whatever else the current schema insists on."""
    values = dict(given)
    for column in connection.exec_driver_sql(f"PRAGMA table_info({table})").mappings():
        name = column["name"]
        if name in values or not column["notnull"] or column["dflt_value"] is not None:
            continue
        values[name] = _placeholder(column["type"])
    columns = ", ".join(values)
    markers = ", ".join(f":{name}" for name in values)
    connection.execute(text(f"insert into {table} ({columns}) values ({markers})"), values)


@pytest.fixture
def restored_logging():
    """`migrations/env.py` calls `fileConfig`, which mutes loggers it does not name."""
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


def _head_revision() -> str:
    heads = ScriptDirectory(str(MIGRATIONS_DIR)).get_heads()
    assert len(heads) == 1, f"the migration chain has {len(heads)} heads: {heads}"
    return heads[0]


def test_upgrading_a_populated_database_keeps_every_row(tmp_path, monkeypatch, restored_logging):
    path = tmp_path / "populated.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{path}")
    monkeypatch.delenv("DATABASE_SECRET_ARN", raising=False)
    monkeypatch.setenv("AUTO_SEED", "false")
    monkeypatch.setenv("FLASK_ENV", "development")

    app = create_app(instance_path=str(tmp_path))
    with app.app_context():
        upgrade(directory=str(MIGRATIONS_DIR), revision=PLANT_AT)

        with db.engine.begin() as connection:
            assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1, (
                "this test is only meaningful with foreign keys enforced, which is "
                "how the application connects"
            )
            for table, given in PLANTED.items():
                _plant(connection, table, given)

        upgrade(directory=str(MIGRATIONS_DIR))

        with db.engine.connect() as connection:
            stamped = connection.execute(text("select version_num from alembic_version")).scalars().all()
            assert stamped == [_head_revision()]
            survivors = {
                table: connection.exec_driver_sql(f"select count(*) from {table}").scalar()
                for table in PLANTED
            }

    emptied = [table for table, count in survivors.items() if count != 1]
    assert not emptied, (
        "a migration between "
        f"{PLANT_AT} and {_head_revision()} deleted rows it was only meant to alter "
        f"the shape of: {emptied}. A SQLite batch_alter_table on a cascade parent "
        "must wrap itself in PRAGMA foreign_keys=OFF inside an autocommit_block; "
        "see 0013_empire_expansion and 0023_blind_review."
    )
