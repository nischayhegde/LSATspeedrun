from __future__ import annotations

import hashlib
import re
import time
from collections.abc import Iterator

import requests
from flask import current_app

from .extensions import db
from .models import Passage, Question, QuestionChoice


DATASET_SERVER_ROWS_URL = "https://datasets-server.huggingface.co/rows"
SPLITS = ("train", "validation", "test")
DATASETS = {
    "tasksource/lsat-lr": "Logical Reasoning",
    "tasksource/lsat-rc": "Reading Comprehension",
}
SOURCE_PREFIX = "https://huggingface.co/datasets/tasksource/lsat-"
CHOICE_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _question_type(section: str, stem: str) -> str:
    value = stem.casefold()
    if section == "Reading Comprehension":
        patterns = (
            (r"main (?:idea|point|purpose)|primarily concerned", "Main Point"),
            (r"author.*attitude|tone of the passage", "Author's Perspective"),
            (r"function|role played|serves primarily to", "Function"),
            (r"infer|suggest|most strongly support", "Inference"),
            (r"analog|similar|parallel", "Analogy"),
        )
        fallback = "Reading Comprehension"
    else:
        patterns = (
            (r"most strengthens|strengthen", "Strengthen"),
            (r"most weakens|weaken|cast doubt", "Weaken"),
            (r"assumption|required by|depends on", "Assumption"),
            (r"flaw|vulnerable to criticism", "Flaw"),
            (r"parallel|most like|similar.*reasoning", "Parallel Reasoning"),
            (r"must (?:also )?be true|properly inferred|most strongly supported", "Inference"),
            (r"principle", "Principle"),
            (r"resolve|reconcile|explain", "Resolve the Paradox"),
            (r"main conclusion|main point", "Main Conclusion"),
            (r"role played|method.*reasoning|argument proceeds", "Argument Structure"),
        )
        fallback = "Logical Reasoning"
    return next((name for pattern, name in patterns if re.search(pattern, value)), fallback)


def _iter_dataset_rows(dataset: str, split: str) -> Iterator[dict]:
    offset = 0
    total = None
    while total is None or offset < total:
        response = None
        for attempt in range(8):
            response = requests.get(
                DATASET_SERVER_ROWS_URL,
                params={
                    "dataset": dataset,
                    "config": "default",
                    "split": split,
                    "offset": offset,
                    "length": 100,
                },
                timeout=60,
            )
            if response.status_code == 429:
                retry_after = response.headers.get("Retry-After")
                try:
                    delay = max(1.0, float(retry_after)) if retry_after else min(90.0, 10.0 * (attempt + 1))
                except ValueError:
                    delay = min(90.0, 10.0 * (attempt + 1))
                current_app.logger.warning(
                    "Hugging Face rate limit reached; retrying %s/%s at row %s in %.1fs",
                    dataset,
                    split,
                    offset,
                    delay,
                )
                time.sleep(delay)
                continue
            if response.status_code >= 500 and attempt < 7:
                time.sleep(min(30.0, 2.0 ** attempt))
                continue
            response.raise_for_status()
            break
        else:
            raise RuntimeError(f"Hugging Face did not serve {dataset} ({split}) after several retries")
        if response is None:
            raise RuntimeError(f"Hugging Face did not serve {dataset} ({split})")
        payload = response.json()
        rows = payload.get("rows")
        total = payload.get("num_rows_total")
        if not isinstance(rows, list) or not isinstance(total, int):
            raise RuntimeError(f"Unexpected response while downloading {dataset} ({split})")
        if not rows and offset < total:
            raise RuntimeError(f"Incomplete response while downloading {dataset} ({split})")
        for wrapper in rows:
            row = wrapper.get("row") if isinstance(wrapper, dict) else None
            if not isinstance(row, dict):
                raise RuntimeError(f"Invalid row while downloading {dataset} ({split})")
            yield row
        offset += len(rows)
        # The Dataset Server limits requests per minute. A small delay keeps a
        # complete six-split import below that ceiling, while the 429 branch
        # above handles shared-IP traffic and stricter future limits.
        if offset < total:
            time.sleep(float(current_app.config.get("HUGGINGFACE_REQUEST_INTERVAL_SECONDS", 1.1)))


