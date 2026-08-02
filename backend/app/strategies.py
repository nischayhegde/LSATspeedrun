from __future__ import annotations

import hashlib
from collections import defaultdict

from .models import Attempt, Question


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


def _candidate_keys(question: Question) -> list[str]:
    question_type = (question.question_type or "").lower()
    stem = (question.stem or "").lower()
    if question.section == "Reading Comprehension":
        passage_text = (question.passage.canonical_text or "").lower() if question.passage else ""
        candidates = ["passage_map", "textual_proof"]
        if "compar" in question_type or (question.passage and "compar" in (question.passage.passage_type or "").lower()):
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


def assign_strategy_trial(
    user_id: str,
    question: Question,
    practice_style: str,
    position: int,
    *,
    focus_types: list[str] | None = None,
) -> dict | None:
    """Assign a balanced within-student strategy trial on every question.

    The mega-litigation stays a clean measurement surface and gets no trial.
    Early trials force coverage across the candidate approaches; later trials
    favor the best posterior performer while preserving a challenger and an
    invisible 25% control condition.

    The old cadence exposed one trial every four questions so that Sprint and
    Infinite could stay clean measurement surfaces. With the diagnostic as the
    only such surface, that reason is gone, and trialling every question makes
    the prompt-versus-control comparison converge about four times faster.

    `focus_types` are the question types the last mega-litigation marked weak.
    On those, coverage runs longer before the trial starts exploiting its
    leader: a wrong early winner is most costly exactly where the student is
    weakest, and that is where the extra exploration buys the most.
    """
    if practice_style == "diagnostic":
        return None
    candidates = _candidate_keys(question)
    observations = (
        Attempt.query.filter(
            Attempt.user_id == user_id,
            Attempt.strategy_key.in_(candidates),
            Attempt.strategy_variant == "prompt",
            Attempt.strategy_applied.is_(True),
        ).all()
    )
    grouped: dict[str, list[Attempt]] = defaultdict(list)
    for observation in observations:
        grouped[observation.strategy_key].append(observation)

    seed = f"{user_id}:{question.id}:{position}:{practice_style}"
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
                max(1, value.server_elapsed_ms - (value.strategy_prompt_ms or 0)) / 1000
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

    variant = "control" if _stable_fraction(f"control:{seed}:{key}") < .25 else "prompt"
    return {"key": key, "variant": variant}


def _plain_count(accuracy: int, sample: int, suffix: str) -> tuple[str, str]:
    if not sample:
        return "—", f"no questions {suffix} yet"
    return f"{accuracy}%", f"{sample} question{'' if sample == 1 else 's'} {suffix}"


def _result_copy(
    strategy: dict,
    status: str,
    lift: int | None,
    accuracy: int,
    control_accuracy: int,
    sample: int,
    control_sample: int,
    seconds: int,
) -> dict:
    """Author every student-facing sentence about one approach.

    The three internal evidence tiers collapse to two words here, so the
    dashboard never has to explain a sample threshold and the frontend never
    has to assemble a claim about the student's own results.
    """
    subject = strategy["plain_subject"]
    verdict = "confirmed" if status == "supported" else "checking"
    helping = (lift or 0) > 0
    if verdict == "confirmed":
        summary = f"{subject} is helping you." if helping else f"{subject} is not helping you."
        next_step = "Keep using it when it comes up." if helping else "Feel free to skip it when it comes up."
    elif lift is None:
        summary = f"Too early to tell whether {subject[0].lower()}{subject[1:]} helps you."
        next_step = "A few more questions will make this clearer."
    elif helping:
        summary = f"{subject} might be helping you."
        next_step = "A few more questions will make this clearer."
    else:
        summary = f"{subject} has not made a difference yet."
        next_step = "A few more questions will make this clearer."

    if sample and control_sample:
        detail = f"You get {accuracy}% right with it and {control_accuracy}% right without it on similar questions."
    elif sample:
        detail = f"You get {accuracy}% right with it. There are not enough similar questions without it to compare yet."
    else:
        detail = "You have not answered a question with it yet."

    with_headline, with_note = _plain_count(accuracy, sample, "with it")
    without_headline, without_note = _plain_count(control_accuracy, control_sample, "without it")
    if lift is None:
        difference_headline, difference_note = "—", "waiting on questions without it"
    else:
        difference_headline = f"{'+' if lift > 0 else ''}{lift} points"
        difference_note = f"{seconds}s average with it"

    return {
        "verdict": verdict,
        "verdict_label": "confirmed" if verdict == "confirmed" else "still checking",
        "summary": summary,
        "detail": detail,
        "next_step": next_step,
        "with_headline": with_headline,
        "with_note": with_note,
        "without_headline": without_headline,
        "without_note": without_note,
        "difference_headline": difference_headline,
        "difference_note": difference_note,
    }


