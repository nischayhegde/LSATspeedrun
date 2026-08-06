from __future__ import annotations

import argparse
import hashlib
import json
import random
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import delete

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import create_app
from app.extensions import db
from app.game import (
    FIRM_TIERS,
    LedgerEntry,
    _tier_required_asset_keys,
    advance_firm,
    create_profile,
    purchase_asset,
    serialize_game,
    settle_attempt,
)
from app.models import (
    AiJob,
    Attempt,
    DailyProgress,
    PlayerProfile,
    ReviewQueueItem,
    SessionItem,
    SkillProgress,
    StudySession,
    User,
    utcnow,
)
from app.services import (
    calculate_session_summary,
    create_diagnostic_session,
    create_study_session,
    performance_snapshot,
    submit_attempt,
)


DEMO_VERSION = "local-demo-v1"
DEFAULT_EMAIL = "student@localhost.test"
DIAGNOSTIC_QUESTIONS = 75
DEMO_GRANT = 240_000
WEAK_SKILL_TERMS = ("flaw", "assumption", "weaken")


def _stable_fraction(*parts: object) -> float:
    digest = hashlib.sha256("|".join(str(part) for part in parts).encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") / (2**64 - 1)


def _wrong_label(item: SessionItem) -> str:
    labels = [choice.label for choice in item.question.choices]
    correct_index = labels.index(item.question.correct_answer)
    return labels[(correct_index + 1) % len(labels)]


def _strategy_applied_for_seed(item: SessionItem) -> bool:
    """Bulk seeding skips full enforcement gates — artifacts are per-question."""
    if not item.strategy_key or item.strategy_variant != "prompt":
        return True
    if (item.strategy_enforcement_level or "none") == "full":
        return False
    return True


def _reasoning(item: SessionItem) -> str:
    question = item.question
    correct = next(choice for choice in question.choices if choice.label == question.correct_answer)
    return (
        f"For question {question.id}, I first identify the exact task in the stem: {question.stem[:220]} "
        f"Choice {question.correct_answer} is strongest because its claim, {correct.canonical_text[:260]}, "
        "stays within the supplied evidence while the alternatives add, reverse, or omit a required step."
    )


def _coaching(attempt: Attempt, grade: int | None) -> dict:
    question = attempt.session_item.question
    correct = next(choice for choice in question.choices if choice.label == question.correct_answer)
    selected = next(choice for choice in question.choices if choice.label == attempt.selected_label)
    selected_is_correct = attempt.selected_label == question.correct_answer
    return {
        "provider": "Local deterministic demo",
        "model": DEMO_VERSION,
        "reasoning_effort": "fixture",
        "prompt_version": DEMO_VERSION,
        "explanation_grade": grade,
        "reasoning_verdict": (
            "strong" if grade is not None and grade >= 84 and selected_is_correct
            else "mostly_correct" if grade is not None and selected_is_correct
            else "partial" if grade is not None
            else "not_provided"
        ),
        "reasoning_summary": (
            "The response matched the verified answer and completed the stem's task."
            if selected_is_correct
            else "The response chose a plausible distractor but missed the stem's controlling distinction."
        ),
        "understood_correctly": (
            "The response kept its comparison tied to the stated task."
            if selected_is_correct
            else "The response identified an answer that was relevant to the stimulus, even though it did not finish the task."
        ),
        "first_error": (
            None
            if selected_is_correct or grade is None
            else {
                "code": "attractive_distractor",
                "description": "The comparison stopped at relevance instead of checking whether the choice completed the exact task.",
                "repair": "Restate the stem as a one-line test, then reject every option that fails one word of that test.",
            }
        ),
        "answer_analysis": {
            "correct_answer_explanation": (
                f"Choice {question.correct_answer} is credited because it directly completes the stem's task. "
                f"Its key claim is: {correct.canonical_text[:360]}"
            ),
            "selected_answer_explanation": (
                f"Choice {attempt.selected_label} succeeds because it is the credited response."
                if selected_is_correct
                else f"Choice {attempt.selected_label} is tempting because it echoes the topic, but {selected.canonical_text[:300]} does not complete the exact task."
            ),
            "choice_explanations": [
                {
                    "label": choice.label,
                    "is_correct": choice.label == question.correct_answer,
                    "explanation": (
                        "This choice directly satisfies the verified task."
                        if choice.label == question.correct_answer
                        else "This choice is related to the text but adds, reverses, or omits a step required by the stem."
                    ),
                }
                for choice in question.choices
            ],
        },
        "next_step_hint": "If a choice is merely relevant, test it again against every operative word in the stem.",
        "solution_method": "1) Translate the stem. 2) Locate the controlling evidence. 3) Eliminate choices that change the task.",
        "debrief": "Keep the task visible while comparing choices. Relevance alone is not enough for credit.",
    }


def _assert_local_only(app, email: str) -> None:
    uri = str(app.config["SQLALCHEMY_DATABASE_URI"])
    if app.config.get("ENV") == "production" or not app.config.get("DEV_AUTH_ENABLED"):
        raise RuntimeError("Demo learner seeding requires DEV_AUTH_ENABLED=true outside production.")
    if not uri.startswith("sqlite:"):
        raise RuntimeError("Demo learner seeding is restricted to a local SQLite database.")
    if not email.endswith("@localhost.test"):
        raise RuntimeError("Demo learner seeding only accepts an @localhost.test account.")


def _backup_sqlite_database() -> str | None:
    database = db.engine.url.database
    if not database:
        return None
    source = Path(database).resolve()
    if not source.exists():
        return None
    backup_dir = source.parent / ".demo-backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = backup_dir / f"{source.stem}-{stamp}{source.suffix}"
    shutil.copy2(source, target)
    return str(target)


def _reset_learner(user: User) -> None:
    # Review rows reference attempts, so remove them before deleting the session
    # graph. Auth sessions and the account itself are intentionally preserved.
    db.session.execute(delete(ReviewQueueItem).where(ReviewQueueItem.user_id == user.id))
    db.session.execute(delete(SkillProgress).where(SkillProgress.user_id == user.id))
    db.session.execute(delete(AiJob).where(AiJob.user_id == user.id))
    for session in StudySession.query.filter_by(user_id=user.id).all():
        db.session.delete(session)
    db.session.execute(delete(LedgerEntry).where(LedgerEntry.user_id == user.id))
    if user.game_profile:
        db.session.execute(delete(DailyProgress).where(DailyProgress.profile_id == user.game_profile.id))
        db.session.delete(user.game_profile)
    db.session.commit()
    db.session.expire_all()


def _prepare_profile(user: User) -> PlayerProfile:
    profile = create_profile(
        user,
        {
            "lawyer_name": user.display_name or "Local Student",
            "firm_name": "Founders Row Legal",
            "character_gender": "female",
        },
    )
    profile.cash += DEMO_GRANT
    profile.lifetime_earnings += DEMO_GRANT
    profile.reputation = 38.0
    db.session.add(
        LedgerEntry(
            user_id=user.id,
            kind="local_demo_grant",
            source_id=DEMO_VERSION,
            amount=DEMO_GRANT,
            balance_after=profile.cash,
            detail_json={"label": "Local-only demo progression grant"},
        )
    )
    db.session.commit()

    for target_tier in (1, 2):
        owned = {asset.asset_key for asset in profile.assets}
        for asset_key in _tier_required_asset_keys(target_tier):
            if asset_key not in owned:
                purchase_asset(profile, asset_key)
                owned.add(asset_key)
        advance_firm(profile, target_tier)
    return db.session.get(PlayerProfile, profile.id)


def _session_wrong_positions(session: StudySession, accuracy: float, label: str) -> set[int]:
    items = list(session.items)
    wrong_count = max(0, min(len(items), round(len(items) * (1 - accuracy))))
    ranked = sorted(
        items,
        key=lambda item: _stable_fraction(DEMO_VERSION, label, item.question_id)
        + (
            .28
            if any(term in item.question.question_type.lower() for term in WEAK_SKILL_TERMS)
            else 0
        ),
        reverse=True,
    )
    return {item.position for item in ranked[:wrong_count]}


def _elapsed_for(item: SessionItem, phase: float, label: str) -> int:
    pace_draw = _stable_fraction(label, item.question_id, "pace")
    # Typical LSAT work lands around 75–90 seconds per question once RC passage
    # reading is amortized. A small stable tail exceeds the app's target so the
    # pacing panel has credible, imperfect evidence instead of a perfect score.
    if pace_draw > .90:
        return round(item.target_time_seconds * 1000 * (1.03 + (pace_draw - .90) * .7))
    base_seconds = 82 if item.question.section == "Logical Reasoning" else 78
    variation = .82 + pace_draw * .38
    multiplier = (1.12 - phase * .22) * variation
    return max(32_000, round(base_seconds * 1000 * multiplier))


def _attach_demo_coaching(attempt: Attempt, *, grade: int | None, settle: bool) -> None:
    coaching = _coaching(attempt, grade)
    feedback = dict(attempt.feedback_json or {})
    feedback["coaching"] = coaching
    attempt.feedback_json = feedback
    attempt.coaching_status = "completed"
    attempt.coaching_model = DEMO_VERSION
    attempt.coached_at = utcnow()
    if grade is not None:
        normalized = grade / 100
        attempt.explanation_score = normalized
        attempt.explanation_score_applied = True
        stat = SkillProgress.query.filter_by(
            user_id=attempt.user_id,
            skill_name=attempt.session_item.question.question_type,
        ).first()
        if stat:
            stat.explanation_total += normalized
            stat.explanation_count += 1
    if settle:
        settle_attempt(attempt, coaching)
    attempt.session_item.session.pending_attempt_id = None
    db.session.commit()


def _backdate_session(session: StudySession, completed_at: datetime) -> None:
    attempts = (
        Attempt.query.join(SessionItem)
        .filter(SessionItem.session_id == session.id)
        .order_by(SessionItem.position.asc())
        .all()
    )
    elapsed = sum(attempt.server_elapsed_ms for attempt in attempts)
    started_at = completed_at - timedelta(milliseconds=elapsed)
    cursor = started_at
    session.started_at = started_at
    session.completed_at = completed_at
    session.results_seen_at = completed_at + timedelta(minutes=2)
    session.summary_seen_at = completed_at + timedelta(minutes=2)
    for attempt in attempts:
        item = attempt.session_item
        item.served_at = cursor
        item.timer_activated_at = cursor
        item.completed_at = cursor + timedelta(milliseconds=attempt.server_elapsed_ms)
        attempt.created_at = item.completed_at
        if attempt.coached_at:
            attempt.coached_at = item.completed_at + timedelta(seconds=20)
        if attempt.settlement:
            attempt.settlement.created_at = item.completed_at + timedelta(seconds=20)
        cursor = item.completed_at
    session.summary_json = calculate_session_summary(session)
    db.session.commit()


def _answer_finite_session(
    user: User,
    session: StudySession,
    *,
    accuracy: float,
    phase: float,
    label: str,
    completed_at: datetime,
) -> None:
    wrong_positions = _session_wrong_positions(session, accuracy, label)
    for position in range(session.total_items):
        item = SessionItem.query.filter_by(session_id=session.id, position=position).one()
        item.active_elapsed_ms = _elapsed_for(item, phase, label)
        item.timer_started_at = None
        is_wrong = position in wrong_positions
        confidence = 4 if is_wrong and position % 5 == 0 else 2 if is_wrong else 2 if position % 13 == 0 else 4 + (position % 2)
        requires_reasoning = item.requires_reasoning
        attempt, _ = submit_attempt(
            user,
            session,
            {
                "item_id": item.id,
                "selected_label": _wrong_label(item) if is_wrong else item.question.correct_answer,
                "reasoning": _reasoning(item) if requires_reasoning else None,
                "confidence": confidence,
                "answer_changed": position % 9 == 0,
                # Prompted items need a strategy decision; full gates need artifacts
                # the bulk seeder does not synthesize, so those are recorded as skipped.
                "strategy_applied": _strategy_applied_for_seed(item),
            },
            f"{DEMO_VERSION}:{label}:{position}",
        )
        grade = None if not requires_reasoning else min(94, round(76 + phase * 14 + (position % 4)))
        _attach_demo_coaching(
            attempt,
            grade=grade,
            settle=session.mode == "practice",
        )
    _backdate_session(session, completed_at)


def _normalize_review_queue(user: User) -> None:
    """Give the demo queue a believable spread of FSRS memory states.

    The scheduler reads stability and last-review time, not `interval_index`,
    so a seeded queue has to carry real memory state or every card reads as
    maximally weak. Three cohorts: five slipping (recently lapsed), six holding
    comfortably, and four stable past the mastery horizon.
    """
    rows = ReviewQueueItem.query.filter_by(user_id=user.id).order_by(ReviewQueueItem.question_id.asc()).all()
    now = utcnow()
    keep = rows[:15]
    for row in rows[15:]:
        db.session.delete(row)
    for index, row in enumerate(keep):
        if index < 5:
            # Missed on the last look: relearning, and available right now.
            row.status = "due"
            row.interval_index = 1
            row.stability = 0.6 + index * 0.1
            row.difficulty = 7.4 - index * 0.2
            row.reps = 2 + index
            row.lapses = 1 + index % 2
            row.last_grade = 1
            row.last_reviewed_at = now - timedelta(days=1, hours=index)
            row.due_at = row.last_reviewed_at
        elif index < 11:
            row.status = "due"
            row.interval_index = 2
            row.stability = 9.0 + index
            row.difficulty = 5.2
            row.reps = 3
            row.lapses = 0
            row.last_grade = 3
            row.last_reviewed_at = now - timedelta(days=2 + index - 5)
            row.due_at = now + timedelta(days=3 + index - 5)
        else:
            row.status = "mastered"
            row.interval_index = 4
            row.stability = 74.0 + index
            row.difficulty = 3.4
            row.reps = 5
            row.lapses = 0
            row.last_grade = 4
            row.last_reviewed_at = now - timedelta(days=6)
            row.due_at = now + timedelta(days=21)
    db.session.commit()


def _seed_projection_history(user: User) -> int:
    """Reconstruct the projected-score trend this history would have produced.

    One snapshot per completed run, computed from only the attempts that
    existed at the time and dated to that run's completion — so the demo's
    trend chart shows a real narrowing band rather than a straight line of
    identical points stamped today.
    """
    from app.models import ScoreProjection
    from app.scoring import project_score

    ScoreProjection.query.filter_by(user_id=user.id).delete()
    attempts = (
        Attempt.query.join(SessionItem, Attempt.session_item_id == SessionItem.id)
        .join(StudySession, SessionItem.session_id == StudySession.id)
        .filter(Attempt.user_id == user.id, StudySession.completed_at.isnot(None))
        .order_by(StudySession.completed_at.asc(), Attempt.created_at.asc())
        .all()
    )
    boundaries: dict[datetime, int] = {}
    for index, attempt in enumerate(attempts, start=1):
        boundaries[attempt.session_item.session.completed_at] = index

    written = 0
    for completed_at, cutoff in sorted(boundaries.items()):
        moment = completed_at if completed_at.tzinfo else completed_at.replace(tzinfo=timezone.utc)
        projection = project_score(user, attempts=attempts[:cutoff], now=moment)
        if not projection.get("available"):
            continue
        db.session.add(
            ScoreProjection(
                user_id=user.id,
                scaled_score=projection["scaled_score"],
                lower_bound=projection["lower_bound"],
                upper_bound=projection["upper_bound"],
                percentile=projection["percentile"],
                estimated_accuracy=projection["estimated_accuracy"],
                effective_sample=projection["effective_sample"],
                observed_attempts=projection["observed_attempts"],
                lr_attempts=projection["lr_attempts"],
                rc_attempts=projection["rc_attempts"],
                evidence_grade=projection["evidence_grade"],
                model_version=projection["model_version"],
                detail_json={"uncertainty": projection["uncertainty"], "projected_raw": projection["projected_raw"]},
                created_at=moment,
            )
        )
        written += 1
    db.session.commit()
    return written


def _verify(user: User) -> dict:
    performance = performance_snapshot(user)
    game = serialize_game(user.game_profile, include_catalog=False)
    diagnostic = performance["diagnostic"]
    if not diagnostic or diagnostic["raw_total"] < 70 or len(diagnostic["sections"]) < 2:
        raise RuntimeError("The demo diagnostic was not completed as a robust sectioned form.")
    if performance["readiness"]["status"] != "ready":
        raise RuntimeError("The demo evidence did not reach comparison readiness.")
    if performance["test_performance"]["attempts"] < 100:
        raise RuntimeError("The demo timed-unseen sample is too small.")
    if performance["review"]["recovery_rate"] is None:
        raise RuntimeError("The demo review history did not produce retention evidence.")
    if not performance["recommendation"]:
        raise RuntimeError("The demo history did not produce a recommendation signal.")
    projection = performance.get("projection") or {}
    if not projection.get("available") or len(projection.get("history") or []) < 2:
        raise RuntimeError("The demo history did not produce a projected-score trend.")
    if game["office_tier"] != 2 or game["total_cases"] < 8 or not game["owned_assets"]:
        raise RuntimeError("The demo firm did not reach the intended progression state.")
    if StudySession.query.filter_by(user_id=user.id, status="in_progress").count():
        raise RuntimeError("The demo left an active study session behind.")
    return {
        "email": user.email,
        "diagnostic": {
            "questions": diagnostic["raw_total"],
            "accuracy": diagnostic["summary"]["accuracy"],
            "sections": diagnostic["sections"],
        },
        "test_performance": performance["test_performance"],
        "readiness": performance["readiness"],
        "review": {
            "due": performance["review"]["due"],
            "scheduled": performance["review"]["scheduled"],
            "mastered": performance["review"]["mastered"],
            "recovery_rate": performance["review"]["recovery_rate"],
        },
        "confidence": performance["confidence"],
        "projection": {
            "scaled_score": projection["scaled_score"],
            "band": [projection["lower_bound"], projection["upper_bound"]],
            "evidence_grade": projection["evidence_grade"],
            "snapshots": len(projection["history"]),
        },
        "recommendation": performance["recommendation"],
        "trend_sessions": len(performance["trend"]),
        "firm": {
            "office": game["office"]["name"],
            "tier": game["office_tier"],
            "cash": game["cash"],
            "reputation": game["reputation"],
            "cases": game["total_cases"],
            "owned_assets": len(game["owned_assets"]),
        },
    }


def seed_demo_learner(email: str, *, replace: bool) -> dict:
    user = User.query.filter_by(email=email).first()
    if not user:
        user = User(email=email, display_name="Local Student", onboarding_complete=True, story_intro_seen=True)
        db.session.add(user)
        db.session.commit()
    has_state = bool(user.game_profile or StudySession.query.filter_by(user_id=user.id).first())
    if has_state and not replace:
        raise RuntimeError("The learner already has local state. Re-run with --replace to reset only this learner.")
    if has_state:
        _reset_learner(user)
        user = User.query.filter_by(email=email).one()

    user.onboarding_complete = True
    user.story_intro_seen = True
    _prepare_profile(user)
    random.seed(24072026)
    now = datetime.now(timezone.utc).replace(microsecond=0)

    diagnostic = create_diagnostic_session(user, accommodation_multiplier=1.0)
    _answer_finite_session(
        user,
        diagnostic,
        accuracy=.64,
        phase=.05,
        label="diagnostic",
        completed_at=now - timedelta(days=24),
    )

    # (size, accuracy, phase, days_ago). Every run is a cases run now; the
    # varying sizes and rising accuracy are what make the history read as real.
    schedule = [
        (10, .60, .15, 20),
        (5, .60, .25, 18),
        (10, .60, .35, 16),
        (6, .67, .40, 14),
        (10, .70, .52, 12),
        (5, .80, .62, 10),
        (10, .80, .72, 8),
        (6, .83, .80, 6),
        (12, .82, .88, 4),
    ]
    for index, (size, accuracy, phase, days_ago) in enumerate(schedule):
        session = create_study_session(user, count=size)
        _answer_finite_session(
            user,
            session,
            accuracy=accuracy,
            phase=phase,
            label=f"cases-{index}",
            completed_at=now - timedelta(days=days_ago),
        )

    final_run = create_study_session(user, count=10)
    _answer_finite_session(
        user,
        final_run,
        accuracy=.80,
        phase=.96,
        label="cases-final",
        completed_at=now - timedelta(days=2),
    )

    _normalize_review_queue(user)
    _seed_projection_history(user)
    daily = DailyProgress.query.filter_by(profile_id=user.game_profile.id, activity_date=utcnow().date()).first()
    if daily:
        daily.cases_completed = 4
        daily.claimed_json = []
        db.session.commit()
    return _verify(user)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create deterministic, local-only LSAT learning and firm demo history.",
    )
    parser.add_argument("--email", default=DEFAULT_EMAIL)
    parser.add_argument("--apply", action="store_true", help="Apply the demo state. Without this flag, no data changes.")
    parser.add_argument("--replace", action="store_true", help="Replace this local learner's study and firm state.")
    args = parser.parse_args()

    app = create_app({"AUTO_SEED": False, "DIAGNOSTIC_SESSION_SIZE": DIAGNOSTIC_QUESTIONS})
    with app.app_context():
        _assert_local_only(app, args.email)
        user = User.query.filter_by(email=args.email).first()
        if not args.apply:
            current = {
                "email": args.email,
                "exists": bool(user),
                "sessions": StudySession.query.filter_by(user_id=user.id).count() if user else 0,
                "has_profile": bool(user and user.game_profile),
                "database": str(db.engine.url.database),
                "next": "Re-run with --apply --replace to install the deterministic local demo learner.",
            }
            print(json.dumps(current, indent=2))
            return 0
        backup = _backup_sqlite_database()
        result = seed_demo_learner(args.email, replace=args.replace)
        result["database_backup"] = backup
        print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
