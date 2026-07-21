from __future__ import annotations

import hashlib
import math
from collections import defaultdict
from datetime import timezone

from flask import current_app

from .coaching import CoachingProviderError, generate_attempt_coaching, generate_hint
from .extensions import db
from .models import (
    Attempt,
    HintEvent,
    Question,
    SessionItem,
    SkillProgress,
    StoryProgress,
    StudySession,
    User,
    utcnow,
)
from .session_planner import MAX_CANDIDATES, plan_session_sequence
from .story_engine import CAST_REGISTRY, fallback_story_beat, generate_story_beat


DIFFICULTY_WEIGHTS = {1: 0.75, 2: 0.9, 3: 1.0, 4: 1.15, 5: 1.3}
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


def serialize_user(user: User) -> dict:
    story = story_progress_for(user)
    diagnostic = (
        StudySession.query.filter_by(user_id=user.id, mode="diagnostic")
        .order_by(StudySession.started_at.desc())
        .first()
    )
    latest_unseen_summary = (
        StudySession.query.filter_by(user_id=user.id, mode="daily", status="completed", summary_seen_at=None)
        .order_by(StudySession.completed_at.desc())
        .first()
    )
    latest_pending_daily = (
        StudySession.query.filter(
            StudySession.user_id == user.id,
            StudySession.mode == "daily",
            StudySession.pending_attempt_id.isnot(None),
        )
        .order_by(StudySession.started_at.desc())
        .first()
    )
    if not user.onboarding_complete:
        next_route = "/onboarding"
    elif not diagnostic or diagnostic.status != "completed":
        next_route = "/diagnostic"
    elif diagnostic.pending_attempt_id:
        next_route = "/diagnostic"
    elif not diagnostic.results_seen_at:
        next_route = "/diagnostic/results"
    elif not user.story_intro_seen:
        next_route = "/story/introduction"
    elif latest_pending_daily:
        next_route = f"/study/{latest_pending_daily.id}"
    elif latest_unseen_summary:
        next_route = f"/session/{latest_unseen_summary.id}/summary"
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
        "story_intro_seen": user.story_intro_seen,
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


def planned_story_beat_for(item: SessionItem) -> dict | None:
    plan = item.session.sequence_plan_json or {}
    beats = plan.get("beats")
    if not isinstance(beats, list):
        return None
    for beat in beats:
        if (
            isinstance(beat, dict)
            and beat.get("position") == item.position
            and beat.get("question_id") == item.question_id
        ):
            return {
                "position": item.position,
                "question_id": item.question_id,
                "location_id": beat.get("location_id"),
                "featured_cast": beat.get("featured_cast") if isinstance(beat.get("featured_cast"), list) else [],
                "story_role": beat.get("story_role") or "Evidence link",
                "setup_hook": beat.get("setup_hook") or "A new evidence file joins the investigation.",
                "payoff_hook": beat.get("payoff_hook") or "The resolved file points the investigation forward.",
            }
    return None


def story_plan_context_for(item: SessionItem) -> dict | None:
    plan = item.session.sequence_plan_json or {}
    arc = plan.get("arc")
    beat = planned_story_beat_for(item)
    if not isinstance(arc, dict) or not beat:
        return None
    return {
        "source": plan.get("source") or "fallback",
        "episode_label": plan.get("episode_label") or "Lantern Bureau Sequence",
        "featured_cast": (
            plan.get("featured_cast")
            if isinstance(plan.get("featured_cast"), list)
            else []
        ),
        "arc": {
            key: arc.get(key)
            for key in ("title", "premise", "objective", "climax", "resolution_hook")
            if isinstance(arc.get(key), str)
        },
        "beat": beat,
        "total_beats": len(plan.get("beats") or []),
    }


def public_planned_story_beat(item: SessionItem) -> dict | None:
    beat = planned_story_beat_for(item)
    if not beat:
        return None
    public = {
        "position": beat["position"],
        "story_role": beat["story_role"],
        "setup_hook": beat["setup_hook"],
    }
    if item.completed_at:
        public["payoff_hook"] = beat["payoff_hook"]
    return public


def public_item_story(item: SessionItem, story: dict | None = None) -> dict | None:
    value = story if story is not None else item.story_json
    if not isinstance(value, dict):
        return None
    if item.completed_at:
        return value
    # Alternate outcomes and the planned connective payoff are post-grade
    # material. They stay persisted server-side but never cross the pre-answer API.
    return {
        key: nested
        for key, nested in value.items()
        if key not in {"correct_outcome", "incorrect_outcome", "next_hook", "transition"}
    }


