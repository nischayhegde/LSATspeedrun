"""Districts the firm holds a standing retainer over.

`player_territories` is one row per district a player has secured on the world
map. It is deliberately not another `asset_type` on `player_assets`: that table
is read as a single namespace by the tier-advance prerequisite check, the
payout multiplier sum, and the reputation guard sum, and a district belongs in
none of the three. Keeping them apart is what stops a cheap retainer becoming
an accidental answer to "does this firm own everything tier N requires".

Nothing is backfilled. Every existing account correctly holds no districts, and
`game.territory_state` reports an empty board without needing a row.

Revision ID: 0032_district_retainers
Revises: 0031_character_cosmetics
"""

from alembic import op
import sqlalchemy as sa


revision = "0032_district_retainers"
down_revision = "0031_character_cosmetics"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if "player_territories" in inspector.get_table_names():
        return
    op.create_table(
        "player_territories",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("profile_id", sa.String(length=36), nullable=False),
        sa.Column("district_key", sa.String(length=80), nullable=False),
        sa.Column("region_key", sa.String(length=30), nullable=False),
        sa.Column("purchase_price", sa.BigInteger(), nullable=False),
        sa.Column("secured_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["profile_id"], ["player_profiles.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("profile_id", "district_key", name="uq_profile_territory"),
        sa.CheckConstraint("purchase_price >= 0", name="ck_player_territory_price"),
    )
    op.create_index("ix_player_territories_profile_id", "player_territories", ["profile_id"])
    op.create_index("ix_player_territories_district_key", "player_territories", ["district_key"])
    op.create_index("ix_player_territories_region_key", "player_territories", ["region_key"])


def downgrade():
    op.drop_index("ix_player_territories_region_key", table_name="player_territories")
    op.drop_index("ix_player_territories_district_key", table_name="player_territories")
    op.drop_index("ix_player_territories_profile_id", table_name="player_territories")
    op.drop_table("player_territories")
