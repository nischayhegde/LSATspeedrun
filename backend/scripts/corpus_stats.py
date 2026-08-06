"""Statistical fingerprint of an LSAT item corpus.

Computes aggregate distributions that characterise real LSAT items so that
generated candidate items can be scored against the same baseline. Emits JSON
only -- never item text -- so the output is safe to retain after a corpus is
withdrawn.

Input is JSONL with one object per line:
    {"context": str, "question": str, "answers": [str x5],
     "label": int, "id_string": str}

Usage:
    python corpus_stats.py --source PATH [PATH ...] --section lr --out FILE
    python corpus_stats.py --source candidates.jsonl --section lr --compare baseline.json
"""

from __future__ import annotations

import argparse
import json
import math
import re
import statistics
from collections import Counter, defaultdict
from pathlib import Path

# Terms whose presence in exactly one choice is a known giveaway cue.
EXTREME_QUANTIFIERS = {
    "all", "always", "never", "none", "no", "every", "only", "must",
    "cannot", "impossible", "certainly", "entirely", "any", "each",
}
HEDGE_QUANTIFIERS = {
    "some", "most", "many", "few", "several", "often", "sometimes",
    "usually", "may", "might", "could", "likely", "generally", "tend",
    "probably", "unless", "rarely",
}
TRACKED_TERMS = sorted(EXTREME_QUANTIFIERS | HEDGE_QUANTIFIERS)

# Ordered most-specific-first; the first match wins.
LR_TYPE_PATTERNS = [
    ("parallel_flaw", r"flawed pattern of reasoning|similar to the flawed"),
    ("parallel", r"most (?:closely )?(?:similar|parallel)|parallels the reasoning|pattern of reasoning.*most similar"),
    ("assumption_sufficient", r"if assumed|assumption.*enables the conclusion|conclusion follows logically"),
    ("assumption_necessary", r"assumption (?:required|on which|upon which)|depends on the assumption|requires assuming|assumption required"),
    ("assumption_other", r"\bassum"),
    ("strengthen", r"most (?:strengthens|helps to justify|supports the)|if true.*strengthen|justifies the reasoning"),
    ("weaken", r"most (?:seriously )?(?:weakens|undermines|calls into question)|casts (?:the )?most doubt|most damaging"),
    ("flaw", r"flaw in|vulnerable to criticism|questionable (?:because|in that)|error in reasoning|reasoning is (?:flawed|questionable)"),
    ("paradox", r"resolve|explain(?:s)? the (?:discrepancy|paradox|apparent)|reconcile|apparent (?:conflict|discrepancy)"),
    ("principle", r"principle"),
    ("main_point", r"main (?:point|conclusion)|expresses the (?:main|overall)|conclusion of the argument"),
    ("method", r"(?:method|technique) of (?:reasoning|argument)|role played|proceeds by|responds to.*by|argumentative"),
    ("point_at_issue", r"disagree|at issue between|committed to (?:agreeing|disagreeing)"),
    ("evaluate", r"most useful to (?:evaluate|know)|most helpful to (?:know|determine)|useful in evaluating"),
    ("inference", r"must (?:also )?be true|most strongly supported|properly (?:inferred|drawn)|logically follows|can be inferred"),
    ("complete", r"completes the (?:argument|passage)|logically completes"),
]

RC_TYPE_PATTERNS = [
    ("main_idea", r"main (?:idea|point)|primary purpose|central (?:idea|thesis)|chiefly concerned"),
    ("attitude", r"attitude|author.*(?:regard|view of)|would most likely (?:agree|characterize)"),
    ("structure", r"organization|primarily concerned with|function of|role of|in order to|serves to|purpose of the (?:second|third|first|final)"),
    ("analogy", r"most analogous|most closely (?:analogous|similar)"),
    ("detail", r"according to the passage|passage states|author mentions|passage (?:indicates|says)"),
    ("vocabulary", r"as used in|meaning of|refers to"),
    ("strengthen_weaken", r"strengthen|weaken|undermine|support for the"),
    ("inference", r"infer|suggests|implies|most likely to agree|passage supports"),
]

SENTENCE_SPLIT = re.compile(r"[.!?]+(?:\s|$)")
WORD_RE = re.compile(r"[A-Za-z][A-Za-z'-]*")


