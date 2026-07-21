"""Add persisted LLM coaching and hint events.

Revision ID: 0002_llm_coaching
Revises: 0001_initial
"""
from alembic import op
import sqlalchemy as sa


revision = "0002_llm_coaching"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("attempts") as batch_op:
        batch_op.add_column(sa.Column("coaching_status", sa.String(30), nullable=False, server_default="pending"))
        batch_op.add_column(sa.Column("coaching_model", sa.String(100), nullable=True))
        batch_op.add_column(sa.Column("coached_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "hint_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("session_item_id", sa.String(36), sa.ForeignKey("session_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("content_json", sa.JSON(), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("prompt_version", sa.String(30), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("session_item_id", "level", name="uq_item_hint_level"),
    )
    op.create_index("ix_hint_events_user_id", "hint_events", ["user_id"])
    op.create_index("ix_hint_events_session_item_id", "hint_events", ["session_item_id"])


def downgrade():
    op.drop_index("ix_hint_events_session_item_id", table_name="hint_events")
    op.drop_index("ix_hint_events_user_id", table_name="hint_events")
    op.drop_table("hint_events")
    with op.batch_alter_table("attempts") as batch_op:
        batch_op.drop_column("coached_at")
        batch_op.drop_column("coaching_model")
        batch_op.drop_column("coaching_status")

