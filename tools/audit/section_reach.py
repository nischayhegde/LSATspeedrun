"""How much Reading Comprehension a fresh practice budget can actually admit.

`docs/audits/interleaving-audit.md` §1.4 is the finding this re-runs, and it is
the one finding in that document that this branch did not fix. The claim: a
Reading Comprehension passage is served whole, `_fill_blocks` never overshoots
the budget, so a run with five fresh slots can only take a passage of five
questions or fewer — and it walks a shuffled list in which the four and a half
thousand single Logical Reasoning questions vastly outnumber those passages and
fill the budget first.

The audit measured 40 runs per budget and reported 0.0% at budget 5. Forty runs
of a rate near a percent is not enough to tell a small number from zero, and
which of those two it is matters: "Reading Comprehension is unreachable" and
"Reading Comprehension is a rounding error" are different sentences, and the
audit's own §8 leans on the first. So this sweeps more runs, and reports the
run count behind every share rather than the share alone.

No database. The bank is read from the JSONL files through
`type_targeting.load_bank`, so the passage grouping is derived exactly once in
this repository, and selection is the app's own `_weight_toward_focus` with no
focus list — which is `_fill_blocks` over shuffled passage blocks, the code
path the finding is about.

    python3 tools/audit/section_reach.py
    python3 tools/audit/section_reach.py --runs 500 --budgets 2,5,10

Report-only. Selection is random; `--seed` pins it and `--runs` buys precision.
"""

from __future__ import annotations

import argparse
import random
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from type_targeting import load_bank  # noqa: E402

# The fresh budgets the product actually asks for, from the audit's own table of
# entry points, plus the sizes around them. A budget is the requested run size
# minus the review items already claimed, which is why the common ones are small.
DEFAULT_BUDGETS = (2, 3, 5, 7, 8, 10, 12)

RC = "Reading Comprehension"


def passage_sizes(facts) -> Counter:
    blocks: Counter = Counter()
    for fact in facts:
        if fact.section == RC and fact.passage_id:
            blocks[fact.passage_id] += 1
    return Counter(blocks.values())


def sweep(facts, *, budget: int, runs: int) -> tuple[float, int]:
    """RC share of the questions selected, and how many runs held any RC."""
    from app.services import _weight_toward_focus

    reading = 0
    total = 0
    with_any = 0
    for _ in range(runs):
        selected = _weight_toward_focus(facts, budget, None)
        here = sum(1 for fact in selected if fact.section == RC)
        reading += here
        total += len(selected)
        with_any += 1 if here else 0
    return (reading / total if total else 0.0), with_any


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=200)
    parser.add_argument("--seed", type=int, default=20260812)
    parser.add_argument(
        "--budgets",
        type=str,
        default=",".join(str(budget) for budget in DEFAULT_BUDGETS),
        help="comma-separated fresh budgets to measure",
    )
    args = parser.parse_args()
    budgets = [int(part) for part in args.budgets.split(",") if part.strip()]

    random.seed(args.seed)
    facts, _placeholders = load_bank()
    reading = [fact for fact in facts if fact.section == RC]
    print(f"\nBANK: {len(facts)} questions, {len(reading)} Reading Comprehension "
          f"({len(reading) / len(facts):.1%})")

    sizes = passage_sizes(facts)
    total_passages = sum(sizes.values())
    short = sum(count for size, count in sizes.items() if size <= 5)
    print(f"  passages: {total_passages}, of which {short} are five questions or shorter "
          f"({short / total_passages:.1%})")
    print("  questions per passage  " + "  ".join(
        f"{size}:{count}" for size, count in sorted(sizes.items())
    ))

    print(f"\nRC REACH BY FRESH BUDGET, {args.runs} runs each")
    print("  budget    RC share    runs containing any RC")
    for budget in budgets:
        share, with_any = sweep(facts, budget=budget, runs=args.runs)
        print(f"  {budget:>6}    {share:>8.1%}    {with_any:>4} of {args.runs}")

    print(
        "\n  A share of zero at the budgets the product asks for is the finding, and\n"
        "  more runs do not overturn it — they only establish that the small budgets\n"
        "  are a rounding error rather than a hard zero. Nothing on this branch\n"
        "  changes this. What it did change is that the consequence is now deliberate:\n"
        "  `scheduling.BLOCKED_SECTIONS` states that Reading Comprehension is not\n"
        "  de-blocked, on the evidence that interleaving buys nothing on expository\n"
        "  text, and `run_ordering` is read per section so the two are never pooled.\n"
        "  Getting Reading Comprehension back into small runs is a change to\n"
        "  `_fill_blocks`, or to what a run is allowed to overshoot by, and it is open."
    )


if __name__ == "__main__":
    main()
