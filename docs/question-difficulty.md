# Question difficulty

Every one of the 6,886 questions in the bank used to carry `difficulty = 3`.
Not "roughly average" — literally the integer 3, written onto every row by the
ingest path, read by two things: a serialised field in `history.py`, and the
coaching prompt, which told a language model `"difficulty": 3` about every
question it has ever explained. Nothing in the adaptive path read it at all.

This document covers what replaced it: whether a real rating already existed,
what was built instead, whether it predicts anything, and what a consumer has
to do to read it without being misled.

**Do not confuse this with `ReviewQueueItem.difficulty`.** That is the D of the
FSRS DSR memory model — one student's retrieval difficulty for one card, which
does vary and is working correctly. The quantity here is a property of the
*item*, shared by everybody, measured in logits. See `app/scheduling.py` for the
other one.

---

## 1. Is there an official rating? No, and here is the check

A published difficulty from the test maker would beat any estimate this
application can produce, so this was settled before anything was built.

**The bank is entirely two Hugging Face datasets.** `data/question_bank/manifest.json`
pins `tasksource/lsat-lr` at revision `57716ef1` (4,520 questions) and
`tasksource/lsat-rc` at `f0923a19` (2,366), with a sha256 per split. That is
6,886, which is the whole bank.

**Those datasets have five fields.** Reading all 6,886 rows of the vendored
JSONL, the key set is exactly `context`, `id_string`, `answers`, `label`,
`question` — on every row, with no exceptions and no difficulty column at any
revision. `scripts/snapshot_question_bank.py` and `app/seed.py` cannot have
dropped a rating, because there is none arriving. Their own upstream is Zhong et
al.'s LSAT scrape (the AR-LSAT corpus, PrepTests 1991-2016), which did not carry
one either.

**LSAC has published per-item difficulty, for six forms, on paper.** The
*SuperPrep* books rate each item 1-5 in their explanations. SuperPrep I covers
February 1996, February 1999 and February 2000; SuperPrep II covers PrepTest 62
(December 2010), PrepTest 63 (June 2011), and one undisclosed form with no
administration date. Five of those six are in this bank — the `id_string` prefix
is the administration date, so this is checkable:

| form | items in bank |
| --- | --- |
| 199602 | 77 |
| 199902 | 77 |
| 200002 | 77 |
| 201012 | 79 |
| 201106 | 78 |
| **total** | **388 of 6,886 (5.6%)** |

So even a complete transcription would label 5.6% of the bank, and the ratings
exist only as prose in two copyrighted books. That is not a source; it is a
manual data-entry project with a licensing question attached.

**Conclusion: no official rating, so an estimator is justified.** The column
where a real one would live is `Question.published_difficulty` — nullable, NULL
on every row, and never written by anything. `tests/test_calibration.py` reads
the application source and fails if any line assigns to it, because the value of
that column is entirely that nothing can forge it. If the 388 SuperPrep ratings
are ever transcribed, they go there, and the estimate stays in its own table.

That NULL is not a new idea: `research/11-measurement-implementation-spec.md` § 5
specified seeding difficulty as NULL rather than as a number, and it was never
done. Migration `0037_difficulty_calibration` does it.

---

## 2. What was built

An Elo-style online rating, one update per answered question, in
`app/calibration.py`. The full derivation is in that module's docstring; this is
the shape of it.

### Why not Item Response Theory

`research/11-measurement-implementation-spec.md` § 6 specifies a Rasch JMLE fit,
and that remains the right endpoint. It is not reachable from here. A stable
Rasch item estimate wants 100-200 responses per item, which across 6,886 items
is roughly a million responses before the bank is calibrated. That corpus does
not exist. An estimator that produces nothing until it does produces nothing,
which is the state the application has been in since it was built.

Elo converges toward the same quantity the Rasch difficulty parameter estimates,
costs one arithmetic update per response instead of a batch refit, and says
something after the first response. The precedent is Klinkenberg, Straatemeier &
van der Maas (2011) — the Math Garden system, Elo run online over millions of
child-item matches with the ratings driving adaptive selection. When enough
responses exist for § 6, the ratings here are the starting values for that fit,
not a detour away from it.

### The model

One response is a match between a student and a question:

```
p = c + (1 − c) · σ(θ − b)
```

θ is the student's ability in that section, b the item's difficulty, both in
logits, and c = 1/(number of choices) the floor a five-choice question cannot go
below. Plain Elo sets c = 0, which claims a hard enough item is never answered
correctly; ignoring the guess makes every hard item's rating run away upward as
it is repeatedly "surprised". The update is gradient ascent on the
log-likelihood, which for c > 0 carries an extra factor:

