"""Where one part of a Reading Comprehension passage ends and the next begins.

Every one of the 349 passages in this bank arrived as a single unbroken blob.
Not one contains a newline, a tab, a doubled space, a line separator or a
non-breaking space: the two pinned Hugging Face snapshots store `context` as one
run of prose, so the paragraph breaks were lost upstream of this application and
there is nothing here to parse them out of.

That mattered because two of the six Reading Comprehension approaches are built
on paragraph structure. `enforcement.split_paragraphs` found no break, returned
the whole passage as one unit, and "give each paragraph its job in three to
twelve words" became one note covering three thousand characters — while
`paragraph_function`'s variety check, which needs more than one segment to have
anything to compare, was skipped on every question in the section. The technique
was not merely described badly; it was defeated.

## What this module claims, and what it does not

It finds **topical** boundaries, and it says so. It does not claim to recover the
author's paragraphs, because the evidence does not support that claim and the
cost of the stronger claim is a false structure taught to a student as if it were
the author's.

The method is TextTiling (Hearst, *Computational Linguistics* 23:1, 1997,
https://aclanthology.org/J97-1003/): score every inter-sentence gap by how much
the vocabulary on one side differs from the vocabulary on the other, and cut
where that difference is locally deepest. It is unsupervised, which is the only
kind of method available here — there is no corpus of correctly-broken LSAT
passages to train on, and the same absence is why `scheduling.py` rejected
half-life regression and DASH.

## How well it works, measured rather than assumed

The 32 comparative sets in this bank print two passages under "Passage A" and
"Passage B" headings, so they carry one boundary that is genuinely authored and
genuinely known. Stripping both headings and asking the segmenter to find the
seam blind is a held-out test, and the seam is the *easiest* boundary in the
bank — a whole new passage starts there — so this is an upper bound on accuracy
rather than a typical case. `scripts/derive_passage_paragraphs.py --verify`
re-runs all of it:

| method                          | exact  | within one sentence |
|---------------------------------|-------:|--------------------:|
| lexical cohesion (this module)  |  11/32 | 26/32               |
| equal-sized chunks              |   7/32 | 17/32               |
| discourse markers alone         |   0/32 |  7/32               |
| chance, same budget and floors  | 7.9/32 | 18.9/32             |

Chance is a chooser allowed exactly what this module is allowed: the same number
of boundaries, in the same places the floors permit, averaged over 300 draws. Any
weaker baseline flatters the result.

**The markers row of that table is not evidence about markers**, and it used to be
read here as though it were. The seam is where a whole new passage starts, and a
new passage does not open with a connective: a marker opens 0 of the 32 seam
sentences against 22.6% of every other sentence in the same passages. A
marker-driven chooser is guaranteed to score 0/32 there however good markers are,
so that row measures the seam and not the signal. The question needs a test that
can see it, which is the second table below.

## The second held-out test: ordinary paragraph breaks

Authored paragraph breaks in expository prose of the kind this bank is drawn
from, harvested by `rcgen_harvest.py` across the four subject areas real Reading
Comprehension rotates through, flattened to one blob the way the bank's own
passages arrived, and kept only where every authored break lands on a sentence
the splitter finds and the floors permit. The breaks are the original authors';
nothing in the construction chooses a boundary or mentions a marker. Re-run it
with `scripts/derive_passage_paragraphs.py --verify-markers`, which documents the
harvest. One run, 747 passages and 2,305 authored boundaries:

| method                          |   exact | within one | precision |
|---------------------------------|--------:|-----------:|----------:|
| lexical cohesion (this module)  |    749  |      1841  |     26.4% |
| + snap to a marker, ±1          |    627  |      1834  |     22.1% |
| + snap to a stronger marker, ±1 |    637  |      1831  |     22.4% |
| + marker bonus 0.5 sd           |    728  |      1865  |     25.3% |
| + marker bonus 1.0 sd           |    698  |      1901  |     23.0% |
| + turn-marker bonus 0.5 sd      |    743  |      1847  |     26.2% |
| + turn-marker bonus 1.0 sd      |    735  |      1850  |     25.5% |
| discourse markers alone         |    176  |       853  |      9.3% |
| equal-sized chunks              |    577  |      1680  |     23.2% |
| chance, same budget and floors  |  627.2  |    1432.3  |         — |

Four things follow, and all four shaped the design.

**It finds the region, and it finds the sentence better than a guess.** On the
seam, chance matched the exact figure in 44 draws of 300, which read as no
evidence that the exact sentence beat a guess. That was the small sample talking:
against 2,305 ordinary boundaries chance matched neither figure in 300 draws.
There is a real signal about the exact sentence. It is still a *weak* one — 749
of 2,305 is 32.5% — and the labelling below does not change, because 32.5% is
nowhere near recovering the author's paragraphs and the cost of claiming
otherwise is a false structure taught as fact.

**How this data is labelled.** The offsets are stored as `derived_cohesion_v1`
and never as authored, and the gate copy that used to say "paragraph" says
"part". A student is asked what each part of the passage is doing, which is the
operation the technique is for and is true of a topical segment, so a boundary
that lands a sentence early costs an odd division rather than a false claim about
where the author broke the line.

**Discourse markers are worse than nothing, and now for a reason that survives
inspection.** "However", "By contrast" and "Moreover" do open paragraphs — and
they open sentences *inside* paragraphs more than twice as often. Measured on the
set above, a marker opens 9.6% of authored boundaries and 23.4% of every other
sentence, so within a passage a marker is evidence *against* a boundary rather
than for one. Every way of using it was tried and every one lost: snapping a
chosen boundary onto a nearby marker, snapping only onto a stronger marker, and
adding a bonus to the depth score at four weights. Not one beat 749 exact. Two of
the bonus weights buy a better within-one figure, and they pay for it in exact
placement and in precision, which is the wrong trade for the one thing this has
to get right. There is no marker term here. The one place a marker gets a say is
`_CONTINUATION` below, which asks the opposite and much safer question — where a
boundary cannot be.

**Reading the output found what the numbers could not.** A sample printed and read
by hand turned up a division that had cut the case citation "Charrier v. Bell" in
two, leaving a part that opened "Bell, a United States appellate court ruled" —
not a debatable boundary but a broken one, and invisible to every aggregate above.
`_ABBREVIATION_TAIL` is the fix.

Reading it again is what prompted the marker test: several parts bury an explicit
turn one sentence inside themselves, opening "Moreover, he maintains ..." when the
turn is the next sentence, "But Weiner's opponents contend ...". Those readings
are correct about the individual cuts and wrong about the remedy, which is what
the table above is for. A part that opens "Then??, subjected to massive
ultraviolet radiation ..." is a third thing again: `Then??` is a corruption in the
upstream row, the only one of its kind in the bank, and no segmenter can be
blamed for it.

Where a boundary *is* authored it is used and not re-derived: the Passage A/B
seam is a hard cut on the comparative sets, and cohesion runs inside each half.
"""

