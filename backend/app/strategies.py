from __future__ import annotations

import hashlib
import math
import re
from collections import defaultdict

from flask import current_app
from sqlalchemy.orm import joinedload

from .enforcement import (
    DECLINED_STATUSES,
    GATED_STATUSES,
    MASTERY_MIN_ACCURACY,
    MASTERY_MIN_SATISFIED,
    STATUS_SATISFIED,
    STATUS_SKIPPED,
    STATUS_STOOD_DOWN,
)
from . import experiments
from .experiments import Exposure
from .extensions import db
from .models import Attempt, Question, SessionItem, StudySession, utcnow
from .scoring import PRIOR_STRENGTH, shrink_toward_prior


# Observations per candidate approach before a trial stops covering and starts
# exploiting its leader. Measured weaknesses get the longer runway.
BASE_COVERAGE_TRIALS = 3
FOCUS_COVERAGE_TRIALS = 5

STRATEGY_SOURCES = {
    "lsac_lr": {
        "label": "LSAC · Suggested Approach for Logical Reasoning",
        "url": "https://www.lsac.org/lsat/taking-lsat/test-format/logical-reasoning/suggested-approach-logical-reasoning",
    },
    "lsac_rc": {
        "label": "LSAC · Suggested Approach for Reading Comprehension",
        "url": "https://www.lsac.org/lsat/taking-lsat/test-format/reading-comprehension/suggested-approach-reading-comprehension",
    },
    "seven_rc": {
        "label": "7Sage · LSAT Reading Comprehension Tips",
        "url": "https://7sage.com/blog/lsat-reading-comprehension-tips",
    },
    "seven_lr": {
        "label": "7Sage · Learning Logical Reasoning for the New LSAT",
        "url": "https://7sage.com/blog/learning-logical-reasoning-for-the-new-lsat",
    },
    "seven_170": {
        "label": "7Sage · Cracking 170: LSAT Strategies",
        "url": "https://www.youtube.com/watch?v=x1ZmXWqaLOU",
    },
    "powerscore_lr": {
        "label": "PowerScore · Logical Reasoning Help Area",
        "url": "https://help.powerscore.com/lsat/logical-reasoning",
    },
}


def _strategy(
    key: str,
    title: str,
    plain_title: str,
    plain_subject: str,
    section: str,
    prompt: str,
    plain_line: str,
    steps: tuple[str, str, str],
    best_for: str,
    sources: tuple[str, ...],
) -> dict:
    """Build a catalog entry.

    ``title`` is the published name the technique carries in LSAC and prep
    materials; ``plain_title`` is what a student sees on the question card.
    ``plain_subject`` is the gerund form, used only where the name has to read
    as the subject of a sentence ("Negating the answer is helping you").
    """
    return {
        "key": key,
        "title": title,
        "plain_title": plain_title,
        "plain_subject": plain_subject,
        "section": section,
        "prompt": prompt,
        "plain_line": plain_line,
        "steps": list(steps),
        "best_for": best_for,
        "sources": [STRATEGY_SOURCES[source] for source in sources],
    }


STRATEGIES = {
    item["key"]: item
    for item in (
        _strategy(
            "argument_core",
            "Argument Core",
            "Split the argument",
            "Splitting the argument",
            "Logical Reasoning",
            "Separate what the author is trying to prove from the support offered for it.",
            "Find the one thing the author is trying to prove, then find the support for it.",
            ("Box the conclusion", "Mark only the premises that support it", "State the gap in one clause"),
            "Flaw, assumption, strengthen, weaken, and method questions",
            ("lsac_lr", "seven_lr", "powerscore_lr"),
        ),
        _strategy(
            "prephrase",
            "Prephrase Before Choices",
            "Guess before you look",
            "Guessing before you look",
            "Logical Reasoning",
            "Predict the job of the credited answer before the answer choices compete for your attention.",
            "Decide what the right answer has to do before you read the choices.",
            ("Name the question task", "Predict the needed effect", "Use choices to verify, not invent"),
            "Assumption, inference, strengthen, weaken, and point-at-issue questions",
            ("lsac_lr", "seven_170", "powerscore_lr"),
        ),
        _strategy(
            "negation_test",
            "Necessary-Assumption Negation",
            "Negate the answer",
            "Negating the answer",
            "Logical Reasoning",
            "Negate a contender precisely; a necessary assumption should make the argument fail when denied.",
            "Flip a choice around. If the argument falls apart without it, that choice was required.",
            ("Find the conclusion-premise gap", "Negate one answer cleanly", "Keep it only if the argument collapses"),
            "Necessary-assumption questions",
            ("lsac_lr", "powerscore_lr"),
        ),
        _strategy(
            "causal_audit",
            "Causal Alternatives Audit",
            "Question the cause",
            "Questioning the cause",
            "Logical Reasoning",
            "Test whether the proposed cause is merely correlated with the result.",
            "Ask whether the cause really caused it, or just happened to show up alongside it.",
            ("Name cause and effect", "Check reversal or a third factor", "Ask what comparison would isolate the cause"),
            "Causal strengthen, weaken, flaw, and explain questions",
            ("lsac_lr", "powerscore_lr"),
        ),
        _strategy(
            "conditional_chain",
            "Conditional Chain",
            "Follow the if-thens",
            "Following the if-thens",
            "Logical Reasoning",
            "Translate only the operative sufficient and necessary conditions, then use the contrapositive lawfully.",
            "Translate the if-then statements, connect the shared terms, and flip them correctly.",
            ("Mark sufficient → necessary", "Link only shared terms", "Test the contrapositive; reject reversals"),
            "Must-be-true, parallel, inference, and principle questions",
            ("lsac_lr", "powerscore_lr"),
        ),
        _strategy(
            "flaw_abstraction",
            "Abstract the Flaw",
            "Name the bad move",
            "Naming the bad move",
            "Logical Reasoning",
            "Describe the bad move without borrowing the stimulus topic, then match that structure.",
            "Describe what went wrong without using the topic's words, then find the choice that does the same thing.",
            ("State the conclusion", "Name the invalid leap abstractly", "Demand the same flaw from the answer"),
            "Flaw and parallel-flaw questions",
            ("lsac_lr", "seven_lr", "powerscore_lr"),
        ),
        _strategy(
            "scope_precision",
            "Scope and Force Check",
            "Watch the wording",
            "Watching the wording",
            "Logical Reasoning",
            "Match every quantifier, comparison class, and degree of certainty to what the stimulus proves.",
            "Match words like all, some, and never to exactly what the passage proves.",
            ("Circle force words", "Match the relevant group and time", "Reject stronger or broader claims"),
            "Inference, must-be-true, most-strongly-supported, and principle questions",
            ("lsac_lr", "powerscore_lr"),
        ),
        _strategy(
            "role_map",
            "Statement Role Map",
            "Label each sentence",
            "Labeling each sentence",
            "Logical Reasoning",
            "Label each claim by what it does in the argument rather than what it discusses.",
            "Mark what each sentence does in the argument, not what it talks about.",
            ("Find the main conclusion", "Label support, objection, or context", "Match the requested statement's function"),
            "Method, role, and main-conclusion questions",
            ("lsac_lr", "seven_lr"),
        ),
        _strategy(
            "passage_map",
            "Low-Resolution Passage Map",
            "Map the paragraphs",
            "Mapping the paragraphs",
            "Reading Comprehension",
            "Record each paragraph's job in a few words instead of trying to memorize every detail.",
            "Note what each paragraph is doing in a few words instead of memorizing details.",
            ("Summarize each paragraph's function", "Mark the major turn", "Return to the text for details"),
            "All single-passage Reading Comprehension sets",
            ("lsac_rc", "seven_rc"),
        ),
        _strategy(
            "viewpoint_ledger",
            "Viewpoint Ledger",
            "Track who thinks what",
            "Tracking who thinks what",
            "Reading Comprehension",
            "Track who believes what and how the author evaluates each position.",
            "Keep track of who believes what, and what the author thinks of each of them.",
            ("Name each speaker or school", "Record agreement and conflict", "Mark the author's attitude"),
            "Humanities, law, debate, and multiple-viewpoint passages",
            ("lsac_rc", "seven_rc"),
        ),
        _strategy(
            "paragraph_function",
            "Paragraph Function",
            "Ask why this paragraph",
            "Asking why each paragraph is there",
            "Reading Comprehension",
            "Ask why each paragraph exists and how it changes the passage's direction.",
            "For each paragraph, ask why it is here and how it changes the direction.",
            ("Name the paragraph's task", "Connect it to the prior paragraph", "Use the structure to predict purpose answers"),
            "Organization, purpose, and method questions",
            ("lsac_rc", "seven_rc"),
        ),
        _strategy(
            "textual_proof",
            "Textual Proof Standard",
            "Point to the line",
            "Pointing to the line",
            "Reading Comprehension",
            "Treat every answer as a claim that needs a specific textual warrant.",
            "Only pick an answer you can point to a specific line to support.",
            ("Restate exactly what is asked", "Locate the relevant lines or mapped paragraph", "Reject choices needing an extra assumption"),
            "Detail, inference, application, and author-agreement questions",
            ("lsac_rc", "seven_rc"),
        ),
        _strategy(
            "comparative_matrix",
            "Comparative Relationship Matrix",
            "Compare the two passages",
            "Comparing the two passages",
            "Reading Comprehension",
            "Compare the passages on subject, thesis, evidence, and likely points of agreement.",
            "Map each passage on its own, then say in one sentence how they relate.",
            ("Map Passage A alone", "Map Passage B alone", "Write one relationship sentence before choices"),
            "Comparative Reading Comprehension",
            ("lsac_rc", "seven_rc"),
        ),
        _strategy(
            "main_point_synthesis",
            "Main-Point Synthesis",
            "Say the point in one line",
            "Saying the point in one line",
            "Reading Comprehension",
            "Combine the passage's subject, central claim, and reason for being written into one sentence.",
            "Put the subject, the author's claim, and the reason it was written into one sentence.",
            ("Name the subject", "State the author's central claim", "Add the passage's purpose or contrast"),
            "Main point, primary purpose, title, and global inference questions",
            ("lsac_rc", "seven_rc"),
        ),
    )
}


def strategy_catalog() -> list[dict]:
    return list(STRATEGIES.values())


def serialize_strategy(key: str | None) -> dict | None:
    strategy = STRATEGIES.get(key or "")
    return dict(strategy) if strategy else None


