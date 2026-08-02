from __future__ import annotations

import argparse
import json
import time
import uuid

import boto3
from botocore.config import Config
from sqlalchemy import delete, func, select

from app import create_app
from app.extensions import db
from app.game import create_profile
from app.jobs import enqueue_coaching_job, queue_ready
from app.models import (
    AiJob,
    Attempt,
    AttemptSettlement,
    LedgerEntry,
    PlayerProfile,
    SessionItem,
    User,
)
from app.services import create_study_session, serialize_session, submit_attempt


def _specific_reasoning(item: SessionItem) -> str:
    question = item.question
    correct_choice = next(choice for choice in question.choices if choice.label == question.correct_answer)
    source_text = question.stimulus or (question.passage.canonical_text if question.passage else "")
    return (
        f"The decisive issue in this specific question is: {question.stem} "
        f"The supplied text says {source_text[:600]} Therefore choice {question.correct_answer}, "
        f"which states {correct_choice.canonical_text}, best follows from that evidence."
    )


def _invoke_lambda(function_name: str, job_id: str) -> None:
    payload = {
        "Records": [
            {
                "messageId": f"deployment-direct-{uuid.uuid4().hex}",
                "body": json.dumps({"job_id": job_id}, separators=(",", ":")),
            }
        ]
    }
    response = boto3.client(
        "lambda",
        config=Config(connect_timeout=10, read_timeout=300, retries={"max_attempts": 2}),
    ).invoke(
        FunctionName=function_name,
        InvocationType="RequestResponse",
        Payload=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
    )
    response_payload = json.loads(response["Payload"].read())
    if response.get("StatusCode") != 200 or response.get("FunctionError"):
        raise RuntimeError("The direct Lambda coaching invocation failed.")
    if response_payload.get("batchItemFailures"):
        raise RuntimeError("The direct Lambda coaching invocation rejected its job.")


