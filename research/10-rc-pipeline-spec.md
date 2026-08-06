# Reading Comprehension item generation — an empirically tested pipeline specification

**Status.** Feasibility test, executed. Every number below the "measured" heading in each
section came out of a run performed while writing this document; everything else is labelled
as assumption or as inherited from prior memos.

**What this closes.** `04-item-generation.md` established that LLM-written *Logical Reasoning*
fails badly — 19 of 24 items were solved by four independent models with the stimulus deleted,
a blind-solve rate near 0.90. It recommended Reading Comprehension instead, on the theory that
a passage that actually has to be read cannot be bypassed, but it never tested that theory.
This document tests it.

**Acceptance thresholds** are taken from `07-corpus-reference-distribution.md`, measured over
2,366 real LSAT RC items:

| Target | Value |
|---|---|
| Passage length | 435–490 words (p5–p95), median 457 |
| Flesch–Kincaid grade | 15–19 |
| Words per sentence | 24–33 |
| Items per passage | median 7 |
| `pick_longest_accuracy` | ≤ 0.25 (real RC: 0.1796) |
| Length Cohen's *d* | \|d\| ≤ 0.20 (real RC: 0.026) |
| Isolated extreme quantifier → correct | 0.10–0.22 (real RC: 0.1631) |
| Answer key per position | 0.18–0.22, χ² < 9.49 (real RC: 5.21) |

Note the sign on the quantifier row: in real LSAT items an isolated absolute marks a **wrong**
answer. A generator must attach absolutes predominantly to distractors, not merely avoid them.

## Tooling

| Script | Role | Status |
|---|---|---|
| `backend/scripts/rcgen_harvest.py` | Source harvest (OpenAlex CC-BY, CRS) | Pre-existing, verified |
| `backend/scripts/corpus_stats.py` | Statistical fingerprint / acceptance scoring | Pre-existing, verified |
| `backend/scripts/rcgen_llm.py` | Shared TrueFoundry client with spend ledger | New |
| `backend/scripts/rcgen_caselaw.py` | Caselaw Access Project harvest | New — replaces the broken `courtlistener` adapter |
| `backend/scripts/rcgen_corpus_audit.py` | Licence + LSAT topical-fit audit | New |
| `backend/scripts/rcgen_condense.py` | Article → 435–490 word passage, with length repair | New |
| `backend/scripts/rcgen_items.py` | Question generation | New |
| `backend/scripts/rcgen_eval.py` | Blind-solve and full-passage solver battery | New |

All generated material lives in `/tmp/rcgen/`. Nothing was written to the database and no
application code was modified. Total spend for the study: **$4.91** over 2,011 model calls.

## Headline findings

1. **Passage condensation is solved.** 14/14 passages landed inside 435–490 words at FK 15–19
   and 24–33 words per sentence, with zero register tells. The prompt had to be found
   empirically: stating a word count fails, a *sentence budget* works, and naming the
   readability target actively makes it worse.
2. **The blind-solvability question needed a control that had never been run, and it changes
   the target.** Real LSAT RC items are **61.9%** blind-solvable by four independent frontier
   models with the passage deleted — far above the 0.20 that surface statistics imply. Near-chance
   was never the right bar.
3. **The obvious way to generate RC fails exactly as LR did.** First-attempt items scored
   **91.3%** blind — indistinguishable from LR's 0.90, and 29 points worse than real items.
   `04`'s hypothesis that RC is intrinsically safe because the passage must be read is **not
   supported**.
4. **It is fixable, and the fix is construction order, not model capability.** Requiring five
   equally plausible mutually exclusive claims *before* deciding which the passage supports
   dropped blind accuracy to **56.6%**, below real LSAT's 61.9% (z = 4.58 vs the first attempt;
   z = −0.51 vs real, i.e. indistinguishable). Passage lift rose from 0.087 to 0.397 against
   real LSAT's 0.334. **This rests on 34 items and needs confirmation.**
5. **Every distributional target the model was asked to satisfy in prose, it ignored; every one
   enforced structurally or by measure-then-repair, it met.** Answer key χ² = 0.061 by never
   showing the model a position; length bias 0.4286 → 0.1020 by a repair pass.
6. **Corpora: law is abundant and clean, everything else is thin.** Caselaw Access Project rated
   8/8 usable and is public domain; CC-BY natural science rated 1/8. The `courtlistener` adapter
   is structurally broken and is replaced.
7. **Compute is irrelevant at $0.034/item (~$12 for 350). Human review at ~4 min/item is the
   only real cost.** 350 items does **not** fit 1.5 weeks with one reviewer; it fits tightly
   with two, and 200 items fits comfortably with one.

<!-- SECTION-MARKER -->

---

# 1. Corpora — what survives licence and topical scrutiny

**Method.** Eight articles harvested from each of the six channels (48 total), then every
article rated by the model against the four LSAT subject areas on a 0–3 usability scale
(`rcgen_corpus_audit.py`). "Usable" means fit ≥ 2; "strong" means fit = 3. The rating prompt
explicitly excludes methodology papers, clinical reports, tool descriptions and data releases,
because those are well licensed and still useless.

## Measured

| Channel | Licence | n | Mean fit | Usable ≥2 | Strong =3 | LSAT domain actually assigned |
|---|---|---|---|---|---|---|
| **Caselaw Access Project** | public domain | 8 | **3.00** | **1.00** | **1.00** | law 8 |
| **OpenAlex `law`** | CC-BY | 8 | **2.62** | 0.88 | 0.75 | law 5, social science 2, humanities 1 |
| **CRS** | public domain | 8 | 1.75 | 0.62 | 0.25 | law 8 |
| OpenAlex `humanities` | CC-BY | 8 | 1.38 | 0.50 | 0.38 | **natural science 4**, social science 2, humanities 2 |
| OpenAlex `social_science` | CC-BY | 8 | 0.75 | 0.38 | **0.00** | social science 7, none 1 |
| OpenAlex `natural_science` | CC-BY | 8 | **0.62** | 0.12 | 0.12 | natural science 8 |