def _stable_fraction(value: str) -> float:
    digest = hashlib.sha256(value.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") / float(2**64 - 1)


# A comparative reading set is two passages printed together as one set, and
# this bank labels none of them: every Reading Comprehension passage carries the
# literal `passage_type` "Reading Comprehension", and no `question_type` has
# ever contained the word "comparative". Asking the metadata therefore returned
# False on all 2,366 Reading Comprehension questions, which is why
# `comparative_matrix` sat in the catalogue with a gate built for it and was
# never once offered to anybody.
#
# The format is read off the headings the sets are printed with. Two details in
# this pattern are load-bearing:
#
# * The match is case-sensitive and demands the body of Passage A between the
#   two headings, because "passage a" occurs in ordinary prose ("in this passage
#   a reader will find") and a lone capitalised mention is not a set.
# * The heading ends in a negative lookahead for a lowercase letter rather than
#   a word boundary. Six of the thirty-two sets in the bank stored the heading
#   with the following space eaten — "Passage AUntil recently, conservationists"
#   — and `\b` cannot match between "A" and "U". The lookahead still rejects
#   "Passage About" and "Passage Analysis", so what it admits is a capital
#   letter directly after the heading letter, which in English is a heading that
#   ran into its own first sentence and essentially nothing else.
#
# Read the six back and the detection reproduces the format's actual history
# exactly: every one of the thirty US forms in the bank dated June 2007 or later
# carries exactly one comparative set in four, every one of the forty-seven
# forms before it carries none, and Comparative Reading was introduced in June
# 2007. Under the word-boundary version six of those thirty forms had none,
# which is the shape of a detector missing sets rather than of a bank lacking
# them.
_COMPARATIVE_HEADINGS = re.compile(r"Passage A(?![a-z])[\s\S]{100,}?Passage B(?![a-z])")


def detect_comparative(canonical_text: str | None, passage_type: str | None = None) -> bool:
    """Whether this passage prints two passages as one set.

    Called once per passage at ingest and written to `passages.comparative`;
    `is_comparative` below reads that column and never re-decides. Deciding the
    format at read time worked but asked a question with a fixed answer on every
    request, and had to lean on question stems to reach the sets whose headings
    it could not match — which put the decision on the question rather than on
    the set it belongs to, so a stem mentioning "Passage A" made one question
    comparative while its siblings on the same set stayed single.

    `passage_type` is consulted first so a bank that does label the format is
    believed rather than re-derived. This one never does.
    """
    if "compar" in (passage_type or "").lower():
        return True
    return bool(_COMPARATIVE_HEADINGS.search(canonical_text or ""))


def is_comparative(question: Question) -> bool:
    """Whether this question belongs to a comparative reading set.

    A read of the flag, which is a property of the passage and therefore shared
    by every question on it. A question with no passage is Logical Reasoning and
    cannot be comparative.
    """
    return bool(question.passage and question.passage.comparative)


def _candidate_keys(question: Question) -> list[str]:
    question_type = (question.question_type or "").lower()
    stem = (question.stem or "").lower()
    if question.section == "Reading Comprehension":
        passage_text = (question.passage.canonical_text or "").lower() if question.passage else ""
        candidates = ["passage_map", "textual_proof"]
        if is_comparative(question):
            candidates.insert(0, "comparative_matrix")
        if any(token in f"{question_type} {stem}" for token in ("purpose", "function", "organization", "method")):
            candidates.insert(0, "paragraph_function")
        if any(token in f"{question_type} {stem}" for token in ("main", "primary purpose", "title", "central point")):
            candidates.insert(0, "main_point_synthesis")
        if any(token in f"{question_type} {stem}" for token in ("attitude", "viewpoint", "perspective", "agree", "author most likely")) or any(
            token in passage_text for token in ("some scholars", "critics", "proponents", "one view", "another view")
        ):
            candidates.insert(0, "viewpoint_ledger")
        return list(dict.fromkeys(candidates))

    stimulus = (question.stimulus or "").lower()
    task_language = f"{question_type} {stem}"
    candidates = ["argument_core", "prephrase"]
    if any(token in task_language for token in ("must", "infer", "strongly supported", "except", "principle")):
        candidates.insert(0, "scope_precision")
    if "assumption" in question_type and any(token in stem for token in ("required", "depends on", "necessary", "must be assumed")):
        candidates.insert(0, "negation_test")
    causal_stimulus = any(
        token in stimulus
        for token in ("cause", "caused", "causal", "resulted in", "led to", "leads to", "due to", "responsible for")
    )
    if "cause" in task_language or (causal_stimulus and any(token in task_language for token in ("strengthen", "weaken", "flaw", "explain"))):
        candidates.insert(0, "causal_audit")
    conditional_stimulus = any(
        token in f" {stimulus} "
        for token in (" if ", " only if ", " unless ", " whenever ", " requires ", " all ", " no ")
    )
    if "conditional" in task_language or (conditional_stimulus and any(token in task_language for token in ("must", "parallel", "principle", "infer"))):
        candidates.insert(0, "conditional_chain")
    if "flaw" in task_language:
        candidates.insert(0, "flaw_abstraction")
    if any(token in task_language for token in ("role", "method", "conclusion")):
        candidates.insert(0, "role_map")
    return list(dict.fromkeys(candidates))


CONTROL_PROBABILITY = 0.25

# The prompt arm: a named technique, and the only arm enforcement ever gates.
VARIANT_PROMPT = "prompt"
# The same offer, made mandatory. A named technique is suggested exactly as it
# is on the prompt arm, and the gate refuses the answer until the operations
# are on the record — there is no "Skip this one" on this arm.
#
# Deliberately a sub-arm of the prompt side rather than a fourth thing beside
# control. `assign_strategy_trial` still draws prompt-versus-control at one
# fixed threshold, so the propensity of *being offered a technique at all* is
# still `1 - CONTROL_PROBABILITY` on every question in every stratum, and the
# contrast the dashboard ranks on is identified by exactly the argument it was
# identified by before. Which of the two prompt sub-arms a question lands on is
# a second, separate draw made in `plan_forced_arms`.
VARIANT_PROMPT_REQUIRED = "prompt_required"
# The control arm as it is drawn today — a card appears on the question and
# deliberately names no technique.
VARIANT_CONTROL_VISIBLE = "control_visible"
# The control arm as it was drawn before that: no card at all, the question
# simply arrived bare.
VARIANT_CONTROL_HIDDEN = "control"

# Both control labels are the same *assignment* — no technique was offered —
# and every estimate here is intention-to-treat over assignment, so both belong
# on the control side of a contrast. They are two different *presentations* of
# that assignment, and therefore two different counterfactuals: "no offer"
# against "an offer of nothing in particular". The labels are kept apart on the
# row so a later analysis can split them and decide which question it is
# asking, exactly as `strategy_enforcement_version` keeps two presentations of
# the prompt arm apart. Pooling them is a choice made here, in the open, rather
# than an accident of both having been called "control".
CONTROL_VARIANTS = frozenset({VARIANT_CONTROL_HIDDEN, VARIANT_CONTROL_VISIBLE})

# Both prompt labels are the same *offer* — a named technique appeared — and
# both therefore belong on the treated side of the contrast that ranks
# approaches. They differ in whether the offer could be declined, which is a
# difference in the strength of the treatment rather than in who received it,
# and the labels are kept apart on the row so that difference stays
# recoverable. Everything that asks "was a technique offered here" reads this
# set; only `plan_forced_arms` and the gate read the two labels apart.
PROMPT_VARIANTS = frozenset({VARIANT_PROMPT, VARIANT_PROMPT_REQUIRED})


def assign_strategy_trial(
    user_id: str,
    question: Question,
    position: int,
    *,
    exposure: str,
    focus_types: list[str] | None = None,
) -> dict | None:
    """Assign a balanced within-student strategy trial on every question.

    The mega-litigation stays a clean measurement surface and gets no trial.
    That used to be enforced here, by a `practice_style == "diagnostic"` guard
    on an argument the only caller always passed as `"cases"` — a guard against
    a call nobody makes, reading a parameter that had one legal value. The
    invariant is real and is held where it is true: `create_diagnostic_session`
    and the sectioned-form path build their items without ever coming here.
    `test_exam.py` and `test_flow.py` assert it on the items, which is the
    property that matters, rather than on this function's willingness to
    refuse.

    Early trials force coverage across the candidate approaches; later trials
    favor the best posterior performer while preserving a challenger and a 25%
    control condition.

    The control condition used to be invisible: a quarter of questions simply
    arrived with nothing on them. It is now visible and neutral — a card still
    appears, and says in as many words that this question has no suggested
    approach. Every question in a run therefore carries a card, which is what
    was asked for, and the arm that carries no technique still exists, which is
    what the ranking in `_section_reading` is computed against. Deleting the
    arm instead would have left `_contrast_sample` at zero for every approach
    forever, so no approach could ever be named and the panel would have gone
    on telling students to go collect questions the app no longer produced.

    Making the control visible also improves the contrast rather than merely
    preserving it. The old bare control differed from the prompt arm by the
    technique *and* by the pause, the interruption, and the act of being asked
    for a decision; the neutral card holds those constant and leaves the
    technique as more nearly the only difference. That does make it a different
    counterfactual from the pre-existing control rows, which is why the two
    carry different arm labels — see `CONTROL_VARIANTS`.

    The old cadence exposed one trial every four questions so that Sprint and
    Infinite could stay clean measurement surfaces. With the diagnostic as the
    only such surface, that reason is gone, and trialling every question makes
    the prompt-versus-control comparison converge about four times faster.

    `focus_types` are the question types the last mega-litigation marked weak.
    On those, coverage runs longer before the trial starts exploiting its
    leader: a wrong early winner is most costly exactly where the student is
    weakest, and that is where the extra exploration buys the most.

    Intention-to-treat, not `strategy_applied`. Both the coverage count and the
    exploit-phase posterior below are built from every attempt *assigned* to
    the prompt arm, regardless of whether the student later self-reported
    using it. Filtering on `strategy_applied` — a self-reported,
    post-randomization variable — would select on exactly the kind of
    question-recognition and confidence that predicts a correct answer on its
    own, which biases both this posterior and the analysis in
    `strategy_performance` in an unknown direction. See
    `research/11-measurement-implementation-spec.md` § 1. `strategy_applied`
    is still recorded on every attempt and still shown back to the student as
    a compliance rate — it just cannot be the thing that defines "treatment"
    anymore.

    Enforcement does not change any of that, deliberately. `app/enforcement.py`
    arms a gate only on the *prompt* arm, and only after the student presses
    "Use it"; the control arm is never gated and never sees one. The
    randomization here is untouched, the propensity below is still exactly the
    threshold that produced the arm, and the comparison is still offer versus
    no offer rather than one interface versus another. What enforcement does
    change is the *content* of the offer: a prompt that also demands the
    operations is a different treatment from a bare suggestion. That is why
    every attempt carries `strategy_enforcement_version` and
    `strategy_enforcement_level`, and why the coverage counts and the posterior
    below are still built from arm assignment alone. Compliance being observed
    rather than self-reported finally makes a per-protocol or CACE fit
    possible, but that is a downstream analysis over `strategy_gate_status`. It
    is not what allocates the next trial.

    `exposure` is what makes the draw below a draw. The arm used to be a hash
    of (student, question, slot, style), which randomises across the space of
    those four things and does *not* randomise across encounters: a review
    question returning to the same slot re-drew the same arm forever. Bank-wide
    that measured a healthy 25% control; for an individual heavy user it
    collapsed to 2%, and the propensity column went on claiming 0.25 while the
    mechanism's actual probability was 0 or 1. Passing the run's id makes each
    encounter its own draw. It is keyword-only and has no default so the
    substitution cannot be made again by omission. See `app/experiments.py`.
    """
    candidates = _candidate_keys(question)
    selection = None
    observations = (
        Attempt.query.filter(
            Attempt.user_id == user_id,
            Attempt.strategy_key.in_(candidates),
            Attempt.strategy_variant.in_(PROMPT_VARIANTS),
        ).all()
    )
    grouped: dict[str, list[Attempt]] = defaultdict(list)
    for observation in observations:
        grouped[observation.strategy_key].append(observation)

    seed = f"{user_id}:{question.id}:{position}:{exposure}"
    minimum = min((len(grouped[key]) for key in candidates), default=0)
    under_sampled = [key for key in candidates if len(grouped[key]) == minimum]
    coverage_target = (
        FOCUS_COVERAGE_TRIALS if question.question_type in (focus_types or ()) else BASE_COVERAGE_TRIALS
    )
    if minimum < coverage_target:
        index = int(_stable_fraction(f"coverage:{seed}") * len(under_sampled)) % len(under_sampled)
        key = under_sampled[index]
    else:
        def score(candidate: str) -> float:
            values = grouped[candidate]
            correct = sum(value.is_correct for value in values)
            posterior_accuracy = (correct + 1) / (len(values) + 2)
            adjusted_seconds = [
                max(1, value.server_elapsed_ms - (value.strategy_prompt_ms or 0) - (value.strategy_gate_ms or 0)) / 1000
                for value in values
            ]
            target_seconds = [value.session_item.target_time_seconds for value in values]
            pace = sum(elapsed <= target for elapsed, target in zip(adjusted_seconds, target_seconds)) / len(values)
            calibrated = sum((value.confidence or 3) <= 3 or value.is_correct for value in values) / len(values)
            graded = [value for value in values if value.explanation_score is not None]
            if not graded:
                # No graded explanation yet: fall back rather than penalize missing data.
                return posterior_accuracy * .76 + pace * .18 + calibrated * .06
            explanation_mean = sum(value.explanation_score for value in graded) / len(graded)
            return posterior_accuracy * .50 + explanation_mean * .30 + pace * .14 + calibrated * .06

        ranked = sorted(candidates, key=lambda candidate: (score(candidate), -len(grouped[candidate]), candidate), reverse=True)
        explore = _stable_fraction(f"explore:{seed}") < .30
        key = ranked[1 if explore and len(ranked) > 1 else 0]
        # Everything above is the `strategy_selection` layer's *treated* arm:
        # the whole apparatus of posteriors, pace, calibration and explanation
        # quality, deciding which of this question's candidate approaches the
        # student is dealt. Until now it had no off arm, so nothing in the
        # product could say whether ranking the candidates beats picking one of
        # them at random. A quarter of eligible questions now do the latter.
        #
        # Eligible is narrow on purpose. Under the coverage target the code
        # above is already drawing uniformly over the least-sampled
        # candidates, so an arm there would be labelling two identical
        # procedures; on a single-candidate question both arms return that
        # candidate. Neither has a counterfactual, so neither is enrolled, and
        # `selection` stays None for both.
        if len(candidates) > 1:
            selection = experiments.draw(
                "strategy_selection", user_id, exposure=Exposure.item(exposure, position)
            )
            if not selection.on:
                index = int(_stable_fraction(f"uniform:{seed}") * len(candidates)) % len(candidates)
                key = candidates[index]

    # The offer arm. Note what is no longer in this hash: the chosen approach.
    #
    # It used to read `control:{seed}:{key}`, which was harmless while the key
    # was a deterministic function of history, and is not harmless now that the
    # key depends on the `strategy_selection` draw above. Two randomisations
    # sharing an input are not independent, and the whole argument for reading
    # the selection layer inside the treated population — that conditioning on
    # an independently drawn arm cannot confound — rests on them being so.
    # Dropping the key from the hash costs nothing: the propensity is the same
    # constant it always was, and the arm is no less random for depending on
    # one thing fewer.
    #
    # The reason the selection draw happens above in *both* offer arms, rather
    # than only in the treated one, is on the `strategy_selection` entry in
    # `app/experiments.py`. Briefly: a control row carries the approach that
    # would have been offered, and `_section_reading` compares an approach's
    # prompt rows against that same approach's control rows. If the treated
    # side's approaches were chosen by a mixture of ranked and uniform while
    # the control side's were chosen by ranked alone, the two arms would be
    # labelled by different processes and the offer comparison would stop being
    # about the offer. The selection arm changes which approach a control
    # question is filed under; it never changes what a control student sees,
    # which is why the layer's own reading is restricted to the treated arm.
    variant = (
        VARIANT_CONTROL_VISIBLE
        if _stable_fraction(f"control:{seed}") < CONTROL_PROBABILITY
        else VARIANT_PROMPT
    )
    # The assignment draw above is a single uniform threshold test, so the
    # propensity of landing in the observed arm is exactly this constant —
    # logged per-observation now so a later IPW/CACE fit (P1-6) does not have
    # to reconstruct it from the hashing scheme after the fact.
    propensity = CONTROL_PROBABILITY if variant in CONTROL_VARIANTS else 1 - CONTROL_PROBABILITY
    return {
        "key": key,
        "variant": variant,
        "propensity": propensity,
        "candidates_n": len(candidates),
        "selection_arm": selection.arm if selection else None,
        "selection_propensity": selection.propensity if selection else None,
    }


# ---------------------------------------------------------------------------
# Mandatory approaches
#
# Two decisions, and the whole design is in keeping them apart.
#
# WHICH STRATA to spend a mandatory question on is chosen to buy the most
# information: the approach-by-question-type cells where the current estimate
# is weakest. That is a legitimate adaptive-design choice and it is where
# "enrich the strategy data" is actually satisfied.
#
# WHICH QUESTION inside those strata is made mandatory is a uniform draw. This
# is the part that cannot be optimised without destroying the thing being
# measured: if the mandatory questions were picked *because* of what they are,
# assignment would correlate with question difficulty and the comparison would
# stop supporting a causal reading — more data, worse recommendations, and a
# dashboard that looked better while getting worse.
#
# Three properties hold the identification together.
#
# 1. Forcing never touches the prompt-versus-control draw. That draw is still
#    the single fixed threshold in `assign_strategy_trial`, so the propensity
#    of being offered a technique is `1 - CONTROL_PROBABILITY` on every
#    question in every stratum, and the ranking in `_section_reading` rests on
#    exactly the argument it rested on yesterday. What changes is the content
#    of the offer on some of the treated questions, not who is treated.
# 2. Inside the pool the draw is uniform without replacement, so every pool
#    member shares one known inclusion probability, `quota / len(pool)`. Both
#    winners and losers carry it, which is what makes the losers the honest
#    comparison group for the winners.
# 3. Pool membership is decided from the student's history and the question's
#    stratum — both fixed before this question is served — and never from
#    anything about this question's outcome. The need score below reads
#    denominators and compliance. It never reads accuracy.
# ---------------------------------------------------------------------------

# Mandatory questions per run, and per day across runs. A run is eight to ten
# questions, so two is roughly one in five: enough that a student meets the
# mechanism most sessions, few enough that it reads as structure rather than as
# the app having switched into a mode. The daily cap exists because three runs
# in an evening is a normal evening.
SESSION_FORCED_CAP = 2
DAILY_FORCED_CAP = 6

# How many weak cells one run invests in. Concentrating on the weakest few is
# the point — spreading two mandatory questions across every stratum a run
# touches would buy a little dose everywhere and never lift one cell over the
# line — and three is small enough to concentrate while leaving the pool wide
# enough that the draw inside it is not a formality.
TARGET_STRATA = 3


def stratum_key(strategy_key: str, question: Question) -> str:
    """The cell an assignment is charged to.

    Approach by question type, which is finer than the (section, approach) cell
    `_section_reading` ranks on. Deliberately: the same approach behaves
    differently on a necessary-assumption question and on a parallel-flaw one,
    so that is the grain at which a gap in the record is worth spending a
    mandatory question on. Being finer than the estimator's cell is safe in the
    direction that matters — every stratum sits entirely inside exactly one
    estimator cell, so investing in a stratum never mixes two cells together.
    """
    return f"{strategy_key}|{question.section}|{question.question_type or 'unspecified'}"


def _census(user_id: str) -> tuple[dict[str, dict], set[str]]:
    """Per-stratum counts, and the approaches this student has already proven.

    One statement. Walking mapped `Attempt` rows to reach `.session_item.question`
    would cost two lazy reads per answer on a path that runs every time a run is
    created, which is the bill `focus.py` already documents paying once.
    """
    rows = (
        Attempt.query.with_entities(
            Attempt.strategy_key,
            Attempt.strategy_variant,
            Attempt.strategy_gate_status,
            Attempt.is_correct,
            Question.section,
            Question.question_type,
        )
        .join(SessionItem, Attempt.session_item_id == SessionItem.id)
        .join(Question, Question.id == SessionItem.question_id)
        .filter(Attempt.user_id == user_id, Attempt.strategy_key.isnot(None))
        .all()
    )
    strata: dict[str, dict] = defaultdict(
        lambda: {"prompt": 0, "control": 0, "gated": 0, "declined": 0}
    )
    proven: dict[str, list[bool]] = defaultdict(list)
    for row in rows:
        stratum = f"{row.strategy_key}|{row.section}|{row.question_type or 'unspecified'}"
        cell = strata[stratum]
        if row.strategy_variant in PROMPT_VARIANTS:
            cell["prompt"] += 1
            if row.strategy_gate_status in GATED_STATUSES:
                cell["gated"] += 1
                if row.strategy_gate_status in DECLINED_STATUSES:
                    cell["declined"] += 1
        elif row.strategy_variant in CONTROL_VARIANTS:
            cell["control"] += 1
        if row.strategy_gate_status == STATUS_SATISFIED:
            proven[row.strategy_key].append(bool(row.is_correct))
    mastered = {
        key
        for key, outcomes in proven.items()
        if len(outcomes) >= MASTERY_MIN_SATISFIED
        and sum(outcomes) / len(outcomes) >= MASTERY_MIN_ACCURACY
    }
    return strata, mastered


def information_need(cell: dict) -> float:
    """How much a mandatory question in this stratum is worth.

    The product of two factors, and neither of them is an accuracy.

    The first is the posterior variance of the cell's difference, up to the
    constant p(1−p) that is near enough common across cells to drop:
    Var(p̂₁ − p̂₀) ∝ 1 / `_contrast_sample`, and the prior strength in the
    denominator is the same shrinkage `_shrink_toward` applies, so an empty
    cell scores a finite maximum instead of dividing by zero. This is the
    "fewest observations / weakest estimate" half of the rule.

    The second is dilution. Forcing does not add rows — the run is the length
    it is and the arms are drawn at the same rates either way — so what it buys
    is *dose*. An intention-to-treat difference measured where half the offers
    are declined is roughly half the effect of the technique, and needs four
    times the sample to resolve. Where an offer is already taken up every time,
    a mandatory question buys nothing at all and only costs the student a
    minute, so the factor takes it to near zero. Smoothed as (declined + 1) /
    (gated + 2), which puts a stratum nobody has been gated in yet at one half:
    unknown compliance is worth investing in, but not as much as compliance
    known to be poor.
    """
    effective = _contrast_sample(cell["prompt"], cell["control"])
    dilution = (cell["declined"] + 1) / (cell["gated"] + 2)
    return dilution / (PRIOR_STRENGTH + effective)


def forced_today(user_id: str) -> int:
    """Mandatory questions already dealt to this student since midnight UTC.

    Counted on assignment rather than on completion. A student who starts three
    runs and finishes none has still been asked three times, and the cap is
    about how often the app insists, not about how much work got done.
    """
    since = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    return (
        SessionItem.query.join(StudySession, SessionItem.session_id == StudySession.id)
        .filter(
            StudySession.user_id == user_id,
            StudySession.started_at >= since,
            SessionItem.strategy_variant == VARIANT_PROMPT_REQUIRED,
        )
        .count()
    )


def plan_forced_arms(
    user_id: str,
    seed: str,
    assignments: list[tuple[int, Question, dict | None]],
    *,
    already_forced_today: int | None = None,
) -> dict[int, dict]:
    """Choose which of a run's questions make their approach mandatory.

    Returns one entry per position that carries a trial:

    * `stratum` — the cell the assignment is charged to, recorded on every
      trialled question including the control arm, so a later analysis can
      condition on it without reconstructing it from the catalogue.
    * `forcing_propensity` — the probability this position had of being drawn,
      recorded on winners and losers alike. `None` means the position was never
      in a pool and has no counterfactual: it is not part of the mandatory
      comparison, only of the offer-versus-nothing one.
    * `required` — whether it was drawn.

    The whole run is planned at once rather than question by question because
    the cap is a property of the run. Deciding position by position would make
    each draw conditional on the ones before it, which is still a valid
    sequential randomization but leaves every position carrying a different
    propensity for reasons that have nothing to do with the stratum. Drawing a
    fixed quota from a fixed pool gives every pool member the same probability,
    exactly, and it is a probability that can be written down rather than
    reconstructed.
    """
    plan: dict[int, dict] = {}
    trialled = [
        (position, question, trial)
        for position, question, trial in assignments
        if trial and trial.get("key")
    ]
    if not trialled:
        return plan
    # An arm label has to describe the treatment that was actually delivered.
    # With gates switched off there is nothing to be mandatory about, so the
    # run gets strata on its rows and no draw — rather than a required arm that
    # required nothing.
    forcing_on = current_app.config.get("STRATEGY_ENFORCEMENT_ENABLED", True)

    strata, mastered = _census(user_id)
    for position, question, trial in trialled:
        plan[position] = {
            "stratum": stratum_key(trial["key"], question),
            "forcing_propensity": None,
            "required": False,
        }

    eligible = [
        position
        for position, _question, trial in (trialled if forcing_on else ())
        # Only the treated side can be made mandatory: gating the control arm
        # would put a technique on it and there would be no control arm.
        if trial["variant"] in PROMPT_VARIANTS
        # Scaffolding a student has already cleared eight times at three
        # quarters accuracy is a tax, and a stratum whose offers are already
        # taken up has nothing left for a mandatory question to buy.
        and trial["key"] not in mastered
    ]
    if not eligible:
        return plan

    ranked = sorted(
        {plan[position]["stratum"] for position in eligible},
        key=lambda stratum: (-information_need(strata[stratum]), stratum),
    )
    targeted = set(ranked[:TARGET_STRATA])
    pool = [position for position in eligible if plan[position]["stratum"] in targeted]
    remaining_today = DAILY_FORCED_CAP - (
        forced_today(user_id) if already_forced_today is None else already_forced_today
    )
    quota = max(0, min(SESSION_FORCED_CAP, remaining_today, len(pool)))
    if not quota:
        return plan

    propensity = quota / len(pool)
    # Uniform without replacement, by ranking the pool on a hash of the run and
    # the position. Every member's chance of finishing in the first `quota` is
    # the same by symmetry, so the propensity above is exact rather than
    # nominal, and a reload cannot redraw it.
    drawn = set(
        sorted(pool, key=lambda position: _stable_fraction(f"force:{seed}:{position}"))[:quota]
    )
    for position in pool:
        plan[position]["forcing_propensity"] = propensity
        plan[position]["required"] = position in drawn
    return plan


# Below this many observations *in a single arm*, a swing in the raw accuracy
# is indistinguishable from a swing driven by the exact discreteness the plan
# warns about: a control sample of 4 can only ever read 0/25/50/75/100%, so any
# decimal-place (or even whole-point) percentage at this scale is fiction, and
# a fraction like "3/4" is the honest version of the same fact — a reader sees
# the small denominator instead of a false-precision number.
# [11-measurement-implementation-spec.md § 3]
PERCENTAGE_DISPLAY_MIN_SAMPLE = 30


def _frac_or_percent(correct: int, sample: int) -> str:
    if not sample:
        return "—"
    if sample < PERCENTAGE_DISPLAY_MIN_SAMPLE:
        return f"{correct}/{sample}"
    return f"{round(correct / sample * 100)}%"


def _sample_note(sample: int, suffix: str) -> str:
    if not sample:
        return f"no questions {suffix} yet"
    return f"{sample} question{'' if sample == 1 else 's'} {suffix}"


def _result_copy(
    strategy: dict,
    correct: int,
    sample: int,
    control_correct: int,
    control_sample: int,
    applied: int,
    offered: int,
    satisfied: int,
    enforced: int,
) -> dict:
    """Author every student-facing sentence about one approach.

    No sentence here ever says "confirmed", "supported", or claims the
    approach is or is not helping — a per-student verdict on 12 named
    strategies needs roughly 11,000 observations to detect a realistic effect
    [02-measurement-and-score-prediction.md § 9], which is not a threshold this
    product will ever clear per student. Everything below is a description of
    the student's own running counts, not a claim about causation.
    """
    subject = strategy["plain_subject"]
    with_display = _frac_or_percent(correct, sample)
    without_display = _frac_or_percent(control_correct, control_sample)
    can_show_percentage_gap = (
        sample >= PERCENTAGE_DISPLAY_MIN_SAMPLE and control_sample >= PERCENTAGE_DISPLAY_MIN_SAMPLE
    )

    if not sample and not control_sample:
        summary = f"You have not seen a question offer {subject[0].lower()}{subject[1:]} yet."
    elif not control_sample:
        summary = f"So far you're at {with_display} with it. Not enough questions without it yet to compare."
    elif not sample:
        summary = f"So far you're at {without_display} without it. Not enough questions with it yet to compare."
    else:
        summary = f"So far you're at {with_display} with it and {without_display} without it."

    if enforced:
        # Once a gate is involved this stops being a self-report. Say the
        # stronger, true thing instead of the weaker one.
        detail = f"You finished the steps on {satisfied} of the {enforced} time{'' if enforced == 1 else 's'} it was enforced."
    elif offered:
        detail = f"You said you used it on {applied} of the {offered} time{'' if offered == 1 else 's'} it came up."
    else:
        detail = "It has not come up as a suggested approach yet."

    next_step = (
        "A few more questions on both sides will make this clearer."
        if sample or control_sample
        else "This starts filling in the next time it comes up."
    )

    if can_show_percentage_gap:
        lift = round(correct / sample * 100) - round(control_correct / control_sample * 100)
        difference_headline = f"{'+' if lift > 0 else ''}{lift} points"
        difference_note = f"your own running totals over {sample} and {control_sample} questions — not a proven effect"
    elif sample and control_sample:
        difference_headline = "—"
        difference_note = "too few questions yet for a point difference to mean anything"
    else:
        difference_headline = "—"
        difference_note = f"waiting on questions {'without it' if not control_sample else 'with it'}"

    return {
        "verdict": "measuring",
        "verdict_label": "measuring",
        "summary": summary,
        "detail": detail,
        "next_step": next_step,
        "with_headline": with_display,
        "with_note": _sample_note(sample, "with it"),
        "without_headline": without_display,
        "without_note": _sample_note(control_sample, "without it"),
        "difference_headline": difference_headline,
        "difference_note": difference_note,
    }


# The two scored domains in this bank. `Question.section` carries these exact
# strings, and the short forms are what the dashboard has room for.
SECTIONS: tuple[tuple[str, str], ...] = (
    ("Logical Reasoning", "LR"),
    ("Reading Comprehension", "RC"),
)

# Grades for the *difference*, keyed on its effective per-arm sample
# `_contrast_sample` below. Same vocabulary as `scoring.EVIDENCE_GRADES` so one
# word does not mean two things across the dashboard, and deliberately missing
# that scale's top grade: "stable" would imply the comparison had settled, and
# a per-student verdict on one of fourteen approaches needs orders of magnitude
# more observations than this product will ever collect
# [02-measurement-and-score-prediction.md § 9].
CONTRAST_EVIDENCE_GRADES: tuple[tuple[int, str], ...] = ((10, "baseline"), (25, "emerging"))

# The single bar an approach has to clear before this section will name it the
# strongest one. It is set on the *difference*, not on either arm, because that
# is the quantity being ranked: `_contrast_sample` is dominated by the thinner
# side, so 100 prompted questions against 8 controls scores 7.4 and does not
# qualify, while 20 against 20 scores 10 and does. Both arms therefore have to
# exceed ten on their own, which makes a separate per-arm minimum redundant.
#
# Ten is the first boundary in `CONTRAST_EVIDENCE_GRADES`, chosen so a named
# leader can never carry the weakest grade on that scale. It is not a
# significance threshold and nothing here claims one; splitting the record by
# section halves the evidence behind every estimate, and this is the point
# below which naming a winner would be reporting the denominator rather than
# the student.
MIN_CONTRAST_SAMPLE = CONTRAST_EVIDENCE_GRADES[0][0]


def _arm_rate(sample: list[Attempt], propensity=lambda value: value.strategy_propensity) -> float:
    """Accuracy of one arm, inverse-propensity weighted.

    The Hájek estimator: Σ(y/π) / Σ(1/π) over the arm, with a logged propensity
    as π. That column is logged per observation at assignment time precisely so
    a weighted fit does not have to reconstruct the hashing scheme after the
    fact (P0-8), and this is that fit.

    For the offer-versus-nothing contrast, π is `strategy_propensity`:
    `assign_strategy_trial` still draws that against a single constant
    threshold in every stratum, so the weights cancel exactly and this returns
    the plain mean — the correct answer for a constant propensity rather than a
    coincidence.

    For the mandatory-versus-optional contrast it is
    `strategy_forcing_propensity`, and there the weights do not cancel: that
    draw allocates a fixed quota over a pool whose size varies from run to run,
    on purpose, because the pool is chosen to be the strata worth investing in.
    Weighting is what makes those observations comparable, and this is the case
    the column was added for.

    Observations predating a column, or carrying a nonsensical one, fall back
    to unit weight rather than being dropped: dropping them would break
    intention-to-treat.
    """
    if not sample:
        return 0.0
    weights = [
        1.0 / propensity(value)
        if propensity(value) and 0 < propensity(value) <= 1
        else 1.0
        for value in sample
    ]
    total = sum(weights)
    if total <= 0:
        return 0.0
    return sum(weight for weight, value in zip(weights, sample) if value.is_correct) / total


def _shrink_toward(rate: float, sample: int, centre: float) -> float:
    """`scoring.shrink_toward_prior`, re-centred on a per-section baseline.

    Same Beta-binomial posterior mean, same prior strength, different centre:
    the population median is the right place to pull a *score* estimate toward,
    but the right place to pull one arm of a within-student trial toward is the
    rate that student runs at in this section overall — which is where both
    arms sit if the approach makes no difference. So the centre is the null,
    and the contrast below shrinks toward "this changed nothing" rather than
    toward the population.
    """
    if sample <= 0:
        return centre
    return (PRIOR_STRENGTH * centre + sample * rate) / (PRIOR_STRENGTH + sample)


def _contrast_sample(prompt_sample: int, control_sample: int) -> float:
    """Effective per-arm sample behind a difference of two proportions.

    The variance of p̂₁ − p̂₀ is p₁(1−p₁)/n₁ + p₀(1−p₀)/n₀, so the precision of
    the difference is governed by the harmonic term 1/(1/n₁ + 1/n₀) — dominated
    by the *smaller* arm. 200 prompted questions against 4 controls is a
    four-observation comparison wearing a large number, and this is the
    quantity that says so.

    One implementation, in `experiments`, now that this module imports it. It
    was briefly copied there while both files were being rewritten at once; two
    copies of an estimator is two things to keep in step and the merge note
    asked for this.
    """
    return experiments.contrast_sample(prompt_sample, control_sample)


def _contrast_grade(effective: float) -> str:
    for threshold, name in CONTRAST_EVIDENCE_GRADES:
        if effective < threshold:
            return name
    return "directional"


def _contrast(prompted: list[Attempt], controls: list[Attempt], baseline: float) -> dict:
    """The shrunk intention-to-treat difference for one approach in one section."""
    prompt_sample, control_sample = len(prompted), len(controls)
    effective = _contrast_sample(prompt_sample, control_sample)
    if not effective:
        return {
            "adjusted_lift": None,
            "adjusted_with": None,
            "adjusted_without": None,
            "contrast_sample": 0.0,
            "contrast_evidence": "baseline",
            "eligible": False,
        }
    adjusted_with = _shrink_toward(_arm_rate(prompted), prompt_sample, baseline)
    adjusted_without = _shrink_toward(_arm_rate(controls), control_sample, baseline)
    return {
        "adjusted_lift": round((adjusted_with - adjusted_without) * 100, 1),
        "adjusted_with": round(adjusted_with * 100, 1),
        "adjusted_without": round(adjusted_without * 100, 1),
        "contrast_sample": round(effective, 1),
        "contrast_evidence": _contrast_grade(effective),
        "eligible": effective >= MIN_CONTRAST_SAMPLE,
    }


def _in_forcing_pool(value: Attempt) -> bool:
    """Whether this observation took part in a mandatory draw at all.

    A propensity strictly between zero and one means the question was in a pool
    and could have gone either way, which is the only situation in which the
    two mandatory arms are comparable. Three kinds of row are excluded and each
    for the same reason — no counterfactual:

    * `None` — never in a pool. Most questions, and every row written before
      mandatory approaches existed.
    * `1.0` — a pool no larger than the quota, so every member was drawn. Rare,
      and it happens when a run only touches one weak stratum at one position.
    * `0.0` — never written, but excluded by the same rule rather than by
      trusting that it never will be.
    """
    propensity = value.strategy_forcing_propensity
    return propensity is not None and 0.0 < propensity < 1.0


def _forcing_contrast(prompted: list[Attempt], baseline: float) -> dict:
    """Mandatory approaches against optional ones, inside the pool.

    A second, narrower estimand than the one the dashboard ranks on, and a
    different question: not "does an offer help" but "does insisting on it
    help". It exists because insisting is now a thing the app does, and a
    mechanism that changes what students do should be measurable rather than
    merely believed in.

    Two restrictions do all the identification work.

    Restricted to the pool. A mandatory question was drawn from a set chosen
    for being weakly measured, so comparing it against every optional question
    on the record would compare weak strata against strong ones and call the
    difference enforcement. Only questions that were in a pool — which is to
    say, that could have been drawn and were not — are the comparison group.

    Weighted by the draw's own probability. Inside a pool every member shares
    one inclusion probability, but pools differ in size and quota across runs,
    so the arms are balanced by Hájek weights rather than by assumption.

    Both arms are shrunk toward the section baseline exactly as the main
    contrast is, so a thin comparison reports something near zero rather than
    something dramatic.
    """
    pooled = [value for value in prompted if _in_forcing_pool(value)]
    required = [value for value in pooled if value.strategy_variant == VARIANT_PROMPT_REQUIRED]
    optional = [value for value in pooled if value.strategy_variant == VARIANT_PROMPT]
    effective = _contrast_sample(len(required), len(optional))
    result = {
        "required_sample": len(required),
        "optional_sample": len(optional),
        "required_complied": sum(value.strategy_gate_status == STATUS_SATISFIED for value in required),
        "optional_complied": sum(value.strategy_gate_status == STATUS_SATISFIED for value in optional),
        "stood_down": sum(value.strategy_gate_status == STATUS_STOOD_DOWN for value in required),
        "contrast_sample": round(effective, 1),
        "adjusted_lift": None,
    }
    if not effective:
        return result
    adjusted_required = _shrink_toward(
        _arm_rate(required, lambda value: value.strategy_forcing_propensity),
        len(required),
        baseline,
    )
    adjusted_optional = _shrink_toward(
        _arm_rate(optional, lambda value: 1.0 - value.strategy_forcing_propensity),
        len(optional),
        baseline,
    )
    result["adjusted_lift"] = round((adjusted_required - adjusted_optional) * 100, 1)
    return result


def _other_arm(sample: int) -> int:
    """Smallest opposite arm that lifts `_contrast_sample` to the bar."""
    return math.ceil(1 / (1 / MIN_CONTRAST_SAMPLE - 1 / sample))


def _shortfall(result: dict) -> tuple[int, int]:
    """Fewest further observations, per arm, that would put this over the bar.

    Exact rather than a rule of thumb. 1/n₁ + 1/n₀ ≤ 1/C is convex and the
    objective is the total, so the cheapest point is the balanced one, n₁ = n₀ =
    2C — twice the bar on each side, which is what 1/(1/n + 1/n) = n/2 works
    out to. An arm that is already past 2C is left where it is and the other one
    is solved for, because past that point growing the long arm buys back less
    than one observation on the short one.

    Holding whichever arm happens to be larger would be exact too and useless:
    twelve prompted questions can only reach the bar against sixty controls, so
    that phrasing would tell a student to collect 57 more of the scarcest thing
    on the page when 25 questions spread across both arms would do it.
    """
    prompt_sample, control_sample = result["sample"], result["control_sample"]
    balanced = 2 * MIN_CONTRAST_SAMPLE
    target_prompt, target_control = prompt_sample, control_sample
    if _contrast_sample(target_prompt, target_control) < MIN_CONTRAST_SAMPLE:
        if prompt_sample >= balanced:
            target_control = _other_arm(prompt_sample)
        elif control_sample >= balanced:
            target_prompt = _other_arm(control_sample)
        else:
            target_prompt, target_control = balanced, balanced
    return max(0, target_prompt - prompt_sample), max(0, target_control - control_sample)


def _shortfall_sentence(result: dict) -> str:
    with_it, without_it = _shortfall(result)
    parts = []
    if with_it:
        parts.append(f"{with_it} more with it")
    if without_it:
        parts.append(f"{without_it} more without it")
    if not parts:
        return "It is over the line; the difference just has not separated yet."
    return (
        f"About {' and '.join(parts)} would put {result['plain_title'].lower()} over that line. "
        "Roughly one question in four names no approach at all, so the without-it side fills slowest."
    )


def _lift_headline(points: float) -> str:
    if abs(points) < 0.5:
        return "level"
    return f"{'+' if points > 0 else '−'}{abs(round(points))} pts"


def _section_reading(section: str, short_label: str, attempts: list[Attempt]) -> dict:
    """The strongest approach for one section, or an honest account of why not.

    Every figure here is computed from the attempts that landed on questions in
    this section — read off `Question.section`, not off the approach's catalogue
    label. The two are usually the same, because `_candidate_keys` only ever
    offers Reading Comprehension approaches on Reading Comprehension questions,
    but "usually" is not a property to build an estimate on: the catalogue label
    is a description of what an approach is *for*, and what is being measured
    here is where it was actually tried.

    Ranking is on the intention-to-treat difference against that approach's own
    control arm, never on prompt-arm accuracy. Approaches are offered on
    different question types — `negation_test` only appears on necessary
    assumption questions — so their raw accuracies are mostly a ranking of how
    hard those question types are. Each approach's control arm is drawn from the
    same pool that approach is a candidate for, so the difference is the only
    comparison here that is about the approach at all.
    """
    by_key: dict[str, list[Attempt]] = defaultdict(list)
    for attempt in attempts:
        by_key[attempt.strategy_key].append(attempt)

    trials = len(attempts)
    prompt_trials = sum(attempt.strategy_variant in PROMPT_VARIANTS for attempt in attempts)
    required_trials = sum(attempt.strategy_variant == VARIANT_PROMPT_REQUIRED for attempt in attempts)
    observed = sum(attempt.is_correct for attempt in attempts) / trials if trials else 0.0
    # Where both arms sit under the null. Shrunk toward the population itself so
    # that a section holding six answers does not hand the arms a centre that is
    # every bit as noisy as the thing it is supposed to stabilise.
    baseline = shrink_toward_prior(observed, trials)
    candidates = [
        attempt.strategy_candidates_n for attempt in attempts if attempt.strategy_candidates_n
    ]

    results = []
    for key, values in by_key.items():
        strategy = STRATEGIES.get(key)
        if not strategy:
            continue
        result = _strategy_result(key, strategy, values)
        prompted = [value for value in values if value.strategy_variant in PROMPT_VARIANTS]
        result.update(
            _contrast(
                prompted,
                [value for value in values if value.strategy_variant in CONTROL_VARIANTS],
                baseline,
            )
        )
        result["forcing"] = _forcing_contrast(prompted, baseline)
        results.append(result)
    results.sort(
        key=lambda result: (
            result["eligible"],
            result["adjusted_lift"] if result["adjusted_lift"] is not None else -1e3,
            result["sample"] + result["control_sample"],
        ),
        reverse=True,
    )

    reading = {
        "section": section,
        "short_label": short_label,
        "trials": trials,
        "prompt_trials": prompt_trials,
        "required_trials": required_trials,
        "control_trials": trials - prompt_trials,
        "strategies_tested": len(results),
        "minimum_contrast_sample": MIN_CONTRAST_SAMPLE,
        "baseline_accuracy": round(baseline * 100),
        "results": results,
        # `focus` is whichever approach the reading is about, in every state, so
        # the panel has one thing to open up. `leader` is set only where one has
        # actually been named.
        "leader": None,
        "focus": None,
        "lift_headline": "—",
        "evidence_label": None,
        "evidence_note": None,
        # Provenance for anyone reading the payload rather than the panel. The
        # arm an attempt was assigned to is what defines treatment here; the
        # gate status and `strategy_applied` are reported beside it and never
        # decide membership.
        "itt": {
            "basis": "intention-to-treat",
            "propensity_weighted": True,
            "mean_candidates": round(sum(candidates) / len(candidates), 1) if candidates else None,
            "note": (
                "Counted by which questions offered the approach, not by whether you said you used "
                "it — sorting on that would quietly compare the questions you recognised."
            ),
            # What the ranking above now assumes, written down where an analyst
            # reading the payload will find it. Both prompt sub-arms are pooled
            # on the treated side, because both are the same offer and the
            # draw that separates them happens after the one being estimated
            # here. The estimand is therefore the effect of the offer *regime*
            # as it is currently deployed — a mixture of suggestions and
            # requirements whose proportions move as strata fill up — rather
            # than the effect of a fixed treatment. `strategy_variant` and
            # `strategy_stratum` are on every row so a later analysis can
            # split the mixture instead of inheriting this choice.
            "treated_arms": sorted(PROMPT_VARIANTS),
            "regime_note": (
                "Suggested and required questions are pooled as one offer. Which of the two a "
                "question became was drawn separately, after this comparison's own draw, and "
                "never changed the odds of being offered anything at all."
            ),
        },
    }

    # `results` can be empty with trials on the board if every key in this
    # section has since left the catalogue — a rename, not a state the student
    # caused, and not a reason to fail the panel.
    if not trials or not results:
        return {
            **reading,
            "status": "none",
            "headline": f"No {short_label} approaches tried yet",
            "summary": (
                f"{section} questions arrive with a suggested approach the same way Logical "
                "Reasoning ones do. None have come up for you yet."
                if section == "Reading Comprehension"
                else f"{section} questions arrive with a suggested approach. None have come up for you yet."
            ),
            "next_step": f"Run a set of cases with {short_label} questions in it and this starts filling in.",
        }

    eligible = [result for result in results if result["eligible"]]
    closest = min(results, key=lambda result: (sum(_shortfall(result)), -result["sample"]))

    if not eligible:
        return {
            **reading,
            "status": "insufficient",
            "focus": closest,
            "headline": f"Not enough {short_label} evidence to name one",
            "summary": (
                f"{trials} {short_label} question{'' if trials == 1 else 's'} "
                f"{'has' if trials == 1 else 'have'} carried a suggested approach, spread over "
                f"{len(results)} approach{'' if len(results) == 1 else 'es'}. A difference is only as "
                f"strong as its thinner side, so no "
                f"approach gets named until both sides of one comparison are worth at least "
                f"{MIN_CONTRAST_SAMPLE} questions — {closest['plain_title'].lower()} is nearest, with "
                f"{closest['sample']} question{'' if closest['sample'] == 1 else 's'} with it and "
                f"{closest['control_sample']} without."
            ),
            "next_step": _shortfall_sentence(closest),
        }

    front = eligible[0]
    adjusted = front["adjusted_lift"] or 0.0
    reading = {
        **reading,
        "focus": front,
        "lift_headline": _lift_headline(adjusted),
        "evidence_label": front["contrast_evidence"],
        "evidence_note": (
            f"Effectively a {round(front['contrast_sample'])}-question comparison: "
            f"{front['sample']} with it against {front['control_sample']} without, and a difference is "
            "only ever as strong as its smaller side."
        ),
    }

    if adjusted < 0.5:
        standing = (
            "runs level with answering those questions with no approach suggested"
            if adjusted > -0.5
            else f"sits {abs(round(adjusted))} points behind answering those questions with no approach suggested"
        )
        return {
            **reading,
            "status": "level",
            "headline": f"Nothing is pulling ahead in {short_label}",
            "summary": (
                f"{front['plain_title']} carries the most {short_label} evidence, and once the size of "
                f"its split is allowed for it {standing}. Nothing else in {short_label} is ahead either."
            ),
            "next_step": (
                f"That is a reading, not a gap: on your {short_label} record so far the approaches are "
                "not separating. More questions can still pull one out."
            ),
        }

    return {
        **reading,
        "status": "leader",
        "leader": front,
        "headline": front["plain_title"],
        "summary": (
            f"Ranked on how you did with it against how you did on {short_label} questions that "
            "offered nothing — not on raw accuracy, which would mostly rank the question types each "
            "approach gets suggested on."
        ),
        "next_step": (
            "Your best running total in this section, not a proven effect. Every difference here is "
            "pulled toward \u201cno difference\u201d until the evidence outweighs the pull, so it moves "
            "slowly and on purpose."
        ),
    }


def _strategy_result(key: str, strategy: dict, values: list[Attempt]) -> dict:
    """One approach's running totals over whatever slice of attempts is passed.

    Deliberately takes the attempt list rather than reading it, so the same
    arithmetic produces the account-wide figure and the per-section figures in
    `_section_reading` instead of the latter being a display-time slice of the
    former.
    """
    prompted = [value for value in values if value.strategy_variant in PROMPT_VARIANTS]
    controls = [value for value in values if value.strategy_variant in CONTROL_VARIANTS]
    applied = sum(value.strategy_applied is True for value in prompted)
    skipped = sum(value.strategy_applied is False for value in prompted)
    # Verified compliance, kept strictly apart from the self-reported kind
    # above. `enforced` is how many prompt-arm questions actually carried a
    # gate, so a rate built from these two is a rate of observed behaviour.
    enforced = sum(value.strategy_gate_status in GATED_STATUSES for value in prompted)
    gate_satisfied = sum(value.strategy_gate_status == STATUS_SATISFIED for value in prompted)
    gate_skipped = sum(value.strategy_gate_status == STATUS_SKIPPED for value in prompted)
    gate_stood_down = sum(value.strategy_gate_status == STATUS_STOOD_DOWN for value in prompted)

    def metrics(sample: list[Attempt]) -> tuple[int, int, int, int | None, int | None, int]:
        if not sample:
            return 0, 0, 0, None, None, 0
        correct = sum(value.is_correct for value in sample)
        adjusted = [
            max(1000, value.server_elapsed_ms - (value.strategy_prompt_ms or 0) - (value.strategy_gate_ms or 0))
            for value in sample
        ]
        pace = sum(
            elapsed <= value.session_item.target_time_seconds * 1000
            for elapsed, value in zip(adjusted, sample)
        )
        graded = [value for value in sample if value.explanation_score is not None]
        explanation = round(sum(value.explanation_score for value in graded) / len(graded) * 100) if graded else None
        return (
            len(sample),
            round(correct / len(sample) * 100),
            round(sum(adjusted) / len(sample) / 1000),
            round(pace / len(sample) * 100),
            explanation,
            correct,
        )

    sample, accuracy, seconds, pace, explanation_mean, correct = metrics(prompted)
    control_sample, control_accuracy, control_seconds, _control_pace, control_explanation_mean, control_correct = metrics(controls)
    lift = accuracy - control_accuracy if sample and control_sample else None
    explanation_lift = (
        explanation_mean - control_explanation_mean
        if explanation_mean is not None and control_explanation_mean is not None
        else None
    )
    posterior = (correct + 1) / (sample + 2)
    ranking_score = posterior * 100 + (pace or 0) * .08 + (lift or 0) * .25 + (explanation_lift or 0) * .15
    return {
        "key": key,
        "title": strategy["title"],
        "plain_title": strategy["plain_title"],
        "plain_subject": strategy["plain_subject"],
        "section": strategy["section"],
        "best_for": strategy["best_for"],
        "sample": sample,
        "accuracy": accuracy,
        "average_seconds": seconds,
        "pace_adherence": pace,
        "control_sample": control_sample,
        "control_accuracy": control_accuracy,
        "control_seconds": control_seconds,
        "lift": lift,
        "explanation_mean": explanation_mean,
        "control_explanation_mean": control_explanation_mean,
        "explanation_lift": explanation_lift,
        "applied": applied,
        "skipped": skipped,
        "enforced": enforced,
        "gate_satisfied": gate_satisfied,
        "gate_skipped": gate_skipped,
        "gate_stood_down": gate_stood_down,
        "required_sample": sum(
            value.strategy_variant == VARIANT_PROMPT_REQUIRED for value in prompted
        ),
        "ranking_score": round(ranking_score, 2),
        **_result_copy(
            strategy, correct, sample, control_correct, control_sample, applied, sample, gate_satisfied, enforced
        ),
    }


def strategy_performance(user_id: str) -> dict:
    """Compare every question assigned to a strategy's prompt arm against every
    question assigned to its control arm — intention-to-treat, the same fix as
    `assign_strategy_trial`. `strategy_applied` is read only to build a
    compliance rate ("you used it on 6 of 9 offers"), never to decide which
    arm an attempt belongs to. See `research/11-measurement-implementation-spec.md`
    § 1 and P0-6 in `research/00-implementation-plan.md`.
    """
    observations = (
        Attempt.query.options(
            # `_strategy_result` reads the target time off every session item and
            # `_section_reading` reads the question's section off every one of
            # them; left lazy that is two statements per attempt on a panel the
            # dashboard renders on every visit.
            joinedload(Attempt.session_item).joinedload(SessionItem.question)
        )
        .filter(
            Attempt.user_id == user_id,
            Attempt.strategy_key.isnot(None),
        ).order_by(Attempt.created_at.asc()).all()
    )
    by_key: dict[str, list[Attempt]] = defaultdict(list)
    for observation in observations:
        by_key[observation.strategy_key].append(observation)

    results = [
        _strategy_result(key, STRATEGIES[key], values)
        for key, values in by_key.items()
        if key in STRATEGIES
    ]

    results.sort(key=lambda result: (result["ranking_score"], result["sample"]), reverse=True)
    # There is deliberately no "strongest"/"confirmed" pick here. A per-student
    # verdict on any one of twelve strategies needs on the order of thousands
    # of observations to detect a realistic effect, which this product will
    # not reach at individual scale — see P0-6. `leader` is only "the approach
    # with the most encouraging running total so far", never a claim that it
    # works.
    leader = next((result for result in results if result["sample"] > 0), None)

    # Recomputed from the section's own attempts rather than filtered out of
    # `results` above. An approach's account-wide totals and its totals inside
    # one section are different numbers whenever it was ever tried outside its
    # catalogue section, and a shrunk difference has to be centred on the
    # section it is being read in.
    by_section: dict[str, list[Attempt]] = defaultdict(list)
    for observation in observations:
        by_section[observation.session_item.question.section].append(observation)

    return {
        "catalog": strategy_catalog(),
        "results": results,
        "leader": leader,
        "sections": [
            _section_reading(section, short_label, by_section.get(section, []))
            for section, short_label in SECTIONS
        ],
        "sections_note": (
            "Logical Reasoning and Reading Comprehension are measured apart because they are "
            "measured on different approaches. Splitting the record also halves the evidence "
            "behind each reading, so each one is shrunk toward \u201cno difference\u201d in proportion "
            "to how thin it is, and neither will name an approach before both sides of the "
            "comparison exist."
        ),
        "trials_completed": sum(result["sample"] + result["control_sample"] for result in results),
        "strategies_tested": sum(result["sample"] > 0 for result in results),
        "intro": (
            "Every question comes with a card, and most of them suggest an approach. We compare how you did on those against the ones that suggested nothing."
        ),
        "empty_state": {
            "title": "Nothing to compare yet.",
            "body": "Answer a few cases. Every question arrives with a card, and most of them name an approach.",
        },
        "catalog_note": (
            "No source guarantees a 170. Official LSAC guidance comes first; the rest are approaches this app tests against your own results."
        ),
        "evidence_note": (
            "We show your running totals, not a verdict. Telling a real personal effect from luck takes far more questions than one person usually "
            "answers, so no approach here is ever labelled \u201cconfirmed\u201d \u2014 including this one, and including the one at the top of this "
            "list. This measures your own practice, not your score."
        ),
    }


# ---------------------------------------------------------------------------
# Reading the trial across students
#
# Everything above this line answers "what is this student's running total?"
# and is careful never to call it a verdict, for a reason the file states in
# `strategy_performance`: a per-student verdict on one of twelve approaches
# needs thousands of observations, which one person will not answer.
#
# The awkward consequence, and the reason this section exists: the app has been
# running a randomised trial whose per-student output it knows is unusable,
# while never computing the estimate the same randomisation fully supports. The
# randomisation needs no repair for it. Arms are drawn independently per
# encounter, the propensity is on the row, intention-to-treat is held
# throughout, and prompt and control labels are kept apart. The only thing
# missing was a query without a `WHERE user_id =` clause.
#
# These functions are that query. Nothing here changes a draw, a card, a
# schedule or a panel. Read them from `tools/audit/strategy_trial_population.py`.
# ---------------------------------------------------------------------------

# A cell needs both arms and enough of each before it is worth printing a
# difference for. Same threshold as the per-student panel, applied to the same
# quantity, so a cohort reading and a personal one are not graded on different
# scales.
POPULATION_MIN_STUDENTS = 2


def _student_stratified(rows: list[Attempt], treated, control) -> dict:
    """The within-student difference, averaged over students.

    The trial randomises *within* a student, so the plain pooled difference is
    already unbiased and this is not a correction for bias. It is a check, and
    a more efficient estimator besides.

    Students differ enormously in accuracy, and they contribute wildly
    different numbers of rows. Pooling therefore weights the overall difference
    toward whoever answered most, and if that student's arm mix happens to be
    lopsided the pooled figure inherits it. Computing each student's own
    prompt-minus-control first, then averaging, cannot do that: every student
    is compared only against themselves.

    The two estimates should agree closely. When they do not, something is
    wrong with the allocation rather than with the approach, and the gap is
    reported beside them rather than resolved by preferring one — a divergence
    is the finding.
    """
    per_student: dict[str, list[Attempt]] = defaultdict(list)
    for row in rows:
        per_student[row.user_id].append(row)

    total_weight = 0.0
    weighted = 0.0
    students = 0
    for values in per_student.values():
        prompted = [value for value in values if treated(value)]
        controls = [value for value in values if control(value)]
        weight = _contrast_sample(len(prompted), len(controls))
        if not weight:
            continue
        students += 1
        total_weight += weight
        weighted += weight * (_arm_rate(prompted) - _arm_rate(controls))
    if not total_weight:
        return {"lift": None, "students": 0, "answers_used": 0}
    used = sum(
        len(values)
        for values in per_student.values()
        if _contrast_sample(
            sum(treated(value) for value in values),
            sum(control(value) for value in values),
        )
    )
    return {
        "lift": round(weighted / total_weight * 100, 1),
        "students": students,
        "answers_used": used,
    }


def _half_width(treated: list[Attempt], control: list[Attempt]) -> float | None:
    """95% half-width, in points, on the difference of the two arms' rates.

    A threshold on the effective sample answers "is this worth printing". It
    does not answer "is this distinguishable from zero", and at cohort scale
    the two come apart badly: `MIN_CONTRAST_SAMPLE` is set for a student's
    running total, and a pooled cell clears it by an order of magnitude while
    still being pure noise. So the cohort readings carry an interval.

    1.96·√(p₁(1−p₁)/n₁ + p₀(1−p₀)/n₀), on the unweighted rates. That is exact
    while the propensity is a constant within the arm, which is the case for
    both draws read here — the Hájek weights cancel and the estimate is the
    plain mean. It would understate the width if a propensity ever varied
    within an arm, and the note beside it says so rather than the interval
    quietly getting it wrong.
    """
    if not treated or not control:
        return None
    variance = 0.0
    for arm in (treated, control):
        rate = sum(1 for value in arm if value.is_correct) / len(arm)
        variance += rate * (1 - rate) / len(arm)
    return round(1.96 * (variance**0.5) * 100, 1)


def _population_cell(rows: list[Attempt], baseline: float) -> dict:
    """One approach in one section, pooled across every student who met it."""
    prompted = [row for row in rows if row.strategy_variant in PROMPT_VARIANTS]
    controls = [row for row in rows if row.strategy_variant in CONTROL_VARIANTS]
    effective = _contrast_sample(len(prompted), len(controls))
    pooled_with = _shrink_toward(_arm_rate(prompted), len(prompted), baseline)
    pooled_without = _shrink_toward(_arm_rate(controls), len(controls), baseline)
    stratified = _student_stratified(
        rows,
        lambda row: row.strategy_variant in PROMPT_VARIANTS,
        lambda row: row.strategy_variant in CONTROL_VARIANTS,
    )
    pooled_lift = round((pooled_with - pooled_without) * 100, 1) if effective else None
    half_width = _half_width(prompted, controls)
    return {
        "sample": len(prompted),
        "control_sample": len(controls),
        "students": len({row.user_id for row in rows}),
        "students_with_both_arms": stratified["students"],
        "contrast_sample": round(effective, 1),
        "contrast_evidence": _contrast_grade(effective),
        "eligible": effective >= MIN_CONTRAST_SAMPLE
        and stratified["students"] >= POPULATION_MIN_STUDENTS,
        "half_width": half_width,
        "separates_from_zero": bool(
            pooled_lift is not None and half_width is not None and abs(pooled_lift) > half_width
        ),
        "pooled_lift": pooled_lift,
        "within_student_lift": stratified["lift"],
        # The two estimators disagreeing is a statement about the allocation,
        # not about the approach. Reported as its own number so it is read.
        "estimator_gap": (
            round(abs(pooled_lift - stratified["lift"]), 1)
            if pooled_lift is not None and stratified["lift"] is not None
            else None
        ),
    }


def strategy_population_reading() -> dict:
    """The trial, read across every student at once, per section and approach.

    Intention-to-treat on the offer, exactly as the per-student panel is: an
    attempt belongs to the arm it was assigned, and `strategy_applied` is not
    consulted. Hájek-weighted by the recorded propensity. Both arms shrunk
    toward the section's own accuracy, which is where they sit if the offer
    changes nothing.

    Sections are kept apart for the reason `strategy_performance` keeps them
    apart — they are measured on different approaches — and never pooled into a
    single number.

    Two estimates per cell rather than one, and the reason is in
    `_student_stratified`. Read-only, with no route and nothing cached.
    """
    observations = (
        Attempt.query.options(
            joinedload(Attempt.session_item).joinedload(SessionItem.question)
        )
        .filter(Attempt.strategy_key.isnot(None))
        .order_by(Attempt.created_at.asc())
        .all()
    )
    by_section: dict[str, list[Attempt]] = defaultdict(list)
    for observation in observations:
        by_section[observation.session_item.question.section].append(observation)

    sections = []
    for section, short_label in SECTIONS:
        rows = by_section.get(section, [])
        trials = len(rows)
        observed = sum(row.is_correct for row in rows) / trials if trials else 0.0
        baseline = shrink_toward_prior(observed, trials)
        by_key: dict[str, list[Attempt]] = defaultdict(list)
        for row in rows:
            by_key[row.strategy_key].append(row)
        results = []
        for key, values in by_key.items():
            strategy = STRATEGIES.get(key)
            if not strategy:
                continue
            results.append(
                {
                    "key": key,
                    "title": strategy["title"],
                    **_population_cell(values, baseline),
                }
            )
        results.sort(
            key=lambda result: (
                result["eligible"],
                result["pooled_lift"] if result["pooled_lift"] is not None else -1e3,
            ),
            reverse=True,
        )
        sections.append(
            {
                "section": section,
                "short_label": short_label,
                "students": len({row.user_id for row in rows}),
                "trials": trials,
                "baseline_accuracy": round(baseline * 100, 1),
                "minimum_contrast_sample": MIN_CONTRAST_SAMPLE,
                "results": results,
                # Two different claims, kept apart the way `_section_reading`
                # keeps them apart. "Measured" means both arms of that cell
                # have filled enough for a difference to be worth printing;
                # it says nothing about the direction. "Leading" is the subset
                # that is ahead *and* whose interval clears zero. A cell can be
                # well measured and level, which is a result rather than an
                # absence of one.
                #
                # The interval, not just the threshold, because the threshold
                # is the per-student one and a pooled cell clears it by an
                # order of magnitude while still being noise. Without the
                # second condition this list named a three-point difference on
                # a ±8-point interval.
                "measured": [result["key"] for result in results if result["eligible"]],
                "leading": [
                    result["key"]
                    for result in results
                    if result["eligible"]
                    and (result["pooled_lift"] or 0) >= 0.5
                    and result["separates_from_zero"]
                ],
            }
        )
    return {
        "students": len({row.user_id for row in observations}),
        "trials": len(observations),
        "sections": sections,
        "basis": (
            "intention-to-treat on the offer, Hájek-weighted by the recorded propensity, "
            "both arms shrunk toward the section's own accuracy, reported per section and "
            "never pooled across them"
        ),
        "note": (
            "A cohort reading. It says nothing about any individual student, and the "
            "per-student panel is unchanged by its existence."
        ),
    }


# ---------------------------------------------------------------------------
# The nested layer: which approach, given that one is offered
# ---------------------------------------------------------------------------


def strategy_selection_reading() -> dict:
    """Ranked selection against uniform selection, inside the treated arm only.

    The restriction is the whole design. A student in the control arm of the
    offer trial is shown no approach, so which approach the selector picked
    changed nothing they experienced; including those rows would add pure noise
    in proportion to the control share and pull any real difference toward
    zero. The arm is drawn in both offer arms — see `assign_strategy_trial` for
    why it must be — and read in one.

    Conditioning here is safe because the two draws are independent by
    construction rather than by inspection: the offer hash no longer contains
    the chosen approach. `strategy_selection_health` is the check on that, and
    it is a per-student check, because the pooled share stays at a healthy
    quarter in exactly the failure that matters.
    """
    rows = (
        Attempt.query.options(
            joinedload(Attempt.session_item).joinedload(SessionItem.question)
        )
        .filter(
            Attempt.strategy_selection_arm.isnot(None),
            Attempt.strategy_variant.in_(PROMPT_VARIANTS),
        )
        .all()
    )
    by_section: dict[str, list[Attempt]] = defaultdict(list)
    for row in rows:
        by_section[row.session_item.question.section].append(row)

    def rate(values):
        return _arm_rate(values, propensity=lambda value: value.strategy_selection_propensity)

    sections = []
    for section, short_label in SECTIONS:
        values = by_section.get(section, [])
        trials = len(values)
        observed = sum(value.is_correct for value in values) / trials if trials else 0.0
        baseline = shrink_toward_prior(observed, trials)
        ranked = [value for value in values if value.strategy_selection_arm == "ranked"]
        uniform = [value for value in values if value.strategy_selection_arm == "uniform"]
        effective = _contrast_sample(len(ranked), len(uniform))
        stratified = _student_stratified(
            values,
            lambda value: value.strategy_selection_arm == "ranked",
            lambda value: value.strategy_selection_arm == "uniform",
        )
        sections.append(
            {
                "section": section,
                "short_label": short_label,
                "trials": trials,
                "students": len({value.user_id for value in values}),
                "ranked_sample": len(ranked),
                "uniform_sample": len(uniform),
                "baseline_accuracy": round(baseline * 100, 1),
                "contrast_sample": round(effective, 1),
                "contrast_evidence": _contrast_grade(effective),
                "eligible": effective >= MIN_CONTRAST_SAMPLE,
                "half_width": _half_width(ranked, uniform),
                "pooled_lift": round(
                    (
                        _shrink_toward(rate(ranked), len(ranked), baseline)
                        - _shrink_toward(rate(uniform), len(uniform), baseline)
                    )
                    * 100,
                    1,
                )
                if effective
                else None,
                "within_student_lift": stratified["lift"],
            }
        )
    for section in sections:
        section["separates_from_zero"] = bool(
            section["pooled_lift"] is not None
            and section["half_width"] is not None
            and abs(section["pooled_lift"]) > section["half_width"]
        )
    return {
        "layer": "strategy_selection",
        "population": "questions in the prompt arm of the offer trial",
        "sections": sections,
        "basis": (
            "intention-to-treat over the selection arm, restricted to offered questions, "
            "Hájek-weighted by the recorded selection propensity"
        ),
    }


def _selection_shares(rows) -> dict:
    """Realised uniform-arm share, split by which offer arm the row was in."""
    per_student: dict[str, dict[str, list[int]]] = defaultdict(
        lambda: {"prompt": [], "control": []}
    )
    for user_id, arm, variant in rows:
        side = "prompt" if variant in PROMPT_VARIANTS else "control"
        per_student[user_id][side].append(arm == "uniform")
    return per_student


def strategy_selection_health() -> dict:
    """Whether the selection draw is still a draw, and still independent.

    Two failures, and the second is the one the structure of this layer was
    argued over.

    *The draw stops drawing.* Per student, because that is the quantity that
    broke last time: the strategy trial's control arm read 25.0% across the
    bank while individual heavy users sat near 2%, and no aggregate could see
    it. `min_uniform_share` is the number.

    *The draw stops being independent of the offer draw.* If the two arms were
    ever coupled — by the offer hash taking the chosen approach back as an
    input, which is exactly what it used to do — then the uniform share inside
    the prompt arm would drift away from the uniform share inside the control
    arm. Both would still average to a healthy quarter overall, which is why
    `pooled_uniform_share` is reported and is not the check. `max_arm_gap` is
    the check: the largest per-student difference between those two shares. It
    should be sampling noise and nothing else.
    """
    rows = (
        db.session.query(
            Attempt.user_id, Attempt.strategy_selection_arm, Attempt.strategy_variant
        )
        .filter(Attempt.strategy_selection_arm.isnot(None))
        .all()
    )
    per_student = _selection_shares(rows)
    draws = len(rows)
    uniform = sum(1 for _user, arm, _variant in rows if arm == "uniform")

    shares = []
    gaps = []
    for sides in per_student.values():
        both = sides["prompt"] + sides["control"]
        if len(both) >= experiments.HEALTH_MIN_DRAWS:
            shares.append(sum(both) / len(both))
        if (
            len(sides["prompt"]) >= experiments.HEALTH_MIN_DRAWS
            and len(sides["control"]) >= experiments.HEALTH_MIN_DRAWS
        ):
            gaps.append(
                abs(
                    sum(sides["prompt"]) / len(sides["prompt"])
                    - sum(sides["control"]) / len(sides["control"])
                )
            )
    design = experiments.LAYERS["strategy_selection"].share("uniform")
    return {
        "layer": "strategy_selection",
        "students": len(per_student),
        "draws": draws,
        "design_uniform_share": round(design, 3),
        "pooled_uniform_share": round(uniform / draws, 3) if draws else None,
        "students_measured": len(shares),
        "min_uniform_share": round(min(shares), 3) if shares else None,
        "max_uniform_share": round(max(shares), 3) if shares else None,
        "students_off_design": sum(
            1 for share in shares if abs(share - design) > experiments.HEALTH_TOLERANCE * design
        ),
        "students_with_both_offer_arms": len(gaps),
        "max_arm_gap": round(max(gaps), 3) if gaps else None,
        "min_draws_for_a_student_reading": experiments.HEALTH_MIN_DRAWS,
        "note": (
            "`max_arm_gap` is the independence check. The pooled share cannot see the "
            "failure it exists for: two coupled draws still average to the design."
        ),
    }
