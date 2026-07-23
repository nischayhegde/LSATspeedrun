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
    sqlite = op.get_bind().dialect.name == "sqlite"
    if sqlite:
        # SQLite implements batch alteration by replacing the parent table.
        # Foreign keys must be disabled outside a transaction or ON DELETE
        # CASCADE would erase existing assets, contracts, and daily progress.
        with op.get_context().autocommit_block():
            op.execute(sa.text("PRAGMA foreign_keys=OFF"))
    try:
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
    finally:
        if sqlite:
            with op.get_context().autocommit_block():
                op.execute(sa.text("PRAGMA foreign_keys=ON"))


def downgrade():
    sqlite = op.get_bind().dialect.name == "sqlite"
    if sqlite:
        with op.get_context().autocommit_block():
            op.execute(sa.text("PRAGMA foreign_keys=OFF"))
    try:
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
    finally:
        if sqlite:
            with op.get_context().autocommit_block():
                op.execute(sa.text("PRAGMA foreign_keys=ON"))