Licence terms were clean in every case and are not the constraint. All 24 OpenAlex records
came back `cc-by` as filtered, with CC BY-SA correctly excluded; CAP and CRS are public domain.
**Topical fit is the constraint, and it fails badly outside law.**

### Two corpora are strong, and both are law

**Caselaw Access Project (new, `rcgen_caselaw.py`).** 8/8 rated strong — the only channel to
do so. Supreme Court opinions are argued prose with a self-contained dispute, competing
principles and a stated resolution, which is close to what an LSAT law passage already is.
Volume 572 alone indexes 2,187 cases and the archive covers 360+ reporters, so supply is
effectively unlimited. No API key, no rate limit, public domain.

**OpenAlex `law` (CC-BY).** 2.62 mean, 88% usable. Genuinely good material on environmental
law, rights of nature and metaverse liability. Note 3 of 8 were assigned to a domain other than
law, so the subfield filter leaks, but they leaked into *other LSAT domains* and stayed usable.

### The `courtlistener` adapter cannot work, and is replaced

`harvest_courtlistener` tests `word_count(op["snippet"]) >= 900`, but `snippet` is a search
highlight — measured at **65 words** on a live call. The condition is unsatisfiable, and the
function returns zero rows on every invocation, which matches the empty
`courtlistener.jsonl` it produced here. The authenticated full-text route returns **HTTP 401**
without a token and the public opinion pages return empty bodies to a scripted fetch. The route
is closed. `rcgen_caselaw.py` replaces it with CAP and returns strictly better material.

### Where supply is genuinely thin — and why it is partly self-inflicted

`natural_science` is the worst channel at 0.62. The failures are not marginal: *Gaia* Data
Release 3, *Planck* 2018 results, GWTC-1 and GWTC-2 gravitational-wave catalogs, and a
cryo-EM tool paper. These are instrument and data-release papers with no argumentative thread.

The diagnosis is that `openalex_candidates` sorts by `cited_by_count:desc`, and **the most-cited
papers in physics and astronomy are catalogs, not essays**. Ranking is selecting against the
property we need. Substituting a thesis-word search for the citation sort was tested directly:

| Query | Top results |
|---|---|
| `humanities`, `sort=cited_by_count` | *Tractatus Logico-Philosophicus*; "sterile womb" microbiology; empathy RCT |
| `humanities`, `search=debate interpretation` | "Truthlikeness: old and new debates"; "Styles of Thought on the Continental Drift Debate"; "Sophistry about symmetries?" |
| `natural_science`, `sort=cited_by_count` | GW150914; GW170817; Astropy |
| `natural_science`, `search=debate interpretation` | "Cosmic String Interpretation of NANOGrav Data"; "What is synergy? The Saariselkä agreement revisited" |

The search-ranked humanities results are, for the first time, actual humanities. This is a
one-line change to the harvester and it is the highest-value fix available in stage 1.

Honest supply figures from the same probe, for CC-BY English works since 2015 with full text:
**10,865** humanities and **4,179** natural science works match the thesis-word query, against
72,313 and 119,993 for the unranked filter. The narrower pools are the real ones, and they are
still one to two orders of magnitude larger than the ~50 passages needed.

`social_science` returns methodology rather than substance — saturation in qualitative
research, the COMET Handbook, a pandemic-policy database. **Zero of eight rated strong.** This
is the channel where CC-BY open-access supply is structurally worst aligned with LSAT, because
the LSAT tests anthropology, economic history and political theory while open social science
publishing is dominated by public health and research methods.

CRS at 1.75 is middling and the reason is consistent: CRS reports are deliberately
non-argumentative. "Data Centers and Water: Frequently Asked Questions" rated 1 — "lacks a
sustained interpretive or argumentative thread". CRS is a usable but second-tier source, best
mined for policy reports that present competing positions rather than FAQs.

## Recommendation

Weight the production harvest toward CAP and OpenAlex `law`, fix the OpenAlex ranking before
harvesting the other three domains, and expect to over-harvest by roughly **3× in humanities
and natural science and 5× in social science** to obtain enough fit-≥2 seeds. Do not attempt to
hit LSAT's subject rotation from CC-BY journals alone; for humanities specifically, public-domain
pre-1929 scholarly prose is the obvious untested supplement and is noted as an assumption below.

<!-- SECTION-MARKER -->

---

# 2. Condensation — the empirical core

**Method.** Five prompt variants, each run against an identical 9-source seed set (3 CAP
opinions, 6 CC-BY articles spanning law, biology and philosophy of science) so that differences
are attributable to the prompt and not to the material. Measured with the same Flesch–Kincaid
and sentence-splitting code `corpus_stats.py` uses, so the numbers are like-for-like against the
2,366-item baseline. Targets: 435–490 words, FK 15–19, 24–33 words per sentence.

## Measured — variant by variant

| Variant | In band 435–490 | FK 15–19 | WPS 24–33 | **All three** | Median words | Median FK | Median WPS |
|---|---|---|---|---|---|---|---|
| v1 naive ("condense to 435–490 words") | 0.333 | 0.889 | 0.111 | 0.000 | 492 | 16.28 | 19.8 |
| v2 explicit targets for all three | 0.778 | 0.444 | 0.667 | 0.111 | 478 | 19.14 | 25.6 |
| v3 + structure and register rules | 0.444 | 0.889 | 0.000 | 0.000 | 493 | 17.06 | 22.2 |
| v4 sentence budget | 0.444 | 0.000 | **1.000** | 0.000 | 430 | 20.30 | 26.9 |
| v4 + length repair | **1.000** | 0.222 | **1.000** | 0.222 | 443 | 20.43 | 25.6 |
| **v5 + repair** (final) | 0.778 | **1.000** | **1.000** | **0.778** | 442 | 16.75 | 27.6 |
| *real LSAT RC* | *1.000* | *—* | *—* | *—* | *457* | *16.8* | *28.3* |