def _public_story_plan(session: StudySession) -> dict | None:
    plan = session.sequence_plan_json or {}
    arc = plan.get("arc")
    beats = plan.get("beats")
    if not isinstance(arc, dict) or not isinstance(beats, list):
        return None
    return {
        "arc_title": arc.get("title"),
        "arc_premise": arc.get("premise"),
        "arc_objective": arc.get("objective"),
        "arc_climax": arc.get("climax") if session.status == "completed" else None,
        "resolution_hook": arc.get("resolution_hook") if session.status == "completed" else None,
        "episode_label": plan.get("episode_label"),
        "total_beats": len(beats),
        "source": plan.get("source") or "fallback",
        "model": plan.get("model"),
    }


def serialize_item(item: SessionItem, commit_served: bool = True) -> dict:
    if not item.served_at:
        item.served_at = utcnow()
        item.active_elapsed_ms = item.active_elapsed_ms or 0
        if commit_served:
            db.session.commit()
    elapsed_ms = item.active_elapsed_ms or 0
    if item.timer_started_at and item.session.status == "in_progress":
        timer_started = item.timer_started_at
        if timer_started.tzinfo is None:
            timer_started = timer_started.replace(tzinfo=timezone.utc)
        elapsed_ms += max(0, int((utcnow() - timer_started).total_seconds() * 1000))
    saved_hints = HintEvent.query.filter_by(session_item_id=item.id).order_by(HintEvent.level).all()
    planned_beat = public_planned_story_beat(item)
    return {
        "id": item.id,
        "position": item.position,
        "requires_reasoning": item.requires_reasoning,
        "served_at": _iso_utc(item.served_at),
        "elapsed_ms": elapsed_ms,
        "timer_started": bool(item.timer_activated_at),
        "timer_active": bool(item.timer_started_at and item.session.status == "in_progress"),
        "draft": {
            "selected_label": item.draft_selected_label,
            "reasoning": item.draft_reasoning_text or "",
            "updated_at": _iso_utc(item.draft_updated_at),
        },
        "story": public_item_story(item),
        "story_generation_status": item.story_generation_status,
        "planned_story_role": planned_beat.get("story_role") if planned_beat else None,
        "planned_story_beat": planned_beat,
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
        "results_seen": bool(session.results_seen_at),
        "summary_seen": bool(session.summary_seen_at),
        "story_plan": _public_story_plan(session),
    }
    pending_loaded = False
    if session.pending_attempt_id:
        pending_attempt = db.session.get(Attempt, session.pending_attempt_id)
        if pending_attempt:
            pending_loaded = True
            payload["pending_result"] = serialize_attempt_result(pending_attempt)
            payload["pending_item"] = serialize_item(pending_attempt.session_item, commit_served=False)
    if not pending_loaded and include_item and session.status == "in_progress":
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


def select_diagnostic_questions(count: int, eligible: list[Question] | None = None) -> list[Question]:
    eligible = list(eligible) if eligible is not None else _eligible_questions()
    lr = [q for q in eligible if q.section == "Logical Reasoning"]
    rc = [q for q in eligible if q.section == "Reading Comprehension"]
    rc_count = min(len(rc), max(1, round(count * 0.31)))
    lr_count = min(len(lr), count - rc_count)
    selected = _balanced_pick(lr, lr_count, "diagnostic-v1-lr") + _balanced_pick(rc, rc_count, "diagnostic-v1-rc")
    if len(selected) < count:
        selected_ids = {question.id for question in selected}
        remaining = [question for question in eligible if question.id not in selected_ids]
        selected.extend(_balanced_pick(remaining, count - len(selected), "diagnostic-v1-backfill"))
    selected.sort(key=lambda q: _stable_number(f"diagnostic-v1-order:{q.id}"))
    return selected[:count]


def _rank_daily_questions(user: User, questions: list[Question] | None = None) -> list[Question]:
    questions = list(questions) if questions is not None else _eligible_questions()
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
    return [question for _, question in scored]


