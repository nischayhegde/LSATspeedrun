"""Focus Mode onboarding fields, plus per-observation strategy-trial propensity.

Revision ID: 0023_focus_mode_and_propensity
Revises: 0022_mega_litigation_deadline
"""

from alembic import op
import sqlalchemy as sa


revision = "0023_focus_mode_and_propensity"
down_revision = "0022_mega_litigation_deadline"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("target_score", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("target_test_date", sa.Date(), nullable=True))
        batch_op.add_column(
            sa.Column("assistance_level", sa.String(length=16), nullable=False, server_default="full")
        )
    with op.batch_alter_table("session_items") as batch_op:
        batch_op.add_column(sa.Column("strategy_propensity", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("strategy_candidates_n", sa.Integer(), nullable=True))
    with op.batch_alter_table("attempts") as batch_op:
        batch_op.add_column(sa.Column("strategy_propensity", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("strategy_candidates_n", sa.Integer(), nullable=True))


def downgrade():
    with op.batch_alter_table("attempts") as batch_op:
        batch_op.drop_column("strategy_candidates_n")
        batch_op.drop_column("strategy_propensity")
    with op.batch_alter_table("session_items") as batch_op:
        batch_op.drop_column("strategy_candidates_n")
        batch_op.drop_column("strategy_propensity")
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("assistance_level")
        batch_op.drop_column("target_test_date")
        batch_op.drop_column("target_score")
