from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, UniqueConstraint

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

    game_profile = db.relationship(
        "PlayerProfile",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )


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


class StudySession(db.Model):
    __tablename__ = "study_sessions"

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    mode = db.Column(db.String(20), nullable=False, index=True)
    practice_style = db.Column(db.String(24), nullable=False, default="deep", index=True)
    feedback_policy = db.Column(db.String(20), nullable=False, default="immediate")
    status = db.Column(db.String(20), nullable=False, default="in_progress", index=True)
    target_minutes = db.Column(db.Integer, nullable=False)
    accommodation_multiplier = db.Column(db.Float, nullable=False, default=1.0)
    total_items = db.Column(db.Integer, nullable=False, default=0)
    current_index = db.Column(db.Integer, nullable=False, default=0)
    section_plan_json = db.Column(db.JSON, nullable=True)
    ended_by_user = db.Column(db.Boolean, nullable=False, default=False)
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
    section_index = db.Column(db.Integer, nullable=False, default=0)
    requires_reasoning = db.Column(db.Boolean, nullable=False, default=False)
    strategy_key = db.Column(db.String(80), nullable=True, index=True)
    strategy_variant = db.Column(db.String(20), nullable=True)
    target_time_seconds = db.Column(db.Integer, nullable=False, default=150)
    game_context_json = db.Column(db.JSON, nullable=True)
    timer_compromised = db.Column(db.Boolean, nullable=False, default=False)
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
    __table_args__ = (
        CheckConstraint(
            "confidence is null or (confidence >= 1 and confidence <= 5)",
            name="ck_attempt_confidence_range",
        ),
    )

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    session_item_id = db.Column(db.String(36), db.ForeignKey("session_items.id", ondelete="CASCADE"), unique=True, nullable=False)
    idempotency_key = db.Column(db.String(80), unique=True, nullable=False, index=True)
    selected_label = db.Column(db.String(1), nullable=False)
    is_correct = db.Column(db.Boolean, nullable=False)
    reasoning_text = db.Column(db.Text, nullable=True)
    confidence = db.Column(db.Integer, nullable=True)
    answer_changed = db.Column(db.Boolean, nullable=False, default=False)
    strategy_key = db.Column(db.String(80), nullable=True, index=True)
    strategy_variant = db.Column(db.String(20), nullable=True)
    strategy_applied = db.Column(db.Boolean, nullable=True)
    strategy_prompt_ms = db.Column(db.Integer, nullable=False, default=0)
    evidence_class = db.Column(db.String(32), nullable=False, default="coached_practice", index=True)
    explanation_score = db.Column(db.Float, nullable=True)
    server_elapsed_ms = db.Column(db.Integer, nullable=False)
    client_elapsed_ms = db.Column(db.Integer, nullable=True)
    capm_points = db.Column(db.Float, nullable=False, default=0)
    pace_scored = db.Column(db.Boolean, nullable=False, default=False)
    xp_earned = db.Column(db.Integer, nullable=False, default=0)
    feedback_json = db.Column(db.JSON, nullable=True)
    coaching_status = db.Column(db.String(30), nullable=False, default="pending")
    coaching_started_at = db.Column(db.DateTime(timezone=True), nullable=True)
    coaching_model = db.Column(db.String(100), nullable=True)
    explanation_score_applied = db.Column(db.Boolean, nullable=False, default=False)
    coached_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    session_item = db.relationship("SessionItem", back_populates="attempt")
    settlement = db.relationship(
        "AttemptSettlement",
        back_populates="attempt",
        uselist=False,
        cascade="all, delete-orphan",
    )


