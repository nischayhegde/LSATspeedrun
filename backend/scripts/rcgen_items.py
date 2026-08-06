"""Generate LSAT-style Reading Comprehension items from condensed passages.

Three of the acceptance tests in `07-corpus-reference-distribution.md` are
controlled structurally here rather than left to the model, because an LLM left
to itself reliably fails them:

  answer key balance   The model returns `correct` and `distractors` as separate
                       fields and never sees a position. This script assigns the
                       index from a pre-balanced schedule, so key balance is
                       exact by construction rather than hoped for. LLMs have a
                       documented positional bias and will otherwise pile
                       correct answers into position C.
  question type mix    Types are allocated from a schedule matching the real
                       distribution (inference 20.3%, main idea 14.2%,
                       structure 10.8%, detail 9.6%, attitude 7.0%, ...) and one
                       type is handed to the model per question, rather than
                       letting it choose and over-produce the easy ones.
  negation stems       Held near the real 4.7% by the same schedule.

Length parity and quantifier polarity cannot be imposed structurally and are
prompted for, then measured by `corpus_stats.py`.

Usage:
    python rcgen_items.py --passages /tmp/rcgen/passages_final.jsonl \
        --out /tmp/rcgen/items.jsonl --per-passage 7
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from rcgen_llm import chat, spend_summary  # noqa: E402

# Shares of RC items by type, from the 2,366-item baseline. The published
# figures cover the 68.3% that stem-regex could classify; they are renormalized
# here because every generated item must be given some type.
TYPE_SHARES = {
    "inference": 20.3,
    "main_idea": 14.2,
    "structure": 10.8,
    "detail": 9.6,
    "attitude": 7.0,
    "analogy": 2.8,
    "strengthen_weaken": 2.3,
    "vocabulary": 1.6,
}
NEGATION_RATE = 0.047

TYPE_BRIEF = {
    "inference": "asks what the passage supports or implies but does not state outright",
    "main_idea": "asks for the main point or primary purpose of the passage as a whole",
    "structure": "asks about organization, or the function a paragraph or phrase serves in the argument",
    "detail": "asks what the passage explicitly states; answerable by locating one place in the text",
    "attitude": "asks about the author's stance toward a position, or how the author would regard something",
    "analogy": "asks which situation is most analogous to something described in the passage",
    "strengthen_weaken": "asks what would most strengthen or most undermine a claim in the passage",
    "vocabulary": "asks what a specific word or phrase means as it is used in the passage",
}

SYSTEM = """You write Reading Comprehension items for a standardized law school admission test.

You are given a passage, a question type, and whether the stem must be a negation
stem. Write ONE item of exactly that type.

THE ANSWER MUST DEPEND ON THE PASSAGE. This is the requirement that matters most.
A competent reader who has NOT read the passage must be unable to identify the
correct answer. Therefore:
- The correct answer must never be the choice that is most obviously true,
  most reasonable, or most agreeable in general. It must be correct only because
  the passage says or implies it.
- Distractors must be plausible, on-topic and internally sensible. A distractor
  that is absurd, off-topic, or self-evidently false is wasted.
- Distractors must fail for passage-specific reasons: they distort a stated
  relation, overstate a qualified claim, attribute a view to the wrong party,
  reverse a causal direction, or state something the passage never addresses.

EXACTLY ONE ANSWER IS DEFENSIBLE. Before returning, check each distractor and
confirm you can name the specific words in the passage that rule it out. If two
choices are defensible, rewrite one.

