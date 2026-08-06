"""Pay for rival operations with casework instead of with time.

The rival war room lets a player weaken a competing firm before acquiring it,
which cuts the acquisition price by up to 45%. Its costs were cash, Intel and
Influence — all of which a patient player can accumulate without answering a
single question, which made the most aggressive part of the firm sim the part
that rewarded practice least.

`player_story_states.casework_spent` closes that. It is a high-water mark of
`player_profiles.total_validated_correct`, so the war room's spendable balance
is always "validated wins earned minus validated wins already committed to
operations". Nothing but settling a real graded attempt can raise the numerator,
so the mechanic cannot be played without studying.

Existing players start at zero spent, which credits them for every validated win
they have already earned rather than resetting their campaign.

Revision ID: 0029_rival_campaign_casework
Revises: 0028_strategy_enforcement
"""

from alembic import op
import sqlalchemy as sa


revision = "0029_rival_campaign_casework"
down_revision = "0028_strategy_enforcement"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(entry["name"] == column for entry in inspector.get_columns(table))


def upgrade():
    if _has_column("player_story_states", "casework_spent"):
        return
    with op.batch_alter_table("player_story_states") as batch_op:
        batch_op.add_column(sa.Column("casework_spent", sa.Integer(), nullable=False, server_default="0"))


def downgrade():
    with op.batch_alter_table("player_story_states") as batch_op:
        batch_op.drop_column("casework_spent")
