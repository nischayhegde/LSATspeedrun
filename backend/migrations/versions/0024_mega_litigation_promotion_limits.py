"""Per-account cooldown and lifetime allowance for free mega-litigation promotions.

Revision ID: 0024_mega_litigation_promotion_limits
Revises: 0023_focus_mode_and_propensity
"""

from alembic import op
import sqlalchemy as sa


revision = "0024_mega_litigation_promotion_limits"
down_revision = "0023_focus_mode_and_propensity"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("player_profiles") as batch_op:
        batch_op.add_column(
            sa.Column("mega_litigation_promoted_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.add_column(
            sa.Column(
                "mega_litigation_promotions",
                sa.Integer(),
                nullable=False,
                server_default="0",
            )
        )
    # Existing accounts may already hold tiers they were handed for free. Seed
    # the counter from the ledger so the lifetime allowance means the same thing
    # for them as it does for a new account, and start the cooldown from their
    # most recent promotion rather than from the deploy.
    op.execute(
        """
        UPDATE player_profiles
           SET mega_litigation_promotions = COALESCE((
                   SELECT COUNT(*) FROM ledger_entries
                    WHERE ledger_entries.user_id = player_profiles.user_id
                      AND ledger_entries.kind = 'mega_litigation_promotion'
               ), 0),
               mega_litigation_promoted_at = (
                   SELECT MAX(ledger_entries.created_at) FROM ledger_entries
                    WHERE ledger_entries.user_id = player_profiles.user_id
                      AND ledger_entries.kind = 'mega_litigation_promotion'
               )
        """
    )


def downgrade():
    with op.batch_alter_table("player_profiles") as batch_op:
        batch_op.drop_column("mega_litigation_promotions")
        batch_op.drop_column("mega_litigation_promoted_at")
