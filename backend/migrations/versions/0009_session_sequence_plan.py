"""Persist the LLM-planned question order and cohesive session arc.

Revision ID: 0009_session_sequence_plan
Revises: 0008_evidence_timer_activation
"""
from alembic import op
import sqlalchemy as sa


revision = "0009_session_sequence_plan"
down_revision = "0008_evidence_timer_activation"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("study_sessions") as batch_op:
        batch_op.add_column(sa.Column("sequence_plan_json", sa.JSON(), nullable=True))


def downgrade():
    with op.batch_alter_table("study_sessions") as batch_op:
        batch_op.drop_column("sequence_plan_json")
