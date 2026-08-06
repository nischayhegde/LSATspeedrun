"""Track a simple consecutive-calendar-day activity streak on the profile.

Revision ID: 0026_daily_activity_streak
Revises: 0025_guided_tour_completion
"""

from alembic import op
import sqlalchemy as sa


revision = "0026_daily_activity_streak"
down_revision = "0025_guided_tour_completion"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(entry["name"] == column for entry in inspector.get_columns(table))


def upgrade():
    with op.batch_alter_table("player_profiles") as batch_op:
        if not _has_column("player_profiles", "daily_streak_current"):
            batch_op.add_column(sa.Column("daily_streak_current", sa.Integer(), nullable=False, server_default="0"))
        if not _has_column("player_profiles", "daily_streak_best"):
            batch_op.add_column(sa.Column("daily_streak_best", sa.Integer(), nullable=False, server_default="0"))
        if not _has_column("player_profiles", "daily_streak_last_date"):
            batch_op.add_column(sa.Column("daily_streak_last_date", sa.Date(), nullable=True))
    with op.batch_alter_table("player_profiles") as batch_op:
        batch_op.create_check_constraint(
            "ck_profile_daily_streak_nonnegative",
            "daily_streak_current >= 0 and daily_streak_best >= 0",
        )


def downgrade():
    with op.batch_alter_table("player_profiles") as batch_op:
        batch_op.drop_constraint("ck_profile_daily_streak_nonnegative", type_="check")
        batch_op.drop_column("daily_streak_last_date")
        batch_op.drop_column("daily_streak_best")
        batch_op.drop_column("daily_streak_current")
