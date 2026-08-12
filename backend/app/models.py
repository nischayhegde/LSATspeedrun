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
    # Onboarding's one extra question. Both nullable: a user can decline to
    # answer, and declining is itself informative (never defaulted to a guess).
    target_score = db.Column(db.Integer, nullable=True)
    target_test_date = db.Column(db.Date, nullable=True)
    # "full" is every current default: office, map, story, and economy chrome
    # visible. "focus" hides that chrome and lands the user on the practice
    # dashboard. Declared intent (168+ or a test inside 8 weeks) only ever sets
    # this once, at onboarding — the user's own toggle always wins afterwards.
    assistance_level = db.Column(db.String(16), nullable=False, default="full")
    # The guided tour is first-use orientation, so "already seen" has to live with
    # the account rather than in one browser's localStorage: clearing storage,
    # switching devices, or opening a private window must not re-block a player's
    # server-persisted progress screens behind 21 steps.
    guided_tour_completed_at = db.Column(db.DateTime(timezone=True), nullable=True)
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
    # Two passages printed together as one set. Written at ingest by
    # `strategies.detect_comparative`, never inferred at read time: the format is
    # a fixed property of the set, so deciding it once is both cheaper and more
    # answerable than re-deciding it on every request. Defaults to false so a
    # passage written by a path that has not learned about the flag is treated
    # as an ordinary single passage rather than crashing the allocator.
    comparative = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())
    # Character offsets in `canonical_text` where each part of the passage begins,
    # first always 0, written at ingest by `passage_structure.derive_paragraphs`.
    # Offsets rather than a second copy of the prose, so a segmentation can never
    # drift from the text it describes.
    #
    # Every passage in this bank arrived as one unbroken blob with no newline
    # anywhere, which left `enforcement.split_paragraphs` returning the whole
    # passage as a single unit — so "give each paragraph its job in three to
    # twelve words" asked for one note on three thousand characters, and
    # `paragraph_function`'s variety check, needing more than one segment to
    # compare, never ran at all.
    #
    # `paragraph_source` says where the boundaries came from, because the two
    # kinds do not deserve equal trust: "authored" means the text carried real
    # breaks, "derived_cohesion_v1" means this application found them by lexical
    # cohesion and they are topical rather than authored. Null on both columns
    # means no segmentation, which reads as one part exactly as it did before
    # these columns existed.
    paragraph_offsets = db.Column(db.JSON, nullable=True)
    paragraph_source = db.Column(db.String(40), nullable=True)
    source = db.Column(db.String(255), nullable=True)
    review_status = db.Column(db.String(60), nullable=False, default="development_only")


