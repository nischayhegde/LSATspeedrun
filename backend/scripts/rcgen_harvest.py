"""Harvest license-clean source articles as RC passage seed material.

Discovery runs through OpenAlex, which carries a per-work license field and a
topic taxonomy, so a candidate can be filtered on licence *and* subject before
anything is downloaded. Full text is then pulled from XML/HTML-native
endpoints; PDF-only locations are skipped rather than scraped, because PDF
extraction introduces hyphenation and column-order noise that is
indistinguishable from bad source prose downstream.

Two non-OpenAlex adapters cover the domains where CC-BY journal supply is
thinnest relative to what the LSAT actually tests:
  crs           -- Congressional Research Service reports, US Government works
  courtlistener -- US judicial opinions, government edicts doctrine

Output is JSONL, one record per article, carrying the attribution fields that
CC-BY compliance requires (title, authors, year, DOI/URL, licence, publisher).

Usage:
    python rcgen_harvest.py --domain law --n 5 --out /tmp/rcgen/law.jsonl
    python rcgen_harvest.py --list-domains
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

UA = "rcgen-research/0.1 (LSAT prep item-generation research; mailto:research@example.com)"
OPENALEX = "https://api.openalex.org"
EUROPEPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest"

# Licences that permit commercial derivative use with attribution only.
# CC BY-SA is deliberately excluded: share-alike would propagate copyleft into
# the generated passage, which defeats the purpose of the exercise.
CLEAN_LICENSES = {"cc-by", "cc0", "public-domain"}

# OpenAlex subfield ids, chosen to mirror the four subject areas real LSAT RC
# rotates through rather than whatever happens to be well supplied in OA.
DOMAINS = {
    "law": [3308],
    "humanities": [1202, 1211, 1208, 1207],
    "social_science": [3312, 3320, 3314, 2002],
    "natural_science": [3103, 1907, 1105, 1315],
}


def fetch(url: str, timeout: int = 60, accept: str | None = None) -> bytes:
    headers = {"User-Agent": UA}
    if accept:
        headers["Accept"] = accept
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def fetch_json(url: str, timeout: int = 60):
    return json.loads(fetch(url, timeout, accept="application/json"))


class ParagraphExtractor(HTMLParser):
    """Pull <p> text out of an article page, skipping boilerplate containers."""

    SKIP_TAGS = {"script", "style", "noscript", "nav", "header", "footer", "figure", "table"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.paragraphs: list[str] = []
        self._buf: list[str] = []
        self._in_p = 0
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP_TAGS:
            self._skip_depth += 1
        elif tag == "p" and not self._skip_depth:
            self._in_p += 1

    def handle_endtag(self, tag):
        if tag in self.SKIP_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
        elif tag == "p" and self._in_p:
            self._in_p -= 1
            text = re.sub(r"\s+", " ", "".join(self._buf)).strip()
            if text:
                self.paragraphs.append(text)
            self._buf = []

    def handle_data(self, data):
        if self._in_p and not self._skip_depth:
            self._buf.append(data)


def html_to_text(raw: bytes) -> str:
    try:
        html = raw.decode("utf-8", "replace")
    except Exception:
        return ""
    parser = ParagraphExtractor()
    try:
        parser.feed(html)
    except Exception:
        pass
    # Short paragraphs are almost always cookie notices, captions or nav links.
    kept = [p for p in parser.paragraphs if len(p.split()) >= 25]
    return "\n\n".join(kept)


def xml_to_text(raw: bytes) -> str:
    """JATS full text: take <body> paragraphs, drop refs/tables/formulas."""
    import xml.etree.ElementTree as ET

    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return ""
    body = root.find(".//body")
    if body is None:
        return ""
    out = []
    for p in body.iter("p"):
        text = re.sub(r"\s+", " ", "".join(p.itertext())).strip()
        if len(text.split()) >= 25:
            out.append(text)
    return "\n\n".join(out)


def word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z][A-Za-z'-]*", text))


# --------------------------------------------------------------------------
# OpenAlex-driven journal harvest
# --------------------------------------------------------------------------

def openalex_candidates(subfields: list[int], per_page: int = 50, pages: int = 4):
    joined = "|".join(f"subfields/{s}" for s in subfields)
    for page in range(1, pages + 1):
        flt = (
            f"primary_topic.subfield.id:{joined}"
            ",best_oa_location.license:cc-by"
            ",type:article"
            ",has_fulltext:true"
            ",language:en"
            ",from_publication_date:2015-01-01"
        )
        url = f"{OPENALEX}/works?filter={flt}&per-page={per_page}&page={page}&sort=cited_by_count:desc"
        try:
            data = fetch_json(url)
        except Exception as exc:
            print(f"  openalex page {page} failed: {type(exc).__name__}", file=sys.stderr)
            return
        for work in data.get("results", []):
            yield work
        if len(data.get("results", [])) < per_page:
            return


def resolve_fulltext(work: dict) -> tuple[str, str]:
    """Return (text, method). Empty text means no XML/HTML route was available."""
    ids = work.get("ids", {})
    pmcid = ids.get("pmcid")
    if pmcid:
        pmc = pmcid.rstrip("/").split("/")[-1]
        try:
            raw = fetch(f"{EUROPEPMC}/{pmc}/fullTextXML", timeout=60)
            text = xml_to_text(raw)
            if word_count(text) >= 900:
                return text, "europepmc_jats"
        except Exception:
            pass

    seen = set()
    for loc in [work.get("best_oa_location")] + (work.get("locations") or []):
        if not loc:
            continue
        url = loc.get("landing_page_url")
        if not url or url in seen:
            continue
        seen.add(url)
        if (loc.get("license") or "") not in CLEAN_LICENSES:
            continue
        try:
            text = html_to_text(fetch(url, timeout=60))
        except Exception:
            continue
        if word_count(text) >= 900:
            return text, "landing_html"
    return "", "none"


def harvest_openalex(domain: str, n: int) -> list[dict]:
    out: list[dict] = []
    tried = 0
    for work in openalex_candidates(DOMAINS[domain]):
        if len(out) >= n:
            break
        tried += 1
        loc = work.get("best_oa_location") or {}
        if (loc.get("license") or "") not in CLEAN_LICENSES:
            continue
        text, method = resolve_fulltext(work)
        if not text:
            continue
        authors = [
            a["author"]["display_name"]
            for a in (work.get("authorships") or [])[:8]
            if a.get("author", {}).get("display_name")
        ]
        src = (loc.get("source") or {})
        out.append({
            "source_id": work.get("id", "").split("/")[-1],
            "domain": domain,
            "title": work.get("title") or "",
            "authors": authors,
            "year": work.get("publication_year"),
            "doi": work.get("doi"),
            "url": loc.get("landing_page_url"),
            "license": loc.get("license"),
            "license_url": loc.get("license_id"),
            "publisher": src.get("display_name") or src.get("host_organization_name"),
            "corpus": "openalex_ccby",
            "fulltext_method": method,
            "topic": (work.get("primary_topic") or {}).get("display_name"),
            "subfield": ((work.get("primary_topic") or {}).get("subfield") or {}).get("display_name"),
            "word_count": word_count(text),
            "text": text,
        })
        print(f"  [{len(out)}/{n}] {method:<16} {word_count(text):>6}w  {(work.get('title') or '')[:64]}")
        time.sleep(0.3)
    print(f"  examined {tried} works to obtain {len(out)}", file=sys.stderr)
    return out


# --------------------------------------------------------------------------
# Congressional Research Service — US Government works (public domain)
# --------------------------------------------------------------------------

def harvest_crs(n: int) -> list[dict]:
    index = fetch("https://www.everycrsreport.com/reports.csv", timeout=120).decode("utf-8", "replace")
    import csv, io

    rows = list(csv.DictReader(io.StringIO(index)))
    rows = [r for r in rows if r.get("latestPubDate", "") >= "2018"]
    rows.sort(key=lambda r: r.get("latestPubDate", ""), reverse=True)

    out: list[dict] = []
    for row in rows:
        if len(out) >= n:
            break
        num = row.get("number") or ""
        try:
            meta = fetch_json(f"https://www.everycrsreport.com/reports/{num}.json", timeout=60)
        except Exception:
            continue
        versions = meta.get("versions") or []
        if not versions:
            continue
        html_file = next(
            (f for f in (versions[0].get("formats") or []) if f.get("format") == "HTML"), None
        )
        if not html_file:
            continue
        try:
            raw = fetch(f"https://www.everycrsreport.com/{html_file['filename']}", timeout=60)
        except Exception:
            continue
        text = html_to_text(raw)
        if word_count(text) < 900:
            continue
        out.append({
            "source_id": f"crs-{num}",
            "domain": "law_policy",
            "title": versions[0].get("title") or row.get("title") or "",
            "authors": [],
            "year": (versions[0].get("date") or "")[:4],
            "doi": None,
            "url": f"https://www.everycrsreport.com/reports/{num}.html",
            "license": "public-domain",
            "license_url": "17 U.S.C. 105",
            "publisher": "Congressional Research Service",
            "corpus": "crs_usgov",
            "fulltext_method": "crs_html",
            "topic": (versions[0].get("topics") or [None])[0],
            "subfield": "Law and Public Policy",
            "word_count": word_count(text),
            "text": text,
        })
        print(f"  [{len(out)}/{n}] crs_html         {word_count(text):>6}w  {(versions[0].get('title') or '')[:64]}")
        time.sleep(0.3)
    return out


# --------------------------------------------------------------------------
# CourtListener — US judicial opinions (government edicts doctrine)
# --------------------------------------------------------------------------

def harvest_courtlistener(n: int) -> list[dict]:
    out: list[dict] = []
    url = (
        "https://www.courtlistener.com/api/rest/v4/search/"
        "?q=&type=o&court=scotus&order_by=dateFiled%20desc&format=json"
    )
    try:
        data = fetch_json(url, timeout=60)
    except Exception as exc:
        print(f"  courtlistener search failed: {type(exc).__name__}", file=sys.stderr)
        return out

    for res in data.get("results", []):
        if len(out) >= n:
            break
        for op in res.get("opinions", []) or []:
            snippet = op.get("snippet") or ""
            if word_count(snippet) < 900:
                continue
            out.append({
                "source_id": f"cl-{op.get('id')}",
                "domain": "law",
                "title": res.get("caseName") or "",
                "authors": [],
                "year": (res.get("dateFiled") or "")[:4],
                "doi": None,
                "url": f"https://www.courtlistener.com{res.get('absolute_url', '')}",
                "license": "public-domain",
                "license_url": "government edicts doctrine",
                "publisher": res.get("court") or "US Courts",
                "corpus": "courtlistener_usgov",
                "fulltext_method": "cl_api",
                "topic": "Judicial opinion",
                "subfield": "Law",
                "word_count": word_count(snippet),
                "text": snippet,
            })
            break
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--domain", choices=list(DOMAINS) + ["crs", "courtlistener"])
    ap.add_argument("--n", type=int, default=5)
    ap.add_argument("--out", help="JSONL destination")
    ap.add_argument("--list-domains", action="store_true")
    args = ap.parse_args()

    if args.list_domains:
        for name, subs in DOMAINS.items():
            print(f"{name:<18} openalex subfields {subs}")
        print(f"{'crs':<18} EveryCRSReport, US Government works")
        print(f"{'courtlistener':<18} US judicial opinions")
        return

    if not args.domain:
        raise SystemExit("--domain is required")

    print(f"harvesting {args.n} from {args.domain}")
    if args.domain == "crs":
        records = harvest_crs(args.n)
    elif args.domain == "courtlistener":
        records = harvest_courtlistener(args.n)
    else:
        records = harvest_openalex(args.domain, args.n)

    print(f"harvested {len(records)} articles")
    if args.out:
        path = Path(args.out)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as fh:
            for rec in records:
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
