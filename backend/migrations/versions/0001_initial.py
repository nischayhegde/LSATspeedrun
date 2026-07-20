"""Initial LSAT Sherlock schema.

Revision ID: 0001_initial
Revises:
"""
from alembic import op
import sqlalchemy as sa


revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("google_sub", sa.String(255), nullable=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("display_name", sa.String(120), nullable=False),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column("target_minutes", sa.Integer(), nullable=False),
        sa.Column("onboarding_complete", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("google_sub"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_users_google_sub", "users", ["google_sub"])
    op.create_index("ix_users_email", "users", ["email"])

    op.create_table(
        "passages",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("title", sa.String(255), nullable=True),
        sa.Column("canonical_text", sa.Text(), nullable=False),
        sa.Column("passage_type", sa.String(40), nullable=True),
        sa.Column("source", sa.String(255), nullable=True),
        sa.Column("review_status", sa.String(60), nullable=False),
    )
    op.create_table(
        "questions",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("passage_id", sa.String(80), sa.ForeignKey("passages.id"), nullable=True),
        sa.Column("section", sa.String(60), nullable=False),
        sa.Column("question_type", sa.String(100), nullable=False),
        sa.Column("difficulty", sa.Integer(), nullable=False),
        sa.Column("stimulus", sa.Text(), nullable=True),
        sa.Column("stem", sa.Text(), nullable=False),
        sa.Column("correct_answer", sa.String(1), nullable=False),
        sa.Column("source", sa.String(255), nullable=True),
        sa.Column("content_hash", sa.String(64), nullable=True),
        sa.Column("license_status", sa.String(60), nullable=False),
        sa.Column("review_status", sa.String(60), nullable=False),
    )
    op.create_index("ix_questions_passage_id", "questions", ["passage_id"])
    op.create_index("ix_questions_section", "questions", ["section"])
    op.create_index("ix_questions_question_type", "questions", ["question_type"])
    op.create_index("ix_questions_content_hash", "questions", ["content_hash"])
    op.create_table(
        "question_choices",
        sa.Column("id", sa.String(90), primary_key=True),
        sa.Column("question_id", sa.String(80), sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(1), nullable=False),
        sa.Column("canonical_text", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.UniqueConstraint("question_id", "label", name="uq_question_choice_label"),
    )
    op.create_index("ix_question_choices_question_id", "question_choices", ["question_id"])
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])
    op.create_index("ix_auth_sessions_token_hash", "auth_sessions", ["token_hash"])
    op.create_table(
        "case_frames",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("question_id", sa.String(80), sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("story_version", sa.String(30), nullable=False),
        sa.Column("content_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("prompt_version", sa.String(30), nullable=False),
        sa.Column("model", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("question_id", "story_version", name="uq_question_story_version"),
    )
    op.create_index("ix_case_frames_question_id", "case_frames", ["question_id"])
    op.create_table(
        "study_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mode", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("target_minutes", sa.Integer(), nullable=False),
        sa.Column("total_items", sa.Integer(), nullable=False),
        sa.Column("current_index", sa.Integer(), nullable=False),
        sa.Column("blueprint_version", sa.String(30), nullable=True),
        sa.Column("summary_json", sa.JSON(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_study_sessions_user_id", "study_sessions", ["user_id"])
    op.create_index("ix_study_sessions_mode", "study_sessions", ["mode"])
    op.create_index("ix_study_sessions_status", "study_sessions", ["status"])
    op.create_table(
        "session_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("session_id", sa.String(36), sa.ForeignKey("study_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_id", sa.String(80), sa.ForeignKey("questions.id"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("requires_reasoning", sa.Boolean(), nullable=False),
        sa.Column("story_json", sa.JSON(), nullable=True),
        sa.Column("served_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("session_id", "position", name="uq_session_position"),
    )
    op.create_index("ix_session_items_session_id", "session_items", ["session_id"])
    op.create_index("ix_session_items_question_id", "session_items", ["question_id"])
    op.create_table(
        "attempts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("session_item_id", sa.String(36), sa.ForeignKey("session_items.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("idempotency_key", sa.String(80), nullable=False, unique=True),
        sa.Column("selected_label", sa.String(1), nullable=False),
        sa.Column("is_correct", sa.Boolean(), nullable=False),
        sa.Column("reasoning_text", sa.Text(), nullable=True),
        sa.Column("explanation_score", sa.Float(), nullable=True),
        sa.Column("server_elapsed_ms", sa.Integer(), nullable=False),
        sa.Column("client_elapsed_ms", sa.Integer(), nullable=True),
        sa.Column("capm_points", sa.Float(), nullable=False),
        sa.Column("pace_scored", sa.Boolean(), nullable=False),
        sa.Column("xp_earned", sa.Integer(), nullable=False),
        sa.Column("feedback_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_attempts_user_id", "attempts", ["user_id"])
    op.create_index("ix_attempts_idempotency_key", "attempts", ["idempotency_key"])
    op.create_table(
        "skill_progress",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("skill_name", sa.String(100), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("correct", sa.Integer(), nullable=False),
        sa.Column("explanation_total", sa.Float(), nullable=False),
        sa.Column("explanation_count", sa.Integer(), nullable=False),
        sa.Column("total_time_ms", sa.BigInteger(), nullable=False),
        sa.Column("recent_mistakes", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "skill_name", name="uq_user_skill"),
    )
    op.create_index("ix_skill_progress_user_id", "skill_progress", ["user_id"])
    op.create_index("ix_skill_progress_skill_name", "skill_progress", ["skill_name"])
    op.create_table(
        "story_progress",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("xp", sa.Integer(), nullable=False),
        sa.Column("chapter", sa.Integer(), nullable=False),
        sa.Column("cases_solved", sa.Integer(), nullable=False),
        sa.Column("state_json", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    for table in [
        "story_progress",
        "skill_progress",
        "attempts",
        "session_items",
        "study_sessions",
        "case_frames",
        "auth_sessions",
        "question_choices",
        "questions",
        "passages",
        "users",
    ]:
        op.drop_table(table)

