"""Remember how the player dresses their own counsel.

The 3D character on the office page, in the office scene, and on the world map
is built procedurally from a palette seed, so every account with the same
gender has always looked identical. `player_profiles.cosmetics_json` gives the
player a wardrobe: a mapping of ``{category: item_key}`` covering the suit,
neckwear, hair, eyewear, and one accessory.

Only the categories a player has deliberately changed are stored. An empty
mapping — which is what every existing account starts with, and what the server
default writes — means "as issued", and the rig falls back to exactly the
seed-derived look it renders today. That is why there is no backfill here: the
absence of a choice is itself the correct historical value.

Unlock state is not stored. Every item's condition is evaluated against
progression the profile already records (firm tier, reputation, cases settled,
story chapters seen), so there is nothing to keep in sync.

Revision ID: 0031_character_cosmetics
Revises: 0030_epilogue_acknowledgement
"""

from alembic import op
import sqlalchemy as sa


revision = "0031_character_cosmetics"
down_revision = "0030_epilogue_acknowledgement"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(entry["name"] == column for entry in inspector.get_columns(table))


def upgrade():
    if _has_column("player_profiles", "cosmetics_json"):
        return
    with op.batch_alter_table("player_profiles") as batch_op:
        batch_op.add_column(
            sa.Column("cosmetics_json", sa.JSON(), nullable=False, server_default="{}")
        )


def downgrade():
    with op.batch_alter_table("player_profiles") as batch_op:
        batch_op.drop_column("cosmetics_json")
