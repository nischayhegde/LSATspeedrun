from __future__ import annotations

import argparse
import os
from pathlib import Path

from sqlalchemy import MetaData, create_engine, func, insert, select
from sqlalchemy.engine import make_url


REQUIRED_TARGET_REVISION = "0014_story_campaign"


def normalize_postgres_url(value: str) -> str:
    if value.startswith("postgres://"):
        return value.replace("postgres://", "postgresql+psycopg://", 1)
    if value.startswith("postgresql://"):
        return value.replace("postgresql://", "postgresql+psycopg://", 1)
    return value


def configured_url(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise SystemExit(f"Set {name} before running this migration.")
    return value


def validate_source(source_url: str) -> None:
    url = make_url(source_url)
    if not url.drivername.startswith("sqlite"):
        raise SystemExit("SQLITE_DATABASE_URL must use SQLite.")
    if url.database and url.database != ":memory:" and not Path(url.database).is_file():
        raise SystemExit("The configured SQLite database file does not exist.")


def validate_sqlite_foreign_keys(source_engine) -> None:
    with source_engine.connect() as source_connection:
        violations = source_connection.exec_driver_sql("PRAGMA foreign_key_check").mappings().all()
    if not violations:
        return

    examples = ", ".join(
        f"{violation['table']} rowid={violation['rowid']} -> {violation['parent']}"
        for violation in violations[:5]
    )
    remainder = len(violations) - 5
    if remainder > 0:
        examples += f", and {remainder} more"
    raise SystemExit(
        f"SQLite foreign-key integrity check failed with {len(violations)} violation(s): {examples}"
    )


def validate_target_revision(target_connection, alembic_version_table) -> None:
    revisions = set(
        target_connection.execute(select(alembic_version_table.c.version_num)).scalars().all()
    )
    if revisions != {REQUIRED_TARGET_REVISION}:
        found = ", ".join(sorted(revisions)) if revisions else "none"
        raise SystemExit(
            "PostgreSQL must be migrated to Alembic revision "
            f"{REQUIRED_TARGET_REVISION} before copying data; found {found}."
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Copy an existing LSAT Speedrun SQLite database into an empty, migrated PostgreSQL database."
    )
    parser.add_argument("--dry-run", action="store_true", help="Validate both databases without copying rows.")
    args = parser.parse_args()

    source_url = configured_url("SQLITE_DATABASE_URL")
    target_url = normalize_postgres_url(configured_url("DATABASE_URL"))
    validate_source(source_url)
    if not make_url(target_url).drivername.startswith("postgresql"):
        raise SystemExit("DATABASE_URL must use PostgreSQL.")

    source_engine = create_engine(source_url)
    target_engine = create_engine(target_url, pool_pre_ping=True)
    validate_sqlite_foreign_keys(source_engine)
    source_metadata = MetaData()
    target_metadata = MetaData()
    source_metadata.reflect(bind=source_engine)
    target_metadata.reflect(bind=target_engine)

    if not target_metadata.tables or "alembic_version" not in target_metadata.tables:
        raise SystemExit("Run the Alembic migrations against PostgreSQL before copying data.")

    copy_tables = [
        table
        for table in target_metadata.sorted_tables
        if table.name != "alembic_version" and table.name in source_metadata.tables
    ]
    with target_engine.connect() as target_connection:
        validate_target_revision(target_connection, target_metadata.tables["alembic_version"])
        populated = [
            table.name
            for table in copy_tables
            if target_connection.scalar(select(func.count()).select_from(table))
        ]
    if populated:
        raise SystemExit(
            "The PostgreSQL target is not empty; refusing to merge or overwrite: " + ", ".join(populated)
        )

    counts: dict[str, int] = {}
    with source_engine.connect() as source_connection:
        for target_table in copy_tables:
            source_table = source_metadata.tables[target_table.name]
            counts[target_table.name] = source_connection.scalar(
                select(func.count()).select_from(source_table)
            ) or 0
    print("Validated an empty PostgreSQL target.")
    print(f"Source rows: {sum(counts.values())} across {len(copy_tables)} tables.")
    if args.dry_run:
        return

    with source_engine.connect() as source_connection, target_engine.begin() as target_connection:
        for target_table in copy_tables:
            source_table = source_metadata.tables[target_table.name]
            rows = source_connection.execute(select(source_table)).mappings()
            while batch := rows.fetchmany(500):
                target_connection.execute(insert(target_table), [dict(row) for row in batch])
            print(f"Copied {counts[target_table.name]:>6} rows from {target_table.name}.")
    print("SQLite to PostgreSQL migration completed.")


if __name__ == "__main__":
    main()
