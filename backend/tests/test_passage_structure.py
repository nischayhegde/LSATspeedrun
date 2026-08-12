"""Where a passage divides, and whether the graders are shown it.

Two things are pinned here, and they fail for different reasons.

The first is the segmentation itself. Every Reading Comprehension passage in this
bank arrived as one unbroken blob, so the boundaries are derived rather than read,
and a derived boundary can be wrong in ways a hand-written one cannot. What these
tests hold is not that any particular cut is right — no test can know that — but
that the derivation never destroys the passage, never produces a part that cannot
have a job, never claims to be authored, and stays measurably better than chance
at finding a boundary that is genuinely known.

The second is the payload. `review_artifact` was shown `"stimulus": null` and no
passage on every Reading Comprehension question, which is the whole section, and
rated a map of a passage it could not see. Those tests assert against the data
structure that goes to the provider, because that is where the defect lived while
every call site read correctly. `scripts/probe_rc_grading_payloads.py` does the
same thing one layer lower, at the HTTP body.
"""

from __future__ import annotations

import json
import random
import re
from functools import lru_cache
from pathlib import Path

import pytest

from app import create_app
from app.enforcement import (
    ARTIFACT_PROMPT_VERSION,
    GATES,
    STATUS_SATISFIED,
    _artifact_question_data,
    passage_parts,
    split_sentences,
)
from app.extensions import db
from app.models import Attempt, Passage, Question, QuestionChoice, SessionItem
from app.passage_structure import (
    SOURCE_AUTHORED,
    SOURCE_DERIVED,
    _MIN_PART_SENTENCES,
    _MIN_PART_WORDS,
    _WORD,
    derive_paragraphs,
    offsets_are_usable,
    paragraphs_from_offsets,
    sentence_spans,
)


BANK = Path(__file__).resolve().parents[1] / "data" / "question_bank" / "lsat-rc"
_HEAD_A = re.compile(r"Passage A(?![a-z])")
_HEAD_B = re.compile(r"Passage B(?![a-z])")


def bank_passages() -> list[str]:
    texts = set()
    for path in sorted(BANK.glob("*.jsonl")):
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    texts.add(json.loads(line).get("context") or "")
    return sorted(text for text in texts if text.strip())


@pytest.fixture(scope="module")
def passages() -> list[str]:
    texts = bank_passages()
    assert len(texts) == 349, "the pinned Reading Comprehension snapshot changed size"
    return texts


# ---------------------------------------------------------------------------
# The bank this work exists because of
# ---------------------------------------------------------------------------


def test_no_passage_in_the_bank_carries_a_break_of_its_own(passages):
    """The premise of the whole exercise, checked rather than believed.

    If a later snapshot ships passages with real paragraphs, the derivation
    should stop being used on them — `derive_paragraphs` already prefers an
    authored break — and this test is where that change announces itself.
    """
    for text in passages:
        assert not re.search(r"[\n\r\t\u2028\u2029]", text)
        assert "  " not in text
        assert "\xa0" not in text


def test_every_passage_survives_being_divided(passages):
    """No segmentation may lose, duplicate or reorder a character of the bank."""
    for text in passages:
        offsets, _source = derive_paragraphs(text)
        parts = paragraphs_from_offsets(text, offsets)
        assert re.sub(r"\s+", "", " ".join(parts)) == re.sub(r"\s+", "", text)


def test_every_passage_ends_up_with_parts_a_student_could_label(passages):
    """A part has to be big enough to have a job and small enough to have only one.

    The floor stops a one-sentence stub being called a section of the passage. The
    ceiling is the defect being fixed: one note covering three thousand characters
    is not an index entry, so a part running past 200 words means the technique is
    still degenerate there.
    """
    oversized = 0
    for text in passages:
        offsets, _source = derive_paragraphs(text)
        parts = paragraphs_from_offsets(text, offsets)
        assert len(parts) >= 2, text[:80]
        for part in parts:
            assert len(_WORD.findall(part.lower())) >= _MIN_PART_WORDS
            oversized += len(part.split()) > 200
    # One passage in the bank is 406 words in three sentences, which cannot be cut
    # three ways without leaving a stub, so it keeps one long part on purpose.
    assert oversized <= 2