def strategy_performance(user_id: str) -> dict:
    observations = (
        Attempt.query.filter(
            Attempt.user_id == user_id,
            Attempt.strategy_key.isnot(None),
        ).order_by(Attempt.created_at.asc()).all()
    )
    by_key: dict[str, list[Attempt]] = defaultdict(list)
    for observation in observations:
        by_key[observation.strategy_key].append(observation)

    results = []
    for key, values in by_key.items():
        strategy = STRATEGIES.get(key)
        if not strategy:
            continue
        prompted = [value for value in values if value.strategy_variant == "prompt" and value.strategy_applied is True]
        controls = [value for value in values if value.strategy_variant == "control"]
        skipped = sum(value.strategy_variant == "prompt" and value.strategy_applied is False for value in values)

        def metrics(sample: list[Attempt]) -> tuple[int, int, int, int | None, int | None]:
            if not sample:
                return 0, 0, 0, None, None
            correct = sum(value.is_correct for value in sample)
            adjusted = [max(1000, value.server_elapsed_ms - (value.strategy_prompt_ms or 0)) for value in sample]
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
            )

        sample, accuracy, seconds, pace, explanation_mean = metrics(prompted)
        control_sample, control_accuracy, control_seconds, _control_pace, control_explanation_mean = metrics(controls)
        status = "forming" if sample < 4 or control_sample < 2 else "directional" if sample < 8 or control_sample < 4 else "supported"
        lift = accuracy - control_accuracy if sample and control_sample else None
        explanation_lift = (
            explanation_mean - control_explanation_mean
            if explanation_mean is not None and control_explanation_mean is not None
            else None
        )
        posterior = (sum(value.is_correct for value in prompted) + 1) / (sample + 2)
        ranking_score = posterior * 100 + (pace or 0) * .08 + (lift or 0) * .25 + (explanation_lift or 0) * .15
        results.append(
            {
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
                "skipped": skipped,
                "status": status,
                "ranking_score": round(ranking_score, 2),
                **_result_copy(strategy, status, lift, accuracy, control_accuracy, sample, control_sample, seconds),
            }
        )

    results.sort(key=lambda result: (result["ranking_score"], result["sample"]), reverse=True)
    strongest = next((result for result in results if result["status"] == "supported"), None)
    leader = (
        strongest
        or next((result for result in results if result["status"] == "directional"), None)
        or next((result for result in results if result["sample"] > 0), None)
    )
    return {
        "catalog": strategy_catalog(),
        "results": results,
        "leader": leader,
        "trials_completed": sum(result["sample"] + result["control_sample"] for result in results),
        "strategies_tested": sum(result["sample"] > 0 for result in results),
        "strongest": strongest,
        "intro": (
            "Some questions come with a suggested approach. We compare how you did on those against similar questions where nothing was suggested."
        ),
        "empty_state": {
            "title": "Nothing to compare yet.",
            "body": "Answer a few cases. Every question arrives with a suggested approach.",
        },
        "catalog_note": (
            "No source guarantees a 170. Official LSAC guidance comes first; the rest are approaches this app tests against your own results."
        ),
        "evidence_note": (
            "An approach is only called confirmed after at least eight questions with it and four without. This measures your own practice, not your score."
        ),
    }
