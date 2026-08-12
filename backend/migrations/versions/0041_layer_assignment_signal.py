"""Record what a layer's signal said when its arm was drawn.

SINGLE HEAD. `down_revision` is `0040_predicted_retrievability`, added on the
same branch. If a sibling revision lands on 0040 first, renumber and re-chain.

One nullable column on `layer_assignments`, holding a short pipe-separated
string. The spine never parses it; a layer's own reading does.

It exists because a declared population can otherwise be a comment.
`weak_type_targeting` says it is read on later encounters with the types the
student was weak at *when the run was built*, and that list cannot be
reconstructed afterwards — the entire point of the rolling signal is that it
moves as the student improves, so asking today which types were weak in March
returns today's answer. Without this column the delayed reading would quietly
average over every type the student has met since, which is a different
measurement wearing the same name.

No backfill. Rows written before this migration read null, and the readings
that need a signal skip them rather than guessing: an invented list would be a
population definition made up after seeing the outcomes.
"""

from alembic import op
import sqlalchemy as sa


revision = "0041_layer_assignment_signal"
down_revision = "0040_predicted_retrievability"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    return any(entry["name"] == column for entry in sa.inspect(op.get_bind()).get_columns(table))


def upgrade():
    if _has_column("layer_assignments", "signal"):
        return
    with op.batch_alter_table("layer_assignments") as batch_op:
        batch_op.add_column(sa.Column("signal", sa.String(length=240), nullable=True))


def downgrade():
    with op.batch_alter_table("layer_assignments") as batch_op:
        batch_op.drop_column("signal")
