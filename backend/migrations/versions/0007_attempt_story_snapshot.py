"""Snapshot the exact story revision used when an answer is filed.

Revision ID: 0007_attempt_story_snapshot
Revises: 0006_llm_job_leases
"""
from alembic import op
import sqlalchemy as sa


revision = "0007_attempt_story_snapshot"
down_revision = "0006_llm_job_leases"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("attempts") as batch_op:
        batch_op.add_column(sa.Column("story_snapshot_json", sa.JSON(), nullable=True))


def downgrade():
    with op.batch_alter_table("attempts") as batch_op:
        batch_op.drop_column("story_snapshot_json")
