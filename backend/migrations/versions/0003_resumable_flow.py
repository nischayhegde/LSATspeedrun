"""Add resumable timers and persisted story introduction state.

Revision ID: 0003_resumable_flow
Revises: 0002_llm_coaching
"""
from alembic import op
import sqlalchemy as sa


revision = "0003_resumable_flow"
down_revision = "0002_llm_coaching"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("story_intro_seen", sa.Boolean(), nullable=False, server_default=sa.false()))
    with op.batch_alter_table("session_items") as batch_op:
        batch_op.add_column(sa.Column("active_elapsed_ms", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("timer_started_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE session_items SET timer_started_at = served_at WHERE served_at IS NOT NULL AND completed_at IS NULL")


def downgrade():
    with op.batch_alter_table("session_items") as batch_op:
        batch_op.drop_column("paused_at")
        batch_op.drop_column("timer_started_at")
        batch_op.drop_column("active_elapsed_ms")
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("story_intro_seen")
