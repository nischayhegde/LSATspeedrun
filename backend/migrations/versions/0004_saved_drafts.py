"""Persist in-progress answer and reasoning drafts.

Revision ID: 0004_saved_drafts
Revises: 0003_resumable_flow
"""
from alembic import op
import sqlalchemy as sa


revision = "0004_saved_drafts"
down_revision = "0003_resumable_flow"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("session_items") as batch_op:
        batch_op.add_column(sa.Column("draft_selected_label", sa.String(1), nullable=True))
        batch_op.add_column(sa.Column("draft_reasoning_text", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("draft_updated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    with op.batch_alter_table("session_items") as batch_op:
        batch_op.drop_column("draft_updated_at")
        batch_op.drop_column("draft_reasoning_text")
        batch_op.drop_column("draft_selected_label")
