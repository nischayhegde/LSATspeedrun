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
        # Plurals, which are how the LSAT actually asks this. Reading "role" and
        # "technique" in the singular dropped 70 genuine method questions.
        ("The statement that food capacity has grown plays which one of the following roles in the argument?", True),
        ("In countering the original conclusion the reasoning above uses which one of the following techniques?", True),
        (
            "The rejection by the meteorologist of the statistician's conclusion employs which one of the "
            "following techniques of argumentation?",
            True,
        ),
    ],
)
def test_the_word_conclusion_is_not_a_conclusion_question(stem, expected):
    assert ("role_map" in _candidate_keys(lr(stem))) is expected


# ---------------------------------------------------------------------------
# Verbs of consequence in a stem are usually about the reasoning
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "stem",
    [
        # "Lead to" and "leading to" in a stem are about where an argument goes.
        "The argument is structured to lead to which one of the following conclusions?",
        "Which one of the following indicates an error in the reasoning leading to the prediction above?",
        # And a stem's "reason for" is usually the author's, not the world's.
        "The author's reason for mentioning the second survey is to",
    ],
)
def test_an_argument_that_leads_somewhere_is_not_a_causal_question(stem):
    assert "causal_audit" not in _candidate_keys(lr(stem))


def test_point_at_issue_is_not_a_strengthen_question():
    """"Provides the most support for the claim that they disagree" is not support.

    Reading it as one made a causal stimulus enough to offer the causal
    approach on a question about what two speakers differ over.
    """
    keys = _candidate_keys(
        lr(
            "The editors' dialogue provides the most support for the claim that they disagree "
            "with each other about whether the ban was effective",
            stimulus=CAUSAL_STIMULUS,
        )
    )
    assert "causal_audit" not in keys


def test_support_for_the_argument_itself_is_still_a_strengthen_question():
    assert "causal_audit" in _candidate_keys(
        lr(
            "Which one of the following, if true, provides the most support for the argument?",
            stimulus=CAUSAL_STIMULUS,
        )
    )


@pytest.mark.parametrize(
    "stem",
    [
        "The physics professor's conclusion follows logically if which one of the following is assumed?",
        "Which one of the following is an assumption that would permit the conclusion above to be properly drawn?",
        "The argument's conclusion is properly drawn if which one of the following is assumed?",
    ],
)
def test_supplying_the_missing_premise_is_not_proving_an_answer(stem):
    """These stems say "follows logically", and they are not inference questions.

    The scope-and-force procedure is written for proving an answer from the
    stimulus. A question that asks for the premise which would make the
    argument work wants the chain instead.
    """
    keys = _candidate_keys(lr(stem, stimulus=CONDITIONAL_STIMULUS))
    assert "negation_test" not in keys
    assert "scope_precision" not in keys
    assert "conditional_chain" in keys


# ---------------------------------------------------------------------------
# Which way the support runs
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "stem",
    [
        # The stimulus does the supporting and the answer is what gets
        # supported: an inference question, and the scope-and-force procedure is
        # the one that fits it.
        "The statements above, if true, most strongly support which one of the following?",
        "The information above provides the most support for which one of the following conclusions?",
        "Which one of the following is most strongly supported by the information above?",
        "The passage provides the most support for which one of the following?",
        "If the statements above are true, they provide the most support for which one of the following?",
        "The statements above, if true, support the view that",
        "Which one of the following can be logically concluded from the information above?",
        "Which one of the following best completes the argument?",
    ],
)
def test_a_stimulus_that_supports_the_answer_is_an_inference_question(stem):
    keys = _candidate_keys(lr(stem, stimulus=CAUSAL_STIMULUS))
    assert "scope_precision" in keys
    # And it is not a causal question, however causal the stimulus is: nothing
    # here asks whether the cause is the cause.
    assert "causal_audit" not in keys


