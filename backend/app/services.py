from __future__ import annotations

import random
from collections import defaultdict
from datetime import timezone

from flask import current_app
from sqlalchemy import or_

from .coaching import CoachingProviderError, generate_attempt_coaching
from .extensions import db
from .game import CLIENT_BY_KEY, lock_user_profile, serialize_settlement, settle_attempt, snapshot_case_context
from .models import Attempt, Question, SessionItem, SkillProgress, StudySession, User, utcnow
from .seed import SOURCE_PREFIX


def _iso_utc(value) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def find_resumable_session(user: User) -> StudySession | None:
    return (
        StudySession.query.filter(
            StudySession.user_id == user.id,
            StudySession.mode == "practice",
            or_(
                StudySession.status.in_(["in_progress", "paused"]),
                StudySession.pending_attempt_id.isnot(None),
            ),
        )
        .order_by(StudySession.started_at.desc())
        .first()
    )


def serialize_user(user: User) -> dict:
    active = find_resumable_session(user)
    if not user.game_profile:
        next_route = "/onboarding"
    elif active:
        next_route = f"/cases/{active.id}"
    else:
        next_route = "/office"
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "next_route": next_route,
        "game_ready": bool(user.game_profile),
    }


def serialize_question(question: Question) -> dict:
    return {
        "id": question.id,
        "section": question.section,
        "question_type": question.question_type,
        "passage": (
            {
                "id": question.passage.id,
                "text": question.passage.canonical_text,
                "type": question.passage.passage_type,
            }
            if question.passage
            else None
        ),
        "stimulus": question.stimulus,
        "stem": question.stem,
        "choices": [
            {"label": choice.label, "text": choice.canonical_text}
            for choice in question.choices
        ],
    }


def _elapsed_ms(item: SessionItem) -> int:
    elapsed_ms = item.active_elapsed_ms or 0
    if item.timer_started_at and item.session.status == "in_progress":
        started = item.timer_started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        elapsed_ms += max(0, int((utcnow() - started).total_seconds() * 1000))
    return elapsed_ms


def _target_time_seconds(item: SessionItem) -> int:
    """Return the case target, including passage reuse for RC questions."""
    if item.question.section == "Logical Reasoning":
        return 150
    previous = None
    if item.position > 0:
        previous = SessionItem.query.filter_by(
            session_id=item.session_id,
            position=item.position - 1,
        ).first()
    if (
        item.question.passage_id
        and previous
        and previous.question.passage_id == item.question.passage_id
    ):
        return 135
    return 330


def _is_unfinished_current_item(item: SessionItem) -> bool:
    session = item.session
    return (
        session.status in {"in_progress", "paused"}
        and session.pending_attempt_id is None
        and item.position == session.current_index
        and item.completed_at is None
        and item.attempt is None
    )


def _freeze_current_case(item: SessionItem, user: User) -> bool:
    """Adopt only the visible unfinished case into the tycoon economy."""
    if (
        item.game_context_json is not None
        or not user.game_profile
        or not _is_unfinished_current_item(item)
    ):
        return False
    # Migration 0012 gave old rows the LR default. Recompute RC timing when an
    # unfinished legacy item first enters the tycoon flow.
    item.target_time_seconds = _target_time_seconds(item)
    item.game_context_json = snapshot_case_context(user.game_profile)
    return True