```
θ ← θ + K_θ · (y − p) · q/p
b ← b − K_b · (y − p) · q/p        q = σ(θ − b)
```

At c = 0 that factor is 1 and this is exactly Elo.

**K is not a tuned constant.** Each response carries Fisher information
`I = (1 − c)·q²·(1 − q)/p`, which is accumulated per item and per learner, and
`K = 1/(prior precision + ΣI)` — the stochastic Newton step, the same idea
Glicko adds to Elo. A new item moves a long way on its first response and barely
at all on its two-hundredth, with no hand-picked schedule deciding when. That is
an argument, so it is also an arm of the validation run:

| step rule | log loss | Brier | AUC |
| --- | --- | --- | --- |
| **information-scaled** | **0.60884** | **0.21126** | **0.6942** |
| fixed K = 0.1 | 0.62495 | 0.21760 | 0.6820 |
| fixed K = 0.2 | 0.61489 | 0.21355 | 0.6848 |
| fixed K = 0.4 | 0.61593 | 0.21409 | 0.6835 |
| fixed K = 0.8 | 0.64021 | 0.22284 | 0.6746 |

Worth 0.006 nats and 0.009 AUC against the best constant, on the same responses
in the same order — small, but it comes with one fewer number to pick.

The two sides differ in one respect. The item's K decays without limit; the
learner's information is **capped** at 9, flooring their step at 0.1, because
ability is not fixed — the entire product is an attempt to change it — and a
rating that stops moving stops tracking the person.

Ability is tracked **per section** (`LearnerRating.scope`), because a single θ
would make a Logical Reasoning item look hard when the student is weak at
Reading Comprehension.

### Where it lives

| | |
| --- | --- |
| `app/calibration.py` | the estimator, the provenance ladder, the exposure draw |
| `question_calibrations` | one row per question that has been answered; none for questions that have not |
| `learner_ratings` | one row per (user, section) |
| `Question.published_difficulty` | nullable, NULL everywhere, for a rating the test maker states |
| `SessionItem.exposure_policy` / `Attempt.exposure_policy` | how the question came to be shown |
| migration `0037_difficulty_calibration` | renames `difficulty` → `published_difficulty`, NULLs it, creates the two tables |

The write path is `services._record_response`, reached from `submit_attempt` and
`grade_exam_answer` — the only two places an attempt comes into existence. Two
selects and at most two upserts, on a path that already writes an attempt, a
skill row and a review card.

---

## 3. Does it predict? Yes, and here is the margin

A rating that does not predict responses is not a difficulty measure however
plausible its arithmetic, so this is a test in the suite
(`test_the_rating_predicts_held_out_responses_better_than_knowing_only_the_student`)
rather than a claim in a report. Reproduce with:

```
python backend/scripts/calibration_validate.py --simulate
python backend/scripts/calibration_validate.py --database    # once real attempts exist
```

The corpus is generated by a **2PL model with per-item guessing floors and
upward-drifting ability**, and the estimator is Rasch/Elo with a fixed guessing
floor — wrong about discrimination, wrong about guessing, wrong about
stationarity, on purpose. An estimator only tested against data its own model
generated has been asked a question it cannot fail.

400 items, 9,600 responses, 30% held out:

| model | log loss | Brier | AUC |
| --- | --- | --- | --- |
| global base rate | 0.66660 | 0.23684 | 0.5000 |
| question's section | 0.66660 | 0.23684 | 0.5000 |
| learner only | 0.64163 | 0.22536 | 0.6297 |
| item percent-correct only | 0.63789 | 0.22303 | 0.6463 |
| learner × item percent-correct | 0.61191 | 0.21240 | 0.6912 |
| **Elo** | **0.60884** | **0.21126** | **0.6942** |

The item rating is worth **+0.0328 nats** against a model that knows the student
and nothing about the question, and **+0.0031 nats** against the strong baseline
of learner rate combined with the item's raw percent-correct. Rank correlation
against held-out observed difficulty is **Spearman +0.63** over items with 8 or
more held-out responses.

Against the difficulties that actually generated the data: **Spearman +0.82,
Pearson +0.82, RMSE 0.56 logits, bias +0.01** at 24 responses per item. A Rasch
estimator cannot recover a 2PL difficulty exactly, so read the rank.

### How many responses before a rating is worth reading

Corpus size varied, bank and cohort fixed. This table is where the status
thresholds in `calibration.py` come from.