@pytest.mark.parametrize(
    "stem",
    [
        # The answer does the supporting: a strengthen question, and on a causal
        # stimulus the causal approach is exactly right.
        "Which one of the following, if true, most strongly supports the industry representative's "
        "position against the environmentalist's position?",
        "Which one of the following, if true, most supports the scientists' hypothesis?",
        "Which one of the following, if true, provides the strongest additional support for the conclusion above?",
    ],
)
def test_an_answer_that_supports_the_stimulus_is_a_strengthen_question(stem):
    keys = _candidate_keys(lr(stem, stimulus=CAUSAL_STIMULUS))
    assert "causal_audit" in keys
    # "Match every quantifier to what the stimulus proves" is the wrong
    # instruction on a question whose answer is new information.
    assert "scope_precision" not in keys


@pytest.mark.parametrize(
    "stem",
    [
        # A strengthen question whose answers are principles, and one whose four
        # wrong answers all strengthen. Both are strengthen questions, and both
        # also reward force and scope discipline — a principle has to be stated
        # narrowly enough to apply, and four answers have to be checked against
        # what the stimulus actually says. So they carry the proof reading too,
        # for a reason the plain strengthen stems above do not have.
        "Which one of the following principles, if established, would provide the strongest support "
        "for the town councillor's argument?",
        "Each of the following, if true, would lend support to the climatologists' hypothesis EXCEPT:",
    ],
)
def test_a_strengthen_question_can_still_want_the_wording_watched(stem):
    keys = _candidate_keys(lr(stem, stimulus=CAUSAL_STIMULUS))
    assert "causal_audit" in keys
    assert "scope_precision" in keys


def test_weakening_the_support_is_still_a_weaken_question():
    """Word order says the answer supports, and the verb says it does not.

    "Most seriously weakens the support for the conclusion" puts the answer
    choices on the supporting side of the sentence, so the word-order rule on
    its own would read this as a strengthen question. The stem saying "weakens"
    settles it first.
    """
    keys = _candidate_keys(
        lr(
            "Which one of the following, if true, most seriously weakens the support for the conclusion above?",
            stimulus=CAUSAL_STIMULUS,
        )
    )
    assert "causal_audit" in keys
    assert "scope_precision" not in keys


# ---------------------------------------------------------------------------
# The rest of each family the audit named, in the phrasings the bank uses
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "stem",
    [
        # No necessity word anywhere, and still the standard necessary
        # assumption question. 20 of these were reaching nothing.
        "The argument assumes which one of the following?",
        "The reasoning in the passage assumes which one of the following?",
        "Which one of the following is assumed in the passage?",
        "Which one of the following is assumed by the mayor's argument?",
        "For the argument to be logically correct, it must make which one of the following assumptions?",
    ],
)
def test_a_bare_assumption_stem_is_a_necessary_assumption_stem(stem):
    assert "negation_test" in _candidate_keys(lr(stem))


@pytest.mark.parametrize(
    "stem",
    [
        # "Casts the most doubt" and "cast the most serious doubt". Only the
        # adjacent "casts doubt" was being read.
        "Which one of the following, if true, casts the most doubt on the author's hypothesis?",
        "Which one of the following, if true, would cast the most serious doubt on the prediction above?",
        "Which one of the following, if true, would tend to invalidate the use of the ratings?",
        "Which one of the following, if true, most strongly counters the city official's response?",
        "Which one of the following rejoinders, if true, most directly counters the legislator's objection?",
    ],
)
def test_the_weaken_family_beyond_the_word_weaken(stem):
    assert "causal_audit" in _candidate_keys(lr(stem, stimulus=CAUSAL_STIMULUS))


@pytest.mark.parametrize(
    "stem",
    [
        # "An error in the reasoning" and "an error in the author's reasoning":
        # the same question as "an error in reasoning", with a word in between.
        "Which one of the following most clearly identifies an error in the author's reasoning?",
        "Which one of the following indicates an error in the reasoning in the passage?",
        "Which one of the following most accurately describes an error in the argument's reasoning?",
        "Which one of the following identifies a problem with the programming director's decision process?",
    ],
)
def test_an_error_in_the_reasoning_is_a_flaw_question(stem):
    assert "flaw_abstraction" in _candidate_keys(lr(stem))