def serialize_item(item: SessionItem, commit: bool = True) -> dict:
    changed = False
    now = utcnow()
    if not item.served_at:
        item.served_at = now
        changed = True
    if _freeze_current_case(item, item.session.user):
        changed = True
    if (
        item.session.status == "in_progress"
        and not item.session.pending_attempt_id
        and item.position == item.session.current_index
        and not item.completed_at
        and not item.timer_started_at
    ):
        item.timer_activated_at = item.timer_activated_at or now
        item.timer_started_at = now
        item.paused_at = None
        changed = True
    if changed and commit:
        db.session.commit()
    context = item.game_context_json or {}
    client_key = str(context.get("client_key") or "walk_in")
    client = CLIENT_BY_KEY.get(client_key, CLIENT_BY_KEY["walk_in"])
    return {
        "id": item.id,
        "position": item.position,
        "served_at": _iso_utc(item.served_at),
        "elapsed_ms": _elapsed_ms(item),
        "target_time_seconds": item.target_time_seconds,
        "case_terms": (
            {
                "client_key": client["key"],
                "client_name": client["name"],
                "base_fee": int(context.get("base_fee") or client["base_fee"]),
            }
            if context
            else None
        ),
        "timer_active": bool(item.timer_started_at and item.session.status == "in_progress"),
        "draft": {
            "selected_label": item.draft_selected_label,
            "reasoning": item.draft_reasoning_text or "",
            "updated_at": _iso_utc(item.draft_updated_at),
        },
        "question": serialize_question(item.question),
    }


def serialize_session(session: StudySession, include_item: bool = True) -> dict:
    payload = {
        "id": session.id,
        "mode": "practice",
        "status": session.status,
        "total_items": session.total_items,
        "current_index": session.current_index,
        "progress_percent": round(100 * session.current_index / max(1, session.total_items)),
        "started_at": _iso_utc(session.started_at),
        "completed_at": _iso_utc(session.completed_at),
    }
    if session.pending_attempt_id:
        pending_attempt = db.session.get(Attempt, session.pending_attempt_id)
        if pending_attempt:
            payload["pending_result"] = serialize_attempt_result(pending_attempt)
            payload["pending_item"] = serialize_item(pending_attempt.session_item, commit=False)
            return payload
    if include_item and session.status == "in_progress":
        item = SessionItem.query.filter_by(
            session_id=session.id,
            position=session.current_index,
        ).first()
        payload["current_item"] = serialize_item(item) if item else None
    return payload


def eligible_question_count() -> int:
    return Question.query.filter(Question.source.like(f"{SOURCE_PREFIX}%")).count()


def select_random_questions(count: int) -> list[Question]:
    eligible = Question.query.filter(Question.source.like(f"{SOURCE_PREFIX}%")).all()
    if not eligible:
        return []
    return random.sample(eligible, k=min(count, len(eligible)))


def create_study_session(user: User) -> StudySession:
    # The account row is the cross-request mutex for the single active case
    # batch. Both POST /study-sessions and final acknowledgement use this path.
    profile = lock_user_profile(user.id)
    if not profile:
        raise ValueError("onboarding_required")
    active = find_resumable_session(user)
    if active:
        db.session.commit()
        return active

    questions = select_random_questions(int(current_app.config["PRACTICE_SESSION_SIZE"]))
    if not questions:
        raise RuntimeError("No Hugging Face LSAT questions are available")

    session = StudySession(
        user_id=user.id,
        mode="practice",
        target_minutes=user.target_minutes,
        total_items=len(questions),
    )
    db.session.add(session)
    db.session.flush()
    previous_passage_id = None
    for position, question in enumerate(questions):
        if question.section == "Logical Reasoning":
            target_time_seconds = 150
        else:
            target_time_seconds = 135 if question.passage_id and question.passage_id == previous_passage_id else 330
        db.session.add(
            SessionItem(
                session_id=session.id,
                question_id=question.id,
                position=position,
                requires_reasoning=True,
                target_time_seconds=target_time_seconds,
            )
        )
        previous_passage_id = question.passage_id
    db.session.commit()
    return session


def pause_study_session(session: StudySession) -> StudySession:
    if session.status == "paused":
        return session
    if session.status == "completed" and session.pending_attempt_id:
        return session
    if session.status != "in_progress":
        raise ValueError("session_complete")
    item = SessionItem.query.filter_by(session_id=session.id, position=session.current_index).first()
    if item and item.timer_started_at:
        started = item.timer_started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        item.active_elapsed_ms = (item.active_elapsed_ms or 0) + max(
            0, int((utcnow() - started).total_seconds() * 1000)
        )
        item.timer_started_at = None
        item.paused_at = utcnow()
        item.timer_compromised = True
    session.status = "paused"
    db.session.commit()
    return session