class Question(db.Model):
    __tablename__ = "questions"

    id = db.Column(db.String(80), primary_key=True)
    passage_id = db.Column(db.String(80), db.ForeignKey("passages.id"), nullable=True, index=True)
    section = db.Column(db.String(60), nullable=False, index=True)
    question_type = db.Column(db.String(100), nullable=False, index=True)
    # Where the type came from: "inferred" (a rule in `app/question_types.py`
    # matched the stem), "section_placeholder" (nothing matched, so the type is
    # the section's own name and means "unknown"), "authored" (the bank labelled
    # it), or "unrecorded" for rows written before this column existed.
    #
    # The column exists because the placeholder is indistinguishable from a real
    # type by inspection — "Logical Reasoning" is a plausible-looking string —
    # and 45.8% of the bank was carrying one. Four mechanisms read
    # `question_type` and none of them could tell. Recording provenance makes
    # the unknowns countable, which is the only reason the scale of it was
    # findable at all.
    question_type_source = db.Column(
        db.String(24), nullable=False, default="inferred", server_default="unrecorded"
    )
    # An *official* difficulty on the publisher's own 1-5 scale, and nothing
    # else. NULL on all 6,886 rows and expected to stay that way: the upstream
    # datasets carry no difficulty column, and the only per-item LSAT ratings
    # LSAC has ever published cover five of the eighty-five PrepTests in this
    # bank and exist as prose in two copyrighted books. See
    # `docs/question-difficulty.md`.
    #
    # This column was `difficulty`, `nullable=False, default=3`, which put a
    # literal 3 on every question in the bank and then handed it to a language
    # model as if it were a measurement. The rename is the point: an estimate
    # must never be written here, because the whole value of the column is that
    # a number in it means somebody published one. The *estimate* lives in
    # `QuestionCalibration` with its own provenance, and is read through
    # `calibration.signal`.
    published_difficulty = db.Column(db.Integer, nullable=True)
    stimulus = db.Column(db.Text, nullable=True)
    stem = db.Column(db.Text, nullable=False)
    correct_answer = db.Column(db.String(1), nullable=False)
    source = db.Column(db.String(255), nullable=True)
    content_hash = db.Column(db.String(64), nullable=True, index=True)
    license_status = db.Column(db.String(60), nullable=False, default="unknown_needs_verification")
    review_status = db.Column(db.String(60), nullable=False, default="machine_parsed_needs_review")

    passage = db.relationship("Passage")
    choices = db.relationship("QuestionChoice", back_populates="question", cascade="all, delete-orphan", order_by="QuestionChoice.position")
    calibration = db.relationship(
        "QuestionCalibration",
        back_populates="question",
        uselist=False,
        cascade="all, delete-orphan",
    )


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
    # Set only on a blind review, pointing at the diagnostic it retries. Unique,
    # so a form can never grow a second review to compare against.
    diagnostic_session_id = db.Column(
        db.String(36),
        db.ForeignKey("study_sessions.id", ondelete="CASCADE"),
        nullable=True,
        unique=True,
        index=True,
    )
    mode = db.Column(db.String(20), nullable=False, index=True)
    # Which kind of sitting this was: "cases", "diagnostic" or "blind_review".
    # Not a setting — nothing takes it from a caller. Which function built the
    # run decides it, and `services.EVIDENCE_CLASS` is what reads it.
    #
    # The default was "deep" until now, one of four practice styles migration
    # 0021 collapsed into "cases". No run has been created with it since, so
    # the one branch still testing for it was unreachable and is gone; the
    # default follows.
    practice_style = db.Column(db.String(24), nullable=False, default="cases", index=True)
    feedback_policy = db.Column(db.String(20), nullable=False, default="immediate")
    status = db.Column(db.String(20), nullable=False, default="in_progress", index=True)
    target_minutes = db.Column(db.Integer, nullable=False)
    accommodation_multiplier = db.Column(db.Float, nullable=False, default=1.0)
    total_items = db.Column(db.Integer, nullable=False, default=0)
    current_index = db.Column(db.Integer, nullable=False, default=0)
    section_plan_json = db.Column(db.JSON, nullable=True)
    # When the mega-litigation's intermission began. The real LSAT puts a
    # ten-minute break between the second and third sections; this is the only
    # clock on the form that is allowed to elapse without a section running.
    intermission_started_at = db.Column(db.DateTime(timezone=True), nullable=True)
    ended_by_user = db.Column(db.Boolean, nullable=False, default=False)
    summary_json = db.Column(db.JSON, nullable=True)
    pending_attempt_id = db.Column(db.String(36), nullable=True, index=True)
    results_seen_at = db.Column(db.DateTime(timezone=True), nullable=True)
    summary_seen_at = db.Column(db.DateTime(timezone=True), nullable=True)
    started_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    # A whole-form clock, set only for the mega-litigation. Null means the run has
    # no deadline of its own and is paced question by question.
    deadline_at = db.Column(db.DateTime(timezone=True), nullable=True)
    # False on historical completed diagnostics so deploying blind review never
    # puts an already-reviewed form back in front of a learner.
    blind_review_required = db.Column(db.Boolean, nullable=False, default=False)
    completed_at = db.Column(db.DateTime(timezone=True), nullable=True)

    user = db.relationship("User")
    diagnostic_session = db.relationship("StudySession", remote_side=[id], uselist=False)
    items = db.relationship("SessionItem", back_populates="session", cascade="all, delete-orphan", order_by="SessionItem.position")
    sections = db.relationship(
        "SessionSection",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="SessionSection.section_index",
    )


