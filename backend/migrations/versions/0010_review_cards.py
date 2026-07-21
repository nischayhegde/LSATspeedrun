"""Add spaced-repetition review cards after the resumable story flow.

Revision ID: 0010_review_cards
Revises: 0009_session_sequence_plan
"""
from alembic import op
import sqlalchemy as sa


revision = "0010_review_cards"
down_revision = "0009_session_sequence_plan"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "review_cards",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_id", sa.String(80), sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("box", sa.Integer(), nullable=False),
        sa.Column("reps", sa.Integer(), nullable=False),
        sa.Column("lapses", sa.Integer(), nullable=False),
        sa.Column("last_result", sa.Boolean(), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "question_id", name="uq_user_question_review"),
    )
    op.create_index("ix_review_cards_user_id", "review_cards", ["user_id"])
    op.create_index("ix_review_cards_question_id", "review_cards", ["question_id"])
    op.create_index("ix_review_cards_due_at", "review_cards", ["due_at"])


def downgrade():
    op.drop_index("ix_review_cards_due_at", table_name="review_cards")
    op.drop_index("ix_review_cards_question_id", table_name="review_cards")
    op.drop_index("ix_review_cards_user_id", table_name="review_cards")
    op.drop_table("review_cards")
