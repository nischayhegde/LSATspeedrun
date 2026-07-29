from __future__ import annotations

import random
from collections import defaultdict
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from flask import current_app
from sqlalchemy import or_

from .coaching import CoachingProviderError, generate_attempt_coaching
from .extensions import db
from .game import CLIENT_BY_KEY, explanation_band, lock_user_profile, serialize_settlement, settle_attempt, snapshot_case_context
from .models import Attempt, Question, ReviewQueueItem, SessionItem, SkillProgress, StudySession, User, utcnow
from .seed import SOURCE_PREFIX
from .strategies import assign_strategy_trial, serialize_strategy, strategy_performance


PRACTICE_STYLES = {"deep", "speedrun", "infinite", "review"}
FEEDBACK_POLICIES = {"immediate", "delayed"}
STYLE_FEEDBACK_POLICY = {
    "deep": "immediate",
    "speedrun": "delayed",
    "infinite": "immediate",
    "review": "immediate",
}
EVIDENCE_CLASS = {
    "deep": "coached_practice",
    "speedrun": "timed_unseen",
    "infinite": "fluency",
    "review": "spaced_review",
    "diagnostic": "diagnostic",
}
REVIEW_INTERVAL_DAYS = (1, 3, 7, 21)
REASONING_MIN_CHARS = {"deep": 120, "review": 120, "speedrun": 40, "infinite": 40}


def reasoning_min_chars(session: StudySession) -> int:
    """Characters of written explanation this session demands before an answer counts."""
    if session.mode == "diagnostic":
        return 0
    return REASONING_MIN_CHARS.get(session.practice_style, 0)