@pytest.mark.parametrize(
    "stem,expected",
    [
        # "Makes which one of the following assumptions" is a necessary
        # assumption question. "Makes which one of the following errors of
        # reasoning" is the same shape and is a flaw question, which is why the
        # noun is spelled out rather than matched loosely.
        ("The argument above makes which one of the following assumptions?", True),
        ("For the argument to be logically correct, it must make which one of the following assumptions?", True),
        ("Anson bases his conclusion about Dr. Ladlow on which one of the following?", True),
        ("The argument makes which one of the following errors of reasoning?", False),
        ("The reviewer makes which one of the following criticisms of a claim in the book?", False),
    ],
)
def test_what_an_argument_makes_is_not_always_an_assumption(stem, expected):
    keys = _candidate_keys(lr(stem))
    assert ("negation_test" in keys) is expected
    if not expected:
        assert "flaw_abstraction" in keys


@pytest.mark.parametrize(
    "stem",
    [
        # What somebody did, with no verb of method in the stem at all.
        "In the passage, the author does which one of the following?",
        "Gregory does which one of the following in responding to Sasha's argument?",
        "Which one of the following accurately describes something Senator Strongwood does in advancing his argument?",
        "Maria objects to Pedro's argument by",
    ],
)
def test_asking_what_somebody_did_is_a_method_question(stem):
    assert "role_map" in _candidate_keys(lr(stem))


@pytest.mark.parametrize(
    "stem,expected",
    [
        ("If the statements above are true, which one of the following must on the basis of them also be true?", True),
        ("Which one of the following can be concluded from the passage?", True),
        ("Which one of the following conflicts with information in the passage?", True),
        ("Which one of the following statements is consistent with the biologist's claim but not the politician's?", True),
        # An explain question that happens to use the word, which is why the
        # copula is required.
        (
            "Which one of the following, if true, explains the surprising discovery in a way most "
            "consistent with the scientists' hypothesis?",
            False,
        ),
    ],
)
def test_squaring_an_answer_with_the_stimulus_is_an_inference_question(stem, expected):
    assert ("scope_precision" in _candidate_keys(lr(stem))) is expected


@pytest.mark.parametrize(
    "stem,expected",
    [
        ("Smith responds to Jones by", True),
        ("Which one of the following most accurately characterizes David's response to Alice's statement?", True),
        ("Dr. Nash responds to Dr. Godfrey's argument by doing which one of the following?", True),
        ("The critic's response to the historian is flawed because it", True),
        # A reply named only to say whose statements to reason from. The question
        # is what follows from the reply, not how the reply was made.
        (
            "The art critic's response to the curator would provide the strongest support for "
            "which one of the following conclusions?",
            False,
        ),
        ("Stephen's response to Zachary, if true, most strongly supports which one of the following?", False),
    ],
)
def test_a_reply_is_a_method_question_unless_the_stem_reasons_from_it(stem, expected):
    keys = _candidate_keys(lr(stem))
    assert ("role_map" in keys) is expected
    if not expected:
        assert "scope_precision" in keys


def test_countering_somebody_by_doing_something_is_a_method_question():
    """The one place "counters" is not an attack on the argument.

    A stem trailing off in "by" is asking which move was made, so the answer
    describes a technique. Read as a weaken question it would have offered a
    causal audit on the strength of the stimulus alone.
    """
    keys = _candidate_keys(lr("The pilot counters the conservationist by", stimulus=CAUSAL_STIMULUS))
    assert "role_map" in keys
    assert "causal_audit" not in keys


@pytest.mark.parametrize(
    "stem",
    [
        # Plurals, again, and the same fault as "role" and "technique".
        "Which one of the following propositions is best illustrated by the example presented in the passage?",
        "The situation described above most closely conforms to which one of the following generalizations?",
        "The passage best illustrates which one of the following statements about science?",
    ],
)
def test_a_general_statement_is_a_principle_question(stem):
    assert "scope_precision" in _candidate_keys(lr(stem))


# ---------------------------------------------------------------------------
# Reading Comprehension: the passage's own furniture, and the whole passage
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "stem,expected",
    [
        ("Which one of the following best states the author's main conclusion in the passage?", True),
        ("Which one of the following titles most completely and accurately expresses the contents of the passage?", True),
        ("Which one of the following best states the central idea of the passage?", True),
        ("According to the passage, the annex was built in which year?", False),
    ],
)
def test_the_whole_passage_questions_reach_the_synthesis(stem, expected):
    assert ("main_point_synthesis" in _candidate_keys(rc(stem))) is expected