def words(text: str) -> list[str]:
    return WORD_RE.findall(text)


def syllables(word: str) -> int:
    """Heuristic syllable count, adequate for corpus-level Flesch-Kincaid."""
    word = word.lower()
    vowels = "aeiouy"
    count, prev_vowel = 0, False
    for ch in word:
        is_vowel = ch in vowels
        if is_vowel and not prev_vowel:
            count += 1
        prev_vowel = is_vowel
    if word.endswith("e") and count > 1:
        count -= 1
    return max(count, 1)


def dist(values: list[float]) -> dict:
    """Mean/SD/percentile summary; the percentiles are the acceptance band."""
    if not values:
        return {}
    ordered = sorted(values)

    def pct(p: float) -> float:
        if len(ordered) == 1:
            return round(float(ordered[0]), 2)
        idx = p / 100 * (len(ordered) - 1)
        lo, hi = math.floor(idx), math.ceil(idx)
        return round(ordered[lo] + (ordered[hi] - ordered[lo]) * (idx - lo), 2)

    return {
        "n": len(ordered),
        "mean": round(statistics.fmean(ordered), 2),
        "sd": round(statistics.pstdev(ordered), 2) if len(ordered) > 1 else 0.0,
        "min": round(float(ordered[0]), 2),
        "p5": pct(5), "p25": pct(25), "p50": pct(50),
        "p75": pct(75), "p95": pct(95),
        "max": round(float(ordered[-1]), 2),
    }


def cohens_d(a: list[float], b: list[float]) -> float | None:
    if len(a) < 2 or len(b) < 2:
        return None
    va, vb = statistics.pvariance(a), statistics.pvariance(b)
    pooled = math.sqrt(((len(a) - 1) * va + (len(b) - 1) * vb) / (len(a) + len(b) - 2))
    if pooled == 0:
        return 0.0
    return round((statistics.fmean(a) - statistics.fmean(b)) / pooled, 4)


def normalize_stem(stem: str) -> str:
    """Collapse a stem to its template so recurring phrasings aggregate."""
    s = stem.lower().strip()
    s = re.sub(r"[\u201c\u201d\"']", "", s)
    s = re.sub(r"\b\d+\b", "#", s)
    s = re.sub(r"\s+", " ", s)
    return s[:110]


def infer_type(stem: str, section: str) -> tuple[str, str]:
    patterns = LR_TYPE_PATTERNS if section == "lr" else RC_TYPE_PATTERNS
    s = stem.lower()
    for name, pattern in patterns:
        if re.search(pattern, s):
            return name, "matched"
    return "unclassified", "none"


def chi_square_uniform(counts: list[int]) -> dict:
    total = sum(counts)
    k = len(counts)
    if total == 0:
        return {}
    expected = total / k
    stat = sum((c - expected) ** 2 / expected for c in counts)
    # 4 df critical values; avoids a scipy dependency.
    crit = {"0.05": 9.488, "0.01": 13.277}
    return {
        "chi_square": round(stat, 3),
        "df": k - 1,
        "critical_0.05": crit["0.05"],
        "critical_0.01": crit["0.01"],
        "rejects_uniform_at_0.05": stat > crit["0.05"],
    }


def load(paths: list[Path]):
    for path in paths:
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line:
                    yield json.loads(line)