def _iso_utc(value) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _aware_utc(value):
    """Normalize database timestamps before Python-side comparisons.

    SQLite drops timezone information even for timezone-aware columns, while
    PostgreSQL preserves it. Treat a naive value as UTC so review scheduling
    behaves identically in tests, local development, and production.
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


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


def find_active_diagnostic(user: User) -> StudySession | None:
    return (
        StudySession.query.filter(
            StudySession.user_id == user.id,
            StudySession.mode == "diagnostic",
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
    diagnostic = find_active_diagnostic(user)
    diagnostic_complete = bool(
        StudySession.query.filter_by(user_id=user.id, mode="diagnostic", status="completed").first()
    )
    if not user.game_profile:
        next_route = "/onboarding"
    elif active:
        next_route = f"/cases/{active.id}"
    elif diagnostic:
        next_route = f"/cases/{diagnostic.id}"
    else:
        next_route = "/progress"
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "next_route": next_route,
        "game_ready": bool(user.game_profile),
        "diagnostic_complete": diagnostic_complete,
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
        item.session.mode == "diagnostic"
        or item.session.practice_style != "deep"
        or item.game_context_json is not None
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
    strategy_trial = (
        serialize_strategy(item.strategy_key)
        if item.strategy_key and item.strategy_variant == "prompt"
        else None
    )
    return {
        "id": item.id,
        "position": item.position,
        "section_index": item.section_index,
        "requires_reasoning": item.requires_reasoning,
        "reasoning_min_chars": reasoning_min_chars(item.session),
        "strategy_trial": ({**strategy_trial, "variant": "prompt"} if strategy_trial else None),
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
        "mode": session.mode,
        "practice_style": session.practice_style,
        "feedback_policy": session.feedback_policy,
        "status": session.status,
        "target_minutes": session.target_minutes,
        "accommodation_multiplier": session.accommodation_multiplier,
        "section_plan": session.section_plan_json or [],
        "ended_by_user": session.ended_by_user,
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


def _seen_question_ids(user_id: str) -> set[str]:
    return {
        question_id
        for (question_id,) in (
            db.session.query(SessionItem.question_id)
            .join(Attempt, Attempt.session_item_id == SessionItem.id)
            .filter(Attempt.user_id == user_id)
            .all()
        )
    }


def select_random_questions(
    count: int,
    question_type: str | None = None,
    *,
    user_id: str | None = None,
) -> list[Question]:
    query = Question.query.filter(Question.source.like(f"{SOURCE_PREFIX}%"))
    if question_type:
        query = query.filter(Question.question_type == question_type)
    eligible = query.all()
    if not eligible:
        return []
    unseen = [question for question in eligible if not user_id or question.id not in _seen_question_ids(user_id)]
    pool = unseen if len(unseen) >= count else unseen + [question for question in eligible if question not in unseen]
    return random.sample(pool, k=min(count, len(pool)))


def select_diagnostic_questions(count: int) -> tuple[list[Question], list[int], list[dict]]:
    """Build LR / intact RC / LR blocks without revealing or coaching mid-form."""
    eligible = Question.query.filter(Question.source.like(f"{SOURCE_PREFIX}%")).all()
    if not eligible:
        return [], [], []
    lr = [question for question in eligible if question.section == "Logical Reasoning"]
    rc = [question for question in eligible if question.section == "Reading Comprehension"]
    lr_target = min(len(lr), max(1, round(count * 2 / 3)))
    rc_target = min(len(rc), max(0, count - lr_target))
    selected_lr = random.sample(lr, k=lr_target) if lr_target else []

    passage_groups: dict[str, list[Question]] = defaultdict(list)
    for question in rc:
        passage_groups[question.passage_id or question.id].append(question)
    groups = list(passage_groups.values())
    random.shuffle(groups)
    selected_rc: list[Question] = []
    for group in groups:
        if len(selected_rc) >= rc_target:
            break
        selected_rc.extend(sorted(group, key=lambda question: question.id))

    remaining_slots = max(0, min(count, len(eligible)) - len(selected_lr) - len(selected_rc))
    if remaining_slots:
        remaining = [question for question in eligible if question not in selected_lr and question not in selected_rc]
        selected_lr.extend(random.sample(remaining, k=min(remaining_slots, len(remaining))))

    split = (len(selected_lr) + 1) // 2
    blocks = [selected_lr[:split], selected_rc, selected_lr[split:]]
    questions: list[Question] = []
    section_indexes: list[int] = []
    plan: list[dict] = []
    labels = ["Logical Reasoning I", "Reading Comprehension", "Logical Reasoning II"]
    for section_index, block in enumerate(blocks):
        if not block:
            continue
        start = len(questions)
        questions.extend(block)
        section_indexes.extend([section_index] * len(block))
        minutes = 35 if len(block) >= 18 else max(8, round(len(block) * 1.55))
        plan.append(
            {
                "index": section_index,
                "label": labels[section_index],
                "start": start,
                "end": len(questions) - 1,
                "questions": len(block),
                "minutes": minutes,
            }
        )
    return questions, section_indexes, plan


def _questions_due_for_review(user_id: str, count: int) -> list[Question]:
    due = (
        ReviewQueueItem.query.filter(
            ReviewQueueItem.user_id == user_id,
            ReviewQueueItem.status == "due",
            ReviewQueueItem.due_at <= utcnow(),
        )
        .order_by(ReviewQueueItem.due_at.asc())
        .limit(count)
        .all()
    )
    return [item.question for item in due]


def create_study_session(
    user: User,
    *,
    count: int | None = None,
    question_type: str | None = None,
    practice_style: str = "deep",
    feedback_policy: str | None = None,
) -> StudySession:
    # The account row is the cross-request mutex for the single active case
    # batch. Both POST /study-sessions and final acknowledgement use this path.
    profile = lock_user_profile(user.id)
    if not profile:
        raise ValueError("onboarding_required")
    active = find_resumable_session(user)
    if active:
        db.session.commit()
        return active

    if practice_style not in PRACTICE_STYLES:
        raise ValueError("invalid_practice_style")
    required_policy = STYLE_FEEDBACK_POLICY[practice_style]
    if feedback_policy is not None and feedback_policy not in FEEDBACK_POLICIES:
        raise ValueError("invalid_feedback_policy")
    if feedback_policy is not None and feedback_policy != required_policy:
        raise ValueError("invalid_feedback_policy")
    policy = required_policy

    session_size = count if count is not None else int(current_app.config["PRACTICE_SESSION_SIZE"])
    questions = (
        _questions_due_for_review(user.id, session_size)
        if practice_style == "review"
        else select_random_questions(session_size, question_type, user_id=user.id)
    )
    if not questions:
        if practice_style == "review":
            raise ValueError("no_reviews_due")
        raise RuntimeError("No Hugging Face LSAT questions are available")

    session = StudySession(
        user_id=user.id,
        mode="practice",
        practice_style=practice_style,
        feedback_policy=policy,
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
        strategy_trial = assign_strategy_trial(user.id, question, practice_style, position)
        db.session.add(
            SessionItem(
                session_id=session.id,
                question_id=question.id,
                position=position,
                requires_reasoning=True,
                strategy_key=strategy_trial["key"] if strategy_trial else None,
                strategy_variant=strategy_trial["variant"] if strategy_trial else None,
                target_time_seconds=target_time_seconds,
            )
        )
        previous_passage_id = question.passage_id
    db.session.commit()
    return session


def create_diagnostic_session(user: User, *, accommodation_multiplier: float = 1.0) -> StudySession:
    profile = lock_user_profile(user.id)
    if not profile:
        raise ValueError("onboarding_required")
    active = find_active_diagnostic(user)
    if active:
        db.session.commit()
        return active
    if accommodation_multiplier not in {1.0, 1.5, 2.0}:
        raise ValueError("invalid_accommodation")
    questions, section_indexes, section_plan = select_diagnostic_questions(int(current_app.config["DIAGNOSTIC_SESSION_SIZE"]))
    if not questions:
        raise RuntimeError("No Hugging Face LSAT questions are available")
    session = StudySession(
        user_id=user.id,
        mode="diagnostic",
        practice_style="diagnostic",
        feedback_policy="delayed",
        accommodation_multiplier=accommodation_multiplier,
        section_plan_json=[
            {**section, "minutes": round(section["minutes"] * accommodation_multiplier)}
            for section in section_plan
        ],
        target_minutes=max(1, round(sum(section["minutes"] for section in section_plan) * accommodation_multiplier)),
        total_items=len(questions),
    )
    db.session.add(session)
    db.session.flush()
    for position, question in enumerate(questions):
        base_target = 150 if question.section == "Logical Reasoning" else 330
        db.session.add(
            SessionItem(
                session_id=session.id,
                question_id=question.id,
                position=position,
                section_index=section_indexes[position],
                requires_reasoning=False,
                target_time_seconds=round(base_target * accommodation_multiplier),
            )
        )
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


def finish_infinite_session(session: StudySession) -> StudySession:
    if session.practice_style != "infinite":
        raise ValueError("not_infinite")
    if session.pending_attempt_id:
        raise ValueError("debrief_required")
    if session.status != "in_progress":
        return session
    # Infinite sessions keep an unattempted tail ready so the next question
    # appears without another start request. Once the learner ends the run,
    # those placeholders are not omissions and must not enter the summary.
    unfinished = SessionItem.query.filter(
        SessionItem.session_id == session.id,
        SessionItem.position >= session.current_index,
        SessionItem.completed_at.is_(None),
    ).all()
    for item in unfinished:
        if item.attempt is None:
            db.session.delete(item)
    session.total_items = session.current_index
    session.status = "completed"
    session.ended_by_user = True
    session.completed_at = utcnow()
    db.session.flush()
    session.summary_json = calculate_session_summary(session)
    db.session.commit()
    return session


def session_review(session: StudySession) -> dict:
    if session.status != "completed":
        raise ValueError("session_in_progress")
    attempts = (
        Attempt.query.join(SessionItem)
        .filter(SessionItem.session_id == session.id)
        .order_by(SessionItem.position.asc())
        .all()
    )
    return {
        "session": serialize_session(session, False),
        "summary": session.summary_json or calculate_session_summary(session),
        "items": [
            {
                "position": attempt.session_item.position,
                "question": serialize_question(attempt.session_item.question),
                "attempt_id": attempt.id,
                "selected_label": attempt.selected_label,
                "correct_label": attempt.session_item.question.correct_answer,
                "is_correct": attempt.is_correct,
                "confidence": attempt.confidence,
                "elapsed_ms": attempt.server_elapsed_ms,
                "target_time_seconds": attempt.session_item.target_time_seconds,
                "priority_reason": (
                    "high_confidence_miss"
                    if not attempt.is_correct and (attempt.confidence or 0) >= 4
                    else "miss"
                    if not attempt.is_correct
                    else "low_confidence_correct"
                    if (attempt.confidence or 3) <= 2
                    else "slow_correct"
                    if attempt.server_elapsed_ms > attempt.session_item.target_time_seconds * 1000
                    else None
                ),
                "evidence_class": attempt.evidence_class,
                "feedback": attempt.feedback_json,
                "coaching_status": attempt.coaching_status,
            }
            for attempt in attempts
        ],
    }


def daily_docket_snapshot(user: User, timezone_name: str = "UTC") -> dict:
    """Derive today's learning queue without creating a second mission system."""
    try:
        local_zone = ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError):
        local_zone = timezone.utc
        timezone_name = "UTC"
    now = utcnow()
    local_date = now.astimezone(local_zone).date()
    day_start = datetime.combine(local_date, time.min, tzinfo=local_zone).astimezone(timezone.utc)
    day_end = datetime.combine(local_date + timedelta(days=1), time.min, tzinfo=local_zone).astimezone(timezone.utc)
    completed_today = (
        StudySession.query.filter(
            StudySession.user_id == user.id,
            StudySession.completed_at.isnot(None),
            StudySession.completed_at >= day_start,
            StudySession.completed_at < day_end,
        )
        .order_by(StudySession.completed_at.desc())
        .all()
    )
    completed_review = next((item for item in completed_today if item.practice_style == "review"), None)
    completed_sprint = next(
        (item for item in completed_today if item.practice_style == "speedrun" and item.total_items >= 5),
        None,
    )
    active = find_resumable_session(user)
    queue = review_queue_snapshot(user)

    review_state = (
        "active" if active and active.practice_style == "review"
        else "complete" if completed_review
        else "clear" if completed_sprint
        else "ready" if queue["due"]
        else "clear"
    )
    review_cleared = review_state in {"complete", "clear"}
    sprint_state = (
        "active" if active and active.practice_style == "speedrun"
        else "complete" if completed_sprint
        else "ready" if review_cleared and not active
        else "locked"
    )
    priority_count = 0
    if completed_sprint:
        priority_count = sum(bool(item["priority_reason"]) for item in session_review(completed_sprint)["items"])
    brief_state = (
        "complete" if completed_sprint and completed_sprint.summary_seen_at
        else "ready" if completed_sprint
        else "locked"
    )

    if active:
        next_action = {"kind": "resume", "session_id": active.id, "label": "Resume active run"}
    elif brief_state == "ready":
        next_action = {"kind": "open_brief", "session_id": completed_sprint.id, "label": "Open Deep Brief"}
    elif review_state == "ready":
        next_action = {"kind": "start_review", "label": f"Repair {min(5, queue['due'])} due"}
    elif sprint_state == "ready":
        next_action = {"kind": "start_speedrun", "label": "Start 10-question Speedrun"}
    else:
        next_action = {"kind": "done", "label": "Daily docket complete"}

    return {
        "date": local_date.isoformat(),
        "timezone": timezone_name,
        "active_session": serialize_session(active, False) if active else None,
        "review": {
            "state": review_state,
            "due": queue["due"],
            "target": min(5, queue["due"]),
            "session_id": (active.id if active and active.practice_style == "review" else completed_review.id if completed_review else None),
        },
        "speedrun": {
            "state": sprint_state,
            "target": 10,
            "session_id": (active.id if active and active.practice_style == "speedrun" else completed_sprint.id if completed_sprint else None),
            "summary": completed_sprint.summary_json if completed_sprint else None,
        },
        "deep_brief": {
            "state": brief_state,
            "session_id": completed_sprint.id if completed_sprint else None,
            "priority_count": priority_count,
        },
        "next_action": next_action,
    }


