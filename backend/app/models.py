from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import UniqueConstraint

from .extensions import db


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    google_sub = db.Column(db.String(255), unique=True, nullable=True, index=True)
    email = db.Column(db.String(320), unique=True, nullable=False, index=True)
    display_name = db.Column(db.String(120), nullable=False)
    avatar_url = db.Column(db.Text, nullable=True)
    target_minutes = db.Column(db.Integer, nullable=False, default=20)
    onboarding_complete = db.Column(db.Boolean, nullable=False, default=False)
    story_intro_seen = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)

    story_progress = db.relationship("StoryProgress", back_populates="user", uselist=False, cascade="all, delete-orphan")


class AuthSession(db.Model):
    __tablename__ = "auth_sessions"

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = db.Column(db.String(64), unique=True, nullable=False, index=True)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)
    revoked_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    user = db.relationship("User")


class Passage(db.Model):
    __tablename__ = "passages"

    id = db.Column(db.String(80), primary_key=True)
    title = db.Column(db.String(255), nullable=True)
    canonical_text = db.Column(db.Text, nullable=False)
    passage_type = db.Column(db.String(40), nullable=True)
    source = db.Column(db.String(255), nullable=True)
    review_status = db.Column(db.String(60), nullable=False, default="development_only")


class Question(db.Model):
    __tablename__ = "questions"

    id = db.Column(db.String(80), primary_key=True)
    passage_id = db.Column(db.String(80), db.ForeignKey("passages.id"), nullable=True, index=True)
    section = db.Column(db.String(60), nullable=False, index=True)
    question_type = db.Column(db.String(100), nullable=False, index=True)
    difficulty = db.Column(db.Integer, nullable=False, default=3)
    stimulus = db.Column(db.Text, nullable=True)
    stem = db.Column(db.Text, nullable=False)
    correct_answer = db.Column(db.String(1), nullable=False)
    source = db.Column(db.String(255), nullable=True)
    content_hash = db.Column(db.String(64), nullable=True, index=True)
    license_status = db.Column(db.String(60), nullable=False, default="unknown_needs_verification")
    review_status = db.Column(db.String(60), nullable=False, default="machine_parsed_needs_review")

    passage = db.relationship("Passage")
    choices = db.relationship("QuestionChoice", back_populates="question", cascade="all, delete-orphan", order_by="QuestionChoice.position")


class QuestionChoice(db.Model):
    __tablename__ = "question_choices"
    __table_args__ = (UniqueConstraint("question_id", "label", name="uq_question_choice_label"),)

    id = db.Column(db.String(90), primary_key=True)
    question_id = db.Column(db.String(80), db.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, index=True)
    label = db.Column(db.String(1), nullable=False)
    canonical_text = db.Column(db.Text, nullable=False)
    position = db.Column(db.Integer, nullable=False)

    question = db.relationship("Question", back_populates="choices")


