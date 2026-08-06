# Corpus Reference Distribution — statistical fingerprint of 6,886 real LSAT items

**Purpose.** These are the acceptance thresholds for original items. They were computed while the
infringing corpus still existed and are unrecoverable once it is deleted.

**What is retained, precisely.** Aggregates only — no stimuli, no passages, no answer choices, no
explanations. One deliberate exception: the JSON keeps the most frequent normalized *question stems*
(e.g. "which one of the following, if true, most strengthens the argument?"). These are short,
functional, and appear verbatim in every LSAT prep book in print, and item writing is impossible
without them. It is nonetheless a judgement call rather than a pure-aggregate extract, so it is called
out here rather than buried. If counsel prefers, delete the `stem_templates.top_30` key from both JSON
files; every other statistic survives intact.

**Provenance of the numbers.** Computed by `backend/scripts/corpus_stats.py` over
`backend/data/question_bank/{lsat-lr,lsat-rc}/{train,test,validation}.jsonl`.
Machine-readable output: `research/07-corpus-lr.json`, `research/07-corpus-rc.json`.

| | Logical Reasoning | Reading Comprehension |
|---|---|---|
| Items | 4,520 | 2,366 |
| Distinct stimuli / passages | 4,242 | 349 |
| Median items per stimulus | 1 | 7 |
| Administrations covered | 85 (1991–2016) | 85 (1991–2016) |
| Malformed records | 0 | 0 |

Section counts sum to 6,886, matching the database.

The script is reusable and is the point of this exercise: run it against generated candidates with
`--compare` to score them against this baseline.

```bash
python backend/scripts/corpus_stats.py \
  --source candidates.jsonl --section lr \
  --out /tmp/candidates.json --compare research/07-corpus-lr.json
```

---

## 1. The headline: real LSAT items barely leak, and that is the bar

`04-item-generation.md` found that 19 of 24 model-written LR items were solved by four independent
solvers **with the stimulus deleted** — a blind-solve rate around 0.90. The natural question is what
the real items score on the same kind of surface-cue test. The answer is that they are close to inert.

| Surface cue | LR | RC | Chance |
|---|---|---|---|
| "Always pick the longest choice" | **0.2192** | **0.1796** | 0.20 |
| Correct-vs-distractor length, Cohen's *d* | **0.114** | **0.026** | 0 |
| Isolated quantifier predicts correct | **0.1853** | 0.1884 | 0.20 |
| Isolated **extreme** quantifier predicts correct | **0.1833** | **0.1631** | 0.20 |

Length gives away almost nothing: picking the longest choice beats chance by 1.9 points in LR and
**loses** to chance in RC. The effect size on answer length is 0.114 in LR, which is below the
conventional "small" threshold of 0.2, and 0.026 in RC, which is nothing at all.

**Acceptance test.** A generated pool must satisfy `pick_longest_accuracy ≤ 0.25` and
`|cohens_d| ≤ 0.20`. Anything above that is leaking through length before a solver model is even
involved, and this check costs nothing to run.

**Scope warning.** "Barely leak" here means *surface* cues only. On a stimulus-deleted solver battery,
real RC items are 61.9% blind-solvable (limitation 3). Passing every statistic in this document is
necessary, not sufficient.

## 2. The counterintuitive finding: extreme quantifiers mark *wrong* answers

The intuition from the generation research is that an isolated "all" or "never" in one choice is a
giveaway. In real LSAT items the sign is reversed. Across 4,632 LR events where exactly one of the
five choices carried an extreme quantifier, that choice was correct only **18.3%** of the time, and in
RC only **16.3%** across 1,067 events. Both sit below the 20% chance line.

Test writers use absolute language deliberately as a *trap*: the over-strong choice is the one a
careless reader picks. Correct and incorrect choices also carry near-identical overall quantifier
density (LR 0.632 vs 0.655 terms per choice; RC 0.302 vs 0.312), so density itself is not a signal
either.

**Acceptance test.** Do not merely avoid isolated extreme quantifiers. Target
`extreme_isolation_predicts_correct ∈ [0.10, 0.22]` — an isolated absolute should usually be attached
to a distractor. A generator that puts absolutes on correct answers has inverted the convention, which
is worse than a neutral generator because it teaches students a false heuristic.

## 3. Answer key balance

| Position | A | B | C | D | E | χ² (df 4) | Uniform? |
|---|---|---|---|---|---|---|---|
| LR | 18.76% | 20.86% | 20.11% | 21.35% | 18.92% | **11.95** | rejected at .05 |
| RC | 19.61% | 20.79% | 19.74% | 21.26% | 18.60% | 5.21 | not rejected |

RC is statistically indistinguishable from uniform. LR shows a small but real skew (χ² = 11.95 against
a 9.49 critical value), with the middle-to-late positions slightly favoured and A and E slightly
depressed. The practical magnitude is about 2.6 percentage points between the most and least common
positions, which is far too small to exploit.

**Acceptance test.** Generated pools should hold every position in `[0.18, 0.22]` and keep χ² below
9.49. This matters more for generated items than it did for LSAC, because LLMs have a well-documented
positional bias and will happily place 40% of correct answers in position C if unconstrained.

## 4. Length bands

Words, with the 5th–95th percentile range as the working band.

| Field | LR p5 | LR p50 | LR p95 | RC p5 | RC p50 | RC p95 |
|---|---|---|---|---|---|---|
| Stimulus / passage | 33 | **64** | 105 | 435 | **457** | 490 |
| Stem | 9 | 14 | 24 | 9 | 18 | 31 |
| Answer choice | 9 | 18 | 36 | 4 | 15 | 31 |

