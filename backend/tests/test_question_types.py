"""Question type inference, pinned to the phrasings the old rules were losing.

Every stem in `LOST_TO_THE_PLACEHOLDER` is a real one from
`backend/data/question_bank`, and every one of them used to come out of ingest
carrying its own section's name as its type. They are pinned individually
rather than as a coverage percentage because a percentage cannot say *which*
question stopped being routed when a rule is narrowed later.

The second half of the file is the other discipline: what the rules must *not*
claim. Most of these are pairs — two stems a few words apart that belong to
different families — because that is where every failure in this module has
been. The rules did not miss exotic question types; they missed word endings
and word order.
"""

from __future__ import annotations

import pytest

from app.question_types import (
    SOURCE_INFERRED,
    SOURCE_PLACEHOLDER,
    classify,
    question_type,
)


# (stem, expected type). Each one produced "Logical Reasoning" or "Reading
# Comprehension" before this module existed.
LOST_TO_THE_PLACEHOLDER = [
    # The largest single bucket: 127 stems whose verb was in the active voice
    # when the rule expected the passive.
    (
        "Logical Reasoning",
        "The statements above, if true, most strongly support which one of the following?",
        "Inference",
    ),
    (
        "Logical Reasoning",
        "Which one of the following can be inferred from the passage?",
        "Inference",
    ),
    # Word order, not vocabulary.
    (
        "Logical Reasoning",
        "The argument is most vulnerable to which one of the following criticisms?",
        "Flaw",
    ),
    (
        "Logical Reasoning",
        "Which one of the following most clearly identifies an error in the author's reasoning?",
        "Flaw",
    ),
    (
        "Logical Reasoning",
        "The pattern of reasoning in the argument above is most similar to that in which one of the following?",
        "Parallel Reasoning",
    ),
    # An inflection: the rule knew "assumption" and the bank writes "assumes".
    ("Logical Reasoning", "The argument assumes which one of the following?", "Assumption"),
    (
        "Logical Reasoning",
        "In taking the position outlined, the author presupposes which one of the following?",
        "Assumption",
    ),
    # Whole families with no rule at all.
    (
        "Logical Reasoning",
        "The conclusion of the argument is properly drawn if which one of the following is assumed?",
        "Sufficient Assumption",
    ),
    (
        "Logical Reasoning",
        "Alia and Martha disagree on whether",
        "Point at Issue",
    ),
    (
        "Logical Reasoning",
        "Which one of the following most logically completes the argument?",
        "Complete the Argument",
    ),
    (
        "Logical Reasoning",
        "Which one of the following would it be most useful to know in evaluating the argument?",
        "Evaluate the Argument",
    ),
    (
        "Logical Reasoning",
        "Which one of the following, if true, contributes most to an explanation of the apparent discrepancy?",
        "Resolve the Paradox",
    ),
    (
        "Logical Reasoning",
        "Which one of the following most accurately expresses the conclusion drawn in the argument?",
        "Main Conclusion",
    ),
    (
        "Logical Reasoning",
        "Which one of the following, if true, would most seriously undermine the author's conclusion?",
        "Weaken",
    ),
    (
        "Logical Reasoning",
        "A questionable technique used in the argument is to",
        "Flaw",
    ),
    # 93 Reading Comprehension stems lost to one missing synonym.
    ("Reading Comprehension", "The primary purpose of the passage is to", "Main Point"),
    (
        "Reading Comprehension",
        "Which one of the following best describes the organization of the passage?",
        "Organization",
    ),
    (
        "Reading Comprehension",
        "The author of the passage would be most likely to agree with which one of the following?",
        "Author's Perspective",
    ),
    (
        "Reading Comprehension",
        "According to the passage, African languages had a notable influence on",
        "Detail",
    ),
    (
        "Reading Comprehension",
        "The author quotes Fruton (lines 62-64) primarily in order to",
        "Function",
    ),
    (
        "Reading Comprehension",
        "Both passages are concerned with answering which one of the following questions?",
        "Passage Relationship",
    ),
    (
        "Reading Comprehension",
        "In the context of the passage, the word \"cost\" in line 63 refers to the",
        "Meaning in Context",
    ),
    (
        "Reading Comprehension",
        "Which one of the following, if true, would most weaken the author's argument?",
        "Weaken",
    ),
]


@pytest.mark.parametrize(
    "section,stem,expected",
    LOST_TO_THE_PLACEHOLDER,
    ids=[f"{section[:2]}:{stem[:44]}" for section, stem, _ in LOST_TO_THE_PLACEHOLDER],
)
def test_a_stem_the_old_rules_left_untyped_now_has_a_type(section, stem, expected):
    value, source, rule = classify(section, stem)
    assert (value, source) == (expected, SOURCE_INFERRED)
    assert rule, "an inferred type must name the rule that produced it"


