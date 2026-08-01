"""Collapse the four practice styles into a single "cases" mode.

Revision ID: 0021_single_practice_mode
Revises: 0020_profile_scoped_ledger
"""

from alembic import op
import sqlalchemy as sa


revision = "0021_single_practice_mode"
down_revision = "0020_profile_scoped_ledger"
branch_labels = None
depends_on = None


session_items = sa.table(
    "session_items",
    sa.column("session_id", sa.String),
    sa.column("from_review_queue", sa.Boolean),
)
study_sessions = sa.table(
    "study_sessions",
    sa.column("id", sa.String),
    sa.column("mode", sa.String),
    sa.column("practice_style", sa.String),
    sa.column("feedback_policy", sa.String),
)


def upgrade():
    with op.batch_alter_table("session_items") as batch_op:
        batch_op.add_column(
            sa.Column("from_review_queue", sa.Boolean(), nullable=False, server_default=sa.false())
        )
    # Items served by an old review run are exactly the repairs of the new
    # single mode, so review-recovery history survives the collapse.
    op.execute(
        session_items.update()
        .where(
            session_items.c.session_id.in_(
                sa.select(study_sessions.c.id).where(study_sessions.c.practice_style == "review")
            )
        )
        .values(from_review_queue=True)
    )
    # In-flight runs convert in place. A paused Sprint resumes as a cases run
    # with immediate feedback; force-completing it would destroy queued work to
    # fix a cosmetic inconsistency the student can already discard themselves.
    op.execute(
        study_sessions.update()
        .where(study_sessions.c.mode == "practice")
        .values(practice_style="cases", feedback_policy="immediate")
    )


def downgrade():
    """The original style of a converted session is not recoverable.

    Every practice session becomes 'deep' on the way back, which is the style
    whose behavior 'cases' inherited.
    """
    op.execute(
        study_sessions.update()
        .where(study_sessions.c.mode == "practice")
        .values(practice_style="deep")
    )
    with op.batch_alter_table("session_items") as batch_op:
        batch_op.drop_column("from_review_queue")
