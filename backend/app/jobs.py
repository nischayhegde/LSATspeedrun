from __future__ import annotations

import json
from datetime import timezone

from flask import current_app
from sqlalchemy.exc import IntegrityError

from .extensions import db
from .models import AiJob, Attempt, HintEvent, SessionItem, User, utcnow


class JobQueueError(RuntimeError):
    pass


def async_jobs_enabled() -> bool:
    return current_app.config.get("AI_JOBS_MODE") == "sqs"


def queue_ready() -> bool:
    return bool(async_jobs_enabled() and current_app.config.get("AI_JOB_QUEUE_URL"))


def serialize_job(job: AiJob) -> dict:
    payload = {
        "id": job.id,
        "kind": job.kind,
        "status": job.status,
        "attempt_count": job.attempt_count,
    }
    if job.status == "completed":
        payload["result"] = job.result_json
    elif job.status == "failed":
        payload["error"] = job.error_message or "AI generation failed. Please retry."
    return payload


def _sqs_client():
    import boto3

    return boto3.client("sqs")


def _send_job_message(job: AiJob) -> None:
    queue_url = current_app.config.get("AI_JOB_QUEUE_URL")
    if not queue_url:
        raise JobQueueError("The AI job queue is not configured.")
    try:
        response = _sqs_client().send_message(
            QueueUrl=queue_url,
            MessageBody=json.dumps({"job_id": job.id}, separators=(",", ":")),
        )
    except Exception as exc:  # boto3 exception types are intentionally lazy-loaded
        raise JobQueueError("The AI job could not be queued.") from exc
    job.queue_message_id = response.get("MessageId")
    db.session.commit()


def _enqueue(
    user_id: str,
    kind: str,
    resource_id: str,
    dedup_key: str,
    payload: dict | None = None,
    restart_completed: bool = False,
) -> AiJob:
    job = AiJob.query.filter_by(dedup_key=dedup_key).first()
    reusable_statuses = {"queued", "processing"} | ({"completed"} if not restart_completed else set())
    if job and job.status in reusable_statuses:
        if job.status == "queued" and not job.queue_message_id:
            _send_job_message(job)
        return job
    if job:
        job.status = "queued"
        job.result_json = None
        job.error_message = None
        job.attempt_count = 0
        job.queue_message_id = None
        job.started_at = None
        job.completed_at = None
        job.payload_json = payload or {}
    else:
        job = AiJob(
            user_id=user_id,
            kind=kind,
            resource_id=resource_id,
            dedup_key=dedup_key,
            payload_json=payload or {},
        )
        db.session.add(job)
    try:
        db.session.commit()
    except IntegrityError:
        # A second request can race the first one. The unique dedup key makes
        # that harmless and both callers observe the same durable job.
        db.session.rollback()
        job = AiJob.query.filter_by(dedup_key=dedup_key).one()
    if job.status == "queued" and not job.queue_message_id:
        try:
            _send_job_message(job)
        except JobQueueError:
            job.status = "failed"
            job.error_message = "The AI job could not be queued. Please retry."
            db.session.commit()
            raise
    return job


def enqueue_coaching_job(attempt: Attempt) -> AiJob:
    return _enqueue(attempt.user_id, "coaching", attempt.id, f"coaching:{attempt.id}")


def enqueue_story_job(user: User, item: SessionItem) -> AiJob:
    return _enqueue(user.id, "story", item.id, f"story:{item.id}")


def enqueue_hint_job(user: User, item: SessionItem) -> AiJob:
    from .services import pause_item_timer_for_ai, resume_item_timer_after_ai

    saved_count = HintEvent.query.filter_by(session_item_id=item.id).count()
    if saved_count >= 3:
        raise ValueError("hint_limit_reached")
    level = saved_count + 1
    dedup_key = f"hint:{item.id}:{level}"
    existing = AiJob.query.filter_by(dedup_key=dedup_key).first()
    if existing and existing.status in {"queued", "processing", "completed"}:
        return _enqueue(user.id, "hint", item.id, dedup_key, existing.payload_json)

    timer_was_active = pause_item_timer_for_ai(item)
    try:
        return _enqueue(
            user.id,
            "hint",
            item.id,
            dedup_key,
            {"level": level, "resume_timer": timer_was_active},
        )
    except Exception:
        if timer_was_active:
            resume_item_timer_after_ai(item.id)
        raise


