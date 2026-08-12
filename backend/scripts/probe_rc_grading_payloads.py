#!/usr/bin/env python3
"""Capture what the graders actually send on a Reading Comprehension question.

An audit found four defects in this path by intercepting the outbound HTTP bodies
rather than by reading the code, which is the only method that could have found
them: the artifact reviewer looked correct at every call site and was still being
handed `"stimulus": null` and no passage on all 2,366 Reading Comprehension
questions, because that is what a Reading Comprehension question's `stimulus`
holds. This probe repeats that method against the fixes.

    python scripts/probe_rc_grading_payloads.py

It builds a real passage from the pinned bank, a real question on it, and a real
attempt whose `passage_map` gate is satisfied with an artifact keyed by part
index. Then it patches `requests.post` — the last thing before the socket, so
what is captured is the body that would have been sent — and reads the JSON back
out.

Every check runs twice. Once against the fixed path, where it must pass, and once
against a deliberately broken input, where it must fail. That second run is the
point: a probe that asserts `passage_parts` exists proves nothing unless it can be
shown failing when the parts are missing, since an assertion that cannot fail is
indistinguishable from one that is not looking.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models import Attempt, Passage, Question, QuestionChoice, SessionItem  # noqa: E402
from app.passage_structure import derive_paragraphs  # noqa: E402

CHOICES = {
    "A": "The author rejects both accounts as unfounded.",
    "B": "Video technology inevitably imposes Western values.",
    "C": "Anthropologists disagree about what indigenous video does to indigenous culture.",
    "D": "The Kayapo abandoned their ceremonies once they had cameras.",
    "E": "Ethnographic film was neutral until the 1980s.",
}


def _bank_passage() -> str:
    """One real passage, so the parts are real prose and not a fixture's four lines."""
    root = Path(__file__).resolve().parents[1] / "data" / "question_bank" / "lsat-rc"
    for path in sorted(root.glob("*.jsonl")):
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                context = json.loads(line).get("context") or ""
                if "visual anthropologists" in context:
                    return context
    raise SystemExit("The pinned Reading Comprehension snapshot is missing.")


class Capture:
    """Stands in for the HTTP call and remembers what was handed to it."""

    def __init__(self, reply: dict):
        self.reply = reply
        self.bodies: list[dict] = []

    def __call__(self, _url, headers=None, json=None, timeout=None):  # noqa: A002
        self.bodies.append(json)
        return _Response(self.reply)

    @property
    def data(self) -> dict:
        import json as jsonlib

        body = self.bodies[-1]
        return jsonlib.loads(body["messages"][1]["content"].split("\n\n", 1)[1])

    @property
    def system(self) -> str:
        return self.bodies[-1]["messages"][0]["content"]


class _Response:
    status_code = 200

    def __init__(self, reply: dict):
        self._reply = reply

    def json(self) -> dict:
        return {
            "model": "probe",
            "choices": [{"message": {"content": json.dumps(self._reply)}}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1},
        }

    def raise_for_status(self) -> None:
        return None


ARTIFACT_REPLY = {"quality": 0.8, "note": "The map names each part's job."}
COACHING_REPLY = {
    "explanation_grade": 70,
    "reasoning_verdict": "partial",
    "reasoning_summary": "A real reading of the passage that stops short of the contrast.",
    "understood_correctly": "You located the disagreement.",
    "first_error": {
        "code": "wrong_passage_location",
        "description": "You argued from the Turner paragraph rather than the one the stem asked about.",
        "repair": "Go back to the part that introduces the disagreement.",
    },
    "answer_analysis": {
        "correct_answer_explanation": "It states the disagreement the passage is organised around.",
        "selected_answer_explanation": "It names one side rather than the disagreement.",
        "choice_explanations": [
            {"label": label, "explanation": "One or two sentences on this choice."} for label in "ABCDE"
        ],
    },
    "next_step_hint": "If the stem says 'the passage as a whole', answer from the map.",
    "solution_method": "1) Map it. 2) Find the contrast. 3) Answer from the map.",
    "debrief": "You read it. Now use the structure.",
}


