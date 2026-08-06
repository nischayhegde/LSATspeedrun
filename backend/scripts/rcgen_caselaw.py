"""Harvest US judicial opinions from the Caselaw Access Project static archive.

Replaces the `courtlistener` adapter in `rcgen_harvest.py`, which cannot
return anything: that adapter filters on the search API's `snippet` field,
which is a ~65-word highlight, against a >=900-word threshold, so the
condition is never satisfiable. The full-text CourtListener endpoint requires
an API token (HTTP 401 without one) and the public opinion pages refuse
programmatic fetches, so the whole route is unavailable unauthenticated.

The Caselaw Access Project (case.law, Harvard Law School Library) publishes the
same material as static JSON with no key and no rate limit. Judicial opinions
are uncopyrightable in the United States under the government edicts doctrine
(Banks v. Manchester, 128 U.S. 244; reaffirmed in Georgia v. Public.Resource.Org,
590 U.S. 255 (2020)), and CAP additionally waives any claim in its own
compilation. Output is therefore public domain.

Usage:
    python rcgen_caselaw.py --n 8 --out /tmp/rcgen/h_caselaw.jsonl
    python rcgen_caselaw.py --n 8 --reporter us --volumes 570 571 572
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

BASE = "https://static.case.law"
UA = "rcgen-research/0.1 (LSAT prep item-generation research; mailto:research@example.com)"

MIN_WORDS = 900
# Long enough to be an argued opinion rather than a per curiam order, but not so
# long that the whole volume is dominated by a handful of mega-cases.
MAX_WORDS = 20000


def fetch_json(url: str, timeout: int = 90):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z][A-Za-z'-]*", text))


def clean(text: str) -> str:
    """Strip reporter apparatus that survives OCR: page markers, footnote refs."""
    text = re.sub(r"\*\d+", " ", text)
    text = re.sub(r"\[\d+\]", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def harvest(reporter: str, volumes: list[str], n: int) -> list[dict]:
    out: list[dict] = []
    for vol in volumes:
        if len(out) >= n:
            break
        try:
            meta = fetch_json(f"{BASE}/{reporter}/{vol}/CasesMetadata.json")
        except Exception as exc:  # noqa: BLE001
            print(f"  volume {vol} metadata failed: {type(exc).__name__}", file=sys.stderr)
            continue
        print(f"  volume {vol}: {len(meta)} cases indexed", file=sys.stderr)

        # Page span is a free proxy for opinion length, so the long cases can be
        # tried first instead of paying a request for every per curiam order.
        ranked = sorted(
            meta,
            key=lambda c: (c.get("last_page_order") or 0) - (c.get("first_page_order") or 0),
            reverse=True,
        )
        for case in ranked:
            if len(out) >= n:
                break
            fname = case.get("file_name")
            if not fname:
                continue
            try:
                full = fetch_json(f"{BASE}/{reporter}/{vol}/cases/{fname}.json")
            except Exception:
                continue
            opinions = (full.get("casebody") or {}).get("opinions") or []
            # The majority opinion is the coherent argumentative unit; dissents
            # read as replies and lose their referent once excerpted.
            body = ""
            for op in opinions:
                if (op.get("type") or "").lower() in {"majority", ""}:
                    body = op.get("text") or ""
                    break
            if not body and opinions:
                body = opinions[0].get("text") or ""
            body = clean(body)
            wc = word_count(body)
            if not (MIN_WORDS <= wc <= MAX_WORDS):
                continue

            cites = case.get("citations") or []
            court = (case.get("court") or {}).get("name") or "US Courts"
            out.append({
                "source_id": f"cap-{case.get('id')}",
                "domain": "law",
                "title": case.get("name_abbreviation") or case.get("name") or "",
                "authors": [a for a in [(opinions[0].get("author") if opinions else None)] if a],
                "year": (case.get("decision_date") or "")[:4],
                "doi": None,
                "url": f"{BASE}/{reporter}/{vol}/cases/{fname}.json",
                "license": "public-domain",
                "license_url": "government edicts doctrine; Georgia v. Public.Resource.Org, 590 U.S. 255 (2020)",
                "publisher": court,
                "corpus": "caselaw_access_project",
                "fulltext_method": "cap_static_json",
                "topic": "Judicial opinion",
                "subfield": "Law",
                "citation": cites[0].get("cite") if cites else None,
                "word_count": wc,
                "text": body,
            })
            print(f"  [{len(out)}/{n}] cap_static_json  {wc:>6}w  {(case.get('name_abbreviation') or '')[:60]}")
            time.sleep(0.2)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--reporter", default="us", help="CAP reporter slug, e.g. us, f2d, a3d")
    ap.add_argument("--volumes", nargs="*", default=["572", "571", "570", "569"])
    ap.add_argument("--n", type=int, default=8)
    ap.add_argument("--out")
    args = ap.parse_args()

    print(f"harvesting {args.n} opinions from CAP {args.reporter} {args.volumes}")
    records = harvest(args.reporter, args.volumes, args.n)
    print(f"harvested {len(records)} opinions")

    if args.out:
        path = Path(args.out)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as fh:
            for rec in records:
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