def enqueue_session_plan_job(user: User, mode: str) -> AiJob:
    return _enqueue(
        user.id,
        "session_plan",
        user.id,
        f"session-plan:{user.id}:{mode}",
        {"mode": mode},
        restart_completed=True,
    )


def _lease_is_current(job: AiJob, seconds: int = 255) -> bool:
    if job.status != "processing" or not job.started_at:
        return False
    started = job.started_at
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    return (utcnow() - started).total_seconds() < seconds


def process_ai_job(job_id: str) -> AiJob | None:
    """Claim and execute one idempotent job. Called by the Lambda handler."""

    job = db.session.get(AiJob, job_id, with_for_update=True)
    if not job:
        current_app.logger.warning("Ignoring missing AI job %s", job_id)
        db.session.rollback()
        return None
    max_attempts = int(current_app.config.get("AI_JOB_MAX_ATTEMPTS", 3))
    if job.status == "completed" or (job.status == "failed" and job.attempt_count >= max_attempts):
        db.session.rollback()
        return job
    if _lease_is_current(job):
        db.session.rollback()
        return job

    job.status = "processing"
    job.started_at = utcnow()
    job.completed_at = None
    job.error_message = None
    job.attempt_count = (job.attempt_count or 0) + 1
    db.session.commit()
    payload = dict(job.payload_json or {})

    try:
        if job.kind == "coaching":
            from .services import run_attempt_coaching

            attempt = db.session.get(Attempt, job.resource_id)
            if not attempt or attempt.user_id != job.user_id:
                raise ValueError("attempt_not_found")
            result = run_attempt_coaching(attempt)
        elif job.kind == "hint":
            from .services import request_item_hint

            item = db.session.get(SessionItem, job.resource_id)
            user = db.session.get(User, job.user_id)
            if not item or not user:
                raise ValueError("hint_resource_not_found")
            result = request_item_hint(
                user,
                item,
                expected_level=int(payload["level"]),
                manage_timer=False,
            )
        elif job.kind == "story":
            from .services import enrich_item_story, public_item_story

            item = db.session.get(SessionItem, job.resource_id)
            user = db.session.get(User, job.user_id)
            if not item or not user:
                raise ValueError("story_resource_not_found")
            beat = enrich_item_story(user, item)
            result = public_item_story(item, beat)
        elif job.kind == "session_plan":
            from .services import create_study_session, serialize_session

            user = db.session.get(User, job.user_id)
            if not user:
                raise ValueError("session_user_not_found")
            mode = str(payload["mode"])
            result = serialize_session(create_study_session(user, mode))
        else:
            raise ValueError("unsupported_job_kind")
    except Exception as exc:
        db.session.rollback()
        failed_job = db.session.get(AiJob, job_id, with_for_update=True)
        if not failed_job:
            raise
        permanent = isinstance(exc, (KeyError, TypeError, ValueError))
        final_failure = permanent or failed_job.attempt_count >= max_attempts
        if permanent:
            failed_job.attempt_count = max_attempts
        failed_job.status = "failed" if final_failure else "queued"
        failed_job.error_message = "AI generation failed. Please retry." if final_failure else None
        failed_job.started_at = None
        db.session.commit()
        if final_failure and failed_job.kind == "hint" and payload.get("resume_timer"):
            from .services import resume_item_timer_after_ai

            resume_item_timer_after_ai(failed_job.resource_id)
        raise

    completed_job = db.session.get(AiJob, job_id, with_for_update=True)
    completed_job.status = "completed"
    completed_job.result_json = result
    completed_job.error_message = None
    completed_job.started_at = None
    completed_job.completed_at = utcnow()
    db.session.commit()
    if completed_job.kind == "hint" and payload.get("resume_timer"):
        from .services import resume_item_timer_after_ai

        resume_item_timer_after_ai(completed_job.resource_id)
    return completed_job