def run_smoke_test(timeout_seconds: int, lambda_function: str | None = None) -> dict:
    app = create_app({"AUTO_SEED": False, "DEV_AUTH_ENABLED": False})
    smoke_token = uuid.uuid4().hex
    smoke_email = f"deploy-smoke+{smoke_token}@example.invalid"
    smoke_user_id: str | None = None
    summary: dict = {}

    with app.app_context():
        try:
            if app.config.get("AI_JOBS_MODE") != "sqs" or not queue_ready():
                raise RuntimeError("The SQS coaching worker is not configured.")

            user = User(
                email=smoke_email,
                display_name="Deployment Smoke Test",
                onboarding_complete=True,
            )
            db.session.add(user)
            db.session.flush()
            smoke_user_id = user.id
            profile = create_profile(
                user,
                {
                    "lawyer_name": "Alex Smoke",
                    "firm_name": "Lambda Verification LLP",
                    "character_gender": "female",
                },
            )
            starting_cash = profile.cash
            session = create_study_session(user)
            serialized = serialize_session(session)
            item = db.session.get(SessionItem, serialized["current_item"]["id"])
            if not item:
                raise RuntimeError("The smoke-test case was not created.")

            payload = {
                "item_id": item.id,
                "selected_label": item.question.correct_answer,
                "reasoning": _specific_reasoning(item),
            }
            # Every case question now carries a strategy trial, and a prompted
            # trial refuses an answer without an explicit use/skip decision.
            if item.strategy_key and item.strategy_variant == "prompt":
                payload["strategy_applied"] = True
                payload["strategy_prompt_ms"] = 4000
            attempt, _duplicate = submit_attempt(
                user,
                session,
                payload,
                f"deploy-smoke-{smoke_token}",
            )
            attempt_id = attempt.id
            expected_choice_count = len(item.question.choices)
            if lambda_function:
                job = AiJob(
                    user_id=attempt.user_id,
                    kind="coaching",
                    resource_id=attempt.id,
                    dedup_key=f"coaching:{attempt.id}",
                    payload_json={},
                )
                db.session.add(job)
                db.session.commit()
                _invoke_lambda(lambda_function, job.id)
            else:
                job = enqueue_coaching_job(attempt)
            job_id = job.id

            deadline = time.monotonic() + timeout_seconds
            while time.monotonic() < deadline:
                db.session.expire_all()
                job = db.session.get(AiJob, job_id, populate_existing=True)
                if not job:
                    raise RuntimeError("The smoke-test AI job disappeared before completion.")
                if job.status == "completed":
                    break
                if job.status == "failed":
                    raise RuntimeError(job.error_message or "The smoke-test AI job failed.")
                time.sleep(2)
            else:
                raise TimeoutError(f"The smoke-test AI job did not complete within {timeout_seconds} seconds.")

            result = job.result_json or {}
            choice_explanations = (result.get("answer_analysis") or {}).get("choice_explanations") or []
            if result.get("provider") != "TrueFoundry":
                raise RuntimeError("The coaching result did not come from TrueFoundry.")
            if not result.get("model"):
                raise RuntimeError("The coaching result did not identify its model.")
            if len(choice_explanations) != expected_choice_count:
                raise RuntimeError("The coaching result did not explain every answer choice.")

            db.session.expire_all()
            attempt = db.session.get(Attempt, attempt_id, populate_existing=True)
            profile = db.session.get(PlayerProfile, profile.id, populate_existing=True)
            settlement = AttemptSettlement.query.filter_by(attempt_id=attempt_id).one_or_none()
            if not attempt or attempt.coaching_status != "completed" or not settlement or not profile:
                raise RuntimeError("The coaching result did not settle the Tycoon case.")

            settlement_count = db.session.scalar(
                select(func.count(AttemptSettlement.id)).where(AttemptSettlement.attempt_id == attempt_id)
            )
            payout_count = db.session.scalar(
                select(func.count(LedgerEntry.id)).where(
                    LedgerEntry.user_id == smoke_user_id,
                    LedgerEntry.kind == "case_payout",
                )
            )
            if settlement_count != 1 or payout_count != 1:
                raise RuntimeError("The smoke-test case did not produce exactly one payout.")
            if profile.cash != starting_cash + settlement.payout:
                raise RuntimeError("The smoke-test cash balance does not match its settlement.")
            settled_cash = profile.cash

            if lambda_function:
                _invoke_lambda(lambda_function, job_id)
            repeated_job = enqueue_coaching_job(attempt)
            db.session.expire_all()
            refreshed_profile = db.session.get(PlayerProfile, profile.id, populate_existing=True)
            repeated_settlements = db.session.scalar(
                select(func.count(AttemptSettlement.id)).where(AttemptSettlement.attempt_id == attempt_id)
            )
            repeated_payouts = db.session.scalar(
                select(func.count(LedgerEntry.id)).where(
                    LedgerEntry.user_id == smoke_user_id,
                    LedgerEntry.kind == "case_payout",
                )
            )
            if (
                repeated_job.id != job_id
                or repeated_job.status != "completed"
                or repeated_settlements != 1
                or repeated_payouts != 1
                or not refreshed_profile
                or refreshed_profile.cash != settled_cash
            ):
                raise RuntimeError("A repeated coaching request was not idempotent.")

            summary = {
                "status": "ok",
                "provider": result["provider"],
                "model": result["model"],
                "reasoning_effort": result.get("reasoning_effort"),
                "choice_explanations": len(choice_explanations),
                "score": settlement.total_score,
                "payout": settlement.payout,
                "exactly_once": True,
                "transport": "direct-lambda" if lambda_function else "sqs",
            }
        finally:
            db.session.rollback()
            if smoke_user_id:
                db.session.execute(delete(User).where(User.id == smoke_user_id))
                db.session.commit()
                remaining = db.session.scalar(
                    select(func.count(User.id)).where(User.id == smoke_user_id)
                )
                if remaining:
                    raise RuntimeError("The disposable smoke-test account could not be removed.")
                summary["cleanup"] = True

    return summary


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Verify the production SQS -> Lambda -> TrueFoundry -> settlement path.",
    )
    parser.add_argument("--timeout-seconds", type=int, default=180)
    parser.add_argument(
        "--lambda-function",
        help="Invoke this Lambda directly instead of allowing SQS to deliver the smoke job.",
    )
    args = parser.parse_args()
    if args.timeout_seconds < 30 or args.timeout_seconds > 300:
        parser.error("--timeout-seconds must be between 30 and 300")
    print(
        json.dumps(
            run_smoke_test(args.timeout_seconds, lambda_function=args.lambda_function),
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
