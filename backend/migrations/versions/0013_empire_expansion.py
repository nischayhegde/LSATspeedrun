"""Expand the legal empire tier and economy ranges.

Revision ID: 0013_empire_expansion
Revises: 0012_lawyer_tycoon
"""

from alembic import op
import sqlalchemy as sa


revision = "0013_empire_expansion"
down_revision = "0012_lawyer_tycoon"
branch_labels = None
depends_on = None


def upgrade():
    # Batch mode safely recreates the SQLite table while PostgreSQL performs
    # the equivalent constraint/type changes transactionally.
    #
    # This revision used to switch `PRAGMA foreign_keys` off and back on around
    # these two blocks, because recreating a cascade parent under SQLite empties
    # its children. That protection now covers the whole run from
    # `migrations/env.py`, and doing it here as well was actively harmful: the
    # `finally` turned enforcement back *on* partway down the chain, which is
    # what left `0016_learning_modes` exposed to the very thing this guard was
    # written for.
    with op.batch_alter_table("player_profiles") as batch_op:
        batch_op.drop_constraint("ck_profile_office_tier_range", type_="check")
        batch_op.create_check_constraint(
            "ck_profile_office_tier_range",
            "office_tier >= 0 and office_tier <= 14",
        )

    with op.batch_alter_table("attempt_settlements") as batch_op:
        batch_op.alter_column(
            "base_fee",
            existing_type=sa.Integer(),
            type_=sa.BigInteger(),
            existing_nullable=False,
        )


def downgrade():
    with op.batch_alter_table("attempt_settlements") as batch_op:
        batch_op.alter_column(
            "base_fee",
            existing_type=sa.BigInteger(),
            type_=sa.Integer(),
            existing_nullable=False,
        )

    with op.batch_alter_table("player_profiles") as batch_op:
        batch_op.drop_constraint("ck_profile_office_tier_range", type_="check")
        batch_op.create_check_constraint(
            "ck_profile_office_tier_range",
            "office_tier >= 0 and office_tier <= 6",
        )