def review_queue_snapshot(user: User) -> dict:
    rows = (
        ReviewQueueItem.query.filter_by(user_id=user.id)
        .order_by(ReviewQueueItem.due_at.asc())
        .all()
    )
    now = utcnow()
    due = [row for row in rows if row.status == "due" and _aware_utc(row.due_at) <= now]
    return {
        "due": len(due),
        "scheduled": sum(
            row.status == "due" and _aware_utc(row.due_at) > now
            for row in rows
        ),
        "mastered": sum(row.status == "mastered" for row in rows),
        "items": [
            {
                "id": row.id,
                "question_id": row.question_id,
                "question_type": row.question.question_type,
                "section": row.question.section,
                "reason_code": row.reason_code,
                "interval_index": row.interval_index,
                "due_at": _iso_utc(row.due_at),
            }
            for row in due[:12]
        ],
    }


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


def _append_infinite_item(session: StudySession, user: User) -> None:
    question = select_random_questions(1, user_id=user.id)[0]
    previous = SessionItem.query.filter_by(session_id=session.id, position=session.total_items - 1).first()
    target_time_seconds = 150
    if question.section == "Reading Comprehension":
        target_time_seconds = 135 if previous and previous.question.passage_id == question.passage_id else 330
    strategy_trial = assign_strategy_trial(user.id, question, session.practice_style, session.total_items)
    db.session.add(
        SessionItem(
            session_id=session.id,
            question_id=question.id,
            position=session.total_items,
            requires_reasoning=True,
            strategy_key=strategy_trial["key"] if strategy_trial else None,
            strategy_variant=strategy_trial["variant"] if strategy_trial else None,
            target_time_seconds=target_time_seconds,
        )
    )
    session.total_items += 1


