from __future__ import annotations

import json
import threading
from datetime import timezone

from flask import current_app
from sqlalchemy.exc import IntegrityError

from .extensions import db
from .models import AiJob, Attempt, utcnow


class JobQueueError(RuntimeError):
    pass


class JobLeaseActive(JobQueueError):
    """Tell the SQS handler to retain a duplicate delivery until the lease resolves."""


# "sqs" hands each job to a durable queue drained by the Lambda worker. "local"
# runs the same `process_ai_job` on a daemon thread inside this process — no
# broker, no extra deployment unit, and the same AiJob row driving status and
# retries, which is what keeps a 20-30 second grading call off the player's
# critical path in a single-process deployment. "sync" is the legacy in-request
# path, kept because it makes request-level tracing trivial.
ASYNC_MODES = {"sqs", "local"}


def _mode() -> str:
    return current_app.config.get("AI_JOBS_MODE") or "sync"


def async_jobs_enabled() -> bool:
    return _mode() in ASYNC_MODES


def local_worker_enabled() -> bool:
    return _mode() == "local"


def queue_ready() -> bool:
    if local_worker_enabled():
        return True
    return bool(_mode() == "sqs" and current_app.config.get("AI_JOB_QUEUE_URL"))


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


def _run_local_job(app, job_id: str) -> None:
    """Drain one job to a terminal state on this thread.

    There is no broker here, so a retryable failure (which `process_ai_job` puts
    back in `queued`) has nothing to redeliver it — this thread makes the next
    attempt itself. `attempt_count` still bounds the total, so a provider outage
    ends in a terminal `failed` rather than a loop.
    """
    with app.app_context():
        try:
            for _ in range(max(1, int(app.config.get("AI_JOB_MAX_ATTEMPTS", 3)))):
                try:
                    job = process_ai_job(job_id)
                except JobLeaseActive:
                    return
                except Exception:
                    # process_ai_job has already recorded the outcome, including
                    # settling the case from the verified answer key when the
                    # failure is terminal. Nothing awaits this thread's return.
                    app.logger.exception("Local AI job %s failed", job_id)
                    job = db.session.get(AiJob, job_id, populate_existing=True)
                if not job or job.status != "queued":
                    return
        finally:
            db.session.remove()


def _start_local_job(job: AiJob) -> None:
    """Hand the job to a daemon thread in this process.

    Daemon on purpose: a shutdown mid-grade should not hold the process open. The
    job's `processing` lease then expires (see `_lease_is_current`) and the next
    request for that attempt reclaims it, so nothing is permanently stuck.
    """
    # Stands in for the SQS message id, so the "already handed off" checks in
    # `_enqueue` work identically and a polling client cannot spawn a thread per
    # poll. Committed before the thread starts so the worker reads a settled row.
    job.queue_message_id = f"local:{job.id}"
    db.session.commit()
    thread = threading.Thread(
        target=_run_local_job,
        args=(current_app._get_current_object(), job.id),
        name=f"ai-job-{job.id[:8]}",
        daemon=True,
    )
    thread.start()


def _dispatch(job: AiJob) -> None:
    if local_worker_enabled():
        _start_local_job(job)
        return
    _send_job_message(job)


def _send_or_fail(job: AiJob) -> None:
    try:
        _dispatch(job)
    except JobQueueError:
        job.status = "failed"
        job.error_message = "The AI coaching request could not be queued. Please retry."
        job.started_at = None
        db.session.commit()
        raise


def _enqueue(attempt: Attempt) -> AiJob:
    dedup_key = f"coaching:{attempt.id}"
    job = (
        AiJob.query.populate_existing()
        .filter_by(dedup_key=dedup_key)
        .with_for_update()
        .first()
    )
    if job and job.status == "completed":
        db.session.rollback()
        return job
    if job and job.status == "processing" and _lease_is_current(job):
        db.session.rollback()
        return job
    if job and job.status == "queued":
        should_send = not job.queue_message_id
        db.session.commit()
        if should_send:
            _send_or_fail(job)
        return job
    if job:
        # A stale processing lease has no trustworthy SQS delivery left. A
        # user retry explicitly reclaims it and emits a fresh durable message.
        reset_attempts = job.status == "failed"
        job.status = "queued"
        job.result_json = None
        job.error_message = None
        if reset_attempts:
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
        return _enqueue(attempt)
    if job.status == "queued" and not job.queue_message_id:
        _send_or_fail(job)
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

    job = db.session.get(AiJob, job_id, with_for_update=True, populate_existing=True)
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
        # Returning normally makes Lambda acknowledge and delete the SQS
        # message. Raising instead uses partial-batch failure so a crashed
        # worker's only delivery cannot disappear while its lease is current.
        raise JobLeaseActive("The AI job is already covered by a current processing lease.")
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
        failed_job = db.session.get(
            AiJob,
            job_id,
            with_for_update=True,
            populate_existing=True,
        )
        if not failed_job:
            raise
        final_failure = isinstance(exc, (KeyError, TypeError, ValueError)) or failed_job.attempt_count >= max_attempts
        failed_job.status = "failed" if final_failure else "queued"
        failed_job.error_message = "AI coaching failed. Please retry." if final_failure else None
        failed_job.started_at = None
        resource_id = failed_job.resource_id
        db.session.commit()
        if final_failure:
            # Grading is out of retries, and the player has very likely already
            # moved on to the next case. The answer key is verified independently
            # of the coach, so the case is settled from it rather than left
            # unpaid and unsettled forever.
            from .services import settle_uncoached_attempt

            settle_uncoached_attempt(resource_id)
        raise

    completed_job = db.session.get(
        AiJob,
        job_id,
        with_for_update=True,
        populate_existing=True,
    )
    completed_job.status = "completed"
    completed_job.result_json = result
    completed_job.error_message = None
    completed_job.started_at = None
    completed_job.completed_at = utcnow()
    db.session.commit()
    return completed_job
