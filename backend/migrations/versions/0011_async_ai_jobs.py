"""Add durable queue state for SQS/Lambda AI workers.

Revision ID: 0011_async_ai_jobs
Revises: 0010_review_cards
"""

from alembic import op
import sqlalchemy as sa


revision = "0011_async_ai_jobs"
down_revision = "0010_review_cards"
branch_labels = None
depends_on = None


def upgrade():
    # Older development builds called ``db.create_all()`` before Alembic owned
    # this table. Accept that exact pre-created schema so those workspaces can
    # advance from 0010 instead of failing with "table already exists".
    inspector = sa.inspect(op.get_bind())
    if "ai_jobs" in inspector.get_table_names():
        expected_columns = {
            "id", "user_id", "kind", "resource_id", "dedup_key", "status",
            "payload_json", "result_json", "error_message", "attempt_count",
            "queue_message_id", "created_at", "updated_at", "started_at",
            "completed_at",
        }
        existing_columns = {column["name"] for column in inspector.get_columns("ai_jobs")}
        missing_columns = expected_columns - existing_columns
        if missing_columns:
            raise RuntimeError(
                "The pre-existing ai_jobs table is incomplete; missing: "
                + ", ".join(sorted(missing_columns))
            )
        existing_indexes = {index["name"] for index in inspector.get_indexes("ai_jobs")}
        for name, column in (
            ("ix_ai_jobs_user_id", "user_id"),
            ("ix_ai_jobs_kind", "kind"),
            ("ix_ai_jobs_resource_id", "resource_id"),
            ("ix_ai_jobs_status", "status"),
        ):
            if name not in existing_indexes:
                op.create_index(name, "ai_jobs", [column])
        return

    op.create_table(
        "ai_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("resource_id", sa.String(36), nullable=False),
        sa.Column("dedup_key", sa.String(120), nullable=False, unique=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="queued"),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("queue_message_id", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_ai_jobs_user_id", "ai_jobs", ["user_id"])
    op.create_index("ix_ai_jobs_kind", "ai_jobs", ["kind"])
    op.create_index("ix_ai_jobs_resource_id", "ai_jobs", ["resource_id"])
    op.create_index("ix_ai_jobs_status", "ai_jobs", ["status"])


def downgrade():
    op.drop_index("ix_ai_jobs_status", table_name="ai_jobs")
    op.drop_index("ix_ai_jobs_resource_id", table_name="ai_jobs")
    op.drop_index("ix_ai_jobs_kind", table_name="ai_jobs")
    op.drop_index("ix_ai_jobs_user_id", table_name="ai_jobs")
    op.drop_table("ai_jobs")
