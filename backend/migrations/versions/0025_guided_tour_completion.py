"""Persist guided-tour completion on the account instead of in browser storage.

Revision ID: 0025_guided_tour_completion
Revises: 0024_mega_litigation_promos
"""

from alembic import op
import sqlalchemy as sa


revision = "0025_guided_tour_completion"
down_revision = "0024_mega_litigation_promos"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(entry["name"] == column for entry in inspector.get_columns(table))


def upgrade():
    # Idempotent because this revision was authored alongside another 0024 and
    # renumbered onto it, so a development database may already carry the column
    # from the earlier numbering.
    if not _has_column("users", "guided_tour_completed_at"):
        with op.batch_alter_table("users") as batch_op:
            batch_op.add_column(sa.Column("guided_tour_completed_at", sa.DateTime(timezone=True), nullable=True))
    # Anyone who has already billed a case has demonstrably been past the tour,
    # so existing accounts are not sent back through it by this deploy.
    op.execute(
        """
        UPDATE users
        SET guided_tour_completed_at = CURRENT_TIMESTAMP
        WHERE guided_tour_completed_at IS NULL
          AND id IN (
            SELECT user_id FROM player_profiles WHERE total_cases > 0
        )
        """
    )


def downgrade():
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("guided_tour_completed_at")