@pytest.mark.parametrize(
    "stem,expected",
    [
        ("The author mentions the number of ice ages in the third paragraph most probably in order to", True),
        ("Which one of the following most accurately states the function of the third paragraph?", True),
        # A role in the subject matter is not a role in the passage.
        (
            "Which one of the following, if true, would most weaken the author's argument concerning "
            "the role that Wheatley played in the evolution of the form?",
            False,
        ),
    ],
)
def test_a_role_in_the_passage_is_not_a_role_in_the_subject_matter(stem, expected):
    assert ("paragraph_function" in _candidate_keys(rc(stem))) is expected


# ---------------------------------------------------------------------------
# The families that carried no task at all
# ---------------------------------------------------------------------------
#
# 246 Logical Reasoning questions named no task the matcher could read, so they
# saw only the two unconditional approaches. The stems below are the phrasings
# that put them there, nearly all of them a pattern requiring two words to be
# adjacent when the bank routinely separates them, or requiring one inflection
# of a verb when the bank uses another.


@pytest.mark.parametrize(
    "stem",
    [
        "The point at issue between Emile and Sabina is whether",
        "Alia and Martha disagree on whether",
        "Which one of the following is a point at issue between Harris and Vogel?",
        "On the basis of their statements, Mario and Lucy are committed to disagreeing about the truth "
        "of which one of the following?",
        "The issue in dispute between Powell and Freeman is the",
        "A point on which Roxanne's and Salvador's views differ is whether",
        "In the dispute the issue between the socialist and the conservative can most accurately be "
        "described as whether",
    ],
)
def test_a_point_at_issue_question_gets_the_scope_reading(stem):
    """The largest group that had no card at all.

    The credited answer is a statement one speaker affirms and the other denies,
    and the standard wrong answer overstates the difference or reaches past what
    one of them actually said, which is what this approach's "reject stronger or
    broader claims" is for.
    """
    keys = _candidate_keys(lr(stem))
    assert "scope_precision" in keys
    # Still not a strengthen question, which is the older guarantee.
    assert "causal_audit" not in _candidate_keys(lr(stem, stimulus=CAUSAL_STIMULUS))


def test_a_disputed_painting_is_not_a_disagreement():
    """The word, in the service of the subject matter rather than a dispute."""
    keys = _candidate_keys(
        lr(
            "Which one of the following, if true, most strongly supports the position that the "
            "traditional attribution of a disputed painting should not have special weight?",
            stimulus=CAUSAL_STIMULUS,
        )
    )
    assert "causal_audit" in keys
    assert "scope_precision" not in keys


@pytest.mark.parametrize(
    "stem",
    [
        # The words separated, which is how the bank writes it.
        "Which one of the following, if true, most seriously calls the conclusion above into question?",
        "The prediction that ends the passage would be most seriously called into question if it were "
        "true that in the last few years",
        "Which one of the following, if true, could contribute most to a refutation of the argument?",
        "Which one of the following, if true, argues most strongly against the passage's recommendation?",
        "Which one of the following, if true, provides the strongest basis for countering Dr. Ruiz' argument?",
        "The information above, if accurate, can best be used as evidence against which one of the "
        "following hypotheses?",
        "Which one of the following, if true, most strongly indicates that the asteroid-impact theory "
        "is at least incomplete, if not false?",
    ],
)
def test_the_rest_of_the_weaken_vocabulary(stem):
    assert "causal_audit" in _candidate_keys(lr(stem, stimulus=CAUSAL_STIMULUS))