def _pick_daily_questions(ranked: list[Question], count: int) -> list[Question]:
    if count <= 0:
        return []

    # Establish breadth before adaptive fill. A score-sorted list can otherwise
    # begin with a large block of one or two weak skills, causing the
    # deterministic provider fallback to violate the same diversity contract
    # imposed on generated plans.
    selected: list[Question] = []
    selected_ids: set[str] = set()
    available_types = {question.question_type for question in ranked}
    required_types = min(3 if count >= 4 else count, count, len(available_types))
    seeded_types: set[str] = set()
    for question in ranked:
        if question.question_type in seeded_types:
            continue
        selected.append(question)
        selected_ids.add(question.id)
        seeded_types.add(question.question_type)
        if len(seeded_types) >= required_types or len(selected) >= count:
            break

    def difficulty_band(question: Question) -> str:
        if question.difficulty <= 2:
            return "foundation"
        if question.difficulty == 3:
            return "core"
        return "stretch"

    available_bands = {difficulty_band(question) for question in ranked}
    selected_bands = {difficulty_band(question) for question in selected}
    if count >= 4 and len(available_bands) >= 2 and len(selected_bands) < 2:
        for question in ranked:
            if question.id not in selected_ids and difficulty_band(question) not in selected_bands:
                selected.append(question)
                selected_ids.add(question.id)
                break

    # Fill by adaptive rank while preventing three consecutive files of the
    # same type. Re-scan after every pick so the best currently valid file wins.
    while len(selected) < min(count, len(ranked)):
        next_question = next(
            (
                question
                for question in ranked
                if question.id not in selected_ids
                and not (
                    len(selected) >= 2
                    and selected[-1].question_type == selected[-2].question_type == question.question_type
                )
            ),
            None,
        )
        if next_question is None:
            next_question = next(
                (question for question in ranked if question.id not in selected_ids),
                None,
            )
        if next_question is None:
            break
        selected.append(next_question)
        selected_ids.add(next_question.id)
    return selected[:count]


def select_daily_questions(user: User, count: int, questions: list[Question] | None = None) -> list[Question]:
    return _pick_daily_questions(_rank_daily_questions(user, questions), count)


def _bounded_candidate_pool(fallback: list[Question], ranked: list[Question]) -> list[Question]:
    target = min(len(ranked), max(len(fallback), min(MAX_CANDIDATES, max(48, len(fallback) * 3))))
    result: list[Question] = []
    seen: set[str] = set()
    for question in [*fallback, *ranked]:
        if question.id in seen:
            continue
        seen.add(question.id)
        result.append(question)
        if len(result) >= target:
            break
    return result


def _planning_context(user: User, mode: str, story: StoryProgress) -> dict:
    state = dict(story.state_json or {})
    context: dict = {
        "story_chapter": story.chapter,
        "cases_solved": story.cases_solved,
        "prior_story": {
            key: state.get(key)
            for key in ("last_case_title", "last_location_id", "last_hook", "last_outcome")
            if state.get(key) is not None
        },
    }
    if mode == "diagnostic":
        context["learning_goal"] = "Establish a balanced baseline across section, skill, and difficulty."
        return context
    stats = SkillProgress.query.filter_by(user_id=user.id).all()
    ranked_stats = sorted(
        stats,
        key=lambda stat: (
            stat.correct / max(1, stat.attempts),
            -(stat.recent_mistakes or 0),
            -stat.attempts,
        ),
    )[:8]
    context["priority_skills"] = [
        {
            "name": stat.skill_name,
            "attempts": stat.attempts,
            "accuracy_percent": round(stat.correct / max(1, stat.attempts) * 100),
            "recent_mistakes": stat.recent_mistakes,
        }
        for stat in ranked_stats
    ]
    return context


def create_study_session(user: User, mode: str) -> StudySession:
    active = (
        StudySession.query.filter(
            StudySession.user_id == user.id,
            StudySession.mode == mode,
            StudySession.status.in_(["in_progress", "paused"]),
        )
        .order_by(StudySession.started_at.desc())
        .first()
    )
    if active:
        return active

    story = story_progress_for(user)
    eligible = _eligible_questions()
    if mode == "diagnostic":
        target_minutes = 70
        fallback_questions = select_diagnostic_questions(current_app.config["DIAGNOSTIC_SIZE"], eligible)
        diagnostic_ranked = _balanced_pick(eligible, len(eligible), "diagnostic-sequence-v1-candidates")
        candidates = _bounded_candidate_pool(fallback_questions, diagnostic_ranked)
        blueprint = "diagnostic-sequence-v1"
    else:
        target_minutes = user.target_minutes
        question_count = max(4, min(20, math.ceil(target_minutes / 2.5)))
        daily_ranked = _rank_daily_questions(user, eligible)
        fallback_questions = _pick_daily_questions(daily_ranked, question_count)
        candidates = _bounded_candidate_pool(fallback_questions, daily_ranked)
        blueprint = "adaptive-sequence-v1"

    if not fallback_questions:
        raise RuntimeError("No reviewed and licensed questions are available")
    questions, sequence_plan = plan_session_sequence(
        mode,
        candidates,
        fallback_questions,
        _planning_context(user, mode, story),
    )

    session = StudySession(
        user_id=user.id,
        mode=mode,
        target_minutes=target_minutes,
        total_items=len(questions),
        blueprint_version=blueprint,
        sequence_plan_json=sequence_plan,
    )
    db.session.add(session)
    db.session.flush()
    for position, question in enumerate(questions):
        requires_reasoning = position % 5 == 2 if mode == "diagnostic" else position % 4 == 1
        item = SessionItem(
            session_id=session.id,
            question_id=question.id,
            position=position,
            requires_reasoning=requires_reasoning,
            story_json=None,
        )
        db.session.add(item)
        db.session.flush()
        item.story_json = fallback_story_beat(
            item,
            story.chapter,
            story.cases_solved,
            plan_context=story_plan_context_for(item),
        )
    db.session.commit()
    return session


