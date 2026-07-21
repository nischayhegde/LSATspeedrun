"""Persist unacknowledged debrief and summary state.

Revision ID: 0005_recoverable_debriefs
Revises: 0004_saved_drafts
"""
from alembic import op
import sqlalchemy as sa


revision = "0005_recoverable_debriefs"
down_revision = "0004_saved_drafts"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("study_sessions") as batch_op:
        batch_op.add_column(sa.Column("pending_attempt_id", sa.String(36), nullable=True))
        batch_op.add_column(sa.Column("results_seen_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("summary_seen_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.create_index("ix_study_sessions_pending_attempt_id", ["pending_attempt_id"])
    op.execute("UPDATE study_sessions SET results_seen_at = completed_at WHERE mode = 'diagnostic' AND status = 'completed'")
    op.execute("UPDATE study_sessions SET summary_seen_at = completed_at WHERE mode = 'daily' AND status = 'completed'")


def downgrade():
    with op.batch_alter_table("study_sessions") as batch_op:
        batch_op.drop_index("ix_study_sessions_pending_attempt_id")
        batch_op.drop_column("summary_seen_at")
        batch_op.drop_column("results_seen_at")
        batch_op.drop_column("pending_attempt_id")
