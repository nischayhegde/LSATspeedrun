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

    print_reachability(rows, offers["after"])
    print_strata(rows)
    print_causal_misfire(rows)
    print()


def print_causal_misfire(rows) -> None:
    """How many `causal_audit` candidacies are the word "because".

    `docs/audits/interleaving-audit.md` §2.5 found that `_candidate_keys` tests
    `"cause" in stimulus` with no word boundary, so every argument containing
    the word "because" — which is most arguments — looks like a causal one. The
    audit put it at 275 of 426 offers, and the figure had no script behind it.

    Measured the only way that does not require agreeing with the matcher about
    what a word is: rewrite `"because"` to `"since"` in the stimulus, which
    changes no meaning a rule here is entitled to care about, and count the
    questions that stop being candidates. Anything that drops out was matched by
    the substring and nothing else.
    """
    matched = 0
    spurious = 0
    for section, stem, context in rows:
        if section != "Logical Reasoning":
            continue
        question_type = classify(section, stem)[0]
        if "causal_audit" not in _candidate_keys(_question(section, stem, context, question_type)):
            continue
        matched += 1
        rewritten = context.replace("because", "since").replace("Because", "Since")
        if "causal_audit" not in _candidate_keys(
            _question(section, stem, rewritten, question_type)
        ):
            spurious += 1

    print("\nCAUSAL CANDIDACIES THAT ARE ONLY THE WORD \"BECAUSE\"")
    print(f"  causal_audit is a candidate on   {matched} Logical Reasoning questions")
    print(
        f"  of which                         {spurious} ({spurious / matched:.1%}) "
        "stop being candidates when\n                                   "
        '"because" is rewritten to "since"'
    )
    print(
        "\n  The audit measured 64.6%. What narrowed it is not a word boundary — there\n"
        "  still is not one — but that the causal branch now also requires a strengthen,\n"
        "  weaken, flaw or explain task, so the substring alone is no longer enough on\n"
        "  its own. The remainder are questions carrying a candidate they do not deserve,\n"
        "  which taxes the coverage phase and can evict a real approach."
    )


def print_strata(rows) -> None:
    """The cells the mandatory-approach draw charges to, and how thin they are.

    `strategies.stratum_key` is approach-by-section-by-question-type, and it is
    what `information_need` ranks when deciding where to spend a mandatory
    question. So the type fix moves this too, and not only in the good
    direction: finer types mean more cells and thinner ones.

    Reported because it is a real cost of the change and would otherwise be
    invisible. It is not a cost the change *created*, though — the old count
    was small because the placeholder pooled the whole untyped bank into single
    cells like `argument_core|Logical Reasoning|Logical Reasoning`. What moves
    here is how honestly the grain is described, and the honest description has
    more thin cells in it.
    """
    print("\nSTRATA THE MANDATORY-APPROACH DRAW CHARGES TO (approach × section × type)")
    for label, typer in (("before", before_type), ("after", lambda s, q: classify(s, q)[0])):
        strata: Counter[str] = Counter()
        for section, stem, context in rows:
            question_type = typer(section, stem)
            for key in _candidate_keys(_question(section, stem, context, question_type)):
                strata[f"{key}|{section}|{question_type}"] += 1
        sizes = sorted(strata.values())
        thin = sum(1 for size in sizes if size < 20)
        print(
            f"  {label:6} {len(strata):4} cells   median {sizes[len(sizes) // 2]:4} questions"
            f"   under 20 questions: {thin} ({thin / len(strata) * 100:.0f}%)"
        )


# `strategies.MIN_CONTRAST_SAMPLE` is 10 on the *effective* per-arm sample
# 1/(1/n₁ + 1/n₀), which is cheapest at the balanced point: 20 prompt-arm
# questions against 20 controls. Controls are a quarter of assignments, so 20
# controls means 80 assignments of that one approach.
ASSIGNMENTS_TO_ELIGIBILITY = 80
# A thousand questions in one section: a hundred sittings at the production run
# size, in that section alone. A generous ceiling on a committed student.
PRACTICE_CEILING = 1000


def print_reachability(rows, offers) -> None:
    """How much practice an approach needs before it can be ranked at all.

    A lower bound, and generous on purpose. It assumes the approach is chosen
    every single time it is a candidate, which is the best case: under the
    coverage rule the least-sampled candidate wins, so a rare approach really
    does get picked on nearly every question it appears on — until it has its
    three observations, after which it only keeps appearing if it is leading.

    So the number below is the number of questions in that section a student
    must be *served* for the approach to appear eighty times even under the
    most favourable selection this app can produce.

    `PRACTICE_CEILING` is what that gets compared against: a thousand questions
    in one section, which at the production run size of ten is a hundred
    sittings in that section alone. It is not a limit the app imposes; it is a
    generous estimate of what a committed student will actually answer. An
    approach needing more than that cannot be ranked for anybody, and the
    panel's "a few more questions and this will be clearer" is then asking for
    something nobody will ever supply.
    """
    section_totals = Counter(section for section, _stem, _context in rows)
    print("\nQUESTIONS NEEDED BEFORE AN APPROACH CAN BE RANKED")
    print("  Lower bound: assumes the approach is chosen every time it is a candidate.")
    print(f"  Compared against {PRACTICE_CEILING} questions in one section — 100 sittings there.")
    print(f"  {'approach':<22}{'candidate on':>14}{'share':>8}{'questions needed':>18}")
    reachable, unreachable = [], []
    for key in sorted(offers):
        candidates = offers[key]
        # Which section the approach lives in, read off where it is a candidate
        # rather than off its catalogue label.
        section = "Reading Comprehension" if candidates <= section_totals[
            "Reading Comprehension"
        ] and key in _RC_KEYS else "Logical Reasoning"
        total = section_totals[section]
        share = candidates / total
        needed = ASSIGNMENTS_TO_ELIGIBILITY / share if share else float("inf")
        flag = ""
        if needed > PRACTICE_CEILING:
            flag = "  <- beyond any realistic amount of practice"
            unreachable.append(key)
        else:
            reachable.append(key)
        print(f"  {key:<22}{candidates:>14}{share:>7.1%}{needed:>18.0f}{flag}")
    print(
        f"\n  {len(reachable)} of {len(offers)} approaches could be ranked inside "
        f"{PRACTICE_CEILING} questions in their section. {len(unreachable)} could not: "
        f"{', '.join(unreachable)}."
    )
    print(
        "  And that is the generous reading. After the coverage phase the selector "
        "keeps offering its leader,\n  so in practice only the approaches that are "
        "candidates everywhere accumulate at anything like this rate."
    )


_RC_KEYS = frozenset(
    {
        "passage_map",
        "textual_proof",
        "comparative_matrix",
        "paragraph_function",
        "main_point_synthesis",
        "viewpoint_ledger",
    }
)


if __name__ == "__main__":
    main()
