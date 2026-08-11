"""Which approach a question is allowed to offer.

Every case below is a phrasing that was measured wrong against the live bank,
and each one is here so that it regresses loudly rather than quietly. The
failure mode this file exists to prevent is not a crash: it is a strategy card
that plainly does not fit the question in front of a student, which costs
trust in the whole feature and which nothing in the app would otherwise notice.

The last two tests run the matcher over all 6,886 questions in the repository
snapshot, because appropriateness is a property of the bank rather than of any
one question, and because a rule that removes false positives while dropping
true matches looks like a fix on a single card.
"""

from __future__ import annotations

import pytest

from app.models import Passage, Question
from app.strategies import STRATEGIES, _candidate_keys
from scripts.audit_strategy_matching import COHORTS, audit, load_bank


NEUTRAL_STIMULUS = (
    "A committee reviewed three reports before adopting the proposal. "
    "Two members abstained from the vote, and the minutes were published a week later."
)
CAUSAL_STIMULUS = (
    "Halford drinks far more coffee than Denby and reports more insomnia. "
    "The coffee habit in Halford must therefore be causing the insomnia."
)
CONDITIONAL_STIMULUS = (
    "If a manuscript is catalogued, then it has been conserved. "
    "Any manuscript that has been conserved is stored in the annex."
)
# The stimulus that made bare "all" and "no" a false positive: both words are
# present and neither one introduces a rule.
BARE_QUANTIFIER_STIMULUS = (
    "All the evidence gathered by the surveyors was published, and there is no doubt "
    "that the survey took longer than the council had budgeted for."
)

DEBATE_PASSAGE = (
    "Critics of the reform argue that it transferred costs onto tenants.\n\n"
    "Proponents reply that the same figures show a fall in vacancy.\n\n"
    "The disagreement turns on which baseline year is the fair comparison."
)


def lr(stem: str, *, stimulus: str = NEUTRAL_STIMULUS, question_type: str = "Logical Reasoning") -> Question:
    return Question(
        id="matching-lr",
        section="Logical Reasoning",
        question_type=question_type,
        difficulty=3,
        stimulus=stimulus,
        stem=stem,
        correct_answer="C",
    )


def rc(stem: str, *, passage_text: str = DEBATE_PASSAGE, question_type: str = "Reading Comprehension") -> Question:
    question = Question(
        id="matching-rc",
        section="Reading Comprehension",
        question_type=question_type,
        difficulty=3,
        stimulus=None,
        stem=stem,
        correct_answer="C",
    )
    question.passage = Passage(
        id="matching-passage",
        canonical_text=passage_text,
        passage_type="Reading Comprehension",
        comparative=False,
        review_status="published",
    )
    return question


# ---------------------------------------------------------------------------
# "Question the cause" and the substring inside "because"
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "stem",
    [
        # The stem the audit named. Its first step would be "Name cause and
        # effect" and there is no cause in it.
        "As a rebuttal of Giselle's argument, Antoine's response is ineffective because",
        "The proposal falls short of a complete solution to the problem it addresses because",
        "Victor's response does not succeed as a rebuttal of Lenore's argument because his response",
        "The evidence cited fails to establish the conclusion because",
    ],
)
def test_because_is_not_a_cause(stem):
    assert "causal_audit" not in _candidate_keys(lr(stem))


@pytest.mark.parametrize(
    "stem",
    [
        "Which one of the following, if true, most seriously weakens the argument?",
        "Which one of the following, if true, most strengthens the argument?",
        "Which one of the following, if true, best explains the difference described above?",
        "The reasoning in the argument is most vulnerable to criticism on the grounds that it",
    ],
)
def test_a_causal_claim_under_a_task_that_acts_on_it_still_matches(stem):
    assert "causal_audit" in _candidate_keys(lr(stem, stimulus=CAUSAL_STIMULUS))


def test_a_causal_conclusion_named_in_the_stem_matches_on_its_own():
    assert "causal_audit" in _candidate_keys(
        lr(
            "Which one of the following must be assumed in order to justify the conclusion "
            "that climatic variations cause a major difference in survival rates?"
        )
    )


def test_a_causal_stimulus_under_a_proof_task_does_not_match():
    """A causal claim is not a causal *question*.

    The approach asks what comparison would isolate the cause, which is not the
    work a must-be-true question wants.
    """
    keys = _candidate_keys(
        lr("If the statements above are true, which one of the following must also be true?", stimulus=CAUSAL_STIMULUS)
    )
    assert "causal_audit" not in keys
    assert "scope_precision" in keys


# ---------------------------------------------------------------------------
# "Follow the if-thens" and bare all / no
# ---------------------------------------------------------------------------


def test_bare_all_and_no_are_not_conditionals():
    """The worst of the mismatches, because of what its gate demands.

    This approach's gate requires the student to type two if-then rules that
    share a term and then pick the correct contrapositive. Offering it on a
    question with no rule in it does not merely suggest the wrong technique, it
    asks for a mechanic the question does not have.
    """
    lowered = BARE_QUANTIFIER_STIMULUS.lower()
    assert "all " in lowered and "no " in lowered
    assert "conditional_chain" not in _candidate_keys(
        lr(
            "If the statements above are true, which one of the following must also be true?",
            stimulus=BARE_QUANTIFIER_STIMULUS,
        )
    )


