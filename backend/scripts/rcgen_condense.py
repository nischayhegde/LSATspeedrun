"""Condense harvested source articles into LSAT-register RC passages.

The binding constraint is length: real LSAT RC passages occupy 435-490 words
(p5-p95 of 2,366 items), a 55-word window. Everything else in the prompt is
subordinate to landing inside it while still reading like test prose rather
than like a summary of an article.

Prompt variants are addressed by name so that iterations are comparable rather
than anecdotal; `--variant` selects one and every output record carries the
variant that produced it.

Usage:
    python rcgen_condense.py --source /tmp/rcgen/law.jsonl --variant v3 \
        --out /tmp/rcgen/passages_v3.jsonl --repair
    python rcgen_condense.py --report /tmp/rcgen/passages_v3.jsonl
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from corpus_stats import SENTENCE_SPLIT, syllables, words  # noqa: E402
from rcgen_llm import chat, spend_summary  # noqa: E402

TARGET_LO, TARGET_HI = 435, 490
HARD_LO, HARD_HI = 430, 495

# Cap on source words handed to the model. Long enough to contain a real
# argumentative thread, short enough to keep input cost negligible.
SOURCE_CAP = 3500


# ---------------------------------------------------------------------------
# Prompt variants, in the order they were tried
# ---------------------------------------------------------------------------

V1 = """You write reading comprehension passages for a standardized law school admission test.

Condense the supplied source article into a single passage of 435-490 words.
Return JSON: {"passage": "...", "title_hint": "..."}"""


V2 = """You write reading comprehension passages for the Reading Comprehension section of a standardized law school admission test.

Condense the supplied source article into ONE passage.

Hard requirements:
- Length 435-490 words. This is the single most important constraint.
- 4 or 5 paragraphs, separated by a blank line. No headings, no lists, no citations.
- Average sentence length 24-33 words. Use subordination and qualification.
- Reading level: first-year graduate (Flesch-Kincaid grade 15-19).
- Formal academic register, third person, present tense for scholarly positions.

Do not write a summary of an article. Write a passage that presents a position
and its complications, the way test prose does.

Return JSON: {"passage": "...", "title_hint": "..."}"""


V3 = """You write passages for the Reading Comprehension section of a standardized law school admission test. Your output is indistinguishable from published test material.

Take the supplied source article and write ONE original passage that develops an
argumentative thread found in it.

LENGTH (the binding constraint):
- Exactly 435-490 words. Count them. A passage outside this band is rejected
  outright regardless of quality.
- Aim for 460 words so that you have margin on both sides.

STRUCTURE:
- 4 paragraphs, separated by a blank line.
- Paragraph 1 establishes a received view, a practice, or a problem.
- Paragraph 2 develops it, or introduces the evidence it rests on.
- Paragraph 3 introduces a complication, a competing interpretation, or a critic.
- Paragraph 4 qualifies rather than resolves. Do not end on a tidy conclusion.

REGISTER (how test prose differs from expository writing):
- Average sentence 24-33 words. Achieve this with subordinate clauses,
  appositives and parenthetical qualification, not by splicing clauses with "and".
- Attribute positions to unnamed classes of scholars: "Some legal historians",
  "Proponents of this account", "A more recent line of criticism".
- Never address the reader. Never use "this passage", "the article", "we will see".
- No bullet points, no headings, no section numbers, no citations, no dates in
  parentheses, no proper names of living individuals.
- Abstract nouns and nominalizations are appropriate and raise the register.
- The author has a discernible but restrained stance, usually sympathetic to a
  qualified version of one position.

CONTENT:
- Self-contained. A reader with no outside knowledge can answer questions from
  the text alone.
- Include at least one specific mechanism, example, or piece of evidence, so
  that detail questions are possible.
- Include at least one point of genuine interpretive tension, so that inference
  and attitude questions are possible.