| responses/item | Spearman vs truth | RMSE | nats vs learner-only | nats vs learner × %-correct | AUC |
| --- | --- | --- | --- | --- | --- |
| 3.1 | 0.475 | 0.877 | +0.0221 | +0.0135 | 0.603 |
| 7.5 | 0.634 | 0.759 | +0.0242 | +0.0064 | 0.668 |
| 15.0 | 0.755 | 0.636 | +0.0336 | +0.0043 | 0.679 |
| 24.0 | 0.816 | 0.559 | +0.0328 | +0.0031 | 0.694 |
| 45.0 | 0.907 | 0.429 | +0.0465 | +0.0010 | 0.721 |
| 90.0 | 0.933 | 0.368 | +0.0509 | −0.0019 | 0.735 |

Two honest readings of that last column. Elo's advantage over
learner × percent-correct **shrinks as data accumulates**, and at 90 responses
per item it is gone — with that much data the crude statistic catches up, which
is exactly what should happen and is why Elo is justified by the *low*-data
regime rather than by being cleverer. And the ranking keeps improving long after
the predictive gain flattens, which is why the status ladder is set on recovery
rather than on log loss.

### Selection bias, measured rather than feared

`targeting` is the share of exposures chosen because of the item's estimated
difficulty; `holdout` is the share of those forced back to a uniform draw.
Spearman against true difficulty, so higher is better.

| targeting | holdout | unbiased n | Elo (all) | Elo (blind only) | percent-correct |
| --- | --- | --- | --- | --- | --- |
| 0.00 | 0.00 | 9,600 | 0.8156 | 0.8156 | 0.8146 |
| 1.00 | 0.00 | 0 | 0.8548 | — | 0.7791 |
| 1.00 | 0.25 | 2,372 | 0.8330 | 0.5973 | 0.8093 |
| 0.75 | 0.25 | 4,186 | 0.8575 | 0.7211 | 0.8364 |

Read the last column first. **Percent-correct is what targeting destroys**
(0.815 → 0.779), because "few people got it right" stops meaning "hard" once the
people are chosen for their ability. Elo conditions on θ, so it survives
targeting and in fact improves under it, because a matched item is a more
informative match.

Note the `Elo (blind only)` column is *worse* than the full rating, and that is
not a defect: it is built from a quarter of the responses, so it is noisier. The
blind rating is a **diagnostic, not a better estimate** — its job is for the gap
between it and the naive rating to be readable, and the gap is published as
`selection_bias_gap`. Do not use it as the value.

---

## 4. Provenance: how much do we actually know about this question?

Two independent axes, kept separate on purpose, because "fifty responses" and
"fifty responses from a demo seeder" are the same amount of evidence and not the
same evidence.

**`status` — how much evidence.**

| status | meaning |
| --- | --- |
| `uncalibrated` | no row, or no responses. **No difficulty exists for this item.** |
| `provisional` | 1-11 responses. Directional at best; no number is published to the coaching prompt. |
| `estimated` | 12+ responses. A band is published. Usable for targeting. |
| `calibrated` | 50+ responses **and** SE ≤ 0.30 logits. Both conditions: fifty responses from students who were never going to miss the item carry very little information. |

The standard error is `1/√ΣI` and is **optimistic** — it treats θ as known when θ
is itself estimated, and Elo is noisier than maximum likelihood. It is published
rather than hidden, and the thresholds allow for it.

**`origin` — what kind of evidence.**

| origin | meaning |
| --- | --- |
| `responses` | real students answering in the application |
| `simulated` | a demo seeder or a simulation invented these answers |
| `imported` | replayed from another system |
| `official` | reserved for a rating the test maker published |

`origin` is **sticky in the direction of less trust**: once a synthetic response
lands on a row, the row is synthetic forever, because the two cannot be unmixed
afterwards. Both demo seeders declare their whole run synthetic
(`calibration.responses_marked(ORIGIN_SIMULATED)`), both clear the ratings a
previous run invented before writing new ones, and `seed_demo`'s self-check
fails if any rated question came out unmarked. `calibration_backfill.py` decides
per account: attempts belonging to an `@localhost.test` address are recorded as
`simulated`, because that is the only address the seeders may write to and a
replay cannot tell an invented answer from a person's afterwards.

The reason for all of this is on the record: this project has already shipped a
demo seeder that bypassed the real selector and test fixtures describing a
question bank that could not exist. An instrument that cannot tell its own dry
run from the real thing is that mistake with better arithmetic.

**Two commands answer "how much do we know".**

```
python backend/scripts/calibration_report.py
python backend/scripts/calibration_report.py --question hf-lsat-lr:199106_3-LR1_1_1
python backend/scripts/calibration_report.py --hardest 20 --status calibrated
```

