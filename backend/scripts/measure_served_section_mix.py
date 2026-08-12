"""Measure what the general filler serves, and what it therefore costs in time.

**Superseded in part; read this first.** This script models one code path,
`_fill_blocks` over a mixed pool, and that path is no longer how Reading
Comprehension reaches a student. Practice now builds one of two case shapes: an
argument case, which is Logical Reasoning only, and a reading case, which is one
whole passage. The mixed fill this measures is what a type-filtered drill uses,
and it is the *reason* the reading case exists -- the tables below are the
evidence that no allowance over a mixed pool was ever going to be enough.

For what a student is actually served, use `tools/audit/rc_reachability_probe.py`,
which builds real runs through `create_study_session` and reads their recorded
pace budgets rather than modelling them. Measured there: 33.7% Reading
Comprehension and 154.5 s/question.

**What the mixed fill serves.** A Reading Comprehension question is not a
question on its own -- the passage is most of the work -- so passage-mates form
one indivisible block (`services._passage_blocks`). A run is filled with whole
blocks, so a run that may never exceed its target can only ever serve a passage
*shorter* than the target. RC passages in this bank run 4 to 16 questions with a
median of 7. At the ten-question run this app used to serve that cost almost
nothing; at six it strands most of Reading Comprehension, which is why
`services.PASSAGE_OVERSHOOT_ALLOWANCE` exists -- and why, on its own, the
allowance was not enough. Widening the crack a passage has to squeeze through
still leaves it squeezing.

**What a question costs in wall-clock time.** `services._target_time_seconds`
budgets 150s for a Logical Reasoning question, 330s for the first question on an
RC passage and 135s for each follow-up on the same passage. The average over a
run therefore depends entirely on the served mix -- which is *not* the catalog
mix. The catalog is 66% LR and 34% RC by question count, but blocks are what get
drawn and there are 4,520 single-question LR blocks against 349 RC blocks, so a
shuffled draw is overwhelmingly LR. Measured, a ten-question run serves about
17.8% RC, not 34%.

That gap matters beyond this script: `simulate_economy_curve.py` converts played
cases to hours at 210.5s, which is `.66 * 150 + .34 * 328` -- the *catalog* mix.
Against what is really served the figure is 154.5s, so every hour that script
quotes is roughly 36% high. See its docstring; the constant is deliberately not
changed there, because it is the figure the shipped pace band was tuned against
and moving it would repace the whole ladder rather than measure it.

Reads the question bank from disk, so it needs no database and no seeded app.

Run with:
    .venv/bin/python -m scripts.measure_served_section_mix
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import random
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import (  # noqa: E402
    QuestionFact,
    _fill_blocks,
    _passage_blocks,
    passage_overshoot_allowance,
)

BANK = Path(__file__).resolve().parents[1] / "data" / "question_bank"
# The two sections the bank ships, and the folder each lives in.
SECTIONS = {"lsat-lr": "Logical Reasoning", "lsat-rc": "Reading Comprehension"}


def load_bank(root: Path = BANK) -> list[QuestionFact]:
    """The bank as the selector sees it: id, passage, section.

    `passage_id` is derived the way `seed._ingest_row` derives it, a hash of the
    passage text, so passages group here exactly as they group in the database.
    """
    facts: list[QuestionFact] = []
    for folder, section in SECTIONS.items():
        for path in sorted((root / folder).glob("*.jsonl")):
            with path.open() as handle:
                for line in handle:
                    row = json.loads(line)
                    passage_id = None
                    if section == "Reading Comprehension":
                        digest = hashlib.sha256(row["context"].encode("utf-8")).hexdigest()[:24]
                        passage_id = f"hf-rc-passage:{digest}"
                    facts.append(QuestionFact(row["id_string"], None, passage_id, section))
    return facts


def target_time_seconds(run: list[QuestionFact]) -> int:
    """The clock a run is served with, per `services.create_study_session`."""
    total = 0
    previous_passage = None
    for question in run:
        if question.section == "Logical Reasoning":
            total += 150
        else:
            total += 135 if question.passage_id and question.passage_id == previous_passage else 330
        previous_passage = question.passage_id
    return total


def build_run(blocks: list[list[QuestionFact]], count: int, allowance: int) -> list[QuestionFact]:
    """One unfocused practice run, through the shipped fill.

    Mirrors the no-focus branch of `_weight_toward_focus`: shuffle the blocks,
    fill to the budget, then shuffle what was chosen. The focus branch is a bias
    over the same blocks and does not change the section mix, since focus types
    are Logical Reasoning categories that RC blocks also carry.
    """
    order = list(blocks)
    random.shuffle(order)
    selected: list[list[QuestionFact]] = []
    _fill_blocks(order, count, selected, ceiling=count + allowance)
    if not selected and order:
        selected.append(min(order, key=len))
    random.shuffle(selected)
    return [question for block in selected for question in block]


def measure(blocks: list[list[QuestionFact]], count: int, allowance: int, runs: int) -> dict:
    generated = [build_run(blocks, count, allowance) for _ in range(runs)]
    questions = sum(len(run) for run in generated)
    rc = sum(1 for run in generated for question in run if question.section != "Logical Reasoning")
    seconds = sum(target_time_seconds(run) for run in generated)
    lengths = sorted(len(run) for run in generated)
    return {
        "count": count,
        "allowance": allowance,
        "questions_per_run": questions / len(generated),
        "rc_share": rc / questions,
        "seconds_per_question": seconds / questions,
        "minutes_per_run": seconds / len(generated) / 60,
        "shortest": lengths[0],
        "longest": lengths[-1],
    }


def passage_report(facts: list[QuestionFact]) -> None:
    sizes = collections.Counter()
    for question in facts:
        if question.passage_id:
            sizes[question.passage_id] += 1
    histogram = collections.Counter(sizes.values())
    rc_questions = sum(sizes.values())
    print(
        f"Reading Comprehension: {len(sizes)} passages, {rc_questions} questions, "
        f"{statistics.mean(sizes.values()):.2f} per passage (median "
        f"{statistics.median(sizes.values()):.0f})"
    )
    print("  passage sizes:", ", ".join(f"{size}x{n}" for size, n in sorted(histogram.items())))
    print("  reachable when a run may not exceed N questions:")
    for ceiling in range(4, 12):
        fits = sum(count for count in sizes.values() if count <= ceiling)
        print(
            f"    N={ceiling:>2}: {sum(1 for c in sizes.values() if c <= ceiling):>3}/{len(sizes)} "
            f"passages, {fits:>5}/{rc_questions} RC questions ({fits / rc_questions:.1%})"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=4000, help="generated runs per setting")
    parser.add_argument("--seed", type=int, default=20260811)
    args = parser.parse_args()

    facts = load_bank()
    if not facts:
        print(f"no question bank under {BANK}", file=sys.stderr)
        return 1
    blocks = _passage_blocks(facts)
    print(f"bank: {len(facts)} questions in {len(blocks)} indivisible blocks")
    passage_report(facts)

    random.seed(args.seed)
    print(f"\n{args.runs} generated runs per setting\n")
    print(
        f"{'run':<26}{'q/run':>8}{'range':>9}{'RC%':>8}{'s/q':>8}{'min/run':>9}"
    )
    settings = [
        ("10, no allowance (was)", 10, 0),
        ("6, no allowance", 6, 0),
        ("5, no allowance", 5, 0),
        ("5, allowance 3", 5, 3),
        ("6, allowance 2 (shipped)", 6, passage_overshoot_allowance(6)),
        ("6, allowance 4", 6, 4),
        ("7, allowance 2", 7, 2),
    ]
    for label, count, allowance in settings:
        row = measure(blocks, count, allowance, args.runs)
        print(
            f"{label:<26}{row['questions_per_run']:>8.2f}"
            f"{f'{row['shortest']}-{row['longest']}':>9}{row['rc_share']:>8.1%}"
            f"{row['seconds_per_question']:>8.1f}{row['minutes_per_run']:>9.1f}"
        )

    was = measure(blocks, 10, 0, args.runs)
    now = measure(blocks, 6, passage_overshoot_allowance(6), args.runs)
    drift = now["seconds_per_question"] / was["seconds_per_question"] - 1
    print(
        f"\nwall-clock per question: {was['seconds_per_question']:.1f}s -> "
        f"{now['seconds_per_question']:.1f}s ({drift:+.1%}). The campaign is a fixed number "
        f"of questions, so this is the whole of its change in length."
    )
    print(
        f"catalog mix would be 34.0% RC and 210.5 s/q; the selector serves "
        f"{was['rc_share']:.1%} and {was['seconds_per_question']:.1f} s/q."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
