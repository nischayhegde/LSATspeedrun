"""Write down what the scheduler predicted, before the answer moves it.

SINGLE HEAD. `down_revision` is `0039_strategy_selection_arm`, added on the same
branch. If a sibling revision lands on 0039 first, renumber and re-chain.

One nullable column on `attempts`, holding the retrievability FSRS predicted
for a card at the moment it came back — the probability the model gave the
student of recalling it, recorded before the answer advanced the memory state
it was computed from.

The reason this cannot be a derived quantity, and therefore the reason it needs
a column at all: answering the question *is* what changes the card. Once
`apply_review` has run, the stability and last-reviewed timestamp the
prediction came from are gone, and there is no history table to reconstruct
them from. A prediction not written down at the time is not recoverable.

There is no backfill and there cannot be one, for the same reason. Every review
answered before this migration reads null, and null here means "the model's
claim about this review was not kept", not "the model made no claim".

What it is for: `review_scheduling` is the one adaptive layer in
`app/experiments.py` with no control arm, because turning FSRS off for a share
of students would mean shipping a scheduler the team believes is worse, per
student, for the life of a trial that this app's scale cannot finish. The
substitute is to score the scheduler against its own predictions, which needs
no comparison group — see `scheduling.review_calibration`. This column is that
instrument's only input.
"""

from alembic import op
import sqlalchemy as sa


revision = "0040_predicted_retrievability"
down_revision = "0039_strategy_selection_arm"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    return any(entry["name"] == column for entry in sa.inspect(op.get_bind()).get_columns(table))


def upgrade():
    if _has_column("attempts", "predicted_retrievability"):
        return
    with op.batch_alter_table("attempts") as batch_op:
        batch_op.add_column(sa.Column("predicted_retrievability", sa.Float(), nullable=True))


def downgrade():
    with op.batch_alter_table("attempts") as batch_op:
        batch_op.drop_column("predicted_retrievability")
