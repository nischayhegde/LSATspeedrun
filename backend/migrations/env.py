from __future__ import annotations

from contextlib import contextmanager
from logging.config import fileConfig

import sqlalchemy as sa
from alembic import context
from flask import current_app

config = context.config
fileConfig(config.config_file_name)

# Alembic hardcodes `alembic_version.version_num` as VARCHAR(32) and offers no
# option to widen it, so every revision id in this project has to fit. Postgres
# rejects a longer id with `StringDataRightTruncation` while SQLite ignores
# VARCHAR lengths entirely, which means the test suite and any SQLite rehearsal
# pass while the real deploy fails. Revision ids are kept short for that reason;
# `backend/tests/test_bootstrap_migrations.py` enforces the limit so the next
# descriptive name cannot rediscover this against RDS.
#
# This widens the column anyway on Postgres, as a backstop for databases that
# already recorded a long id before the limit was enforced.
VERSION_NUM_LENGTH = 255


def get_engine():
    return current_app.extensions["migrate"].db.engine


def get_metadata():
    return current_app.extensions["migrate"].db.metadata


def widen_version_table(engine):
    """Grow an existing `version_num` column before any revision is stamped.

    This has to run ahead of `run_migrations`, because the failure happens when
    Alembic writes the *next* revision id, not when it reads the current one --
    a database can look perfectly healthy and still be one upgrade away from
    being unable to record where it got to.

    Deliberately on its own connection. Inspecting the migration connection
    begins an implicit transaction, which leaves Alembic's `begin_transaction()`
    nested inside one it does not own, so the commit at the end never lands and
    an apparently successful upgrade rolls back in full. It reported every
    revision as applied and left the database completely empty.

    Only Postgres needs this. SQLite does not enforce VARCHAR lengths and has no
    `ALTER COLUMN TYPE`, so widening there would fail for no benefit.
    """
    if engine.dialect.name != "postgresql":
        return
    with engine.connect() as connection:
        inspector = sa.inspect(connection)
        if not inspector.has_table("alembic_version"):
            return
        for column in inspector.get_columns("alembic_version"):
            if column["name"] != "version_num":
                continue
            length = getattr(column["type"], "length", None)
            if length is not None and length < VERSION_NUM_LENGTH:
                connection.execute(
                    sa.text(
                        "ALTER TABLE alembic_version "
                        f"ALTER COLUMN version_num TYPE VARCHAR({VERSION_NUM_LENGTH})"
                    )
                )
                connection.commit()
            return


@contextmanager
def sqlite_foreign_keys_suspended(connection):
    """Stop SQLite's cascades from firing while a migration reshapes a table.

    `app/extensions.py` enables `PRAGMA foreign_keys` on every SQLite
    connection, which is what the running application wants. It is the wrong
    setting for a migration. SQLite has no real `ALTER TABLE`, so Alembic's
    `batch_alter_table` adds a column or a constraint by building a replacement
    table, copying the rows across, dropping the original and renaming — and
    with foreign keys enforced, `DROP TABLE` performs an implicit `DELETE FROM`
    first. On a table that other tables cascade from, that implicit delete walks
    `ON DELETE CASCADE` into the children and empties them.

    This is not hypothetical. `study_sessions` is the parent of `session_items`,
    which is the parent of `attempts`, and two revisions batch-alter it:
    `0016_learning_modes` and `0023_blind_review`. Upgrading the local
    development database took 3,543 attempts and 4,446 session items to zero and
    reported a successful upgrade — the migration ran, the schema was correct,
    and every answer anybody had ever filed was gone.

    Suspending enforcement for the run rather than inside each revision is
    deliberate: the hazard belongs to "SQLite plus batch mode", not to any one
    migration, and asking every future author to remember a guard is how both of
    those revisions came to be missing it. Integrity is re-checked on the way
    out, so a migration that genuinely orphans a row still fails loudly instead
    of leaving the damage behind.

    Postgres needs none of this: it alters tables in place and never recreates
    one to add a column.
    """
    if connection.dialect.name != "sqlite":
        yield
        return
    # `PRAGMA foreign_keys` is a no-op inside a transaction, and it is
    # connection state rather than transaction state, so it has to be set on the
    # migration's own connection before Alembic opens its transaction.
    connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
    try:
        yield
    finally:
        violations = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        if violations:
            sample = ", ".join(
                f"{row[0]} rowid={row[1]} -> {row[2]}" for row in violations[:5]
            )
            raise RuntimeError(
                f"the migration left {len(violations)} foreign-key violation(s) behind: {sample}"
            )


def run_migrations_offline():
    context.configure(
        url=str(get_engine().url).replace("%", "%%"),
        target_metadata=get_metadata(),
        literal_binds=True,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    engine = get_engine()
    widen_version_table(engine)
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=get_metadata(),
            compare_type=True,
        )
        with sqlite_foreign_keys_suspended(connection):
            with context.begin_transaction():
                context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