def _elapsed_ms(item: SessionItem, _client_elapsed_ms: int | None) -> int:
    server_ms = item.active_elapsed_ms or 0
    if item.timer_started_at:
        started = item.timer_started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        server_ms += max(0, int((utcnow() - started).total_seconds() * 1000))
    # The persisted server clock is authoritative. A browser timer keeps the UI
    # responsive, but it includes network waits (notably TrueFoundry hints) and
    # is user-controlled, so it must never inflate scored active time.
    return max(1000, min(server_ms, 15 * 60 * 1000))


def pause_study_session(session: StudySession) -> StudySession:
    if session.status == "paused":
        return session
    if session.status == "completed" and session.pending_attempt_id:
        # The final answer completes the scored session before its debrief is
        # acknowledged. "Save & exit" remains safe and idempotent in that gap.
        return session
    if session.status != "in_progress":
        raise ValueError("session_complete")
    item = SessionItem.query.filter_by(session_id=session.id, position=session.current_index).first()
    if item and item.timer_started_at:
        started = item.timer_started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        item.active_elapsed_ms = (item.active_elapsed_ms or 0) + max(0, int((utcnow() - started).total_seconds() * 1000))
        item.timer_started_at = None
        item.paused_at = utcnow()
    session.status = "paused"
    db.session.commit()
    return session


def resume_study_session(session: StudySession) -> StudySession:
    if session.status == "in_progress":
        return session
    if session.status != "paused":
        raise ValueError("session_complete")
    item = SessionItem.query.filter_by(session_id=session.id, position=session.current_index).first()
    if item and item.timer_activated_at and not session.pending_attempt_id:
        item.timer_started_at = utcnow()
        item.paused_at = None
    session.status = "in_progress"
    db.session.commit()
    return session


def start_item_timer(session: StudySession, item: SessionItem) -> SessionItem:
    if session.pending_attempt_id:
        raise ValueError("debrief_required")
    if session.status != "in_progress" or item.completed_at or item.position != session.current_index:
        raise ValueError("invalid_session_item")
    if not item.timer_activated_at:
        item.timer_activated_at = utcnow()
    if not item.timer_started_at:
        item.timer_started_at = utcnow()
    item.paused_at = None
    db.session.commit()
    return item


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
        "narrative_outcome": story.get("correct_outcome", "The evidence holds.") if is_correct else story.get("incorrect_outcome", "The false trail is now visible."),
        "transition": story.get("next_hook") or story.get("transition") or "Another sealed file is waiting.",
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


def submit_attempt(user: User, session: StudySession, payload: dict, idempotency_key: str) -> tuple[Attempt, bool]:
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
    if not item.timer_activated_at:
        raise ValueError("evidence_not_started")

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
        story_snapshot_json=item.story_json,
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

    story = story_progress_for(user)
    story.xp += xp
    beat = item.story_json or {}
    cast_ids = []
    for member in beat.get("cast", []):
        cast_id = member.get("id") if isinstance(member, dict) else member
        if isinstance(cast_id, str):
            cast_ids.append(cast_id)
    story_state = dict(story.state_json or {})
    story_state.update(
        {
            "active_chapter_title": beat.get("chapter_title") or beat.get("eyebrow") or "The Lantern Bureau",
            "last_case_title": beat.get("case_title") or beat.get("title") or "Evidence File",
            "last_location_id": beat.get("location_id") or "lantern_atrium",
            "last_hook": beat.get("next_hook") or beat.get("transition") or "The investigation continues.",
            "featured_cast": cast_ids,
            "last_outcome": "correct" if is_correct else "incorrect",
        }
    )
    story.state_json = story_state
    if session.mode == "daily":
        story.cases_solved += 1
        story.chapter = 1 + story.cases_solved // 8

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
        "xp_earned": attempt.xp_earned,
        "pace_scored": attempt.pace_scored,
        "elapsed_ms": attempt.server_elapsed_ms,
        "feedback": attempt.feedback_json,
        "story_snapshot": attempt.story_snapshot_json,
        "planned_story_beat": public_planned_story_beat(attempt.session_item),
        "coaching_status": attempt.coaching_status,
        "has_reasoning": bool(attempt.reasoning_text),
        "session_complete": session.status == "completed",
        "session_id": session.id,
    }