LENGTH PARITY. In real items the correct answer carries no length advantage
(Cohen's d = 0.026). The correct answer must NOT be the longest choice. Keep all
five choices within a few words of each other, around 15 words each.

QUANTIFIER POLARITY. In real items an isolated absolute marks a WRONG answer:
when exactly one choice contains an extreme quantifier, that choice is correct
only 16% of the time. So when you use "all", "never", "only", "every", "must",
"cannot", "none" or "always", put it in a DISTRACTOR, as the over-strong trap
that a careless reader picks. The correct answer should be qualified and
hedged ("some", "may", "tends to", "in part").

STEM. Around 18 words. Use conventional test phrasing for the assigned type.

Return JSON:
{"stem": "...", "correct": "...", "distractors": ["...", "...", "...", "..."],
 "why_correct": "brief citation of the passage words that make it correct",
 "why_wrong": ["...", "...", "...", "..."]}"""


# The v1 prompt above tells the model to make the item passage-dependent and it
# does not comply: four independent solvers recovered the credited answer from
# the choices alone on 91.3% of v1 items, against 61.9% on real LSAT items.
# The diagnosis is that v1 asks for distractors that are "plausible" but still
# builds them by corrupting a known-correct answer, which leaves the correct
# choice as the only internally coherent statement in the set. v2 inverts the
# construction order: write five mutually exclusive claims that are equally
# plausible to someone who has not read the passage, and only then decide which
# one the passage supports.
SYSTEM_V2 = """You write Reading Comprehension items for a standardized law school admission test.

You are given a passage, a question type, and whether the stem must be a negation stem.

THE ONE THING THAT MATTERS: a reader who has NOT read the passage must be unable
to tell which choice is credited. Four independent AI models will be shown your
stem and choices with the passage deleted. If they can pick the right answer,
the item is worthless. Assume they are very good at spotting the "sensible" choice.

CONSTRUCT THE ITEM IN THIS ORDER. Do not skip to the answer.

Step 1. Identify the point in the passage the question will test.

Step 2. Write FIVE mutually exclusive claims about that point, BEFORE deciding
which is correct. Every one of the five must be:
  - a claim this passage could plausibly have made, on this topic, in this register;
  - true-sounding in general, or at least not obviously false to an informed reader;
  - the same kind of statement as the others - same grammatical shape, same
    specificity, same degree of hedging, same length;
  - non-overlapping, so that at most one can be right given the passage.

Step 3. NOW decide which of the five the passage actually supports, and confirm
the other four are ruled out by specific passage words.

Step 4. Adversarial check. Cover the passage and read only the stem and the five
choices. Ask: would a smart reader who never saw the passage pick the credited
one? If yes, you have failed. The usual causes and their fixes:
  - The credited answer is the most measured, balanced or reasonable statement.
    FIX: make a distractor equally measured, and the credited answer no more
    hedged than the rest.
  - Distractors are extreme, absolute, or obviously overreaching. FIX: soften
    them. A distractor should be wrong because THIS passage says otherwise, not
    because it is self-evidently too strong.
  - Distractors contradict common knowledge. FIX: make them consistent with the
    world and inconsistent only with the passage.
  - The credited answer is the only one that fully addresses the stem. FIX: make
    all five directly responsive to the stem.
If a distractor is wrong only because the passage happens not to mention it,
that is acceptable and desirable: it is undetectable without the passage.

LENGTH PARITY. All five choices within a few words of each other, around 15
words. The credited answer must not be the longest.

QUANTIFIER POLARITY. If any choice contains an absolute ("all", "never",
"only", "every", "must"), it should usually be a distractor - but do not make
this mechanical, since an absolute in every distractor set is itself a cue.

STEM. Around 18 words, conventional phrasing for the assigned type.

Return JSON:
{"stem": "...", "correct": "...", "distractors": ["...", "...", "...", "..."],
 "why_correct": "the passage words that make it correct",
 "why_wrong": ["...", "...", "...", "..."],
 "blind_check": "why a reader without the passage could not pick the credited answer"}"""

PROMPTS = {"v1": SYSTEM, "v2": SYSTEM_V2}


def build_schedule(n_items: int, seed: int = 20260802) -> tuple[list[str], list[int], list[bool]]:
    """Pre-allocate type, correct-answer index and negation flag for every item."""
    rng = random.Random(seed)

    total = sum(TYPE_SHARES.values())
    types: list[str] = []
    for name, share in TYPE_SHARES.items():
        types.extend([name] * round(n_items * share / total))
    ordered = list(TYPE_SHARES)
    i = 0
    while len(types) < n_items:
        types.append(ordered[i % len(ordered)])
        i += 1
    types = types[:n_items]
    rng.shuffle(types)

    # Equal counts per position, shuffled: chi-square against uniform is then
    # as close to zero as the item count permits.
    labels = [i % 5 for i in range(n_items)]
    rng.shuffle(labels)

    n_neg = round(n_items * NEGATION_RATE)
    negations = [True] * n_neg + [False] * (n_items - n_neg)
    rng.shuffle(negations)
    # Main-idea and vocabulary stems are not written as negations in practice.
    for i, t in enumerate(types):
        if t in {"main_idea", "vocabulary"} and negations[i]:
            negations[i] = False
    return types, labels, negations


def gen_item(passage_rec: dict, qtype: str, label: int, negation: bool, idx: int,
             prompt: str = "v1") -> dict | None:
    payload = {
        "passage": passage_rec["passage"],
        "question_type": qtype,
        "question_type_meaning": TYPE_BRIEF[qtype],
        "use_negation_stem": negation,
        "negation_instruction": (
            "The stem must use EXCEPT, NOT or LEAST, so that four choices satisfy "
            "the stem and one does not." if negation else "Do not use a negation stem."
        ),
    }
    try:
        obj, _ = chat(PROMPTS[prompt], payload, tag=f"items_{prompt}", max_tokens=5000)
    except Exception as exc:  # noqa: BLE001
        print(f"  FAIL {passage_rec['passage_id']} {qtype}: {exc}", file=sys.stderr)
        return None

    stem = (obj.get("stem") or "").strip()
    correct = (obj.get("correct") or "").strip()
    distractors = [str(d).strip() for d in (obj.get("distractors") or []) if str(d).strip()]
    if not stem or not correct or len(distractors) != 4:
        return None

    # The model never learns the position; it is imposed here.
    answers = list(distractors)
    answers.insert(label, correct)

    return {
        "id_string": f"20260{(idx % 9) + 1}0{idx % 10}{idx:05d}",
        "item_id": f"{passage_rec['passage_id']}-q{idx}",
        "passage_id": passage_rec["passage_id"],
        "context": passage_rec["passage"],
        "question": stem,
        "answers": answers,
        "label": label,
        "question_type": qtype,
        "negation": negation,
        "prompt_version": prompt,
        "blind_check": obj.get("blind_check"),
        "why_correct": obj.get("why_correct"),
        "why_wrong": obj.get("why_wrong"),
        "domain": passage_rec.get("domain"),
        "attribution": passage_rec.get("attribution"),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--passages", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--per-passage", type=int, default=7)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--prompt", choices=["v1", "v2"], default="v1")
    args = ap.parse_args()

    passages = [json.loads(l) for l in Path(args.passages).read_text(encoding="utf-8").splitlines() if l.strip()]
    if args.limit:
        passages = passages[: args.limit]
    n_items = len(passages) * args.per_passage
    types, labels, negations = build_schedule(n_items)
    print(f"generating {n_items} items over {len(passages)} passages")

    jobs = []
    for pi, prec in enumerate(passages):
        for qi in range(args.per_passage):
            k = pi * args.per_passage + qi
            jobs.append((prec, types[k], labels[k], negations[k], k, args.prompt))

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(lambda j: gen_item(*j), jobs))
    items = [r for r in results if r]

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as fh:
        for it in items:
            fh.write(json.dumps(it, ensure_ascii=False) + "\n")
    print(f"wrote {len(items)}/{n_items} items to {out}")

    # corpus_stats.py consumes only the five canonical fields.
    slim = out.with_name(out.stem + "_slim.jsonl")
    with slim.open("w", encoding="utf-8") as fh:
        for it in items:
            fh.write(json.dumps({k: it[k] for k in
                                 ("context", "question", "answers", "label", "id_string")},
                                ensure_ascii=False) + "\n")
    print(f"wrote {slim}")
    print("spend:", json.dumps(spend_summary(), indent=2))


if __name__ == "__main__":
    main()