Return JSON: {"passage": "...", "title_hint": "..."}"""


# v4 is the product of the v1-v3 measurements. Two things changed. First, the
# length target is expressed as a *sentence budget* rather than a word count,
# because the model cannot count words (v3 was asked for 460 and returned
# 482-534) but can hold a sentence count; 16 sentences at 28 words each also
# pins mean sentence length, which v3 missed low at 22.2. Second, the
# Flesch-Kincaid instruction is dropped: v2 stated the 15-19 band explicitly and
# overshot to a median of 19.1, while v3 said nothing about it and landed at
# 17.1, so naming the readability target appears to make the model inflate
# diction.

V4 = """You write passages for the Reading Comprehension section of a standardized law school admission test. Your output is indistinguishable from published test material.

Take the supplied source article and write ONE original passage that develops an
argumentative thread found in it.

FORM (follow this exactly; it is what makes the passage the right size and rhythm):
- Exactly 4 paragraphs, separated by a blank line.
- Exactly 4 sentences in each paragraph. 16 sentences in total.
- Every sentence must be substantial, 22 to 34 words. Nothing under 20 words.
  Do not write a punchy closing line.
- That yields a passage of roughly 450 words, which is the required size.

Build the long sentences out of subordinate clauses, appositives, concessive
openers ("Although...", "While...") and parenthetical qualification. Do not
manufacture length by joining independent clauses with "and".

STRUCTURE:
- Paragraph 1 establishes a received view, a practice, or a problem.
- Paragraph 2 develops it, or presents the evidence it rests on.
- Paragraph 3 introduces a complication, a competing interpretation, or a critic.
- Paragraph 4 qualifies rather than resolves. Do not end on a tidy conclusion.

REGISTER:
- Attribute positions to unnamed classes of scholars: "Some legal historians",
  "Proponents of this account", "A more recent line of criticism".
- Never address the reader. Never use "this passage", "the article", "we".
- No bullet points, headings, section numbers, citations, parenthetical dates,
  or proper names of living individuals.
- Abstract nouns and nominalization are appropriate.
- The author has a discernible but restrained stance, usually sympathetic to a
  qualified version of one position.

CONTENT:
- Self-contained. A reader with no outside knowledge can answer questions from
  the text alone.
- Include at least one specific mechanism, example, or piece of evidence, so
  that detail questions are possible.
- Include at least one point of genuine interpretive tension, so that inference
  and attitude questions are possible.

Return JSON: {"passage": "...", "title_hint": "..."}"""


# v5 targets the one thing v4 still missed. Flesch-Kincaid has exactly two
# inputs, and the measurement showed v4's syntax was already right (26.9 words
# per sentence against a real-LSAT 28.2) while its diction was not: 2.185
# syllables per word and 15.3% four-syllable-plus words, against 1.797 and 8.9%
# in the 349 real passages. Naive v1 was already at 14.1%, so over-Latinate
# diction is a property of LLM academic prose rather than something the earlier
# prompts introduced -- though v4's "nominalization is appropriate" line made it
# worse. Real LSAT prose is long sentences built from ordinary words. v5 keeps
# v4's sentence budget verbatim and replaces the register section.

V5 = """You write passages for the Reading Comprehension section of a standardized law school admission test. Your output is indistinguishable from published test material.

Take the supplied source article and write ONE original passage that develops an
argumentative thread found in it.

FORM (follow this exactly; it is what makes the passage the right size and rhythm):
- Exactly 4 paragraphs, separated by a blank line.
- Exactly 4 sentences in each paragraph. 16 sentences in total.
- Every sentence must be substantial, 22 to 34 words. Nothing under 20 words.
  Do not write a punchy closing line.
- That yields a passage of roughly 450 words, which is the required size.

Build the long sentences out of subordinate clauses, appositives, concessive
openers ("Although...", "While...") and parenthetical qualification. Do not
manufacture length by joining independent clauses with "and".

DICTION (this is where machine-written passages give themselves away):
- The sentences are long, but the WORDS are ordinary. Fewer than one word in ten
  should have four or more syllables.
