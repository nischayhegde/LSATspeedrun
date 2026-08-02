"""Give the mega-litigation a single whole-form deadline.

Revision ID: 0022_mega_litigation_deadline
Revises: 0021_single_practice_mode
"""

from alembic import op
import sqlalchemy as sa


revision = "0022_mega_litigation_deadline"
down_revision = "0021_single_practice_mode"
branch_labels = None
depends_on = None


def upgrade():
    # Left null for every existing row on purpose. A diagnostic that was started
    # under the old per-section clocks never agreed to a whole-form deadline, and
    # backfilling one from `started_at` would expire it retroactively — a student
    # who paused overnight would find the run finished without them. A null
    # deadline means "no whole-form clock", which is exactly what those runs are.
    with op.batch_alter_table("study_sessions") as batch_op:
        batch_op.add_column(sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    with op.batch_alter_table("study_sessions") as batch_op:
        batch_op.drop_column("deadline_at")
