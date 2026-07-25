"""Add evidence-safe learning modes, diagnostic plans, and spaced review.

Revision ID: 0016_learning_modes
Revises: 0015_attempt_confidence
"""

from alembic import op
import sqlalchemy as sa


revision = "0016_learning_modes"
down_revision = "0015_attempt_confidence"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("study_sessions") as batch_op:
        batch_op.add_column(sa.Column("practice_style", sa.String(24), nullable=False, server_default="deep"))
        batch_op.add_column(sa.Column("feedback_policy", sa.String(20), nullable=False, server_default="immediate"))
        batch_op.add_column(sa.Column("accommodation_multiplier", sa.Float(), nullable=False, server_default="1"))
        batch_op.add_column(sa.Column("section_plan_json", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("ended_by_user", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.create_index("ix_study_sessions_practice_style", ["practice_style"])
    with op.batch_alter_table("session_items") as batch_op:
        batch_op.add_column(sa.Column("section_index", sa.Integer(), nullable=False, server_default="0"))
    with op.batch_alter_table("attempts") as batch_op:
        batch_op.drop_constraint("ck_attempt_confidence_range", type_="check")
        batch_op.create_check_constraint(
            "ck_attempt_confidence_range",
            "confidence is null or (confidence >= 1 and confidence <= 5)",
        )
        batch_op.add_column(sa.Column("answer_changed", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column("evidence_class", sa.String(32), nullable=False, server_default="coached_practice"))
        batch_op.create_index("ix_attempts_evidence_class", ["evidence_class"])

    op.create_table(
        "review_queue_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_id", sa.String(80), sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_attempt_id", sa.String(36), sa.ForeignKey("attempts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("last_attempt_id", sa.String(36), sa.ForeignKey("attempts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="due"),
        sa.Column("reason_code", sa.String(40), nullable=False, server_default="incorrect"),
        sa.Column("learner_rule", sa.Text(), nullable=True),
        sa.Column("interval_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "question_id", name="uq_review_user_question"),
    )
    op.create_index("ix_review_queue_items_user_id", "review_queue_items", ["user_id"])
    op.create_index("ix_review_queue_items_question_id", "review_queue_items", ["question_id"])
    op.create_index("ix_review_queue_items_status", "review_queue_items", ["status"])
    op.create_index("ix_review_queue_items_due_at", "review_queue_items", ["due_at"])


def downgrade():
    op.drop_index("ix_review_queue_items_due_at", table_name="review_queue_items")
    op.drop_index("ix_review_queue_items_status", table_name="review_queue_items")
    op.drop_index("ix_review_queue_items_question_id", table_name="review_queue_items")
    op.drop_index("ix_review_queue_items_user_id", table_name="review_queue_items")
    op.drop_table("review_queue_items")
    with op.batch_alter_table("attempts") as batch_op:
        batch_op.drop_index("ix_attempts_evidence_class")
        batch_op.drop_column("evidence_class")
        batch_op.drop_column("answer_changed")
        batch_op.drop_constraint("ck_attempt_confidence_range", type_="check")
        batch_op.create_check_constraint(
            "ck_attempt_confidence_range",
            "confidence is null or (confidence >= 1 and confidence <= 4)",
        )
    with op.batch_alter_table("session_items") as batch_op:
        batch_op.drop_column("section_index")
    with op.batch_alter_table("study_sessions") as batch_op:
        batch_op.drop_index("ix_study_sessions_practice_style")
        batch_op.drop_column("ended_by_user")
        batch_op.drop_column("section_plan_json")
        batch_op.drop_column("accommodation_multiplier")
        batch_op.drop_column("feedback_policy")
        batch_op.drop_column("practice_style")