- Prefer the plain word to the learned one: "use" not "utilization", "show" not
  "demonstrate", "about" not "concerning", "change" not "transformation", "way"
  not "methodology", "view" not "conceptualization".
- Never stack abstract nouns. Write "when courts read statutes narrowly", not
  "the narrow judicial interpretation of statutory provisions".
- Prefer verbs to nominalizations: "critics argue that judges defer" rather than
  "the argumentation of critics concerns judicial deference".
- Latinate abstraction is the single most common tell. A sentence can be
  thirty words long and still use only common English words; that is the target.

STRUCTURE:
- Paragraph 1 establishes a received view, a practice, or a problem.
- Paragraph 2 develops it, or presents the evidence it rests on.
- Paragraph 3 introduces a complication, a competing interpretation, or a critic.
- Paragraph 4 qualifies rather than resolves. Do not end on a tidy conclusion.

REGISTER:
- Attribute positions to unnamed classes of scholars: "Some legal historians",
  "Proponents of this account", "A more recent line of criticism".
- Never address the reader. Never use "this passage", "the article", "we".
- No bullet points, headings, section numbers, citations, parenthetical dates,
  or proper names of living individuals.
- The author has a discernible but restrained stance, usually sympathetic to a
  qualified version of one position.

CONTENT:
- Self-contained. A reader with no outside knowledge can answer questions from
  the text alone.
- Include at least one specific mechanism, example, or piece of evidence, so
  that detail questions are possible.
- Include at least one point of genuine interpretive tension, so that inference
  and attitude questions are possible.

Return JSON: {"passage": "...", "title_hint": "..."}"""


REPAIR = """You are editing a passage for a standardized test to hit an exact length band.

You will receive a passage and a target. Adjust its length to fall within
435-490 words while preserving its argument, paragraph count, register and
sentence rhythm (24-33 words per sentence average).

- To lengthen: add qualification, a subordinate clause of concession, or a
  further specification of an existing example. Do not add a new topic and do
  not add a new sentence; extend existing sentences instead.
- To shorten: delete redundant restatement and trim modifiers. Do not delete a
  paragraph, do not drop the complication, and do not merge sentences.
- Keep the vocabulary plain. Do not substitute a longer Latinate word for a
  short one, and do not introduce abstract noun phrases.

