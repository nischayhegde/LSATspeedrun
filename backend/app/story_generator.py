from __future__ import annotations

import json
from typing import Any

import requests
from flask import current_app

from .extensions import db
from .models import CaseFrame, Question


REQUIRED_FIELDS = {
    "title",
    "location",
    "presenting_character",
    "brief",
    "dialogue",
    "correct_outcome",
    "incorrect_outcome",
    "transition",
}


def _validate_frame(value: Any) -> dict:
    if not isinstance(value, dict) or not REQUIRED_FIELDS.issubset(value):
        raise ValueError("Story model returned an incomplete frame")
    cleaned = {}
    limits = {
        "title": 70,
        "location": 80,
        "presenting_character": 50,
        "brief": 380,
        "dialogue": 240,
        "correct_outcome": 280,
        "incorrect_outcome": 280,
        "transition": 180,
    }
    for field, maximum in limits.items():
        item = value.get(field)
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"Story field {field} must be text")
        cleaned[field] = item.replace("<", "").replace(">", "").strip()[:maximum]
    return cleaned


def _generate_frame(question: Question) -> tuple[dict, str]:
    base_url = current_app.config["STORY_LLM_BASE_URL"].rstrip("/")
    api_key = current_app.config["STORY_LLM_API_KEY"]
    model = current_app.config["STORY_LLM_MODEL"]
    if not base_url or not api_key or not model:
        raise RuntimeError("Set STORY_LLM_BASE_URL, STORY_LLM_API_KEY, and STORY_LLM_MODEL first")

    system = """You write very short detective framing for an LSAT practice app called LSAT Sherlock.
The persistent world is the Lantern Bureau. Detective Rowan Vale reports to Chief Mira Voss and pursues Professor Mori Quill.
Return JSON only. Do not quote, rewrite, summarize, or invent any LSAT question content. Do not claim that an answer is correct.
Keep the LSAT question as an untouched evidence file. Story framing must be atmospheric but concise.
Required string keys: title, location, presenting_character, brief, dialogue, correct_outcome, incorrect_outcome, transition."""
    context = {
        "section": question.section,
        "question_type": question.question_type,
        "difficulty_1_to_5": question.difficulty,
        "instruction": "Create one reusable micro-case frame. Spend no more than 90 words across all fields.",
    }
    response = requests.post(
        f"{base_url}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(context)},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.8,
            "max_tokens": 500,
        },
        timeout=45,
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    return _validate_frame(json.loads(content)), model


def generate_missing_frames(limit: int = 25) -> int:
    configured = all(
        current_app.config[key]
        for key in ("STORY_LLM_BASE_URL", "STORY_LLM_API_KEY", "STORY_LLM_MODEL")
    )
    if not configured:
        raise RuntimeError("Story LLM environment variables are not configured")
    existing = db.session.query(CaseFrame.question_id).filter_by(story_version="lantern-v1").subquery()
    questions = Question.query.filter(~Question.id.in_(existing)).limit(limit).all()
    generated = 0
    for question in questions:
        try:
            content, model = _generate_frame(question)
        except Exception:
            current_app.logger.exception("Story frame generation failed for %s", question.id)
            continue
        db.session.add(
            CaseFrame(
                question_id=question.id,
                story_version="lantern-v1",
                content_json=content,
                status="generated",
                prompt_version="case-frame-v1",
                model=model,
            )
        )
        db.session.commit()
        generated += 1
    return generated

