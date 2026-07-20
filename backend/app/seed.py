from __future__ import annotations

import json
from pathlib import Path

from flask import current_app

from .extensions import db
from .models import Passage, Question, QuestionChoice


MODERN_SECTIONS = {"Logical Reasoning", "Reading Comprehension"}


def seed_questions(force: bool = False) -> int:
    if Question.query.count() and not force:
        return 0

    source_path = Path(current_app.config["REPO_ROOT"]) / "Qbankparsing" / "lsat_questions.json"
    if not source_path.exists():
        current_app.logger.warning("Question bank not found at %s", source_path)
        return 0

    data = json.loads(source_path.read_text(encoding="utf-8"))
    passage_ids = {
        question.get("passage_id")
        for question in data.get("questions", [])
        if question.get("section") in MODERN_SECTIONS and question.get("passage_id")
    }
    for record in data.get("passages", []):
        if record["id"] not in passage_ids:
            continue
        db.session.merge(
            Passage(
                id=record["id"],
                canonical_text=record["text"],
                passage_type=record.get("passage_type"),
                source=record.get("source_pdf"),
                review_status=record.get("review_status", "machine_parsed_needs_review"),
            )
        )

    count = 0
    for record in data.get("questions", []):
        if record.get("section") not in MODERN_SECTIONS:
            continue
        question = Question(
            id=record["id"],
            passage_id=record.get("passage_id"),
            section=record["section"],
            question_type=record.get("question_type") or "General Reasoning",
            difficulty=max(1, min(5, int(record.get("difficulty") or 3))),
            stimulus=record.get("stimulus"),
            stem=record["stem"],
            correct_answer=record["correct_answer"],
            source=f"{record.get('test_name', '')} · {record.get('source_pdf', '')}",
            content_hash=record.get("content_hash"),
            license_status=record.get("license_status", "unknown_needs_verification"),
            review_status=record.get("review_status", "machine_parsed_needs_review"),
        )
        db.session.merge(question)
        for position, choice in enumerate(record["choices"]):
            db.session.merge(
                QuestionChoice(
                    id=f"{record['id']}-{choice['label']}",
                    question_id=record["id"],
                    label=choice["label"],
                    canonical_text=choice["text"],
                    position=position,
                )
            )
        count += 1
    db.session.commit()
    current_app.logger.info("Seeded %s modern LSAT questions for local development", count)
    return count