def _build(segmented: bool, applied: bool) -> Attempt:
    """A question, a passage and a satisfied `passage_map` attempt.

    The attempt is deliberately not persisted. Both graders read it through
    `session_item.question`, which is set here, and leaving it out of the session
    keeps `recent_reasoning_samples` empty so the captured payload is the same on
    every run.
    """
    text = _bank_passage()
    offsets, source = derive_paragraphs(text)
    passage = Passage(
        id="probe-passage",
        canonical_text=text,
        passage_type="Reading Comprehension",
        paragraph_offsets=offsets if segmented else None,
        paragraph_source=source if segmented else None,
        review_status="published",
    )
    db.session.add(passage)
    question = Question(
        id="hf-lsat-rc:probe",
        passage_id=passage.id,
        section="Reading Comprehension",
        question_type="Main Point",
        difficulty=3,
        stimulus=None,
        stem="Which one of the following most accurately states the main point of the passage?",
        correct_answer="C",
        review_status="published",
    )
    db.session.add(question)
    for position, label in enumerate("ABCDE"):
        db.session.add(
            QuestionChoice(
                id=f"probe-{label}",
                question_id=question.id,
                label=label,
                canonical_text=CHOICES[label],
                position=position,
            )
        )
    db.session.flush()

    from app import enforcement

    parts = enforcement.passage_parts(passage)
    item = SessionItem(session_id=None, question_id=question.id, position=0)
    item.question = question
    attempt = Attempt(
        selected_label="B",
        is_correct=False,
        reasoning_text="Weiner says video imposes Western values, so B.",
        strategy_key="passage_map",
        strategy_applied=applied,
        strategy_gate_status=enforcement.STATUS_SATISFIED,
        strategy_artifact_json={
            "fields": {
                "notes": {str(index): f"job of part {index}" for index in range(len(parts))}
            }
        },
    )
    attempt.session_item = item
    return attempt


def _report(label: str, ok: bool, detail: str = "") -> bool:
    print(f"  {'PASS' if ok else 'FAIL'}  {label}")
    if detail:
        print(f"        {detail}")
    return ok


def probe(app, *, segmented: bool, applied: bool) -> dict:
    """Run both graders once and hand back what went over the wire."""
    from app import coaching, enforcement

    with app.app_context():
        db.drop_all()
        db.create_all()
        attempt = _build(segmented=segmented, applied=applied)

        app.config["TFY_URL"] = "https://probe.invalid/v1"
        app.config["TFY_API_KEY"] = "probe"

        artifact_capture = Capture(ARTIFACT_REPLY)
        coaching.requests.post = artifact_capture
        quality = enforcement.review_artifact(attempt)
        artifact = {"data": artifact_capture.data, "system": artifact_capture.system, "quality": quality}

        coaching_capture = Capture(COACHING_REPLY)
        coaching.requests.post = coaching_capture
        coaching.generate_attempt_coaching(attempt)
        main = {"data": coaching_capture.data, "system": coaching_capture.system}
        return {"artifact": artifact, "coaching": main}


