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

    python scripts/derive_passage_paragraphs.py --verify-markers DIR
        Score discourse-marker signals against ordinary authored paragraph
        breaks, which the seam test structurally cannot do. See `verify_markers`
        for what DIR must hold and how to produce it.

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
    _CANNOT_OPEN_A_PART,
    _CONTINUATION,
    _MAX_PART_WORDS,
    _MAX_PARTS,
    _MIN_PART_SENTENCES,
    _MIN_PART_WORDS,
    _WORD,
    _cut_within,
    _depth_scores,
    _topic_terms,
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
# The held-out test the seam cannot be
# ---------------------------------------------------------------------------
#
# The seam test above cannot score a discourse-marker signal, and its "0/32 for
# markers alone" is not evidence against one. A whole new passage starts at the
# seam, and its first sentence never opens with a connective: measured, a marker
# opens 0 of the 32 seam sentences against 22.6% of every other sentence in the
# same passages. A marker-driven chooser is therefore guaranteed to score zero
# there whatever markers are worth, so the question has to be asked somewhere
# else.
#
# Somewhere else is ordinary authored paragraph breaks in the kind of prose the
# bank is drawn from. `rcgen_harvest.py` already fetches exactly that, across
# the four subject areas real Reading Comprehension rotates through, and it
# keeps the authors' paragraph breaks as blank lines:
#
#     for d in law humanities social_science natural_science; do
#       python scripts/rcgen_harvest.py --domain $d --n 25 --out /tmp/rcpara/$d.jsonl
#     done
#     python scripts/derive_passage_paragraphs.py --verify-markers /tmp/rcpara
#
# The corpus is not committed. It is several megabytes of third-party prose
# under mixed licences, and OpenAlex returns a different sample each time, so
# re-running gives a set of the same shape rather than the same set. The figures
# recorded in `app/passage_structure.py` are from one run of 100 articles.

_MIN_PARA_WORDS, _MAX_PARA_WORDS = 40, 220
_MIN_PARAS, _MAX_PARAS = 3, 5
_MIN_ITEM_WORDS, _MAX_ITEM_WORDS = 250, 600

# The contrastive half of `_MARKER`, split on what the words mean — a turn
# against what came before, rather than more of it. Split in advance rather than
# by trying both halves against the set and keeping the better one.
_TURN = re.compile(
    r"^(However|Nevertheless|Nonetheless|Yet|But|By contrast|In contrast"
    r"|On the other hand|Conversely|Although|While)\b"
)


def _paragraph_runs(text: str) -> list[list[str]]:
    """Consecutive keepable paragraphs, broken wherever one is dropped.

    Runs rather than a filtered list, so that no boundary in the test set is an
    artefact of something removed from between its two sides.
    """
    runs: list[list[str]] = [[]]
    for part in text.split("\n\n"):
        part = re.sub(r"\s+", " ", part).strip()
        if part and _MIN_PARA_WORDS <= len(part.split()) <= _MAX_PARA_WORDS:
            runs[-1].append(part)
        else:
            runs.append([])
    return [run for run in runs if len(run) >= _MIN_PARAS]


def _as_item(paragraphs: list[str]) -> dict | None:
    """Flatten to one blob, and keep only if the authored breaks are recoverable.

    Flattened with a single space, which is the shape the bank's own passages
    arrived in. Dropped unless every authored break lands on a sentence boundary
    the shipped splitter finds *and* is admissible under the shipped floors —
    an unreachable truth would measure the floors rather than the method, the
    same discipline `_blinded_seams` applies to the seam.
    """
    text = " ".join(paragraphs)
    spans = sentence_spans(text)
    starts = {begin: index for index, (begin, _end) in enumerate(spans)}
    truth = []
    offset = 0
    for part in paragraphs[:-1]:
        offset += len(part) + 1
        if offset not in starts:
            return None
        truth.append(starts[offset])
    allowed = set(_admissible(text))
    if not truth or not all(boundary in allowed for boundary in truth):
        return None
    return {"text": text, "truth": truth, "paragraphs": len(paragraphs)}


def _held_out_items(root: Path) -> list[dict]:
    items: list[dict] = []
    for path in sorted(root.glob("*.jsonl")):
        for line in path.open(encoding="utf-8"):
            body = json.loads(line).get("text") or ""
            for run in _paragraph_runs(body):
                start = 0
                while start + _MIN_PARAS <= len(run):
                    taken = None
                    for size in range(_MAX_PARAS, _MIN_PARAS - 1, -1):
                        window = run[start : start + size]
                        if len(window) == size and (
                            _MIN_ITEM_WORDS
                            <= sum(len(part.split()) for part in window)
                            <= _MAX_ITEM_WORDS
                        ):
                            taken = window
                            break
                    if taken is None:
                        start += 1
                        continue
                    if item := _as_item(taken):
                        items.append(item)
                    # Windows never overlap, so no one article can dominate the
                    # set with a stretch of near-duplicate passages.
                    start += len(taken)
    return items