def test_a_part_never_begins_by_pointing_back_at_the_sentence_before_it(passages):
    """A paragraph does not open "For instance"."""
    continuation = re.compile(r"^(For instance|For example|That is|In other words)\b", re.IGNORECASE)
    for text in passages:
        offsets, _source = derive_paragraphs(text)
        for part in paragraphs_from_offsets(text, offsets)[1:]:
            assert not continuation.match(part), part[:70]


def test_the_comparative_seam_is_always_a_boundary(passages):
    """Where a boundary is genuinely authored, it is used rather than re-derived.

    The 32 comparative sets print two passages under headings, so the start of
    Passage B is a real break. A student mapping such a set must never be handed a
    part that runs across it.
    """
    sets = 0
    for text in passages:
        seam = _HEAD_B.search(text)
        if not seam or not _HEAD_A.search(text):
            continue
        sets += 1
        offsets, _source = derive_paragraphs(text)
        assert seam.start() in offsets, text[:80]
    assert sets == 32


def test_a_passage_with_real_breaks_is_believed_rather_than_re_derived():
    text = "First a claim about archives.\n\nThen an objection about cost.\n\nThen the real dispute."
    offsets, source = derive_paragraphs(text)
    assert source == SOURCE_AUTHORED
    assert [part.split(" ")[0] for part in paragraphs_from_offsets(text, offsets)] == ["First", "Then", "Then"]


def test_a_derived_segmentation_never_claims_to_be_authored(passages):
    """Provenance is the point of the column, so it has to be right on every row."""
    for text in passages:
        _offsets, source = derive_paragraphs(text)
        assert source == SOURCE_DERIVED


def test_a_sentence_whose_space_the_flattening_ate_is_still_a_sentence():
    """"...more damaging.Although no empirical research..." is two sentences.

    58 of these across 24 passages, and one passage is 406 words in what the
    ordinary rule reads as three sentences. They are sentence breaks and not
    paragraph breaks — measured, not assumed — so they divide sentences here and
    nothing more.
    """
    text = "The revelation would be more damaging.Although no research has addressed it, some has."
    spans = sentence_spans(text)
    assert [text[begin:end] for begin, end in spans] == [
        "The revelation would be more damaging.",
        "Although no research has addressed it, some has.",
    ]


def test_an_abbreviation_is_not_a_sentence_boundary():
    """The eaten-space rule has to decline the things that look like it."""
    for text in ("The U.S.Government said so.", "Dr.Smith disagreed with it.", "J.R.R.Tolkien wrote it."):
        assert len(sentence_spans(text)) == 1, text


def test_a_case_citation_is_not_two_sentences():
    """Found by reading the output, which is the only way it could have been found.

    A part opened "Bell, a United States appellate court ruled ...", because the
    stop in "Charrier v." looked like the end of a sentence. Both splitters have to
    agree it is not, since the same stop would otherwise be offered to a student as
    a line to cite.
    """
    text = "In Charrier v. Bell, an appellate court ruled that abandonment does not apply here."
    assert len(sentence_spans(text)) == 1
    assert len(split_sentences(text)) == 1


@pytest.mark.parametrize(
    "text",
    [
        "The dispute reached the U.S. Congress in the end.",
        "Some tokens date to before 4000 B.C. Others are later.",
        "Critics have praised Ms. Whitlock for the digitization programme.",
        "The ruling in Charrier vs. Bell has been followed since then.",
    ],
)
def test_an_abbreviation_mid_sentence_does_not_end_it(text):
    assert len(split_sentences(text)) == 1, split_sentences(text)


def test_a_real_sentence_ending_in_a_labelled_group_still_ends():
    """The abbreviations that were left out on purpose, and why.

    A single capital initial is the largest remaining class of false break, and it
    is not in the list because "Robert L. Herbert" wants joining while "Group A.
    Clearly, at least one type of memory" does not, and the two look identical.
    The Logical Reasoning stimuli label things this way constantly, so the
    splitter leaves them alone and `_cut_within` refuses to open a part on one.
    """
    text = "There was one lapse in Group A. Clearly, at least one type of memory decays."
    assert len(split_sentences(text)) == 2
    # The cost of leaving them out, stated rather than hidden: a middle initial
    # still splits a name into two lines. It cannot reach a student as a part
    # boundary, which is what the test below holds, and it can still reach one as a
    # citable line — a pre-existing rough edge in a different feature, left alone.
    assert len(split_sentences("Robert L. Herbert dissociates himself from formalists.")) == 2


