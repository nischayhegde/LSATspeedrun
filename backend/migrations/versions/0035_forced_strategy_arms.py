"""Record the mandatory-approach draw on session items and attempts.

SINGLE HEAD. `down_revision` is `0034_comparative_passages`, which was the only
head when this was written. A second head aborted a production deploy earlier
today; if anything else lands on 0034, this file is the one to rebase.

Six columns, three on each table, all additive and all nullable or defaulted,
so the revision is a pure add and old rows read exactly as they did before.

`strategy_stratum` is the approach-by-question-type cell an assignment was
charged to. `strategy_forcing_propensity` is the probability that question had
of being drawn as a mandatory one — written on the questions that lost the draw
as well as the ones that won it, because a randomized draw is only identified
against the pool it was drawn from. Null means the question was never in a
pool, which is the correct reading for every row that predates this revision:
nothing was mandatory before it, so nothing had a chance of being drawn.

`strategy_gate_rejections` counts the server's own refusals of an artifact. It
is what opens the way out of a mandatory approach, so it cannot live in the
browser. Existing rows take the server default of zero, which is true of them.

No backfill. Every quantity here describes a draw that had not been invented
when the old rows were written, and inventing values for them would put
fabricated propensities into an estimator whose entire job is to weight by
them.
"""

from alembic import op
import sqlalchemy as sa


revision = "0035_forced_strategy_arms"
down_revision = "0034_comparative_passages"
branch_labels = None
depends_on = None


COLUMNS = (
    ("strategy_stratum", lambda: sa.Column("strategy_stratum", sa.String(length=160), nullable=True)),
    ("strategy_forcing_propensity", lambda: sa.Column("strategy_forcing_propensity", sa.Float(), nullable=True)),
    (
        "strategy_gate_rejections",
        lambda: sa.Column("strategy_gate_rejections", sa.Integer(), nullable=False, server_default="0"),
    ),
)


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(entry["name"] == column for entry in inspector.get_columns(table))


def upgrade():
    for table in ("session_items", "attempts"):
        missing = [build() for name, build in COLUMNS if not _has_column(table, name)]
        if not missing:
            continue
        with op.batch_alter_table(table) as batch_op:
            for column in missing:
                batch_op.add_column(column)


def downgrade():
    for table in ("session_items", "attempts"):
        with op.batch_alter_table(table) as batch_op:
            for name, _build in reversed(COLUMNS):
                batch_op.drop_column(name)