class PlayerProfile(db.Model):
    """Account-bound state for the Lawyer Tycoon layer."""

    __tablename__ = "player_profiles"
    __table_args__ = (
        CheckConstraint("character_gender in ('male', 'female')", name="ck_profile_character_gender"),
        CheckConstraint("cash >= 0", name="ck_profile_cash_nonnegative"),
        CheckConstraint("reputation >= 0 and reputation <= 100", name="ck_profile_reputation_range"),
        CheckConstraint("office_tier >= 0 and office_tier <= 14", name="ck_profile_office_tier_range"),
        CheckConstraint("current_streak >= 0 and best_streak >= 0", name="ck_profile_streak_nonnegative"),
    )

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    user_id = db.Column(
        db.String(36),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )
    lawyer_name = db.Column(db.String(50), nullable=False)
    firm_name = db.Column(db.String(80), nullable=False)
    character_gender = db.Column(db.String(12), nullable=False)
    cash = db.Column(db.BigInteger, nullable=False, default=250)
    reputation = db.Column(db.Float, nullable=False, default=50.0)
    office_tier = db.Column(db.Integer, nullable=False, default=0)
    current_streak = db.Column(db.Integer, nullable=False, default=0)
    best_streak = db.Column(db.Integer, nullable=False, default=0)
    total_cases = db.Column(db.Integer, nullable=False, default=0)
    total_correct = db.Column(db.Integer, nullable=False, default=0)
    total_validated_correct = db.Column(db.Integer, nullable=False, default=0)
    lifetime_earnings = db.Column(db.BigInteger, nullable=False, default=250)
    lifetime_spending = db.Column(db.BigInteger, nullable=False, default=0)
    lifetime_rent_paid = db.Column(db.BigInteger, nullable=False, default=0)
    rent_arrears = db.Column(db.BigInteger, nullable=False, default=0)
    # Millionths of a cent carried between settlements. Keeping the fractional
    # remainder prevents frequent page loads from rounding away rent.
    rent_accrual_micros = db.Column(db.BigInteger, nullable=False, default=0)
    active_client_key = db.Column(db.String(60), nullable=False, default="walk_in")
    client_cases_remaining = db.Column(db.Integer, nullable=False, default=10)
    last_passive_collected_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    upkeep_settled_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    last_active_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    game_completed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)

    user = db.relationship("User", back_populates="game_profile")
    assets = db.relationship("PlayerAsset", back_populates="profile", cascade="all, delete-orphan")
    client_contracts = db.relationship(
        "PlayerClientContract",
        back_populates="profile",
        cascade="all, delete-orphan",
    )
    story_state = db.relationship(
        "PlayerStoryState",
        back_populates="profile",
        uselist=False,
        cascade="all, delete-orphan",
    )