def _rank(text: str, spans, index: int) -> int:
    """0 no marker, 1 an additive or framing marker, 2 a turn."""
    if not 0 < index < len(spans):
        return 0
    sentence = text[spans[index][0]: spans[index][1]]
    if _TURN.match(sentence):
        return 2
    return 1 if _MARKER.match(sentence) else 0


def _floors_admit(spans, words, chosen: list[int]) -> bool:
    edges = sorted([0, *chosen, len(spans)])
    parts = list(zip(edges, edges[1:]))
    if any(end - begin < _MIN_PART_SENTENCES for begin, end in parts):
        return False
    return all(sum(words[begin:end]) >= _MIN_PART_WORDS for begin, end in parts)


def _cohesion(text: str) -> set[int]:
    return set(_cut_within(text, sentence_spans(text)))


def _snap(text: str, window: int, stronger: bool) -> set[int]:
    """Move a chosen boundary onto a nearby marker. Never adds or drops one.

    Two variants, because the narrow one cannot address the misses that
    prompted this. A part that opens "Moreover, he maintains ..." when the turn
    is the next sentence, "But Weiner's opponents contend ...", has a marker on
    both sentences, so a snap that skips boundaries already sitting on a marker
    leaves it exactly where it was. `stronger` lets a turn displace an additive.
    """
    spans = sentence_spans(text)
    words = [len(_WORD.findall(text[begin:end].lower())) for begin, end in spans]
    settled = list(_cut_within(text, spans))
    for position, boundary in enumerate(settled):
        here = _rank(text, spans, boundary)
        if here == 2 or (not stronger and here):
            continue
        best = None
        for distance in range(1, window + 1):
            for candidate in (boundary - distance, boundary + distance):
                rank = _rank(text, spans, candidate)
                if rank <= (here if stronger else 0):
                    continue
                trial = [*settled[:position], candidate, *settled[position + 1:]]
                if len(set(trial)) != len(trial) or not _floors_admit(spans, words, sorted(trial)):
                    continue
                if best is None or rank > _rank(text, spans, best):
                    best = candidate
            if best is not None:
                break
        if best is not None:
            settled[position] = best
    return set(settled)


def _bonus(text: str, weight: float, turn_only: bool = False) -> set[int]:
    """`_cut_within` with a marker bonus added to each gap's depth score.

    This is the "bonus on top of the cohesion score" the module reports as tried
    and rejected. It was rejected on the seam, which cannot see it. The bonus is
    in units of the passage's own depth spread so it means the same thing in a
    lexically varied passage and a uniform one.
    """
    spans = sentence_spans(text)
    if len(spans) < 2 * _MIN_PART_SENTENCES:
        return set()
    words = [len(_WORD.findall(text[begin:end].lower())) for begin, end in spans]
    scores = _depth_scores([_topic_terms(text[begin:end]) for begin, end in spans])
    if not scores:
        return set()
    mean = sum(scores) / len(scores)
    spread = (sum((score - mean) ** 2 for score in scores) / len(scores)) ** 0.5
    pattern = _TURN if turn_only else _MARKER
    boosted = [
        value + (weight * spread if pattern.match(text[spans[gap + 1][0]: spans[gap + 1][1]]) else 0.0)
        for gap, value in enumerate(scores)
    ]

    def admits(chosen: list[int], boundary: int) -> bool:
        sentence = text[spans[boundary][0]: spans[boundary][1]]
        if _CONTINUATION.match(sentence) or _CANNOT_OPEN_A_PART.match(sentence):
            return False
        return _floors_admit(spans, words, sorted([*chosen, boundary]))

    chosen: list[int] = []
    for _value, boundary in sorted(
        ((value, gap + 1) for gap, value in enumerate(boosted) if value >= mean), reverse=True
    ):
        if len(chosen) >= _MAX_PARTS - 1:
            break
        if admits(chosen, boundary):
            chosen.append(boundary)
    while len(chosen) < _MAX_PARTS - 1:
        edges = sorted([0, *chosen, len(spans)])
        oversized = [
            (sum(words[begin:end]), begin, end)
            for begin, end in zip(edges, edges[1:])
            if sum(words[begin:end]) > _MAX_PART_WORDS
        ]
        if not oversized:
            break
        _size, begin, end = max(oversized)
        interior = [
            (boosted[gap], gap + 1)
            for gap in range(begin, min(end - 1, len(boosted)))
            if admits(chosen, gap + 1)
        ]
        if not interior:
            break
        chosen.append(max(interior)[1])
    return set(chosen)


def _score_many(items, found_for) -> tuple[int, int, float]:
    """Recall at zero and at one sentence, plus precision.

    Recall is the seam test's measure, extended to the several boundaries an
    ordinary passage has. Precision is reported beside it because a method that
    proposed a boundary everywhere would score perfectly on recall alone.
    """
    exact = within = hits = proposals = 0
    for item in items:
        found = sorted(found_for(item["text"]))
        for boundary in item["truth"]:
            best = min((abs(boundary - index) for index in found), default=99)
            exact += best == 0
            within += best <= 1
        hits += sum(1 for index in found if index in item["truth"])
        proposals += len(found)
    return exact, within, hits / max(1, proposals)


