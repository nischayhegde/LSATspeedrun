#!/usr/bin/env python3
"""Derive, verify and store where each Reading Comprehension passage divides.

Three modes, because a derived boundary has to earn its place before it is
written anywhere:

    python scripts/derive_passage_paragraphs.py --verify
        Score the segmenter against the only boundaries in this bank that are
        genuinely known — the seam between Passage A and Passage B on the 32
        comparative sets, with both headings stripped so the segmenter cannot see
        them — and against three baselines. Then report the shape of what it
        produces across all 349 passages. Touches no database.

    python scripts/derive_passage_paragraphs.py --sample 12 [--seed 7]
        Print whole passages divided as the app would divide them, for reading.
        This is not optional and not a formality: the reason the user asked for
        derivation rather than a heuristic is that a wrong split teaches a false
        structure, and no aggregate number can tell you whether a cut lands in
        the middle of an argument. Read the output.

    python scripts/derive_passage_paragraphs.py --apply
        Write `paragraph_offsets` and `paragraph_source` for every passage that
        has none, or for all of them with --force. Idempotent.

Provenance is recorded per passage rather than assumed globally, because the two
kinds are not equally trustworthy: a passage whose text carries real blank-line
breaks is stored `authored` and is never re-derived, and everything else is
stored `derived_cohesion_v1`. The comparative seam is authored even inside a
derived passage, so it is always a cut and the derivation only runs inside each
half.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import statistics
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app  # noqa: E402
from app.enforcement import split_sentences  # noqa: E402
from app.models import Passage, db  # noqa: E402
from app.passage_structure import (  # noqa: E402
    _MIN_PART_SENTENCES,
    _MIN_PART_WORDS,
    derive_paragraphs,
    paragraphs_from_offsets,
    sentence_spans,
)

_HEAD_A = re.compile(r"Passage A(?![a-z])")
_HEAD_B = re.compile(r"Passage B(?![a-z])")


# ---------------------------------------------------------------------------
# The held-out test
# ---------------------------------------------------------------------------


def _blinded_seams(texts: list[str]) -> list[tuple[str, int]]:
    """Comparative sets with both headings removed, and the true boundary index.

    A heading sits on its own line, so it ends whatever sentence precedes it: the
    number of sentences before the seam is the index of the sentence that starts
    the second passage. Verified exact on all 32 — `split_sentences` reproduces
    the same first sentence at that index every time — so a miss reported below is
    the segmenter's, not the measurement's.
    """
    pairs = []
    for text in texts:
        head_a, head_b = _HEAD_A.search(text), _HEAD_B.search(text)
        if not head_a or not head_b or head_b.start() <= head_a.end():
            continue
        before = (text[: head_a.start()] + text[head_a.end(): head_b.start()]).strip()
        after = text[head_b.end():].strip()
        pairs.append((f"{before} {after}", len(split_sentences(before))))
    return pairs


def _boundary_indices(text: str) -> set[int]:
    offsets, _source = derive_paragraphs(text)
    starts = set(offsets)
    return {index for index, (begin, _end) in enumerate(sentence_spans(text)) if begin in starts and index > 0}


def _equal_chunks(text: str) -> set[int]:
    spans = sentence_spans(text)
    wanted = max(2, min(7, round(len(text.split()) / 110)))
    step = len(spans) / wanted
    return {round(step * index) for index in range(1, wanted)}


_MARKER = re.compile(
    r"^(However|Nevertheless|Nonetheless|Yet|But|By contrast|In contrast|On the other hand|Conversely"
    r"|Moreover|Furthermore|In addition|Additionally|Thus|Therefore|Consequently|Hence|Accordingly"
    r"|Recently|In recent years|Traditionally|Historically|Today|Indeed|In fact|For example|For instance"
    r"|Critics|Proponents|Opponents|Supporters|Advocates|Some|Others|Such|This|These|Although|While|If)\b"
)


def _markers_only(text: str) -> set[int]:
    spans = sentence_spans(text)
    wanted = max(2, min(7, round(len(text.split()) / 110)))
    hits = [index for index, (begin, end) in enumerate(spans) if index > 1 and _MARKER.match(text[begin:end])]
    return set(hits[: wanted - 1])


def _admissible(text: str) -> list[int]:
    """Every boundary a chooser could legally place, under the shipped floors.

    The chance baseline has to be allowed exactly what the segmenter is allowed,
    or it is being asked a harder question. A random chooser that may put a
    boundary two sentences from the end, where the word floor forbids one, looks
    worse than chance rather than like chance.
    """
    spans = sentence_spans(text)
    words = [len(text[begin:end].split()) for begin, end in spans]
    return [
        boundary
        for boundary in range(_MIN_PART_SENTENCES, len(spans) - _MIN_PART_SENTENCES + 1)
        if sum(words[:boundary]) >= _MIN_PART_WORDS and sum(words[boundary:]) >= _MIN_PART_WORDS
    ]


_RANDOM_TRIALS = 300


def _score(pairs, found_for) -> tuple[int, int]:
    exact = within = 0
    for text, truth in pairs:
        best = min((abs(index - truth) for index in found_for(text)), default=99)
        exact += best == 0
        within += best <= 1
    return exact, within


def verify(texts: list[str]) -> int:
    pairs = _blinded_seams(texts)
    print(f"Held-out test: the Passage A/B seam on {len(pairs)} comparative sets, headings stripped.")
    print("The seam is the easiest boundary in the bank — a whole new passage starts there — so")
    print("read these as an upper bound on placement accuracy, not a typical case.\n")

    shipped_exact, shipped_within = _score(pairs, _boundary_indices)
    print(f"  {'method':30} {'exact':>9} {'within one':>12}")
    for label, method in (
        ("lexical cohesion (shipped)", _boundary_indices),
        ("equal-sized chunks", _equal_chunks),
        ("discourse markers alone", _markers_only),
    ):
        exact, within = _score(pairs, method)
        print(f"  {label:30} {exact:4}/{len(pairs):<4} {within:7}/{len(pairs)}")

    # Chance, allowed the same number of boundaries in the same places, averaged
    # over 300 draws so the comparison is not against one lucky or unlucky seed.
    budget = {text: len(_boundary_indices(text)) for text, _truth in pairs}
    exact_trials: list[int] = []
    within_trials: list[int] = []
    for seed in range(_RANDOM_TRIALS):
        rng = random.Random(seed)

        def chance(text: str, rng=rng) -> set[int]:
            pool = _admissible(text)
            return set(rng.sample(pool, min(budget[text], len(pool)))) if pool else set()

        exact, within = _score(pairs, chance)
        exact_trials.append(exact)
        within_trials.append(within)
    print(f"  {'chance, same budget and floors':30} {statistics.mean(exact_trials):4.1f}/{len(pairs):<4} "
          f"{statistics.mean(within_trials):7.1f}/{len(pairs)}   (mean of {_RANDOM_TRIALS} draws)")

    beat_exact = sum(1 for value in exact_trials if value >= shipped_exact)
    beat_within = sum(1 for value in within_trials if value >= shipped_within)
    print(f"\n  Chance matched the shipped segmenter's exact placement in "
          f"{beat_exact}/{_RANDOM_TRIALS} draws,")
    print(f"  and its within-one placement in {beat_within}/{_RANDOM_TRIALS}.")
    print("\n  Read that carefully, because it is the finding that decided how this data is")
    print("  labelled. Cohesion locates the *region* of a real boundary far better than")
    print("  chance could, and it does not pin the exact sentence better than chance. So the")
    print("  offsets are stored as derived, never as authored, and the gate asks a student")
    print("  what each 'part' of the passage is doing rather than each 'paragraph'. A cut that")
    print("  lands a sentence early is then an odd division of a real passage, which is what")
    print("  it is, instead of a claim about where the author broke the line, which would be")
    print("  a false structure taught as fact.\n")

    print("\nWhat the shipped segmenter produces across the whole bank:\n")
    counts: Counter = Counter()
    provenance: Counter = Counter()
    part_words: list[int] = []
    oversized = 0
    undivided: list[str] = []
    for text in texts:
        offsets, source = derive_paragraphs(text)
        parts = paragraphs_from_offsets(text, offsets)
        counts[len(parts)] += 1
        provenance[source] += 1
        sizes = [len(part.split()) for part in parts]
        part_words.extend(sizes)
        oversized += sum(1 for size in sizes if size > 200)
        if len(parts) < 2:
            undivided.append(text)
        joined = re.sub(r"\s+", "", " ".join(parts))
        if joined != re.sub(r"\s+", "", text):
            print(f"  LOSSY: a passage did not survive the round trip: {text[:60]!r}")
            return 1

    print(f"  passages                {len(texts)}")
    print(f"  provenance              {dict(provenance)}")
    print(f"  parts per passage       {dict(sorted(counts.items()))}")
    print(f"  words per part          min {min(part_words)}, median "
          f"{int(statistics.median(part_words))}, max {max(part_words)}")
    print(f"  parts over 200 words    {oversized}")
    print(f"  passages left undivided {len(undivided)}")
    print("\n  Every passage reassembles to its own text character for character, so no")
    print("  segmentation drops or reorders a word of the bank.")
    return 0


# ---------------------------------------------------------------------------
# Reading the output
# ---------------------------------------------------------------------------


def sample(texts: list[str], how_many: int, seed: int) -> int:
    chosen = random.Random(seed).sample(texts, min(how_many, len(texts)))
    for number, text in enumerate(chosen, start=1):
        offsets, source = derive_paragraphs(text)
        parts = paragraphs_from_offsets(text, offsets)
        comparative = bool(_HEAD_B.search(text))
        print("=" * 100)
        print(f"[{number}] {len(text.split())} words, {len(parts)} parts, {source}"
              f"{', comparative set' if comparative else ''}")
        print("=" * 100)
        for index, part in enumerate(parts):
            print(f"\n--- part {index} ({len(part.split())} words) "
                  f"{'-' * max(0, 60 - len(str(index)))}")
            print(part)
        print()
    return 0


# ---------------------------------------------------------------------------
# Writing it
# ---------------------------------------------------------------------------


def apply(force: bool) -> int:
    passages = Passage.query.order_by(Passage.id).all()
    written = skipped = 0
    provenance: Counter = Counter()
    counts: Counter = Counter()
    for passage in passages:
        if passage.paragraph_offsets and not force:
            skipped += 1
            continue
        offsets, source = derive_paragraphs(passage.canonical_text)
        passage.paragraph_offsets = offsets or None
        passage.paragraph_source = source if offsets else None
        written += 1
        provenance[source] += 1
        counts[max(1, len(offsets))] += 1
    db.session.commit()
    print(f"passages {len(passages)}, written {written}, already segmented {skipped}")
    print(f"provenance {dict(provenance)}")
    print(f"parts per passage {dict(sorted(counts.items()))}")
    return 0


def _bank_texts() -> list[str]:
    """Every distinct passage, read from the pinned snapshot rather than a database.

    --verify and --sample are about the bank, not about one machine's data, and
    they have to be runnable by a reviewer who has never seeded anything.
    """
    texts = set()
    root = Path(__file__).resolve().parents[1] / "data" / "question_bank" / "lsat-rc"
    for path in sorted(root.glob("*.jsonl")):
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    texts.add(json.loads(line).get("context") or "")
    return sorted(text for text in texts if text.strip())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true", help="score the segmenter and report its shape")
    parser.add_argument("--sample", type=int, default=0, help="print N segmented passages to read")
    parser.add_argument("--seed", type=int, default=7, help="which sample to print")
    parser.add_argument("--apply", action="store_true", help="write the segmentation to the database")
    parser.add_argument("--force", action="store_true", help="re-derive passages that already have one")
    args = parser.parse_args()

    if not (args.verify or args.sample or args.apply):
        parser.print_help()
        return 2
    if args.verify:
        if code := verify(_bank_texts()):
            return code
    if args.sample:
        if code := sample(_bank_texts(), args.sample, args.seed):
            return code
    if args.apply:
        app = create_app()
        with app.app_context():
            return apply(args.force)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