def main() -> int:
    import requests

    real_post = requests.post
    app = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
        }
    )
    try:
        fixed = probe(app, segmented=True, applied=True)
        blind = probe(app, segmented=False, applied=True)
        declined = probe(app, segmented=True, applied=False)
    finally:
        from app import coaching

        coaching.requests.post = real_post

    artifact = fixed["artifact"]["data"]
    coaching_data = fixed["coaching"]["data"]
    passage_text = coaching_data["question"]["passage"]
    ok = True

    print("\n1. The artifact reviewer, on a Reading Comprehension question")
    print(f"   payload keys: {sorted(artifact)}, question keys: {sorted(artifact['question'])}")
    parts = artifact["question"].get("passage_parts") or {}
    notes = ((artifact.get("student_artifact") or {}).get("fields") or {}).get("notes") or {}
    ok &= _report("the payload carries the parts of the passage", bool(parts),
                  f"{len(parts)} parts, {sum(len(value.split()) for value in parts.values())} words")
    ok &= _report("every part is real text, not an empty string",
                  bool(parts) and all(str(value).strip() for value in parts.values()))
    ok &= _report("the parts reassemble to the passage the grader was given",
                  "".join(parts[key] for key in sorted(parts, key=int)).replace(" ", "")
                  == passage_text.replace(" ", ""))
    ok &= _report("the artifact's note keys index the parts that were sent",
                  bool(notes) and sorted(notes) == sorted(parts),
                  f"notes keyed {sorted(notes)} against parts keyed {sorted(parts)}")
    ok &= _report("the prompt tells the model the keys are indexes",
                  "keyed by those numbers" in fixed["artifact"]["system"])
    ok &= _report("the prompt says the boundaries are derived, not authored",
                  "not marked by the passage's author" in fixed["artifact"]["system"])
    ok &= _report("a rating still comes back", fixed["artifact"]["quality"] == 0.8)

    print("\n   negative control: the same probe against a passage with no segmentation")
    control_parts = blind["artifact"]["data"]["question"].get("passage_parts") or {}
    ok &= _report("collapses to one undivided part, and the probe sees it",
                  len(control_parts) == 1,
                  f"{len(control_parts)} part — this is the defect, reproduced on demand")

    print("\n2. The main grader")
    print(f"   payload keys: {sorted(coaching_data)}")
    approach = coaching_data.get("assigned_approach") or {}
    ok &= _report("the assigned approach is in the payload", bool(approach), json.dumps(approach)[:160])
    ok &= _report("it names the key the bandit chose", approach.get("key") == "passage_map")
    ok &= _report("it quotes the instruction the student was shown",
                  "three to twelve words" in (approach.get("instruction") or ""))
    ok &= _report("it says whether the gate was satisfied", approach.get("gate_satisfied") is True)
    ok &= _report("the full passage is still there, untruncated",
                  passage_text == _bank_passage(), f"{len(passage_text)} characters")

    print("\n   negative control: the same probe on an attempt that declined the approach")
    ok &= _report("sends no assigned_approach, and the probe sees it",
                  "assigned_approach" not in declined["coaching"]["data"],
                  "so the key tracks the real assignment rather than being always present")

    print("\n3. The rubric")
    system = fixed["coaching"]["system"]
    ok &= _report("the Invalid band names the passage as something copyable",
                  "copied text from the passage, stimulus, stem, or a choice" in system)
    for code in ("wrong_passage_location", "no_textual_warrant", "view_attribution"):
        ok &= _report(f"the model may return {code}", code in system)
    ok &= _report("the rubric explains when to prefer them to the argument codes",
                  "rather than unsupported_assumption" in system)
    ok &= _report("the rubric tells the model the approach was compulsory work",
                  "Never grade a student down for following the approach" in system)

    print("\n   negative control: the wording this replaced is gone")
    ok &= _report("the old Invalid band, which never named the passage, is absent",
                  "copied text from the stimulus, stem, or a choice" not in system)

    print("\n4. Versions")
    from app.coaching import PROMPT_VERSION
    from app.enforcement import ARTIFACT_PROMPT_VERSION

    ok &= _report("the coaching prompt version moved off v3",
                  not PROMPT_VERSION.startswith("coaching-v3"), PROMPT_VERSION)
    ok &= _report("the artifact prompt version moved off v1",
                  not ARTIFACT_PROMPT_VERSION.startswith("artifact-v1"), ARTIFACT_PROMPT_VERSION)

    print()
    print("Every check passed." if ok else "SOMETHING FAILED — read the FAILs above.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