def resume_study_session(session: StudySession) -> StudySession:
    if session.status == "in_progress":
        return session
    if session.status != "paused":
        raise ValueError("session_complete")
    session.status = "in_progress"
    db.session.commit()
    return session


def _feedback(question: Question, selected_label: str, is_correct: bool, reasoning: str | None) -> dict:
    return {
        "is_correct": is_correct,
        "selected_label": selected_label,
        "correct_label": question.correct_answer,
        "headline": "Correct" if is_correct else "Not quite",
        "diagnosis": (
            "Your answer matches the verified key."
            if is_correct
            else f"The verified answer is {question.correct_answer}."
        ),
        "coaching_notice": (
            "Your reasoning will be graded, and every answer choice will be explained."
        ),
    }


def _update_skill(user_id: str, question: Question, is_correct: bool, elapsed_ms: int) -> None:
    stat = SkillProgress.query.filter_by(
        user_id=user_id,
        skill_name=question.question_type,
    ).first()
    if not stat:
        stat = SkillProgress(
            user_id=user_id,
            skill_name=question.question_type,
            attempts=0,
            correct=0,
            explanation_total=0,
            explanation_count=0,
            total_time_ms=0,
            recent_mistakes=0,
        )
        db.session.add(stat)
    stat.attempts += 1
    stat.correct += int(is_correct)
    stat.total_time_ms += elapsed_ms
    stat.recent_mistakes = 0 if is_correct else stat.recent_mistakes + 1


def submit_attempt(
    user: User,
    session: StudySession,
    payload: dict,
    idempotency_key: str,
) -> tuple[Attempt, bool]:
    if not user.game_profile:
        raise ValueError("onboarding_required")
    requested_item_id = payload.get("item_id")
    existing = Attempt.query.filter_by(idempotency_key=idempotency_key).first()
    if existing:
        if (
            existing.user_id != user.id
            or existing.session_item.session_id != session.id
            or existing.session_item_id != requested_item_id
        ):
            raise ValueError("idempotency_conflict")
        return existing, True
    if session.pending_attempt_id:
        raise ValueError("debrief_required")
    if session.status != "in_progress":
        raise ValueError("session_complete")

    item = SessionItem.query.filter_by(id=requested_item_id, session_id=session.id).first()
    if not item or item.position != session.current_index:
        raise ValueError("invalid_session_item")
    if item.attempt:
        return item.attempt, True
    _freeze_current_case(item, user)
    if item.game_context_json is None:
        raise ValueError("game_context_required")

    selected_label = str(payload.get("selected_label", "")).strip().upper()
    if selected_label not in {choice.label for choice in item.question.choices}:
        raise ValueError("invalid_choice")
    reasoning = str(payload.get("reasoning") or "").strip()[:4000] or None
    if not reasoning:
        raise ValueError("reasoning_required")
    elapsed_ms = max(1000, min(_elapsed_ms(item), 15 * 60 * 1000))
    is_correct = selected_label == item.question.correct_answer
    _update_skill(user.id, item.question, is_correct, elapsed_ms)

    attempt = Attempt(
        user_id=user.id,
        session_item_id=item.id,
        idempotency_key=idempotency_key,
        selected_label=selected_label,
        is_correct=is_correct,
        reasoning_text=reasoning,
        server_elapsed_ms=elapsed_ms,
        client_elapsed_ms=None,
        capm_points=0,
        pace_scored=False,
        xp_earned=0,
        feedback_json=_feedback(item.question, selected_label, is_correct, reasoning),
        coaching_status="pending",
    )
    db.session.add(attempt)
    db.session.flush()
    item.completed_at = utcnow()
    item.active_elapsed_ms = elapsed_ms
    item.timer_started_at = None
    item.paused_at = None
    item.draft_selected_label = None
    item.draft_reasoning_text = None
    item.draft_updated_at = None
    session.current_index += 1
    session.pending_attempt_id = attempt.id
    if session.current_index >= session.total_items:
        session.status = "completed"
        session.completed_at = utcnow()
        db.session.flush()
        session.summary_json = calculate_session_summary(session)
    db.session.commit()
    return attempt, False


