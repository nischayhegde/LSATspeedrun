"""Verbatim-overlap check between a generated passage and its source article.

The licensing position depends on an empirical question that can be answered
without a model: how much of the source's *expression* survives condensation.
Copyright protects expression rather than facts or ideas, so a passage that
shares no extended verbatim run with its source is on very different ground
from one that is a light paraphrase.

Reports, per passage, the longest common word run and the proportion of its
n-grams that also appear in the source. Also emits the attribution record that
CC-BY compliance requires, so the same pass produces the credit line.

This check is free and deterministic and belongs in the production pipeline as
a hard gate, not as a spot check.

Usage:
    python rcgen_provenance.py --passages /tmp/rcgen/passages_final.jsonl \
        --sources /tmp/rcgen/seed_final.jsonl --out /tmp/rcgen/provenance.json
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

# A run this long is very unlikely to coincide by chance in ordinary English and
# is the conventional trigger for a closer look in plagiarism tooling.
LONGEST_RUN_GATE = 12
NGRAM = 8
NGRAM_OVERLAP_GATE = 0.02


def norm_words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", text.lower())


def ngrams(seq: list[str], n: int) -> set[tuple[str, ...]]:
    return {tuple(seq[i:i + n]) for i in range(len(seq) - n + 1)} if len(seq) >= n else set()


def longest_common_run(a: list[str], b: list[str], cap: int = 60) -> int:
    """Longest run of a appearing contiguously in b, found by binary search."""
    b_index: dict[tuple[str, ...], bool] = {}
    lo, hi, best = 1, min(cap, len(a)), 0
    while lo <= hi:
        mid = (lo + hi) // 2
        key = mid
        if key not in b_index:
            b_grams = ngrams(b, mid)
            found = any(tuple(a[i:i + mid]) in b_grams for i in range(len(a) - mid + 1))
        else:
            found = b_index[key]
        if found:
            best, lo = mid, mid + 1
        else:
            hi = mid - 1
    return best


def credit_line(attr: dict) -> str:
    """A CC-BY compliant credit: title, creator, source URI, licence, adaptation."""
    authors = attr.get("authors") or []
    who = ", ".join(authors[:3]) + (" et al." if len(authors) > 3 else "")
    bits = [f'"{attr.get("title", "").strip()}"']
    if who:
        bits.append(f"by {who}")
    if attr.get("year"):
        bits.append(f"({attr['year']})")
    if attr.get("publisher"):
        bits.append(f"— {attr['publisher']}")
    lic = (attr.get("license") or "").lower()
    if lic == "cc-by":
        bits.append("licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)")
    elif lic == "public-domain":
        bits.append(f"public domain ({attr.get('license_url') or 'US Government work'})")
    src = attr.get("doi") or attr.get("url")
    if src:
        bits.append(f"source: {src}")
    bits.append("Adapted: condensed and rewritten.")
    return " ".join(bits)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--passages", required=True)
    ap.add_argument("--sources", required=True)
    ap.add_argument("--out")
    args = ap.parse_args()

    sources = {}
    for line in Path(args.sources).read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            sources[r["source_id"]] = r

    rows = []
    for line in Path(args.passages).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        p = json.loads(line)
        attr = p.get("attribution") or {}
        src = sources.get(attr.get("source_id"))
        if not src:
            continue
        pw, sw = norm_words(p["passage"]), norm_words(src["text"])
        pg, sg = ngrams(pw, NGRAM), ngrams(sw, NGRAM)
        overlap = len(pg & sg) / len(pg) if pg else 0.0
        run = longest_common_run(pw, sw)
        rows.append({
            "passage_id": p["passage_id"],
            "license": attr.get("license"),
            "source_words": len(sw),
            "passage_words": len(pw),
            "compression": round(len(pw) / len(sw), 4) if sw else None,
            "longest_verbatim_run_words": run,
            f"shared_{NGRAM}gram_rate": round(overlap, 4),
            "passes_gate": run < LONGEST_RUN_GATE and overlap < NGRAM_OVERLAP_GATE,
            "credit_line": credit_line(attr),
        })

    n = len(rows)
    runs = sorted(r["longest_verbatim_run_words"] for r in rows)
    over = sorted(r[f"shared_{NGRAM}gram_rate"] for r in rows)
    summary = {
        "n_passages": n,
        "longest_verbatim_run": {
            "median": runs[n // 2] if n else None,
            "max": runs[-1] if n else None,
            "gate": LONGEST_RUN_GATE,
        },
        f"shared_{NGRAM}gram_rate": {
            "median": over[n // 2] if n else None,
            "max": over[-1] if n else None,
            "gate": NGRAM_OVERLAP_GATE,
        },
        "median_compression": round(sorted(r["compression"] for r in rows)[n // 2], 4) if n else None,
        "passes_gate": sum(1 for r in rows if r["passes_gate"]),
        "pass_rate": round(sum(1 for r in rows if r["passes_gate"]) / n, 4) if n else None,
    }
    print(json.dumps(summary, indent=2))
    print("\nexample credit line:\n  " + (rows[0]["credit_line"] if rows else "—"))
    print("\nworst 5 by verbatim run:")
    for r in sorted(rows, key=lambda x: -x["longest_verbatim_run_words"])[:5]:
        print(f"  run={r['longest_verbatim_run_words']:>3}  "
              f"{NGRAM}gram={r[f'shared_{NGRAM}gram_rate']:.4f}  {r['passage_id']}")
    if args.out:
        Path(args.out).write_text(json.dumps({"summary": summary, "rows": rows}, indent=2), encoding="utf-8")
        print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