from __future__ import annotations

import math
import re
from collections import Counter

# Provenance, because a derived boundary is not an authored one and a later
# reader must be able to tell which they are looking at without guessing from
# the shape of the data.
SOURCE_AUTHORED = "authored"
SOURCE_DERIVED = "derived_cohesion_v1"

# Sentence-final punctuation followed by the start of something capitalised.
# `enforcement.split_sentences` uses the first alternative; this is a separate
# offset-preserving splitter because writing character offsets means the original
# spacing has to survive, and that function normalises it away.
#
# The second alternative catches a sentence break whose space the flattening ate
# — "would be more damaging.Although no empirical research" — which happens 58
# times across 24 passages, the same corruption that left six comparative
# headings run into their own first sentence as "Passage BUntil recently". One
# passage is 406 words in what the first alternative alone reads as three
# sentences, which no amount of segmentation could divide sensibly.
#
# The lookbehind demands three lowercase letters before the stop and the
# lookahead a capital followed by a lowercase, which together decline
# "U.S.Government", "Dr.Smith" and "J.R.R.Tolkien" while admitting a word
# followed by the start of a real sentence.
#
# These positions are *not* treated as paragraph breaks, which was the tempting
# reading: if the flattening dropped a newline to nothing rather than to a space,
# an eaten space would mark where a paragraph began, and several of them do sit
# in front of exactly the words a paragraph opens with ("Although", "First",
# "Until recently, however"). It was tested twice and failed twice. The eaten
# positions sit at mean depth percentile 0.473 against 0.487 for every other gap
# in the same passages, so they are not where the topic turns; and of the six sets
# whose heading proves this row lost a newline to nothing, only one also contains
# an eaten space, against 20 of the 317 ordinary passages. Scattered lost spaces,
# not recoverable structure.
_SENTENCE_BREAK = re.compile(
    r"(?<=[.!?])\s+(?=[\"'(\[]?[A-Z0-9])"
    r"|(?<=[a-z]{3}[.!?])(?=[A-Z][a-z])"
)