def run_attempt_coaching(attempt: Attempt) -> dict:
    existing_feedback = (attempt.feedback_json or {}).get("coaching")
    if attempt.coaching_status == "completed" and existing_feedback:
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

    # Provider latency is not student work. Stop the active clock while Rowan
    # prepares a hint, then restart it only if this item is still answerable.
    timer_was_active = bool(item.timer_started_at and item.session.status == "in_progress")
    if timer_was_active:
        started = item.timer_started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        item.active_elapsed_ms = (item.active_elapsed_ms or 0) + max(
            0, int((utcnow() - started).total_seconds() * 1000)
        )
        item.timer_started_at = None
        db.session.commit()

    try:
        hint, _metadata = generate_hint(item, level)
        db.session.refresh(item)
        if item.completed_at:
            raise ValueError("answer_already_filed")
        existing = HintEvent.query.filter_by(session_item_id=item.id, level=level).first()
        if existing:
            return existing.content_json
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
    finally:
        if timer_was_active:
            # The request can race a pause or answer from another tab. Refresh
            # both records and never resurrect a timer after either transition.
            db.session.rollback()
            current_item = db.session.get(SessionItem, item.id)
            if current_item:
                db.session.refresh(current_item)
                current_session = current_item.session
                db.session.refresh(current_session)
                if (
                    current_session.status == "in_progress"
                    and not current_session.pending_attempt_id
                    and current_item.position == current_session.current_index
                    and current_item.timer_activated_at
                    and not current_item.completed_at
                    and not current_item.timer_started_at
                ):
                    current_item.timer_started_at = utcnow()
                    current_item.paused_at = None
                    db.session.commit()


def enrich_item_story(user: User, item: SessionItem) -> dict:
    existing = item.story_json or {}
    if item.completed_at or item.story_generation_status == "frozen":
        return existing
    if existing.get("source") == "truefoundry":
        return existing
    if item.story_generation_status == "processing" and item.story_generation_started_at:
        started = item.story_generation_started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        if (utcnow() - started).total_seconds() < 150:
            return existing
    item.story_generation_status = "processing"
    item.story_generation_started_at = utcnow()
    db.session.commit()
    progress = story_progress_for(user)
    beat = generate_story_beat(
        item,
        progress.chapter,
        progress.cases_solved,
        dict(progress.state_json or {}),
        story_plan_context_for(item),
    )
    db.session.refresh(item)
    if item.completed_at:
        item.story_generation_status = "frozen"
        item.story_generation_started_at = None
        db.session.commit()
        return item.story_json or existing
    item.story_json = beat
    item.story_generation_status = "completed" if beat.get("source") == "truefoundry" else "fallback"
    item.story_generation_started_at = None
    item.story_model = current_app.config.get("COACHING_MODEL") if beat.get("source") == "truefoundry" else None
    db.session.commit()
    return beat


def story_dashboard(user: User) -> dict:
    progress = story_progress_for(user)
    recent_items = (
        SessionItem.query.join(StudySession)
        .filter(
            StudySession.user_id == user.id,
            SessionItem.completed_at.isnot(None),
            SessionItem.story_json.isnot(None),
        )
        .order_by(SessionItem.completed_at.desc())
        .limit(12)
        .all()
    )
    recent_cases = []
    for item in recent_items:
        beat = item.story_json or {}
        recent_cases.append(
            {
                "session_id": item.session_id,
                "mode": item.session.mode,
                "case_title": beat.get("case_title") or beat.get("title") or "Sealed evidence file",
                "chapter_title": beat.get("chapter_title") or beat.get("eyebrow") or "The Lantern Bureau",
                "location_id": beat.get("location_id") or "lantern_atrium",
                "source": beat.get("source", "fallback"),
                "completed_at": _iso_utc(item.completed_at),
                "correct": bool(item.attempt and item.attempt.is_correct),
            }
        )
    return {
        "chapter": progress.chapter,
        "xp": progress.xp,
        "cases_solved": progress.cases_solved,
        "state": progress.state_json or {},
        "cast": [{"id": cast_id, **profile} for cast_id, profile in CAST_REGISTRY.items()],
        "recent_cases": recent_cases,
    }


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
        "kind": "daily",
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
    summary["ghost"] = _ghost_for(session, accuracy, capm)
    return summary


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
