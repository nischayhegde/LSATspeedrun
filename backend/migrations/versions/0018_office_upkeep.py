"""Add office rent, inactivity, and campaign-completion state.

Revision ID: 0018_office_upkeep
Revises: 0017_strategy_experiments
"""

from alembic import op
import sqlalchemy as sa


revision = "0018_office_upkeep"
down_revision = "0017_strategy_experiments"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("player_profiles") as batch_op:
        batch_op.add_column(sa.Column("lifetime_rent_paid", sa.BigInteger(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("rent_arrears", sa.BigInteger(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("rent_accrual_micros", sa.BigInteger(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("upkeep_settled_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")))
        batch_op.add_column(sa.Column("last_active_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")))
        batch_op.add_column(sa.Column("game_completed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    with op.batch_alter_table("player_profiles") as batch_op:
        batch_op.drop_column("game_completed_at")
        batch_op.drop_column("last_active_at")
        batch_op.drop_column("upkeep_settled_at")
        batch_op.drop_column("rent_accrual_micros")
        batch_op.drop_column("rent_arrears")
        batch_op.drop_column("lifetime_rent_paid")