def _attempt_band(attempt: Attempt) -> str | None:
    """Economy band for a graded explanation, or None while the grade is missing.

    ``Attempt.explanation_score`` is normalized 0-1; ``explanation_band`` wants a
    raw 0-100 score. Reuse is already handled upstream: ``settle_attempt`` zeroes
    a recycled explanation's grade before it is written here.
    """
    if attempt.explanation_score is None:
        return None
    return explanation_band(round(attempt.explanation_score * 100), bool(attempt.reasoning_text))


def _entry_reason(attempt: Attempt, band: str | None) -> str | None:
    """First matching reason this attempt belongs in the review queue."""
    confidence = attempt.confidence or 3
    slow = attempt.server_elapsed_ms > attempt.session_item.target_time_seconds * 1000
    if not attempt.is_correct:
        return "high_confidence_error" if confidence >= 4 else "incorrect"
    if band in {"Invalid", "Weak"}:
        return "unsupported_correct"
    if confidence <= 2:
        return "low_confidence_correct"
    if slow:
        return "slow_correct"
    return None


def _advance_review(existing: ReviewQueueItem, attempt: Attempt, band: str | None, from_index: int) -> None:
    """Move a review card along the ladder according to answer and explanation."""
    if not attempt.is_correct:
        existing.status = "due"
        existing.interval_index = 0
        existing.reason_code = "repeat_error"
        existing.due_at = utcnow()
        return
    if band == "Invalid":
        existing.status = "due"
        existing.interval_index = 0
        existing.reason_code = "unsupported_correct"
        existing.due_at = utcnow()
        return
    if band == "Weak":
        existing.status = "due"
        existing.interval_index = from_index
        existing.reason_code = "unsupported_correct"
        existing.due_at = utcnow() + timedelta(days=1)
        return
    next_index = from_index + (2 if band == "Excellent" else 1)
    if next_index > len(REVIEW_INTERVAL_DAYS):
        existing.status = "mastered"
        existing.interval_index = len(REVIEW_INTERVAL_DAYS)
        existing.due_at = utcnow() + timedelta(days=REVIEW_INTERVAL_DAYS[-1])
    else:
        existing.status = "due"
        existing.interval_index = next_index
        existing.due_at = utcnow() + timedelta(days=REVIEW_INTERVAL_DAYS[next_index - 1])