def _marker_rate(items) -> tuple[int, int, int, int]:
    at = truths = elsewhere = others = 0
    for item in items:
        spans = sentence_spans(item["text"])
        for index in range(1, len(spans)):
            if index in item["truth"]:
                at += _rank(item["text"], spans, index) > 0
                truths += 1
            else:
                elsewhere += _rank(item["text"], spans, index) > 0
                others += 1
    return at, truths, elsewhere, others


def verify_markers(root: Path) -> int:
    """Score marker signals where a marker signal can actually be seen."""
    items = _held_out_items(root)
    if not items:
        print(f"no held-out passages could be built from {root}", file=sys.stderr)
        return 1
    truths = sum(len(item["truth"]) for item in items)
    words = [len(item["text"].split()) for item in items]
    print(f"Held-out test: authored paragraph breaks in harvested expository prose, from {root}.")
    print(f"{len(items)} passages, {truths} authored boundaries, "
          f"{int(statistics.median(words))} median words, "
          f"{statistics.mean(item['paragraphs'] for item in items):.1f} paragraphs each.")
    print("The breaks are the original authors'. Nothing here chooses where one goes, and no")
    print("selection rule mentions markers; that is what makes the set fair to the question.\n")

    at, at_total, elsewhere, elsewhere_total = _marker_rate(items)
    print(f"  a discourse marker opens {at}/{at_total} ({at / at_total:.1%}) of authored "
          f"boundaries,")
    print(f"  and {elsewhere}/{elsewhere_total} ({elsewhere / elsewhere_total:.1%}) of every "
          f"other sentence.\n")

    head = f"  {'method':36} {'exact':>12} {'within one':>12} {'precision':>10}"
    print(head)
    for label, method in (
        ("lexical cohesion (shipped)", _cohesion),
        ("  + snap to a marker, +/-1", lambda text: _snap(text, 1, False)),
        ("  + snap to a stronger marker, +/-1", lambda text: _snap(text, 1, True)),
        ("  + snap to a stronger marker, +/-2", lambda text: _snap(text, 2, True)),
        ("  + marker bonus 0.5 sd", lambda text: _bonus(text, 0.5)),
        ("  + marker bonus 1.0 sd", lambda text: _bonus(text, 1.0)),
        ("  + turn-marker bonus 0.5 sd", lambda text: _bonus(text, 0.5, True)),
        ("  + turn-marker bonus 1.0 sd", lambda text: _bonus(text, 1.0, True)),
        ("discourse markers alone", _markers_only),
        ("equal-sized chunks", _equal_chunks),
    ):
        exact, within, precision = _score_many(items, method)
        print(f"  {label:36} {exact:5}/{truths:<6} {within:5}/{truths:<6} {precision:>9.1%}")

    budget = {item["text"]: len(_cohesion(item["text"])) for item in items}
    exacts, withins = [], []
    for seed in range(_RANDOM_TRIALS):
        rng = random.Random(seed)

        def pick(text: str, rng=rng) -> set[int]:
            pool = _admissible(text)
            return set(rng.sample(pool, min(budget[text], len(pool)))) if pool else set()

        exact, within, _precision = _score_many(items, pick)
        exacts.append(exact)
        withins.append(within)
    print(f"  {'chance, same budget and floors':36} {statistics.mean(exacts):5.1f}/{truths:<6} "
          f"{statistics.mean(withins):5.1f}/{truths:<6}"
          f"            (mean of {_RANDOM_TRIALS})")

    shipped_exact, shipped_within, _precision = _score_many(items, _cohesion)
    print(f"\n  Chance matched the shipped segmenter's exact placement in "
          f"{sum(1 for value in exacts if value >= shipped_exact)}/{_RANDOM_TRIALS} draws, and its")
    print(f"  within-one placement in {sum(1 for value in withins if value >= shipped_within)}"
          f"/{_RANDOM_TRIALS}.")
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
    parser.add_argument(
        "--verify-markers",
        metavar="DIR",
        help="score marker signals against authored paragraph breaks harvested into DIR",
    )
    parser.add_argument("--sample", type=int, default=0, help="print N segmented passages to read")
    parser.add_argument("--seed", type=int, default=7, help="which sample to print")
    parser.add_argument("--apply", action="store_true", help="write the segmentation to the database")
    parser.add_argument("--force", action="store_true", help="re-derive passages that already have one")
    args = parser.parse_args()

    if not (args.verify or args.verify_markers or args.sample or args.apply):
        parser.print_help()
        return 2
    if args.verify:
        if code := verify(_bank_texts()):
            return code
    if args.verify_markers:
        if code := verify_markers(Path(args.verify_markers)):
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
