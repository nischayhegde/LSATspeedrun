"""Call a district appointment counsel in the ledger too, not a retainer.

The word "retainer" meant two opposite things in this game. A *client* retainer
is a paying relationship that sets the per-case fee; a *district* appointment
pays no fee at all and buys standing and rent relief. Every string a player
reads was moved to "standing counsel" some time ago, but two pieces of data
kept the old word: the catalog field naming the counterparty
(`district["retainer"]`, e.g. "the duty roster") and the ledger event key
`district_retainer`.

The catalog field is source, so renaming it is an edit. The ledger key is in
the database on every district anyone has ever signed, so it is this.

Only the key changes. `kind` is part of `uq_ledger_source`
(user_id, kind, source_id), and the rename is a bijection on a single value, so
no row can collide with another: two rows that differ only in `kind` would have
to be `district_retainer` and `district_counsel` for the same district, and
nothing has ever written the latter. Amounts, balances and detail are
untouched, so no balance moves.

Nothing outside `game.py` reads the key: the frontend never receives it, and
the only queries against `kind` are equality tests written in the same module
that writes it.

Revision ID: 0037_district_counsel
Revises: 0036_sectioned_exam
"""

from alembic import op
import sqlalchemy as sa


revision = "0037_district_counsel"
down_revision = "0036_sectioned_exam"
branch_labels = None
depends_on = None


def _rename(before: str, after: str) -> None:
    op.execute(
        sa.text("UPDATE ledger_entries SET kind = :after WHERE kind = :before").bindparams(
            after=after, before=before
        )
    )


def upgrade():
    _rename("district_retainer", "district_counsel")


def downgrade():
    _rename("district_counsel", "district_retainer")