@pytest.mark.parametrize(
    "stimulus",
    [
        CONDITIONAL_STIMULUS,
        # A universal claim is a conditional, and this is the form that has to
        # keep matching once the bare words stop doing so.
        "All catalogued manuscripts are conserved. No conserved manuscript is stored off site.",
        "A manuscript is catalogued only if it has been conserved.",
        "Conservation is necessary for a manuscript to be catalogued.",
    ],
)
def test_a_real_rule_under_a_proof_task_matches(stimulus):
    assert "conditional_chain" in _candidate_keys(
        lr("If the statements above are true, which one of the following must also be true?", stimulus=stimulus)
    )


# ---------------------------------------------------------------------------
# "Negate the answer" and the standard necessary-assumption stems
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "stem",
    [
        # The LSAT's commonest phrasing of the question this approach is for.
        # It does not contain the literal "depends on", which is what the rule
        # used to look for, so 169 textbook questions never met it.
        "Which one of the following is an assumption on which the argument depends?",
        "Which one of the following is an assumption upon which the argument depends?",
        "Which one of the following is an assumption on which the argument is based?",
        "Which one of the following is an assumption upon which the author's conclusion "
        "concerning helmets for horseback riders depends?",
        "Which one of the following is an assumption required by the argument?",
        "Which one of the following is an assumption necessary to the argument?",
        "The argument depends on which one of the following assumptions?",
        "Which one of the following must be assumed in order for the conclusion to hold?",
        "The argument takes for granted which one of the following?",
        "Which one of the following is presupposed by the argument?",
    ],
)
def test_the_standard_necessary_assumption_stems_all_reach_the_negation_test(stem):
    assert "negation_test" in _candidate_keys(lr(stem, question_type="Assumption"))


def test_a_sufficient_assumption_is_sent_to_the_chain_instead():
    """Denying a merely sufficient assumption need not break the argument.

    So the negation test's own ruling — keep it only if the argument collapses
    — throws away the credited answer on this question. The chain is the
    approach that asks for the missing link.
    """
    question = lr(
        "Which one of the following, if assumed, allows the conclusion to be properly drawn?",
        stimulus=CONDITIONAL_STIMULUS,
        question_type="Assumption",
    )
    keys = _candidate_keys(question)
    assert "negation_test" not in keys
    assert "conditional_chain" in keys


def test_the_word_depends_in_a_role_question_is_not_an_assumption_question():
    """`question_type` is "Assumption" on this stem and the stem is not one.

    `seed._question_type` derives the label from "depends on" appearing
    anywhere, so a role question quoting a claim about what something depends
    on is filed as an assumption question. Reading the task rather than the
    label is what closes it.
    """
    question = lr(
        "The claim that pain perception depends only partly on physiology figures in the "
        "argument in which one of the following ways?",
        question_type="Assumption",
    )
    keys = _candidate_keys(question)
    assert "negation_test" not in keys
    assert "role_map" in keys


# ---------------------------------------------------------------------------
# "Name the bad move" and the flaw stems that never say flaw
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "stem",
    [
        "The reasoning in the politician's argument is most vulnerable to the criticism that",
        "The argument is most vulnerable to which one of the following criticisms?",
        "Which one of the following most accurately describes an error in reasoning in the passage?",
        "A reasoning error in the argument is that the argument",
        "A major weakness of the argument is that it",
        "The argument's reasoning is questionable because the argument fails to rule out the possibility that",
        "The reasoning in the argument is fallacious because the argument",
        "The reasoning in the argument is not sound because it fails to establish that",
    ],
)
def test_flaw_questions_that_never_use_the_word_flaw(stem):
    assert "flaw_abstraction" in _candidate_keys(lr(stem))


# ---------------------------------------------------------------------------
# "Track who thinks what" comes from the question, not the passage
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "stem",
    [
        "The primary purpose of the passage is to",
        "According to the passage, the annex was built in which year?",
        "The passage most strongly supports which one of the following statements about vacancy rates?",
    ],
)
def test_a_word_in_the_passage_does_not_make_a_detail_question_about_viewpoints(stem):
    """The passage stages a debate and these questions do not ask about it.

    Triggering on "critics" or "proponents" in the passage put a strategy about
    competing viewpoints on 344 plain detail questions, every one of them
    printed with a passage that happened to use the word.
    """
    assert "critics" in DEBATE_PASSAGE.lower() and "proponents" in DEBATE_PASSAGE.lower()
    assert "viewpoint_ledger" not in _candidate_keys(rc(stem))


@pytest.mark.parametrize(
    "stem",
    [
        "Which one of the following most accurately characterizes the author's attitude toward the reform?",
        "The author would be most likely to agree with which one of the following statements?",
        "With which one of the following would the proponents of the reform be most likely to disagree?",
        "Which one of the following best describes the author's opinion of the reform?",
        "According to the passage, critics of the reform maintain that",
    ],
)
def test_a_question_about_somebody_s_position_does_match(stem):
    assert "viewpoint_ledger" in _candidate_keys(rc(stem))


