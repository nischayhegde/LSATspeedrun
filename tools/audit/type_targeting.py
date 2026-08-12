"""What per-type targeting can aim at, and what it costs the rest of the run.

Two claims in `app/type_focus.py` are quantities rather than opinions, and this
prints both against the real bank instead of leaving them in a docstring. Like
`question_type_coverage.py` it touches no database: the bank ships in the
repository as JSONL under `backend/data/question_bank`, and classifying it here
measures exactly what a re-seed would write.

    python3 tools/audit/type_targeting.py
    python3 tools/audit/type_targeting.py --weak-type Assumption --runs 1000

A third reading needs somebody's data and is worth more than either of the
above once there is any: `--database-url` adds the cohort view — who the layer
is actually aiming at, banded by how much history each student has, and what
the trial has collected in each band. The two ends are the interesting ones. A
cold account has no per-type history, draws no arm, and must show as absent
rather than as a null result; a saturated one may have improved past the
weakness that first triggered targeting, and the recorded signals say whether
it has.

    python3 tools/audit/type_targeting.py --database-url sqlite:///backend/instance/app.db

**Is there anything to aim at.** Targeting a category needs the category to
exist and to have enough material behind it that a run can lean into it.
Before the type fix, 45.8% of the bank carried a `question_type` equal to its
own section name, so for nearly half of all questions there was no category to
target — and "weak at Logical Reasoning" is what the section knob is for. The
census is the first table, including which types are thin enough that naming
one as a weakness would produce a run that could not fill it.

**What targeting does to the questions it is not aiming at.** The remaining
placeholders must not become invisible. The fill takes
`services.FOCUS_FILL_RATIO` of a run from weak types and draws the rest from
the ordinary pool, so a placeholder's share of a run should fall by at most
that ratio and never to zero. The second table draws runs under both arms of
`weak_type_targeting` through the real selection code and reports the realised
shares, which is the difference between that paragraph being true and it being
plausible.

Report-only, and it writes nothing. Selection is random, so shares move a
little between invocations; `--runs` buys precision and `--seed` pins it.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))

from app.question_types import SOURCE_PLACEHOLDER, classify  # noqa: E402

BANK = REPO / "backend" / "data" / "question_bank"
DATASETS = (("lsat-lr", "Logical Reasoning"), ("lsat-rc", "Reading Comprehension"))
SPLITS = ("train", "validation", "test")

# What a run of practice is, for the purpose of measuring composition: the
# default `count` in `services.create_study_session`.
RUN_SIZE = 8


def load_bank() -> tuple[list, set[str]]:
    """The bank as the selector sees it, and which of it is a placeholder.

    `QuestionFact` is the four columns run selection actually reads, and using
    the real tuple rather than a stand-in is what lets this call
    `_weight_toward_focus` itself. Passage grouping is reproduced the way
    `seed._upsert_row` derives it — Reading Comprehension questions sharing a
    context share a passage — because the focus bias selects over passage
    blocks, and a bias that could split passage-mates would be a different
    mechanism from the one being measured.

    Placeholders are identified by the provenance `classify` returns, which is
    the same thing `type_focus.PLACEHOLDER_SOURCES` reads, rather than by
    comparing the type to the section name here. Two copies of that rule is one
    too many.
    """
    from app.services import QuestionFact

    facts: list = []
    placeholders: set[str] = set()
    for slug, section in DATASETS:
        for split in SPLITS:
            path = BANK / slug / f"{split}.jsonl"
            if not path.is_file():
                print(f"  (missing {path.relative_to(REPO)})")
                continue
            with path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    row = json.loads(line)
                    stem = (row.get("question") or "").strip()
                    if not stem:
                        continue
                    question_type, source, _rule = classify(section, stem)
                    context = (row.get("context") or "").strip()
                    question_id = f"hf-{slug}:{row.get('id_string')}:{len(facts)}"
                    facts.append(
                        QuestionFact(
                            question_id,
                            question_type,
                            f"rc:{hash(context)}"
                            if section == "Reading Comprehension"
                            else None,
                            section,
                        )
                    )
                    if source == SOURCE_PLACEHOLDER:
                        placeholders.add(question_id)
    return facts, placeholders


def print_census(facts, placeholders: set[str]) -> None:
    total = len(facts)
    print(f"\nBANK: {total} questions")
    print(
        f"  placeholder types  {len(placeholders)} ({len(placeholders) / total:.1%})"
        "   — cannot be named a weakness, still served"
    )

    by_section: dict[str, Counter] = {}
    for fact in facts:
        if fact.id in placeholders:
            continue
        by_section.setdefault(fact.section, Counter())[fact.question_type] += 1

    for section in sorted(by_section):
        counts = by_section[section]
        print(f"\n  {section}: {len(counts)} targetable types")
        for question_type, count in counts.most_common():
            # A type with little behind it can be named as a weakness and then
            # not filled, which reads as the layer doing nothing. Worth seeing
            # before deciding the layer is broken.
            thin = "   thin: one run could exhaust it" if count < RUN_SIZE else ""
            print(f"      {question_type:<28}{count:>7}{count / total:>8.1%}{thin}")


def print_composition(facts, placeholders: set[str], *, runs: int, weak_types: list[str]) -> None:
    from app.services import FOCUS_FILL_RATIO, _weight_toward_focus

    wanted = set(weak_types)
    bank_placeholder = len(placeholders) / len(facts)
    bank_weak = sum(1 for fact in facts if fact.question_type in wanted) / len(facts)

    print(f"\nRUN COMPOSITION: {runs} runs of {RUN_SIZE} per arm")
    print(f"  targeting {', '.join(sorted(wanted))}")
    print(f"  fill takes {FOCUS_FILL_RATIO:.0%} of the run from weak types\n")
    print(f"  {'arm':<14}{'weak-type share':>18}{'placeholder share':>20}")
    print(f"  {'(bank)':<14}{bank_weak:>17.1%}{bank_placeholder:>19.1%}")

    shares = {}
    for arm, focus in (("untargeted", []), ("targeted", sorted(wanted))):
        weak_seen = placeholder_seen = served = 0
        for _ in range(runs):
            chosen = _weight_toward_focus(list(facts), RUN_SIZE, focus)
            served += len(chosen)
            weak_seen += sum(1 for fact in chosen if fact.question_type in wanted)
            placeholder_seen += sum(1 for fact in chosen if fact.id in placeholders)
        shares[arm] = (weak_seen / served, placeholder_seen / served)
        print(f"  {arm:<14}{weak_seen / served:>17.1%}{placeholder_seen / served:>19.1%}")

    off_arm = shares["untargeted"][1]
    on_arm = shares["targeted"][1]
    print()
    if on_arm <= 0:
        print("  FAILED: the targeted arm served no placeholder questions at all.")
        return
    lost = 1 - on_arm / off_arm if off_arm else 0.0
    print(
        f"  Placeholders hold {on_arm:.1%} of a targeted run against {off_arm:.1%} of an\n"
        f"  untargeted one: a {lost:.0%} relative reduction. The bound the design implies "
        f"is\n  {FOCUS_FILL_RATIO:.0%} — that is how much of the run the fill claims, and a "
        "placeholder can never\n  be a weak type, so it competes only for the remainder."
    )
    if lost > FOCUS_FILL_RATIO + 0.05:
        print(
            "\n  OVER BOUND: the residue is being squeezed harder than the fill ratio\n"
            "  accounts for. Something other than the quota is excluding it."
        )
    print(
        f"\n  The bank's own placeholder share is {bank_placeholder:.1%}; the untargeted arm "
        "sits below it\n  because run selection works in whole passage blocks, which is a "
        "property of the\n  selector rather than of this layer."
    )


def print_cohort(database_url: str) -> None:
    """What the signal and the trial are doing across the students there are.

    The bank tables above are about what the layer *could* aim at. This is
    about who it is aiming at, and it needs somebody's data. Both ends of the
    history distribution are the interesting ones: a cold account has nothing
    to target and must show as absent rather than as a null, and a saturated
    one may have improved past the weakness that first triggered targeting.
    """
    from app import create_app
    from app.type_focus import rolling_population_reading

    application = create_app({"SQLALCHEMY_DATABASE_URI": database_url, "AUTO_SEED": False})
    with application.app_context():
        reading = rolling_population_reading()

    print(f"\nCOHORT: {reading['students']} students with any first encounters\n")
    header = f"  {'band':<13}{'encounters':>12}{'students':>10}{'weak':>7}{'gap':>7}"
    print(header + f"{'trial answers':>15}{'lift':>8}")
    for entry in reading["bands"]:
        gap = "—" if entry["median_gap"] is None else f"{entry['median_gap']:.1f}"
        share = "—" if entry["share_with_weakness"] is None else f"{entry['share_with_weakness']:.0%}"
        trial = entry["trial"]
        lift = "—" if trial["adjusted_lift"] is None else f"{trial['adjusted_lift']:+.1f}"
        print(
            f"  {entry['band']:<13}{entry['first_encounters']:>12}{entry['students']:>10}"
            f"{share:>7}{gap:>7}{trial['answers']:>15}{lift:>8}"
        )

    persistence = reading["signal_persistence"]
    print(
        f"\n  Of {persistence['students']} students with two or more draws, a median of "
        f"{persistence['median_retained'] or 0:.0f}% of the\n  types named on their first "
        "are still named on their last. Descriptive, not causal:\n  the arm split above is "
        "what separates the treatment from everything else."
    )
    print(
        "\n  A cold band that holds most of the cohort means the layer is measuring a\n"
        "  corner of the product, whatever the lift says. The bands are grouped on "
        "history\n  as it is now, which the treatment could have moved, so read them as "
        "where the\n  evidence is accumulating rather than as an effect per band."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=400, help="runs to draw per arm")
    parser.add_argument(
        "--database-url",
        help="also print the cohort reading: who the layer is aiming at, by history depth",
    )
    parser.add_argument(
        "--weak-type",
        action="append",
        default=[],
        help="a type to target; repeatable. Defaults to the commonest two in LR.",
    )
    parser.add_argument("--seed", type=int, default=20260812)
    args = parser.parse_args()

    random.seed(args.seed)
    facts, placeholders = load_bank()
    if not facts:
        print("no bank snapshot found under backend/data/question_bank")
        return
    print_census(facts, placeholders)

    weak_types = args.weak_type
    if not weak_types:
        counts = Counter(
            fact.question_type
            for fact in facts
            if fact.section == "Logical Reasoning" and fact.id not in placeholders
        )
        weak_types = [question_type for question_type, _count in counts.most_common(2)]
    print_composition(facts, placeholders, runs=args.runs, weak_types=weak_types)
    if args.database_url:
        print_cohort(args.database_url)
    print()


if __name__ == "__main__":
    main()
