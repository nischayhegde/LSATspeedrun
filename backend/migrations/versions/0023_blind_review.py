"""Add untimed blind review sessions after diagnostics.

Revision ID: 0023_blind_review
Revises: 0022_mega_litigation_deadline
"""

from alembic import op
import sqlalchemy as sa


revision = "0023_blind_review"
down_revision = "0022_mega_litigation_deadline"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("study_sessions") as batch_op:
        batch_op.add_column(
            sa.Column(
                "diagnostic_session_id",
                sa.String(length=36),
                nullable=True,
            )
        )
        batch_op.add_column(
            sa.Column(
                "blind_review_required",
                sa.Boolean(),
                server_default=sa.false(),
                nullable=False,
            )
        )
        batch_op.create_foreign_key(
            "fk_study_sessions_diagnostic_session_id",
            "study_sessions",
            ["diagnostic_session_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_unique_constraint(
            "uq_study_sessions_diagnostic_session_id",
            ["diagnostic_session_id"],
        )
        batch_op.create_index(
            "ix_study_sessions_diagnostic_session_id",
            ["diagnostic_session_id"],
        )

    # In-flight forms receive the new stage when they finish. Completed forms
    # stay untouched so previously released answers are never hidden again.
    op.execute(
        sa.text(
            "UPDATE study_sessions "
            "SET blind_review_required = true "
            "WHERE mode = 'diagnostic' AND status IN ('in_progress', 'paused')"
        )
    )


def downgrade():
    with op.batch_alter_table("study_sessions") as batch_op:
        batch_op.drop_index("ix_study_sessions_diagnostic_session_id")
        batch_op.drop_constraint("uq_study_sessions_diagnostic_session_id", type_="unique")
        batch_op.drop_constraint("fk_study_sessions_diagnostic_session_id", type_="foreignkey")
        batch_op.drop_column("blind_review_required")
        batch_op.drop_column("diagnostic_session_id")