@pytest.mark.parametrize(
    "stem",
    [
        # "Errors" before "reasoning" rather than after it.
        "The senator's reasoning contains which one of the following errors?",
        "The reasoning in the editorial is in error because",
        "The argument is faulty because it ignores the possibility that",
        "The inference drawn above is unwarranted because",
        "The conclusion is incorrectly drawn from the information given because this information "
        "does not include",
        "The proposal mentioned above falls short of offering a complete solution to the problem it "
        "addresses because",
        # What one speaker took another to mean, where the answer is the misreading.
        "Mark's response shows that he interpreted Terry's remarks to mean that",
        "Judith's response shows that she interprets Harry's statement to imply that",
    ],
)
def test_the_rest_of_the_flaw_vocabulary(stem):
    assert "flaw_abstraction" in _candidate_keys(lr(stem))


@pytest.mark.parametrize(
    "stem",
    [
        # The adverb before the verb rather than after it.
        "Which one of the following logically follows from the statements above?",
        # Three words between the modal and the participle.
        "Which one of the following can most reasonably be concluded on the basis of the information above?",
        "If the statements above are both true, which one of the following conclusions can be drawn "
        "on the basis of them?",
        "Which one of the following statements is an inference that can be drawn from the information "
        "given in the passage?",
        "Which one of the following conclusions can be validly drawn from the passage?",
        "Which one of the following is strictly implied by the above?",
        "If the statements above are true, which one of the following would also have to be true?",
        "A consequence of the view above is that",
        "The observations above provide most evidence for the conclusion that",
        # Completing the passage, which is a must-be-true question about its end.
        "Which one of the following most logically completes the argument?",
        "Which one of the following provides a logical completion to the passage above?",
        "Which one of the following, if true, is the most logical completion of the paragraph above?",
        "Which one of the following completes the passage most logically?",
        "Which one of the following statements would most reasonably complete the argument?",
    ],
)
def test_the_rest_of_the_inference_vocabulary(stem):
    assert "scope_precision" in _candidate_keys(lr(stem))


def test_falling_short_of_a_complete_solution_is_not_a_completion_question():
    """The guard on the completion patterns.

    "Complete" is a common enough word that reading it alone would make a flaw
    question about an incomplete proposal into a question about the passage's
    last sentence, so the adverb is required.
    """
    keys = _candidate_keys(
        lr(
            "The proposal mentioned above falls short of offering a complete solution to the problem "
            "it addresses because"
        )
    )
    assert "flaw_abstraction" in keys
    assert "scope_precision" not in keys


@pytest.mark.parametrize(
    "stem,expected",
    [
        # A commitment the speaker's own statements force on them.
        ("The statements above logically commit the politician to which one of the following conclusions?", True),
        ("John's statements commit him to which one of the following positions?", True),
        # The same words asking what two speakers differ on. This is a
        # point-at-issue question, and reading it as an inference would put the
        # if-then chain on a stimulus nobody is asked to chain.
        ("McBride's and Leggett's statements commit them to disagreeing about the truth of which one "
         "of the following?", False),
    ],
)
def test_a_commitment_is_an_inference_unless_it_is_a_disagreement(stem, expected):
    keys = _candidate_keys(lr(stem, stimulus=CONDITIONAL_STIMULUS))
    assert ("conditional_chain" in keys) is expected
    # Either way the scope reading is offered, so neither loses its card.
    assert "scope_precision" in keys


@pytest.mark.parametrize(
    "stem",
    [
        # "Rely", not only "relies".
        "Upon which one of the following assumptions does the author rely in the passage?",
        "On which one of the following assumptions does the argument rely?",
        "Which one of the following is an assumption that the argument makes?",
        "The argument makes the assumption that",
        # A possessive name where the pattern listed only pronouns.
        "Which one of the following is an assumption made by Ariel's argument?",
        "Which one of the following must the television station assume in order to conclude that the "
        "plan will meet its stated purpose?",
        "The industry representative's argument will not provide an effective answer to the consumer "
        "activist's claim unless which one of the following is true?",
    ],
)
def test_the_rest_of_the_necessary_assumption_vocabulary(stem):
    assert "negation_test" in _candidate_keys(lr(stem))


def test_an_assumption_that_would_make_the_conclusion_logical_is_sufficient():
    """Enough, not needed, so the negation test is the wrong tool.

    Denying a merely sufficient assumption need not break the argument, and the
    procedure's own ruling — keep it only if the argument collapses — would
    throw the credited answer away.
    """
    keys = _candidate_keys(
        lr(
            "Which one of the following is an assumption that would make the conclusion in the "
            "passage a logical one?",
            stimulus=CONDITIONAL_STIMULUS,
        )
    )
    assert "negation_test" not in keys
    assert "conditional_chain" in keys


