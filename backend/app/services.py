from __future__ import annotations

import hashlib
import math
from copy import deepcopy
from collections import defaultdict
from datetime import timedelta, timezone

from flask import current_app
from sqlalchemy import func

from .coaching import CoachingProviderError, generate_attempt_coaching, generate_hint
from .extensions import db
from .models import (
    Attempt,
    CaseFrame,
    HintEvent,
    Question,
    ReviewCard,
    SessionItem,
    SkillProgress,
    StoryProgress,
    StudySession,
    User,
    utcnow,
)

REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30]


DIFFICULTY_WEIGHTS = {1: 0.75, 2: 0.9, 3: 1.0, 4: 1.15, 5: 1.3}
CASE_TITLES = [
    "The Amber Alibi",
    "The Clockmaker's Claim",
    "The Vanishing Premise",
    "A Contradiction at Midnight",
    "The Glasshouse Testimony",
    "The Ivory Ledger",
    "The Last Train Inference",
    "The Lantern Room File",
    "A Motive in the Margins",
    "The Crooked Conclusion",
]
LOCATIONS = [
    "the rain-slick archive",
    "a shuttered platform beneath Bellweather Station",
    "the lamplit records room",
    "an upper chamber of the Hall of Arguments",
    "the fogbound office of a reluctant witness",
]


def _stable_number(value: str) -> int:
    return int(hashlib.sha256(value.encode("utf-8")).hexdigest()[:12], 16)


def _iso_utc(value) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def story_progress_for(user: User) -> StoryProgress:
    if not user.story_progress:
        progress = StoryProgress(
            user_id=user.id,
            state_json={
                "agency": "The Lantern Bureau",
                "lead_detective": "Rowan Vale",
                "chief": "Mira Voss",
                "antagonist": "Professor Mori Quill",
            },
        )
        db.session.add(progress)
        db.session.flush()
        return progress
    return user.story_progress