def _schedule_review(attempt: Attempt) -> None:
    """Place or move this question in the spaced-review queue.

    Safe to call twice for the same attempt: once on submit, when the
    explanation grade is still missing, and again from ``run_attempt_coaching``
    once the grade lands. The second call recomputes from
    ``pre_grade_interval_index`` so the provisional advance is not compounded.
    """
    session = attempt.session_item.session
    band = _attempt_band(attempt)
    pending = band is None and attempt.session_item.requires_reasoning
    existing = ReviewQueueItem.query.filter_by(
        user_id=attempt.user_id,
        question_id=attempt.session_item.question_id,
    ).first()

    if session.practice_style == "review":
        if not existing:
            return
        existing.last_attempt_id = attempt.id
        from_index = existing.pre_grade_interval_index
        if from_index is None:
            from_index = existing.interval_index
        existing.pre_grade_interval_index = from_index if pending else None
        existing.grade_pending = pending
        _advance_review(existing, attempt, band, from_index)
        return

    reason_code = _entry_reason(attempt, band)
    if not reason_code:
        return
    if not existing:
        existing = ReviewQueueItem(
            user_id=attempt.user_id,
            question_id=attempt.session_item.question_id,
            source_attempt_id=attempt.id,
            status="due",
            reason_code=reason_code,
            interval_index=0,
            due_at=utcnow(),
            grade_pending=pending,
        )
        db.session.add(existing)
    else:
        existing.source_attempt_id = existing.source_attempt_id or attempt.id
        existing.last_attempt_id = attempt.id
        existing.status = "due"
        existing.reason_code = reason_code
        existing.interval_index = 0
        existing.due_at = utcnow()
        existing.grade_pending = pending


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
    if (
        item.game_context_json is None
        and session.mode == "practice"
        and session.practice_style == "deep"
    ):
        raise ValueError("game_context_required")

    selected_label = str(payload.get("selected_label", "")).strip().upper()
    if selected_label not in {choice.label for choice in item.question.choices}:
        raise ValueError("invalid_choice")
    reasoning = str(payload.get("reasoning") or "").strip()[:4000] or None
    if item.requires_reasoning:
        if not reasoning:
            raise ValueError("reasoning_required")
        if len(reasoning) < reasoning_min_chars(session):
            raise ValueError("reasoning_too_short")
    try:
        confidence = int(payload.get("confidence", 3))
    except (TypeError, ValueError):
        raise ValueError("invalid_confidence")
    if confidence < 1 or confidence > 5:
        raise ValueError("invalid_confidence")
    strategy_applied = None
    strategy_prompt_ms = 0
    if item.strategy_key and item.strategy_variant == "prompt":
        raw_strategy_applied = payload.get("strategy_applied")
        if not isinstance(raw_strategy_applied, bool):
            raise ValueError("strategy_decision_required")
        strategy_applied = raw_strategy_applied
        try:
            strategy_prompt_ms = max(0, min(int(payload.get("strategy_prompt_ms") or 0), 60_000))
        except (TypeError, ValueError):
            raise ValueError("invalid_strategy_prompt_time")
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
        confidence=confidence,
        answer_changed=bool(payload.get("answer_changed", False)),
        strategy_key=item.strategy_key,
        strategy_variant=item.strategy_variant,
        strategy_applied=strategy_applied,
        strategy_prompt_ms=strategy_prompt_ms,
        evidence_class=EVIDENCE_CLASS.get(session.practice_style, EVIDENCE_CLASS.get(session.mode, "coached_practice")),
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
    _schedule_review(attempt)
    item.completed_at = utcnow()
    item.active_elapsed_ms = elapsed_ms
    item.timer_started_at = None
    item.paused_at = None
    item.draft_selected_label = None
    item.draft_reasoning_text = None
    item.draft_updated_at = None
    session.current_index += 1
    session.pending_attempt_id = attempt.id if session.feedback_policy == "immediate" else None
    if session.practice_style == "infinite" and session.current_index >= session.total_items:
        _append_infinite_item(session, user)
    elif session.current_index >= session.total_items:
        session.status = "completed"
        session.completed_at = utcnow()
        db.session.flush()
        session.summary_json = calculate_session_summary(session)
    db.session.commit()
    return attempt, False


