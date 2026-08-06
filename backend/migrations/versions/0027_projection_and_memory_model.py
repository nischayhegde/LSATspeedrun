"""Persist score-projection snapshots and per-card FSRS memory state.

Two additions that belong together because they are both "what the app knows
about this student over time" rather than "what happened in one session":

* `score_projections` — a dated 120-180 estimate with its uncertainty band, so
  progress can be charted as a line instead of only read as a current value.
* FSRS columns on `review_queue_items` — stability, difficulty, reps, lapses,
  and the last graded review, replacing the fixed (1, 3, 7, 21)-day ladder.

Existing review rows keep `interval_index` and simply arrive with null
stability/difficulty, which `app.scheduling` reads as "no memory state yet" and
initializes from the next graded review. No backfill is attempted: inventing a
stability for a card whose review history was never recorded under this model
would be a fabricated measurement.

Revision ID: 0027_projection_and_memory_model
Revises: 0026_daily_activity_streak
"""

from alembic import op
import sqlalchemy as sa


revision = "0027_projection_and_memory_model"
down_revision = "0026_daily_activity_streak"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(entry["name"] == column for entry in inspector.get_columns(table))


def _has_table(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def upgrade():
    if not _has_table("score_projections"):
        op.create_table(
            "score_projections",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(length=36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column("scaled_score", sa.Integer(), nullable=False),
            sa.Column("lower_bound", sa.Integer(), nullable=False),
            sa.Column("upper_bound", sa.Integer(), nullable=False),
            sa.Column("percentile", sa.Float(), nullable=True),
            sa.Column("estimated_accuracy", sa.Float(), nullable=False),
            sa.Column("effective_sample", sa.Float(), nullable=False),
            sa.Column("observed_attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("lr_attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("rc_attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("evidence_grade", sa.String(length=20), nullable=False, server_default="baseline"),
            sa.Column("model_version", sa.String(length=30), nullable=False),
            sa.Column("detail_json", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, index=True),
            sa.CheckConstraint("scaled_score >= 120 and scaled_score <= 180", name="ck_projection_scaled_range"),
            sa.CheckConstraint(
                "lower_bound <= scaled_score and scaled_score <= upper_bound",
                name="ck_projection_band_order",
            ),
        )

    with op.batch_alter_table("review_queue_items") as batch_op:
        if not _has_column("review_queue_items", "stability"):
            batch_op.add_column(sa.Column("stability", sa.Float(), nullable=True))
        if not _has_column("review_queue_items", "difficulty"):
            batch_op.add_column(sa.Column("difficulty", sa.Float(), nullable=True))
        if not _has_column("review_queue_items", "reps"):
            batch_op.add_column(sa.Column("reps", sa.Integer(), nullable=False, server_default="0"))
        if not _has_column("review_queue_items", "lapses"):
            batch_op.add_column(sa.Column("lapses", sa.Integer(), nullable=False, server_default="0"))
        if not _has_column("review_queue_items", "last_grade"):
            batch_op.add_column(sa.Column("last_grade", sa.Integer(), nullable=True))
        if not _has_column("review_queue_items", "last_reviewed_at"):
            batch_op.add_column(sa.Column("last_reviewed_at", sa.DateTime(timezone=True), nullable=True))
        if not _has_column("review_queue_items", "pre_grade_stability"):
            batch_op.add_column(sa.Column("pre_grade_stability", sa.Float(), nullable=True))
        if not _has_column("review_queue_items", "pre_grade_difficulty"):
            batch_op.add_column(sa.Column("pre_grade_difficulty", sa.Float(), nullable=True))
        if not _has_column("review_queue_items", "pre_grade_reviewed_at"):
            batch_op.add_column(sa.Column("pre_grade_reviewed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    with op.batch_alter_table("review_queue_items") as batch_op:
        batch_op.drop_column("pre_grade_reviewed_at")
        batch_op.drop_column("pre_grade_difficulty")
        batch_op.drop_column("pre_grade_stability")
        batch_op.drop_column("last_reviewed_at")
        batch_op.drop_column("last_grade")
        batch_op.drop_column("lapses")
        batch_op.drop_column("reps")
        batch_op.drop_column("difficulty")
        batch_op.drop_column("stability")
    op.drop_table("score_projections")