**Production run, 14 passages, v5 + up to 3 repair rounds: 14/14 in band, 14/14 on FK, 14/14 on
words per sentence — 1.00 on all three.** Word range 437–456 against a real median of 457;
FK median 16.71 against 16.8; 27.81 words per sentence against 28.3.

## What actually moved the numbers

**Stating the word count does not work; stating a sentence budget does.** v1 through v3 all
name the 435–490 band explicitly and land at 0.33, 0.78 and 0.44. v3 was even told to "aim for
460" and returned 482–534. The model cannot count words. v4 replaced the word target with
"exactly 4 paragraphs, exactly 4 sentences each, every sentence 22–34 words" and words per
sentence went from 0.00 compliance to **1.00** in one step, because a sentence count is
something the model can actually hold. Length still needed the repair pass, but the repair only
has to close a small gap once the rhythm is right.

**Naming the readability target makes it worse.** v2 stated "Flesch–Kincaid grade 15–19" and
overshot to a median of 19.14. v3 said nothing about readability and landed at 17.06. Stating
the target appears to cue the model to inflate diction toward what it believes graduate-level
prose looks like.

**The FK miss was diction, not syntax — and this was the finding that unlocked the rest.**
FK has exactly two inputs, so decomposing it identified the culprit immediately. v4's syntax
was already correct (26.9 words per sentence against a real 28.2), but its diction was not:

| | Syllables/word | 4+ syllable word rate |
|---|---|---|
| v1 naive | 2.031 | 14.1% |
| v4 | 2.185 | 15.3% |
| **v5** | **1.80** | **6.0–7.0%** |
| **real LSAT RC (349 passages)** | **1.797** | **8.9%** |

