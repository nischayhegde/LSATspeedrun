"""Add recoverable leases for story and coaching jobs.

Revision ID: 0006_llm_job_leases
Revises: 0005_recoverable_debriefs
"""
from alembic import op
import sqlalchemy as sa


revision = "0006_llm_job_leases"
down_revision = "0005_recoverable_debriefs"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("session_items") as batch_op:
        batch_op.add_column(sa.Column("story_generation_status", sa.String(30), nullable=False, server_default="fallback"))
        batch_op.add_column(sa.Column("story_generation_started_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("story_model", sa.String(100), nullable=True))
    with op.batch_alter_table("attempts") as batch_op:
        batch_op.add_column(sa.Column("coaching_started_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("explanation_score_applied", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.execute("UPDATE attempts SET explanation_score_applied = 1 WHERE explanation_score IS NOT NULL")


def downgrade():
    with op.batch_alter_table("attempts") as batch_op:
        batch_op.drop_column("explanation_score_applied")
        batch_op.drop_column("coaching_started_at")
    with op.batch_alter_table("session_items") as batch_op:
        batch_op.drop_column("story_model")
        batch_op.drop_column("story_generation_started_at")
        batch_op.drop_column("story_generation_status")

