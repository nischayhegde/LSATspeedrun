"""Add personalized LSAT strategy experiment observations.

Revision ID: 0017_strategy_experiments
Revises: 0016_learning_modes
"""

from alembic import op
import sqlalchemy as sa


revision = "0017_strategy_experiments"
down_revision = "0016_learning_modes"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("session_items") as batch_op:
        batch_op.add_column(sa.Column("strategy_key", sa.String(80), nullable=True))
        batch_op.add_column(sa.Column("strategy_variant", sa.String(20), nullable=True))
        batch_op.create_index("ix_session_items_strategy_key", ["strategy_key"])
    with op.batch_alter_table("attempts") as batch_op:
        batch_op.add_column(sa.Column("strategy_key", sa.String(80), nullable=True))
        batch_op.add_column(sa.Column("strategy_variant", sa.String(20), nullable=True))
        batch_op.add_column(sa.Column("strategy_applied", sa.Boolean(), nullable=True))
        batch_op.add_column(sa.Column("strategy_prompt_ms", sa.Integer(), nullable=False, server_default="0"))
        batch_op.create_index("ix_attempts_strategy_key", ["strategy_key"])


def downgrade():
    with op.batch_alter_table("attempts") as batch_op:
        batch_op.drop_index("ix_attempts_strategy_key")
        batch_op.drop_column("strategy_prompt_ms")
        batch_op.drop_column("strategy_applied")
        batch_op.drop_column("strategy_variant")
        batch_op.drop_column("strategy_key")
    with op.batch_alter_table("session_items") as batch_op:
        batch_op.drop_index("ix_session_items_strategy_key")
        batch_op.drop_column("strategy_variant")
        batch_op.drop_column("strategy_key")
