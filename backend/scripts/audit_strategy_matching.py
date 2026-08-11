"""Measure strategy matching across the whole question bank.

Matching quality cannot be eyeballed. A rule that removes 287 false positives
while silently dropping 100 true ones reads exactly like a fix on one question
card and is a regression across the bank, so every change to
`strategies._candidate_keys` is measured here first: per-strategy candidate
counts, coverage, section purity, and a per-item probe for each phrasing the
matching audit named.

Deliberately reads the repository snapshot in `backend/data/question_bank`
rather than a database. The bank is the same 6,886 rows either way — the
snapshot is what `seed.seed_questions` ingests — and reading it directly means
the audit runs with no database, no app context and no seeded account, so a
before-and-after can be taken in one shell in a few seconds. The two derived
fields the matcher reads are derived here by calling the *ingest's own*
functions, `seed._question_type` and `strategies.detect_comparative`, so this
never measures a second implementation of them.

    python3 backend/scripts/audit_strategy_matching.py
    python3 backend/scripts/audit_strategy_matching.py --json before.json
    python3 backend/scripts/audit_strategy_matching.py --compare before.json
    python3 backend/scripts/audit_strategy_matching.py --samples causal_audit
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.seed import DATASETS, SPLITS, _question_type  # noqa: E402
from app.strategies import STRATEGIES, _candidate_keys, detect_comparative  # noqa: E402

SNAPSHOT_DIR = BACKEND_DIR / "data" / "question_bank"


class _Passage:
    """Enough of `models.Passage` for the matcher to read."""

    __slots__ = ("canonical_text", "passage_type", "comparative")

    def __init__(self, canonical_text: str, passage_type: str) -> None:
        self.canonical_text = canonical_text
        self.passage_type = passage_type
        self.comparative = detect_comparative(canonical_text, passage_type)


class _Question:
    """Enough of `models.Question` for the matcher to read."""

    __slots__ = ("id", "section", "question_type", "stem", "stimulus", "passage", "difficulty")

    def __init__(self, id: str, section: str, stem: str, context: str, passage: _Passage | None) -> None:
        self.id = id
        self.section = section
        self.question_type = _question_type(section, stem)
        self.stem = stem
        self.stimulus = None if passage else context
        self.passage = passage
        self.difficulty = 3


def load_bank(snapshot_dir: Path = SNAPSHOT_DIR) -> list[_Question]:
    """Every row of the snapshot, shaped the way ingest would store it.

    Reading comprehension rows share a passage when they share context text,
    exactly as `seed._upsert_row` keys passages on a hash of that text, because
    `viewpoint_ledger` and the comparative flag are both properties of the
    passage rather than of one question on it.
    """
    passages: dict[str, _Passage] = {}
    questions: list[_Question] = []
    for dataset, section in DATASETS.items():
        slug = dataset.rsplit("/", 1)[-1]
        for split in SPLITS:
            path = snapshot_dir / slug / f"{split}.jsonl"
            if not path.is_file():
                raise SystemExit(f"Missing snapshot file: {path}. Run backend/scripts/snapshot_question_bank.py.")
            with path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    row = json.loads(line)
                    context = (row.get("context") or "").strip()
                    stem = (row.get("question") or "").strip()
                    source_id = (row.get("id_string") or "").strip()
                    if not context or not stem or not source_id:
                        continue
                    passage = None
                    if section == "Reading Comprehension":
                        passage = passages.setdefault(
                            context, _Passage(context, "Reading Comprehension")
                        )
                    questions.append(
                        _Question(f"hf-{slug}:{source_id}", section, stem, context, passage)
                    )
    return questions


# ---------------------------------------------------------------------------
# Cohorts
#
# The appropriateness half of the measurement. A rule cannot be graded against a
# second copy of itself — that always scores perfectly — and there is no
# labelled key for "is this really a causal question" over 6,886 rows. So what
# is measured instead is narrow and checkable: each cohort below is a population
# defined by the *phrasing* the matching audit named, together with the one thing
# that population should do.
#
# `expect="none"` means no question in this cohort should be offered the
# approach; `expect="all"` means every one of them should be. Both are
# falsifiable by reading the stems, which `--samples` prints, and neither asks
# anyone to trust a hand-rolled classifier.
# ---------------------------------------------------------------------------

_CAUSAL_CLAIM = re.compile(
    r"\bcaus(?:e|es|ed|ing|al|ally|ation)\b|\bdue to\b|\bbecause of\b|\bowing to\b"
    r"|\bleads? to\b|\bled to\b|\bresults? (?:in|from)\b|\bresulted (?:in|from)\b"
    r"|\bresponsible for\b|\bbrought about\b|\battributable to\b|\bstems? from\b"
    r"|\bgives? rise to\b|\bcontribut(?:e|es|ed) to\b|\beffects? (?:of|on)\b"
)
# Any conditional structure at all, including the quantified forms — "all X are
# Y" and "no X is Y" do translate to conditionals and this cohort must not
# accuse the matcher of firing on them. What it isolates is the bare word, as in
# "all the evidence", "no doubt" and "not all of them", which is what fired 189
# times on questions with no rule to chain.
_ANY_CONDITIONAL = re.compile(
    r"\bif\b|\bunless\b|\bwhenever\b|\bprovided that\b|\bas long as\b|\brequir\w+\b"
    r"|\bnecessary\b|\bsufficient\b|\bprerequisite\b|\bevery\b|\bnone of\b"
    r"|\ban(?:y|yone|ything|body)\s+(?:who|that|which)\b|\bin order (?:to|for)\b"
    r"|\ball\s+(?:\w+\s+){0,2}?(?:are|is|was|were|have|has|must|will|can|do|does)\b"
    r"|\bno\s+\w+\s+(?:is|are|was|were|can|will|has|have|ever|may|would|could)\b"
    r"|\bonly\s+(?:if|those|when|by|a\s+person|people\s+who)\b"
)
_TASK_ACTS_ON_A_CAUSE = re.compile(
    r"\bstrengthens?\b|\bweaken\w*\b|\bflaw\w*\b|\bexplain\w*\b|\bvulnerable to\b|\bcasts? doubt\b"
)
_TASK_PROVES = re.compile(
    r"\bmust (?:also )?be true\b|\bproperly (?:be )?(?:inferred|drawn|concluded)\b"
    r"|\bfollows? logically\b|\bmost strongly supported\b|\bparallel\w*\b|\bprinciple\b"
)

COHORTS: tuple[dict, ...] = (
    {
        "name": "because, no cause anywhere",
        "strategy": "causal_audit",
        "expect": "none",
        "why": '"Antoine\'s response is ineffective because" — the substring that fired 287 times.',
        "test": lambda q: q.section == "Logical Reasoning"
        and bool(re.search(r"\bbecause\b", (q.stem or "").lower()))
        and not _CAUSAL_CLAIM.search((q.stem or "").lower())
        and not _CAUSAL_CLAIM.search((q.stimulus or "").lower()),
    },
    {
        "name": "causal stimulus, strengthen/weaken",
        "strategy": "causal_audit",
        "expect": "all",
        "why": "The population the approach exists for. A rule that drops these is not a fix.",
        "test": lambda q: q.section == "Logical Reasoning"
        and bool(_CAUSAL_CLAIM.search((q.stimulus or "").lower()))
        and bool(re.search(r"\bstrengthens?\b|\bweaken\w*\b", (q.stem or "").lower())),
    },
    {
        "name": "bare all/no, no operator",
        "strategy": "conditional_chain",
        "expect": "none",
        "why": 'The 189 questions with no conditional in them, matched on " all " and " no ".',
        "test": lambda q: q.section == "Logical Reasoning"
        and bool(re.search(r"\ball\b|\bno\b", (q.stimulus or "").lower()))
        and not _ANY_CONDITIONAL.search((q.stimulus or "").lower()),
    },
    {
        "name": "if-then stimulus, proof task",
        "strategy": "conditional_chain",
        "expect": "all",
        "why": "An explicit conditional under a must-be-true or parallel stem.",
        "test": lambda q: q.section == "Logical Reasoning"
        and bool(re.search(r"\bif\b|\bunless\b|\bonly if\b", (q.stimulus or "").lower()))
        and bool(_TASK_PROVES.search((q.stem or "").lower())),
    },
    {
        "name": "assumption on/upon which … depends",
        "strategy": "negation_test",
        "expect": "all",
        "why": "The LSAT's standard necessary-assumption stem. It does not contain \"depends on\".",
        "test": lambda q: bool(
            re.search(r"assumption (?:on|upon) which", (q.stem or "").lower())
        ),
    },
    {
        "name": "necessary/required assumption",
        "strategy": "negation_test",
        "expect": "all",
        "why": "The other three standard phrasings of the same question.",
        "test": lambda q: bool(
            re.search(
                r"assumption (?:that is )?(?:necessary|required)|required assumption"
                r"|necessary assumption|must be assumed|takes for granted",
                (q.stem or "").lower(),
            )
        ),
    },
    {
        "name": "sufficient assumption",
        "strategy": "negation_test",
        "expect": "none",
        "why": "Denying a merely sufficient assumption need not break the argument, so the "
        "procedure's own ruling discards the credited answer.",
        "test": lambda q: bool(
            re.search(r"if assumed|allows the conclusion|enables the conclusion", (q.stem or "").lower())
        )
        and not re.search(r"\bnecessary\b|\brequired\b|\bdepends?\b", (q.stem or "").lower()),
    },
    {
        "name": "flaw stem without the word flaw",
        "strategy": "flaw_abstraction",
        "expect": "all",
        "why": '"most vulnerable to criticism" and "an error in reasoning" — the 65 missed.',
        "test": lambda q: bool(
            re.search(
                r"vulnerable to (?:the )?criticism|vulnerable to which|errors? in reasoning"
                r"|reasoning error|weakness of the argument|reasoning is questionable",
                (q.stem or "").lower(),
            )
        )
        and not re.search(r"\bflaw", (q.stem or "").lower()),
    },
    {
        "name": "RC detail on a passage naming parties",
        "strategy": "viewpoint_ledger",
        "expect": "none",
        "why": "The 344 questions that inherited a viewpoint strategy from a word in the passage.",
        "test": lambda q: q.section == "Reading Comprehension"
        and bool(re.search(r"\bcritics?\b|\bproponents?\b", (q.passage.canonical_text or "").lower() if q.passage else ""))
        and not re.search(
            r"\battitude\b|\bagree\w*\b|\bviewpoint\b|\bperspective\b|\bopinion\b|\bwould\b"
            r"|\bregards?\b|\bcritics?\b|\bproponents?\b|\bposition\b|\bargues?\b|\bclaims?\b"
            r"|\bcharacteriz\w+\b|\bmaintains?\b|\bcontends?\b|\bbelieves?\b|\basserts?\b",
            (q.stem or "").lower(),
        ),
    },
    {
        "name": "RC attitude or agreement stem",
        "strategy": "viewpoint_ledger",
        "expect": "all",
        "why": "The population the approach exists for, asked by the question rather than the passage.",
        "test": lambda q: q.section == "Reading Comprehension"
        and bool(re.search(r"\battitude\b|would (?:be )?most likely to agree|\bdisagree\w*\b", (q.stem or "").lower())),
    },
    {
        "name": "remain/mainly/domain, no main point",
        "strategy": "main_point_synthesis",
        "expect": "none",
        "why": '"main" as a substring matches "remain", "mainly" and "domain".',
        "test": lambda q: q.section == "Reading Comprehension"
        and bool(re.search(r"remain|mainly|domain", (q.stem or "").lower()))
        and not re.search(
            r"\bmain\b|primary purpose|central (?:point|idea|claim|thesis)|primarily concerned|title",
            (q.stem or "").lower(),
        ),
    },
    {
        "name": "the word conclusion, no conclusion task",
        "strategy": "role_map",
        "expect": "none",
        "why": '"conclusion" as a substring made a role-and-method approach a candidate on any '
        "stem that used the word, including every must-be-true stem that asks which conclusion "
        "follows.",
        "test": lambda q: q.section == "Logical Reasoning"
        and bool(re.search(r"\bconclusion", (q.stem or "").lower()))
        # Everything that genuinely is a main-conclusion, role or method
        # question is excluded, so what is left asks about *a* conclusion
        # rather than about the argument's own.
        and not re.search(
            r"main (?:conclusion|point)|overall conclusion|conclusion (?:drawn|of the argument)"
            r"|most accurately (?:expresses|states|describes)[^.?]{0,40}conclusion"
            r"|conclusion of (?:the|this)\b|\brole\b|\bmethod\b|argument proceeds|\btechnique\b"
            r"|in which one of the following ways|conclusion of \w+(?:'s|s')\b",
            (q.stem or "").lower(),
        ),
    },
)


def audit(questions: list[_Question]) -> dict:
    per_strategy: Counter[str] = Counter()
    per_strategy_section: dict[str, Counter[str]] = defaultdict(Counter)
    counts_histogram: Counter[int] = Counter()
    type_counts: Counter[str] = Counter()
    difficulties: Counter[int] = Counter()
    empty: list[str] = []
    section_violations: list[dict] = []
    totals = Counter()
    comparative_questions = 0
    comparative_passages = set()
    cohort_size: Counter[str] = Counter()
    cohort_fires: Counter[str] = Counter()
    samples: dict[str, list[str]] = defaultdict(list)
    strategy_samples: dict[str, list[str]] = defaultdict(list)

    for question in questions:
        totals[question.section] += 1
        totals["all"] += 1
        type_counts[f"{question.section}|{question.question_type}"] += 1
        difficulties[question.difficulty] += 1
        if question.passage and question.passage.comparative:
            comparative_questions += 1
            comparative_passages.add(id(question.passage))
        keys = _candidate_keys(question)
        counts_histogram[len(keys)] += 1
        if not keys:
            empty.append(question.id)
        for key in keys:
            per_strategy[key] += 1
            per_strategy_section[key][question.section] += 1
            if STRATEGIES[key]["section"] != question.section:
                section_violations.append(
                    {"question": question.id, "strategy": key, "section": question.section}
                )
            if len(strategy_samples[key]) < 15:
                strategy_samples[key].append(question.stem[:170])
        for cohort in COHORTS:
            if not cohort["test"](question):
                continue
            cohort_size[cohort["name"]] += 1
            fired = cohort["strategy"] in keys
            cohort_fires[cohort["name"]] += fired
            # Only the disagreements are worth reading, so that is what is kept.
            if fired != (cohort["expect"] == "all") and len(samples[cohort["name"]]) < 15:
                samples[cohort["name"]].append(question.stem[:170])

    total = totals["all"] or 1
    return {
        "totals": dict(totals),
        "mean_candidates": round(
            sum(count * n for n, count in counts_histogram.items()) / total, 3
        ),
        "min_candidates": min(counts_histogram),
        "empty_results": len(empty),
        "candidate_histogram": dict(sorted(counts_histogram.items())),
        "exactly_two_share": round(counts_histogram[2] / total * 100, 1),
        "per_strategy": {
            key: {
                "count": per_strategy.get(key, 0),
                "share": round(per_strategy.get(key, 0) / total * 100, 1),
                "sections": dict(per_strategy_section.get(key, {})),
            }
            for key in STRATEGIES
        },
        "section_violations": len(section_violations),
        "comparative_questions": comparative_questions,
        "comparative_passages": len(comparative_passages),
        "question_types": dict(sorted(type_counts.items())),
        "generic_type_questions": sum(
            count
            for name, count in type_counts.items()
            if name in ("Logical Reasoning|Logical Reasoning", "Reading Comprehension|Reading Comprehension")
        ),
        "difficulties": dict(difficulties),
        "cohorts": {
            cohort["name"]: {
                "strategy": cohort["strategy"],
                "expect": cohort["expect"],
                "size": cohort_size[cohort["name"]],
                "fires": cohort_fires[cohort["name"]],
                "wrong": (
                    cohort_fires[cohort["name"]]
                    if cohort["expect"] == "none"
                    else cohort_size[cohort["name"]] - cohort_fires[cohort["name"]]
                ),
                "why": cohort["why"],
            }
            for cohort in COHORTS
        },
        "samples": dict(samples),
        "strategy_samples": dict(strategy_samples),
    }


def _print_report(result: dict, previous: dict | None) -> None:
    print(f"Bank: {result['totals']['all']} questions "
          f"({result['totals'].get('Logical Reasoning', 0)} LR, "
          f"{result['totals'].get('Reading Comprehension', 0)} RC)")
    print(f"Coverage: min {result['min_candidates']} candidates, "
          f"mean {result['mean_candidates']}, {result['empty_results']} empty, "
          f"{result['exactly_two_share']}% on exactly two")
    print(f"Section violations: {result['section_violations']}")
    print(f"Comparative: {result['comparative_questions']} questions on "
          f"{result['comparative_passages']} passages")
    print(f"Type field merely repeats the section on {result['generic_type_questions']} questions")
    print(f"Difficulty distribution: {result['difficulties']}")

    print("\nCandidates per strategy across the bank")
    header = f"  {'strategy':22} {'now':>6} {'was':>6} {'delta':>7} {'share':>7}"
    print(header)
    print("  " + "-" * (len(header) - 2))
    for key, entry in result["per_strategy"].items():
        was = (previous or {}).get("per_strategy", {}).get(key, {}).get("count")
        delta = "" if was is None else f"{entry['count'] - was:+d}"
        print(
            f"  {key:22} {entry['count']:>6} {('—' if was is None else was):>6} {delta:>7}"
            f" {entry['share']:>6}%"
        )

    print("\nCohorts: a named phrasing, and the one thing it should do")
    header = f"  {'cohort':38} {'strategy':20} {'expect':7} {'size':>6} {'fires':>6} {'wrong':>6} {'was':>6}"
    print(header)
    print("  " + "-" * (len(header) - 2))
    wrong_now = wrong_before = 0
    for name, entry in result["cohorts"].items():
        before = (previous or {}).get("cohorts", {}).get(name, {}).get("wrong")
        wrong_now += entry["wrong"]
        wrong_before += before or 0
        print(
            f"  {name:38} {entry['strategy']:20} {entry['expect']:7} {entry['size']:>6}"
            f" {entry['fires']:>6} {entry['wrong']:>6} {('—' if before is None else before):>6}"
        )
    print(f"\n  Cohort questions matched wrongly: {wrong_now}"
          + (f" (was {wrong_before})" if previous else ""))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, default=SNAPSHOT_DIR)
    parser.add_argument("--json", type=Path, help="Write the full result to this path.")
    parser.add_argument("--compare", type=Path, help="A previous --json result to show deltas against.")
    parser.add_argument("--samples", help="Print stems: a cohort name, or a strategy key.")
    args = parser.parse_args()

    questions = load_bank(args.snapshot)
    result = audit(questions)
    previous = json.loads(args.compare.read_text("utf-8")) if args.compare else None
    _print_report(result, previous)

    if args.samples:
        stems = result["samples"].get(args.samples) or result["strategy_samples"].get(args.samples)
        if stems is None:
            raise SystemExit(f"No cohort or strategy named {args.samples!r}.")
        print(f"\n--- {args.samples} ---")
        for stem in stems:
            print(f"  {stem}")
        if not stems:
            print("  (nothing to show — no disagreements)")

    if args.json:
        payload = {
            key: value for key, value in result.items() if key not in ("samples", "strategy_samples")
        }
        args.json.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"\nWrote {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