class SessionSection(db.Model):
    """One separately timed section of a mega-litigation.

    The real LSAT is not one long run against one clock: it is four (here
    three, the unscored variable section being omitted) separately timed
    thirty-five-minute sections, and the rule that makes them sections rather
    than labels is that time expiring on one ends it permanently. "During the
    time allotted for each section of the Test, you may work only on that
    section," and once it expires "no additional inputs may be made" — LSAC
    Candidate Agreement 2026-2027, § 15.

    This row is the authority on when a section started, when it must end, and
    whether it has. The client is told how much is left; it is never asked.
    """

    __tablename__ = "session_sections"
    __table_args__ = (UniqueConstraint("session_id", "section_index", name="uq_session_section_index"),)

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    session_id = db.Column(db.String(36), db.ForeignKey("study_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    section_index = db.Column(db.Integer, nullable=False)
    label = db.Column(db.String(60), nullable=False)
    # "Logical Reasoning" or "Reading Comprehension", matching `Question.section`.
    section_type = db.Column(db.String(60), nullable=False)
    start_position = db.Column(db.Integer, nullable=False)
    end_position = db.Column(db.Integer, nullable=False)
    question_count = db.Column(db.Integer, nullable=False)
    time_limit_seconds = db.Column(db.Integer, nullable=False)
    # Intermission owed *after* this section, in seconds. Non-zero on exactly
    # one section per form.
    break_seconds = db.Column(db.Integer, nullable=False, default=0)
    status = db.Column(db.String(20), nullable=False, default="pending", index=True)
    # Set the moment the student starts the section, and never moved again: the
    # deadline is wall-clock from here, so closing a laptop does not buy time.
    started_at = db.Column(db.DateTime(timezone=True), nullable=True)
    deadline_at = db.Column(db.DateTime(timezone=True), nullable=True)
    ended_at = db.Column(db.DateTime(timezone=True), nullable=True)
    # "submitted" (the student ended it early), "expired" (the clock ran out),
    # or "abandoned" (the sitting was walked away from at a boundary).
    ended_reason = db.Column(db.String(20), nullable=True)
    unanswered_count = db.Column(db.Integer, nullable=False, default=0)

    session = db.relationship("StudySession", back_populates="sections")


class SessionItem(db.Model):
    __tablename__ = "session_items"
    __table_args__ = (UniqueConstraint("session_id", "position", name="uq_session_position"),)

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    session_id = db.Column(db.String(36), db.ForeignKey("study_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    question_id = db.Column(db.String(80), db.ForeignKey("questions.id"), nullable=False, index=True)
    position = db.Column(db.Integer, nullable=False)
    section_index = db.Column(db.Integer, nullable=False, default=0)
    requires_reasoning = db.Column(db.Boolean, nullable=False, default=False)
    from_review_queue = db.Column(db.Boolean, nullable=False, default=False)
    strategy_key = db.Column(db.String(80), nullable=True, index=True)
    strategy_variant = db.Column(db.String(20), nullable=True)
    # Propensity of landing in the *observed* arm, and how many candidate
    # approaches were competing for this question — logged at assignment time
    # because adaptive allocation makes both unrecoverable after the fact. See
    # P0-8 / assign_strategy_trial.
    strategy_propensity = db.Column(db.Float, nullable=True)
    strategy_candidates_n = db.Column(db.Integer, nullable=True)
    # --- Which approach (see the `strategy_selection` layer) -----------------
    # Whether this question's approach was chosen by the student's own record
    # or drawn uniformly from the same candidate set, and the probability of
    # the arm that was drawn. Written on control-arm questions too: the arm
    # decides which approach a control question is *filed under*, and if the
    # two offer arms were labelled by different processes the offer trial's own
    # comparison would stop being about the offer. Null where the two arms
    # would pick the same approach anyway — under the coverage target, or on a
    # question with a single candidate — because a row with no counterfactual
    # takes no part in a comparison.
    strategy_selection_arm = db.Column(db.String(12), nullable=True)
    strategy_selection_propensity = db.Column(db.Float, nullable=True)
    # --- Mandatory approaches (see strategies.plan_forced_arms) --------------
    # The approach-by-question-type cell this assignment is charged to, and the
    # probability this question had of being drawn as a mandatory one. The
    # propensity is written on the questions that lost the draw as well as the
    # ones that won it, because the losers are what the winners are compared
    # against. Null means the question was never in a pool: it has no
    # counterfactual for that draw and takes no part in that comparison.
    strategy_stratum = db.Column(db.String(160), nullable=True)
    strategy_forcing_propensity = db.Column(db.Float, nullable=True)
    # How many times the server refused this question's artifact. Counted here
    # rather than in the client because it is what opens the way out of a
    # mandatory approach, and a client that decided that for itself would have
    # the skip button back.
    strategy_gate_rejections = db.Column(db.Integer, nullable=False, default=0)
    # How hard the strategy gate on this question will be: "full" blocks the
    # answer until the approach's operations are done, "light" keeps the prompt
    # but stops blocking once the student has demonstrated the approach enough
    # times, and "none" is every control-arm and untrialled question. Fixed at
    # serve time so a mid-question mastery change cannot move the goalposts.
    # See app/enforcement.py.
    strategy_enforcement_level = db.Column(db.String(12), nullable=False, default="none")
    # Whether this slot was filled with any reference to the question's
    # difficulty. 'blind' is the truth for every row written so far, because
    # selection has never read difficulty at all. A selector that starts reading
    # it must call `calibration.exposure_draw` per slot and write 'random' or
    # 'targeted' here; leaving the default in place would quietly relabel biased
    # exposure as unbiased, which is the one error the difficulty estimate
    # cannot recover from. See `app/calibration.py`.
    exposure_policy = db.Column(db.String(12), nullable=False, default="blind")
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
    # Flagged for review, exactly as the real test's question bar allows. Kept
    # on the item rather than in the browser because "flagged and never
    # returned to" is one of the few honest read-outs on how a section was
    # triaged, and a client-side flag would vanish on reload.
    flagged = db.Column(db.Boolean, nullable=False, default=False)
    # How many times the answer on the sheet was replaced with a different one
    # inside the section. Free navigation makes changing an answer possible for
    # the first time, so this is measured rather than self-reported.
    answer_revisions = db.Column(db.Integer, nullable=False, default=0)
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
    strategy_propensity = db.Column(db.Float, nullable=True)
    strategy_candidates_n = db.Column(db.Integer, nullable=True)
    # Copied off the session item at answer time, like every other arm on this
    # row. See `SessionItem.strategy_selection_arm`.
    strategy_selection_arm = db.Column(db.String(12), nullable=True, index=True)
    strategy_selection_propensity = db.Column(db.Float, nullable=True)
    # What FSRS predicted the chance of recalling this card was, at the moment
    # it came back. Written only on review returns, and only once the card has
    # a memory state, because a model that has not graded a card has made no
    # claim about it. This is the whole instrument for `review_scheduling`: the
    # layer has no holdout, and this column is what lets the scheduler be
    # scored against its own predictions instead. It has to be recorded here
    # rather than derived later, because answering the question is what moves
    # the state the prediction was made from. See `scheduling.review_calibration`.
    predicted_retrievability = db.Column(db.Float, nullable=True)
    # --- Enforced strategy use (see app/enforcement.py) ----------------------
    # `strategy_applied` above is a self-report about a private mental act.
    # These columns are the observable version of the same claim. `satisfied`
    # means the student cleared the gate for the strategy they opted into,
    # `skipped` means they declined it or dropped it partway, `attested` means
    # a mastery-relaxed gate took their word for it, `stood_down` means the
    # approach was mandatory and they were let out of it, and `unenforced`
    # means no gate was armed at all.
    strategy_gate_status = db.Column(db.String(20), nullable=True, index=True)
    # Copied off the session item at submit time so an analysis never has to
    # join back to it. See the same three columns on SessionItem.
    strategy_stratum = db.Column(db.String(160), nullable=True)
    strategy_forcing_propensity = db.Column(db.Float, nullable=True)
    strategy_gate_rejections = db.Column(db.Integer, nullable=False, default=0)
    strategy_enforcement_level = db.Column(db.String(12), nullable=True)
    # Which revision of the gates produced this artifact. An analysis must not
    # pool observations taken under different required operations, because that
    # is a different treatment rather than more of the same one.
    strategy_enforcement_version = db.Column(db.String(30), nullable=True)
    strategy_artifact_json = db.Column(db.JSON, nullable=True)
    # Time inside the gate, held apart from `server_elapsed_ms` for the same
    # reason `strategy_prompt_ms` is: enforcement steps inflate per-question
    # time, and a pace comparison that counts them is comparing the scaffolding
    # rather than the reasoning.
    strategy_gate_ms = db.Column(db.Integer, nullable=False, default=0)
    # Advisory only. A model's read on the artifact's quality, written back by
    # the coaching pipeline when it is configured. Never blocks a submission,
    # never reaches the economy, never turns a correct answer into a penalty.
    strategy_artifact_quality = db.Column(db.Float, nullable=True)
    # Copied off the session item at submit time, exactly as the strategy
    # columns above are, so a later refit of the difficulty ratings can restrict
    # itself to unbiased exposure without joining back. See `app/calibration.py`.
    exposure_policy = db.Column(db.String(12), nullable=False, default="blind", index=True)
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
    """Account-bound state for the LSAT Tycoon layer."""

    __tablename__ = "player_profiles"
    __table_args__ = (
        CheckConstraint("character_gender in ('male', 'female')", name="ck_profile_character_gender"),
        CheckConstraint("cash >= 0", name="ck_profile_cash_nonnegative"),
        CheckConstraint("reputation >= 0 and reputation <= 100", name="ck_profile_reputation_range"),
        CheckConstraint("office_tier >= 0 and office_tier <= 14", name="ck_profile_office_tier_range"),
        CheckConstraint("current_streak >= 0 and best_streak >= 0", name="ck_profile_streak_nonnegative"),
        CheckConstraint(
            "daily_streak_current >= 0 and daily_streak_best >= 0",
            name="ck_profile_daily_streak_nonnegative",
        ),
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
    # Distinct from `current_streak`/`best_streak` above, which only count
    # consecutive *validated wins* for the payout bonus. This pair tracks
    # consecutive *calendar days* the account has been active at all (visiting
    # the firm counts; it is not gated on winning, or even on playing a case),
    # advanced once per day in `game.settle_upkeep`.
    daily_streak_current = db.Column(db.Integer, nullable=False, default=0)
    daily_streak_best = db.Column(db.Integer, nullable=False, default=0)
    daily_streak_last_date = db.Column(db.Date, nullable=True)
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
    # A cleared mega-litigation hands over a whole tier for free. Per-session
    # idempotency only ever stopped one form paying twice, so these two columns
    # are what make the bonus occasional: when the last one landed, and how many
    # of the lifetime allowance have been spent.
    mega_litigation_promoted_at = db.Column(db.DateTime(timezone=True), nullable=True)
    mega_litigation_promotions = db.Column(db.Integer, nullable=False, default=0)
    # The player's chosen wardrobe, as ``{category: item_key}``. Only categories
    # the player has actually changed appear here: an empty mapping means "wear
    # the firm's issue", which is the look every existing account already has,
    # so no backfill is needed and the 3D rig keeps its seed-derived defaults.
    # Keys are validated against `game.WARDROBE_BY_KEY` on write, so nothing
    # unowned or unknown can reach storage.
    cosmetics_json = db.Column(db.JSON, nullable=False, default=dict)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)

    user = db.relationship("User", back_populates="game_profile")
    assets = db.relationship("PlayerAsset", back_populates="profile", cascade="all, delete-orphan")
    territories = db.relationship(
        "PlayerTerritory",
        back_populates="profile",
        cascade="all, delete-orphan",
    )
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
        CheckConstraint("casework_spent >= 0", name="ck_story_casework_nonnegative"),
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
    # Rival operations are bought with casework, not with time. This is the
    # high-water mark of `PlayerProfile.total_validated_correct` already spent
    # on them, so the balance available to the war room is the number of cases
    # the student has actually won with a valid write-up and not yet committed.
    # Storing the mark rather than a balance means the two counters can never
    # drift: casework cannot be granted by anything except settling a case.
    casework_spent = db.Column(db.Integer, nullable=False, default=0)
    # "The player has read the closing record." Kept with the account for the
    # same reason as `users.guided_tour_completed_at`: the epilogue is a
    # full-screen, once-ever layer, so a browser-local marker meant a finished
    # player was handed the whole final record again on a second device or after
    # clearing site data.
    epilogue_read_at = db.Column(db.DateTime(timezone=True), nullable=True)
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


class PlayerTerritory(db.Model):
    """One district the firm holds a standing retainer over.

    Deliberately its own table rather than another `asset_type` on
    `PlayerAsset`. `game._owned_keys` reads every asset row into one namespace
    that requirement checks, payout multipliers, reputation guards, and the
    tier-advance prerequisite list all consult, and a district belongs in none
    of them: it pays no payout multiplier, gates no headquarters, and is never
    a prerequisite for anything in the asset catalog. Keeping the two apart is
    what stops a retainer quietly becoming an eligible answer to "does this
    firm own everything tier N requires".
    """

    __tablename__ = "player_territories"
    __table_args__ = (
        UniqueConstraint("profile_id", "district_key", name="uq_profile_territory"),
        CheckConstraint("purchase_price >= 0", name="ck_player_territory_price"),
    )

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    profile_id = db.Column(
        db.String(36),
        db.ForeignKey("player_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    district_key = db.Column(db.String(80), nullable=False, index=True)
    region_key = db.Column(db.String(30), nullable=False, index=True)
    purchase_price = db.Column(db.BigInteger, nullable=False)
    secured_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    profile = db.relationship("PlayerProfile", back_populates="territories")


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


class QuestionCalibration(db.Model):
    """What has been learned about one question's difficulty, and from what.

    One row per question that has ever been answered. A question with no row has
    not been answered and has no difficulty — that absence is the honest empty
    state the whole bank is in today, and it is why nothing here has a default
    that could be mistaken for a measurement.

    The estimator is in `app/calibration.py`. Read it before reading a value out
    of this table, because two of these columns are not what they look like:
    `rating` is in logits and is only meaningful relative to the bank's mean
    (`calibration.scale_centre`), and `blind_rating` is a second, deliberately
    partial estimate that exists to be compared against the first.
    """

    __tablename__ = "question_calibrations"

    question_id = db.Column(
        db.String(80),
        db.ForeignKey("questions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # Difficulty in logits: the θ at which a student has an even chance of the
    # item, above the guessing floor. Higher is harder. Not centred — see
    # `calibration.scale_centre`.
    rating = db.Column(db.Float, nullable=False, default=0.0)
    # Σ Fisher information, which is what the standard error is 1/√ of. Kept
    # rather than derived from `responses` because a response from a student far
    # above or below the item says almost nothing about it, and counting it the
    # same as an informative one is how an estimate acquires false confidence.
    information = db.Column(db.Float, nullable=False, default=0.0)
    responses = db.Column(db.Integer, nullable=False, default=0)
    correct = db.Column(db.Integer, nullable=False, default=0)
    # The same estimate built only from responses whose exposure could not have
    # depended on difficulty. Identical to `rating` while nothing targets;
    # divergence afterwards is the measurement of selection bias rather than the
    # worry about it. See `calibration.exposure_draw`.
    blind_rating = db.Column(db.Float, nullable=False, default=0.0)
    blind_information = db.Column(db.Float, nullable=False, default=0.0)
    blind_responses = db.Column(db.Integer, nullable=False, default=0)
    targeted_responses = db.Column(db.Integer, nullable=False, default=0)
    # 'uncalibrated' | 'provisional' | 'estimated' | 'calibrated' — how much
    # evidence there is. Derived from `responses` and `information` on every
    # update by `calibration.status_for`; stored so a consumer can filter in SQL
    # without recomputing it per row.
    status = db.Column(db.String(20), nullable=False, default="uncalibrated", index=True)
    # 'responses' | 'simulated' | 'imported' | 'official' — where the evidence
    # came from. Separate from `status` because fifty real responses and fifty
    # from a demo seeder are the same amount of evidence and not the same
    # evidence, and only one of them should ever reach a student.
    origin = db.Column(db.String(20), nullable=False, default="responses", index=True)
    first_response_at = db.Column(db.DateTime(timezone=True), nullable=True)
    last_response_at = db.Column(db.DateTime(timezone=True), nullable=True)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)

    question = db.relationship("Question", back_populates="calibration")


class LearnerRating(db.Model):
    """The other side of the match: one student's ability, in the same logits.

    Not a score and not shown to anybody. It exists because an item's difficulty
    cannot be estimated from raw accuracy — a question is not hard because weak
    students missed it — so every update needs an opponent rating to be
    surprised relative to.

    Scoped per section. A single θ per student would let weakness at Reading
    Comprehension make Logical Reasoning items look easy, which is precisely the
    confound the item rating exists to remove.
    """

    __tablename__ = "learner_ratings"
    __table_args__ = (UniqueConstraint("user_id", "scope", name="uq_learner_rating_scope"),)

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # A `Question.section` value today. A string rather than an enum so a later
    # per-question-type ability does not need a migration to exist.
    scope = db.Column(db.String(60), nullable=False)
    rating = db.Column(db.Float, nullable=False, default=0.0)
    information = db.Column(db.Float, nullable=False, default=0.0)
    responses = db.Column(db.Integer, nullable=False, default=0)
    correct = db.Column(db.Integer, nullable=False, default=0)
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
    # --- FSRS memory state (see app/scheduling.py) ---------------------------
    # Stability is the interval, in days, at which recall probability falls to
    # the algorithm's desired retention; difficulty is the item's 1-10 intrinsic
    # hardness for this student. Both are null until the card's first graded
    # review, which is what tells `scheduling` to use the initial-state formulas
    # rather than the update ones. `interval_index` above is kept so the older
    # ladder-based rows stay readable and so nothing that reads it breaks.
    stability = db.Column(db.Float, nullable=True)
    difficulty = db.Column(db.Float, nullable=True)
    reps = db.Column(db.Integer, nullable=False, default=0)
    lapses = db.Column(db.Integer, nullable=False, default=0)
    last_grade = db.Column(db.Integer, nullable=True)
    last_reviewed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    # The memory state as it stood *before* the pending attempt was applied.
    # An answer is scheduled twice — provisionally on submit, then again when
    # the explanation grade lands 20-30 seconds later — and the second pass has
    # to recompute from the same starting point rather than compound on top of
    # the first. Exactly the role `pre_grade_interval_index` played for the old
    # ladder; `grade_pending` is still the flag that says these are live.
    pre_grade_stability = db.Column(db.Float, nullable=True)
    pre_grade_difficulty = db.Column(db.Float, nullable=True)
    pre_grade_reviewed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)

    question = db.relationship("Question")


class LayerAssignment(db.Model):
    """One draw of one adaptive layer's arm, for one student, on one encounter.

    The measurement spine's whole persistent state — see `app/experiments.py`
    for what it is for. Four properties of this table are load-bearing and each
    of them is a lesson from the strategy trial rather than a preference:

    `exposure` is the encounter the draw belongs to, and it is part of the
    uniqueness key. That is what makes asking twice return the same arm instead
    of redrawing mid-run, and it is what makes a caller who reuses a token
    visible in `experiments.assignment_health` rather than silently
    non-random.

    `propensity` is the probability of the arm that was actually drawn, under
    the shares in force at the moment of the draw. A later inverse-propensity
    fit trusts this column, so it records what happened rather than what the
    design intended, and nothing rewrites it afterwards.

    `design_version` moves whenever a layer's arms or shares move, and no
    reading pools two versions. A share retuned halfway through is two
    experiments, not a longer one.

    `session_id` carries no foreign key deliberately. The run's id is minted
    before its row exists — that is what lets a run-level draw happen before
    question selection — so a constraint here would make the ordering
    impossible rather than making the data safer. Nothing reads this column
    except the outcome join, which tolerates a miss.
    """

    __tablename__ = "layer_assignments"
    __table_args__ = (
        UniqueConstraint("layer", "subject_id", "exposure", name="uq_layer_assignment_exposure"),
        CheckConstraint("propensity > 0 and propensity <= 1", name="ck_layer_assignment_propensity"),
    )

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    layer = db.Column(db.String(60), nullable=False, index=True)
    subject_id = db.Column(
        db.String(36), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    unit = db.Column(db.String(16), nullable=False)
    exposure = db.Column(db.String(120), nullable=False)
    arm = db.Column(db.String(40), nullable=False, index=True)
    propensity = db.Column(db.Float, nullable=False)
    design_version = db.Column(db.String(40), nullable=False)
    session_id = db.Column(db.String(36), nullable=True, index=True)
    # What the layer's signal said at the moment of the draw, as a sorted
    # pipe-separated set of tokens, or null for a layer whose reading does not
    # need it. `experiments.signal_tokens` writes it and only set membership is
    # ever read off it.
    #
    # It exists because a layer's declared population can otherwise be a
    # comment rather than a fact: `weak_type_targeting` is read on later
    # encounters with *the types this student was weak at when the run was
    # built*, and that list is not reconstructible afterwards — the whole point
    # of the layer is that it moves as the student improves. Recording it here
    # is the difference between a reading restricted to the population it
    # claims and one that quietly averages over every type in the bank.
    signal = db.Column(db.String(240), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, index=True)


class ScoreProjection(db.Model):
    """One dated estimate of where this student's LSAT score currently sits.

    Persisted rather than recomputed on demand because the point of the number
    is the *line* it draws: an estimate taken today is evidence about today, and
    recomputing history from the current model would erase the fact that the
    estimate itself moved. `model_version` is what makes an old row still
    interpretable after the projection math changes.
    """

    __tablename__ = "score_projections"
    __table_args__ = (
        CheckConstraint("scaled_score >= 120 and scaled_score <= 180", name="ck_projection_scaled_range"),
        CheckConstraint("lower_bound <= scaled_score and scaled_score <= upper_bound", name="ck_projection_band_order"),
    )

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # The point estimate and the honest band around it. The band is the whole
    # product: a single number from a partial-form sample would be a lie about
    # precision the evidence does not support.
    scaled_score = db.Column(db.Integer, nullable=False)
    lower_bound = db.Column(db.Integer, nullable=False)
    upper_bound = db.Column(db.Integer, nullable=False)
    percentile = db.Column(db.Float, nullable=True)
    # Recency- and evidence-weighted proportion correct, and the effective
    # sample size that weighting bought. `effective_sample` is deliberately a
    # float: 40 heavily discounted old attempts are not 40 attempts of evidence.
    estimated_accuracy = db.Column(db.Float, nullable=False)
    effective_sample = db.Column(db.Float, nullable=False)
    observed_attempts = db.Column(db.Integer, nullable=False, default=0)
    lr_attempts = db.Column(db.Integer, nullable=False, default=0)
    rc_attempts = db.Column(db.Integer, nullable=False, default=0)
    evidence_grade = db.Column(db.String(20), nullable=False, default="baseline")
    model_version = db.Column(db.String(30), nullable=False)
    detail_json = db.Column(db.JSON, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, index=True)

    user = db.relationship("User")


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