def test_no_part_in_the_bank_opens_on_something_that_cannot_open_a_sentence(passages):
    cannot_open = re.compile(r"^(?:[a-z]|[A-Z]\.\s)")
    for text in passages:
        offsets, _source = derive_paragraphs(text)
        for part in paragraphs_from_offsets(text, offsets)[1:]:
            assert not cannot_open.match(part), part[:70]


# ---------------------------------------------------------------------------
# Is it better than nothing? Measured on the only truth available.
# ---------------------------------------------------------------------------


def _blinded_seams(passages: list[str]) -> list[tuple[str, int]]:
    pairs = []
    for text in passages:
        head_a, head_b = _HEAD_A.search(text), _HEAD_B.search(text)
        if not head_a or not head_b or head_b.start() <= head_a.end():
            continue
        before = (text[: head_a.start()] + text[head_a.end(): head_b.start()]).strip()
        after = text[head_b.end():].strip()
        pairs.append((f"{before} {after}", len(split_sentences(before))))
    return pairs


def _found(text: str) -> set[int]:
    offsets, _source = derive_paragraphs(text)
    starts = set(offsets)
    return {index for index, (begin, _end) in enumerate(sentence_spans(text)) if begin in starts and index}


def test_the_ground_truth_this_is_measured_against_is_exact(passages):
    """The seam index has to be the segmenter's to miss, not the ruler's."""
    for text in passages:
        head_a, head_b = _HEAD_A.search(text), _HEAD_B.search(text)
        if not head_a or not head_b or head_b.start() <= head_a.end():
            continue
        before = (text[: head_a.start()] + text[head_a.end(): head_b.start()]).strip()
        after = text[head_b.end():].strip()
        joined = split_sentences(f"{before} {after}")
        assert joined[len(split_sentences(before))] == split_sentences(after)[0]


def test_it_finds_the_region_of_a_real_boundary_better_than_chance_does(passages):
    """The claim the shipped copy rests on, held to a matched baseline.

    Chance is allowed exactly what the segmenter is allowed — the same number of
    boundaries, in the same admissible places — because a baseline forbidden the
    good positions is not a baseline. Averaged over 40 draws so this does not turn
    on one lucky seed.

    Only the within-one figure is asserted, deliberately. Exact placement is 11 of
    32 against 7.9 expected, which chance reaches often enough that claiming it
    would be claiming noise, and that is precisely why the derived boundaries are
    never presented to a student as the author's paragraphs.
    """
    pairs = _blinded_seams(passages)
    within = sum(
        min((abs(index - truth) for index in _found(text)), default=99) <= 1 for text, truth in pairs
    )

    def admissible(text: str) -> list[int]:
        spans = sentence_spans(text)
        words = [len(text[begin:end].split()) for begin, end in spans]
        return [
            boundary
            for boundary in range(_MIN_PART_SENTENCES, len(spans) - _MIN_PART_SENTENCES + 1)
            if sum(words[:boundary]) >= _MIN_PART_WORDS and sum(words[boundary:]) >= _MIN_PART_WORDS
        ]

    beaten = 0
    for seed in range(40):
        rng = random.Random(seed)
        chance = 0
        for text, truth in pairs:
            pool = admissible(text)
            picked = set(rng.sample(pool, min(len(_found(text)), len(pool)))) if pool else set()
            chance += min((abs(index - truth) for index in picked), default=99) <= 1
        beaten += chance >= within
    assert within >= 24, within
    assert beaten <= 2, f"chance matched the segmenter in {beaten} of 40 draws"


# ---------------------------------------------------------------------------
# Reading a stored segmentation back
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "offsets",
    [
        None,
        [],
        [5],
        "0,40",
        [40, 0],
        [0, 40, 40],
        [0, 10 ** 6],
        [0, True],
        [0.0, 40],
    ],
)
def test_a_segmentation_that_does_not_fit_its_passage_reads_as_one_part(offsets):
    """The graceful answer to nonsense is the behaviour that shipped before it.

    A student asked to name the job of a stretch beginning mid-word is worse off
    than a student asked to name the job of the whole passage, so anything that
    cannot be trusted degrades to one part rather than being rendered.
    """
    text = "A first sentence about archives. A second sentence about the fee. A third about the dispute."
    assert not offsets_are_usable(offsets, text)
    assert paragraphs_from_offsets(text, offsets) == [text]