def serialize_attempt_result(attempt: Attempt, duplicate: bool = False) -> dict:
    session = attempt.session_item.session
    feedback_released = session.feedback_policy == "immediate"
    if not feedback_released:
        return {
            "attempt_id": attempt.id,
            "duplicate": duplicate,
            "recorded": True,
            "feedback_released": False,
            "elapsed_ms": attempt.server_elapsed_ms,
            "coaching_status": attempt.coaching_status,
            "has_reasoning": bool(attempt.reasoning_text),
            "game_reward": None,
            "session_complete": session.status == "completed",
            "session_id": session.id,
        }
    return {
        "attempt_id": attempt.id,
        "duplicate": duplicate,
        "recorded": True,
        "feedback_released": True,
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
    sections = []
    section_plan = {int(section["index"]): section for section in (session.section_plan_json or [])}
    grouped_sections: dict[int, list[Attempt]] = defaultdict(list)
    for attempt in attempts:
        grouped_sections[attempt.session_item.section_index].append(attempt)
    for section_index, values in sorted(grouped_sections.items()):
        plan = section_plan.get(section_index, {})
        sections.append(
            {
                "index": section_index,
                "label": plan.get("label") or values[0].session_item.question.section,
                "correct": sum(value.is_correct for value in values),
                "questions": len(values),
                "accuracy": round(sum(value.is_correct for value in values) / max(1, len(values)) * 100),
                "elapsed_minutes": round(sum(value.server_elapsed_ms for value in values) / 60_000, 1),
                "timing_compromised": any(value.session_item.timer_compromised for value in values),
            }
        )
    confidence_values = [attempt.confidence for attempt in attempts if attempt.confidence is not None]
    high_confidence = [attempt for attempt in attempts if (attempt.confidence or 0) >= 4]
    return {
        "kind": session.mode,
        "practice_style": session.practice_style,
        "feedback_policy": session.feedback_policy,
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
        "sections": sections,
        "omitted": max(0, session.total_items - len(attempts)),
        "confidence": {
            "average": round(sum(confidence_values) / len(confidence_values), 1) if confidence_values else None,
            "high_confidence_errors": sum(not attempt.is_correct for attempt in high_confidence),
            "high_confidence_attempts": len(high_confidence),
        },
        "timing_compromised": any(attempt.session_item.timer_compromised for attempt in attempts),
    }


def performance_snapshot(user: User) -> dict:
    attempts = (
        Attempt.query.filter_by(user_id=user.id)
        .join(SessionItem)
        .order_by(Attempt.created_at.asc())
        .all()
    )

    def summarize(values: list[Attempt]) -> dict:
        reasoning = [attempt.explanation_score * 100 for attempt in values if attempt.explanation_score is not None]
        pace_values = [attempt for attempt in values if not attempt.session_item.timer_compromised]
        pace_hits = [
            attempt.server_elapsed_ms <= attempt.session_item.target_time_seconds * 1000
            for attempt in pace_values
        ]
        return {
            "attempts": len(values),
            "accuracy": round(sum(attempt.is_correct for attempt in values) / max(1, len(values)) * 100),
            "average_seconds": round(sum(attempt.server_elapsed_ms for attempt in pace_values) / max(1, len(pace_values)) / 1000),
            "pace_adherence": round(sum(pace_hits) / max(1, len(pace_hits)) * 100),
            "reasoning": round(sum(reasoning) / len(reasoning)) if reasoning else None,
        }

    # One first attempt per question prevents memorized repeats from inflating the
    # headline evidence while review attempts remain available in their own class.
    first_by_question: dict[str, Attempt] = {}
    for attempt in attempts:
        first_by_question.setdefault(attempt.session_item.question_id, attempt)
    first_attempts = list(first_by_question.values())
    overall = summarize(first_attempts)
    recent = summarize(attempts[-20:])
    previous = summarize(attempts[-40:-20]) if len(attempts) > 20 else None
    reasoning_value = overall["reasoning"] if overall["reasoning"] is not None else 0
    overall["speedrun_index"] = round(overall["accuracy"] * .55 + reasoning_value * .25 + overall["pace_adherence"] * .20)
    has_comparison = bool(previous and previous["attempts"])
    overall["accuracy_delta"] = recent["accuracy"] - previous["accuracy"] if has_comparison else None
    overall["pace_delta"] = recent["pace_adherence"] - previous["pace_adherence"] if has_comparison else None
    overall["average_seconds_delta"] = previous["average_seconds"] - recent["average_seconds"] if has_comparison else None
    overall["reasoning_delta"] = (
        recent["reasoning"] - previous["reasoning"]
        if has_comparison and recent["reasoning"] is not None and previous["reasoning"] is not None
        else None
    )
    overall["evidence"] = "baseline" if len(attempts) < 10 else "emerging" if len(attempts) < 30 else "directional" if len(attempts) < 80 else "stable"

    grouped: dict[str, list[Attempt]] = defaultdict(list)
    for attempt in first_attempts:
        grouped[attempt.session_item.question.question_type].append(attempt)
    skills = []
    for name, values in grouped.items():
        skill = summarize(values)
        skill["name"] = name
        skill["priority"] = round(skill["accuracy"] * .65 + (skill["reasoning"] or 0) * .2 + skill["pace_adherence"] * .15)
        skills.append(skill)
    skills.sort(key=lambda skill: (skill["priority"], -skill["attempts"], skill["name"]))

    sessions = (
        StudySession.query.filter(
            StudySession.user_id == user.id,
            StudySession.status == "completed",
            StudySession.mode.in_(["practice", "diagnostic"]),
        )
        .order_by(StudySession.completed_at.desc())
        .limit(10)
        .all()
    )
    trend = []
    for session in reversed(sessions):
        summary = session.summary_json or calculate_session_summary(session)
        trend.append(
            {
                "id": session.id,
                "kind": session.mode,
                "date": _iso_utc(session.completed_at),
                "accuracy": summary.get("accuracy", 0),
                "reasoning": summary.get("explanation_accuracy"),
                "questions": summary.get("questions_completed", 0),
                "minutes": summary.get("elapsed_minutes", 0),
            }
        )

    latest_diagnostic = (
        StudySession.query.filter_by(user_id=user.id, mode="diagnostic", status="completed")
        .order_by(StudySession.completed_at.desc())
        .first()
    )
    diagnostic = None
    if latest_diagnostic:
        summary = latest_diagnostic.summary_json or calculate_session_summary(latest_diagnostic)
        diagnostic = {
            "session_id": latest_diagnostic.id,
            "completed_at": _iso_utc(latest_diagnostic.completed_at),
            "summary": summary,
            "raw_correct": summary.get("correct", 0),
            "raw_total": summary.get("questions_completed", 0),
            "sections": summary.get("sections", []),
            "projection_available": False,
            "projection_note": "A scaled score is withheld until the form has a validated conversion.",
        }

    by_evidence: dict[str, list[Attempt]] = defaultdict(list)
    for attempt in attempts:
        by_evidence[attempt.evidence_class].append(attempt)
    evidence_classes = {name: summarize(values) for name, values in by_evidence.items()}
    test_values = [attempt for attempt in first_attempts if attempt.evidence_class in {"timed_unseen", "diagnostic"}]
    test_performance = summarize(test_values)
    lr_samples = sum(attempt.session_item.question.section == "Logical Reasoning" for attempt in test_values)
    rc_samples = sum(attempt.session_item.question.section == "Reading Comprehension" for attempt in test_values)
    completed_diagnostics = StudySession.query.filter_by(user_id=user.id, mode="diagnostic", status="completed").count()
    readiness_status = "ready" if lr_samples >= 40 and rc_samples >= 20 and completed_diagnostics else "forming"
    queue = review_queue_snapshot(user)
    review_values = by_evidence.get("spaced_review", [])
    review_recovery = round(sum(value.is_correct for value in review_values) / len(review_values) * 100) if review_values else None
    confidence_values = [attempt for attempt in first_attempts if attempt.confidence is not None]
    high_confidence = [attempt for attempt in confidence_values if (attempt.confidence or 0) >= 4]
    confidence = {
        "average": round(sum(attempt.confidence or 0 for attempt in confidence_values) / len(confidence_values), 1) if confidence_values else None,
        "high_confidence_error_rate": round(sum(not attempt.is_correct for attempt in high_confidence) / len(high_confidence) * 100) if high_confidence else None,
        "sample": len(confidence_values),
    }
    recommendation_skill = next((skill for skill in skills if skill["attempts"] >= 3), None)
    strategy_lab = strategy_performance(user.id)

    return {
        "overall": overall,
        "recent": recent,
        "skills": skills,
        "trend": trend,
        "diagnostic": diagnostic,
        "test_performance": test_performance,
        "evidence_classes": evidence_classes,
        "readiness": {
            "status": readiness_status,
            "lr_samples": lr_samples,
            "rc_samples": rc_samples,
            "completed_diagnostics": completed_diagnostics,
        },
        "review": {**queue, "recovery_rate": review_recovery},
        "confidence": confidence,
        "strategy_lab": strategy_lab,
        "recommendation": (
            {
                "skill": recommendation_skill["name"],
                "accuracy": recommendation_skill["accuracy"],
                "reason": "lowest combined accuracy, reasoning, and pace signal",
            }
            if recommendation_skill
            else None
        ),
    }
