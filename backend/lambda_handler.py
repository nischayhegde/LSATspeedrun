from __future__ import annotations

import json

from app import create_app
from app.jobs import process_ai_job


app = create_app({"AUTO_SEED": False, "DEV_AUTH_ENABLED": False})


def handler(event, _context):
    """SQS partial-batch handler; the event source is configured for one job."""

    failures = []
    for record in event.get("Records", []):
        message_id = record.get("messageId", "unknown")
        try:
            body = json.loads(record.get("body") or "{}")
            job_id = body["job_id"]
            with app.app_context():
                process_ai_job(job_id)
        except Exception:
            app.logger.exception("AI job message %s failed", message_id)
            failures.append({"itemIdentifier": message_id})
    return {"batchItemFailures": failures}