Naive v1 was already at 14.1%, so **over-Latinate diction is a baseline property of LLM
academic prose**, not something the prompts introduced — though v4's instruction that
"nominalization is appropriate" made it worse and was exactly backwards. Real LSAT prose is
**long sentences built from ordinary words**. v5 replaced that instruction with an explicit
plain-diction rule ("prefer 'use' not 'utilization'... fewer than one word in ten should have
four or more syllables") and syllables per word fell from 2.185 to 1.80 against a real 1.797.
FK compliance went 0.00 → 1.00 with no change to the sentence budget.

**One defect was fixed in code rather than by prompting.** The sentence budget caused the model
to emit each sentence as its own block — a median of 16 paragraphs for 16 sentences. Paragraph
count is deterministic once the sentence budget holds, so `regroup_paragraphs()` reflows to 4
paragraphs, verified to preserve word and sentence counts exactly. The final set is 4–5
paragraphs throughout. This is worth noting as a method point: metrics that look good can hide
a formatting failure, and it was only caught by reading the passages.

## Does it read as LSAT register rather than as a summary?

Qualitatively, yes. The seven automated register tells (meta-reference to "this passage",
reader address, list markers, headings, citations, first person, summary framing) fire **zero
times across all 14 final passages**. Reading them confirms it: they open on a received view,
attribute positions to unnamed classes ("Proponents of this approach argue"), introduce a
complication with "Yet" or "Critics answer", and close on a qualification rather than a
resolution — "may matter less as a symbolic break from human-centered law than as a test of who
controls enforcement when ecological and political claims collide." That is a test-prose
cadence, not a summary cadence.

Two honest caveats. First, this is my judgement plus a regex battery, not a blind discrimination
test against real LSAT passages by an experienced reviewer, which is the test that would
actually settle it. Second, occasional small infelicities survive — one passage contains "may
therefore need not censor theology" — which is a proofreading load, not a register failure, but
it is real and it is why stage 5 of the pipeline is a human read.

## Cost

$0.028 per finished in-band passage including all repair rounds (`condense_v5` $0.393 +
`repair_v5` $0.096 over 23 passages). Condensation is not a meaningful cost driver.

<!-- SECTION-MARKER -->

---

# 3. Question generation and the blind-solvability test

**Method.** 98 items — 7 each on the 14 final passages, matching the real median of 7 per
passage. Three properties were controlled structurally rather than prompted, because an LLM
left to itself fails them: the model returns `correct` and `distractors` as separate fields and
never sees a position, so the answer key is assigned from a pre-balanced schedule; question
types are allocated from a schedule matching the real mix; negation stems are held at 4.7%.

## Measured — surface statistics (`corpus_stats.py`, n = 98)

| Metric | Generated | After length repair | Real RC | Target | |
|---|---|---|---|---|---|
| `pick_longest_accuracy` | 0.4286 | **0.1020** | 0.1796 | ≤ 0.25 | pass |
| Length Cohen's *d* | 0.4666 | **−0.1069** | 0.026 | \|d\| ≤ 0.20 | pass |
| Answer key χ² | 0.061 | **0.061** | 5.213 | < 9.49 | pass |
| Key proportions | 0.204/0.204/0.204/0.194/0.194 | same | — | 0.18–0.22 | pass |
| Extreme quantifier → correct | 0.0508 | **0.0714** | 0.1631 | 0.10–0.22 | below band |
| Negation stem rate | 0.051 | 0.051 | 0.0465 | ~0.047 | pass |
| Stem words (p50) | 17 | 17 | 18 | 18 | pass |
| Answer words (p50) | 14 | 14 | 15 | 15 | pass |
| Items per passage (p50) | 7 | 7 | 7 | 7 | pass |

**Prompting for length parity does not work; measuring and repairing does.** The generation
prompt explicitly told the model that the correct answer must not be the longest and cited the
real Cohen's *d* of 0.026. It produced 0.4666 anyway, with pick-longest at 0.4286 — more than
double chance and worse than real LR. A targeted repair pass over only the 63 failing items
(`rcgen_balance.py`) brought this to 0.1020 and −0.1069. This is the identical pattern to
condensation: a numeric distributional property stated in a prompt is ignored, and the same
property enforced by measure-then-repair is met.

**Answer key balance is exactly right, and that is purely structural.** χ² = 0.061 is far below
the 9.49 critical value and below real LSAT's own 5.213. This cost nothing beyond never showing
the model a position, and it forecloses the documented LLM tendency to pile correct answers into
position C.

**The quantifier polarity over-corrected.** Target was 0.10–0.22 with real RC at 0.1631;
generated came in at 0.0714. The direction is right — isolated absolutes mark wrong answers —
but the model attaches them to distractors *too* reliably, which is itself a learnable cue,
just an inverted one. With only 59–83 isolation events the estimate is noisy, but it should be
loosened in production by permitting an occasional hedged absolute in a correct answer.

## Measured — blind-solvability, and the control that makes it interpretable

The battery from `04-item-generation.md`: four **genuinely independent model families**
(`claude-haiku-4-5`, `gemini-2.5-flash`, `llama4-maverick`, `qwen3-32b`), each shown the stem
and five choices with the passage deleted, then the same items with the passage present.

Critically, the same battery was also run on **70 real LSAT RC items** sampled from the corpus.
`07-corpus-reference-distribution.md` listed this as an open limitation — "blind-solvability
itself is not computed here... that is worth doing while the corpus exists" — and without it the
generated number cannot be read.

| | Generated (n=98) | **Real LSAT RC (n=70)** | LR, memo 04 | Chance |
|---|---|---|---|---|
| **Mean blind accuracy** | **0.9133** | **0.6189** | ~0.90 | 0.20 |
| Mean full-passage accuracy | 1.0000 | 0.9532 | — | 0.20 |
| **Passage lift (full − blind)** | **0.0867** | **0.3342** | — | — |
| Solved blind by all 4 solvers | 0.8265 | 0.3571 | — | — |
| Solved blind by ≥3 solvers | 0.9082 | 0.5429 | — | — |
| Resisted all 4 solvers blind | 0.0204 | 0.1857 | — | — |

Per-model, the pattern is uniform and not an artefact of one solver:

| Solver | Generated blind | Real blind | Generated full | Real full |
|---|---|---|---|---|
| claude-haiku-4-5 | 0.9184 | 0.6286 | 1.000 | 0.9143 |
| gemini-2.5-flash | 0.9082 | 0.6571 | 1.000 | 1.0000 |
| llama4-maverick | 0.9184 | 0.6471 | 1.000 | 0.9841 |
| qwen3-32b | 0.9082 | 0.5429 | 1.000 | 0.9143 |

### Two findings, and the second is the one that matters

**First: real LSAT RC is far more blind-solvable than the surface statistics suggest.** At
0.6189 against 0.20 chance, current frontier models recover the credited answer from the
answer choices alone on nearly two-thirds of real items. Memo 07's lexical measures — pick-longest
at 0.1796, Cohen's *d* of 0.026 — say real items barely leak, and on *those* cues they do not.
Models are evidently exploiting something else: plausibility structure, register, and the fact
that four distractors must be wrong in conventional ways. **Blind-solve rate near chance was
never the right target, because real LSAT items do not achieve it either.** The honest target
is real LSAT's 0.62, or better, its passage lift of 0.33.

**Second: on that corrected target, generated RC still fails.** At 0.9133 blind, generated items
sit at LR's 0.90 and 29 points above real RC. Passage lift is 0.0867 against 0.3342 — **the
passage is doing roughly a quarter as much work as it does in a real item.** Only 2% of
generated items resisted all four solvers blind, against 18.6% of real ones. Full-passage
accuracy of exactly 1.000 on all four models is itself a warning: the items are not merely
leaky, they are easy, and a pool that every model answers perfectly will not discriminate among
human test takers at the top of the scale.

**The `04` hypothesis — that RC is safe because the passage must be read — is not supported as
tested.** Passage-length, readability, register, key balance and length bias were all solved.
The property that actually distinguishes a real item from a generated one survived all of it.

<!-- SECTION-MARKER -->

## The failure is fixable: construction order, not model capability

The v1 prompt told the model to make items passage-dependent and it did not comply. The
diagnosis is that v1 still builds an item the natural way — decide the correct answer, then
corrupt it four times — which leaves the credited choice as the only internally coherent
statement in the set. A solver does not need the passage to find it.

The v2 prompt (`--prompt v2`) inverts the construction order. It requires five mutually
exclusive claims, matched in shape, specificity, hedging and length, written **before** deciding
which one is correct; only then is the passage consulted to pick the supported one. It adds an
explicit adversarial self-check naming the four usual giveaways — the credited answer being the
most reasonable statement, distractors being obviously overstrong, distractors contradicting
common knowledge, and the credited answer being the only one responsive to the stem — and it
licenses distractors that are wrong merely because the passage does not address them, which is
the one failure mode invisible without the passage.

**Measured, 34 items, identical four-model battery:**

| | v1 generated (98) | **v2 generated (34)** | Real LSAT RC (70) |
|---|---|---|---|
| Mean blind accuracy | 0.9133 | **0.5662** | 0.6189 |
| 95% CI | (0.858, 0.969) | (0.400, 0.733) | (0.505, 0.733) |
| **Passage lift** | 0.0867 | **0.3971** | 0.3342 |
| Solved blind by all 4 | 0.8265 | **0.3529** | 0.3571 |
| Resisted all 4 blind | 0.0204 | **0.2059** | 0.1857 |
| Mean full accuracy | 1.0000 | 0.9633 | 0.9532 |

v2 versus v1 is a **29-point improvement, z = 4.58** — not a sampling artefact. v2 versus real
LSAT is **z = −0.51, statistically indistinguishable**: on this battery the v2 items are as
resistant to blind solving as the real thing, and their passage lift is actually higher (0.397
against 0.334). Full-passage accuracy fell from a suspicious 1.000 to 0.963, close to real
LSAT's 0.953, so the items also stopped being trivially easy.

v2 surface statistics held: `pick_longest_accuracy` 0.1176, key χ² 0.118. One regression —
Cohen's *d* came in at **−0.2342**, marginally outside the \|d\| ≤ 0.20 gate on the negative
side, because the length-balance pass over-shortens credited answers. The balance pass should
target parity rather than minimizing the correct answer's length.

**What n = 34 can and cannot support.** It can support the conclusion that v2 is dramatically
better than v1: z = 4.58 is far beyond sampling noise, and every one of the four solvers moved
in the same direction. It can support the weaker claim that v2 is *not obviously worse* than
real LSAT. It **cannot** establish that v2 matches real LSAT within a few points — the
confidence interval spans 0.40 to 0.73, so a true rate anywhere in that range is consistent
with the data. It cannot speak to whether the effect holds across subject domains or question
types, since 34 items over 5 passages gives at most a handful of any one type. And it says
nothing about item quality dimensions this battery does not measure. Confirming v2 needs a
150–200 item run, which at measured rates costs about $4 in compute.

<!-- SECTION-MARKER -->

---

# 4. Production pipeline

Eight stages. "Automated" means a script decides and no human sees the artefact unless it
fails. Every threshold below is either measured above or taken from
`07-corpus-reference-distribution.md`.

### Stage 1 — Source selection and harvest
*Automated.* `rcgen_harvest.py` (OpenAlex CC-BY, CRS) and `rcgen_caselaw.py` (CAP).
**Change required before use:** replace `sort=cited_by_count:desc` with a thesis-word search for
the three non-law domains, per the measurement in §1. Retain all 17 metadata fields; a record
missing `license`, `title` or a resolvable URI is dropped at the point of harvest, because
attribution cannot be reconstructed later.
**Pass:** licence ∈ {cc-by, cc0, public-domain}; 900 ≤ words ≤ 20,000; full text via XML/HTML,
never PDF. **Fail:** discard silently and fetch the next candidate.
**Human decides:** the domain mix for the batch, and any addition of a new source corpus
(a licence judgement, never automated).

### Stage 2 — Topical fit screen
*Automated, model-assisted.* `rcgen_corpus_audit.py` rates each article 0–3.
**Pass:** fit ≥ 2. **Measured yield:** CAP 1.00, OpenAlex law 0.88, CRS 0.62, humanities 0.50,
social science 0.38, natural science 0.12. Over-harvest accordingly.
**Human decides:** spot-check ~10% of rejects to confirm the rater is not discarding good
material; adjudicate any domain whose yield falls below 0.3, which usually means the query is
wrong rather than the supply.

### Stage 3 — Condensation
*Automated.* `rcgen_condense.py --variant v5 --repair --repair-rounds 3`, then
`regroup_paragraphs()`.
**Pass:** 435 ≤ words ≤ 490; FK 15–19; 24–33 words/sentence; 4–5 paragraphs; zero register
tells. **Measured:** 14/14 on all three numeric gates.
**Fail:** three repair rounds, then discard the passage rather than accept out of band — a
passage outside the band is wrong regardless of prose quality.

### Stage 4 — Passage validation
*Automated, no model calls, therefore free.*
- `rcgen_provenance.py`: longest verbatim run < 12 words; shared 8-gram rate < 0.02.
  **Measured:** median run 5, max 8; median 8-gram rate 0.000, max 0.0022; 14/14 pass.
- Attribution record complete and a credit line rendered.
- Self-containment: no unresolved pronoun or reference to material outside the passage.
**Fail on verbatim overlap is a hard stop**, not a repair: it means the model copied.

### Stage 5 — Item generation
*Automated.* `rcgen_items.py --prompt v2 --per-passage 9` — generate 9 to keep 7 after gating.
Answer position, question type and negation flag come from the pre-balanced schedule and are
never shown to the model.
**Pass:** well-formed JSON, five distinct choices, stem present.

### Stage 6 — Automated item validation
*Automated.* Runs in this order, cheapest gate first.
1. **Surface statistics** (`corpus_stats.py`, free): `pick_longest_accuracy` ≤ 0.25;
   \|Cohen's *d*\| ≤ 0.20; key χ² < 9.49 with every position in [0.18, 0.22]; extreme-quantifier
   isolation in [0.10, 0.22]; stem p50 within ±3 of 18; choice p50 within ±3 of 15. These are
   *pool-level* gates, computed over the batch, not per item.
2. **Length repair** (`rcgen_balance.py`) for items where the credited answer is longest or
   exceeds the distractor mean by >12 characters. **Fix the over-correction found in §3:** target
   parity, and reject a repair that drives *d* below −0.20.
3. **Blind-solve gate** (`rcgen_eval.py`, four independent models, passage deleted). **Reject
   any item solved blind by all four solvers.** This threshold is set from the real-item control,
   not from chance: 35.7% of *real* LSAT items are solved blind by all four, so a stricter gate
   would reject material indistinguishable from the genuine article. Measured v2 rejection rate
   35.3%, hence generating 9 per passage to keep 7.
4. **Defensibility review** (`rcgen_eval.py --defensibility`): an adversarial model pass looking
   for a second supportable answer. **Not validated in this study** — flagged as assumption.
**Human decides:** nothing routinely. A batch that fails a pool-level gate goes back to
engineering, not to a reviewer.

### Stage 7 — Human review
*Human.* The only stage that cannot be automated, and the one that dominates cost. Protocol in
the next subsection.

### Stage 8 — Ingestion
*Automated, gated on a recorded human sign-off.* Writes `Passage`, `Question` and
`QuestionChoice` rows.
- `Question.license_status` — `public_domain_source` or `ccby_attributed_derivative`, never the
  `unknown_needs_verification` default.
- `Question.review_status` — `human_reviewed_original`, set only from a sign-off record carrying
  a reviewer identity and timestamp.
- `Question.content_hash` — over stem plus sorted choices, to catch near-duplicates across batches.
- `Passage.source` — the rendered credit line from stage 4.
**Schema gap:** `Passage` has a single 255-character `source` string and no structured
attribution. §6 recommends a `passage_sources` table; the credit line alone will not survive a
licence audit because it cannot be queried or re-rendered.

## The human review protocol

Reviewers work **passage-first, then its items as a block**, never on items in isolation: most
of the cost of understanding an item is understanding its passage, and that cost amortises
across seven items.

**A. Passage pass — target 8 minutes, once per passage.** In this order, stopping at the first
hard failure:
1. *Read it once at reading speed.* Does it sound like a test passage or like an article
   summary? This is the judgement no metric replaces, and it goes first because a
   register failure kills all seven items and should not be discovered on item six.
2. *Coherence.* Does the argument track? Is the thing introduced in paragraph 3 actually a
   complication of paragraph 1?
3. *Self-containment.* Any reference requiring outside knowledge, any dangling pronoun.
4. *Factual sanity.* Not fact-checking against the source — checking the passage does not assert
   something false on its face. The model is condensing, and condensation invents.
5. *Attribution.* Credit line renders, licence matches the source record, adaptation noted.
**Reject → discard the passage and its items.** Do not repair a passage; regenerating is cheaper
than editing at $0.05.

**B. Item pass — target 4 minutes per item, 28 minutes per 7-item block.** Per item:
1. *Answer the item yourself, from the passage, before looking at the key.* If the reviewer's
   answer disagrees with the key, that is the finding; everything else is secondary.
2. *Locate the credited answer in the passage.* Point at the words. The generator supplies
   `why_correct` — verify it rather than trusting it.
3. *Rule out each distractor against the text*, using `why_wrong` as a checklist. Any distractor
   the reviewer cannot rule out from the passage is a second defensible answer: reject.
4. *Check the stem matches its assigned type* and reads as conventional test phrasing.
5. *Check nothing gives it away*: credited answer not conspicuously longest, hedged, or the only
   "sensible" statement.
**Outcomes:** accept / accept-with-edit (wording only, never changing which answer is correct) /
reject. **A reviewer must never rewrite a distractor to make an item work** — that reintroduces
the v1 failure mode by hand, since the reviewer knows the answer.

**C. Batch pass — 20 minutes per 50 items.** Re-run `corpus_stats.py` over accepted items only
and confirm the pool-level gates still hold; per-item acceptance can shift key balance and
length distributions.

**Throughput:** 8 + 28 = 36 minutes per passage-block of 7 items, ≈ 5.1 min/item, plus batch
overhead. Assume **5.5 minutes per accepted item** for planning. This assumes a reviewer who
knows the LSAT; it is roughly 2× faster than a novice and roughly 2× slower than an experienced
LSAC-style item writer.

<!-- SECTION-MARKER -->

---

# 5. Cost and schedule for 350 items (~50 passages)

Unit costs are measured from the spend ledger of this study (2,011 calls, $4.91 total), not
estimated. Volumes assume 9 items generated per passage to keep 7 after the 35% blind gate, and
70 source articles harvested to yield 50 passages at the law-weighted fit rate of 0.75.

## Compute

| Stage | Units | $/unit | $ |
|---|---|---|---|
| Harvest + fit audit | 70 articles | 0.0014 | 0.10 |
| Condensation + repair | 50 passages | 0.0524 | 2.62 |
| Provenance + surface statistics | 50 | 0.0000 | 0.00 |
| Item generation (9/passage) | 450 items | 0.0062 | 2.79 |
| Length balance (~30% of items) | 135 | 0.0046 | 0.62 |
| Blind-solve gate, 4 models | 450 | 0.0049 | 2.21 |
| Full-condition check | 350 | 0.0059 | 2.06 |
| Defensibility review | 350 | 0.0040 | 1.40 |
| **Total** | | | **≈ $12** |

**$0.034 per finished item.** Memo `04` estimated $0.21 per candidate item; the true figure is
six times lower. **Compute is not a constraint and should not influence any decision here** —
it is cheaper to generate and discard ten items than to have a human look at one. This argues
for raising generation multiples and tightening automated gates wherever that trades machine
work for human work.

## Human hours

| Activity | Basis | Hours |
|---|---|---|
| Passage review | 8 min × 50 | 6.7 |
| Item review | 4 min × 350 | 23.3 |
| Batch statistics pass | 20 min × 7 batches | 2.3 |
| Rework and adjudication | 15% of items × 8 min | 7.0 |
| **Total review** | | **≈ 39 h** |

| Engineering | Hours |
|---|---|
| Harvester ranking fix (§1) | 3 |
| Blind-solve gating harness, wired as a pipeline stage | 6 |
| Balance-pass over-correction fix (§3) | 2 |
| Ingestion path + `passage_sources` migration (§6) | 8 |
| **200-item confirmation run and analysis** | 6 |
| Orchestration, retry, logging | 6 |
| **Total engineering** | **31 h** |

## Does it fit 1.5 weeks?

**Not with one reviewer. Yes with two, and only if engineering starts first.**

1.5 weeks is 7.5 working days. The 39 hours of review is not 5 days of work, because item
review is concentrated judgement and degrades past about 5 productive hours a day — 39 hours is
therefore **8 reviewer-days**, which alone exceeds the window. The 31 engineering hours are 4
days, and they are partly upstream: gating and the confirmation run must precede bulk generation.

A schedule that fits, with two reviewers:

| Day | Engineering | Review |
|---|---|---|
| 1–2 | Harvester fix, gating harness, balance fix | — |
| 3 | 200-item confirmation run; analyse blind rate at scale | Calibration: both reviewers score the same 20 items, compare |
| 4 | Ingestion + schema migration | Batch 1 (100 items) |
| 5–7 | Orchestration; generate remaining batches | Batches 2–4 (250 items) |
| 8 | Ingest, final batch statistics | Adjudicate disagreements |

That is 8 days — **just over the window, and with no slack.** Honest assessment:

- **350 items in 1.5 weeks with one reviewer: no.** ~2.5 weeks.
- **With two calibrated reviewers: achievable but tight,** contingent on the day-3 confirmation
  run reproducing the v2 blind rate. If it does not, the schedule is void, because there is no
  point ingesting 350 items that fail the one test that matters.
- **A safer commitment is 200 items (~29 passages) in 1.5 weeks with one reviewer**, ≈ 23 review
  hours, which fits with slack and still gives every passage its full 7-item complement.

The binding constraint is human review at 4 minutes per item, and nothing in this pipeline
changes it. The lever that matters is not making generation cheaper — it is already free —
but raising the automated rejection rate so that fewer bad items reach a human. Every point of
precision added to stages 6.3 and 6.4 buys back review hours directly.

<!-- SECTION-MARKER -->

---

# 6. Attribution and licensing hygiene

*Engineering and factual analysis, not legal advice. The conclusion in §6.2 should be confirmed
by counsel before launch; §6.3 is designed so that the answer does not matter operationally.*

## 6.1 How attribution is stored and surfaced

Attribution must be **structured, not a string**. The current schema gives `Passage` a single
255-character `source` column, which cannot hold seven fields, cannot be queried ("show me every
item derived from a CC-BY source"), and cannot be re-rendered if the credit format changes. A
credit line is a *view*, not a record.

Recommended migration — a `passage_sources` table, one row per passage:

| Column | Source | Why it is needed |
|---|---|---|
| `passage_id` | FK | |
| `source_id`, `corpus` | harvest | provenance, dedup |
| `title`, `authors` (JSON), `year`, `publisher` | harvest | CC BY 4.0 §3(a)(1)(A)(i) creator and title |
| `doi`, `url` | harvest | §3(a)(1)(A)(iii) URI |
| `license`, `license_url` | harvest | §3(a)(1)(A)(iv) licence notice |
| `adaptation_note` | fixed | §3(a)(1)(B) indication the work was modified |
| `longest_verbatim_run`, `shared_8gram_rate` | stage 4 | the audit evidence, retained |
| `credit_line` | rendered | denormalized for display |

`rcgen_harvest.py` already emits every one of these fields, and `rcgen_provenance.py` already
renders the credit line, so the cost is the migration and the write path, not new data capture.
A worked example, generated by the pipeline:

> "Structural absorption by barbule microstructures of super black bird of paradise feathers" by
> Dakota E. McCoy, Teresa J. Feo, Todd Alan Harvey et al. (2017) — Nature Communications,
> licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), source:
> https://doi.org/10.1038/s41467-017-02088-w. Adapted: condensed and rewritten.

**Surfacing.** CC BY 4.0 requires attribution "reasonable to the medium". A credit line under
every passage would disfigure a timed practice section and has no analogue in the real test.
The defensible pattern, and the one LSAC itself uses, is a **source credit accessible from the
item** — a collapsed "Source" affordance in review mode — **plus a complete
`/attributions` page** listing every source with its licence and link. Attribution must survive
into any export, PDF or print. It must **not** be stored only in the database and dropped from
the rendered product, which is the most common way this obligation is breached.

## 6.2 Does the derivative passage stay encumbered? — the crux

**The honest answer has two layers, and they point in opposite directions.**

**Layer 1 — if the passage is a derivative work, CC BY does not encumber it.** This is the part
often gotten wrong. CC BY 4.0 §3(b) — the "Adapter's License" — says the adapter *may* license
Adapted Material "under the terms of the Adapter's License You apply", including proprietary
terms. Unlike CC BY-SA, **there is no share-alike, no copyleft, and no obligation to release the
passage under CC BY**. What survives is the attribution obligation of §3(a): retain creator,
title, URI, licence notice, and indicate modification. So even on the most conservative
characterization, a CC-BY-seeded passage can be owned, sold and kept closed — it just has to
carry a credit. **This is why excluding CC BY-SA at harvest was the correct call**, and it is
the single decision that makes the whole approach viable.

**Layer 2 — the passage is probably not a derivative work at all, but do not rely on it.**
Copyright protects expression, not facts or ideas (*Feist*; 17 U.S.C. §102(b)). The measured
overlap between the 14 passages and their sources is:

| | Median | Max | Gate |
|---|---|---|---|
| Longest verbatim word run | **5** | **8** | < 12 |
| Shared 8-gram rate | **0.0000** | **0.0022** | < 0.02 |
| Compression (passage ÷ source) | **6.6%** | — | — |

A longest common run of 5–8 words is the length of an unavoidable phrase ("the court held that
the statute"), not copied expression, and a shared 8-gram rate of essentially zero means no
sentence survives. 14/14 passed. On this evidence the passages take the *ideas* and none of the
*expression*, which is the classic non-infringing use.

But two things keep this from being a safe primary position. First, non-literal similarity can
still infringe where the taking includes the source's **selection, structure and arrangement** —
and a condensation that follows the source's argumentative order is precisely a taking of
structure. My n-gram check measures literal copying only and **cannot detect this**; nothing in
this study measures it. Second, being right is not the same as being cheap to prove: the cost of
defending "not a derivative" vastly exceeds the cost of printing a credit line.

**Conclusion.** *Assume the passage is a derivative and comply with attribution.* The obligation
is a credit line, the compliance cost is near zero, and by Layer 1 it does not encumber
ownership or commercial use. The low measured overlap is then a **second, independent line of
defence** rather than the thing the position rests on. This does answer the strategic question
the exercise was set to answer: seeding from CC-BY corpora **does** escape an encumbered corpus,
because CC BY's only surviving requirement is attribution, and attribution is not encumbrance.

## 6.3 Prefer public domain, which moots the question

CRS reports (17 U.S.C. §105) and CAP judicial opinions (government edicts doctrine; *Banks v.
Manchester*, reaffirmed in *Georgia v. Public.Resource.Org*, 590 U.S. 255 (2020)) carry **no
attribution obligation, no licence notice, and no derivative-work question whatsoever**. They
are the cleanest input available, and §1 measured CAP as also the *highest-quality* input at 8/8
fit. The two rankings coincide, which is unusual and worth exploiting: **weight the corpus
toward CAP and CRS**, and treat CC-BY journals as the supplement needed for subject coverage
rather than the backbone.

Credit is still recorded for public-domain sources — as provenance rather than obligation. An
auditor's first question is "where did this come from", and "public domain, here is the case"
is a better answer than silence.

## 6.4 Standing hygiene rules

1. **CC BY-SA and CC BY-ND never enter the corpus.** SA propagates copyleft into the passage;
   ND forbids the adaptation outright. `CLEAN_LICENSES` already enforces this; do not widen it.
2. **Licence is recorded at harvest, from the source API, never inferred later.** A record whose
   licence cannot be established is discarded, not flagged.
3. **`license_status` is never left at `unknown_needs_verification`.** Ingestion writes
   `public_domain_source` or `ccby_attributed_derivative` explicitly.
4. **The verbatim gate is a hard stop.** A passage over 12 words of continuous overlap is
   discarded, never edited down — high overlap indicates the model copied, and the rest of that
   passage is untrustworthy.
5. **Do not seed from any LSAC material, in any form, at any stage.** The entire point is a
   corpus with clean provenance; a single contaminated seed forfeits it.
6. **Retain the harvest record for every passage in production**, including for discarded
   candidates in the same batch, so provenance is reconstructible under audit.

<!-- SECTION-MARKER -->

---

# 7. What was tested, what is assumption

## Tested, with measurements in this document

| Claim | Evidence |
|---|---|
| CAP is the best RC source available; CC-BY journals fail outside law | 48 articles rated; CAP 3.00/1.00 usable vs natural science 0.62/0.12 |
| The `courtlistener` adapter cannot return anything | `snippet` measured at 65 words against a 900-word gate; full-text route HTTP 401 |
| OpenAlex citation-sort selects against LSAT-suitable material | Side-by-side query comparison; search ranking returns actual humanities |
| Passages can be held to 435–490 words, FK 15–19, 24–33 wps | 14/14 on all three; word range 437–456 |
| Prompting a word count fails; a sentence budget succeeds | v3 asked for 460, returned 482–534; v4 sentence budget took wps compliance 0.00 → 1.00 |
| Naming the FK target makes it worse | v2 stated it and hit 19.14; v3 omitted it and hit 17.06 |
| The FK miss is diction, not syntax | 2.185 → 1.80 syllables/word vs real 1.797, with syntax unchanged |
| Answer key balance is solvable structurally | χ² = 0.061 by never showing the model a position |
| Prompting length parity fails; measure-and-repair succeeds | 0.4286 → 0.1020 pick-longest; *d* 0.4666 → −0.1069 |
| **Real LSAT RC is 61.9% blind-solvable by current models** | 70 real items, 4 independent model families |
| **v1-style generated RC is 91.3% blind-solvable — no better than LR** | 98 items, same battery |
| **v2 construction order closes the gap** | 56.6% blind, lift 0.397; z = 4.58 vs v1, z = −0.51 vs real |
| Condensed passages retain no source expression | Median 5-word longest run, 0.000 8-gram overlap, 14/14 pass |
| Compute is ~$0.034/item | 2,011-call spend ledger |

## Assumption, or tested too weakly to rely on

1. **The v2 blind-solve result rests on 34 items.** The 95% CI is (0.400, 0.733). It firmly
   establishes v2 ≫ v1; it does not establish that v2 matches real LSAT closely. **The 200-item
   confirmation run is the single most important next step** and costs about $4.
2. **The defensibility gate (stage 6.4) was specified but never run.** Budget went to the
   blind-solve control instead, which was the more fundamental question. Multiple-defensible-answers
   was `04`'s *other* identified failure and remains entirely unmeasured here.
3. **"Reads as LSAT register" is my judgement plus a regex battery**, not a blind discrimination
   test by an experienced reviewer against real passages. That test is cheap and should be run.
4. **Human review timings (8 min/passage, 4 min/item) are estimates, not observations.** No one
   has reviewed these items. The schedule in §5 is only as good as these two numbers, and they
   should be calibrated on the first 20 items before anyone commits to a date.
5. **Blind-solvability is not item quality.** An item can resist all four solvers and still be
   unfair, ambiguous to humans, or miscalibrated in difficulty. Nothing here measures difficulty
   against human performance, and no generated item has been seen by a test taker.
6. **Full-passage solver accuracy of 0.963 may indicate the items are too easy.** Real LSAT RC
   scored 0.953 on the same battery, so they are comparable, but neither number speaks to
   discrimination among human candidates at the top of the scale.
7. **Pre-1929 public-domain scholarly prose is untested** as the fix for humanities supply,
   which §1 measured as the thinnest domain (1 usable seed from 8).
8. **Structure-and-arrangement copying is unmeasured.** §6.2 relies on n-gram overlap, which
   detects literal copying only.
9. **Single generator model.** Everything was generated with `gpt-5.6-luna`. Whether the v5/v2
   prompts transfer to another model is untested, and the pipeline should not assume they do.

## Recommended next step

Run the 200-item confirmation at v2, with the defensibility gate enabled, and have a qualified
reviewer score the first 20 items blind against 20 real LSAT items. That single experiment
costs roughly $4 in compute and half a day of review, and it resolves items 1, 2, 3 and 4
above — which together are the difference between "this pipeline works" and "this pipeline
worked once on 34 items."

<!-- SECTION-MARKER -->