# Abbreviations whose full stop ends a word rather than a sentence. Found by
# reading a sample of the derived divisions and finding one that had cut the case
# citation "Charrier v. Bell" in half, leaving a part that opened "Bell, a United
# States appellate court ruled ..." — not a debatable boundary, a broken one.
#
# There are 227 of these breaks across the bank, 70 in the passages and 157 in the
# stimuli, and this list covers the ones that are never anything else: a title, a
# citation, or an abbreviation whose internal stops give it away (`U.S.`, `B.C.`,
# `e.g.`, `P.M.`).
#
# Single capital initials are deliberately *not* here, though they are the largest
# remaining group. "Robert L. Herbert" wants joining and "Group A. Clearly, at
# least one type of memory" does not, and the two are the same shape — a
# capitalised word, a single capital, a stop, a capital. Suppressing them all would
# silently weld together real sentences in the Logical Reasoning stimuli, which
# label things "Group B" and "Country F" constantly. `_cut_within` refuses to open
# a part on one instead, which is the narrower fix for the thing that matters here:
# a part may not begin mid-name, and a joined pair of stimulus sentences is a cost
# this module has no business paying.
_ABBREVIATION_TAIL = re.compile(
    r"(?:"
    r"\b(?:Mr|Mrs|Ms|Dr|Prof|Rev|Hon|Sr|Jr|St|vs?|cf|al|ed|eds|No|Vol|Fig|ch|pp|ca)"
    r"|\.[A-Za-z]"
    r")\.$"
)

# A part may not open on something that cannot open a sentence: a lowercase word,
# or a single initial, which is the abbreviation class the shared splitter leaves
# alone on purpose.
_CANNOT_OPEN_A_PART = re.compile(r"^(?:[a-z]|[A-Z]\.(?:\s|$))")


def is_sentence_break(text: str, position: int) -> bool:
    """Whether the stop ending at `position` really ends a sentence."""
    return not _ABBREVIATION_TAIL.search(text[max(0, position - 12): position])


_AUTHORED_BREAK = re.compile(r"\n\s*\n|\r\n\s*\r\n")

# The comparative heading, matched exactly as `strategies.detect_comparative`
# matches it — including the six sets in this bank that stored the heading with
# its following space eaten ("Passage BUntil recently") — so the two agree on
# which passages are comparative and where the seam is.
_PASSAGE_B = re.compile(r"Passage B(?![a-z])")

# Words that carry no topic. Reasoning connectives are in here deliberately:
# "however" and "therefore" are distributed across a passage by its argument
# rather than by its subject, so counting them as topic vocabulary blurs exactly
# the contrast this is trying to measure.
_STOPWORDS = frozenset(
    """a about above after again against all also although am an and any are as at be because
    been before being below between both but by can cannot could did do does doing down during
    each even few for from further had has have having he hence her here hers herself him
    himself his how however i if in indeed into is it its itself may me might more most much
    must my myself neither nevertheless nonetheless nor not of off on once one only or other
    others our ours ourselves out over own rather same shall she should so some still such than
    that the their theirs them themselves then there therefore these they this those though
    three thus to too two under until up upon very was we were what when where whereas which
    while who whom whose why will with within would yet you your yours yourself
    """.split()
)

