"""Add account-bound Lawyer Tycoon progression and settlements.

Revision ID: 0012_lawyer_tycoon
Revises: 0011_async_ai_jobs
"""

from alembic import op
import sqlalchemy as sa


revision = "0012_lawyer_tycoon"
down_revision = "0011_async_ai_jobs"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "session_items",
        sa.Column("target_time_seconds", sa.Integer(), nullable=False, server_default="150"),
    )
    op.add_column("session_items", sa.Column("game_context_json", sa.JSON(), nullable=True))
    op.add_column(
        "session_items",
        sa.Column("timer_compromised", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.create_table(
        "player_profiles",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("lawyer_name", sa.String(50), nullable=False),
        sa.Column("firm_name", sa.String(80), nullable=False),
        sa.Column("character_gender", sa.String(12), nullable=False),
        sa.Column("cash", sa.BigInteger(), nullable=False, server_default="250"),
        sa.Column("reputation", sa.Float(), nullable=False, server_default="50"),
        sa.Column("office_tier", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("current_streak", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("best_streak", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_cases", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_correct", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_validated_correct", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lifetime_earnings", sa.BigInteger(), nullable=False, server_default="250"),
        sa.Column("lifetime_spending", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("active_client_key", sa.String(60), nullable=False, server_default="walk_in"),
        sa.Column("client_cases_remaining", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("last_passive_collected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("character_gender in ('male', 'female')", name="ck_profile_character_gender"),
        sa.CheckConstraint("cash >= 0", name="ck_profile_cash_nonnegative"),
        sa.CheckConstraint("reputation >= 0 and reputation <= 100", name="ck_profile_reputation_range"),
        sa.CheckConstraint("office_tier >= 0 and office_tier <= 6", name="ck_profile_office_tier_range"),
        sa.CheckConstraint("current_streak >= 0 and best_streak >= 0", name="ck_profile_streak_nonnegative"),
    )
    op.create_index("ix_player_profiles_user_id", "player_profiles", ["user_id"])

    op.create_table(
        "player_assets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("profile_id", sa.String(36), sa.ForeignKey("player_profiles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("asset_key", sa.String(80), nullable=False),
        sa.Column("asset_type", sa.String(30), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("purchase_price", sa.BigInteger(), nullable=False),
        sa.Column("state_json", sa.JSON(), nullable=True),
        sa.Column("purchased_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("profile_id", "asset_key", name="uq_profile_asset"),
        sa.CheckConstraint("level >= 1", name="ck_player_asset_level"),
        sa.CheckConstraint("quantity >= 1", name="ck_player_asset_quantity"),
        sa.CheckConstraint("purchase_price >= 0", name="ck_player_asset_price"),
    )
    op.create_index("ix_player_assets_profile_id", "player_assets", ["profile_id"])
    op.create_index("ix_player_assets_asset_key", "player_assets", ["asset_key"])
    op.create_index("ix_player_assets_asset_type", "player_assets", ["asset_type"])

    op.create_table(
        "player_client_contracts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("profile_id", sa.String(36), sa.ForeignKey("player_profiles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("client_key", sa.String(60), nullable=False),
        sa.Column("cases_remaining", sa.Integer(), nullable=False),
        sa.Column("completed_contracts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("loyalty", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("profile_id", "client_key", name="uq_profile_client_contract"),
        sa.CheckConstraint("cases_remaining >= 0", name="ck_client_cases_remaining"),
        sa.CheckConstraint("completed_contracts >= 0", name="ck_client_completed_contracts"),
        sa.CheckConstraint("loyalty >= 0", name="ck_client_loyalty"),
    )
    op.create_index("ix_player_client_contracts_profile_id", "player_client_contracts", ["profile_id"])
    op.create_index("ix_player_client_contracts_client_key", "player_client_contracts", ["client_key"])

    op.create_table(
        "attempt_settlements",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("attempt_id", sa.String(36), sa.ForeignKey("attempts.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rule_version", sa.String(30), nullable=False),
        sa.Column("explanation_grade", sa.String(20), nullable=False),
        sa.Column("explanation_score", sa.Integer(), nullable=False),
        sa.Column("answer_points", sa.Integer(), nullable=False),
        sa.Column("explanation_points", sa.Integer(), nullable=False),
        sa.Column("time_points", sa.Integer(), nullable=False),
        sa.Column("total_score", sa.Integer(), nullable=False),
        sa.Column("target_time_seconds", sa.Integer(), nullable=False),
        sa.Column("elapsed_seconds", sa.Integer(), nullable=False),
        sa.Column("client_key", sa.String(60), nullable=False),
        sa.Column("base_fee", sa.Integer(), nullable=False),
        sa.Column("score_multiplier_bps", sa.Integer(), nullable=False),
        sa.Column("firm_multiplier_bps", sa.Integer(), nullable=False),
        sa.Column("streak_bonus", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("staff_bonus", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("contract_bonus", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("payout", sa.BigInteger(), nullable=False),
        sa.Column("reputation_before", sa.Float(), nullable=False),
        sa.Column("reputation_after", sa.Float(), nullable=False),
        sa.Column("reputation_change", sa.Float(), nullable=False),
        sa.Column("validated_credit", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("total_score >= 1 and total_score <= 20", name="ck_settlement_score_range"),
        sa.CheckConstraint("payout >= 0", name="ck_settlement_payout_nonnegative"),
        sa.CheckConstraint("reputation_after >= 0 and reputation_after <= 100", name="ck_settlement_reputation_range"),
    )
    op.create_index("ix_attempt_settlements_attempt_id", "attempt_settlements", ["attempt_id"])
    op.create_index("ix_attempt_settlements_user_id", "attempt_settlements", ["user_id"])

    op.create_table(
        "ledger_entries",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("source_id", sa.String(100), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("balance_after", sa.BigInteger(), nullable=False),
        sa.Column("detail_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "kind", "source_id", name="uq_ledger_source"),
    )
    op.create_index("ix_ledger_entries_user_id", "ledger_entries", ["user_id"])
    op.create_index("ix_ledger_entries_kind", "ledger_entries", ["kind"])

    op.create_table(
        "daily_progress",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("profile_id", sa.String(36), sa.ForeignKey("player_profiles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("activity_date", sa.Date(), nullable=False),
        sa.Column("cases_completed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("claimed_json", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("profile_id", "activity_date", name="uq_profile_daily_progress"),
    )
    op.create_index("ix_daily_progress_profile_id", "daily_progress", ["profile_id"])
    op.create_index("ix_daily_progress_activity_date", "daily_progress", ["activity_date"])


def downgrade():
    op.drop_index("ix_daily_progress_activity_date", table_name="daily_progress")
    op.drop_index("ix_daily_progress_profile_id", table_name="daily_progress")
    op.drop_table("daily_progress")
    op.drop_index("ix_ledger_entries_kind", table_name="ledger_entries")
    op.drop_index("ix_ledger_entries_user_id", table_name="ledger_entries")
    op.drop_table("ledger_entries")
    op.drop_index("ix_attempt_settlements_user_id", table_name="attempt_settlements")
    op.drop_index("ix_attempt_settlements_attempt_id", table_name="attempt_settlements")
    op.drop_table("attempt_settlements")
    op.drop_index("ix_player_client_contracts_client_key", table_name="player_client_contracts")
    op.drop_index("ix_player_client_contracts_profile_id", table_name="player_client_contracts")
    op.drop_table("player_client_contracts")
    op.drop_index("ix_player_assets_asset_type", table_name="player_assets")
    op.drop_index("ix_player_assets_asset_key", table_name="player_assets")
    op.drop_index("ix_player_assets_profile_id", table_name="player_assets")
    op.drop_table("player_assets")
    op.drop_index("ix_player_profiles_user_id", table_name="player_profiles")
    op.drop_table("player_profiles")
    op.drop_column("session_items", "timer_compromised")
    op.drop_column("session_items", "game_context_json")
    op.drop_column("session_items", "target_time_seconds")