@pytest.mark.parametrize(
    "stem",
    [
        # "The argument's conclusion", where the pattern wanted "the conclusion".
        "Which one of the following most accurately expresses the argument's conclusion?",
        "Which one of the following best expresses the point of the argument?",
        "The argument is structured to lead to which one of the following conclusions?",
        "The argument leads to the conclusion that",
        "The point made by Anita's statements is most accurately expressed by which one of the following?",
        # A statement's function where it sits, which "function of" alone missed.
        "The claim about private corporations serves which one of the following functions in the argument?",
        "The statistics cited function in the argument to",
        "The argument derives its conclusion by",
        "The discussion about the two Portuguese officers advances the argument by",
        "How is Judy's response related to John's argument?",
        "Which one of the following most accurately describes the relationship between Jane's argument "
        "and Mark's argument?",
        "Which one of the following comparisons is utilized by the argument?",
        "The argument seeks to do which one of the following?",
    ],
)
def test_the_rest_of_the_role_and_conclusion_vocabulary(stem):
    assert "role_map" in _candidate_keys(lr(stem))


@pytest.mark.parametrize(
    "stem,expected",
    [
        # The gerund, which is the thing being asked about.
        ("The point of the scientist's mentioning astrology in the argument is to present", True),
        # The participle, which only points back at the stimulus.
        ("Each of the following, if true, contributes to an explanation of the increase mentioned "
         "above EXCEPT:", False),
    ],
)
def test_mentioning_is_a_role_question_and_mentioned_above_is_a_pointer(stem, expected):
    assert ("role_map" in _candidate_keys(lr(stem))) is expected


def test_describing_a_flaw_is_not_describing_a_role():
    keys = _candidate_keys(lr("Which one of the following most accurately describes a flaw in the "
                             "argument's reasoning?"))
    assert "flaw_abstraction" in keys
    assert "role_map" not in keys


@pytest.mark.parametrize(
    "stem,expected",
    [
        # "Conforms most closely to", which the adjacent-words pattern missed.
        ("The situation described above most closely conforms to which one of the following "
         "generalizations?", True),
        ("Which one of the following inferences conforms most closely to the philosopher's position?", True),
        # A rule applied to cases.
        ("Which one of the following situations violates the food labeling regulation?", True),
        ("Which one of the applicants, as described below, does NOT meet the manager's requirements?", True),
        ("Which one of the following university policies most justifies the decision to revoke "
         "Meyer's PhD?", True),
        ("The actions of which one of the following individuals exhibit the most advanced kind of "
         "moral motivation, as described by the ethicist?", True),
        # A quantity named "requirements", which is not a rule at all.
        ("Which one of the following, if true, would most help to explain the difference in fuel "
         "requirements?", False),
        # And a bare pointer back at the stimulus.
        ("Which one of the following, if true, most helps to explain why treating deep wounds with "
         "sugar as described above is successful?", False),
    ],
)
def test_a_rule_applied_to_cases_is_a_principle_question(stem, expected):
    assert ("scope_precision" in _candidate_keys(lr(stem))) is expected


def test_a_resolution_is_the_noun_of_resolve():
    keys = _candidate_keys(
        lr(
            "Which one of the following provides a resolution to the apparent inconsistency described "
            "by the council member?",
            stimulus=CAUSAL_STIMULUS,
        )
    )
    assert "causal_audit" in keys


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
    # student practising a lot met the same two generic cards constantly. It is
    # 27.9% now, and the residue is structural rather than a matching failure —
    # most of them are strengthen, weaken and explain questions on stimuli that
    # make no causal claim, for which the catalogue holds no third card.
    assert bank_audit["exactly_two_share"] < 30
    # 19 Logical Reasoning questions still carry no task at all, down from 3,157
    # when the type field was the only signal. Those 19 are stems like "in the
    # passage, the author" that name no task to read.
    assert bank_audit["untagged_reasoning"] <= 25


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