_WORD = re.compile(r"[a-z][a-z'-]+")

# How many sentences either side of a gap the comparison looks at. Hearst's own
# parameter, and the value was chosen on the seam test: 3 and 4 scored 12 and 11
# exact, 5 and 6 scored 7 and 9. Four is the plateau, not a peak.
_BLOCK = 4

# How deep a gap has to be to become a boundary, in standard deviations above the
# mean depth of that passage's own gaps. Zero, so a gap has to be deeper than
# typical for this passage rather than deeper than some absolute figure, which is
# the only threshold that transfers between a lexically varied passage and a
# uniform one.
#
# This is what decides how many parts a passage gets, and it replaced asking for
# one part per 110 words. The two scored the same on the seam, and the length rule
# gave exactly 4 parts to 346 of the 349 passages — a count read off a word total
# rather than found in a text. Letting the depth decide, with the ceiling below
# dividing what is still too long, gives 3 parts to 6 passages, 4 to 124, 5 to 185,
# 6 to 32 and 7 to 2. Run `--verify` for the current figures rather than trusting
# these.
_DEPTH_CUTOFF_SD = 0.0

# A part shorter than this is not a part. Without a floor the deepest gaps cluster
# and produce a one-sentence stub whose "job" is not a job.
_MIN_PART_WORDS = 45
_MIN_PART_SENTENCES = 2

# A part longer than this is not a part either, and this is the defect being
# fixed rather than a matter of taste: the whole point is that one note covering
# three thousand characters is not an index entry. Under the depth cutoff alone,
# 56 passages still kept a part over 250 words and 159 kept one over 200, because
# a passage whose gaps are all shallow gets no cut at all. So any part over the
# ceiling is cut again at its own deepest interior gap until it fits or until the
# floor refuses.
_MAX_PART_WORDS = 170

_MAX_PARTS = 7

# Openers that cannot begin a part, because each one announces that it is an
# instance or restatement of the sentence immediately before it. A paragraph does
# not open "For instance".
#
# This is the one place a discourse marker earns a say, and it is worth being
# clear about why, given that markers were measured useless above. Asking a
# marker where a boundary *is* failed: "However" and "Moreover" open paragraphs
# but open sentences inside them far more often, and a segmenter driven by them
# placed the seam exactly 0 times in 32. Asking this small set of markers where a
# boundary is *not* is a different and much safer question, because the answer
# does not depend on frequency — it is a property of what the phrase means.
#
# Reading the sampled output is what found this. The most obvious wrong cut was
# between a claim and its illustration: "The first way was for a member of the
# elite to engage a well-known artist." | "For instance, if one commissions a
# famous architect ...". The rule removes 34 such cuts across the bank and moves
# the seam score by nothing at all (11 exact and 26 within one, either way),
# which is what a constraint that only ever deletes known-bad boundaries should
# look like.
#
# The wider families were tried and declined. Forbidding the additive markers as
# well ("Moreover", "Thus", "Indeed") scored the same and would have blocked real
# boundaries, since LSAT paragraphs genuinely open that way. Forbidding pronoun
# and deictic openers scored one better on exact placement and two better on
# within-one, which is inside the noise of 32 examples, and would have blocked
# the common paragraph that opens by naming what came before it ("This view is
# mistaken ...").
_CONTINUATION = re.compile(r"^(?:For instance|For example|That is|In other words)\b", re.IGNORECASE)


def _stem(word: str) -> str:
    """Enough suffix stripping that "argues" and "argument" count as one topic.

    Deliberately crude. A real stemmer would be a dependency, and the thing being
    measured is whether two stretches of prose are about the same subject, which
    survives a stemmer that occasionally over-trims.
    """
    for suffix in ("ations", "ation", "ings", "ing", "ies", "ied", "es", "ed", "ly", "s"):
        if len(word) > len(suffix) + 3 and word.endswith(suffix):
            return word[: -len(suffix)]
    return word