class PlayerStoryState(db.Model):
    """Persistent campaign choices, investigations, and rival intelligence."""

    __tablename__ = "player_story_states"
    __table_args__ = (
        CheckConstraint("ethics >= 0 and ethics <= 100", name="ck_story_ethics_range"),
        CheckConstraint("heat >= 0 and heat <= 100", name="ck_story_heat_range"),
        CheckConstraint("influence >= 0 and intel >= 0", name="ck_story_resources_nonnegative"),
        CheckConstraint("quest_progress >= 0", name="ck_story_quest_progress_nonnegative"),
    )

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    profile_id = db.Column(
        db.String(36),
        db.ForeignKey("player_profiles.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )
    ethics = db.Column(db.Float, nullable=False, default=70.0)
    heat = db.Column(db.Float, nullable=False, default=0.0)
    influence = db.Column(db.Integer, nullable=False, default=0)
    intel = db.Column(db.Integer, nullable=False, default=0)
    seen_chapters_json = db.Column(db.JSON, nullable=False, default=list)
    choices_json = db.Column(db.JSON, nullable=False, default=dict)
    active_quest_key = db.Column(db.String(80), nullable=True)
    quest_progress = db.Column(db.Integer, nullable=False, default=0)
    quest_history_json = db.Column(db.JSON, nullable=False, default=list)
    rival_discounts_json = db.Column(db.JSON, nullable=False, default=dict)
    operations_json = db.Column(db.JSON, nullable=False, default=list)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)

    profile = db.relationship("PlayerProfile", back_populates="story_state")


class PlayerAsset(db.Model):
    __tablename__ = "player_assets"
    __table_args__ = (
        UniqueConstraint("profile_id", "asset_key", name="uq_profile_asset"),
        CheckConstraint("level >= 1", name="ck_player_asset_level"),
        CheckConstraint("quantity >= 1", name="ck_player_asset_quantity"),
        CheckConstraint("purchase_price >= 0", name="ck_player_asset_price"),
    )

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    profile_id = db.Column(
        db.String(36),
        db.ForeignKey("player_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    asset_key = db.Column(db.String(80), nullable=False, index=True)
    asset_type = db.Column(db.String(30), nullable=False, index=True)
    level = db.Column(db.Integer, nullable=False, default=1)
    quantity = db.Column(db.Integer, nullable=False, default=1)
    purchase_price = db.Column(db.BigInteger, nullable=False)
    state_json = db.Column(db.JSON, nullable=True)
    purchased_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)

    profile = db.relationship("PlayerProfile", back_populates="assets")


class PlayerClientContract(db.Model):
    __tablename__ = "player_client_contracts"
    __table_args__ = (
        UniqueConstraint("profile_id", "client_key", name="uq_profile_client_contract"),
        CheckConstraint("cases_remaining >= 0", name="ck_client_cases_remaining"),
        CheckConstraint("completed_contracts >= 0", name="ck_client_completed_contracts"),
        CheckConstraint("loyalty >= 0", name="ck_client_loyalty"),
    )

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    profile_id = db.Column(
        db.String(36),
        db.ForeignKey("player_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    client_key = db.Column(db.String(60), nullable=False, index=True)
    cases_remaining = db.Column(db.Integer, nullable=False)
    completed_contracts = db.Column(db.Integer, nullable=False, default=0)
    loyalty = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)

    profile = db.relationship("PlayerProfile", back_populates="client_contracts")


class AttemptSettlement(db.Model):
    """Immutable, exactly-once economy result for one graded answer."""

    __tablename__ = "attempt_settlements"
    __table_args__ = (
        CheckConstraint("total_score >= 1 and total_score <= 20", name="ck_settlement_score_range"),
        CheckConstraint("payout >= 0", name="ck_settlement_payout_nonnegative"),
        CheckConstraint("reputation_after >= 0 and reputation_after <= 100", name="ck_settlement_reputation_range"),
    )

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    attempt_id = db.Column(
        db.String(36),
        db.ForeignKey("attempts.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )
    user_id = db.Column(db.String(36), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    rule_version = db.Column(db.String(30), nullable=False)
    explanation_grade = db.Column(db.String(20), nullable=False)
    explanation_score = db.Column(db.Integer, nullable=False)
    answer_points = db.Column(db.Integer, nullable=False)
    explanation_points = db.Column(db.Integer, nullable=False)
    time_points = db.Column(db.Integer, nullable=False)
    total_score = db.Column(db.Integer, nullable=False)
    target_time_seconds = db.Column(db.Integer, nullable=False)
    elapsed_seconds = db.Column(db.Integer, nullable=False)
    client_key = db.Column(db.String(60), nullable=False)
    base_fee = db.Column(db.BigInteger, nullable=False)
    score_multiplier_bps = db.Column(db.Integer, nullable=False)
    firm_multiplier_bps = db.Column(db.Integer, nullable=False)
    streak_bonus = db.Column(db.BigInteger, nullable=False, default=0)
    staff_bonus = db.Column(db.BigInteger, nullable=False, default=0)
    contract_bonus = db.Column(db.BigInteger, nullable=False, default=0)
    quest_bonus = db.Column(db.BigInteger, nullable=False, default=0)
    payout = db.Column(db.BigInteger, nullable=False)
    reputation_before = db.Column(db.Float, nullable=False)
    reputation_after = db.Column(db.Float, nullable=False)
    reputation_change = db.Column(db.Float, nullable=False)
    validated_credit = db.Column(db.Float, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    attempt = db.relationship("Attempt", back_populates="settlement")


class LedgerEntry(db.Model):
    __tablename__ = "ledger_entries"
    __table_args__ = (
        UniqueConstraint("user_id", "kind", "source_id", name="uq_ledger_source"),
    )

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = db.Column(db.String(40), nullable=False, index=True)
    source_id = db.Column(db.String(100), nullable=False)
    amount = db.Column(db.BigInteger, nullable=False)
    balance_after = db.Column(db.BigInteger, nullable=False)
    detail_json = db.Column(db.JSON, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)


class DailyProgress(db.Model):
    __tablename__ = "daily_progress"
    __table_args__ = (
        UniqueConstraint("profile_id", "activity_date", name="uq_profile_daily_progress"),
    )

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    profile_id = db.Column(
        db.String(36),
        db.ForeignKey("player_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    activity_date = db.Column(db.Date, nullable=False, index=True)
    cases_completed = db.Column(db.Integer, nullable=False, default=0)
    claimed_json = db.Column(db.JSON, nullable=False, default=list)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


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


class ReviewQueueItem(db.Model):
    __tablename__ = "review_queue_items"
    __table_args__ = (UniqueConstraint("user_id", "question_id", name="uq_review_user_question"),)

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    question_id = db.Column(db.String(80), db.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, index=True)
    source_attempt_id = db.Column(db.String(36), db.ForeignKey("attempts.id", ondelete="SET NULL"), nullable=True)
    last_attempt_id = db.Column(db.String(36), db.ForeignKey("attempts.id", ondelete="SET NULL"), nullable=True)
    status = db.Column(db.String(20), nullable=False, default="due", index=True)
    reason_code = db.Column(db.String(40), nullable=False, default="incorrect")
    learner_rule = db.Column(db.Text, nullable=True)
    interval_index = db.Column(db.Integer, nullable=False, default=0)
    grade_pending = db.Column(db.Boolean, nullable=False, default=False)
    pre_grade_interval_index = db.Column(db.Integer, nullable=True)
    due_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, index=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)

    question = db.relationship("Question")


class AiJob(db.Model):
    """Durable state for AI work handed from Flask to SQS/Lambda."""

    __tablename__ = "ai_jobs"

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = db.Column(db.String(30), nullable=False, index=True)
    resource_id = db.Column(db.String(36), nullable=False, index=True)
    dedup_key = db.Column(db.String(120), unique=True, nullable=False)
    status = db.Column(db.String(20), nullable=False, default="queued", index=True)
    payload_json = db.Column(db.JSON, nullable=False, default=dict)
    result_json = db.Column(db.JSON, nullable=True)
    error_message = db.Column(db.Text, nullable=True)
    attempt_count = db.Column(db.Integer, nullable=False, default=0)
    queue_message_id = db.Column(db.String(100), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
    started_at = db.Column(db.DateTime(timezone=True), nullable=True)
    completed_at = db.Column(db.DateTime(timezone=True), nullable=True)

    user = db.relationship("User")
