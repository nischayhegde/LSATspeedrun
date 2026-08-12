"""How many approaches each question is a candidate for, before and after.

`strategies._candidate_keys` is the function that decides which of the fourteen
approaches a question may be offered, and the first thing it reads is
`question.question_type`. So the type fix in `app/question_types.py` is not
only a data-quality change: it moves the denominator of the strategy trial. A
question with two candidates is a two-armed comparison; a question whose only
distinguishing feature was a placeholder got the generic pair and nothing else.

This probe answers one question with a number rather than an argument: does
reading the type off the stem actually widen strategy matching, and where.

    python3 tools/audit/strategy_candidates.py

Report-only, no database. It classifies the shipped JSONL snapshot under both
rule sets and calls the real `_candidate_keys` on a stand-in that carries
exactly the fields that function reads — section, question_type, stem,
stimulus, and the passage's text and comparative flag, all reconstructed the
way `seed._upsert_row` writes them. Calling the real function is the point: a
reimplementation here would agree with whatever it was written to agree with,
which is the failure mode this project keeps paying for.
"""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from types import SimpleNamespace

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.question_types import classify  # noqa: E402
from app.strategies import _candidate_keys, detect_comparative  # noqa: E402
from question_type_coverage import DATASETS, SPLITS, before_type  # noqa: E402

BANK = REPO / "backend" / "data" / "question_bank"


def _question(section: str, stem: str, context: str, question_type: str):
    """The fields `_candidate_keys` reads, arranged the way ingest writes them.

    Reading Comprehension keeps its text on the passage and has no stimulus;
    Logical Reasoning is the other way round and has no passage. Getting that
    backwards would silently disable the causal and conditional rules, which
    only ever read the stimulus.
    """
    if section == "Reading Comprehension":
        passage = SimpleNamespace(
            canonical_text=context,
            comparative=detect_comparative(context, "Reading Comprehension"),
        )
        return SimpleNamespace(
            section=section, question_type=question_type, stem=stem,
            stimulus=None, passage=passage,
        )
    return SimpleNamespace(
        section=section, question_type=question_type, stem=stem,
        stimulus=context, passage=None,
    )


def read_bank() -> list[tuple[str, str, str]]:
    rows = []
    for slug, section in DATASETS:
        for split in SPLITS:
            path = BANK / slug / f"{split}.jsonl"
            if not path.is_file():
                continue
            with path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    record = json.loads(line)
                    stem = (record.get("question") or "").strip()
                    context = (record.get("context") or "").strip()
                    if stem and context:
                        rows.append((section, stem, context))
    return rows


def main() -> None:
    rows = read_bank()
    if not rows:
        raise SystemExit("no question bank snapshot found")

    counts = {"before": Counter(), "after": Counter()}
    offers = {"before": Counter(), "after": Counter()}
    widened: Counter[tuple[str, int, int]] = Counter()
    by_section = {
        "before": defaultdict(Counter),
        "after": defaultdict(Counter),
    }

    for section, stem, context in rows:
        old_type = before_type(section, stem)
        new_type = classify(section, stem)[0]
        old = _candidate_keys(_question(section, stem, context, old_type))
        new = _candidate_keys(_question(section, stem, context, new_type))
        counts["before"][len(old)] += 1
        counts["after"][len(new)] += 1
        by_section["before"][section][len(old)] += 1
        by_section["after"][section][len(new)] += 1
        for key in old:
            offers["before"][key] += 1
        for key in new:
            offers["after"][key] += 1
        if len(new) != len(old):
            widened[(section, len(old), len(new))] += 1

    total = len(rows)
    print(f"\n{total} questions in the snapshot\n")
    print("HOW MANY APPROACHES A QUESTION IS A CANDIDATE FOR")
    print(f"  {'candidates':<12}{'before':>10}{'after':>10}")
    for size in sorted(set(counts["before"]) | set(counts["after"])):
        before, after = counts["before"][size], counts["after"][size]
        print(
            f"  {size:<12}{before:>6} ({before / total * 100:4.1f}%)"
            f"{after:>6} ({after / total * 100:4.1f}%)"
        )
    for label in ("before", "after"):
        pairs = counts[label][2]
        mean = sum(size * n for size, n in counts[label].items()) / total
        print(f"  {label:6} two-candidate share {pairs / total * 100:.1f}%   mean {mean:.2f}")

    print("\nBY SECTION (share on exactly two candidates)")
    for section in sorted(by_section["before"]):
        section_total = sum(by_section["before"][section].values())
        before = by_section["before"][section][2] / section_total * 100
        after = by_section["after"][section][2] / section_total * 100
        print(f"  {section:<24}{before:6.1f}% -> {after:6.1f}%   ({section_total} questions)")

    print("\nHOW MANY QUESTIONS EACH APPROACH IS A CANDIDATE ON")
    print(f"  {'approach':<22}{'before':>9}{'after':>9}{'change':>9}")
    for key in sorted(set(offers["before"]) | set(offers["after"])):
        before, after = offers["before"][key], offers["after"][key]
        print(f"  {key:<22}{before:>9}{after:>9}{after - before:>+9}")

    print("\nLARGEST CHANGES IN CANDIDATE COUNT")
    for (section, old, new), count in widened.most_common(10):
        print(f"  {count:5}  {section[:2]}  {old} -> {new} candidates")
    print()


if __name__ == "__main__":
    main()