def _topic_terms(text: str) -> Counter:
    return Counter(
        _stem(word)
        for word in _WORD.findall(text.lower())
        if len(word) > 2 and word not in _STOPWORDS
    )


def _cosine(left: Counter, right: Counter) -> float:
    shared = set(left) & set(right)
    if not shared:
        return 0.0
    dot = sum(left[term] * right[term] for term in shared)
    left_norm = math.sqrt(sum(value * value for value in left.values()))
    right_norm = math.sqrt(sum(value * value for value in right.values()))
    if not left_norm or not right_norm:
        return 0.0
    return dot / (left_norm * right_norm)


def sentence_spans(text: str) -> list[tuple[int, int]]:
    """(start, end) of every sentence, as offsets into `text` itself.

    Offsets rather than strings because what gets stored is a list of positions
    in the canonical text, so a segmentation can be recomputed from the passage
    without keeping a second copy of its prose that could drift from the first.
    """
    if not text:
        return []
    spans: list[tuple[int, int]] = []
    start = 0
    for match in _SENTENCE_BREAK.finditer(text):
        if not is_sentence_break(text, match.start()):
            continue
        spans.append((start, match.start()))
        start = match.end()
    spans.append((start, len(text)))
    trimmed = []
    for begin, end in spans:
        while begin < end and text[begin].isspace():
            begin += 1
        while end > begin and text[end - 1].isspace():
            end -= 1
        if end > begin:
            trimmed.append((begin, end))
    # A stray fragment is not its own unit, matching `split_sentences`, so that a
    # student can only ever be shown a segment the sentence splitter also
    # believes in.
    merged: list[tuple[int, int]] = []
    for begin, end in trimmed:
        if merged and len(_WORD.findall(text[begin:end].lower())) < 3:
            merged[-1] = (merged[-1][0], end)
        else:
            merged.append((begin, end))
    return merged


def _depth_scores(blocks: list[Counter]) -> list[float]:
    """Hearst's depth score at each gap: how far the valley falls below its peaks.

    A low similarity is not on its own a boundary — some passages are lexically
    varied throughout. What marks a boundary is a *local* minimum, so the score
    is the drop from the nearest rise on the left plus the drop from the nearest
    rise on the right.
    """
    gaps = len(blocks) - 1
    if gaps < 1:
        return []
    similarity = []
    for gap in range(gaps):
        left = Counter()
        for index in range(max(0, gap + 1 - _BLOCK), gap + 1):
            left.update(blocks[index])
        right = Counter()
        for index in range(gap + 1, min(len(blocks), gap + 1 + _BLOCK)):
            right.update(blocks[index])
        similarity.append(_cosine(left, right))
    smoothed = [
        sum(similarity[max(0, i - 1): i + 2]) / len(similarity[max(0, i - 1): i + 2])
        for i in range(len(similarity))
    ]
    scores = []
    for index, value in enumerate(smoothed):
        left = value
        walk = index
        while walk > 0 and smoothed[walk - 1] >= smoothed[walk]:
            walk -= 1
            left = smoothed[walk]
        right = value
        walk = index
        while walk < len(smoothed) - 1 and smoothed[walk + 1] >= smoothed[walk]:
            walk += 1
            right = smoothed[walk]
        scores.append((left - value) + (right - value))
    return scores


