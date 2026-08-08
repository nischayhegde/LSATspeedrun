"""Verify the coaching pipeline end to end against a disposable account.

The canary answers one real case the way a player does — including the strategy
gate that case arms — then waits for the coaching job to come back through
whichever transport it was pointed at, and checks that the case settled exactly
once. Nothing here is allowed to take a shortcut through `app.enforcement`: a
canary that skipped the gate, or that ran with enforcement disabled, would stop
covering the path every real submission takes.
"""

from __future__ import annotations

import argparse
import json
import time
import uuid

import boto3
from botocore.config import Config
from sqlalchemy import delete, func, select

from app import create_app
from app.enforcement import LEVEL_FULL, STATUS_SATISFIED, GateRejection
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


# The approach the canary works the case with. Every question carries a strategy
# trial, and the prompt arm arms a blocking gate that refuses an answer until the
# approach's operations are on the record, so the canary has to do one of them
# for real. `prephrase` is the cheapest of the thirteen to do honestly: one
# written prediction, checked against this question's own text. It is also the
# only family with no dependence on how the stimulus happens to split into
# sentences or paragraphs, so it cannot degrade to "no gate" on some questions
# and quietly stop being tested. See `GATES` in app/enforcement.py.
CANARY_STRATEGY = "prephrase"


def _specific_reasoning(item: SessionItem) -> str:
    question = item.question
    correct_choice = next(choice for choice in question.choices if choice.label == question.correct_answer)
    source_text = question.stimulus or (question.passage.canonical_text if question.passage else "")
    return (
        f"The decisive issue in this specific question is: {question.stem} "
        f"The supplied text says {source_text[:600]} Therefore choice {question.correct_answer}, "
        f"which states {correct_choice.canonical_text}, best follows from that evidence."
    )


def _arm_canary_gate(item: SessionItem) -> None:
    """Put the canary's chosen approach on this case, in its blocking form.

    Which approach a question offers is a per-student bandit draw, so leaving it
    alone would make every deploy test one of thirteen gates at random. Pinning
    it is a decision about *which* approach is offered, which is the same thing
    `assign_strategy_trial` does; it is not a decision about whether the gate is
    enforced. The gate below still blocks, still runs every check, and is still
    the copy that decides, because there is no way to ask it not to be.
    """
    item.strategy_key = CANARY_STRATEGY
    item.strategy_variant = "prompt"
    item.strategy_enforcement_level = LEVEL_FULL
    # The propensity of landing in the arm this item now carries. Recorded for
    # the same reason a real assignment records it, even though this account is
    # deleted before any analysis could read it.
    item.strategy_propensity = 0.75
    db.session.commit()


def _prediction(item: SessionItem) -> str:
    """What the credited answer has to do, said in this question's own terms.

    This is the artifact the gate asks for, and it has to survive the same
    checks a player's prediction does: six words, thirty characters, more than
    one distinct idea, and neither the stem nor the stimulus read back. It is
    built from the credited choice rather than from a fixed sentence so that it
    is a claim about this question and could not be reused on another one.
    """
    question = item.question
    credited = next(choice for choice in question.choices if choice.label == question.correct_answer)
    claim = " ".join(credited.canonical_text.split())[:280].rstrip(" .,;:")
    return (
        f"It has to establish that {claim}, and a choice that leaves that unsettled "
        "does not finish the task this stem sets."
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


def run_smoke_test(
    timeout_seconds: int,
    lambda_function: str | None = None,
    transport: str = "sqs",
) -> dict:
    app = create_app({"AUTO_SEED": False, "DEV_AUTH_ENABLED": False})
    smoke_token = uuid.uuid4().hex
    smoke_email = f"deploy-smoke+{smoke_token}@example.invalid"
    smoke_user_id: str | None = None
    summary: dict = {}

    with app.app_context():
        try:
            if app.config.get("AI_JOBS_MODE") != transport or not queue_ready():
                raise RuntimeError(f"The {transport} coaching worker is not configured.")
            # A canary that ran with the gates switched off would pass without
            # covering what every real submission goes through.
            if not app.config.get("STRATEGY_ENFORCEMENT_ENABLED"):
                raise RuntimeError("Strategy enforcement is disabled, so this run would not test it.")

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

            _arm_canary_gate(item)
            gate = (serialize_session(session).get("current_item") or {}).get("strategy_gate") or {}
            if gate.get("strategy_key") != CANARY_STRATEGY or not gate.get("blocking"):
                raise RuntimeError("The smoke-test case did not serve the blocking strategy gate.")

            payload = {
                "item_id": item.id,
                "selected_label": item.question.correct_answer,
                "reasoning": _specific_reasoning(item),
                # Choosing the approach is what arms the gate. The interface's
                # other option is to decline it, which needs no artifact and is
                # recorded as a non-application, but declining would leave
                # enforcement untested. The canary does the work instead.
                "strategy_applied": True,
                "strategy_prompt_ms": 4000,
                "strategy_gate_ms": 6000,
            }
            # The gate has to actually refuse an unfinished approach, or the
            # artifact below proves nothing. This costs one rejected submission
            # and leaves no attempt behind.
            try:
                submit_attempt(user, session, payload, f"deploy-smoke-gate-{smoke_token}")
            except GateRejection:
                db.session.rollback()
            else:
                raise RuntimeError("The strategy gate accepted an answer with no artifact.")
            if Attempt.query.filter_by(user_id=smoke_user_id).count():
                raise RuntimeError("A refused strategy gate left an attempt behind.")

            payload["strategy_artifact"] = {"fields": {"prediction": _prediction(item)}}
            try:
                attempt, _duplicate = submit_attempt(
                    user,
                    session,
                    payload,
                    f"deploy-smoke-{smoke_token}",
                )
            except GateRejection as rejection:
                messages = "; ".join(entry["message"] for entry in rejection.errors)
                raise RuntimeError(
                    f"The canary's own {CANARY_STRATEGY} artifact did not satisfy the gate: {messages}"
                ) from rejection
            if attempt.strategy_gate_status != STATUS_SATISFIED:
                raise RuntimeError("The smoke-test answer did not clear the strategy gate.")
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
                "transport": "direct-lambda" if lambda_function else transport,
                "strategy_key": attempt.strategy_key,
                "strategy_gate_status": attempt.strategy_gate_status,
                "gate_refused_empty_artifact": True,
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
        description="Verify the strategy gate -> queue -> TrueFoundry -> settlement path.",
    )
    parser.add_argument("--timeout-seconds", type=int, default=180)
    parser.add_argument(
        "--lambda-function",
        help="Invoke this Lambda directly instead of allowing SQS to deliver the smoke job.",
    )
    parser.add_argument(
        "--transport",
        choices=("sqs", "local"),
        default="sqs",
        help=(
            "Which worker drains the job. 'local' runs the same job pipeline on a background "
            "thread in this process, which verifies everything except the SQS and Lambda hop "
            "and needs no AWS access."
        ),
    )
    args = parser.parse_args()
    if args.timeout_seconds < 30 or args.timeout_seconds > 300:
        parser.error("--timeout-seconds must be between 30 and 300")
    if args.lambda_function and args.transport != "sqs":
        parser.error("--lambda-function replaces the SQS hop, so it cannot be used with --transport local")
    print(
        json.dumps(
            run_smoke_test(
                args.timeout_seconds,
                lambda_function=args.lambda_function,
                transport=args.transport,
            ),
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