def analyse(paths: list[Path], section: str) -> dict:
    ctx_chars, ctx_words, stem_chars, stem_words = [], [], [], []
    choice_chars, choice_words = [], []
    correct_len, distractor_len = [], []
    longest_hits = pick_longest_ties = 0
    rank_of_correct = Counter()
    label_counts = Counter()
    stem_templates = Counter()
    type_counts = Counter()
    type_conf = Counter()
    negation_stems = 0
    correct_term_hits, distractor_term_hits = Counter(), Counter()
    correct_terms_total = distractor_terms_total = 0
    isolation_events = isolation_correct = 0
    extreme_isolation_events = extreme_isolation_correct = 0
    admin_counts = Counter()
    passage_questions = defaultdict(int)
    sentence_lengths, fk_scores = [], []
    vocab = Counter()
    total_words = 0
    malformed = 0
    n = 0

    for rec in load(paths):
        try:
            context = rec["context"] or ""
            stem = rec["question"] or ""
            answers = rec["answers"]
            label = int(rec["label"])
            ident = rec.get("id_string", "") or ""
            if len(answers) != 5 or not (0 <= label < 5):
                malformed += 1
                continue
        except (KeyError, TypeError, ValueError):
            malformed += 1
            continue

        n += 1
        ctx_chars.append(len(context))
        cw = words(context)
        ctx_words.append(len(cw))
        stem_chars.append(len(stem))
        stem_words.append(len(words(stem)))

        lengths = [len(a) for a in answers]
        for a, ln in zip(answers, lengths):
            choice_chars.append(ln)
            choice_words.append(len(words(a)))

        correct_len.append(lengths[label])
        distractor_len.extend(ln for i, ln in enumerate(lengths) if i != label)

        max_len = max(lengths)
        if lengths[label] == max_len:
            if lengths.count(max_len) == 1:
                longest_hits += 1
            else:
                pick_longest_ties += 1
        rank_of_correct[sorted(lengths, reverse=True).index(lengths[label])] += 1
        label_counts[label] += 1

        stem_templates[normalize_stem(stem)] += 1
        qtype, conf = infer_type(stem, section)
        type_counts[qtype] += 1
        type_conf[conf] += 1
        if re.search(r"\bEXCEPT\b|\bNOT\b|\bLEAST\b", stem):
            negation_stems += 1

        # Quantifier usage and, more importantly, quantifier *isolation*.
        per_choice_terms = []
        for i, ans in enumerate(answers):
            toks = {w.lower() for w in words(ans)}
            present = toks & set(TRACKED_TERMS)
            per_choice_terms.append(present)
            if i == label:
                correct_term_hits.update(present)
                correct_terms_total += len(present)
            else:
                distractor_term_hits.update(present)
                distractor_terms_total += len(present)

        for term in TRACKED_TERMS:
            holders = [i for i, s in enumerate(per_choice_terms) if term in s]
            if len(holders) == 1:
                isolation_events += 1
                if holders[0] == label:
                    isolation_correct += 1
                if term in EXTREME_QUANTIFIERS:
                    extreme_isolation_events += 1
                    if holders[0] == label:
                        extreme_isolation_correct += 1

        match = re.match(r"(\d{4})(\d{2})", ident)
        admin_counts[f"{match.group(1)}-{match.group(2)}" if match else "unknown"] += 1
        passage_questions[context[:400]] += 1

        sents = [s for s in SENTENCE_SPLIT.split(context) if s.strip()]
        if sents and cw:
            spw = len(cw) / len(sents)
            sentence_lengths.append(spw)
            syl = sum(syllables(w) for w in cw)
            fk_scores.append(0.39 * spw + 11.8 * (syl / len(cw)) - 15.59)
        vocab.update(w.lower() for w in cw)
        total_words += len(cw)

    per_admin = sorted(admin_counts.items())
    years = Counter(k.split("-")[0] for k in admin_counts if k != "unknown")
    ipp = sorted(passage_questions.values())

    return {
        "section": section,
        "n_items": n,
        "malformed_records": malformed,
        "lengths_chars": {
            "context": dist(ctx_chars),
            "stem": dist(stem_chars),
            "answer_choice": dist(choice_chars),
        },
        "lengths_words": {
            "context": dist(ctx_words),
            "stem": dist(stem_words),
            "answer_choice": dist(choice_words),
        },
        "length_bias": {
            "correct_mean_chars": round(statistics.fmean(correct_len), 2) if correct_len else None,
            "distractor_mean_chars": round(statistics.fmean(distractor_len), 2) if distractor_len else None,
            "cohens_d": cohens_d(correct_len, distractor_len),
            "pick_longest_accuracy": round(longest_hits / n, 4) if n else None,
            "pick_longest_accuracy_incl_ties": round((longest_hits + pick_longest_ties) / n, 4) if n else None,
            "chance": 0.2,
            "correct_answer_length_rank": {
                f"rank_{r}": rank_of_correct.get(r, 0) for r in range(5)
            },
        },
        "answer_key_balance": {
            "counts": {str(i): label_counts.get(i, 0) for i in range(5)},
            "proportions": {str(i): round(label_counts.get(i, 0) / n, 4) for i in range(5)} if n else {},
            **chi_square_uniform([label_counts.get(i, 0) for i in range(5)]),
        },
        "quantifiers": {
            "mean_terms_per_correct_answer": round(correct_terms_total / n, 3) if n else None,
            "mean_terms_per_distractor": round(distractor_terms_total / (n * 4), 3) if n else None,
            "isolation_events": isolation_events,
            "isolation_predicts_correct_rate": round(isolation_correct / isolation_events, 4) if isolation_events else None,
            "extreme_isolation_events": extreme_isolation_events,
            "extreme_isolation_predicts_correct_rate": round(extreme_isolation_correct / extreme_isolation_events, 4) if extreme_isolation_events else None,
            "isolation_chance": 0.2,
            "top_terms_correct": dict(correct_term_hits.most_common(15)),
            "top_terms_distractor": dict(distractor_term_hits.most_common(15)),
        },
        "negation_stems": {
            "count": negation_stems,
            "rate": round(negation_stems / n, 4) if n else None,
        },
        "question_types": {
            "distribution": dict(type_counts.most_common()),
            "proportions": {k: round(v / n, 4) for k, v in type_counts.most_common()} if n else {},
            "classified": n - type_counts.get("unclassified", 0),
            "classified_rate": round((n - type_counts.get("unclassified", 0)) / n, 4) if n else None,
        },
        "stem_templates": {
            "distinct_normalized_stems": len(stem_templates),
            "top_50_coverage": round(sum(c for _, c in stem_templates.most_common(50)) / n, 4) if n else None,
            "top_30": [{"template": t, "count": c} for t, c in stem_templates.most_common(30)],
        },
        "readability": {
            "type_token_ratio": round(len(vocab) / total_words, 4) if total_words else None,
            "distinct_words": len(vocab),
            "total_words": total_words,
            "words_per_sentence": dist(sentence_lengths),
            "flesch_kincaid_grade": dist(fk_scores),
        },
        "coverage": {
            "administrations": len([k for k in admin_counts if k != "unknown"]),
            "unknown_id_format": admin_counts.get("unknown", 0),
            "items_per_administration": dist([c for k, c in per_admin if k != "unknown"]),
            "by_year": dict(sorted(years.items())),
            "distinct_passages": len(passage_questions),
            "items_per_passage": dist([float(v) for v in ipp]),
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", nargs="+", required=True, help="JSONL file(s)")
    ap.add_argument("--section", required=True, choices=["lr", "rc"])
    ap.add_argument("--out", help="write JSON here")
    ap.add_argument("--compare", help="baseline JSON to diff headline metrics against")
    args = ap.parse_args()

    paths = [Path(p) for p in args.source]
    missing = [p for p in paths if not p.exists()]
    if missing:
        raise SystemExit(f"missing: {', '.join(str(m) for m in missing)}")

    result = analyse(paths, args.section)

    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(f"wrote {args.out}")

    lb = result["length_bias"]
    print(f"[{args.section}] n={result['n_items']} malformed={result['malformed_records']}")
    print(f"  pick-longest accuracy : {lb['pick_longest_accuracy']} (chance 0.20)")
    print(f"  correct-vs-distractor d: {lb['cohens_d']}")
    print(f"  key balance chi2      : {result['answer_key_balance'].get('chi_square')}")
    print(f"  typed                 : {result['question_types']['classified_rate']}")

    if args.compare:
        base = json.loads(Path(args.compare).read_text(encoding="utf-8"))
        print("\n  metric                    candidate     baseline")
        for label, path in [
            ("pick_longest_accuracy", ("length_bias", "pick_longest_accuracy")),
            ("cohens_d", ("length_bias", "cohens_d")),
            ("extreme_isolation_rate", ("quantifiers", "extreme_isolation_predicts_correct_rate")),
        ]:
            cand = result[path[0]].get(path[1])
            ref = base.get(path[0], {}).get(path[1])
            print(f"  {label:<24}  {str(cand):>10}   {str(ref):>10}")


if __name__ == "__main__":
    main()
