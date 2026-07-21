"""Separate cinematic time from scored evidence time.

Revision ID: 0008_evidence_timer_activation
Revises: 0007_attempt_story_snapshot
"""
from alembic import op
import sqlalchemy as sa


revision = "0008_evidence_timer_activation"
down_revision = "0007_attempt_story_snapshot"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("session_items") as batch_op:
        batch_op.add_column(sa.Column("timer_activated_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE session_items SET timer_activated_at = served_at WHERE timer_started_at IS NOT NULL OR active_elapsed_ms > 0 OR completed_at IS NOT NULL")


def downgrade():
    with op.batch_alter_table("session_items") as batch_op:
        batch_op.drop_column("timer_activated_at")
