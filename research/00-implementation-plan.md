# LSAT Speedrun — Implementation Plan

**Written:** Sunday, 2 August 2026. **Corrections folded in:** the same day, from four follow-up
implementation specs (`08`–`11`) written after the first draft.
**Synthesized from:** the six original research memos in `research/`, plus a direct read of the
codebase, plus the four correction memos noted above.
**Assumed launch:** on or about 12 August 2026 — roughly nine working days from now.

**How to read the citations.** Every recommendation carries a pointer of the form
`[03-content-licensing.md § 8.5]` or `[02-measurement-and-score-prediction.md:1005]`. Open that file
and that section and you will land on the evidence. Where I am extrapolating past what the research
says, I write "my inference" and say so plainly. Where the six researchers disagree, I adjudicate in
§8 rather than averaging them.

**What this plan refuses to do.** It does not propose rebuilding the product. The tycoon economy, the
3D office, the empire map, the story chapters, the strategy library and the LLM coach all stay. The
research does not support removing them — it supports *rewiring three of them and re-labelling two*
[01-learning-science.md § Top 12 #5, #12; 05-market-and-competition.md § The gamification verdict].
Nearly everything below is a change to defaults, copy, earn-rules, and what gets logged.

**Revision note.** Four corrections surfaced from research written after this document was first
drafted and are folded in below, each marked **Correction** with a citation: the pricing conclusion
this document originally flagged as an open question is now answered, and it is *not* the one the
founder likely assumed [§10 item 3, `08-unit-economics.md`]; the Method Lab estimator has a second,
more urgent bug beyond the known sample-size problem [§P0-6, `11-measurement-implementation-spec.md`
§ 1]; the LLM coaching path has an unaddressed data-egress liability that is now a Phase 0 item
[§P0-1B, `09-privacy-and-compliance.md`]; and original RC generation is not safely viable by default
the way earlier research implied — it required a specific fix, verified on a small sample
[§P0-9, `10-rc-pipeline-spec.md`]. Nothing else below changed; the phase structure, the "explicitly
not doing" list, the gamification verdict, Focus Mode, and the learning-science recommendations are
as originally written.

---

## 1. Executive summary — the whole plan in ninety seconds

**The single fact that reorders everything: the question bank cannot ship, and a licence cannot
arrive before launch.** All ~6,886 items derive from 85 LSAC PrepTests with no upstream licence
[03-content-licensing.md § 2.4]. LSAC sued a *single engineer* whose app did not even host LSAT items
— it asked users to paste them in — and won a judgment on copyright, trademark, contract and unfair
competition within eight months of his launch [03-content-licensing.md § 2.3]. Meanwhile the licence
itself is cheap, published, and obtainable at $38/student, but the memo's own estimate is "weeks to a
few months … **It will not be done in 1.5 weeks. Treat that as the binding constraint**"
[03-content-licensing.md § 4.5].

So there is not a fork between two launches. There is **one launch, and one parallel workstream.**
Launch without LSAC's items. Start the licence conversation the same week, *after* the takedown, and
re-launch with official content in six to ten weeks when it lands. Both branches are costed in §3.

The eight things worth doing, in priority order:

1. **Take the content down today and purge it properly** — repo private, items out of the deployed
   database, git history rewritten, timestamps recorded, IP counsel booked, and only *then* an email
   to `licensing@LSAC.org`. Contacting LSAC first is exactly what converted the last defendant's case
   into a willfulness case [03-content-licensing.md § 7.4].
2. **Before the purge, spend one day computing the reference distribution** over the 6,886 items —
   word-count, choice-length, stem-phrasing and blind-solve statistics. Statistics about the corpus
   are not the corpus, they are the acceptance thresholds for every original item you will ever
   write, and after Tuesday you cannot compute them [04-item-generation.md § Track B step 0].
3. **Repoint the product at what you own: evaluated written reasoning.** Method Lab is the only thing
   in this product no competitor at any price offers below $150/hour of human tutoring
   [05-market-and-competition.md § 8]. It becomes the headline, not the tycoon game.
4. **Ask one onboarding question and set two defaults.** Target score and test date. Anyone at 168+
   or inside eight weeks gets Focus Mode — practice, analytics, review queue, no office, no economy.
   This single change satisfies both the expertise-reversal literature (uniform scaffolding *harms*
   stronger learners at *d* ≈ −0.43) and the market's Focus Mode recommendation, at the cost of one
   form field [01-learning-science.md § Top 12 #1; 05-market-and-competition.md § Positioning].
5. **Move case fees off per-question completion.** Completion-contingent reward is the single most
   damaging contingency in the reward literature (*d* = −0.48), and it is currently wired to the core
   loop; informational feedback is the only reward type that *raises* intrinsic motivation
   (*d* = +0.33) [01-learning-science.md § Top 12 #5].
6. **Stop saying "confirmed."** The Method Lab statistics thresholds (8 prompted vs. 4 control) have
   5.3% power against a realistic effect — indistinguishable from the false-positive rate — and are
   off by 20× to 900× [02-measurement-and-score-prediction.md § 9]. Keep the feature, keep the silent
   control, change four strings and one computation. **Correction:** a second, more urgent bug sits
   underneath the sample-size problem — the estimator filters on a self-reported,
   post-randomization variable, which biases both the reported lift and the bandit's allocation in
   an unknown direction. This is a ~2-hour fix, and it should happen before the sample-size fix, not
   after it [11-measurement-implementation-spec.md § 1]. See P0-6.
7. **Start logging four things that are unrecoverable retroactively**: verified official LSAT scores,
   bandit assignment propensities, a designated anchor item set, and a randomized exposure slice
   [02-measurement-and-score-prediction.md:1005-1008].
8. **Buy credibility with boring, cheap signals**: a named 99th-percentile reviewer, a provenance
   page, a fee-waiver tier, a report-this-question button, Blind Review by that name, and the
   UWorld/NBME framing. Every credibility signal in test prep is person-level, and the product
   currently has no named human behind it [05-market-and-competition.md § 5].

**What this buys.** Legal exposure goes from company-ending to ordinary. The product stops looking
like the commodity App Store tier it currently pattern-matches to
[05-market-and-competition.md § Addendum]. And the two changes with the largest expected effect on
actual score gains — adaptive fading and targeted practice — are the cheapest things on the list.

**The honest ceiling, so nobody is surprised later.** A well-executed prep product should aim for
**0.25–0.40 SD, about 2.5–4 LSAT points on average**, near zero for students already at 172+ — and a
retake alone buys 2.4–2.8 points with no product at all
[01-learning-science.md § The honest magnitude; 02-measurement-and-score-prediction.md § 6]. The
defensible claim is not "+3 points." It is that structured, targeted prep gets a student their gain
in one additional sitting instead of three, and shifts the upper tail.

---

## 2. Verifying the 1.5-week framing against the documents

The founder's stated window checks out against the research, in both directions.

**It is well-timed.** The August 2026 LSAT finishes 8 August, four days before launch; roughly 26,000
people walk out of test centres and a meaningful fraction decide within two weeks to retake in
October or November. Score release on 26 August is a second, sharper spike. November is the year's
largest administration at 30,000+, and its cohort has a 13-week study runway from mid-August
[05-market-and-competition.md § 6]. Retakers are also the segment most likely to have exhausted
official PrepTests — the one segment for whom original content is a feature rather than an apology
[05-market-and-competition.md § 3.1, counter-evidence].

**It is too short for three specific things**, and all three are deferred explicitly below:

| Thing | Why it cannot land in 1.5 weeks | Source |
|---|---|---|
| An LSAC content licence | Standard-form contract, security attestation, API integration; estimated weeks to months | `[03 § 4.5]` |
| A replacement item bank | "Nothing in this document ships a replacement bank before launch." MVP week yields 60–100 RC items | `[04 § Cost model]` |
| A 120–180 predicted score | Requires ~400+ users with internal θ *and* verified official scores | `[02 § 5, § What we cannot claim]` |

---

## 3. The decision that gates everything else — the content fork, both branches costed

### 3.1 Why this is not actually a choice about launch

Both branches begin identically, because **Branch B requires Branch A's first two days as a
precondition.** You cannot approach LSAC as a clean prospective licensee while the infringing items
are deployed; in *Chatty Courses* the licence inquiry itself became the willfulness evidence, quoted
paragraph by paragraph in LSAC's complaint, and a cease-and-desist followed 22 days later
[03-content-licensing.md § 7.4]. The correct sequence is takedown, documentation, *then* contact.

So the fork is about **what the product is in weeks 1–8**, not about whether to take the content down.

### 3.2 Branch A — launch without official content (the plan of record)

**What ships:**

- The full engine: sessions, timing, the review queue, the analytics, the LLM coach, the tycoon
  layer, the map, the story. All of this is yours and unencumbered
  [03-content-licensing.md § What I'd do with a 1.5-week runway].
- **A LawHub-companion diagnostic and log.** The student takes an official free LawHub PrepTest
  (LSAC gives four away free: currently PrepTests 140, 141, 157, 158
  [03-content-licensing.md § 5.1]) under timed conditions, and enters *their own results and their
  own written reasoning* into Speedrun. We never touch LSAC's item text. See the design constraint in
  §3.4 — this is the part that is easy to get catastrophically wrong.
- **60–100 original Reading Comprehension items**, built by the five-day RC pipeline
  [04-item-generation.md § Minimum viable version]. RC is the viable track because LSAC itself builds
  RC passages by adapting published third-party work and says so in its disclosure booklets; swapping
  in PMC open-access, US federal works, and CC-BY journals changes the input corpus, not the method
  [04-item-generation.md § The RC shortcut].
- **No original Logical Reasoning at launch.** See §8.1.

**Cost:** roughly $3,500–$4,000 for a 500-item pool, of which ~$3,000 is human review, plus the
engineering already in Phase 0 [04-item-generation.md § Cost model]. The 60–100 item launch slice is
a few hundred dollars of compute and one week of one person.

**What you give up:** launching with 6,886 questions. What you get is a business that survives
diligence [03-content-licensing.md § The one-sentence recommendation].

**Positioning that makes this honest rather than apologetic:** the UWorld/NBME split. Over 90% of US
medical students learn on UWorld's entirely *original* questions and measure on NBME's official ones,
and the community's settled formulation is "trust NBME, calibrate with UWorld"
[05-market-and-competition.md § 4.3]. Official LSAT questions are a finite, spoilable measurement
instrument, and students say so constantly and angrily — *"they are a finite resource"*,
*"compromising the predictive value"* [05-market-and-competition.md § 3.1, counter-evidence]. Nobody
in LSAT prep sells "drill infinitely without burning your PrepTests." That is the page to write.

### 3.3 Branch B — launch with a licence (the six-to-ten-week target)

**What it costs:** $38/student/year Coaching License Fee, $19 for nonprofits offering free prep, plus
processing fees; $5,000/year only if you want real items in public marketing. A pre-revenue launch
could plausibly start under $5,000 all-in; 100 paying students in year one owes LSAC roughly $3,800
[03-content-licensing.md § 4.1, § 4.5]. The student separately holds LawHub Advantage at $124/year,
which one subscription covers across all providers.

**What it requires you to build**, which is why some of it appears in Phase 0 even though the licence
will not have arrived [03-content-licensing.md § 4.4]:

| Licence term | What it forces |
|---|---|
| "maintaining content in a secure, encrypted environment" | Items out of the repo, encrypted at rest, fetched at runtime. **The current plaintext JSONL in `backend/data/question_bank/` would be a material breach on day one.** |
| Items only for students with an active subscription | Per-student entitlement gating on a verified LawHub link; no public demo of real items; no free tier serving official content |
| "prohibited from creating derivative works… must be used verbatim" | The AI layer may *explain* an item; it may never rewrite, simplify, or translate one. Audit `backend/app/coaching.py` against this. |
| "prohibited from replicating or mimicking" the Digital LSAT interface | A visually distinct UI — which a gamified speedrun app satisfies for free |
| Pennsylvania governing law, audit rights, 30-day cure | Non-payment is existential; LSAC sued TestMax, a licensee, over $170,157 |

**Why the licence is very likely obtainable, contrary to the founder's assumption:** LSAC runs a
published-rate program with an email address, not a partnership gate. `ADL2026` — Admit Law, a
platform LSAC's own copy describes as *"drill smarter with licensed practice, analytics, blind
review, pacing tools, and personalized recommendations"* — was onboarded **this year**
[03-content-licensing.md § 4.2]. Lawgic Prep, three Indiana University undergraduates, got one in
February 2026 and sells at $40–60/month [05-market-and-competition.md § 1]. LSAT Demon holds one with
2–10 employees. "Do we have a strong enough case?" is the wrong question; "can we comply and can we
pay?" is the right one [03-content-licensing.md § 4.2].

### 3.4 The design constraint neither memo states, and it is the most dangerous thing in this plan

`03` recommends a "bring-your-own-content / LawHub companion mode" as the bridge
[03-content-licensing.md § What I'd do with a 1.5-week runway]. `03` also documents that Chatty
Courses' app *"did not even host LSAT items itself"* — it said *"[c]opy/paste an LSAT question with
answer here"* — **and LSAC sued for direct infringement plus contributory and vicarious infringement
for inducing users to copy** [03-content-licensing.md § 2.3]. The memo does not connect these two
paragraphs. They must be connected before an engineer builds anything.

**Therefore: the companion mode must be metadata-only.** The student enters PrepTest number, section,
question number, the answer they chose, their confidence, and **their own written reasoning in their
own words**. Speedrun never ingests, stores, transmits, or renders LSAC's item text, and there is no
paste box, no screenshot upload, and no OCR path. Ever.

This has a real product cost, stated honestly: on a LawHub item the coach cannot check the reasoning
*against the stimulus*, so it can only audit the structure of the student's argument — did they
identify a conclusion, is the elimination reasoning valid on its face, is it circular, did they
justify all five choices. Full-fidelity Method Lab works only on items we own. That is a weaker
product and it is the price of not being sued. Put the question of whether even results-import
requires a licence in front of counsel [03-content-licensing.md § 4.6, item 4].

### 3.5 The recommendation

> **Execute Branch A now and Branch B in parallel.** Pull the questions today, ship the engine
> without them on 12 August as a reasoning-feedback and companion product with a small original RC
> bank, and run the LSAC conversation starting Wednesday. Re-price and re-launch to **$49/month**
> when the licence lands [05-market-and-competition.md § Pricing recommendation].
>
> **Correction, made precise:** the market memo's "$49–69 band" and this section's original
> recommendation both turn out to be exactly right, and the unit-economics memo supplies the
> arithmetic neither had: at $19/month, licensed gross margin is 19% (not a viable software margin);
> unlicensed it is 86%. $49/month is not just a competitive-positioning number, it is the price at
> which a licensed product's margin actually clears (~67%), and it is where 7Sage, Lawgic, and LSAT
> Lab already sit. Stay at $19 while unlicensed — do not pre-emptively raise the price for a licence
> that has not landed — and move decisively to $49, not a softer number inside the old band, the day
> it does [08-unit-economics.md].

---

## 4. Phase 0 — before launch (fits nine working days)

Budget assumption: two engineers, nine working days, ~18 engineer-days, plus founder time on the
legal and credibility items. Items are ordered by (score impact × risk reduction) ÷ effort. Items
P0-1 through P0-7 are the line; P0-8 onward are cut candidates if the schedule slips, in reverse
order. **Correction:** P0-1B is a same-week addition surfaced after this plan was drafted — a
privacy/compliance fix cheap enough that it does not change the cut line, but non-negotiable enough
that it is not on it either.

---

### P0-1 · Legal triage
**Effort:** 0.5 engineer-days plus founder time and external counsel. **Do today.**

**What.** In this order:
1. Escalate to `nischayhegde` to make `github.com/nischayhegde/LSATspeedrun` private. It is public
   right now and `raw.githubusercontent.com/.../lsat-lr/train.jsonl` returns **HTTP 200, 4,178,746
   bytes** to an unauthenticated request. This is bulk worldwide redistribution of ~85 complete
   PrepTests in the most reusable possible form. Owner action is required and is outside the
   founder's control — escalate loudly and repeatedly [03-content-licensing.md § 8.5].
2. Remove the items from the deployed database and from `backend/data/question_bank/`.
3. Purge git history with `git filter-repo` or BFG, force-push, and check for forks (0 at time of the
   memo — verify again). Private is the tourniquet; history purging is the cure
   [03-content-licensing.md § 8.5, item 3]. **The purge surface is small and enumerable, not
   open-ended:** exactly **8 tracked files** sit under `backend/data/question_bank/`
   (`README.md`, `manifest.json`, and three JSONL splits each for `lsat-lr` and `lsat-rc`).
   `backend/instance/` — where any local database file would live — is already gitignored, so **no
   database snapshot has ever been committed**; the history-rewrite target is those 8 files and
   nothing else.
4. Record timestamps of every removal step.
5. Book 1–2 hours of IP counsel (~$500–$1,500) on: disclosure strategy, the CLA, and whether the
   product name creates Lanham Act exposure [03-content-licensing.md § Disclaimer].
6. **Only then** email `licensing@LSAC.org`. The one-paragraph template is at
   [03-content-licensing.md § 7.5]. Do not describe prior use without counsel.

**Why.** LSAC pleaded personal liability against the last solo developer, "the moving, active,
conscious force," with alter-ego veil-piercing in the alternative; an LLC is not a shield. Statutory
damages run to $150,000 per work willful, and even the conservative per-PrepTest reading is
company-ending [03-content-licensing.md § 8.1, § 8.2]. The repository's own
`backend/data/question_bank/README.md` already documents awareness of the rights problem, which means
the "we had no idea" posture is unavailable and every additional day raises the cost
[03-content-licensing.md § 8.5, item 4].

**Files.** `backend/data/question_bank/`, `backend/app/seed.py` (the Hugging Face ingest at
`seed.py:23`, and `seed.py:229` which stamps `license_status = "upstream_terms_apply"`),
`backend/app/models.py:78`.

**⚠ Engineering hazard, verified in the schema.** `session_items.question_id`
(`backend/app/models.py:130`) is a plain foreign key to `questions.id` with **no** `ondelete` clause,
while `question_choices.question_id` (`:90`) and `review_queue_items.question_id` (`:455`) are
`ON DELETE CASCADE`. A naive `DELETE FROM questions` will therefore error on `session_items`, and
"fixing" it by forcing a cascade would destroy the entire response history. **The response records
are yours, they are not LSAC's expression, and they are the only calibration data you have.** Delete
the *content* columns and rows (`passages`, `questions`, `question_choices`) while preserving
`session_items` and `attempts` with their question IDs as opaque strings. Migrate
`session_items.question_id` to nullable or drop the constraint before deleting.

**How you know it worked.** `curl` against the raw GitHub URL returns 404. The deployed app serves
zero LSAC-derived items. `git log --all -- backend/data/question_bank` returns nothing. The removal
timeline exists as a dated document. A reply from `licensing@LSAC.org` with the CLA and a timeline.

---

### P0-1B · Two fixes surfaced after this plan was drafted
**Effort:** ~0.5–1 engineer-day total, plus signing a vendor agreement. **This week — not deferred.**

**Correction, not part of the original synthesis.** Both items below were found by reading the code
against research written after `00` was first drafted, and neither appears anywhere above.

**(a) The LLM coaching path has no contracted provider on the other end.** `backend/app/coaching.py`
posts every student's written reasoning to `TFY_URL`, and the only concrete URL for that gateway
anywhere in this repository resolves to `trilogy.truefoundry.cloud` — an AI-gateway tenant belonging
to **Trilogy, an unrelated company**, not an account this business holds. There is no data processing
agreement, no contract with the underlying model provider on the last hop, and no
logging-suppression header, so the default configuration on someone else's tenant likely retains a
copy of every answer a paying student writes [09-privacy-and-compliance.md § 7, risk R1]. This is
the single highest-expected-cost privacy risk in the memo ($25k–$150k) and one of the cheapest to
fix, and it is a hard blocker on writing an honest privacy policy — you cannot name a subprocessor
you have no contract with, and every AI-related sentence in that policy is currently
unsubstantiable. **Fix:** open a direct, billed account with a provider you hold the contract for;
sign a DPA with zero-data-retention terms; send the logging-off header
(`X-TFY-LOGGING-CONFIG: {"enabled": false}` or the gateway-appropriate equivalent) regardless; update
the credentials in `coaching.py` and the SQS/Lambda re-invocation path in `jobs.py`
(`process_ai_job`). **This is not a cost problem** — see the pricing correction in §10 item 3 — it is
a contracts-and-logging problem, and it is unrelated to which model tier is configured.

**(b) An N+1 query runs thousands of times per session creation.** `_seen_question_ids(user_id)`
(`backend/app/services.py:315`) issues a database query, and it is called **inside** the list
comprehension at `services.py:339` — once per eligible question, not once per session. Verified by
execution: on the current bank this runs **6,886 times** to build a single practice session. This is
worse than the "O(N)" framing it originally got in §5 item 3 below, and cheap enough (hoist the call
outside the loop; call it once) that it belongs in Phase 0 rather than waiting for the Phase 1 KC
routing rewrite that was going to touch this function anyway.

**Files.** `backend/app/coaching.py`, `backend/app/jobs.py`, `backend/app/services.py:315-341`.

**How you know it worked.** The outbound host in `coaching.py` is an account you hold a contract for,
not `trilogy.truefoundry.cloud`. The privacy policy names a specific subprocessor. A query-count
assertion or a debug-toolbar check on session creation shows one call to `_seen_question_ids`, not
one per candidate question.

---

### P0-2 · Compute the reference distribution before you purge
**Effort:** 1 engineer-day. **Must happen before P0-1 step 2, and cannot be recovered afterwards.**

**What.** Over the existing 6,886 items, compute and store as a JSON artefact: stimulus word-count
distribution by question type; answer-choice length distributions and coefficient of variation;
key-is-longest rate; quantifier distribution by choice position; the full stem-phrasing inventory;
and blind-solve rate on a 100-item sample using a four-model solver panel with the stimulus withheld
[04-item-generation.md § Track B step 0; § Quality bar and how to measure it].

**Why.** These statistics are the acceptance thresholds for every original item the company will ever
write, and `04` is emphatic that thresholds must be **relative to the real-item distribution, never
absolute**: its fixed joint gate rejected 67% of *genuine LSAC items*, and the real-item blind-solve
median was 0.25 with a tail to 1.0, so an absolute gate at 0.5 discards a third of the real test
[04-item-generation.md § Quality bar]. The memo says so directly: the existing bank "is a *measuring
instrument* even if it is not shippable content" [04-item-generation.md § Track B step 0].

**The contradiction this resolves.** `04` wants the bank retained as a reference corpus; `03` says
"retaining the 6,886 items to train on is itself a reproduction" and the acquisition prong is where
these cases go badly for defendants [03-content-licensing.md § 6.5]. Neither memo notices the other.
**Resolution: extract the statistics, then destroy the corpus.** Summary statistics over a corpus are
facts and unprotectable; the corpus is expression. Run this Monday, purge Tuesday. Note the
contamination caveat from `04`: frontier models have memorised public PrepTests, which inflates the
real-item blind-solve baseline and makes the gate more lenient than it should be.

**Files.** New: `backend/scripts/reference_distribution.py`. Output committed as a small JSON file —
statistics only, no item text, not one stimulus, not one answer choice.

**How you know it worked.** A committed JSON artefact with per-type distributions, and a written
threshold table derived from it. Re-running the giveaway harness on 100 held-out real items
reproduces the stated percentiles.

---

### P0-3 · Item metadata schema and the QC gate for everything that comes next
**Effort:** 1.5 engineer-days.

**What.** Three schema changes and one gate in `backend/app/models.py`:
1. `Question.difficulty` (`models.py:72`, currently `nullable=False, default=3`) becomes **nullable**,
   with a separate `difficulty_source` enum of `predicted | field_tested | unknown`. Never again
   default a difficulty. Add `p_value` and `point_biserial` as nullable floats, populated post-launch.
2. `Question.question_type` (`models.py:71`) gets a controlled vocabulary and a `NOT NULL` check
   against it. The audit found **46% of items lacked a real question type**; no item enters the new
   bank without one [06-current-app-audit.md § ranked gaps].
3. Provenance columns: `source_corpus`, `source_url`, `source_license`, `retrieval_date`,
   `generation_pipeline_version`, `reviewer_id`, `review_date`. The licence position becomes a
   database field rather than a memory [04-item-generation.md § The RC shortcut, operational
   requirements].
4. The eight-gate acceptance battery from [04-item-generation.md § Quality bar and how to measure it]
   runs in CI over any candidate item file, and a failing item cannot be seeded.

**Why.** Every targeting, adaptivity and IRT recommendation in `02` is blocked on real item metadata
— this is contradiction #3, adjudicated in §8.3. And the *specific* failure mode that destroyed the
commodity app tier's reputation is not unofficial provenance, it is wrong answer keys, mismatched
explanations, scrambled passages, and typos on the first screen
[05-market-and-competition.md § Addendum]. That is a solvable engineering problem, and solving it
visibly is the entire path out of that tier.

**Files.** `backend/app/models.py:65-96`, `backend/app/seed.py`, new
`backend/scripts/item_gates.py`, plus a CI step.

**How you know it worked.** Seeding a deliberately broken item (key is the longest choice; explanation
attached to the wrong question; a typo) fails CI with a named gate. No item in the database has a
non-null difficulty without a `difficulty_source`.

---

### P0-4 · Focus Mode — one onboarding question, two defaults
**Effort:** 2 engineer-days. **Highest score-impact-per-hour item on the list.**

**What.** Add one question to onboarding: *"What's your target score, and when's your test?"*
Anyone answering **168+** or **test in under 8 weeks** is defaulted into **Focus Mode**: practice
engine, ability estimate, review queue, Method Lab — no office, no visible economy, no story
surfacing. Everyone else gets the full game. A permanent, visible toggle sits in the header, and
switching is one click in either direction.

Underneath the same switch, gate strategy-prompt exposure on per-student, per-question-type mastery:
a student at 90% accuracy on Flaw questions never sees the Flaw strategy card again.

**Why.** Two independent lines of evidence converge, which is why they merge into one mechanism
rather than two features (contradiction #4, §8.4). The 2025 expertise-reversal meta-analysis finds
high-assistance instruction helps novices at *d* ≈ +0.51 and **harms** more knowledgeable learners at
*d* ≈ −0.43 — a ~0.9 SD swing — and the app currently surfaces a strategy on roughly every fourth
eligible question regardless of level [01-learning-science.md § Top 12 #1; `strategies.py:311-312`].
Adaptive fading beat fixed fading beat no fading head-to-head. Separately, the market memo calls the
one-question/two-defaults change *"the highest-leverage change in this entire document relative to
effort"* [05-market-and-competition.md § Positioning recommendation, item 1]. And the backlash
literature names **transparency and control** as the antidotes to feeling manipulated — a student who
can switch the economy off will not resent it, and most will not switch it off
[05-market-and-competition.md § 4.2, The Brand Shield].

Note the target-score question is also required instrumentation for any readiness claim
[02-measurement-and-score-prediction.md:1005].

**Files.** `frontend/src/pages.tsx` (onboarding; the firm-name required field at `pages.tsx:548`
should become optional in Focus Mode), `frontend/src/components.tsx:121-127` (nav items — office,
firm, map hidden in Focus Mode), `components.tsx:558-559` (the existing `compactReview` and
`learningOnly` flags are already the right seam — this is why the change is cheap),
`backend/app/services.py:116-138` (`serialize_user` / `next_route`, which currently forces
onboarding), `backend/app/strategies.py:259-312`.

**How you know it worked.** A user answering "175, in 5 weeks" lands on the practice dashboard with no
3D asset loaded. Toggle round-trips without data loss. Strategy-prompt exposure rate for a
high-mastery type drops to zero in logs. Instrument: sign-up → first-session-completion and 14-day
retention, split by self-reported target score, because `01` is explicit that the register question
cannot be answered from the literature and must be A/B'd [01-learning-science.md § Top 12 #12].

---

### P0-5 · Fix the reward contingency
**Effort:** 1.5 engineer-days.

**What.** Three changes to the economy, none of which remove it:
1. **Case fees stop paying per question answered.** They pay at *session boundaries* on
   performance events: accuracy against the student's own recent baseline, calibration improvement,
   review-queue items graduated, and mastery milestones. Pay approximately zero for easy correct
   answers; scale with item difficulty and Method Lab quality
   [05-market-and-competition.md § Specific mechanics, liabilities].
2. **Public competitive leaderboards default off**, or become personal-best boards.
3. **An economy explainer and a global off switch** in settings, showing exactly how fees are
   computed.

**Why.** The reward-contingency numbers are unusually specific: engagement-contingent rewards
*d* = −0.42, **completion-contingent *d* = −0.48** (the worst available, and per-question fees are
exactly this), performance-contingent *d* = −0.24, unexpected rewards *d* = −0.04, and
**informational positive feedback *d* = +0.33 — the only reward type that reliably raises intrinsic
motivation** [01-learning-science.md § Top 12 #5]. Across 87 papers reporting undesired gamification
effects, the most-implicated elements are badges, leaderboards, competitions and points, with
"Loss of Performance" the most frequent negative outcome and leaderboards the most-implicated element
[05-market-and-competition.md § 4.2]. And "gaming the system" is the named ethical failure: a currency
farmable by grinding easy questions *is* the Gartner failure mode
[05-market-and-competition.md § 4.2, Gartner].

The market evidence points the same way from the other side. 7Sage's users' *only* complaint about
streaks was that **the streak was too easy to earn** — this audience punishes unearned reward, not
reward [05-market-and-competition.md § 3.2]. The Demon Rating is beloved precisely because it is "an
ability estimate wearing a game costume" that cannot be farmed.

**Files.** `backend/app/game.py` (settlement and client contracts), `backend/app/models.py:352-411`
(`AttemptSettlement`, `LedgerEntry`), `backend/app/services.py:972-1080` (`submit_attempt`, which is
where settlement currently fires).

**How you know it worked.** A session of 40 easy questions answered correctly pays materially less
than a session of 12 hard ones. The ledger shows zero per-question entries. The economy explainer
exists and the off switch persists.

---

### P0-6 · Method Lab — keep the feature, retire the claim, and fix the estimator first
**Effort:** 1.5 engineer-days for the string/threshold work below, **plus a ~2-hour fix that comes
first** (see Correction, immediately below).

**Correction — a selection-bias bug that outranks the sample-size problem.** Reading the code against
research written after this plan was drafted surfaced something the sample-size critique below does
not cover: the estimator is **biased, not merely imprecise**, and more sample would not fix it. Both
call sites filter the treatment arm on `strategy_applied` —
`strategy_performance` (`strategies.py:443`) and the bandit's own posterior in `assign_strategy_trial`
(`strategies.py:319`) — and `strategy_applied` is **self-reported by the student after seeing the
prompt**, not assigned by randomization. The contrast actually being computed is "students who saw a
strategy and chose to use it" versus "everyone in control," which selects on exactly the kind of
question-recognition and confidence that predicts a correct answer anyway. This biases the reported
lift **and** the bandit's allocation in an unknown direction — a student might reach for a strategy
when they recognize the pattern (inflating lift) or precisely when stuck (deflating it), and the
memo is explicit that "the estimate is uninterpretable rather than merely noisy"
[11-measurement-implementation-spec.md § 1]. **Fix: intention-to-treat.** Drop the `strategy_applied`
filter from both call sites and compare all assigned `prompt` against all assigned `control`,
regardless of whether the student reported using it. Keep recording `strategy_applied` — it becomes a
compliance rate ("you used this on 6 of 9 offers") worth showing on its own, and later feeds a
CACE/instrumental-variable estimate once volume supports it, but it must stop being the treatment
definition. This is a two-line change, it is more urgent than the threshold fix below because it
ships a wrong sign rather than a wide interval, and it should land first.

**What.** Four string changes and one computation change:

| Currently | Replace with |
|---|---|
| `status = "supported"` at ≥8 prompted / ≥4 control (`strategies.py:468`) | `personal_evidence = "insufficient"` — and it stays insufficient essentially forever at individual scale |
| `verdict = "confirmed"` (`strategies.py:382-384`, `:414`) | `"measuring"` / `"experiment running"` for every state — drop the binary entirely |
| `"{subject} is helping you."` (`strategies.py:385`) | `"So far you're at {accuracy}% with it and {control_accuracy}% without."` |
| "An approach is only called confirmed after at least eight questions with it and four without" (`strategies.py:528`) | "We show your running totals. Telling a real effect from luck takes far more questions than a single person usually answers, so we report the counts rather than a verdict." |
| A per-strategy "lift" percentage with decimals (`strategies.py:409`) | **Correction:** raw fractions, not a percentage — `"9/14 with · 5/11 without"` — and only introduce a percentage once both arms exceed ~30 observations. A control sample of 4 can only produce accuracy values of 0/25/50/75/100%, so any decimal-place lift is fiction at this N; fractions are honest at every sample size and a reader seeing `3/4` intuits the uncertainty that `75%` conceals [11-measurement-implementation-spec.md § 3] |

Backend: log the **assignment propensity** on every observation (see P0-8), and compute the pooled
estimate from `correct ~ strategy + (1|student) + (1|item) + (strategy|student)` once N allows,
**using intention-to-treat groups, not the `strategy_applied`-filtered ones**. Pre-launch, the model
is not needed — the labels are.

**Why.** The power analysis is unambiguous. At 8 vs. 4 with a realistic +5-point effect, power is
**5.3%**, indistinguishable from the 5% false-positive rate; the minimum detectable effect at 80%
power is **84 percentage points**, which from a 60% baseline is outside the range of possible values
[02-measurement-and-score-prediction.md § 9, Result 1]. Observed accuracy at n=8 can take nine values
and at n=4 five values, so the lift is quantized in 12.5–25 point jumps and "any decimal place in that
number is fiction" [§ 9, Result 2]. With twelve strategies uncorrected, the chance of at least one
spurious "supported" is **46%** [§ 9, Result 3]. A realistic +3-point effect needs ~11,000
observations; the current thresholds are off by **20× to 900×** [§ 9, Result 4]. And the bandit
invalidates the inference *in kind*, not just in degree: adaptive allocation biases arm means, and a
continuously-updating maturity label is textbook peeking [§ 9, Result 6].

The fix is to change the estimand, not the threshold [§ 9, Result 5]. And doing so converts the
product's single most gimmick-shaped feature into its most rigorous-looking one — the market memo's
exact words [05-market-and-competition.md § Specific mechanics, last bullet]. r/LSAT's word "gimmick"
means a *named, proprietary, sold shortcut*; an honestly-reported experiment is the opposite of that
[05-market-and-competition.md § 3.2].

**Files.** `backend/app/strategies.py:314-321` (bandit selection bias, **fix first**), `:427-445`
(analysis selection bias, **fix first**), `:326-353` (bandit posterior), `:382-414` (verdict),
`:460-470` (status), `:528` (user copy), `frontend/src/components.tsx`.

**How you know it worked.** Grep for `strategy_applied` in `strategies.py:319` and `:443` finds no
filter on it in the analysis or the bandit query — only in the separately-displayed compliance rate.
Grep for `confirmed` and `supported` returns only comments. No number with a decimal place is shown
for a per-student lift below ~30 observations per arm; fractions are shown instead. The word
"experiment" or "measuring" appears in the UI where "confirmed" used to.

---

### P0-7 · Honest banded reporting, and delete the numbers you cannot defend
**Effort:** 2 engineer-days.

**What.**
1. Report **a percentile band against the Speedrun user population plus a descriptive range**, never
   a bare number, and **name the norm group in the same sentence every time**:
   *"Your current estimate places you around the 62nd percentile of Speedrun users who have completed
   50+ items, in a range of roughly the 52nd–72nd. Based on 118 clean items over the last 4 weeks."*
   [02-measurement-and-score-prediction.md § What to compute and show, item 1]
2. **Make the band narrow visibly as evidence accumulates.** `02` calls this "probably the single best
   UX idea in this document" — it is simultaneously honest and the best engagement mechanic available
   [§ 10].
3. **Gate any change statement on the Minimal Detectable Change**, using MDC₈₀ for formative feedback
   and labelling the confidence level. Never show "you improved" below it
   [§ What to compute and show, item 4].
4. **Score each RC passage as one polytomous testlet**, not as k independent items. Treating them as
   independent systematically overstates precision [§ 1, testlet study; § Core model].
5. **Retire or relabel the `speedrun_index`** (`services.py:1274`). It mixes an ability estimate, a
   speed estimate and an unvalidated LLM judgment under arbitrary weights and has no standard error.
   Keep it as a product metric if it is useful; never present it as a measurement
   [§ What we cannot claim].
6. **Replace the hardcoded evidence-class thresholds** (10/30/80 attempts, `services.py:1284`) and the
   readiness gate (40 LR + 20 RC + 1 diagnostic, `services.py:1345-1350`) with computed SE(θ). The
   existing thresholds are "in the right ballpark by luck"; the gate lands at roughly ±7.5 points
   well-targeted or ±11 poorly targeted, which is "defensible as a threshold for showing a *range*,
   and nowhere near enough to show a point score" [§ Item counts required for each claim].
7. Keep `projection_available: False` (`services.py:1337-1338`) and **strengthen the note to explain
   why.** The app's current refusal is not excessive caution, it is the technically correct position
   [§ What we cannot claim].

**Why.** The official LSAT's own SEM is ~2.6 points and LSAC never reports a bare point estimate to
score users — it bands every score and explains the band in plain language. Banding is *conformity
with the sponsor's own reporting standard*, not an admission of weakness, and can be said in exactly
those words [02-measurement-and-score-prediction.md § 10]. Standard 6.10 of the 2014 *Standards for
Educational and Psychological Testing* expects score reports to include measurement error — that is
the citation to point at when someone argues bands are too discouraging [§ 11]. And honest
uncertainty is unclaimed white space: every competitor reports a point estimate, and this audience is
by construction good at logic and allergic to overclaiming [05-market-and-competition.md § 8, item 4].

**Files.** `backend/app/services.py:1241-1390` (`performance_snapshot`), `:1271-1278` (deltas),
`:1284`, `:1293`, `:1337-1350`, `:1361`; `frontend/src/pages.tsx`, `frontend/src/components.tsx`.

**How you know it worked.** No screen displays an unbanded ability number. Five think-alouds asking
users what the band means produce correct readings — that is the professional standard for score
report validation and it is one week of normal product research [§ What to compute and show].

---

### P0-8 · The four unrecoverable logs
**Effort:** 2 engineer-days. See §7 for the full list and the rationale; it is called out separately
because the cost of missing it is asymmetric.

---

### P0-9 · Original RC seed bank, 60–100 items
**Effort:** 5 days of one person, running in parallel from Day 1.

**What.** Execute [04-item-generation.md § Minimum viable version] verbatim, with one required
change to Day 2/4 from the correction below: Day 1 reference distribution (already P0-2); Day 2
structural filters plus the giveaway harness, calibrated on 100 real items, **using the inverted
distractor-construction order** (write five equally-plausible, mutually-exclusive claims about the
passage *before* deciding which one the passage actually supports, rather than writing the correct
answer first and inventing distractors around it); Day 3 pull 200 PMC `oa_comm` articles and adapt 20
passages with the n-gram and faithfulness checks; Day 4 generate ~120 questions with that construction
order and run the full gate battery, including a blind-solve check scored **against the real-LSAT-RC
baseline of 61.9%, not against zero or near-chance**; Day 5 the blind discrimination study — 20
generated and 20 real items, unlabelled, to 5 tutors.

**Correction — RC generation is not safe by default, and this plan's premise that it is needed a
fix.** `04-item-generation.md` argued RC was structurally safer than LR because "the passage must be
read." That hypothesis was tested and **failed**: first-attempt generated RC items scored **91.3%
blind-solvable** by a four-model panel with the passage withheld — indistinguishable from LR's ~90%
failure rate, because it turns out **real LSAT RC itself is 61.9% blind-solvable**, so "near chance"
was never the right bar for either track [10-rc-pipeline-spec.md]. The fix that makes RC viable is the
construction-order change folded into Day 2/4 above: writing five equiplausible claims before picking
the correct answer dropped blind-solve to **56.6%**, statistically indistinguishable from real LSAT
(z = −0.51) and a large, significant improvement over the naive order (z = 4.58). **This result rests
on only 34 items and is not yet confirmed at scale** — run the $4, 200-item confirmation described in
[10-rc-pipeline-spec.md § Recommended next step] **before** committing meaningful reviewer hours to
any bank larger than this 60–100-item launch slice; if it does not reproduce the 56.6% figure, the
larger bank is void regardless of budget already spent on generation. **Separately, on scheduling:**
that same document's measured reviewer-time ledger (~4 min/item, ~39 reviewer-hours for 350 items)
does **not** fit a 1.5-week window with one reviewer; 200 items does, comfortably, with one reviewer,
and 350 needs two. The 60–100-item launch slice below fits easily either way, but if there is any
temptation to stretch the launch bank toward the older "500-item pool" cost estimate in §3.2, that
temptation should be checked against this reviewer-hour ceiling, not against compute cost, which is
negligible (~$0.034/item) [10-rc-pipeline-spec.md § 5].

**Why.** RC is the track that works, for a structural reason: LSAC builds RC passages by adapting
published third-party work and says so in its own disclosure booklets, naming *Scientific American*,
UC Press and the *Melbourne University Law Review*. Substituting `oa_comm`, US federal works and CC-BY
journals changes the input corpus, not the method [04-item-generation.md § The RC shortcut]. Grounding
in real scholarship removes the invention step that produced every LR failure, and one passage
amortises across 5–8 questions. Projected yield 50–70% versus 8% measured for LR — flagged in the
memo as a projection, not a measurement. That legal/structural argument is independent of the
blind-solve correction above: adapting real scholarship is *why RC is legally safer to write*; the
inverted construction order is *why RC items are hard enough to be worth writing at all*. Both are
now required, not just the first.

**Corpora, in build order:** PMC Open Access `oa_comm` (CC BY / CC0 by construction), US federal works
(17 U.S.C. §105), DOAJ filtered to CC BY 4.0, Project Gutenberg with branding stripped. **Excluded:**
Wikipedia (ShareAlike is incompatible with a proprietary bank) and arXiv by default. Note that NLM's
FTP→Cloud migration lands this month, so build against the Cloud Service.

**Non-negotiable operational requirements**, which are also the legal defence: store licence, source
URL, retrieval date and attribution per passage; carry an "Adapted from…" line exactly as LSAC does;
enforce an automated check that no >12-word span survives from the source; run a faithfulness check so
the adaptation does not misattribute claims to real researchers.

**How you know it worked.** Tutors classify generated versus real at near 50%. If they classify at
80%, the "what tipped you off" answers are your defect list — a few hundred dollars for the single
highest-value evaluation available [04-item-generation.md § The quality bar]. **And, per the
correction above:** the blind-solve panel scores the launch batch in the high-50s/low-60s percent
range, not near-zero and not near-90% — either extreme means the construction-order fix was not
actually applied, not that the bar was wrong.

---

### P0-10 · The credibility surface
**Effort:** 2 engineer-days plus founder time. Mostly copy, and it is the cheapest trust available.

Ordered by trust-gained ÷ work, from [05-market-and-competition.md § Credibility checklist]:

1. **A named 99th-percentile human on the content.** Every credibility signal in test prep is
   person-level — Demon is Ben Olson and Nathan Fox, 7Sage is J.Y. Ping, PowerScore is Dave Killoran,
   Lawgic is three named students with faces on LinkedIn. *"A product with no named human behind the
   content has no credibility anchor at all, and that is currently our position."* Contract one 175+
   scorer as named content reviewer. (`05` says this is "fixable in a week." My inference: that is
   optimistic for hiring, but a *contract* review engagement genuinely is a week.)
2. **A provenance page** stating how items are generated, who reviews them, how many stages, the
   rejection rate, how difficulty is calibrated, and how errors get fixed. Silence here is read as an
   admission.
3. **The UWorld/NBME framing page** — *"Practice here. Measure on LawHub."* This converts the
   licensing gap from an apology into a thesis, and on the merits it is correct
   [05-market-and-competition.md § 4.3].
4. **A free, ungated, honestly-banded diagnostic** as the front door, encountered **before any game
   element**. See §8.1 for how this works with no item bank.
5. **Blind Review, by that name.** Free credibility; its absence is conspicuous to anyone who has read
   7Sage's canonical article, which is everyone [05-market-and-competition.md § 3.3].
6. **A fee-waiver tier** — $1/month or free for LSAC fee-waiver holders. Every serious competitor has
   one, it costs nearly nothing, and it is precisely on LSAC's stated mission, which matters for the
   licence conversation too [03-content-licensing.md § 7.3].
7. **A visible "report this question" button with a published median fix time.** No commodity app does
   this because none of them have anyone home [05-market-and-competition.md § Addendum].
8. **The honest paragraph about the game**, written and published rather than hidden:
   > *"Yes, there's a game. In the only randomized trial comparing gamified to non-gamified delivery
   > of identical material, learning was identical but willingness to keep going was d = 1.39 higher.
   > We're not claiming the office teaches you logic. We're claiming it gets you to question 3,000
   > instead of question 900."*
   That is Loewen et al. (2018), n=64 randomized [05-market-and-competition.md § 4.1], and it is a
   pre-written defence against the PowerScore attack (*"no cartoons or cheesy animations"*,
   [05-market-and-competition.md § 1]).

**Also: the brand.** Keep "Speedrun" as the company name with a permanent explanatory subtitle —
*"Speedrunners don't rush. They understand the system so well that speed is a side effect"* — which
aligns the name with Nathan Fox's doctrine rather than against it
[05-market-and-competition.md § Positioning recommendation]. But **drop "LSAT" from the brand lockup,
the domain and any app-store name**, using it only descriptively ("prep for the LSAT"). "LSAT" is a
registered, incontestable mark; trademark infringement is a *separate claim that survives even if you
removed every question*, and renaming is rated 🟢 effective and cheap for exactly that claim
[03-content-licensing.md § 8.1, § 8.4]. Nominative fair use permits truthful reference, not brand use.
This merges the two memos' recommendations rather than choosing between them; get counsel's read.

---

### P0-11 · Default landing surface and performance budget
**Effort:** 0.5 engineer-days. Cut candidate, but very cheap.

Default post-login view is the practice dashboard with the ability band and the review queue. The 3D
office is one click away and labelled as the reward. Set a hard load-time and memory budget for the
WebGL layer, guarantee the practice engine works with 3D entirely disabled, and never let a game asset
block a question from rendering. Set `muted: true` as the sound default (`frontend/src/sound.tsx:112`
currently `false`).

**Why.** LSATMax's reputation was destroyed by sync failures and slow support, not by its teaching:
*"For a high-stakes-test audience, a bug is a credibility event, not an inconvenience"*
[05-market-and-competition.md § 1, LSATMax]. And the first three seconds assign the product to a
category, which determines whether anything else gets read
[05-market-and-competition.md § Specific mechanics].

`frontend/src/art/map-three-scene.tsx` (3,789 lines) and `frontend/src/art/office-three.tsx` (2,681
lines) are the largest surfaces in the codebase and the largest reliability risk.

---

### Phase 0 schedule

| Day | Work |
|---|---|
| 0 (today) | P0-2 reference distribution starts. Escalate repo visibility. Book counsel. |
| 1 | P0-2 completes → **P0-1 purge**. **P0-1B: cut the LLM gateway over to a contracted account; fix the N+1 query.** P0-9 RC pipeline starts in parallel. |
| 2 | Email LSAC. P0-3 schema. P0-8 instrumentation starts. |
| 3–4 | P0-4 Focus Mode. P0-5 reward contingency. RC pipeline days 2–3. |
| 5–6 | P0-6 Method Lab relabel. P0-7 banded reporting. RC pipeline days 4–5, blind study out. |
| 7–8 | P0-10 credibility surface. P0-11 defaults. Integration and QC pass over the RC bank. |
| 9 | Freeze, full manual QC of every shipping item, launch. |

---

## 5. Phase 1 — the following month

Same format, less detail, because Phase 0's outcomes will reorder these.

**1. The hierarchical Bayesian measurement model.** One Rasch model with fixed guessing `c = 0.20`,
item difficulty nested in question type, fit nightly in batch via Stan/PyMC. 3PL is off the table —
guessing parameters can fail to estimate even at N = 2,000. Run a parameter-recovery check on
simulated data before wiring any output to the UI; unidentified models return plausible-looking
numbers and those numbers get shown to users. Exclude `spaced_review` responses on previously-seen
items and sub-threshold rapid guesses from estimation, using the existing `evidence_class` tags
(`services.py:27-33`) as the inclusion filter — the audit calls this machinery possibly the
best-designed thing in the system, and it needs wiring, not building
[02-measurement-and-score-prediction.md § Core model, § 6]. **~5 days.**

**2. The anchor set and fixed-parameter calibration.** 25–40 items at 2:1 LR:RC that every user sees,
embedded invisibly in normal practice, driven to 400+ responses each; after that new items join the
scale at ~250 responses via FIPC with the MWU-MEM variant, which is worth as much as doubling the user
base and costs about a day. The binding constraint is anchor quality, not new-item sample size
[02-measurement-and-score-prediction.md § 13, :1007]. **~4 days.**

**3. Knowledge-component taxonomy and targeted routing.** Across 1.3M observations students vary
enormously in *initial* performance (~55% vs ~75%) but are "astonishingly similar" in learning rate
(~+2.5 percentage points per opportunity, median ~7 opportunities to 80% mastery). Since rate is
constant and starting point is not, **essentially all the leverage in a practice product is in
targeting** [01-learning-science.md § Top 12 #3]. Replace `select_random_questions`
(`services.py:327-341`) with KC-weighted selection. Note the open question honestly: whether LSAT
reasoning decomposes into clean knowledge components is untested and is "the single most valuable
thing this product could discover from its own data" [01-learning-science.md § Open questions #1].
**~6 days.** *(The `_seen_question_ids` query at `services.py:315-341` was originally flagged here as
an "O(N)" cleanup; it turned out to be worse — an N+1 pattern verified to run 6,886 times per session
creation — and has been promoted to P0-1B.)*

**4. Confidence-weighted review ordering and latency-driven scheduling.** Rank the review queue by
confidence-weighted error rather than oldest-due-first (`services.py:397-408`): errors committed with
high confidence are corrected more readily and durably, so a confidently-wrong answer is the cheapest
point on the board [01-learning-science.md § Top 12 #8]. Then feed per-item latency into the schedule,
replacing the fixed `REVIEW_INTERVAL_DAYS = (1, 3, 7, 21)` (`services.py:34`) — response-time-based
sequencing beat fixed expanding intervals in adults in real classrooms, with transfer to an
independent standardized assessment months later [01-learning-science.md § Top 12 #9]. Build #8 before
#9; adapting difficulty and scaffolding outperforms adapting spacing. **~4 days.**

**5. Targeted rather than universal written explanation.** `services.py:500` hardcodes
`requires_reasoning=True`. Time-equated studies repeatedly fail to show a self-explanation advantage
over simply doing more problems, and explaining a *possibly wrong* choice before feedback can be
actively harmful. Require full written reasoning on ~25–40% of items — wrong answers, high-confidence
errors, weak types, first exposure — and use a short structured template (conclusion / premises / the
gap / why the trap is tempting) elsewhere. **Stated honestly: the 25–40% figure is the researcher's
extrapolation, not a finding, and Pan & Rickard credit elaborated retrieval with +*d* = 0.23, so the
answer is emphatically not "drop explanations"** [01-learning-science.md § Top 12 #2, § Open questions
#2]. Randomize 100% / 40% / 0% within a fixed weekly time budget and measure unassisted timed section
score at four weeks. **~3 days.**

**6. Pooled strategy model with IPW.** Fit `correct ~ strategy + (1|student) + (1|item) +
(strategy|student)` with inverse-propensity weighting from the propensities logged in P0-8, and use an
always-valid confidence sequence if the label must update live. 3,900 observations ≈ 130 users × 30
items for a +5-point effect — reachable [02-measurement-and-score-prediction.md § 9, Results 4–6].
**~4 days.**

**7. Cut the strategy library from ~14 to 5–7.** The best network meta-analysis on reading-strategy
instruction found more strategies did not mean better outcomes, and near transfer fails when
strategies are learned as surface procedures. Reframe each around argument structure rather than
question-stem keywords — the current `_candidate_keys` matching is literally keyword-based
(`strategies.py:259-300`), and `comparative_matrix` is unreachable (`strategies.py:265`)
[01-learning-science.md § Top 12 #10]. **~2 days.**

**8. RC at scale plus the first LR research spike.** 250+ passage sets, ~1,500 questions, one
contracted reviewer on the LSAC hiring profile (philosophy/linguistics graduate training, not "LSAT
tutor"). Begin LR few-shot iteration as a *research programme*, not a delivery
[04-item-generation.md § Full version, phases 2–3]. **Ongoing.**

**9. Licence-readiness engineering.** Encrypted-at-rest content storage outside the repo, fetched at
runtime; per-student entitlement gating scaffolded against a LawHub link; a rendering path that treats
item text as immutable; an audit of `coaching.py` confirming it explains rather than rewrites. Doing
this now makes signing a switch-flip [03-content-licensing.md § Days 6–10]. **~5 days.**

**10. Two full-length simulations, and the 35-minute section as the recurring unit.** Not "as many
full tests as possible": the best available numbers give +25.7 / +19.8 / +15.9 points for the first,
second and third full-length practice tests with returns clearly flattening, while ~20-minute blocks
of sustained effortful thinking 1–3× weekly cut within-test performance decline by 22%, persisting 3–5
months [01-learning-science.md § Top 12 #6]. Sprint's 10 questions is far too short to train endurance.
Also: report each student's within-test decline curve from a single 35-minute section and prescribe
stamina work only to students who demonstrably decline — no competitor reports this and it costs one
analysis on data you already collect [01-learning-science.md § Top 12 #11]. **~3 days.**

**11. Move the coaching model off the synchronous critical path.** `coaching.py:80` makes a
synchronous frontier-model call with a 120-second timeout, with `AI_JOBS_MODE` defaulting to `"sync"`
(`backend/app/__init__.py:111`) and `reasoning_effort` at `"xhigh"` (`:110`). This is a reliability
risk of exactly the class that killed LSATMax. **Correction:** it is not, as this document originally
speculated, a cost problem — `08-unit-economics.md` has since priced the current configuration at
$1.29/user-month, 6.8% of a $19 subscription, which is not a margin threat (§10, item 3). Do this for
reliability and latency, not to save money, and do not use it as a pretext to downgrade `xhigh` on
Method Lab's core loop. **~2 days.**

**12. Credibility artefacts that need elapsed time.** Real unedited score reports with permission,
collected from day one; a score-increase guarantee structured on Blueprint's *mechanism* (completion
requirement, minimum subscription length, diagnostic floor) but without its
exclusions-designed-never-to-pay — neither 7Sage nor Demon offers one
[05-market-and-competition.md § 5]. **Founder time.**

---

## 6. Phase 2 — deferred, with the trigger that promotes each

Nothing here should be started before its trigger fires. That is the point of the section.

| Deferred item | Trigger | Source |
|---|---|---|
| **A 120–180 predicted scaled score** | ~400+ users with an internal θ *and* a **verified** (not self-reported) official LSAT score, plus linking error propagated into the band. Below ~100 pairs the identity function beats equating — converting would *add* error | `[02 § 5, § What we cannot claim]` |
| **Adaptive diagnostic (MST/CAT)** | Anchor items at 400+ responses each and a stable calibration. A 1-2-2 panel with true-score routing is a few hundred lines and cuts the diagnostic from 75 items to ~30 at equal precision — but it is worthless on an uncalibrated bank | `[02 § 4, § Build order "Later"]` |
| **LR item generation at production scale** | Offline yield moves from the measured 8% to ≥25% on the full gate battery, *and* the blind discrimination study returns near-chance classification on LR specifically | `[04 § Honest verdict]` |
| **Publishing A/B results** | Pooled observations clear the pre-registered threshold (~3,900 for a +5-point effect) under an always-valid procedure | `[02 § 9; 05 § Credibility checklist 10]` |
| **A formal efficacy study** | 200–300 users with 3–6 measurement occasions each, spread over ≥4 weeks. Spacing buys more slope precision than frequency | `[02 § 6]` |
| **Nonprofit / $19-rate track** | Only if a genuinely free access-focused offering exists under a separate entity | `[03 § 4.6]` |
| **Price increase to $49/month** | An executed LSAC content licence — at that point the increase is not optional, since licensed margin at $19 is 19% versus 86% unlicensed | `[05 § Pricing recommendation; 08-unit-economics.md]` |
| **Tiered pricing** | Never at launch. Lawgic is already winning the argument out loud against tiers | `[05 § Pricing recommendation, item 7]` |
| **ESSA / AERO impact certification** | Institutional buyers. Explicitly a dead end for a consumer launch | `[05 § 5]` |

---

## 7. Instrumentation to start logging immediately

Called out separately because **items 1–4 are unrecoverable retroactively** — if they are not logged
from the first user, no amount of later engineering recovers them
[02-measurement-and-score-prediction.md:1003-1015]. Ordered by cost of not having it.

**1. Verified official LSAT scores, with administration date.** The single highest-value data asset
the product can accumulate and the only path to a defensible scaled score. Store score, date, attempt
number, and **whether verified or self-reported — never mix them**; Duolingo found self-reported
scores biased enough to need an explicit correction. Offer a real incentive for uploading a score
report. Also capture **target score and planned test date** (P0-4 already collects these), which are
required for any readiness claim. There is currently no public rigorous quantification of the
practice-to-official relationship anywhere — collecting this gives you data nobody has published
[02-measurement-and-score-prediction.md:1005, § 7]. **Correction — this does not need a consent gate
to proceed, and do not let it become one.** A verified LSAT score is not "special category" data
under GDPR Article 9 and not "sensitive personal information" under any US state privacy statute
currently in force; no statute compels opt-in consent for collecting it, though a real, versioned
consent flow is still worth building for commercial and FTC-deception reasons, not sensitive-data
ones [09-privacy-and-compliance.md § 6]. Relatedly, **FERPA does not apply anywhere in this product**
— there is no institutional relationship for it to attach to, and this should be stated definitively
in any privacy policy or diligence answer, not hedged [09-privacy-and-compliance.md § 4]. The one
field in the schema that *is* genuinely sensitive is adjacent, not this one:
`StudySession.accommodation_multiplier` (`models.py:108`) is constrained to `{1.0, 1.5, 2.0}` —
exactly LSAC's own extended-time accommodation tiers — so a user who selects 1.5× or 2× is, in the
overwhelming majority of cases, disclosing a disability-based accommodation. Never send it to the LLM
gateway (it currently is not), never copy it onto a score record, and disclose it in the privacy
policy as accommodation-related timing data [09-privacy-and-compliance.md § 6.3].

**2. Assignment propensity on every bandit observation.** The arm, the propensity, the randomization
seed, and the experiment version. Without stored propensities, adaptive-allocation bias is *not
correctable afterwards*, and the entire Method Lab inference stays broken permanently
[02-measurement-and-score-prediction.md:1006, § 9 Result 6].

**3. A designated calibration anchor set.** 25–40 items at ~2:1 LR:RC that every user sees, embedded
invisibly in normal practice. Without a common anchor, users who practised different item mixes are
**not on a common scale and are not comparable to each other at all** — a defect the current
accuracy-over-whatever-you-saw metric has right now. Protect it: never retire it, never let it leak,
never let generated variants contaminate it [02-measurement-and-score-prediction.md:1007].

**4. A randomized exposure slice.** Reserve 10–15% of item serving to be genuinely random. Under
adaptive selection, naive item-difficulty estimates are **structurally biased and do not improve with
more data** [02-measurement-and-score-prediction.md:1008, § 3].

The rest, recoverable but expensive to backfill:

**5. Per-item response time as a start/stop event model** — time to first interaction, time to first
selection, number of answer changes, and **idle/blur detection**. Without idle detection a user who
walks away mid-item poisons the timing data. Log milliseconds; analyse on the log scale. Note that
`submit_attempt` currently clamps elapsed time (`services.py:1034`) — clamping is fine for display,
but **store the raw value too**.

**6. Item exposure counts and per-item response history**, so each item's calibration maturity is
known: 50 responses → ±1 logit, 150–250 → ±½ logit.

**7. Item content features for cold-start difficulty prediction** — question type, stimulus word
count, choice lengths, negation and quantifier presence, readability, passage subject and length, plus
an LLM difficulty estimate. Cheap once, and it seeds priors for every new item.

**8. Confidence ratings on a consistent scale, with the item, every time.** Log the raw rating, not a
derived bucket. Calibration needs several hundred rated items before it is stable, so do not ship a
"calibration score" as a personal trait.

**9. Session context** — mode, device, time of day, session position (item 1 vs item 40, for fatigue),
whether coaching was shown before the response, and whether the item had been seen before.

**10. Model version and parameter snapshots at display time** — θ, SE, model version, and the item set
it came from. When the model changes, you must be able to explain why a user's number moved.

**11. A frozen holdout of responses** never used in calibration, for honest out-of-sample evaluation.
Report AUC pooled *and* averaged by question type; the two can differ dramatically and reporting only
the first hides failures on rare types.

---

## 8. Contradictions resolved

### 8.1 What actually ships in 1.5 weeks without a legal question bank

**The four memos are not actually in conflict once you separate learning from measurement and LR from
RC.** They only look contradictory because each answers a different sub-question.

- Licensing says pull the items and ship the engine, and that a licence will not arrive in 1.5 weeks
  [03 § 4.5, § What I'd do with a 1.5-week runway].
- Market says students accept original content for *learning* and demand official content for
  *measurement* — the UWorld/NBME split, settled in medicine for twenty years
  [05 § 4.3].
- Item generation says LR generation empirically fails (**19 of 24 items solved by all four frontier
  models with the stimulus entirely removed**) while RC is viable, and that at $38/student licensing
  beats generation at this scale [04 § Honest verdict, § Cost model].

**Resolution — one shippable answer:**

> Ship the engine with **zero LSAC items**, an **RC-only original bank of 60–100 items** used strictly
> for *learning*, and a **metadata-only LawHub companion** used strictly for *measurement*. Write no
> original LR at all before launch. Run licensing in parallel and re-launch with official content in
> six to ten weeks.

The three sub-answers that make this work:

**(a) Learning versus measurement is the axis, and it dissolves the market objection.** r/LSAT's
official-only norm has an explicit carve-out that the memo flags as "the most important clause in this
document": *"The only non-authentic LSAT stuff that can be helpful is some of the stuff written to be
drills to help you develop targeted skills"* [05 § 3.1]. Original *drills* are permitted by the norm;
original *simulated tests* are not. Position accordingly and never claim our items measure anything.

**(b) LR gets no original items because bad LR is worse than no LR.** This is the strongest reason to
hold the line under launch pressure: *"A badly-calibrated item bank is not merely useless; it teaches
the wrong reflexes"* — a 170-scorer will notice that the hedged answer is always right, will *learn*
that heuristic, and it will fail them on the real test [04 § Honest verdict]. Repairing the leak made
things worse, not better: fixing giveaway drove critic-flagged multiple-defensible-answers from 8% to
63% [04 § Track B step 6]. Shipping LR now is the one decision that could produce an r/LSAT thread
that ends the company. **Correction: RC was not automatically exempt from this same failure mode.**
The original argument for RC's safety here was legal/structural (adapting real scholarship), and a
later test of the *quality* axis found first-attempt generated RC scored 91.3% blind-solvable — as
bad as LR — because real LSAT RC itself is 61.9% blind-solvable, not near-zero. RC only clears the bar
after inverting the distractor-construction order, which is now a required step in P0-9, not an
optional refinement [10-rc-pipeline-spec.md].

**(c) The diagnostic problem nobody noticed, and its fix.** Every memo recommends the free diagnostic
as the front door [05 § 5, § Credibility checklist 4]. **With the bank gone, the 75-item diagnostic
has no items**, and the RC seed bank is RC-only while a diagnostic needs 2:1 LR. This collision is not
addressed anywhere in the six documents. My resolution: **the launch diagnostic is a protocol, not a
question set.** We instruct the student to take one of LSAC's four free official PrepTests in LawHub
under strict timed conditions — which is r/LSAT's own canonical, copy-pasted first instruction to
every newcomer [05 § 5, Free diagnostic] — and they enter section-level results and per-question
metadata into Speedrun, which does the analysis: the banded estimate, the within-test decline curve,
the weakness ranking, and the study prescription. This costs no content, is legally clean under the
metadata-only constraint in §3.4, is culturally *more* aligned than a proprietary diagnostic would be,
and is genuinely better measurement because the items are real and equated. `pages.tsx:65` currently
hardcodes `api.startDiagnostic(1)`; that path becomes the protocol flow.

### 8.2 Method Lab — unique white space and statistically indefensible, simultaneously

Both are true and they are not in tension, because the market values the *mechanic* and the
measurement critique attacks the *claim*.

**Keep:** the forced written justification before the answer is revealed, the silent 25% control, the
LLM critique. This is the closest thing in the market to *"argue with a human teacher,"* the community's
top scorers invented it independently in Word documents, and the only existing way to buy it is
tutoring at $150–220/hour [05 § 8, § 3.3]. LSAT Lab — the competitor closest to our positioning, with
official content, named founders teaching live, and a published guarantee — still has nothing that
evaluates the student's own reasoning [05 § Addendum].

**What the UI should say instead of "confirmed":**
- Never the word "confirmed" or "supported." Say **"Experiment running"**, and for the personal panel:
  *"We don't have enough of your data to tell whether this helps you specifically — and honestly, we
  probably never will, because a personal verdict needs thousands of questions. Here's what it does
  across all Speedrun users."*
- No decimal places on any personal lift. The observed statistic moves in 12.5–25 point jumps
  [02 § 9 Result 2].
- One honest sentence about the method, which is also the marketing: *"We test our own advice against
  a silent control and publish what we find, including 'no difference.'"* No competitor does this
  [05 § Credibility checklist 10].

**What the backend should compute:** the pooled fixed effect of strategy from
`correct ~ strategy + (1|student) + (1|item) + (strategy|student)`, IPW-weighted using logged
propensities, with an always-valid confidence sequence if the label updates live; and per student, a
*shrunken random slope* that will correctly sit near the population mean for nearly everyone. This is
also a better product: a new user gets a useful recommendation on day one from the pooled effect
instead of waiting for twelve personal observations that would tell them nothing [02 § 9 Result 5].
**Correction — this pooled model must be fit on intention-to-treat groups.** Both call sites building
the treatment contrast today additionally filter on `strategy_applied`, a self-reported,
post-randomization variable (`strategies.py:443`, `:319`) — a bug independent of and more urgent than
the sample-size problem, since it biases the estimate in an unknown direction rather than merely
widening it. Drop that filter before any pooled fit is wired up, pre-launch, as a ~2-hour fix
[11-measurement-implementation-spec.md § 1]. See P0-6.

**One addition the memos do not make, worth a Phase 1 spike.** `01` notes that if a strategy genuinely
works for a student, the signature is not a gentle slope change but a **detectable breakpoint** in
that student's accuracy/latency curve, and that piecewise-power-law breakpoint models are far more
sensitive than mean comparison — on data you already have
[01-learning-science.md § Section 12, Donner & Hardy; § Open questions #4]. If a per-student verdict is
ever going to be possible, that is the route, not more observations.

### 8.3 `difficulty = 3` everywhere and 46% untyped — sequencing the dependency

**Say it plainly: until item metadata exists, the following are impossible, not merely degraded.**

| Blocked | Why |
|---|---|
| IRT calibration and θ estimation | Nothing to calibrate against; difficulty is a constant |
| Adaptive item selection / CAT / MST | Selection requires an information function over difficulty |
| "Questions barely above your ceiling" — the most-praised mechanic in the market `[05 § 3.6]` | Same |
| Type-targeted drilling and KC routing | 46% of items have no usable type |
| Any p-value or point-biserial gate | Requires per-item response statistics |
| A defensible readiness gate | Currently counts items rather than information |

**But note what the takedown does to this problem: it mostly dissolves it, and that is the sequencing
insight.** The 6,886 unusable-metadata items are being deleted anyway. The dependency therefore
converts from "backfill 6,886 rows" into "**never let an item into the new bank without metadata**,"
which is P0-3 and costs 1.5 days instead of weeks. The one thing that must happen before deletion is
P0-2, because the reference distribution is computable only while the corpus exists.

**Correct order, and nothing skips ahead:**

1. Reference distribution (P0-2, Day 0) → 2. Schema and gates (P0-3, Day 2) → 3. Items enter with
type, provenance and predicted difficulty (P0-9 and Phase 1) → 4. Field data accumulates; anchor items
reach 400+ responses (Phase 1) → 5. Hierarchical Rasch fit gives *empirical* difficulty and SE(θ)
(Phase 1) → 6. Adaptive selection, MST, and a readiness gate based on information (Phase 2).

Two honest notes. First, predicted difficulty is not empirical difficulty — label it
`difficulty_source = predicted` and never let it masquerade otherwise; only real response data solves
calibration [04 § Full version, phase 5]. Second, the type breakdown that survives is **coaching
narrative, not measurement**: a model ignoring the skill taxonomy predicted as well as one using it,
and the product should be internally clear about that even while showing it to users
[02 § What we can and cannot claim].

### 8.4 Expertise reversal and Focus Mode — confirmed, and merged into one mechanism

**They converge, and they should be one mechanism, not two features.** Both say the same thing:
scaffolding should be a function of demonstrated competence.

- Learning science: high-assistance instruction helps novices at *d* ≈ +0.51 and **harms** more
  knowledgeable learners at *d* ≈ −0.43; adaptive fading beat fixed fading beat no fading; the app
  currently prompts uniformly on ~1 in 4 eligible questions [01 § Top 12 #1; `strategies.py:311-312`].
- Market: route 168+ scorers into a stripped-down Focus Mode; one onboarding question, two defaults
  [05 § Positioning recommendation].

**The merged mechanism, which is P0-4.** A single `assistance_level` derived from two inputs and
exposed as one user-facing switch:

- **Declared intent** (target score, test date) sets the *initial* level. 168+ or under eight weeks
  starts at minimum assistance. This is the market's lever and it works on day one, before any data
  exists — which matters, because the cold-start problem is real.
- **Demonstrated per-type mastery** moves it thereafter, per type, automatically. This is learning
  science's lever and it is strictly better once data exists.
- **The user can override in either direction, always visibly.** Transparency and control are the
  named antidotes to gamification backlash [05 § 4.2].

One switch controls: strategy-prompt frequency, worked-example presence, whether written reasoning is
required, whether the tycoon chrome renders, and whether the office is in the nav. The existing
`learningOnly` and `compactReview` flags at `components.tsx:558-559` are already this seam, which is
why the whole thing is two days rather than two weeks.

**One caution the market memo does not raise.** A user's *declared* target score is not their ability.
A 150-scorer who declares 175 would be defaulted into minimum assistance, which is precisely the
population the expertise-reversal literature says needs scaffolding most. Gate the automatic fading on
*demonstrated* mastery only, and treat the declared target as an initial UI preference that the mastery
signal overrides within the first session or two. This is my inference, not a finding, but it is a
cheap guard against a foreseeable failure.

### 8.5 Gamification — one verdict

**Verdict: the game layer is not the problem, the reward contingency and the ordering are. Keep the
game, rewire the currency, re-label the claim, and never let the game be the first thing a skeptic
sees.**

The two memos disagree less than they appear to. `01` targets the *contingency* (per-question fees,
*d* = −0.48) and `05` targets the *category signal*. Both are right, and neither says remove the game.

**Keep, and make more prominent:**
- A visible ability rating that rises only by answering harder questions correctly. The Demon Rating
  is the single most-praised gamified element in the entire market corpus because it is "an ability
  estimate wearing a game costume" that cannot be farmed. **Re-tie firm-tier progression to
  demonstrated ability rather than accumulated earnings — the highest-leverage change available on
  the game layer** [05 § Specific mechanics, assets].
- Adaptive difficulty just above the ceiling. The most-praised mechanic in the market, and nobody
  calls it a game mechanic.
- Streaks, with streak freezes, earned by real work rather than by logging in.
- Story quests, *when each quest is a study prescription*. "Complete 40 necessary-assumption questions
  at 4-star difficulty" wearing a narrative costume is fine; "talk to the rival partner" is not.
- The 3D office and cosmetics as a pure reward sink, visibly downstream of work.
- Milestone celebration. Free dopamine, zero credibility cost.

**Reframe:**
- The named strategies: from "strategies we recommend" to "an experiment we are running on your
  behalf, with a silent control, whose results we publish including nulls." Same code, different
  words, and it converts the most gimmick-shaped feature into the most rigorous-looking one
  [05 § Specific mechanics].
- The game's justification: **motivation and dosage, never pedagogy.** Sketchy can claim its cartoons
  *are* the mechanism because the Method of Loci is real and citable. A law-office tycoon game has no
  such mechanism, and claiming one would be the fastest way to lose this audience. Say instead that it
  gets you to question 3,000 instead of question 900, and cite Loewen *d* = 1.39
  [05 § 4.3, Sketchy; § 4.1].

**Remove, gate, or default off:**
- **Per-question case fees.** The single worst-designed incentive available, wired to the core loop
  [01 § Top 12 #5].
- **Public competitive leaderboards.** The most-implicated element in the negative-effects literature,
  in a demographic documented as prone to fusing self-worth to rank. Default off, or personal-best
  only.
- **Moral choices, rival firms, hidden RPG stats** (`models.py:281-284`: Ethics, Heat, Influence,
  Intel) and the opposing-counsel taunts (`components.tsx:818-828`). Keep them, bury them behind the
  story entrance, and never surface them on the dashboard, in onboarding, or in marketing. These are
  the parts a skeptical reviewer screenshots.
- **The 3D office as the default landing surface** (P0-11).

**And the one sentence to internalize, which is the market memo's central risk claim:**
*"Gamification is a credibility amplifier, not a credibility cost. It amplifies whatever verdict the
user has already formed about the content."* Next to official licensed questions and a named expert,
the game reads as delightful. Next to unlabelled AI-generated questions and no named author, the same
game becomes *the evidence* that the content is unserious. **Gamification plus unofficial questions is
much more dangerous than either alone** [05 § 3.2, § The gamification verdict]. That is why P0-10's
named reviewer and provenance page are not cosmetic — they are what make P0-5's game layer survivable.

**Two bonus adjudications**, since they came up while resolving the five:

**The reference-distribution paradox** (§8.3, P0-2): `04` wants the bank retained as a measuring
instrument; `03` says retention is itself reproduction. Compute the statistics Monday, purge Tuesday.

**The name:** `03` says renaming to remove "LSAT" is effective and cheap for the trademark claims;
`05` says keep "Speedrun" with an explanatory subtitle. These are compatible because they concern
different words. Keep "Speedrun" as the brand with the subtitle; drop "LSAT" from the brand lockup,
domain and store listing; use "LSAT" only descriptively [03 § 8.4; 05 § Positioning recommendation].

---

## 9. Explicitly not doing, and why

This section exists to prevent relitigating. Each line is ruled out by research, not by taste.

**Content and legal**

- **Paraphrasing or AI-rewriting the LSAC items.** Derivative works are reserved to the owner; LSAC
  pleaded derivative-work infringement and won; the test is substantial similarity of protected
  expression, not literal identity; and *"the more useful your paraphrase, the more infringing it
  is."* An AI-paraphrasing pipeline is arguably **worse than doing nothing** because it documents
  copying-then-altering, which reads as consciousness of guilt [03 § 2.5].
- **Waiting for copyright to expire or hunting public-domain LSAT items.** The oldest item in the bank
  is protected until **2086**; the theoretical earliest date any LSAT content could fall out of
  copyright is 2044, and only for the 1948 administration [03 § 3].
- **Harvesting LSAC's four free PrepTests.** LawHub's Terms prohibit downloading, storing, framing and
  deep-linking, and accepting them converts a pure copyright case into a **breach of contract** case
  with a Bucks County, Pennsylvania forum selection clause — which is how a California defendant ended
  up litigating in E.D. Pa. [03 § 5.2].
- **Any "paste your LSAT question here" or screenshot-upload flow.** That is the Chatty Courses fact
  pattern precisely, and LSAC pleaded contributory and vicarious infringement for inducing users to
  copy [03 § 2.3]. See §3.4.
- **Training or fine-tuning a generator on the LSAC corpus.** Retaining the items to train on is
  itself a reproduction, the 2025 AI fair-use cases turned heavily on the lawfulness of *acquiring*
  the copies, and neither blesses distributing substantially similar outputs [03 § 6.5].
- **Relying on the upstream "MIT" tag.** `tasksource/lsat-lr` and `-rc` declare no licence at all, and
  *nemo dat quod non habet*: the AR-LSAT authors held no rights to transfer. It matters only for
  willfulness, and only decreasingly [03 § 2.4].
- **Geo-blocking, disclaimers, or attribution as mitigations.** All rated ineffective [03 § 8.4].

**Product**

- **Original Logical Reasoning items at launch.** 19 of 24 generated items were solved by all four
  frontier models with the stimulus removed; repair drove multiple-defensible-answers from 8% to 63%;
  and a badly-calibrated bank teaches the wrong reflexes [04 § Honest verdict]. Deferred to Phase 2
  behind a measurable trigger.
- **A 120–180 predicted score, by any statistical trick.** Four conditions must hold and none do
  [02 § 5]. Keeping `projection_available: False` is correct.
- **Per-student "supported" strategy verdicts.** Not achievable at any realistic level of engagement,
  ever — 11,000 observations for a realistic effect [02 § 9 Result 5].
- **More named strategies.** More strategies did not mean better outcomes in the best network
  meta-analysis; cut to 5–7 [01 § Top 12 #10].
- **"As many full practice tests as possible."** Returns flatten sharply after two; for several
  subgroups a third produced no more gain than a first [01 § Top 12 #6].
- **Removing the tycoon layer, the office, the map, or the story.** Gamification's cognitive-outcome
  effect survives methodological scrutiny at *g* ≈ 0.49 with higher-education effects among the
  largest; the "adults reject gamified learning" fear is unsupported; Blueprint has charged *above*
  market median for a decade with a playful brand; and 7Sage — the most analytics-serious brand in the
  market — shipped a free game app in 2026 whose users asked for **character progression**, which is
  what this product already has [01 § Top 12 #12, § RIGHT WITH A LARGE ASTERISK;
  05 § 1, § The gamification verdict].
- **Claiming the product improves reasoning ability.** Far transfer from cognitive training is null —
  corrected effect ≈ 0.00 — and this should be scrubbed from any marketing copy that implies it. It
  does not matter, because LSAT prep is a near-transfer problem and near transfer works
  [01 § WRONG: the implicit claim].
- **Elo, Glicko, BKT or Deep Knowledge Tracing.** Bayesian extensions of IRT outperform neural
  networks for proficiency estimation at our scale, and Elo exists to solve a scaling problem we do
  not have [02 § 3].
- **A 3PL model.** Guessing parameters can be inadequately estimated even at N = 2,000 [02 § 2].
- **Pricing tiers at launch, and ESSA certification.** [05 § Pricing recommendation, § 5].
- **A "calibration score" as a personal trait.** Test-retest reliability of metacognitive measures is
  ~0.2 at 250 trials [02 § What we cannot claim].

---

## 10. What I found unconvincing, and what the six documents collectively missed

Reported honestly, because the plan above is only as good as the evidence under it.

**1. The LawHub companion recommendation is unsafe as written, and no memo catches it.** `03`
recommends bring-your-own-content mode two thousand lines after documenting that Chatty Courses' app
*"did not even host LSAT items itself"* and was sued anyway, including for inducing users to copy. A
literal engineer reading § "What I'd do with a 1.5-week runway" would build a paste box. This is the
single most dangerous gap in the research and the reason §3.4 exists.

**2. The reference-distribution paradox.** `04` treats the bank as an essential measuring instrument;
`03` says retaining it is itself infringement. Neither cites the other. The sequencing fix (statistics
Monday, purge Tuesday) is cheap but only if someone notices in time — and after the purge, it is
gone permanently.

**3. Nobody costed the LLM against the price — resolved, and the answer is the opposite of what this
document assumed.** `05` recommends $19/month single tier. `03` prices the licence at
$38/student/year. This document originally reasoned from a three-month subscription of $57 against a
$38 licence and treated the LLM call — synchronous, `reasoning_effort: "xhigh"`,
required on every answer choice — as the unpriced variable that might be eating the difference, and
told the reader to "do that arithmetic before committing to $19." **`08-unit-economics.md` has now
done that arithmetic, and the LLM is not where the money goes.** Actual measured cost is
**$1.29 per user-month** at expected usage (300 graded items/month) on `gpt-5.6-luna`, the cheapest
tier in its model family — **6.8% of a $19 subscription**, not a margin threat, and this is a
~2,000× cost advantage against the $150–220/hour human-tutoring price of the same artifact. **The
actual margin killer is content-licensing amortization, and it is much larger and shaped differently
than assumed:** the $38 LSAC fee is annual and does not refund on churn, so against a realistic
~3-month LSAT-cycle customer it behaves as **$12.67/user-month — 67% of a $19 subscription** before
any other cost. Licensed at $19/month the gross margin is **19%** (not a viable software margin);
unlicensed at $19/month it is **86%** (viable, but it is a materially weaker, unofficial-content
product). **The correction to the plan, not just the diagnosis:** stay at $19/month while unlicensed,
as this plan already recommends, but **re-price to $49/month specifically** — not a vague "$49–69
band" — the moment a licence lands, because $49 is where the unit economics actually clear (~67%
margin licensed) and it is also, not coincidentally, where 7Sage, Lawgic, and LSAT Lab already price
[08-unit-economics.md]. Do **not** gate, downgrade, or ration Method Lab on cost grounds; that would
be optimizing the 6.8% line instead of the 67% one. P1-11 (moving the coach off the synchronous
critical path) remains worth doing, but for **reliability**, not cost — see the correction to that
item below. Note also that Duolingo's premium AI tier reached only 9% of subscribers, described by
management as "below our lofty expectations" [05 § Source log] — LLM features do not automatically
carry pricing power, which is a separate, softer argument from the margin one and still worth keeping
in mind.

**4. The diagnostic has no items after the takedown, and every memo assumes it does.** Addressed in
§8.1(c). It is a straightforward oversight of the interaction between two memos, and it would have
been discovered on Day 8 rather than Day 1 without this synthesis.

**5. There is no definition of launch success anywhere in 7,856 lines.** No target user count, no
conversion assumption, no retention target, no funnel, no cash runway, no CAC. `05` establishes that
the whole US LSAT software market is on the order of **$20–60M/year** and that *"r/LSAT reputation is
not a marketing channel, it is the business"* [05 § 6] — which is a strategy, but it is not a number.
Before 12 August, write down what would make this launch a success, because otherwise Phase 1 will be
prioritized by whoever is loudest.

**6. `01` and `05` disagree about the strength of the seriousness-signalling evidence, and `01` is
more honest about it.** `05` builds a substantial recommendation set on the claim that gamification is
a credibility amplifier; `01` states plainly that the seriousness-signalling literature *"essentially
does not exist in rigorous form"* — the best available is a single-institution self-report survey with
no experimental manipulation [01 § Top 12 #12]. The market memo's evidence is real but it is Reddit
sentiment and competitor behaviour, not experiment. I have kept the register-separation
recommendations because they are cheap and have two independent rationales, but they should be
labelled the weakest-evidenced items in this plan and A/B tested, exactly as `01` says.

**7. "Hire a 99th-percentile reviewer in a week" is underspecified.** `05` calls this fixable in a
week; `04` prices human review at $4–8 per item and notes it is **75–80% of item cost at every scale**,
with LSAC itself hiring philosophy PhDs at $65–80k for the job. Contracting a named reviewer for a
credibility byline in a week is plausible. Contracting one who can actually clear 100 items a week at
LSAC-grade scrutiny is not obviously the same person, and the plan should not assume it is.

**8. Nothing covers the `mobile/` directory, accessibility, or data retention.** There is a `mobile/`
tree in this repository that no memo audits. There is no accessibility review, which matters for a
population that includes accommodated test-takers — a group LSAC itself reports on. And there is no
policy for what happens to a user's response data when they cancel, which is a diligence question the
moment an LSAC contract exists.

**9. The one number I would most like and nobody has.** The practice-to-official relationship has
**never been rigorously quantified in any published source** [02 § 7, § 14]. That is not a failure of
the research; it is a genuine hole in the world's knowledge, and it is the strongest argument for
instrumentation item #1. If this product collects 400+ verified pairs, it will hold data nobody has
published — which is worth more than any feature currently contemplated.

---

## Appendix — source index

| File | What it is load-bearing for in this plan |
|---|---|
| `research/01-learning-science.md` | Adaptive fading (§P0-4), reward contingency (§P0-5), targeting/KC (§P1-3), review ordering (§P1-4), explanation dosage (§P1-5), full-test policy (§P1-10), the honest score-gain ceiling (§1) |
| `research/02-measurement-and-score-prediction.md` | Method Lab statistics (§P0-6, §8.2), banded reporting (§P0-7), all instrumentation (§7), what cannot be claimed (§9), the measurement build order (§P1-1, §P1-2) |
| `research/03-content-licensing.md` | The entire content fork (§3), legal triage (§P0-1), licence-readiness engineering (§P1-9), most of the "not doing" list (§9) |
| `research/04-item-generation.md` | Reference distribution (§P0-2), item gates (§P0-3), the RC bank (§P0-9), the LR deferral (§8.1b) |
| `research/05-market-and-competition.md` | Focus Mode (§P0-4), the gamification verdict (§8.5), the credibility surface (§P0-10), positioning, pricing, launch timing (§2) |
| `research/06-current-app-audit.md` | Every file:line reference in this document; the fifteen ranked gaps; the fifteen things worth protecting |
| `research/08-unit-economics.md` | The pricing correction (§10 item 3, §3.5, §6): LLM inference is not the margin problem ($1.29/user-month); licensing amortization is (19% vs. 86% margin at $19); the $49/month re-price trigger |
| `research/09-privacy-and-compliance.md` | The LLM data-egress fix (§P0-1B); FERPA and sensitive-data conclusions for verified scores (§7 item 1); the `accommodation_multiplier` sensitivity flag (§7 item 1) |
| `research/10-rc-pipeline-spec.md` | The RC blind-solvability correction and construction-order fix (§P0-9, §8.1b); the 200-vs-350-item reviewer-hour scheduling constraint |
| `research/11-measurement-implementation-spec.md` | The Method Lab selection-bias/intention-to-treat fix (§P0-6, §8.2), which outranks the sample-size problem from `02`; the fractions-not-percentage replacement copy |

**Disclaimer.** The legal content in this plan is a synthesis of `research/03-content-licensing.md`,
which is itself explicitly research and not legal advice. Nothing here substitutes for the IP counsel
booked in P0-1.