def _cut_within(text: str, spans: list[tuple[int, int]]) -> list[int]:
    """Sentence indices, relative to `spans`, that should start a new part.

    Two passes, because they answer different questions. The first asks where the
    topic turns, and accepts every gap deeper than this passage's own average. The
    second asks whether any part is still too long to have a single job, and cuts
    the longest such part at its best interior gap until none is.
    """
    if len(spans) < 2 * _MIN_PART_SENTENCES:
        return []
    words = [len(_WORD.findall(text[begin:end].lower())) for begin, end in spans]
    scores = _depth_scores([_topic_terms(text[begin:end]) for begin, end in spans])
    if not scores:
        return []

    def admits(chosen: list[int], boundary: int) -> bool:
        begin, end = spans[boundary]
        if _CONTINUATION.match(text[begin:end]) or _CANNOT_OPEN_A_PART.match(text[begin:end]):
            return False
        edges = sorted([0, *chosen, boundary, len(spans)])
        parts = list(zip(edges, edges[1:]))
        if any(end - begin < _MIN_PART_SENTENCES for begin, end in parts):
            return False
        return all(sum(words[begin:end]) >= _MIN_PART_WORDS for begin, end in parts)

    mean = sum(scores) / len(scores)
    spread = (sum((score - mean) ** 2 for score in scores) / len(scores)) ** 0.5
    threshold = mean + _DEPTH_CUTOFF_SD * spread
    chosen: list[int] = []
    for _score, boundary in sorted(
        ((score, gap + 1) for gap, score in enumerate(scores) if score >= threshold), reverse=True
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
            (scores[gap], gap + 1)
            for gap in range(begin, min(end - 1, len(scores)))
            if admits(chosen, gap + 1)
        ]
        if not interior:
            # This part cannot be divided without leaving a stub behind, so it
            # stays long. One honestly oversized part beats a one-sentence entry
            # pretending to be a section of the passage.
            break
        chosen.append(max(interior)[1])
    return sorted(chosen)


def derive_paragraphs(canonical_text: str | None) -> tuple[list[int], str]:
    """Character offsets where each part of the passage begins, and their provenance.

    The first offset is always 0. An authored break is believed and never
    re-derived; the comparative seam is honoured as a hard cut with the
    derivation run inside each half; everything else is topical.

    Returns `([], SOURCE_DERIVED)` for a passage too short to divide, which the
    reader treats the same way it treats a passage with no stored segmentation:
    one part, exactly as before this module existed.
    """
    text = canonical_text or ""
    if not text.strip():
        return [], SOURCE_DERIVED

    authored = [0]
    for match in _AUTHORED_BREAK.finditer(text):
        authored.append(match.end())
    if len(authored) > 1:
        return authored, SOURCE_AUTHORED

    # Hard spans: the comparative seam if there is one, otherwise the whole text.
    hard = [0]
    seam = _PASSAGE_B.search(text)
    if seam:
        hard.append(seam.start())
    hard.append(len(text))

    offsets: list[int] = []
    for span_start, span_end in zip(hard, hard[1:]):
        chunk = text[span_start:span_end]
        spans = sentence_spans(chunk)
        if not spans:
            continue
        offsets.append(span_start + spans[0][0])
        for boundary in _cut_within(chunk, spans):
            offsets.append(span_start + spans[boundary][0])
    if not offsets:
        return [], SOURCE_DERIVED
    offsets[0] = 0
    return offsets, SOURCE_DERIVED


def offsets_are_usable(offsets, text: str | None) -> bool:
    """Whether a stored segmentation still describes the text beside it.

    Canonical text is written once at ingest from a pinned snapshot and is not
    edited, so this should always pass. It is checked anyway because the failure
    it guards against — offsets from one passage read against another's prose —
    would show up as a student being asked to name the job of a stretch that
    starts mid-word, and the graceful answer to that is one undivided part.
    """
    if not isinstance(offsets, list) or len(offsets) < 2 or not text:
        return False
    if offsets[0] != 0:
        return False
    if any(not isinstance(offset, int) or isinstance(offset, bool) for offset in offsets):
        return False
    if any(later <= earlier for earlier, later in zip(offsets, offsets[1:])):
        return False
    if offsets[-1] >= len(text):
        return False
    return all(text[offset:next_offset].strip() for offset, next_offset in zip(offsets, [*offsets[1:], len(text)]))


def paragraphs_from_offsets(text: str | None, offsets) -> list[str]:
    """The parts a stored segmentation describes, or one part if it does not."""
    body = text or ""
    if not offsets_are_usable(offsets, body):
        stripped = body.strip()
        return [stripped] if stripped else []
    edges = [*offsets, len(body)]
    return [body[begin:end].strip() for begin, end in zip(edges, edges[1:])]
