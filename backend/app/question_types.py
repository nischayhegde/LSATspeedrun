"""What kind of question this is, read off the stem at ingest.

`Question.question_type` is not decoration. Strategy matching reads it to decide
which approaches a question is a candidate for, the mandatory-approach draw
charges its strata by it, weak-type targeting steers a run with a list of them,
and every skill row in the product is keyed by one. When it is wrong, four
mechanisms are wrong quietly and in the same direction.

Nearly half the bank was wrong. 3,157 of 6,886 questions — 45.8% — carried a
`question_type` equal to their own section name, which is the fallback this
module's predecessor returned when no rule matched: "Logical Reasoning" is not a
kind of Logical Reasoning question. A placeholder is worse than a missing value
because it reads like data: a stratum called "argument_core|Logical
Reasoning|Logical Reasoning" is the whole untyped bank pretending to be one
cell, and a focus list containing "Reading Comprehension" steers a run toward
everything.

**Why the rules missed.** Reading the stems back, almost none of the failures
were a family nobody had thought of. They were adjacency and inflection:

* `most strongly supported` did not match "the statements above most strongly
  support which one of the following" — 127 stems, the largest single bucket.
* `vulnerable to criticism` did not match "most vulnerable to which one of the
  following criticisms" — the words are in the other order.
* `similar.*reasoning` did not match "the pattern of reasoning ... is most
  similar to" — again the other order.
* `assumption` did not match "the argument assumes which one of the following".
* `explain` did not match "contributes most to an explanation of".
* `main purpose` did not match "the primary purpose of the passage is to" — 93
  Reading Comprehension stems.

That is the same finding the strategy-matching work reported when it took its
own untagged bucket from 246 to 19, and it is worth stating because it predicts
where the next failure will be: not in an exotic question family, in a word
ending.

**Ordering is part of the rule.** The list is walked in order and the first
match wins, so every rule is really "this, and none of the rules above it". Two
orderings do real work and are commented where they sit: sufficient assumption
before necessary assumption, because "follows logically if ... is assumed" also
contains the word "assumed"; and paragraph-scoped purpose before passage-scoped
purpose, because "the primary purpose of the third paragraph" is a function
question and "the primary purpose of the passage" is a main-point question.

**Provenance is recorded.** `classify` returns the source alongside the type,
and `questions.question_type_source` stores it, so an inferred type is
distinguishable from an authored one and from a row that fell through to the
section placeholder. Nothing downstream has to guess how much to trust the
column, and the placeholder residue can be counted rather than estimated —
which is the whole reason the 45.8% was findable at all.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# A type the bank itself supplied. No current dataset does; the branch exists so
# that a bank which labels its own questions is believed rather than re-derived,
# the same way `strategies.detect_comparative` consults `passage_type` first.
SOURCE_AUTHORED = "authored"
# A rule below matched the stem.
SOURCE_INFERRED = "inferred"
# Nothing matched, and the type is the section's own name. Kept as a value
# rather than as a null because the column is not nullable and because the
# honest reading of these rows — "we do not know" — has to be countable.
SOURCE_PLACEHOLDER = "section_placeholder"
# A row written before this column existed. Never produced by `classify`; it is
# what the migration backfills, and it means "this type was written by rules
# nobody recorded", which is a different and weaker claim than either of the
# two above. A re-seed replaces it.
SOURCE_UNRECORDED = "unrecorded"


@dataclass(frozen=True)
class Rule:
    """One named pattern, and what it is for.

    `name` is the rule's own identity rather than the type it produces, because
    several rules produce one type and an audit needs to say which of them
    matched. `note` is what the rule is claiming about the stem, in the terms
    the LSAT itself uses, so that a future widening can be checked against an
    intention rather than against a regex.
    """

    name: str
    question_type: str
    pattern: re.Pattern[str]
    note: str


def _rule(name: str, question_type: str, pattern: str, note: str) -> Rule:
    return Rule(name, question_type, re.compile(pattern), note)


# --- Logical Reasoning -----------------------------------------------------
#
# Ordered. Read it as a decision list: each rule fires only on stems no rule
# above it claimed.
LOGICAL_REASONING_RULES: tuple[Rule, ...] = (
    _rule(
        "point_at_issue",
        "Point at Issue",
        r"disagree|point at issue|at issue between|in dispute",
        "Two speakers, and the question is what they are actually arguing about. "
        "First because these stems also mention conclusions, support and flaws, "
        "and would be claimed by half the list below.",
    ),
    _rule(
        "parallel_flaw",
        "Parallel Flaw",
        r"(?:flaw|error)[^.?]{0,80}(?:parallel|most (?:similar|closely))"
        r"|(?:parallel|most (?:similar|closely))[^.?]{0,80}(?:flaw|error of reasoning)",
        "Find the argument that goes wrong in the same way. Its own type rather "
        "than either half: the old rules called these 128 questions Flaw, which "
        "hides a matching task inside a naming one, and calling them Parallel "
        "Reasoning would hide the fact that the match is on the error.",
    ),
    _rule(
        "parallel_reasoning",
        "Parallel Reasoning",
        r"pattern of reasoning|parallel|reasoning (?:in|above)[^.?]{0,80}most (?:similar|closely)"
        r"|most (?:similar|closely)[^.?]{0,80}reasoning|argument above is most (?:similar|closely)"
        r"|logical structure[^.?]{0,40}(?:similar|like)",
        "Match the argument's structure to another argument. Above the flaw rule "
        "because a matching task that happens to mention reasoning is still a "
        "matching task.",
    ),
    _rule(
        "flaw",
        "Flaw",
        r"flaw|vulnerable to (?:the |any )?(?:criticism|which)|errors? (?:of|in) [^.?]{0,24}reasoning"
        r"|reasoning error|questionable (?:because|technique)|reasoning is (?:most )?(?:flawed|questionable)"
        r"|criticism[^.?]{0,40}argument",
        "Name what is wrong with the argument. The old rule wanted 'vulnerable to "
        "criticism' as one phrase; the bank overwhelmingly writes 'vulnerable to "
        "which one of the following criticisms'. Above the assumption rules "
        "because 'flawed because it takes for granted that' is a flaw question "
        "wearing an assumption's vocabulary.",
    ),
    _rule(
        "sufficient_assumption",
        "Sufficient Assumption",
        r"follows logically if|properly drawn if|conclusion[^.?]{0,80}\bif\b[^.?]{0,40}assumed"
        r"|if assumed|assumed[^.?]{0,40}conclusion[^.?]{0,40}(?:follow|drawn)"
        r"|enables the (?:argument|conclusion)|allows the conclusion",
        "Add a premise that makes the conclusion follow. Above the necessary-"
        "assumption rule because these stems contain the word 'assumed' too, and "
        "the two are opposite tasks: this one is sufficiency, that one necessity.",
    ),
    _rule(
        "necessary_assumption",
        "Assumption",
        r"assumption|assumes|\bassumed\b|requires? assuming|relies on assuming|presupposes"
        r"|required by the argument|depends on|depends upon|takes for granted",
        "A premise the argument needs. 'assumes', 'presupposes' and 'takes for "
        "granted' are the same task in different words, and the old rule matched "
        "none of them.",
    ),
    _rule(
        "principle",
        "Principle",
        r"principle|conforms (?:most closely )?to|proposition[^.?]{0,40}(?:illustrat|conform)"
        r"|(?:following|these|the) generalizations?\b|generalizations? (?:is|are|best)",
        "A rule and a case, in either direction: the answer states the rule the "
        "argument applies, or applies a stated rule to a new case. Above the "
        "strengthen and weaken rules on purpose — 'which one of the following "
        "principles, if valid, most helps to justify the conclusion' is the "
        "principle family doing a strengthening job, and the bank has always "
        "filed it under the family. Moving 54 of them would have been a "
        "relabelling nobody asked for.",
    ),
    _rule(
        "evaluate",
        "Evaluate the Argument",
        r"(?:useful|helpful|relevant|important)[^.?]{0,30}(?:to know|in (?:evaluating|determining|assessing)"
        r"|in order to evaluate)|in order to evaluate|evaluate the (?:argument|reasoning)"
        r"|most help in evaluating",
        "Find the question whose answer would tell you whether the argument holds. "
        "A named LSAT family the old list had no rule for at all.",
    ),
    _rule(
        "strengthen",
        "Strengthen",
        r"most strengthens|strengthen|if true[^.?]{0,80}(?:most )?support(?:s)? the (?:argument|conclusion|claim)"
        r"|provides? the (?:most|strongest)[^.?]{0,30}support for the "
        r"(?:argument|conclusion|claim|position|prediction|hypothesis|proposal)"
        r"|provides? support (?:to|for) the (?:argument|conclusion|claim)"
        r"|provides? the (?:best|strongest) evidence"
        r"|justif(?:y|ies|ication) (?:the|this) (?:reasoning|conclusion|argument)",
        "Add support from outside. Above the inference rule because 'if true, most "
        "supports the conclusion' and 'the statements above most strongly support "
        "which one of the following' are opposite directions of the same verb: one "
        "adds a premise, the other reads one off.",
    ),
    _rule(
        "weaken",
        "Weaken",
        r"most weakens|weaken|casts?[^.?]{0,20}doubt|undermine|call(?:s)? into question"
        r"|counter(?:s)? the argument|strongest counter|damages the argument"
        r"|best challenge|invalidate",
        "Attack the argument from outside. 'undermine' is 65 stems the old rule "
        "did not know about.",
    ),
    _rule(
        "paradox",
        "Resolve the Paradox",
        r"resolve|reconcile|explain|explanation|discrepancy|paradox|apparent(?:ly)? (?:conflict|contradiction)"
        r"|surprising|puzzl",
        "Two facts that sit oddly together, and the answer makes them sit "
        "comfortably. 'explanation' is not matched by a pattern looking for "
        "'explain', which is how 'contributes most to an explanation of the "
        "discrepancy' went untyped.",
    ),
    _rule(
        "complete_the_argument",
        "Complete the Argument",
        r"logically completes|most logically completes|completes the (?:argument|passage)"
        r"|logical completion",
        "The stimulus ends mid-sentence and the answer finishes it. A whole family, "
        "57 stems, with no rule of its own before now.",
    ),
    _rule(
        "main_conclusion",
        "Main Conclusion",
        r"main conclusion|main point (?:made )?(?:in|of)|main point at issue"
        r"|(?:expresses|states|summarizes|identifies)[^.?]{0,40}conclusion"
        r"|conclusion (?:drawn|of the argument) (?:above|in the)",
        "Identify the claim everything else supports. The old rule wanted the exact "
        "phrase 'main conclusion'; the bank usually writes 'most accurately "
        "expresses the conclusion drawn in the argument'. The verb is required: "
        "without it, 'casts the most doubt on the conclusion drawn above' reads as "
        "a main-conclusion question, and it is a weaken question.",
    ),
    _rule(
        "argument_structure",
        "Argument Structure",
        r"role played|method (?:of|used in) (?:the )?reasoning|method used to"
        r"|argument proceeds|technique"
        r"|responds to[^.?]{0,40}argument|argumentative strateg|proceeds by"
        r"|in advancing (?:his|her|the|their) argument|rebuttal|misinterpret"
        r"|(?:the|a) (?:claim|statement|assertion|proposition)[^.?]{0,60}(?:plays|figures|serves|role)"
        r"|strategy of argument|dialogue|respond(?:s|ed) to"
        r"|relationship between[^.?]{0,60}(?:argument|conclusion|claim)"
        r"|does (?:all|each|which) of the following",
        "What a piece of the argument is doing, or how the argument is built. "
        "Includes the two-speaker stems where the task is to describe the reply "
        "rather than to name the disagreement.",
    ),
    _rule(
        "inference",
        "Inference",
        r"must (?:also )?be true|properly inferred|can be inferred|most strongly support"
        r"|most support(?:ed|s)?|logically follows|follows logically from|could be true"
        r"|infer(?:red|ence)?\b|statements?[^.?]{0,60}are true"
        r"|(?:reasonably|properly|justifiably) (?:be )?(?:concluded|drawn|rejected)"
        r"|conclusions?[^.?]{0,30}(?:is|are|can be)[^.?]{0,30}(?:supported|drawn|concluded)"
        r"|best supported by the (?:statements|information)|properly (?:be )?concluded"
        r"|structured to lead to which|conflicts with"
        r"|support for which one of the following",
        "Read off what the stimulus already commits to. Deliberately last of the "
        "content rules: nearly every stem contains a word about support or truth, "
        "so this one has to be what is left after the tasks with a sharper "
        "signature have taken theirs.",
    ),
)


# --- Reading Comprehension -------------------------------------------------
READING_COMPREHENSION_RULES: tuple[Rule, ...] = (
    _rule(
        "passage_relationship",
        "Passage Relationship",
        r"relationship between (?:the )?(?:two )?passages|both passages|each of the two passages"
        r"|passage [ab][^.?]{0,60}(?:differs?|compared|relation)|one or both of the passages"
        r"|the two passages|between passage [ab] and passage [ab]",
        "A question about how the two passages in a comparative set stand to each "
        "other. Not the same fact as `passages.comparative`, which says the set "
        "*is* a pair; this says the question's task is the comparison, and the two "
        "come apart on every comparative set — most of their questions are "
        "ordinary questions that happen to sit on a paired passage.",
    ),
    _rule(
        "paragraph_function",
        "Function",
        r"(?:purpose|function) of the (?:first|second|third|fourth|fifth|last|final|opening|closing)"
        r"[- ]?(?:paragraph|sentence)|(?:paragraph|sentence)[^.?]{0,30}(?:serves|functions?) (?:primarily )?to"
        r"|why the author (?:includes|mentions|discusses)",
        "What one part of the passage is doing. Above the main-point rule because "
        "'the primary purpose of the third paragraph' and 'the primary purpose of "
        "the passage' are different questions in nearly identical words.",
    ),
    _rule(
        "organization",
        "Organization",
        r"organization of|organized|structure of the passage|how the passage (?:is|proceeds)"
        r"|structure of the author's argument|progression of the author's argument"
        r"|passage[^.?]{0,30}proceeds by"
        r"|relationship between the [^.?]{0,30}paragraph",
        "How the whole passage is put together. 52 stems, and none of them matched "
        "a rule before now.",
    ),
    _rule(
        "main_point",
        "Main Point",
        r"main (?:idea|point|purpose|conclusion)|primary purpose|primarily concerned|central (?:idea|point|thesis)"
        r"|passage as a whole"
        r"|(?:best|most appropriate) title|title for the passage"
        r"|both passages are concerned with",
        "The passage's one claim, or the reason it was written. 'primary purpose' "
        "is the phrase the bank actually uses and the old rule did not have it.",
    ),
    _rule(
        "weaken",
        "Weaken",
        r"if true[^.?]{0,60}(?:weaken|undermine|call into question|cast doubt)"
        r"|would be most weakened|most (?:weakens|undermines) the author",
        "The rare Reading Comprehension stem that hands the student a new fact and "
        "asks what it does to the author's argument. Narrow on purpose: the 'if "
        "true' is what distinguishes it from a question about what the passage "
        "already says.",
    ),
    _rule(
        "strengthen",
        "Strengthen",
        r"if true[^.?]{0,60}(?:strengthen|support (?:the|for) (?:author|passage|argument|position))",
        "The same shape, in the other direction.",
    ),
    _rule(
        "author_perspective",
        "Author's Perspective",
        r"author[^.?]{0,70}attitude|attitude[^.?]{0,30}author|tone of the passage"
        r"|author[^.?]{0,60}(?:would|might)[^.?]{0,30}agree"
        r"|would the author[^.?]{0,40}(?:agree|say|consider|be most likely)"
        r"|author[^.?]{0,40}(?:regards?|views?|believes?|holds?|conjectures?|sees?|appears? to)"
        r"|author would be most likely",
        "What the author thinks, as distinct from what the passage says. The old "
        "rule only knew about attitude and tone, and missed all 88 stems that ask "
        "what the author would agree with. Anchored on verbs of opinion and not on "
        "the word 'author': 'the author mentions X as an example' is a question "
        "about what a sentence is doing, and the rule below owns it.",
    ),
    _rule(
        "function",
        "Function",
        r"function|role played|serves primarily to|serves? to|reference to[^.?]{0,60}(?:in order to|serves)"
        r"|mentions?[^.?]{0,50}(?:in order to|primarily to)|in order to"
        r"|author'?s? purpose in (?:lines|the (?:first|second|third|fourth|last|final))"
        r"|introduces which",
        "What a sentence, a reference or an example is doing where it sits.",
    ),
    _rule(
        "meaning_in_context",
        "Meaning in Context",
        r"meaning of the (?:word|phrase|term)|closest in meaning|primarily refers to"
        r"|(?:word|term|phrase)[^.?]{0,50}refers to"
        r"|most (?:probably|nearly) means|as (?:it is )?used in the passage",
        "What a word or phrase is doing in the sentence it sits in. A small family "
        "and a distinctive one: the answer is a paraphrase, not a claim.",
    ),
    _rule(
        "detail",
        "Detail",
        r"according to[^.?]{0,30}the passage|according to the author|passage (?:states|indicates|explicitly)"
        r"|explicitly mention|passage provides information|mentioned in the passage"
        r"|passage mention|helps to answer which|all of the following[^.?]{0,80}(?:passage|author)"
        r"|author (?:cites|states|mentions|notes|lists)|mentions all of the following"
        r"|passage supports all of the following",
        "Something the passage says outright. The answer is on the page; the work "
        "is finding it.",
    ),
    _rule(
        "inference",
        "Inference",
        r"infer|suggest|most strongly support|provides? the most support|implies|it can be concluded"
        r"|most (?:helps to |strongly )?support(?:s|ed)? (?:the |which)|compatible with|provides support for"
        r"|passage[^.?]{0,40}most likely|logically completes?",
        "Something the passage commits to without saying. 'which sentence would "
        "most logically complete the last paragraph' lives here rather than in a "
        "family of its own: three stems is not a stratum, and the task — carry the "
        "passage's argument one step further — is inference with a blank at the end.",
    ),
    _rule(
        "principle",
        "Principle",
        r"principle",
        "A rule the passage's argument rests on, or a case it would cover.",
    ),
    _rule(
        "analogy",
        "Analogy",
        r"analog|most (?:similar|closely) (?:to|in)|comparable to|parallel",
        "Match the passage's situation to another one. Tightened: the old rule "
        "matched the bare word 'similar' anywhere in a stem, which is a common "
        "word in questions that are not analogies.",
    ),
)


RULES: dict[str, tuple[Rule, ...]] = {
    "Logical Reasoning": LOGICAL_REASONING_RULES,
    "Reading Comprehension": READING_COMPREHENSION_RULES,
}


def rules_for(section: str) -> tuple[Rule, ...]:
    return RULES.get(section, LOGICAL_REASONING_RULES)


def classify(section: str, stem: str, *, authored: str | None = None) -> tuple[str, str, str | None]:
    """The question's type, where it came from, and which rule produced it.

    Returns `(question_type, source, rule_name)`. The third value is `None`
    unless a rule matched, and exists so an audit can attribute a type to the
    pattern that produced it rather than inferring the attribution from the
    type — several rules share a type on purpose.

    The section's own name is the fallback, unchanged from before, because
    every consumer of this column already handles it and swapping in a new
    sentinel would break them all to say the same thing. What is new is that
    the row now also says the name is a placeholder.
    """
    if authored and authored.strip() and authored.strip() != section:
        return authored.strip(), SOURCE_AUTHORED, None
    value = (stem or "").casefold()
    for rule in rules_for(section):
        if rule.pattern.search(value):
            return rule.question_type, SOURCE_INFERRED, rule.name
    return section, SOURCE_PLACEHOLDER, None


def question_type(section: str, stem: str) -> str:
    """Just the type. The shape `seed._question_type` had before this module."""
    return classify(section, stem)[0]
