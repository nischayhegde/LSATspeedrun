from __future__ import annotations

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
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