class CaseFrame(db.Model):
    __tablename__ = "case_frames"
    __table_args__ = (UniqueConstraint("question_id", "story_version", name="uq_question_story_version"),)

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    question_id = db.Column(db.String(80), db.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, index=True)
    story_version = db.Column(db.String(30), nullable=False, default="lantern-v1")
    content_json = db.Column(db.JSON, nullable=False)
    status = db.Column(db.String(30), nullable=False, default="generated")
    prompt_version = db.Column(db.String(30), nullable=False, default="case-frame-v1")
    model = db.Column(db.String(100), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    question = db.relationship("Question")


class StudySession(db.Model):
    __tablename__ = "study_sessions"

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    mode = db.Column(db.String(20), nullable=False, index=True)
    status = db.Column(db.String(20), nullable=False, default="in_progress", index=True)
    target_minutes = db.Column(db.Integer, nullable=False)
    total_items = db.Column(db.Integer, nullable=False, default=0)
    current_index = db.Column(db.Integer, nullable=False, default=0)
    blueprint_version = db.Column(db.String(30), nullable=True)
    sequence_plan_json = db.Column(db.JSON, nullable=True)
    summary_json = db.Column(db.JSON, nullable=True)
    pending_attempt_id = db.Column(db.String(36), nullable=True, index=True)
    results_seen_at = db.Column(db.DateTime(timezone=True), nullable=True)
    summary_seen_at = db.Column(db.DateTime(timezone=True), nullable=True)
    started_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    completed_at = db.Column(db.DateTime(timezone=True), nullable=True)

    user = db.relationship("User")
    items = db.relationship("SessionItem", back_populates="session", cascade="all, delete-orphan", order_by="SessionItem.position")


class SessionItem(db.Model):
    __tablename__ = "session_items"
    __table_args__ = (UniqueConstraint("session_id", "position", name="uq_session_position"),)

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    session_id = db.Column(db.String(36), db.ForeignKey("study_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    question_id = db.Column(db.String(80), db.ForeignKey("questions.id"), nullable=False, index=True)
    position = db.Column(db.Integer, nullable=False)
    requires_reasoning = db.Column(db.Boolean, nullable=False, default=False)
    story_json = db.Column(db.JSON, nullable=True)
    story_generation_status = db.Column(db.String(30), nullable=False, default="fallback")
    story_generation_started_at = db.Column(db.DateTime(timezone=True), nullable=True)
    story_model = db.Column(db.String(100), nullable=True)
    served_at = db.Column(db.DateTime(timezone=True), nullable=True)
    active_elapsed_ms = db.Column(db.Integer, nullable=False, default=0)
    timer_activated_at = db.Column(db.DateTime(timezone=True), nullable=True)
    timer_started_at = db.Column(db.DateTime(timezone=True), nullable=True)
    paused_at = db.Column(db.DateTime(timezone=True), nullable=True)
    draft_selected_label = db.Column(db.String(1), nullable=True)
    draft_reasoning_text = db.Column(db.Text, nullable=True)
    draft_updated_at = db.Column(db.DateTime(timezone=True), nullable=True)
    completed_at = db.Column(db.DateTime(timezone=True), nullable=True)

    session = db.relationship("StudySession", back_populates="items")
    question = db.relationship("Question")
    attempt = db.relationship("Attempt", back_populates="session_item", uselist=False, cascade="all, delete-orphan")


class Attempt(db.Model):
    __tablename__ = "attempts"

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    session_item_id = db.Column(db.String(36), db.ForeignKey("session_items.id", ondelete="CASCADE"), unique=True, nullable=False)
    idempotency_key = db.Column(db.String(80), unique=True, nullable=False, index=True)
    selected_label = db.Column(db.String(1), nullable=False)
    is_correct = db.Column(db.Boolean, nullable=False)
    reasoning_text = db.Column(db.Text, nullable=True)
    explanation_score = db.Column(db.Float, nullable=True)
    server_elapsed_ms = db.Column(db.Integer, nullable=False)
    client_elapsed_ms = db.Column(db.Integer, nullable=True)
    capm_points = db.Column(db.Float, nullable=False, default=0)
    pace_scored = db.Column(db.Boolean, nullable=False, default=False)
    xp_earned = db.Column(db.Integer, nullable=False, default=0)
    feedback_json = db.Column(db.JSON, nullable=True)
    story_snapshot_json = db.Column(db.JSON, nullable=True)
    coaching_status = db.Column(db.String(30), nullable=False, default="pending")
    coaching_started_at = db.Column(db.DateTime(timezone=True), nullable=True)
    coaching_model = db.Column(db.String(100), nullable=True)
    explanation_score_applied = db.Column(db.Boolean, nullable=False, default=False)
    coached_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    session_item = db.relationship("SessionItem", back_populates="attempt")


class HintEvent(db.Model):
    __tablename__ = "hint_events"
    __table_args__ = (UniqueConstraint("session_item_id", "level", name="uq_item_hint_level"),)

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    session_item_id = db.Column(db.String(36), db.ForeignKey("session_items.id", ondelete="CASCADE"), nullable=False, index=True)
    level = db.Column(db.Integer, nullable=False)
    content_json = db.Column(db.JSON, nullable=False)
    model = db.Column(db.String(100), nullable=False)
    prompt_version = db.Column(db.String(30), nullable=False, default="hint-v1")
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    session_item = db.relationship("SessionItem")


class SkillProgress(db.Model):
    __tablename__ = "skill_progress"
    __table_args__ = (UniqueConstraint("user_id", "skill_name", name="uq_user_skill"),)

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    skill_name = db.Column(db.String(100), nullable=False, index=True)
    attempts = db.Column(db.Integer, nullable=False, default=0)
    correct = db.Column(db.Integer, nullable=False, default=0)
    explanation_total = db.Column(db.Float, nullable=False, default=0)
    explanation_count = db.Column(db.Integer, nullable=False, default=0)
    total_time_ms = db.Column(db.BigInteger, nullable=False, default=0)
    recent_mistakes = db.Column(db.Integer, nullable=False, default=0)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class ReviewCard(db.Model):
    __tablename__ = "review_cards"
    __table_args__ = (UniqueConstraint("user_id", "question_id", name="uq_user_question_review"),)

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    question_id = db.Column(db.String(80), db.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, index=True)
    box = db.Column(db.Integer, nullable=False, default=0)
    reps = db.Column(db.Integer, nullable=False, default=0)
    lapses = db.Column(db.Integer, nullable=False, default=0)
    last_result = db.Column(db.Boolean, nullable=True)
    due_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, index=True)
    last_reviewed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    question = db.relationship("Question")


class StoryProgress(db.Model):
    __tablename__ = "story_progress"

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    xp = db.Column(db.Integer, nullable=False, default=0)
    chapter = db.Column(db.Integer, nullable=False, default=1)
    cases_solved = db.Column(db.Integer, nullable=False, default=0)
    state_json = db.Column(db.JSON, nullable=False, default=dict)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)

    user = db.relationship("User", back_populates="story_progress")