def test_the_reader_prefers_the_stored_segmentation_and_survives_its_absence():
    text = "Archives belong to the public. Digitizing them costs money. The dispute is about neither."
    offsets = [0, text.index("Digitizing")]
    stored = Passage(id="p1", canonical_text=text, paragraph_offsets=offsets, paragraph_source=SOURCE_DERIVED)
    assert len(passage_parts(stored)) == 2
    assert passage_parts(Passage(id="p2", canonical_text=text)) == [text]
    assert passage_parts(None) == []


# ---------------------------------------------------------------------------
# What the graders are actually sent
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def _rc_passage() -> str:
    """A real passage from the pinned bank, not a fixture's three lines.

    The whole defect was that a real passage is 3,000 unbroken characters, and a
    short invented one divides into nothing and would prove nothing.
    """
    return bank_passages()[0]


@pytest.fixture()
def app():
    application = create_app(
        {"TESTING": True, "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:", "AUTO_SEED": False}
    )
    with application.app_context():
        db.create_all()
    yield application
    with application.app_context():
        db.session.remove()
        db.drop_all()


def _rc_attempt(key: str, *, applied: bool = True, segmented: bool = True) -> Attempt:
    offsets, source = derive_paragraphs(_rc_passage())
    passage = Passage(
        id=f"passage-{key}",
        canonical_text=_rc_passage(),
        passage_type="Reading Comprehension",
        paragraph_offsets=offsets if segmented else None,
        paragraph_source=source if segmented else None,
    )
    db.session.add(passage)
    question = Question(
        id=f"hf-lsat-rc:{key}",
        passage_id=passage.id,
        section="Reading Comprehension",
        question_type="Main Point",
        difficulty=3,
        stimulus=None,
        stem="Which one of the following states the main point of the passage?",
        correct_answer="C",
    )
    db.session.add(question)
    for position, label in enumerate("ABCDE"):
        db.session.add(
            QuestionChoice(
                id=f"{question.id}-{label}",
                question_id=question.id,
                label=label,
                canonical_text=f"Choice {label} says something about the archive.",
                position=position,
            )
        )
    db.session.flush()
    item = SessionItem(session_id=None, question_id=question.id, position=0)
    item.question = question
    attempt = Attempt(
        selected_label="B",
        is_correct=False,
        reasoning_text="Grimes wants the fee, so B.",
        strategy_key=key,
        strategy_applied=applied,
        strategy_gate_status=STATUS_SATISFIED,
        strategy_artifact_json={"fields": {"notes": {"0": "sets up the claim"}}},
    )
    attempt.session_item = item
    return attempt


def test_the_artifact_reviewer_is_shown_the_parts_the_student_annotated(app):
    """The defect: a model rating a map of a passage it was never sent.

    The payload carried `section`, `stimulus` and `stem`, and `stimulus` is null on
    all 2,366 Reading Comprehension questions. Sending the raw passage would not
    have been enough either, because the artifact is keyed by part index and 3,000
    unbroken characters have no index.
    """
    with app.app_context():
        attempt = _rc_attempt("passage_map")
        data = _artifact_question_data(attempt.session_item.question, GATES["passage_map"])

    assert data["stimulus"] is None
    parts = data["passage_parts"]
    assert len(parts) >= 2
    assert list(parts) == list(range(len(parts)))
    assert all(str(value).strip() for value in parts.values())
    assert re.sub(r"\s+", "", " ".join(parts.values())) == re.sub(r"\s+", "", _rc_passage())


def test_a_gate_that_annotates_nothing_is_still_shown_the_passage(app):
    """Three of the six Reading Comprehension gates have no segmented field.

    `viewpoint_ledger`, `comparative_matrix` and `main_point_synthesis` are typed
    freehand, so there are no indexes to align — and without the passage the model
    is as blind as it was before. It gets the passage whole.
    """
    for key in ("viewpoint_ledger", "comparative_matrix", "main_point_synthesis"):
        with app.app_context():
            attempt = _rc_attempt(key)
            data = _artifact_question_data(attempt.session_item.question, GATES[key])
        assert data["passage"] == _rc_passage(), key
        assert "passage_parts" not in data, key


def test_the_passage_is_not_sent_twice_when_the_parts_already_carry_it(app):
    """One copy of 3,000 characters per rating, on a call that adds a sentence."""
    for key in ("passage_map", "paragraph_function", "textual_proof"):
        with app.app_context():
            attempt = _rc_attempt(key)
            data = _artifact_question_data(attempt.session_item.question, GATES[key])
        assert "passage" not in data, key
        assert data.get("passage_parts") or data.get("passage_lines"), key


