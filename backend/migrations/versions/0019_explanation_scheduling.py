"""Add explanation-grade scheduling state to the review queue.

Revision ID: 0019_explanation_scheduling
Revises: 0018_office_upkeep
"""

from alembic import op
import sqlalchemy as sa


revision = "0019_explanation_scheduling"
down_revision = "0018_office_upkeep"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("review_queue_items") as batch_op:
        batch_op.add_column(sa.Column("grade_pending", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column("pre_grade_interval_index", sa.Integer(), nullable=True))


def downgrade():
    with op.batch_alter_table("review_queue_items") as batch_op:
        batch_op.drop_column("pre_grade_interval_index")
        batch_op.drop_column("grade_pending")