def build_story_frame(question: Question, position: int, chapter: int) -> dict:
    cached = CaseFrame.query.filter_by(question_id=question.id, story_version="lantern-v1", status="generated").first()
    if cached:
        frame = deepcopy(cached.content_json)
        frame.update(
            {
                "case_number": position + 1,
                "eyebrow": f"Chapter {chapter} · Evidence file {position + 1}",
            }
        )
        return frame
    seed = _stable_number(f"{question.id}:{chapter}:{position}")
    title = CASE_TITLES[seed % len(CASE_TITLES)]
    location = LOCATIONS[(seed // 7) % len(LOCATIONS)]
    presenter = "Chief Mira Voss" if position % 3 == 0 else "Detective Rowan Vale"
    antagonist_hint = chapter > 1 and position % 4 == 0
    brief = (
        f"A {question.question_type.lower()} dispute has surfaced in {location}. "
        "The Bureau needs the claim tested before an innocent conclusion is filed as fact."
    )
    if antagonist_hint:
        brief += " A violet seal suggests Professor Quill has touched the evidence again."
    return {
        "case_number": position + 1,
        "title": title,
        "eyebrow": f"Chapter {chapter} · Evidence file {position + 1}",
        "location": location.title(),
        "presenting_character": presenter,
        "brief": brief,
        "dialogue": "Read the record exactly as it stands. The smallest logical turn may be the one that breaks the case.",
        "correct_outcome": "The contradiction gives way. Rowan marks the file solved and the Bureau's lantern burns a little brighter.",
        "incorrect_outcome": "The file stays open—but the false trail is now visible. Rowan circles the decisive clue for the return pass.",
        "transition": "Another sealed file is already waiting beneath the green desk lamp.",
    }


def serialize_user(user: User) -> dict:
    story = story_progress_for(user)
    diagnostic = (
        StudySession.query.filter_by(user_id=user.id, mode="diagnostic")
        .order_by(StudySession.started_at.desc())
        .first()
    )
    if not user.onboarding_complete:
        next_route = "/onboarding"
    elif not diagnostic or diagnostic.status != "completed":
        next_route = "/diagnostic"
    else:
        next_route = "/study"
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "target_minutes": user.target_minutes,
        "onboarding_complete": user.onboarding_complete,
        "diagnostic_complete": bool(diagnostic and diagnostic.status == "completed"),
        "next_route": next_route,
        "story": {
            "xp": story.xp,
            "chapter": story.chapter,
            "cases_solved": story.cases_solved,
            "next_level_xp": story.chapter * 500,
        },
    }


def serialize_question(question: Question) -> dict:
    return {
        "id": question.id,
        "section": question.section,
        "question_type": question.question_type,
        "difficulty": question.difficulty,
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


def serialize_item(item: SessionItem, commit_served: bool = True) -> dict:
    if not item.served_at:
        item.served_at = utcnow()
        if commit_served:
            db.session.commit()
    saved_hints = HintEvent.query.filter_by(session_item_id=item.id).order_by(HintEvent.level).all()
    return {
        "id": item.id,
        "position": item.position,
        "requires_reasoning": item.requires_reasoning,
        "served_at": _iso_utc(item.served_at),
        "story": item.story_json,
        "hints": [event.content_json for event in saved_hints],
        "question": serialize_question(item.question),
    }


def serialize_session(session: StudySession, include_item: bool = True) -> dict:
    payload = {
        "id": session.id,
        "mode": session.mode,
        "status": session.status,
        "target_minutes": session.target_minutes,
        "total_items": session.total_items,
        "current_index": session.current_index,
        "progress_percent": round(100 * session.current_index / max(1, session.total_items)),
        "started_at": _iso_utc(session.started_at),
        "completed_at": _iso_utc(session.completed_at),
    }
    if include_item and session.status == "in_progress":
        item = SessionItem.query.filter_by(session_id=session.id, position=session.current_index).first()
        payload["current_item"] = serialize_item(item) if item else None
    return payload


def _balanced_pick(questions: list[Question], count: int, salt: str) -> list[Question]:
    by_type: dict[str, list[Question]] = defaultdict(list)
    for question in questions:
        by_type[question.question_type].append(question)
    for values in by_type.values():
        values.sort(key=lambda q: (_stable_number(f"{salt}:{q.id}"), q.difficulty))

    selected: list[Question] = []
    types = sorted(by_type, key=lambda value: _stable_number(f"{salt}:{value}"))
    while len(selected) < count and any(by_type.values()):
        for question_type in types:
            if by_type[question_type] and len(selected) < count:
                selected.append(by_type[question_type].pop(0))
    return selected


def _eligible_questions() -> list[Question]:
    query = Question.query.filter(Question.section.in_(["Logical Reasoning", "Reading Comprehension"]))
    if not current_app.config["ALLOW_UNREVIEWED_QUESTIONS"]:
        query = query.filter_by(license_status="approved", review_status="published")
    return query.all()


def select_diagnostic_questions(count: int) -> list[Question]:
    eligible = _eligible_questions()
    lr = [q for q in eligible if q.section == "Logical Reasoning"]
    rc = [q for q in eligible if q.section == "Reading Comprehension"]
    rc_count = min(len(rc), max(1, round(count * 0.31)))
    lr_count = min(len(lr), count - rc_count)
    selected = _balanced_pick(lr, lr_count, "diagnostic-v1-lr") + _balanced_pick(rc, rc_count, "diagnostic-v1-rc")
    selected.sort(key=lambda q: _stable_number(f"diagnostic-v1-order:{q.id}"))
    return selected[:count]


def select_daily_questions(user: User, count: int) -> list[Question]:
    questions = _eligible_questions()
    attempted_ids = {
        row[0]
        for row in (
            db.session.query(SessionItem.question_id)
            .join(Attempt, Attempt.session_item_id == SessionItem.id)
            .filter(Attempt.user_id == user.id)
            .all()
        )
    }
    stats = {stat.skill_name: stat for stat in SkillProgress.query.filter_by(user_id=user.id).all()}

    scored = []
    for question in questions:
        stat = stats.get(question.question_type)
        if stat and stat.attempts:
            accuracy_gap = 1 - stat.correct / stat.attempts
            explanation_gap = 1 - (stat.explanation_total / stat.explanation_count if stat.explanation_count else 0.6)
            average_ms = stat.total_time_ms / stat.attempts
            time_gap = min(1.0, average_ms / 150_000)
            mistake_signal = min(1.0, stat.recent_mistakes / 3)
            need = 0.30 * accuracy_gap + 0.25 * explanation_gap + 0.20 * time_gap + 0.15 * mistake_signal
        else:
            need = 0.48 + (0.10 if question.difficulty <= 2 else 0)
        unseen_bonus = 0.28 if question.id not in attempted_ids else -0.18
        section_bonus = 0.05 if question.section == "Reading Comprehension" else 0.08
        tie_break = (_stable_number(f"{user.id}:{question.id}") % 1000) / 100000
        scored.append((need + unseen_bonus + section_bonus + tie_break, question))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    selected: list[Question] = []
    recent_types: list[str] = []
    for _, question in scored:
        if len(selected) >= count:
            break
        if len(recent_types) >= 2 and recent_types[-2:] == [question.question_type, question.question_type]:
            continue
        selected.append(question)
        recent_types.append(question.question_type)
    return selected


def select_review_questions(user: User, count: int = 10) -> list[Question]:
    cards = (
        ReviewCard.query.filter(
            ReviewCard.user_id == user.id,
            ReviewCard.due_at <= utcnow(),
        )
        .order_by(ReviewCard.due_at, ReviewCard.lapses.desc())
        .limit(count)
        .all()
    )
    return [card.question for card in cards]


def select_boss_questions(user: User, count: int = 5) -> list[Question]:
    questions = _eligible_questions()
    stats = {
        stat.skill_name: stat
        for stat in SkillProgress.query.filter_by(user_id=user.id).all()
    }

    def boss_priority(question: Question) -> tuple[float, int]:
        stat = stats.get(question.question_type)
        weakness = 1.0
        if stat and stat.attempts:
            weakness = 1 - stat.correct / stat.attempts
        return (weakness + question.difficulty * 0.12, _stable_number(f"boss:{user.id}:{question.id}"))

    questions.sort(key=boss_priority, reverse=True)
    return questions[:count]


def _create_session_from_questions(
    user: User,
    mode: str,
    questions: list[Question],
    target_minutes: int,
    blueprint: str,
) -> StudySession:
    if not questions:
        raise RuntimeError("No reviewed and licensed questions are available")

    story = story_progress_for(user)
    session = StudySession(
        user_id=user.id,
        mode=mode,
        target_minutes=target_minutes,
        total_items=len(questions),
        blueprint_version=blueprint,
    )
    db.session.add(session)
    db.session.flush()
    for position, question in enumerate(questions):
        requires_reasoning = (
            position % 5 == 2
            if mode == "diagnostic"
            else position % 4 == 1
        )
        frame = build_story_frame(
            question,
            position + story.cases_solved,
            story.chapter,
        )
        if mode == "review":
            frame.update(
                {
                    "title": f"Cold Case: {frame['title']}",
                    "eyebrow": f"Evidence archive · Reopened file {position + 1}",
                    "brief": "A prior false trail has resurfaced. Reconstruct the reasoning without relying on the old answer.",
                }
            )
        elif mode == "boss":
            frame.update(
                {
                    "title": f"Quill File {position + 1}: {frame['title']}",
                    "eyebrow": f"Chapter {story.chapter} confrontation · Sealed evidence",
                    "presenting_character": "Professor Mori Quill",
                    "brief": "Professor Quill has assembled this argument from one of your weakest case types. Break the chain before the file is sealed.",
                    "dialogue": "You have seen premises like these before, Detective. Let us see whether you learned where they fracture.",
                }
            )
        db.session.add(
            SessionItem(
                session_id=session.id,
                question_id=question.id,
                position=position,
                requires_reasoning=requires_reasoning,
                story_json=frame,
            )
        )
    db.session.commit()
    return session


def create_study_session(user: User, mode: str) -> StudySession:
    active = (
        StudySession.query.filter_by(user_id=user.id, mode=mode, status="in_progress")
        .order_by(StudySession.started_at.desc())
        .first()
    )
    if active:
        return active

    story = story_progress_for(user)
    if mode == "diagnostic":
        target_minutes = 70
        questions = select_diagnostic_questions(current_app.config["DIAGNOSTIC_SIZE"])
        blueprint = "diagnostic-v1"
    elif mode == "review":
        target_minutes = 20
        questions = select_review_questions(user)
        blueprint = "cold-cases-v1"
    elif mode == "boss":
        target_minutes = 15
        questions = select_boss_questions(user)
        blueprint = f"quill-boss-chapter-{story.chapter}"
    else:
        target_minutes = user.target_minutes
        question_count = max(4, min(20, math.ceil(target_minutes / 2.5)))
        questions = select_daily_questions(user, question_count)
        blueprint = "adaptive-v1"

    return _create_session_from_questions(
        user,
        mode,
        questions,
        target_minutes,
        blueprint,
    )


def _elapsed_ms(item: SessionItem, client_elapsed_ms: int | None) -> int:
    served = item.served_at or utcnow()
    if served.tzinfo is None:
        served = served.replace(tzinfo=timezone.utc)
    server_ms = int((utcnow() - served).total_seconds() * 1000)
    server_ms = max(1000, min(server_ms, 15 * 60 * 1000))
    if client_elapsed_ms and client_elapsed_ms > 0:
        return max(1000, min(server_ms, client_elapsed_ms + 15_000))
    return server_ms


def _feedback(question: Question, selected_label: str, is_correct: bool, story: dict, reasoning: str | None) -> dict:
    if is_correct:
        diagnosis = "Your answer matches the verified key. Keep the reasoning chain—especially the step that ruled out the closest distractor."
        first_error = None
    else:
        diagnosis = (
            f"The verified answer is {question.correct_answer}. Re-read the stem, then identify the exact job the correct choice must perform before comparing choices."
        )
        first_error = "answer_task_mismatch"
    if reasoning:
        coaching = "Your written reasoning is saved. The TrueFoundry coach will grade the reasoning independently of answer correctness."
    else:
        coaching = "The TrueFoundry coach will explain the correct answer and each distractor."
    return {
        "is_correct": is_correct,
        "selected_label": selected_label,
        "correct_label": question.correct_answer,
        "headline": "Case closed" if is_correct else "False trail identified",
        "diagnosis": diagnosis,
        "coaching_notice": coaching,
        "first_error_code": first_error,
        "narrative_outcome": story["correct_outcome"] if is_correct else story["incorrect_outcome"],
        "transition": story["transition"],
    }


def _update_skill(user_id: str, question: Question, is_correct: bool, explanation_score: float | None, elapsed_ms: int) -> tuple[SkillProgress, bool]:
    stat = SkillProgress.query.filter_by(user_id=user_id, skill_name=question.question_type).first()
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
    prior_pace_unlocked = stat.attempts >= 8 and stat.correct / max(1, stat.attempts) >= 0.8
    stat.attempts += 1
    stat.correct += int(is_correct)
    stat.total_time_ms += elapsed_ms
    if explanation_score is not None:
        stat.explanation_total += explanation_score
        stat.explanation_count += 1
    stat.recent_mistakes = max(0, stat.recent_mistakes - 1) if is_correct else min(5, stat.recent_mistakes + 1)
    return stat, prior_pace_unlocked


def _update_review_card(
    user: User,
    question: Question,
    is_correct: bool,
    session_mode: str,
) -> None:
    card = ReviewCard.query.filter_by(
        user_id=user.id,
        question_id=question.id,
    ).first()
    now = utcnow()
    if not card:
        if is_correct:
            return
        card = ReviewCard(
            user_id=user.id,
            question_id=question.id,
            box=0,
            reps=0,
            lapses=1,
            last_result=False,
            due_at=now,
            last_reviewed_at=now,
        )
        db.session.add(card)
        return

    card.reps += 1
    card.last_result = is_correct
    card.last_reviewed_at = now
    if is_correct:
        card.box = min(card.box + 1, len(REVIEW_INTERVAL_DAYS))
        interval_index = min(card.box - 1, len(REVIEW_INTERVAL_DAYS) - 1)
        card.due_at = now + timedelta(days=REVIEW_INTERVAL_DAYS[interval_index])
    else:
        card.box = 0
        card.lapses += 1
        card.due_at = now + (timedelta(days=1) if session_mode == "review" else timedelta())


def ensure_historical_review_cards(user: User) -> None:
    existing_ids = {
        row[0]
        for row in db.session.query(ReviewCard.question_id)
        .filter(ReviewCard.user_id == user.id)
        .all()
    }
    latest_by_question: dict[str, Attempt] = {}
    attempts = (
        Attempt.query.join(SessionItem)
        .filter(Attempt.user_id == user.id)
        .order_by(Attempt.created_at)
        .all()
    )
    for attempt in attempts:
        latest_by_question[attempt.session_item.question_id] = attempt
    now = utcnow()
    for question_id, attempt in latest_by_question.items():
        if question_id in existing_ids or attempt.is_correct:
            continue
        db.session.add(
            ReviewCard(
                user_id=user.id,
                question_id=question_id,
                box=0,
                reps=0,
                lapses=1,
                last_result=False,
                due_at=now,
                last_reviewed_at=attempt.created_at,
            )
        )
    db.session.flush()


def submit_attempt(user: User, session: StudySession, payload: dict, idempotency_key: str) -> tuple[Attempt, bool]:
    existing = Attempt.query.filter_by(idempotency_key=idempotency_key).first()
    if existing:
        if existing.user_id != user.id:
            raise ValueError("idempotency_conflict")
        return existing, True

    if session.status != "in_progress":
        raise ValueError("session_complete")
    item = SessionItem.query.filter_by(id=payload.get("item_id"), session_id=session.id).first()
    if not item or item.position != session.current_index:
        raise ValueError("invalid_session_item")
    if item.attempt:
        return item.attempt, True

    selected_label = str(payload.get("selected_label", "")).upper()
    if selected_label not in {choice.label for choice in item.question.choices}:
        raise ValueError("invalid_choice")
    reasoning = (payload.get("reasoning") or "").strip()[:4000] or None
    if item.requires_reasoning and (not reasoning or len(reasoning) < 20):
        raise ValueError("reasoning_required")
    client_ms = payload.get("elapsed_ms")
    try:
        client_ms = int(client_ms) if client_ms is not None else None
    except (TypeError, ValueError):
        client_ms = None
    elapsed_ms = _elapsed_ms(item, client_ms)
    is_correct = selected_label == item.question.correct_answer
    explanation_score = None
    _, pace_scored = _update_skill(user.id, item.question, is_correct, None, elapsed_ms)
    _update_review_card(user, item.question, is_correct, session.mode)

    answer_value = 1.0 if is_correct else -0.25
    capm_points = DIFFICULTY_WEIGHTS[item.question.difficulty] * answer_value
    xp = (25 + item.question.difficulty * 5 if is_correct else 8) + (5 if reasoning else 0)
    feedback = _feedback(item.question, selected_label, is_correct, item.story_json, reasoning)
    attempt = Attempt(
        user_id=user.id,
        session_item_id=item.id,
        idempotency_key=idempotency_key,
        selected_label=selected_label,
        is_correct=is_correct,
        reasoning_text=reasoning,
        explanation_score=explanation_score,
        server_elapsed_ms=elapsed_ms,
        client_elapsed_ms=client_ms,
        capm_points=capm_points,
        pace_scored=pace_scored and session.mode == "daily",
        xp_earned=xp,
        feedback_json=feedback,
        coaching_status="pending",
    )
    db.session.add(attempt)
    item.completed_at = utcnow()
    session.current_index += 1

    story = story_progress_for(user)
    story.xp += xp
    if session.mode == "daily":
        story.cases_solved += 1
        story.chapter = 1 + story.cases_solved // 8

    if session.current_index >= session.total_items:
        session.status = "completed"
        session.completed_at = utcnow()
        if session.mode == "boss":
            milestone = max(1, story.cases_solved // 8)
            state = dict(story.state_json or {})
            defeated = list(state.get("defeated_boss_chapters", []))
            if milestone not in defeated:
                defeated.append(milestone)
                story.xp += 100
            state["defeated_boss_chapters"] = defeated
            story.state_json = state
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
        "xp_earned": attempt.xp_earned,
        "pace_scored": attempt.pace_scored,
        "elapsed_ms": attempt.server_elapsed_ms,
        "feedback": attempt.feedback_json,
        "coaching_status": attempt.coaching_status,
        "session_complete": session.status == "completed",
        "session_id": session.id,
    }


def run_attempt_coaching(attempt: Attempt) -> dict:
    existing_feedback = (attempt.feedback_json or {}).get("coaching")
    if attempt.coaching_status == "completed" and existing_feedback:
        return existing_feedback
    if attempt.coaching_status == "processing":
        raise ValueError("coaching_in_progress")

    attempt.coaching_status = "processing"
    db.session.commit()
    try:
        coaching, _metadata = generate_attempt_coaching(attempt)
    except CoachingProviderError:
        attempt.coaching_status = "failed"
        db.session.commit()
        raise

    if coaching["explanation_grade"] is not None:
        normalized_score = coaching["explanation_grade"] / 100
        stat = SkillProgress.query.filter_by(
            user_id=attempt.user_id,
            skill_name=attempt.session_item.question.question_type,
        ).first()
        if stat:
            stat.explanation_total += normalized_score
            stat.explanation_count += 1
        attempt.explanation_score = normalized_score

    feedback = dict(attempt.feedback_json or {})
    feedback["coaching"] = coaching
    attempt.feedback_json = feedback
    attempt.coaching_status = "completed"
    attempt.coaching_model = coaching["model"]
    attempt.coached_at = utcnow()
    db.session.flush()
    session = attempt.session_item.session
    if session.status == "completed":
        session.summary_json = calculate_session_summary(session)
    db.session.commit()
    return coaching


def request_item_hint(user: User, item: SessionItem) -> dict:
    saved = HintEvent.query.filter_by(session_item_id=item.id).order_by(HintEvent.level).all()
    if len(saved) >= 3:
        raise ValueError("hint_limit_reached")
    level = len(saved) + 1
    existing = HintEvent.query.filter_by(session_item_id=item.id, level=level).first()
    if existing:
        return existing.content_json

    hint, _metadata = generate_hint(item, level)
    event = HintEvent(
        user_id=user.id,
        session_item_id=item.id,
        level=level,
        content_json=hint,
        model=hint["model"],
        prompt_version=hint["prompt_version"],
    )
    db.session.add(event)
    db.session.commit()
    return hint


def _diagnostic_summary(session: StudySession, attempts: list[Attempt]) -> dict:
    total_weight = sum(DIFFICULTY_WEIGHTS[a.session_item.question.difficulty] for a in attempts) or 1
    earned_weight = sum(
        DIFFICULTY_WEIGHTS[a.session_item.question.difficulty]
        for a in attempts
        if a.is_correct
    )
    weighted_accuracy = earned_weight / total_weight
    explanation_scores = [a.explanation_score for a in attempts if a.explanation_score is not None]
    explanation_average = sum(explanation_scores) / len(explanation_scores) if explanation_scores else None
    reasoning_adjustment = round((explanation_average - 0.5) * 4) if explanation_average is not None else 0
    estimated_score = max(120, min(180, round(120 + weighted_accuracy * 60) + reasoning_adjustment))
    margin = 4 if len(attempts) >= 30 else 7
    skills = _skill_breakdown(attempts)
    weak = sorted(skills, key=lambda value: (value["accuracy"], -value["attempts"]))[:4]
    section_accuracy = {}
    for section in ["Logical Reasoning", "Reading Comprehension"]:
        subset = [a for a in attempts if a.session_item.question.section == section]
        section_accuracy[section] = round(sum(a.is_correct for a in subset) / max(1, len(subset)) * 100)
    return {
        "kind": "diagnostic",
        "estimated_score": estimated_score,
        "confidence": "Moderate" if len(attempts) >= 30 else "Early estimate",
        "confidence_low": max(120, estimated_score - margin),
        "confidence_high": min(180, estimated_score + margin),
        "accuracy": round(sum(a.is_correct for a in attempts) / max(1, len(attempts)) * 100),
        "questions_completed": len(attempts),
        "explanation_accuracy": round(explanation_average * 100) if explanation_average is not None else None,
        "section_accuracy": section_accuracy,
        "weak_areas": weak,
        "message": "This is an unofficial starting estimate. It becomes more useful as Sherlock collects more timed evidence.",
    }


def _skill_breakdown(attempts: list[Attempt]) -> list[dict]:
    grouped: dict[str, list[Attempt]] = defaultdict(list)
    for attempt in attempts:
        grouped[attempt.session_item.question.question_type].append(attempt)
    result = []
    for name, values in grouped.items():
        explained = [a.explanation_score for a in values if a.explanation_score is not None]
        result.append(
            {
                "name": name,
                "attempts": len(values),
                "accuracy": round(sum(a.is_correct for a in values) / len(values) * 100),
                "average_time_seconds": round(sum(a.server_elapsed_ms for a in values) / len(values) / 1000),
                "explanation_accuracy": round(sum(explained) / len(explained) * 100) if explained else None,
            }
        )
    return result


def _ghost_for(session: StudySession, accuracy: int, capm: float | None) -> dict | None:
    if capm is None:
        return None
    previous = (
        StudySession.query.filter(
            StudySession.user_id == session.user_id,
            StudySession.mode == "daily",
            StudySession.status == "completed",
            StudySession.id != session.id,
            StudySession.summary_json.isnot(None),
        )
        .order_by(StudySession.completed_at.desc())
        .first()
    )
    if not previous or not previous.summary_json or previous.summary_json.get("capm") is None:
        return None
    prior_capm = previous.summary_json["capm"]
    delta = round((capm - prior_capm) / max(0.01, abs(prior_capm)) * 100)
    return {
        "baseline": "Previous session",
        "capm": prior_capm,
        "accuracy": previous.summary_json.get("accuracy"),
        "delta_percent": delta,
        "message": f"You closed cases {abs(delta)}% {'faster' if delta >= 0 else 'slower'} than your previous pace.",
    }


def calculate_session_summary(session: StudySession) -> dict:
    attempts = (
        Attempt.query.join(SessionItem)
        .filter(SessionItem.session_id == session.id)
        .order_by(Attempt.created_at)
        .all()
    )
    if session.mode == "diagnostic":
        return _diagnostic_summary(session, attempts)

    accuracy = round(sum(a.is_correct for a in attempts) / max(1, len(attempts)) * 100)
    paced = [a for a in attempts if a.pace_scored]
    capm = None
    if paced:
        minutes = sum(a.server_elapsed_ms for a in paced) / 60_000
        capm = round(sum(a.capm_points for a in paced) / max(0.1, minutes), 2)
    summary = {
        "kind": session.mode,
        "accuracy": accuracy,
        "correct": sum(a.is_correct for a in attempts),
        "questions_completed": len(attempts),
        "elapsed_minutes": round(sum(a.server_elapsed_ms for a in attempts) / 60_000, 1),
        "xp_earned": sum(a.xp_earned for a in attempts),
        "capm": capm,
        "pace_unlocked": bool(paced),
        "pace_message": (
            "CAPM is live for skills where you have established 80% accuracy across 8 attempts."
            if paced
            else "Accuracy-first mode: CAPM unlocks per skill after 80% accuracy across 8 attempts."
        ),
        "skills": _skill_breakdown(attempts),
    }
    if session.mode == "boss":
        summary["xp_earned"] += 100
        summary["boss_reward_xp"] = 100
    summary["ghost"] = _ghost_for(session, accuracy, capm)
    return summary


def cold_case_dashboard(user: User) -> dict:
    ensure_historical_review_cards(user)
    now = utcnow()
    base = ReviewCard.query.filter_by(user_id=user.id)
    due_query = base.filter(ReviewCard.due_at <= now)
    due_cards = due_query.order_by(
        ReviewCard.due_at,
        ReviewCard.lapses.desc(),
    ).limit(6).all()
    next_card = base.filter(ReviewCard.due_at > now).order_by(ReviewCard.due_at).first()
    return {
        "due_count": due_query.count(),
        "total_cards": base.count(),
        "next_due_at": _iso_utc(next_card.due_at) if next_card else None,
        "cards": [
            {
                "id": card.id,
                "question_id": card.question_id,
                "section": card.question.section,
                "question_type": card.question.question_type,
                "difficulty": card.question.difficulty,
                "stem": card.question.stem,
                "lapses": card.lapses,
                "box": card.box,
                "due_at": _iso_utc(card.due_at),
            }
            for card in due_cards
        ],
    }


def boss_case_status(user: User) -> dict:
    story = story_progress_for(user)
    milestone = story.cases_solved // 8
    state = story.state_json or {}
    defeated = set(state.get("defeated_boss_chapters", []))
    active = (
        StudySession.query.filter_by(
            user_id=user.id,
            mode="boss",
            status="in_progress",
        )
        .order_by(StudySession.started_at.desc())
        .first()
    )
    available = milestone >= 1 and milestone not in defeated
    return {
        "available": available,
        "chapter": max(1, milestone),
        "cases_until_boss": 0 if available else max(0, 8 - story.cases_solved % 8),
        "active_session_id": active.id if active else None,
        "reward_xp": 100,
        "defeated": sorted(defeated),
    }


def archive_cases(
    user: User,
    correctness: str | None = None,
    section: str | None = None,
    question_type: str | None = None,
    page: int = 1,
    per_page: int = 20,
) -> dict:
    query = (
        Attempt.query.join(SessionItem)
        .join(Question)
        .filter(Attempt.user_id == user.id)
    )
    if correctness == "correct":
        query = query.filter(Attempt.is_correct.is_(True))
    elif correctness == "incorrect":
        query = query.filter(Attempt.is_correct.is_(False))
    if section:
        query = query.filter(Question.section == section)
    if question_type:
        query = query.filter(Question.question_type == question_type)

    total = query.count()
    attempts = (
        query.order_by(Attempt.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    types = [
        row[0]
        for row in db.session.query(Question.question_type)
        .join(SessionItem)
        .join(Attempt)
        .filter(Attempt.user_id == user.id)
        .distinct()
        .order_by(Question.question_type)
        .all()
    ]
    return {
        "cases": [
            {
                "attempt_id": attempt.id,
                "question_id": attempt.session_item.question_id,
                "title": (attempt.session_item.story_json or {}).get("title", "Archived case"),
                "section": attempt.session_item.question.section,
                "question_type": attempt.session_item.question.question_type,
                "difficulty": attempt.session_item.question.difficulty,
                "stem": attempt.session_item.question.stem,
                "selected_label": attempt.selected_label,
                "correct_label": attempt.session_item.question.correct_answer,
                "is_correct": attempt.is_correct,
                "reasoning_provided": bool(attempt.reasoning_text),
                "explanation_score": (
                    round(attempt.explanation_score * 100)
                    if attempt.explanation_score is not None
                    else None
                ),
                "elapsed_ms": attempt.server_elapsed_ms,
                "session_mode": attempt.session_item.session.mode,
                "attempted_at": _iso_utc(attempt.created_at),
            }
            for attempt in attempts
        ],
        "filters": {"question_types": types},
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "pages": math.ceil(total / per_page) if total else 0,
        },
    }


def archive_case_detail(user: User, attempt_id: str) -> dict | None:
    attempt = Attempt.query.filter_by(id=attempt_id, user_id=user.id).first()
    if not attempt:
        return None
    item = attempt.session_item
    question = item.question
    card = ReviewCard.query.filter_by(
        user_id=user.id,
        question_id=question.id,
    ).first()
    question_payload = serialize_question(question)
    question_payload["correct_answer"] = question.correct_answer
    return {
        "attempt": {
            "id": attempt.id,
            "selected_label": attempt.selected_label,
            "is_correct": attempt.is_correct,
            "reasoning_text": attempt.reasoning_text,
            "explanation_score": (
                round(attempt.explanation_score * 100)
                if attempt.explanation_score is not None
                else None
            ),
            "elapsed_ms": attempt.server_elapsed_ms,
            "feedback": attempt.feedback_json,
            "coaching_status": attempt.coaching_status,
            "attempted_at": _iso_utc(attempt.created_at),
        },
        "question": question_payload,
        "story": item.story_json,
        "session": {
            "id": item.session.id,
            "mode": item.session.mode,
        },
        "review": (
            {
                "box": card.box,
                "lapses": card.lapses,
                "due_at": _iso_utc(card.due_at),
            }
            if card
            else None
        ),
    }


def progress_dashboard(user: User) -> dict:
    story = story_progress_for(user)
    diagnostic = (
        StudySession.query.filter_by(user_id=user.id, mode="diagnostic", status="completed")
        .order_by(StudySession.completed_at.desc())
        .first()
    )
    completed_daily = StudySession.query.filter_by(user_id=user.id, mode="daily", status="completed").count()
    total_attempts = Attempt.query.filter_by(user_id=user.id).count()
    total_correct = Attempt.query.filter_by(user_id=user.id, is_correct=True).count()
    stats = SkillProgress.query.filter_by(user_id=user.id).all()
    skill_rows = [
        {
            "name": stat.skill_name,
            "attempts": stat.attempts,
            "accuracy": round(stat.correct / max(1, stat.attempts) * 100),
            "average_time_seconds": round(stat.total_time_ms / max(1, stat.attempts) / 1000),
            "explanation_accuracy": (
                round(stat.explanation_total / stat.explanation_count * 100)
                if stat.explanation_count
                else None
            ),
            "pace_unlocked": stat.attempts >= 8 and stat.correct / max(1, stat.attempts) >= 0.8,
        }
        for stat in stats
    ]
    skill_rows.sort(key=lambda value: (value["accuracy"], -value["attempts"]))
    pace_sessions = (
        StudySession.query.filter_by(user_id=user.id, mode="daily", status="completed")
        .order_by(StudySession.completed_at.desc())
        .limit(10)
        .all()
    )
    pace_history = [
        {
            "date": session.completed_at.date().isoformat(),
            "accuracy": (session.summary_json or {}).get("accuracy"),
            "capm": (session.summary_json or {}).get("capm"),
            "questions": (session.summary_json or {}).get("questions_completed"),
        }
        for session in reversed(pace_sessions)
    ]
    return {
        "readiness": diagnostic.summary_json if diagnostic else None,
        "story": {
            "xp": story.xp,
            "chapter": story.chapter,
            "cases_solved": story.cases_solved,
            "next_level_xp": story.chapter * 500,
        },
        "totals": {
            "sessions": completed_daily,
            "attempts": total_attempts,
            "accuracy": round(total_correct / max(1, total_attempts) * 100),
        },
        "skills": skill_rows,
        "pace_history": pace_history,
    }
