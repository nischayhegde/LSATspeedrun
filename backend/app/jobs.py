from __future__ import annotations

import json
from datetime import timezone

from flask import current_app
from sqlalchemy.exc import IntegrityError

from .extensions import db
from .models import AiJob, Attempt, utcnow


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
        payload["error"] = job.error_message or "AI coaching failed. Please retry."
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
    except Exception as exc:  # boto3 exceptions are lazy-loaded
        raise JobQueueError("The AI coaching request could not be queued.") from exc
    job.queue_message_id = response.get("MessageId")
    db.session.commit()


def _enqueue(attempt: Attempt) -> AiJob:
    dedup_key = f"coaching:{attempt.id}"
    job = AiJob.query.filter_by(dedup_key=dedup_key).first()
    if job and job.status in {"queued", "processing", "completed"}:
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
    else:
        job = AiJob(
            user_id=attempt.user_id,
            kind="coaching",
            resource_id=attempt.id,
            dedup_key=dedup_key,
            payload_json={},
        )
        db.session.add(job)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        job = AiJob.query.filter_by(dedup_key=dedup_key).one()
    if job.status == "queued" and not job.queue_message_id:
        try:
            _send_job_message(job)
        except JobQueueError:
            job.status = "failed"
            job.error_message = "The AI coaching request could not be queued. Please retry."
            db.session.commit()
            raise
    return job


def enqueue_coaching_job(attempt: Attempt) -> AiJob:
    return _enqueue(attempt)


def _lease_is_current(job: AiJob, seconds: int = 255) -> bool:
    if job.status != "processing" or not job.started_at:
        return False
    started = job.started_at
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    return (utcnow() - started).total_seconds() < seconds


def process_ai_job(job_id: str) -> AiJob | None:
    """Claim and execute one durable coaching job."""

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
    if job.kind != "coaching":
        job.status = "failed"
        job.error_message = "This legacy AI job type is no longer supported."
        job.completed_at = utcnow()
        db.session.commit()
        return job

    job.status = "processing"
    job.started_at = utcnow()
    job.completed_at = None
    job.error_message = None
    job.attempt_count = (job.attempt_count or 0) + 1
    db.session.commit()

    try:
        from .services import run_attempt_coaching

        attempt = db.session.get(Attempt, job.resource_id)
        if not attempt or attempt.user_id != job.user_id:
            raise ValueError("attempt_not_found")
        result = run_attempt_coaching(attempt)
    except Exception as exc:
        db.session.rollback()
        failed_job = db.session.get(AiJob, job_id, with_for_update=True)
        if not failed_job:
            raise
        final_failure = isinstance(exc, (KeyError, TypeError, ValueError)) or failed_job.attempt_count >= max_attempts
        failed_job.status = "failed" if final_failure else "queued"
        failed_job.error_message = "AI coaching failed. Please retry." if final_failure else None
        failed_job.started_at = None
        db.session.commit()
        raise

    completed_job = db.session.get(AiJob, job_id, with_for_update=True)
    completed_job.status = "completed"
    completed_job.result_json = result
    completed_job.error_message = None
    completed_job.started_at = None
    completed_job.completed_at = utcnow()
    db.session.commit()
    return completed_job