Return JSON: {"passage": "..."}"""


VARIANTS = {"v1": V1, "v2": V2, "v3": V3, "v4": V4, "v5": V5}


# ---------------------------------------------------------------------------
# Measurement
# ---------------------------------------------------------------------------

def measure(text: str) -> dict:
    w = words(text)
    sents = [s for s in SENTENCE_SPLIT.split(text) if s.strip()]
    n_w, n_s = len(w), max(len(sents), 1)
    wps = n_w / n_s
    syl = sum(syllables(x) for x in w)
    spw = syl / n_w if n_w else 0.0
    fk = 0.39 * wps + 11.8 * spw - 15.59 if n_w else 0.0
    return {
        "words": n_w,
        "sentences": n_s,
        "words_per_sentence": round(wps, 2),
        "fk_grade": round(fk, 2),
        # FK has only two inputs. Separating them shows which one is off target:
        # real LSAT RC sits at 28.3 words/sentence and 1.81 syllables/word.
        "syllables_per_word": round(spw, 3),
        "long_word_rate": round(sum(1 for x in w if syllables(x) >= 4) / n_w, 3) if n_w else 0.0,
        "paragraphs": len([p for p in text.split("\n\n") if p.strip()]),
        "in_band": TARGET_LO <= n_w <= TARGET_HI,
        "in_hard_band": HARD_LO <= n_w <= HARD_HI,
        "fk_ok": 15 <= fk <= 19,
        "wps_ok": 24 <= wps <= 33,
    }


# Cues that the model produced expository/summary prose rather than test prose.
TELLS = {
    "meta_reference": r"\bthis (?:passage|article|paper|essay|study|text)\b|\bthe (?:article|author of the article)\b",
    "reader_address": r"\b(?:we (?:will|shall|can) see|you (?:can|will|should)|let us|consider that)\b",
    "list_markers": r"(?m)^\s*(?:[-*\u2022]|\d+[.)])\s+",
    "headings": r"(?m)^\s*#{1,6}\s|\n[A-Z][A-Za-z ]{2,40}\n\n",
    "citation": r"\([A-Z][a-z]+,? \d{4}\)|\[\d+\]|et al\.",
    "first_person": r"\b(?:I|my|our|we)\b",
    "summary_frame": r"\b(?:in (?:summary|conclusion)|to summarize|overall,|in short)\b",
}


def register_tells(text: str) -> list[str]:
    return [name for name, pat in TELLS.items() if re.search(pat, text)]


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

SENT_BOUNDARY = re.compile(r"(?<=[.!?])[\"')\]]*\s+")


def regroup_paragraphs(text: str, target: int = 4) -> str:
    """Reflow one-sentence-per-line output into `target` paragraphs.

    The v4/v5 sentence budget ("exactly 4 sentences in each paragraph") is read
    by the model as "each sentence is its own block": v5 produced a median of 16
    paragraphs for 16 sentences. The paragraph count is the one formal property
    that can be fixed deterministically after the fact, so it is, rather than
    spending another prompt iteration and another set of model calls on it.
    Passages already correctly paragraphed are left untouched.
    """
    blocks = [b.strip() for b in text.split("\n\n") if b.strip()]
    if len(blocks) <= target + 1:
        return "\n\n".join(blocks)

    sents = [s.strip() for s in SENT_BOUNDARY.split(" ".join(blocks)) if s.strip()]
    if len(sents) < target:
        return "\n\n".join(blocks)

    base, extra = divmod(len(sents), target)
    out, i = [], 0
    for k in range(target):
        take = base + (1 if k < extra else 0)
        out.append(" ".join(sents[i:i + take]))
        i += take
    return "\n\n".join(p for p in out if p)


def trim_source(text: str, cap: int = SOURCE_CAP) -> str:
    w = text.split()
    return " ".join(w[:cap]) if len(w) > cap else text


def condense_one(rec: dict, variant: str, repair: bool, rounds: int = 3) -> dict | None:
    system = VARIANTS[variant]
    payload = {
        "source_title": rec.get("title", ""),
        "source_domain": rec.get("domain", ""),
        "source_subfield": rec.get("subfield", ""),
        "source_text": trim_source(rec.get("text", "")),
    }
    try:
        obj, _ = chat(system, payload, tag=f"condense_{variant}", max_tokens=6000)
    except Exception as exc:  # noqa: BLE001
        print(f"  FAIL {rec.get('source_id')}: {exc}", file=sys.stderr)
        return None

    passage = (obj.get("passage") or "").strip()
    if not passage:
        return None
    passage = regroup_paragraphs(re.sub(r"\n{3,}", "\n\n", passage))

    m = measure(passage)
    repaired = 0

    def miss(x: dict) -> int:
        return max(0, TARGET_LO - x["words"], x["words"] - TARGET_HI)

    # One repair pass typically halves the distance rather than closing it, so
    # iterate; a round that does not improve is discarded and ends the loop.
    for _ in range(rounds if repair else 0):
        if m["in_band"]:
            break
        delta = TARGET_LO - m["words"] if m["words"] < TARGET_LO else TARGET_HI - m["words"]
        try:
            obj2, _ = chat(
                REPAIR,
                {
                    "passage": passage,
                    "current_word_count": m["words"],
                    "target_band": [TARGET_LO, TARGET_HI],
                    "instruction": (
                        f"Add roughly {delta + 10} words." if delta > 0
                        else f"Remove roughly {-delta + 10} words."
                    ),
                },
                tag=f"repair_{variant}", max_tokens=6000,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"  repair failed {rec.get('source_id')}: {exc}", file=sys.stderr)
            break
        cand = regroup_paragraphs(re.sub(r"\n{3,}", "\n\n", (obj2.get("passage") or "").strip()))
        if not cand:
            break
        m2 = measure(cand)
        if miss(m2) >= miss(m):
            break
        passage, m = cand, m2
        repaired += 1

    return {
        "passage_id": f"{rec.get('source_id')}-{variant}",
        "variant": variant,
        "repaired": repaired,
        "passage": passage,
        "title_hint": obj.get("title_hint") or rec.get("title", ""),
        "metrics": m,
        "register_tells": register_tells(passage),
        "attribution": {
            "source_id": rec.get("source_id"),
            "title": rec.get("title"),
            "authors": rec.get("authors"),
            "year": rec.get("year"),
            "doi": rec.get("doi"),
            "url": rec.get("url"),
            "license": rec.get("license"),
            "license_url": rec.get("license_url"),
            "publisher": rec.get("publisher"),
            "corpus": rec.get("corpus"),
        },
        "domain": rec.get("domain"),
        "subfield": rec.get("subfield"),
    }


def report(path: Path) -> dict:
    recs = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    if not recs:
        return {}
    ms = [r["metrics"] for r in recs]
    n = len(ms)

    def frac(key):
        return round(sum(1 for m in ms if m[key]) / n, 3)

    def med(key):
        vals = sorted(m[key] for m in ms)
        return round(vals[n // 2], 2)

    tells = {}
    for r in recs:
        for t in r["register_tells"]:
            tells[t] = tells.get(t, 0) + 1

    return {
        "file": str(path),
        "n": n,
        "variant": recs[0].get("variant"),
        "repair_rounds_used": sum(int(r.get("repaired") or 0) for r in recs),
        "passages_repaired": sum(1 for r in recs if r.get("repaired")),
        "in_band_435_490": frac("in_band"),
        "in_hard_band_430_495": frac("in_hard_band"),
        "fk_15_19": frac("fk_ok"),
        "wps_24_33": frac("wps_ok"),
        "all_three": round(sum(1 for m in ms if m["in_band"] and m["fk_ok"] and m["wps_ok"]) / n, 3),
        "median_words": med("words"),
        "median_fk": med("fk_grade"),
        "median_wps": med("words_per_sentence"),
        "median_syl_per_word": med("syllables_per_word"),
        "median_long_word_rate": med("long_word_rate"),
        "word_range": [min(m["words"] for m in ms), max(m["words"] for m in ms)],
        "fk_range": [min(m["fk_grade"] for m in ms), max(m["fk_grade"] for m in ms)],
        "register_tells": tells,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", nargs="*", help="harvested source JSONL")
    ap.add_argument("--variant", choices=list(VARIANTS), default="v3")
    ap.add_argument("--out")
    ap.add_argument("--repair", action="store_true", help="iterative pass to pull length into band")
    ap.add_argument("--repair-rounds", type=int, default=3)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--report", help="summarise an existing passages file and exit")
    args = ap.parse_args()

    if args.report:
        print(json.dumps(report(Path(args.report)), indent=2))
        return

    if not args.source or not args.out:
        raise SystemExit("--source and --out are required")

    recs: list[dict] = []
    for p in args.source:
        for line in Path(p).read_text(encoding="utf-8").splitlines():
            if line.strip():
                recs.append(json.loads(line))
    if args.limit:
        recs = recs[: args.limit]
    print(f"condensing {len(recs)} sources with {args.variant} (repair={args.repair})")

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(lambda r: condense_one(r, args.variant, args.repair, args.repair_rounds), recs))
    out_recs = [r for r in results if r]

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as fh:
        for r in out_recs:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"wrote {len(out_recs)} passages to {out}")
    print(json.dumps(report(out), indent=2))
    print("spend:", json.dumps(spend_summary(), indent=2))


if __name__ == "__main__":
    main()