def test_a_logical_reasoning_gate_still_sends_the_stimulus_and_no_passage(app):
    """The path that already worked has to keep working."""
    with app.app_context():
        question = Question(
            id="hf-lsat-lr:probe",
            section="Logical Reasoning",
            question_type="Flaw",
            difficulty=3,
            stimulus="Halford drinks more coffee than Denby. Halford reports more insomnia. The coffee causes it.",
            stem="The reasoning is most vulnerable to criticism on which ground?",
            correct_answer="C",
        )
        db.session.add(question)
        db.session.flush()
        data = _artifact_question_data(question, GATES["prephrase"])
    assert data["stimulus"].startswith("Halford")
    assert "passage" not in data and "passage_parts" not in data


def test_the_main_grader_is_told_which_approach_was_assigned(app):
    from app.coaching import _assigned_approach

    with app.app_context():
        attempt = _rc_attempt("passage_map")
        approach = _assigned_approach(attempt)

    assert approach["key"] == "passage_map"
    assert "three to twelve words" in approach["instruction"]
    assert approach["gate_satisfied"] is True
    assert approach["steps"] and approach["name"]


def test_an_approach_that_was_offered_and_declined_is_not_an_assignment(app):
    """So the payload stays byte-identical on an attempt that was not assigned one."""
    from app.coaching import _assigned_approach

    with app.app_context():
        assert _assigned_approach(_rc_attempt("passage_map", applied=False)) is None
        attempt = _rc_attempt("main_point_synthesis")
        attempt.strategy_key = None
        assert _assigned_approach(attempt) is None


COACHING_REPLY = {
    "explanation_grade": 60,
    "reasoning_verdict": "partial",
    "reasoning_summary": "A real reading that stops short of the contrast.",
    "understood_correctly": "You found Grimes.",
    "first_error": {
        "code": "wrong_passage_location",
        "description": "You argued from the objection rather than from the dispute.",
        "repair": "Read the last part again.",
    },
    "answer_analysis": {
        "correct_answer_explanation": "It states what the dispute is about.",
        "selected_answer_explanation": "It states one side of it.",
        "choice_explanations": [{"label": label, "explanation": "A sentence."} for label in "ABCDE"],
    },
    "next_step_hint": "If the stem says the whole passage, answer from the map.",
    "solution_method": "1) Map. 2) Contrast. 3) Answer.",
    "debrief": "You read it. Now use the structure.",
}


def test_the_rubric_names_the_passage_and_can_diagnose_a_passage_error(app, monkeypatch):
    """Six of twelve codes named argument moves and none named a passage one.

    Read off the prompt that actually goes out, not off the module source: the
    rubric is a local inside `generate_attempt_coaching`, and a test that greps the
    file would still pass if the string stopped being sent.
    """
    from app import coaching

    captured: dict = {}

    def capture(system, data, max_tokens=5000):
        captured["system"] = system
        captured["data"] = data
        return COACHING_REPLY, {"model": "test"}

    monkeypatch.setattr(coaching, "_chat", capture)
    with app.app_context():
        result, _metadata = coaching.generate_attempt_coaching(_rc_attempt("passage_map"))

    system = captured["system"]
    for code in ("wrong_passage_location", "no_textual_warrant", "view_attribution"):
        assert code in coaching.ERROR_CODES
        assert code in system
    assert "copied text from the passage, stimulus, stem, or a choice" in system
    assert "rather than unsupported_assumption" in system
    assert "Never grade a student down for following the approach" in system
    # The model's choice of a Reading Comprehension code survives validation rather
    # than being flattened to `other`, which is what would happen to any code the
    # set does not know about.
    assert result["first_error"]["code"] == "wrong_passage_location"
    assert captured["data"]["assigned_approach"]["key"] == "passage_map"
    assert captured["data"]["question"]["passage"] == _rc_passage()


def test_both_prompt_versions_moved_because_the_inputs_did():
    """A grade from before these changes is not comparable with one from after."""
    from app.coaching import PROMPT_VERSION

    assert PROMPT_VERSION == "coaching-v4-passage-and-approach"
    assert ARTIFACT_PROMPT_VERSION.startswith("artifact-v2")
    assert "advisory" in ARTIFACT_PROMPT_VERSION