def test_an_attributed_claim_needs_a_passage_that_stages_a_debate():
    """One position is not a ledger, and the gate would refuse it.

    `viewpoint_ledger` requires two rows naming parties the passage itself
    names, so an attributed claim only earns the approach where there is more
    than one party to attribute anything to.
    """
    stem = "According to the passage, Posner argues that legal analysis is not useful because"
    single = (
        "The annex was completed in 1974 and holds the conserved manuscripts.\n\n"
        "Posner argues that the collection should be catalogued by provenance."
    )
    assert "viewpoint_ledger" in _candidate_keys(rc(stem))
    assert "viewpoint_ledger" not in _candidate_keys(rc(stem, passage_text=single))


# ---------------------------------------------------------------------------
# The other two substring faults of the same family
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "stem",
    [
        "The author suggests that the practice would remain profitable because",
        "The passage indicates that the annex is mainly used for which purpose?",
        "The author's argument concerns which domain of practice?",
    ],
)
def test_main_does_not_match_remain_mainly_or_domain(stem):
    assert "main_point_synthesis" not in _candidate_keys(rc(stem))


@pytest.mark.parametrize(
    "stem,expected",
    [
        ("Which one of the following conclusions is most strongly supported by the statements above?", False),
        ("Which one of the following most accurately expresses the conclusion of the argument?", True),
        ("Which one of the following most accurately expresses the conclusion of the ethicist's argument?", True),
        ("The main conclusion of the argument is that", True),
    ],
)
def test_the_word_conclusion_is_not_a_conclusion_question(stem, expected):
    assert ("role_map" in _candidate_keys(lr(stem))) is expected


# ---------------------------------------------------------------------------
# The whole bank
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def bank_audit():
    return audit(load_bank())


def test_every_question_in_the_bank_has_an_in_section_approach(bank_audit):
    """The three properties the matching rewrite was not allowed to cost.

    Coverage, because an empty candidate list is a question with no card and a
    fallback nobody designed. The section guarantee, because a Reading
    Comprehension approach on a Logical Reasoning question is a card asking for
    a passage that is not there. And the comparative path, which was dark for
    the whole life of the feature before it was fixed and is the one approach
    that cannot be reached any other way.
    """
    assert bank_audit["totals"]["all"] == 6886
    assert bank_audit["empty_results"] == 0
    assert bank_audit["min_candidates"] >= 2
    assert bank_audit["section_violations"] == 0
    assert bank_audit["comparative_questions"] == 200
    assert bank_audit["comparative_passages"] == 32
    # Not a guarantee, a measurement: before the stem was read, 44.8% of the
    # bank was eligible for exactly two approaches and nothing else, so a
    # student practising a lot met the same two generic cards constantly.
    assert bank_audit["exactly_two_share"] < 40


def test_no_cohort_of_named_phrasings_regresses(bank_audit):
    """Each cohort is a phrasing the audit measured, and what it should do.

    `expect="none"` cohorts were the false positives; `expect="all"` cohorts
    were the misses. 1,165 questions across the twelve were matched wrongly
    before this was rewritten. The bars below are the measured residue plus a
    little room, and every one of those residual questions was read by hand:
    they are the cohort definitions' own edges, not mismatched cards.
    """
    allowed = {
        # A "fallacious because" flaw question whose stimulus does make a causal
        # claim, in the form "the reason why". The cohort's causal reading is
        # narrower than the matcher's; the match itself is right.
        "because, no cause anywhere": 1,
        # Attributions the cohort's exclusion list does not name: "political
        # theorists attribute", "the author concedes", "suggests sympathy with".
        "RC detail on a passage naming parties": 3,
        # "The art critic's response to the curator would provide the strongest
        # support for which one of the following conclusions?" — two speakers,
        # so labelling what each sentence does is the right approach.
        "the word conclusion, no conclusion task": 1,
    }
    for cohort in COHORTS:
        entry = bank_audit["cohorts"][cohort["name"]]
        assert entry["size"] > 0, f"{cohort['name']} matches nothing; the cohort has gone stale"
        assert entry["wrong"] <= allowed.get(cohort["name"], 0), (
            f"{cohort['name']}: {entry['wrong']} of {entry['size']} questions "
            f"{'still' if cohort['expect'] == 'none' else 'do not'} offer "
            f"{cohort['strategy']}. Run backend/scripts/audit_strategy_matching.py."
        )


def test_every_catalogue_approach_is_reachable(bank_audit):
    """An approach nobody can be offered is a card in a drawer.

    `comparative_matrix` sat in the catalogue with a gate built for it and was
    offered to nobody for the whole life of the feature, because the rule that
    reached it asked the metadata a question whose answer was always no.
    """
    for key in STRATEGIES:
        assert bank_audit["per_strategy"][key]["count"] > 0, f"{key} is unreachable"