The RC passage band is the most striking number in the document: **the middle 90% of passages fall
between 435 and 490 words**, a spread of only 55 words around a 457-word median. LSAC is writing to a
tight spec. Since `04` recommends seeding RC passages from license-clean corpora, this is the single
most actionable constraint available — source material must be condensed to 435–490 words, and a
passage outside that band is wrong regardless of how good the prose is.

**Acceptance test.** Reject any RC passage outside 430–495 words. Reject LR stimuli outside 30–110
words. Keep median answer-choice length within ±3 words of 18 (LR) and 15 (RC).

## 5. Stem templates and question types

Stems are formulaic by design, which makes them the one component safe to imitate closely.

- LR: 3,204 distinct normalized stems; the top 50 cover 19.7% of items.
- RC: 1,944 distinct normalized stems; the top 50 cover 17.4%.

Type inference from stem phrasing recovered a type for **68.9% of LR** and **68.3% of RC** items. The
remaining ~31% are genuinely ambiguous from the stem alone and would need the stimulus to classify.
This is a meaningful improvement over the app's current state, where `06-current-app-audit.md` found
46% of items untyped — but note the recovery is heuristic, and the 31% unclassified residue is a
ceiling on what regex over stems can do.

| LR type | Share | | RC type | Share |
|---|---|---|---|---|
| flaw | 8.4% | | inference | 20.3% |
| inference | 7.1% | | main idea | 14.2% |
| assumption (necessary) | 6.6% | | structure | 10.8% |
| assumption (other) | 6.6% | | detail | 9.6% |
| strengthen | 6.5% | | attitude | 7.0% |
| weaken | 5.7% | | analogy | 2.8% |
| parallel | 5.2% | | strengthen/weaken | 2.3% |
| principle | 5.1% | | vocabulary | 1.6% |
| *unclassified* | 31.1% | | *unclassified* | 31.7% |

Negation stems (EXCEPT / NOT / LEAST) are 4.1% of LR and 4.7% of RC.

**Acceptance test.** A replacement pool should reproduce this type mix within a few points rather
than over-producing the easy-to-generate types. Expect an LLM left to itself to over-generate
strengthen/weaken and under-generate parallel reasoning and principle items, which are the hardest to
write. Hold negation stems near 4–5%; they are a distinct item class and their absence is noticeable.

## 6. Readability

| | LR | RC |
|---|---|---|
| Flesch–Kincaid grade (median) | 13.2 | 16.8 |
| Words per sentence (median) | 21.5 | 28.3 |
| Type-token ratio | 0.061 | 0.014 |

RC prose sits at roughly first-year-graduate reading level with 28-word sentences. Generated passages
that read more plainly than this are off-register even when factually fine, and this is the most
common way LLM prose betrays itself.

**Acceptance test.** RC passages should land at FK 15–19 and 24–33 words per sentence; LR stimuli at
FK 11.5–15 and 18–26 words per sentence. Ignore the type-token ratios as a target — they are corpus-size
dependent and not comparable across pools of different sizes.

## 7. Coverage inventory — what a replacement bank has to cover

- **85 administrations**, June 1991 through December 2016, all decoded from `id_string`; no records
  had an unparseable identifier.
- **RC: 349 distinct passages**, median 7 questions per passage. This is the replacement target, and
  it is encouragingly small. At 5–8 items per passage, roughly **50 passages yields 350 items** — and
  `04` estimates $0.21 per candidate item, so the marginal compute cost of an RC pool is trivial
  against the human review that dominates it.
- **LR: 4,242 distinct stimuli** for 4,520 items, i.e. LR is essentially one stimulus per item and
  offers no amortisation. This is a second, independent argument for the plan's decision to build RC
  first: RC gets 7 items per unit of authoring effort, LR gets 1.

---

## Limitations

1. Type inference is regex-over-stems; 31% is unclassified and the labelled 69% is unvalidated against
   human coding. Treat the type mix as indicative, not authoritative.
2. These are *surface* statistics. Passing all of them says an item is not leaking through the cues
   measured here; it says nothing about whether the item has exactly one defensible answer, which `04`
   identified as the harder failure and which needs solver models and human review.
3. ~~Blind-solvability is not computed here.~~ **Resolved — see `10-rc-pipeline-spec.md`.** The
   stimulus-deleted solver battery was subsequently run against these files with four independent
   frontier models, and **real LSAT RC items are 61.9% blind-solvable** (70 items). That figure is
   inflated by training-data contamination, since the models have memorised public PrepTests, but it
   is the operative baseline regardless: **the acceptance bar for generated items is "no worse than
   61.9% on the same battery," not "near chance."** Generated RC scored 91.3% on a first attempt and
   56.6% after distractor construction was inverted.

   This does not contradict §1. Those statistics measure *surface* cues — length, quantifier polarity,
   key position — which real items genuinely do not leak. Blind-solvability measures whatever a
   language model can recover from the choices alone, including semantic plausibility and memorisation.
   An item can be clean on every statistic in this document and still be blind-solvable, so the two
   checks are complements: run these first because they are free, then run the solver battery.
4. Syllable counting for Flesch–Kincaid is heuristic, so the grade levels are accurate to roughly
   ±0.5 and should be compared like-for-like using this same script rather than against published
   figures from other tools.
