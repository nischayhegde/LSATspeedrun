"""Persist the learner's pre-verdict confidence judgment.

Revision ID: 0015_attempt_confidence
Revises: 0014_story_campaign
"""

from alembic import op
import sqlalchemy as sa


revision = "0015_attempt_confidence"
down_revision = "0014_story_campaign"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("attempts") as batch_op:
        batch_op.add_column(sa.Column("confidence", sa.Integer(), nullable=True))
        batch_op.create_check_constraint(
            "ck_attempt_confidence_range",
            "confidence is null or (confidence >= 1 and confidence <= 4)",
        )


def downgrade():
    with op.batch_alter_table("attempts") as batch_op:
        batch_op.drop_constraint("ck_attempt_confidence_range", type_="check")
        batch_op.drop_column("confidence")
