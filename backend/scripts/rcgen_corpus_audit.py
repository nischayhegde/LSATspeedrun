"""Audit harvested source corpora for licence cleanliness and LSAT topical fit.

Licence and length are mechanical checks. Topical fit is not: an article can be
perfectly CC-BY and still be useless because LSAT Reading Comprehension rotates
through law, humanities, social science and natural science as a *humanist*
would define them, whereas open-access supply is dominated by biomedicine and
research methodology. This script rates each harvested article against the four
LSAT domains with the model, so the fit claim rests on a number rather than an
impression.

Usage:
    python rcgen_corpus_audit.py --source /tmp/rcgen/h_*.jsonl --out /tmp/rcgen/audit.json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from rcgen_llm import chat, spend_summary  # noqa: E402

SYSTEM = """You classify source articles for suitability as seed material for LSAT Reading Comprehension passages.

LSAT RC rotates through four subject areas, understood as a humanities-educated
test writer would understand them:
- law: legal doctrine, jurisprudence, legal history, judicial reasoning, regulation
- humanities: literary criticism, art history, music, philosophy, intellectual history, historiography
- social_science: anthropology, sociology, economics, political theory, linguistics, history of social thought
- natural_science: biology, physics, astronomy, geology, chemistry, cognitive science, as explained to a lay reader

A usable seed article must contain an interpretive or argumentative thread that
can be developed without outside knowledge. Research-methodology papers,
clinical trial reports, software tool descriptions, bibliometrics, literature
reviews without a thesis, and papers whose content is mostly tables or
statistics are NOT usable, however well licensed.

Rate:
- lsat_domain: which of the four it best fits, or "none"
- fit: 0 = unusable, 1 = weak, 2 = usable, 3 = strong LSAT material
- reason: at most 20 words

Return JSON: {"lsat_domain": "...", "fit": 0, "reason": "..."}"""


def rate(rec: dict) -> dict:
    payload = {
        "title": rec.get("title", ""),
        "declared_domain": rec.get("domain"),
        "declared_subfield": rec.get("subfield"),
        "opening_text": " ".join((rec.get("text") or "").split()[:400]),
    }
    try:
        obj, _ = chat(SYSTEM, payload, tag="corpus_audit", max_tokens=1200, reasoning_effort="low")
    except Exception as exc:  # noqa: BLE001
        return {"lsat_domain": "error", "fit": -1, "reason": str(exc)[:60]}
    return obj


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", nargs="+", required=True)
    ap.add_argument("--out")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    recs: list[dict] = []
    for p in args.source:
        path = Path(p)
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                recs.append(json.loads(line))
    print(f"auditing {len(recs)} articles")

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        ratings = list(pool.map(rate, recs))

    by_corpus: dict[str, dict] = defaultdict(
        lambda: {"n": 0, "licenses": Counter(), "fits": [], "domains": Counter(),
                 "words": [], "usable": 0, "examples": []}
    )
    rows = []
    for rec, r in zip(recs, ratings):
        corpus = rec.get("corpus") or "unknown"
        b = by_corpus[corpus]
        b["n"] += 1
        b["licenses"][rec.get("license") or "unknown"] += 1
        fit = r.get("fit", -1)
        b["fits"].append(fit)
        b["domains"][r.get("lsat_domain") or "none"] += 1
        b["words"].append(rec.get("word_count") or 0)
        if fit >= 2:
            b["usable"] += 1
        if len(b["examples"]) < 4:
            b["examples"].append({
                "title": (rec.get("title") or "")[:70],
                "fit": fit, "lsat_domain": r.get("lsat_domain"), "reason": r.get("reason"),
            })
        rows.append({
            "source_id": rec.get("source_id"), "corpus": corpus,
            "declared_domain": rec.get("domain"), "title": (rec.get("title") or "")[:80],
            "license": rec.get("license"), "word_count": rec.get("word_count"),
            **{k: r.get(k) for k in ("lsat_domain", "fit", "reason")},
        })

    summary = {}
    for corpus, b in by_corpus.items():
        valid = [f for f in b["fits"] if f >= 0]
        summary[corpus] = {
            "n": b["n"],
            "licenses": dict(b["licenses"]),
            "mean_fit": round(sum(valid) / len(valid), 2) if valid else None,
            "usable_rate_fit_ge_2": round(b["usable"] / b["n"], 3) if b["n"] else None,
            "lsat_domain_assigned": dict(b["domains"]),
            "median_source_words": sorted(b["words"])[len(b["words"]) // 2] if b["words"] else None,
            "examples": b["examples"],
        }

    out = {"summary": summary, "rows": rows, "spend": spend_summary()}
    print(json.dumps(summary, indent=2))
    if args.out:
        Path(args.out).write_text(json.dumps(out, indent=2), encoding="utf-8")
        print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
