from __future__ import annotations

import sqlite3

import pytest
from sqlalchemy import Column, MetaData, String, Table, create_engine, insert, update

from app.extensions import db  # noqa: F401 - importing registers SQLite connection safeguards
from scripts.migrate_sqlite_to_postgres import (
    REQUIRED_TARGET_REVISION,
    validate_sqlite_foreign_keys,
    validate_target_revision,
)


def test_sqlite_connections_enforce_foreign_keys():
    engine = create_engine("sqlite:///:memory:")

    with engine.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1


def test_source_foreign_key_violations_abort_copy(tmp_path):
    database_path = tmp_path / "invalid.db"
    connection = sqlite3.connect(database_path)
    try:
        connection.executescript(
            """
            PRAGMA foreign_keys=OFF;
            CREATE TABLE parent (id INTEGER PRIMARY KEY);
            CREATE TABLE child (
                id INTEGER PRIMARY KEY,
                parent_id INTEGER NOT NULL REFERENCES parent(id)
            );
            INSERT INTO child (id, parent_id) VALUES (1, 404);
            """
        )
        connection.commit()
    finally:
        connection.close()

    engine = create_engine(f"sqlite:///{database_path.as_posix()}")
    with pytest.raises(SystemExit, match=r"foreign-key integrity check failed.*child rowid=1 -> parent"):
        validate_sqlite_foreign_keys(engine)


def test_target_must_be_at_lawyer_tycoon_revision():
    engine = create_engine("sqlite:///:memory:")
    metadata = MetaData()
    alembic_version = Table(
        "alembic_version",
        metadata,
        Column("version_num", String(32), nullable=False),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(insert(alembic_version).values(version_num="0011_async_ai_jobs"))

    with engine.connect() as connection:
        with pytest.raises(SystemExit, match=rf"{REQUIRED_TARGET_REVISION}.*0011_async_ai_jobs"):
            validate_target_revision(connection, alembic_version)

    with engine.begin() as connection:
        connection.execute(
            update(alembic_version).values(version_num=REQUIRED_TARGET_REVISION)
        )

    with engine.connect() as connection:
        validate_target_revision(connection, alembic_version)
