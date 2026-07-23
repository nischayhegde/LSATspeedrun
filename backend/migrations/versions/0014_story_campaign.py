"""Add the persistent story campaign and quest settlement bonus.

Revision ID: 0014_story_campaign
Revises: 0013_empire_expansion
"""

from alembic import op
import sqlalchemy as sa


revision = "0014_story_campaign"
down_revision = "0013_empire_expansion"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "player_story_states",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("profile_id", sa.String(36), sa.ForeignKey("player_profiles.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("ethics", sa.Float(), nullable=False, server_default="70"),
        sa.Column("heat", sa.Float(), nullable=False, server_default="0"),
        sa.Column("influence", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("intel", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("seen_chapters_json", sa.JSON(), nullable=False),
        sa.Column("choices_json", sa.JSON(), nullable=False),
        sa.Column("active_quest_key", sa.String(80), nullable=True),
        sa.Column("quest_progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("quest_history_json", sa.JSON(), nullable=False),
        sa.Column("rival_discounts_json", sa.JSON(), nullable=False),
        sa.Column("operations_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("ethics >= 0 and ethics <= 100", name="ck_story_ethics_range"),
        sa.CheckConstraint("heat >= 0 and heat <= 100", name="ck_story_heat_range"),
        sa.CheckConstraint("influence >= 0 and intel >= 0", name="ck_story_resources_nonnegative"),
        sa.CheckConstraint("quest_progress >= 0", name="ck_story_quest_progress_nonnegative"),
    )
    op.create_index("ix_player_story_states_profile_id", "player_story_states", ["profile_id"])
    with op.batch_alter_table("attempt_settlements") as batch_op:
        for column in ("streak_bonus", "staff_bonus", "contract_bonus"):
            batch_op.alter_column(
                column,
                existing_type=sa.Integer(),
                type_=sa.BigInteger(),
                existing_nullable=False,
            )
        batch_op.add_column(sa.Column("quest_bonus", sa.BigInteger(), nullable=False, server_default="0"))


def downgrade():
    with op.batch_alter_table("attempt_settlements") as batch_op:
        batch_op.drop_column("quest_bonus")
        for column in ("streak_bonus", "staff_bonus", "contract_bonus"):
            batch_op.alter_column(
                column,
                existing_type=sa.BigInteger(),
                type_=sa.Integer(),
                existing_nullable=False,
            )
    op.drop_index("ix_player_story_states_profile_id", table_name="player_story_states")
    op.drop_table("player_story_states")