# Pairs that sit a few words apart and belong to different families. Each one
# is a mistake a widening would make, and the reason the ordering in
# `question_types` is what it is.
NEIGHBOURS = [
    # Sufficient before necessary: both contain a word about assuming.
    (
        "Logical Reasoning",
        "The conclusion follows logically if which one of the following is assumed?",
        "Sufficient Assumption",
        "The argument requires assuming which one of the following?",
        "Assumption",
    ),
    # A verb of expression before a conclusion, or it is a weaken question.
    (
        "Logical Reasoning",
        "Which one of the following most accurately states the conclusion of the argument above?",
        "Main Conclusion",
        "Which one of the following, if true, casts the most doubt on the conclusion drawn above?",
        "Weaken",
    ),
    # Both directions of the same verb.
    (
        "Logical Reasoning",
        "Which one of the following, if true, most supports the conclusion above?",
        "Strengthen",
        "The information above most strongly supports which one of the following?",
        "Inference",
    ),
    # Matching an error is a matching question, not a naming one.
    (
        "Logical Reasoning",
        "Which one of the following arguments contains a flaw most similar to the one above?",
        "Parallel Flaw",
        "Which one of the following most accurately describes a flaw in the argument?",
        "Flaw",
    ),
    # Scope: one paragraph or the whole passage.
    (
        "Reading Comprehension",
        "The primary purpose of the third paragraph is to",
        "Function",
        "The primary purpose of the passage is to",
        "Main Point",
    ),
    # An opinion verb, or a question about what a sentence is doing.
    (
        "Reading Comprehension",
        "The author would be most likely to agree with which one of the following statements?",
        "Author's Perspective",
        "The author mentions the reactions of northern writers in order to illustrate",
        "Function",
    ),
]


@pytest.mark.parametrize(
    "section,first_stem,first_type,second_stem,second_type",
    NEIGHBOURS,
    ids=[f"{first[:40]}" for _s, first, *_rest in NEIGHBOURS],
)
def test_two_stems_a_few_words_apart_are_kept_apart(
    section, first_stem, first_type, second_stem, second_type
):
    assert question_type(section, first_stem) == first_type
    assert question_type(section, second_stem) == second_type


def test_a_stem_that_announces_nothing_is_a_placeholder_and_says_so():
    """The fallback is unchanged; what is new is that the row admits it.

    Every consumer of `question_type` already handles the section name, so
    swapping in a new sentinel would have broken all of them to say the same
    thing. The provenance column is what makes the unknowns countable.
    """
    value, source, rule = classify("Logical Reasoning", "In the passage, the author")
    assert value == "Logical Reasoning"
    assert source == SOURCE_PLACEHOLDER
    assert rule is None


def test_a_bank_that_labels_its_own_questions_is_believed():
    value, source, rule = classify(
        "Reading Comprehension", "The primary purpose of the passage is to", authored="Main Point"
    )
    assert (value, source, rule) == ("Main Point", "authored", None)
    # A "label" that is only the section name is not a label.
    assert classify(
        "Reading Comprehension", "According to the passage, x", authored="Reading Comprehension"
    )[1] == SOURCE_INFERRED


def test_ingest_records_the_type_and_where_it_came_from(tmp_path):
    """The column is written by the path that writes the question, or it is a
    field nobody maintains. Exercised through `_upsert_row`, the real ingest."""
    from app import create_app
    from app.extensions import db
    from app.models import Question
    from app.seed import _upsert_row

    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "AUTO_SEED": False,
            "TFY_URL": "",
            "TFY_API_KEY": "",
        }
    )
    with application.app_context():
        rows = {}
        for index, stem in enumerate(
            (
                "The argument assumes which one of the following?",
                "In the passage, the author",
            )
        ):
            _upsert_row(
                {
                    "context": "A stimulus long enough to look like one.",
                    "id_string": f"probe-{index}",
                    "answers": ["a", "b", "c", "d", "e"],
                    "label": 2,
                    "question": stem,
                },
                "tasksource/lsat-lr",
                "Logical Reasoning",
                "train",
                {},
                rows,
                {},
            )
        db.session.commit()

        typed = db.session.get(Question, "hf-lsat-lr:probe-0")
        untyped = db.session.get(Question, "hf-lsat-lr:probe-1")
        assert (typed.question_type, typed.question_type_source) == ("Assumption", SOURCE_INFERRED)
        assert (untyped.question_type, untyped.question_type_source) == (
            "Logical Reasoning",
            SOURCE_PLACEHOLDER,
        )
