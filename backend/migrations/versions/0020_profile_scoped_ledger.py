"""Scope ledger source keys to the profile that produced them.

`uq_ledger_source` spans (user_id, kind, source_id), so keying a row on a bare
content key — an asset key, a firm tier, a chapter — asserted that a user could
record the event only once in their lifetime. The game rule is per-profile, so a
replacement profile re-earning the same content would collide with the previous
profile's history and fail the insert. `_scoped_source` now names the profile on
every write, and this brings existing rows to the same shape so the constraint
keeps its meaning across old and new data.

Two kinds are deliberately left alone. `opening_balance` is already keyed on the
profile id by itself, which cannot repeat. `local_demo_grant` is written only by
`scripts/seed_demo_learner.py`, whose reset path clears the user's ledger before
re-seeding, so it has no second writer to collide with.

Both statements are idempotent, because the `substr` test only rewrites rows that
are not already in the target shape.

Revision ID: 0020_profile_scoped_ledger
Revises: 0019_explanation_scheduling
"""

from alembic import op
import sqlalchemy as sa


revision = "0020_profile_scoped_ledger"
down_revision = "0019_explanation_scheduling"
branch_labels = None
depends_on = None


UNSCOPED_KINDS = ("opening_balance", "local_demo_grant")

# `passive_collection` composed its own `<profile id>:` prefix at the call site
# before the rule moved into `_scoped_source`, so upgrading leaves those rows
# untouched. Reverting has to leave them alone explicitly: stripping the prefix
# would contradict the restored code, which writes it back.
ALREADY_SCOPED_KINDS = ("passive_collection",)

# A user without a profile cannot have its rows attributed, so `EXISTS` leaves
# them untouched rather than guessing. `||`, `substr`, and `length` behave the
# same on SQLite and PostgreSQL, so one statement serves both.
_REWRITE = """
    UPDATE ledger_entries
       SET source_id = (
               SELECT {replacement}
                 FROM player_profiles p
                WHERE p.user_id = ledger_entries.user_id
           )
     WHERE kind NOT IN :excluded
       AND EXISTS (
               SELECT 1
                 FROM player_profiles p
                WHERE p.user_id = ledger_entries.user_id
                  AND substr(ledger_entries.source_id, 1, length(p.id) + 1) {test} p.id || ':'
           )
"""


def _statement(replacement: str, test: str, excluded: tuple[str, ...]):
    return sa.text(_REWRITE.format(replacement=replacement, test=test)).bindparams(
        sa.bindparam("excluded", value=excluded, expanding=True)
    )


def upgrade():
    op.get_bind().execute(
        _statement(
            "p.id || ':' || ledger_entries.source_id",
            "<>",
            UNSCOPED_KINDS,
        )
    )


def downgrade():
    op.get_bind().execute(
        _statement(
            "substr(ledger_entries.source_id, length(p.id) + 2)",
            "=",
            UNSCOPED_KINDS + ALREADY_SCOPED_KINDS,
        )
    )