def _validated_record(row: dict, dataset: str) -> tuple[str, str, list[str], int, str]:
    context = row.get("context")
    source_id = row.get("id_string")
    answers = row.get("answers")
    label = row.get("label")
    stem = row.get("question")
    if (
        not isinstance(context, str)
        or not context.strip()
        or not isinstance(source_id, str)
        or not source_id.strip()
        or not isinstance(answers, list)
        or not 2 <= len(answers) <= len(CHOICE_LABELS)
        or any(not isinstance(answer, str) or not answer.strip() for answer in answers)
        or isinstance(label, bool)
        or not isinstance(label, int)
        or not 0 <= label < len(answers)
        or not isinstance(stem, str)
        or not stem.strip()
    ):
        raise RuntimeError(f"Invalid record in {dataset}: {source_id or 'unknown id'}")
    return context.strip(), source_id.strip(), [answer.strip() for answer in answers], label, stem.strip()


def _upsert_row(
    row: dict,
    dataset: str,
    section: str,
    split: str,
    passages: dict[str, Passage],
    questions: dict[str, Question],
    choices: dict[tuple[str, str], QuestionChoice],
) -> None:
    context, source_id, answers, label, stem = _validated_record(row, dataset)
    dataset_slug = dataset.rsplit("/", 1)[-1]
    question_id = f"hf-{dataset_slug}:{source_id}"
    passage_id = None
    stimulus = context
    if section == "Reading Comprehension":
        passage_id = f"hf-rc-passage:{hashlib.sha256(context.encode('utf-8')).hexdigest()[:24]}"
        stimulus = None
        passage = passages.get(passage_id)
        if not passage:
            passage = Passage(
                id=passage_id,
                canonical_text=context,
                passage_type="Reading Comprehension",
                source=f"{SOURCE_PREFIX}rc",
                review_status="published",
            )
            db.session.add(passage)
        else:
            passage.canonical_text = context
            passage.source = f"{SOURCE_PREFIX}rc"
            passage.review_status = "published"
        passages[passage_id] = passage

    question = questions.get(question_id)
    if not question:
        question = Question(id=question_id)
        db.session.add(question)
        questions[question_id] = question
    question.passage_id = passage_id
    question.section = section
    question.question_type = _question_type(section, stem)
    question.difficulty = 3
    question.stimulus = stimulus
    question.stem = stem
    question.correct_answer = CHOICE_LABELS[label]
    question.source = f"{SOURCE_PREFIX}{'rc' if section == 'Reading Comprehension' else 'lr'} · {split}"
    question.content_hash = hashlib.sha256(
        "\n".join((context, stem, *answers, str(label))).encode("utf-8")
    ).hexdigest()
    question.license_status = "upstream_terms_apply"
    question.review_status = "published"
    existing_choices = {
        label: choices[(question_id, label)]
        for label in CHOICE_LABELS
        if (question_id, label) in choices
    }
    valid_labels = set()
    for position, answer in enumerate(answers):
        choice_label = CHOICE_LABELS[position]
        valid_labels.add(choice_label)
        choice = existing_choices.get(choice_label)
        if not choice:
            choice = QuestionChoice(
                id=f"{question_id}-{choice_label}",
                question_id=question_id,
                label=choice_label,
            )
            db.session.add(choice)
            choices[(question_id, choice_label)] = choice
        choice.canonical_text = answer
        choice.position = position
    for choice_label, choice in existing_choices.items():
        if choice_label not in valid_labels:
            db.session.delete(choice)
            choices.pop((question_id, choice_label), None)


def huggingface_question_count() -> int:
    return Question.query.filter(Question.source.like(f"{SOURCE_PREFIX}%")).count()


def seed_questions(force: bool = False) -> int:
    if huggingface_question_count() and not force:
        return 0

    count = 0
    existing_questions = Question.query.filter(Question.source.like(f"{SOURCE_PREFIX}%")).all()
    questions = {question.id: question for question in existing_questions}
    question_ids = list(questions)
    existing_choices = (
        QuestionChoice.query.filter(QuestionChoice.question_id.in_(question_ids)).all()
        if question_ids
        else []
    )
    choices = {
        (choice.question_id, choice.label): choice
        for choice in existing_choices
    }
    passages = {
        passage.id: passage
        for passage in Passage.query.filter(Passage.source.like(f"{SOURCE_PREFIX}%")).all()
    }
    try:
        for dataset, section in DATASETS.items():
            for split in SPLITS:
                for row in _iter_dataset_rows(dataset, split):
                    _upsert_row(row, dataset, section, split, passages, questions, choices)
                    count += 1
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    current_app.logger.info("Seeded %s LSAT questions from Hugging Face", count)
    return count
