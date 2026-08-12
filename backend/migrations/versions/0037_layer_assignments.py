"""Record which adaptive layers were switched on for which runs.

SINGLE HEAD. `down_revision` was `0036_sectioned_exam`, the only head when this
was written, and this file said it was the one to rebase if another change
landed a revision on 0036 first. Two did: `0037_district_counsel`, already on
the integration branch, and `0037_difficulty_calibration` from the difficulty
work. The chain is now 0036 → district counsel → difficulty calibration → this
→ 0038. The order among them is free, because this table is new and has no
inbound references while the other two touch tables it never reads; it is
rebased last because a one-line edit here was the cheapest of the three.

One new table, `layer_assignments`, and nothing else. It is additive, it has no
inbound references, and every existing row in every existing table reads
exactly as it did before, because the measurement it supports did not exist
when they were written and inventing arms for them would put fabricated
propensities into an estimator whose entire job is to weight by them.

The unique constraint on (layer, subject_id, exposure) is not bookkeeping. It
is the guarantee that a draw is idempotent per encounter: asking twice returns
the recorded arm instead of drawing again, so a student cannot be flipped
mid-run and a share retuned between two calls cannot rewrite what already
happened. See `app/experiments.py`.

`session_id` deliberately carries no foreign key. A run-level draw happens
*before* the run's row exists — that is what lets the arm decide how the run is
built — so a constraint here would forbid the ordering rather than protect the
data.
"""

from alembic import op
import sqlalchemy as sa


revision = "0037_layer_assignments"
down_revision = "0037_difficulty_calibration"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade():
    if _has_table("layer_assignments"):
        return
    op.create_table(
        "layer_assignments",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("layer", sa.String(length=60), nullable=False),
        sa.Column("subject_id", sa.String(length=36), nullable=False),
        sa.Column("unit", sa.String(length=16), nullable=False),
        sa.Column("exposure", sa.String(length=120), nullable=False),
        sa.Column("arm", sa.String(length=40), nullable=False),
        sa.Column("propensity", sa.Float(), nullable=False),
        sa.Column("design_version", sa.String(length=40), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["subject_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("layer", "subject_id", "exposure", name="uq_layer_assignment_exposure"),
        sa.CheckConstraint("propensity > 0 and propensity <= 1", name="ck_layer_assignment_propensity"),
    )
    op.create_index("ix_layer_assignments_layer", "layer_assignments", ["layer"])
    op.create_index("ix_layer_assignments_subject_id", "layer_assignments", ["subject_id"])
    op.create_index("ix_layer_assignments_arm", "layer_assignments", ["arm"])
    op.create_index("ix_layer_assignments_session_id", "layer_assignments", ["session_id"])
    op.create_index("ix_layer_assignments_created_at", "layer_assignments", ["created_at"])


def downgrade():
    op.drop_table("layer_assignments")