On a fresh install the honest answer is *nothing about any of them*, and the
report prints that rather than a table of threes.

---

## 5. How a consumer reads this

### Read `calibration.signal(question)`, not the columns

```python
from app import calibration

reading = calibration.signal(question)
```

```python
{
  "published": None,             # the test maker's rating. NULL on every row.
  "status": "estimated",
  "origin": "responses",
  "rating": 0.42,                # logits, centred on the bank's mean. Higher is harder.
  "band": 4,                     # 1 easiest … 5 hardest. None below `estimated`.
  "standard_error": 0.31,
  "responses": 18,
  "correct": 7,
  "unbiased_responses": 18,
  "unbiased_rating": 0.42,       # from difficulty-independent exposure only
  "selection_bias_gap": None,    # how far targeting has bent the naive rating
  "usable_for_targeting": True,
}
```

Four rules, in order of how expensive they are to get wrong:

1. **Branch on `usable_for_targeting`, not on `rating`.** It is a single boolean
   that already accounts for evidence *and* origin. A `rating` exists on a row
   with one response behind it and it means almost nothing.
2. **`rating` is relative.** Elo's scale is identified only up to a shift, so
   the origin wanders as a population learns. `signal` centres reads on
   `scale_centre()`; when reading a page of rows, compute the centre once and
   pass it in, and pass `calibration` when it is already loaded (`joinedload`
   `Question.calibration`).
3. **`uncalibrated` means no difficulty, and must not be defaulted to a middle
   value.** Substituting 3 for a missing rating is precisely the bug this
   replaced. Prefer showing the item without a difficulty, or excluding it from
   a difficulty-driven decision.
4. **Never write `published_difficulty`.** A test in the suite fails if you do.

### Selection reads difficulty through `exposure_draw`

`select_random_questions` and the in-passage fill of
`select_reading_comprehension_case` aim targeted slots at the student's
section ability. Empty `published_difficulty` does not crash: Elo ratings are
used instead, and an unrated item gets an exploration weight. The
`difficulty_targeting` layer is live; its off arm is uniform. Four steps, all
of them required, and all of them now taken:

1. Call `calibration.exposure_draw(user_id, session_id, position)` **once per
   slot, before choosing the question**.
2. On `"random"` (25% of slots), choose without reference to difficulty.
3. On `"targeted"`, weight remaining candidates toward the student's θ.
4. **Write the returned policy to `SessionItem.exposure_policy`.**
   `submit_attempt` copies it to the attempt and `record_response` routes the
   update.

Step 4 is the one to worry about, because skipping it breaks nothing visibly: it
silently reclassifies a targeted response as blind, poisons `blind_rating` with
the exact bias `blind_rating` exists to detect, and the poisoning is
undetectable afterwards.

`exposure_draw` is deliberately the same construction as the control arm in
`strategies.assign_strategy_trial` — a stable hash against a fixed threshold, at
the same 25% — so the two randomisation schemes are recognisably the same idea.
It is duplicated rather than imported so that changing one cannot silently
change the other.

`propensity` is returned on the draw and is the probability of the arm that
actually happened, so a later inverse-propensity fit does not have to
reconstruct the scheme from the code that produced it.

### Getting from zero to a signal

On a database with history, replay it — the ratings would otherwise start from
zero while the evidence sat in `attempts`:

```
python backend/scripts/calibration_backfill.py --dry-run
python backend/scripts/calibration_backfill.py --reset
```

Same function, same arithmetic, same order as the live path. Only safe to re-run
with `--reset`; without it every response is counted twice.

---

## 6. What was deliberately left alone

- **Question selection.** `select_random_questions`, `_weight_toward_focus`
  and the in-passage RC fill read difficulty when `difficulty_targeting` is
  on, behind `calibration.exposure_draw`. `scheduling.interleave` and
  `due_for_review` do not.
- **`app/strategies.py`**, owned by another workstream. `exposure_draw` copies
  its randomisation idea rather than importing it.
- **`ReviewQueueItem.difficulty`** — the FSRS memory model, a different quantity
  that works.
- **The Rasch fit in `research/11` § 6.** Not enough responses exist. These
  ratings are its starting values when they do.
- **Item discrimination and a per-item guessing floor.** A 2PL or 3PL fit needs
  more data per item than the Rasch difficulty does, and the simulation shows
  the Rasch estimator recovers the *rank* of 2PL difficulties at +0.82 anyway.
- **The 388 SuperPrep ratings.** A manual transcription from two copyrighted
  books covering 5.6% of the bank. `published_difficulty` is where they would go.