def serialize_attempt_result(attempt: Attempt, duplicate: bool = False) -> dict:
    session = attempt.session_item.session
    return {
        "attempt_id": attempt.id,
        "duplicate": duplicate,
        "is_correct": attempt.is_correct,
        "elapsed_ms": attempt.server_elapsed_ms,
        "feedback": attempt.feedback_json,
        "coaching_status": attempt.coaching_status,
        "has_reasoning": bool(attempt.reasoning_text),
        "game_reward": serialize_settlement(attempt.settlement),
        "session_complete": session.status == "completed",
        "session_id": session.id,
    }


def run_attempt_coaching(attempt: Attempt) -> dict:
    existing_feedback = (attempt.feedback_json or {}).get("coaching")
    if attempt.coaching_status == "completed" and existing_feedback:
        if not attempt.settlement:
            settle_attempt(attempt, existing_feedback)
            db.session.commit()
        return existing_feedback
    if attempt.coaching_status == "processing" and attempt.coaching_started_at:
        started = attempt.coaching_started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        if (utcnow() - started).total_seconds() < 150:
            raise ValueError("coaching_in_progress")

    attempt.coaching_status = "processing"
    attempt.coaching_started_at = utcnow()
    db.session.commit()
    try:
        coaching, _metadata = generate_attempt_coaching(attempt)
    except CoachingProviderError:
        attempt.coaching_status = "failed"
        attempt.coaching_started_at = None
        db.session.commit()
        raise

    settle_attempt(attempt, coaching)

    if coaching["explanation_grade"] is not None and not attempt.explanation_score_applied:
        normalized_score = coaching["explanation_grade"] / 100
        stat = SkillProgress.query.filter_by(
            user_id=attempt.user_id,
            skill_name=attempt.session_item.question.question_type,
        ).first()
        if stat:
            stat.explanation_total += normalized_score
            stat.explanation_count += 1
        attempt.explanation_score = normalized_score
        attempt.explanation_score_applied = True

    feedback = dict(attempt.feedback_json or {})
    feedback["coaching"] = coaching
    attempt.feedback_json = feedback
    attempt.coaching_status = "completed"
    attempt.coaching_started_at = None
    attempt.coaching_model = coaching["model"]
    attempt.coached_at = utcnow()
    session = attempt.session_item.session
    if session.status == "completed":
        session.summary_json = calculate_session_summary(session)
    db.session.commit()
    return coaching


def _skill_breakdown(attempts: list[Attempt]) -> list[dict]:
    grouped: dict[str, list[Attempt]] = defaultdict(list)
    for attempt in attempts:
        grouped[attempt.session_item.question.question_type].append(attempt)
    return [
        {
            "name": name,
            "attempts": len(values),
            "accuracy": round(sum(value.is_correct for value in values) / len(values) * 100),
        }
        for name, values in grouped.items()
    ]


def calculate_session_summary(session: StudySession) -> dict:
    attempts = (
        Attempt.query.join(SessionItem)
        .filter(SessionItem.session_id == session.id)
        .order_by(Attempt.created_at)
        .all()
    )
    explanation_scores = [
        attempt.explanation_score
        for attempt in attempts
        if attempt.explanation_score is not None
    ]
    return {
        "kind": "practice",
        "accuracy": round(sum(attempt.is_correct for attempt in attempts) / max(1, len(attempts)) * 100),
        "correct": sum(attempt.is_correct for attempt in attempts),
        "questions_completed": len(attempts),
        "elapsed_minutes": round(sum(attempt.server_elapsed_ms for attempt in attempts) / 60_000, 1),
        "explanation_accuracy": (
            round(sum(explanation_scores) / len(explanation_scores) * 100)
            if explanation_scores
            else None
        ),
        "skills": _skill_breakdown(attempts),
    }
