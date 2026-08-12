"""What `question_type` says about the bank, before and after the rules changed.

Report-only, and it touches no database: the bank ships in the repository as
JSONL under `backend/data/question_bank`, and that snapshot is what
`app.seed` ingests, so classifying it here measures exactly what a re-seed
would write. Nothing else in the audit set can be run without a copy of
somebody's data.

    python3 tools/audit/question_type_coverage.py
    python3 tools/audit/question_type_coverage.py --rule inference --samples 25

Three readings, and the third is the one that catches mistakes.

**Coverage.** How many questions carry a type that is merely their section's
name. This is the headline number and it is a floor, not a score: a rule that
guesses wrong improves it just as much as a rule that guesses right.

**Movement.** Which types rows left and arrived at. A change meant to fill an
empty bucket that also relabels 400 questions that already had a type has done
two things, and only one of them was asked for.

**What each rule *newly* matches.** For every rule, how many stems it claims,
how many of those were previously untyped, how many it took from another type,
and a sample of each. Reading the "newly matched" list is the only way to catch
a rule that widened past its family — the strategy-matching work found seven
over-reaches that way, and none of them were visible in the coverage number,
because an over-reach improves coverage.

The "before" rules are frozen into this file on purpose. An audit needs a fixed
reference point, and importing the live module for both sides would quietly
redefine the baseline every time the rules move.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))

from app.question_types import SOURCE_PLACEHOLDER, classify, rules_for  # noqa: E402

BANK = REPO / "backend" / "data" / "question_bank"
DATASETS = (("lsat-lr", "Logical Reasoning"), ("lsat-rc", "Reading Comprehension"))
SPLITS = ("train", "validation", "test")

# `seed._question_type` as it stood at 82acaf6, before this work. Frozen so the
# baseline cannot drift under the comparison.
BEFORE_RULES = {
    "Reading Comprehension": (
        (r"main (?:idea|point|purpose)|primarily concerned", "Main Point"),
        (r"author.*attitude|tone of the passage", "Author's Perspective"),
        (r"function|role played|serves primarily to", "Function"),
        (r"infer|suggest|most strongly support", "Inference"),
        (r"analog|similar|parallel", "Analogy"),
    ),
    "Logical Reasoning": (
        (r"most strengthens|strengthen", "Strengthen"),
        (r"most weakens|weaken|cast doubt", "Weaken"),
        (r"assumption|required by|depends on", "Assumption"),
        (r"flaw|vulnerable to criticism", "Flaw"),
        (r"parallel|most like|similar.*reasoning", "Parallel Reasoning"),
        (r"must (?:also )?be true|properly inferred|most strongly supported", "Inference"),
        (r"principle", "Principle"),
        (r"resolve|reconcile|explain", "Resolve the Paradox"),
        (r"main conclusion|main point", "Main Conclusion"),
        (r"role played|method.*reasoning|argument proceeds", "Argument Structure"),
    ),
}


def before_type(section: str, stem: str) -> str:
    value = stem.casefold()
    for pattern, name in BEFORE_RULES[section]:
        if re.search(pattern, value):
            return name
    return section


def read_bank() -> list[tuple[str, str]]:
    rows = []
    for slug, section in DATASETS:
        for split in SPLITS:
            path = BANK / slug / f"{split}.jsonl"
            if not path.is_file():
                print(f"  (missing {path.relative_to(REPO)})")
                continue
            with path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    stem = (json.loads(line).get("question") or "").strip()
                    if stem:
                        rows.append((section, stem))
    return rows


def _share(part: int, whole: int) -> str:
    return f"{part} ({part / whole * 100:.1f}%)" if whole else "0"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=6, help="stems to print per rule")
    parser.add_argument("--rule", help="print every newly matched stem for one rule")
    args = parser.parse_args()

    rows = read_bank()
    if not rows:
        raise SystemExit("no question bank snapshot found")

    before_counts: Counter[tuple[str, str]] = Counter()
    after_counts: Counter[tuple[str, str]] = Counter()
    placeholders = {"before": Counter(), "after": Counter()}
    per_rule: dict[tuple[str, str], dict] = defaultdict(
        lambda: {"matched": 0, "new": [], "moved": defaultdict(list)}
    )
    movement: Counter[tuple[str, str, str]] = Counter()

    for section, stem in rows:
        old = before_type(section, stem)
        new, source, rule = classify(section, stem)
        before_counts[(section, old)] += 1
        after_counts[(section, new)] += 1
        if old == section:
            placeholders["before"][section] += 1
        if source == SOURCE_PLACEHOLDER:
            placeholders["after"][section] += 1
        if rule:
            # Keyed by section as well as name: both sections have a rule called
            # `inference`, and pooling them reported one number twice.
            entry = per_rule[(section, rule)]
            entry["matched"] += 1
            if old == section:
                entry["new"].append(stem)
            elif old != new:
                entry["moved"][old].append(stem)
        if old != new:
            movement[(section, old, new)] += 1

    total = len(rows)
    print(f"\n{total} questions in the snapshot\n")
    print("PLACEHOLDER COVERAGE (a type that is only the section's own name)")
    for label in ("before", "after"):
        counted = placeholders[label]
        print(
            f"  {label:6} {_share(sum(counted.values()), total):>16}"
            f"   LR {counted['Logical Reasoning']:5}   RC {counted['Reading Comprehension']:5}"
        )

    print("\nTYPE DISTRIBUTION")
    sections = sorted({section for section, _ in rows})
    for section in sections:
        print(f"\n  {section}")
        names = sorted(
            {name for sec, name in list(before_counts) + list(after_counts) if sec == section}
        )
        print(f"    {'type':<28}{'before':>8}{'after':>8}")
        for name in names:
            before = before_counts[(section, name)]
            after = after_counts[(section, name)]
            flag = "  <- placeholder" if name == section else ""
            print(f"    {name:<28}{before:>8}{after:>8}{flag}")

    print("\nWHAT EACH RULE MATCHES")
    print("  'new' was untyped before; 'moved' already had a type and now has a different one.")
    for section in sections:
        print(f"\n  {section}")
        for rule in rules_for(section):
            entry = per_rule.get((section, rule.name))
            if not entry:
                print(f"    {rule.name:<24} matched 0")
                continue
            moved = sum(len(values) for values in entry["moved"].values())
            print(
                f"    {rule.name:<24} matched {entry['matched']:5}"
                f"   new {len(entry['new']):5}   moved {moved:5} -> {rule.question_type}"
            )
            for stem in entry["new"][: args.samples]:
                print(f"        new   {stem[:104]}")
            for old, values in sorted(entry["moved"].items(), key=lambda kv: -len(kv[1])):
                print(f"        moved from {old} ({len(values)}):")
                for stem in values[: max(1, args.samples // 2)]:
                    print(f"              {stem[:100]}")

    if args.rule:
        entry = next(
            (value for (_section, name), value in per_rule.items() if name == args.rule), None
        )
        print(f"\nEVERY STEM NEWLY CLAIMED BY {args.rule}")
        for stem in (entry or {}).get("new", []):
            print(f"  {stem}")

    print("\nLARGEST RELABELLINGS (rows that already had a type)")
    # Filtered before ranking, not after. Taking the top N and then dropping the
    # placeholder fills showed two lines and hid the rest, which is the opposite
    # of what this section is for: filling an empty bucket is the intended
    # effect and moving a row that already had a type is the side effect.
    relabelled = Counter(
        {key: count for key, count in movement.items() if key[1] != key[0]}
    )
    print(f"  {sum(relabelled.values())} rows changed a type they already had")
    for (section, old, new), count in relabelled.most_common(15):
        print(f"  {count:5}  {section[:2]}  {old} -> {new}")
    print()


if __name__ == "__main__":
    main()
