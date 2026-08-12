# LSAT Tycoon — Feature Overview

This document is an orientation map of the whole product: what each feature is, why it exists, and how it
connects to everything else. It is written to be read start to finish before presenting the app. Every claim
below was checked against the code, and file and function names are cited so you can jump straight to the
implementation. Where something is ambiguous or half-built, it says so.

---

## 1. What the product is

LSAT Tycoon is an LSAT practice platform wrapped in a persistent lawyer-tycoon game. The learning system is
the real product; the game is retention scaffolding built around it.

The core loop is short and deliberately one-directional:

1. **Answer a real LSAT question.** Correctness is decided by the verified answer key in the database, never by
   a language model.
2. **Get graded on the reasoning, not just the letter.** In the coached mode the learner must write why their
   answer is right; an LLM grades that explanation 0–100 and explains every answer choice.
3. **Earn in-game cash from the quality of the work.** Answer correctness, explanation quality, and pace against
   a per-question target time combine into a 1–20 case score, which drives the payout.
4. **Spend that cash on a law firm.** Desks, staff, connections, rival acquisitions, and 15 escalating
   headquarters — all of which appear in a live 3D office and a 3D career map.
5. **Repeat, with the system deciding what to serve next.** Missed, uncertain, and slow questions come back on a
   spaced schedule; strategy trials measure which LSAT techniques actually work for this specific person.

Three architectural convictions run through the whole codebase and are worth stating out loud, because most of
the design follows from them:

- **The server owns every consequence.** Timing, correctness, rewards, purchases, rent, and reputation are all
  settled server-side. The client renders; it does not decide.
- **Different kinds of evidence are never mixed.** A coached practice answer and a diagnostic answer are stored
  with distinct `evidence_class` values and reported in separate panels. This is why the app can claim
  improvement without fooling itself.
- **The game layer must not be able to distort measurement.** Every practice case now pays, so the containment
  moved rather than disappeared: the diagnostic is the only surface feeding the headline accuracy number, and it
  pays nothing, prompts no strategy, and coaches nothing. Coached practice reports its own accuracy in its own
  panel, where a cash incentive on every question is a stated property of the number rather than a hidden one.

---

## 2. The learning core

### 2.1 Where the questions come from

Every question the app serves comes from two Hugging Face datasets: [`tasksource/lsat-lr`](https://huggingface.co/datasets/tasksource/lsat-lr)
(4,520 Logical Reasoning questions) and [`tasksource/lsat-rc`](https://huggingface.co/datasets/tasksource/lsat-rc)
(2,366 Reading Comprehension questions) — 6,886 questions in total, across the train, validation, and test
splits of both.

An earlier iteration of the project also carried a set of questions OCR'd out of PDF question banks. Those were
deliberately removed for licensing reasons and are not part of the served content. The only question source in
the running product is the two Hugging Face datasets above.

`backend/data/question_bank/` holds a pinned, checksummed snapshot of those datasets: one JSONL file per split
plus a `manifest.json` recording upstream revisions, per-split row counts, and SHA-256 hashes. `seed.py` reads
the snapshot first (`_iter_snapshot_rows`) and only falls back to the Hugging Face Dataset Server
(`_iter_dataset_rows`, with rate-limit backoff) when a split file is missing. That means a fresh clone can seed
the entire question bank offline and get byte-identical content, which matters for reproducing a learner's
history.

`_upsert_row` normalizes each row into the schema: RC contexts become shared `Passage` rows keyed by a hash of
the passage text, so all questions on the same passage point at one passage record; LR contexts are stored
inline as the question's `stimulus`. `_question_type` assigns a human-readable type by regex over the question
stem, since the upstream data has no type labels: ten LR types (Strengthen, Weaken, Assumption, Flaw, Parallel
Reasoning, Inference, Principle, Resolve the Paradox, Main Conclusion, Argument Structure) and five RC types
(Main Point, Author's Perspective, Function, Inference, Analogy), each with a generic fallback when no pattern
matches. That derived type is load-bearing: it drives skill grouping, review reporting, and strategy candidate
selection.

Two honesty flags baked into the data model: every question is stamped `license_status = "upstream_terms_apply"`,
and the upstream dataset cards declare no license. The README says plainly that dataset terms and LSAT content
rights need confirming before publication or commercial use.

### 2.2 How questions are selected

`select_random_questions(count, question_type, user_id)` in `services.py` is the workhorse. It restricts the pool
to seeded Hugging Face questions, optionally filters to one question type (used by the "drill this skill" button
on the progress page), prefers questions the learner has never attempted, and falls back to including seen
questions only if there aren't enough unseen ones. Selection is uniform random within that pool — there is no
difficulty targeting and no adaptive sequencing. That is not an oversight in the selector so much as a
limitation of the data: `seed.py` hard-codes `question.difficulty = 3` for every row because the upstream
datasets carry no difficulty labels.

`select_diagnostic_questions(count)` is a different algorithm because a diagnostic has to look like a test. It
builds three blocks — Logical Reasoning I, Reading Comprehension, Logical Reasoning II — with roughly two-thirds
LR. Crucially, RC questions are selected **by whole passage group**, so a passage always arrives intact with all
of its questions rather than orphaned. It returns the questions, a per-question `section_index`, and a section
plan giving each block a label and a question range. The plan still computes a per-block minute budget (35
minutes for a full-length block of 18+ questions, otherwise about 1.55 minutes per question, floored at 8), but
only to sum it into the form's single clock — `create_diagnostic_session` strips the per-block minutes before
storing the plan, because a mega-litigation is timed as one whole form.

Practice selection is also weighted by the last mega-litigation. `select_random_questions` takes an optional
`focus_types` list and `_weight_toward_focus` pulls roughly `FOCUS_FILL_RATIO` (60%) of the run from those types,
leaving the rest to normal random coverage. It is a bias, not a filter: the whole test still shows up, so one bad
form cannot narrow practice into a self-reinforcing rut.

### 2.3 The practice mode

There is one practice mode plus two assessment stages, which are separate session `mode` values rather than
practice styles:

| Style (API) | UI name | Feedback | Reasoning required | Evidence class | Purpose |
| --- | --- | --- | --- | --- | --- |
| `cases` | Cases | Immediate | **Yes**, 120 characters | `coached_practice` | Written reasoning, full AI coaching, a strategy trial on every question, and game settlement |
| `diagnostic` (mode) | Mega-litigation | Delayed to end | No | `diagnostic` | Sectioned neutral baseline |
| `blind_review` (mode) | Blind review | Delayed to end | No | `blind_review` | Untimed retry of that diagnostic's incorrect answers before answer release |

Every run is the same shape. Due repairs from the spaced-review queue fill up to half the run and occupy the
first positions; unseen questions fill the rest. A `question_type`-filtered run seeds no repairs, because mixing
off-type repairs into a focused drill would defeat the filter the student asked for.
`SessionItem.from_review_queue` records which items were repairs, and that flag — not the session — decides
whether an answer advances a review card or enqueues a new one, which is why one run can now do both.

`create_study_session` enforces one active run per account. It takes a row lock on the player profile
(`lock_user_profile`) as a cross-request mutex, and if a resumable session already exists it returns that
instead of building a new one. This is why the app can always answer "where was I?" — `serialize_user` computes a
`next_route` that sends a returning learner straight back into an unfinished run.

### 2.4 Timing and scoring

Timing is server-authoritative and per question. `SessionItem.target_time_seconds` is set at session creation
from realistic LSAT pacing:

- Logical Reasoning: **150 seconds**.
- Reading Comprehension, first question on a passage: **330 seconds** (it includes reading the passage).
- Reading Comprehension, a consecutive question on the *same* passage: **135 seconds**, because the passage has
  already been read. `_target_time_seconds` looks at the previous item to detect this.
- A mega-litigation is the exception: it is timed as one whole form, so every item's target is simply the form
  budget divided evenly across its questions (floored at 30 seconds). The accommodation multiplier still applies,
  but to the form budget rather than to each item.

The clock starts when the question is first serialized to the client (`serialize_item` sets `timer_started_at`)
and accumulates into `active_elapsed_ms`. Pausing a session banks the elapsed time, clears the running timer, and
sets `timer_compromised = True` on that item — a permanent flag meaning "this item's time can no longer be
trusted." Compromised items earn no time points and are excluded from pace statistics. Submitted elapsed time is
clamped to between 1 second and 15 minutes.

Target time is used in four distinct places, which is worth noticing because it is the connective tissue of the
whole scoring system: time points in the game settlement, the `slow_correct` review trigger, `pace_adherence` in
the performance dashboard, and the pace term in strategy trial scoring.

`submit_attempt` is the single write path for an answer. It is idempotent by an `Idempotency-Key` header, refuses
to accept a new answer while a debrief is pending, verifies the item is the session's current index, requires
written reasoning where the mode demands it, requires a 1–5 confidence rating (default 3), and requires an
explicit strategy decision when a trial is attached. It then determines correctness against the verified key,
updates skill counters, schedules review, advances the session, and — for immediate-feedback modes — parks the
attempt in `pending_attempt_id` so the learner cannot skip past the debrief.

### 2.5 The mega-litigation

The diagnostic exists to give every other number a reference point, and its design is mostly a list of things it
refuses to do. In the game it is called a **mega-litigation**, and every player-facing surface says plainly that
it is basically a full practice LSAT. It is a separate session mode (`mode = "diagnostic"`,
`practice_style = "diagnostic"`), sized by `DIAGNOSTIC_SESSION_SIZE` (default 75 questions), with delayed
feedback, no reasoning requirement, no strategy trials, no case context, and therefore **no cash, no reputation
from settlement, no streak, and no per-answer firm progress**. It is sectioned via the block plan described
above, supports accommodation timing of 1.0×, 1.5×, or 2.0×, and only one can be active at a time.

**One clock, one sitting.** `create_diagnostic_session` stamps a server-authoritative `StudySession.deadline_at`
= now + the summed block budget (about 105 minutes in production). That deadline is the whole timing story: the
per-block minutes are stripped from the stored plan and per-item targets become an even split of the form budget.
`enforce_diagnostic_deadline` runs at every touch point — serialization, the active-session lookup, and
`submit_attempt` — and finalizes an expired run in place, so nothing unanswered is lost and no sweeper job is
needed. There is no pause: `pause_session` and `resume_session` raise `diagnostic_no_pause`, which the API
returns as a 409, and the clock keeps running whether or not the tab is open. The client counts down between
polls purely for display and re-anchors on `remaining_ms` at every refetch.

**Blind review before answer release.** A newly created diagnostic carries `blind_review_required = True`. When
the form closes, `blind_review_status` counts only answered questions that were incorrect; omitted questions are
not presented as mistakes. If there are misses, the result screen becomes an interstitial saying “Time for a
blind review” and `create_blind_review_session` creates one linked `mode = "blind_review"` child containing those
questions in their original order. The child has delayed feedback, no deadline, no reasoning or strategy prompt,
no game context, and compromised timing by construction so however long the learner takes never becomes pace
evidence. Both the diagnostic audit and per-attempt coaching remain sealed until the child is complete. The final
audit then reports the timed diagnostic and untimed blind-review scores side by side, including each original and
revised choice. A perfect form skips the empty stage. The migration opts completed historical forms out while
opting in any form that was still underway at deploy time.

**Clearing it promotes the firm.** `finalize_diagnostic` compares correct answers against
`MEGA_LITIGATION_PROMOTION_ACCURACY` (0.70) of `total_items` — the whole form, not just the answered part, so
answering four questions correctly and walking away qualifies for nothing. Above the bar,
`grant_mega_litigation_promotion` locks the profile, settles upkeep, grants every missing tier-gated asset at
`purchase_price = 0`, raises reputation to the new tier's minimum, bumps `office_tier` by one, and writes a
zero-amount `mega_litigation_promotion` ledger entry. That ledger row is also the idempotency key: the
`uq_ledger_source` constraint means finalization reached twice — once by the last answer, once by the deadline —
pays exactly once. At the top of the ladder it is a no-op.

**What it finds shapes practice.** `focus.py` reads the most recent completed mega-litigation and returns the
question types where the learner scored below their own accuracy on that same form, with at least
`MIN_TYPE_ATTEMPTS` (2) attempts, capped at `MAX_FOCUS_TYPES` (5). Those types feed two places: case-run question
selection weights toward them (§2.2), and `assign_strategy_trial` raises its coverage target from
`BASE_COVERAGE_TRIALS` (3) to `FOCUS_COVERAGE_TRIALS` (5) on them, so the A/B experiment keeps exploring
strategies on weak types after it has settled everywhere else. The dashboard surfaces the list and the sentence
explaining where it came from, so the weighting is never invisible.

Its results appear in `performance_snapshot` as raw correct-out-of-total plus `form_accuracy`, the promotion (if
any), clock usage, and a per-section breakdown, and it carries an explicit `projection_available: false` with the
note that "a scaled score is withheld until the form has a validated conversion." That is a deliberate refusal to
fake a 120–180 score from an unvalidated question set, and it is worth saying out loud when presenting, because
it is the kind of restraint competitors don't show.

**It gates no firm progression.** A mega-litigation can be sat at any time and is never required; nothing in the
firm waits on one. Once a learner chooses to sit one, its own answer release waits on the blind review above. The
diagnostic is still one of three inputs to the
dashboard's `readiness` label, alongside 40 LR and 20 RC first attempts in the timed/diagnostic evidence classes
— but that label only decides whether the dashboard is willing to compare time periods, and the UI presents all
three as recommendations rather than requirements.

### 2.6 Spaced review

`ReviewQueueItem` is the spaced-repetition layer, and its trigger conditions are more interesting than a plain
"wrong answers come back" rule. `_schedule_review` enqueues a question when it was:

- answered incorrectly (`incorrect`), or incorrectly *with* confidence ≥ 4 (`high_confidence_error`, ranked as
  the highest-priority repair, since a confident miss is a broken mental model rather than a gap);
- answered correctly with confidence ≤ 2 (`low_confidence_correct` — a lucky guess is not knowledge);
- answered correctly but slower than the target time (`slow_correct`).

Intervals are 1, 3, 7, and 21 days. A correct answer inside a review session advances the interval; clearing the
last interval marks the card `mastered`. A miss inside review resets the interval to zero, re-codes the reason as
`repeat_error`, and makes it due immediately. Review sessions require written reasoning, and they never carry
strategy trials — repeated items and error-targeted selection would bias any method comparison.

### 2.7 Skill and performance tracking

`performance_snapshot` builds the `/progress` page and is the most opinionated piece of measurement code in the
project. A few decisions to know:

- **One first attempt per question** feeds the headline numbers, so re-answering a memorized review item cannot
  inflate accuracy. Review attempts still appear in their own evidence class.
- **Evidence confidence is labeled, not implied**: `baseline` under 10 attempts, `emerging` under 30,
  `directional` under 80, `stable` beyond that.
- **A composite "Speedrun Index"** blends accuracy (55%), reasoning quality (25%), and pace adherence (20%) into
  a single headline number.
- **Deltas compare the last 20 attempts to the 20 before that**, and are suppressed entirely when there isn't
  enough history to compare.
- **Per-skill priority** ranks question types by a weighted blend of accuracy, reasoning, and pace, and the
  lowest-ranked skill with at least 3 attempts becomes the recommended next focus.
- Results are also broken out by evidence class, by review recovery rate, and by confidence calibration
  (specifically the error rate among high-confidence answers).

One structural note: the `SkillProgress` table is maintained on every attempt by `_update_skill` and receives
explanation scores after coaching, but no API reads it — `/performance` recomputes skill breakdowns from the
`Attempt` rows directly. It is currently a write-only aggregate.

### 2.8 The Daily Docket

`daily_docket_snapshot` derives a two-step daily plan rather than introducing a second mission system with its
own state: **10 cases → Deep Brief**. Due repairs are folded into the cases run rather than being a step of
their own. Each step reports a state (`locked`, `ready`, `active`, `complete`), the whole thing is computed from
sessions completed today in the learner's own timezone, and it exposes a single `next_action` the UI turns into
one button. The Deep Brief step is complete only once the learner has acknowledged the run's review screen
(`summary_seen_at`), which is what keeps "review your mistakes" from being an optional step people skip.

---

## 3. The strategy A/B testing system (the Method Lab)

This is the most conceptually distinctive feature in the product. It lives in `backend/app/strategies.py`, with
its design rationale written up in `docs/LSAT_STRATEGY_EXPERIMENTS.md`.

### 3.1 The claim it makes — and the one it refuses to make

The Method Lab does not claim that a given LSAT technique works. It asks a much narrower and actually testable
question: *for this student, on this family of questions, does a short strategy prompt improve first-attempt
accuracy without an unacceptable pace cost?*

That framing is the whole point. Prep companies sell techniques as universally effective; the evidence for that
is practitioner opinion and anecdote. Comparing one student's prompted work against another student's
unprompted work would confound the method with differences in baseline skill, reading speed, and error habits.
So the app runs a **within-student experiment**: the same learner's prompted attempts are compared against their
own unprompted attempts on the same family of questions.

### 3.2 The fourteen methods

Eight LR methods and six RC methods, each with a one-line prompt, exactly three procedural steps, a "best for"
scope, and citations to LSAC, 7Sage, or PowerScore (surfaced in the UI as real links):

| Key | Method | Section | Best for |
| --- | --- | --- | --- |
| `argument_core` | Argument Core | LR | Flaw, assumption, strengthen, weaken, method |
| `prephrase` | Prephrase Before Choices | LR | Assumption, inference, strengthen, weaken, point-at-issue |
| `negation_test` | Necessary-Assumption Negation | LR | Necessary-assumption questions |
| `causal_audit` | Causal Alternatives Audit | LR | Causal strengthen, weaken, flaw, explain |
| `conditional_chain` | Conditional Chain | LR | Must-be-true, parallel, inference, principle |
| `flaw_abstraction` | Abstract the Flaw | LR | Flaw and parallel-flaw |
| `scope_precision` | Scope and Force Check | LR | Inference, must-be-true, most-strongly-supported, principle |
| `role_map` | Statement Role Map | LR | Method, role, main-conclusion |
| `passage_map` | Low-Resolution Passage Map | RC | All single-passage sets |
| `viewpoint_ledger` | Viewpoint Ledger | RC | Multiple-viewpoint passages |
| `paragraph_function` | Paragraph Function | RC | Organization, purpose, method |
| `textual_proof` | Textual Proof Standard | RC | Detail, inference, application, author-agreement |
| `comparative_matrix` | Comparative Relationship Matrix | RC | Comparative Reading Comprehension |
| `main_point_synthesis` | Main-Point Synthesis | RC | Main point, primary purpose, title, global inference |

Briefs are capped at three steps on purpose: a tutorial that competes with the question for attention is a
distraction, not instruction.

### 3.3 When a trial fires

`assign_strategy_trial(user_id, question, position, *, exposure, focus_types=None)` is called only from the
practice path. Every question in a cases run is trial-eligible. `exposure` is required and
identifies the encounter — the run's own id, in the application — so that a question met again at the same slot
in a later run draws its arm afresh instead of repeating the first one.

The mega-litigation is excluded to keep it a neutral baseline — it is the one surface the dashboard headline
reads. That exclusion used to be a `practice_style == "diagnostic"` guard inside this function; it is now held
where it is true, in that `create_diagnostic_session` and the sectioned-form path build their items without
calling here at all. Everywhere else, the unprompted comparison condition comes from the hidden 25% control arm rather than
from a sparse cadence, which is why prompting every question does not destroy the comparison; it converges it
roughly four times faster.

`focus_types` is what the last mega-litigation found weak (§2.5). A question whose type is on that list raises
the coverage target from `BASE_COVERAGE_TRIALS` (3) to `FOCUS_COVERAGE_TRIALS` (5), so the explore phase runs
longer where the learner is actually losing points and the experiment does not settle prematurely on a weak
type.

The cost is real and worth stating: a prompted item requires an explicit `strategy_applied` decision before the
answer is accepted, so roughly three questions in four carry that extra tap. The decision cannot be defaulted —
`strategy_performance` separates "prompted and used" from "prompted and ignored" using exactly that field.

### 3.4 Choosing candidate methods for a question

`_candidate_keys(question)` narrows the 14 methods to the ones that are actually appropriate, using the
question's section, derived type, stem, and stimulus text. A necessary-assumption negation procedure is never
tested on a main-point question.

For Reading Comprehension it starts from `passage_map` and `textual_proof` and prepends more specific methods
when the signals appear: `comparative_matrix` for comparative sets, `paragraph_function` for purpose/function/
organization language, `main_point_synthesis` for main-point language, and `viewpoint_ledger` when the stem
mentions attitude or viewpoint *or* the passage text contains multi-position markers like "some scholars,"
"critics," or "proponents."

One caveat to know before someone asks: `comparative_matrix` is, in practice, unreachable. Its gate looks for the
string "compar" in the question type or the passage type, but `_question_type` never produces such a label and
`seed.py` stamps every RC passage as `passage_type = "Reading Comprehension"`. The dataset does not mark
comparative passages, so the method sits in the catalog fully written but never assigned. It is safest to say the
catalog holds 14 methods of which 13 can currently be trialed.

For Logical Reasoning it starts from `argument_core` and `prephrase`, then prepends `scope_precision` for
must-be-true and inference language, `negation_test` for genuinely necessary-assumption phrasing, `causal_audit`
when the stimulus contains causal language *and* the task is strengthen/weaken/flaw/explain, `conditional_chain`
when the stimulus contains conditional operators *and* the task rewards diagramming, `flaw_abstraction` for flaw
questions, and `role_map` for role, method, and conclusion questions. The order matters: the most specific
match ends up first, which is what the bandit's ranking then works over.

### 3.5 Coverage first, then exploit

Within the candidate set, assignment has two phases.

**Coverage.** While the least-sampled candidate has fewer than **3** adhered prompted observations, the trial is
assigned to one of the under-sampled methods. You cannot compare methods you have never tried, so early trials
buy breadth rather than chasing an early winner.

**Exploit with exploration.** Once every candidate has at least 3 observations, each is scored on the learner's
own history: a Laplace-smoothed posterior accuracy `(correct + 1) / (n + 2)` weighted **0.76**, the share of
attempts inside target time weighted **0.18**, and a calibration term weighted **0.06**. Accuracy dominates by
design — a method that makes you faster but wrong is not a method. Then **70% of assignments go to the current
leader and 30% to the runner-up.** That 30% exploration rate is what stops the system from locking onto an early
lucky result forever.

Two details make the trials trustworthy. First, prompt-reading time is subtracted from elapsed time before pace
is computed, so a method is never penalized for the seconds spent reading its own brief. Second, assignment is
**deterministic within a run**, seeded on `user_id:question_id:position:session_id` hashed through SHA-256.
Reloading the page cannot reroll into a preferred condition.

The session id in that seed matters more than it looks. Without it the arm was a function of the student, the
question and the slot alone, so a review question returning to the same slot redrew the same arm every time —
the bank-wide control share stayed at a healthy 25% while an individual heavy user's realised share collapsed
toward 2%, and the propensity column went on recording 0.25 for a mechanism whose actual probability was 0 or 1.
See `app/experiments.py`.

### 3.6 The invisible control arm

Roughly **25%** of eligible trials are assigned `variant = "control"` instead of `"prompt"`. A control question is
served completely normally — `serialize_item` only emits `strategy_trial` when the variant is `prompt`, so the
learner sees nothing at all — while the chosen strategy key is still recorded on the attempt.

This is the measurement backbone. Without hidden controls, the comparison would be "prompted questions versus
whatever else happened," polluted by expectancy effects: always announcing that a technique should help changes
behavior. With them, each method has a matched within-student baseline drawn from the same question families at
the same point in the same modes.

When a prompt *is* shown, the learner must choose "Use this brief" or "Solve normally" before the answer inputs
unlock, and that decision is recorded as `strategy_applied` along with a capped (60 s) `strategy_prompt_ms`.
Skipped prompts are counted and reported but excluded from the prompted sample — a brief that was ignored is
evidence about adherence, not about the method. The learner never picks their favorite method from a menu, which
would introduce severe self-selection bias.

### 3.7 Measurement and the evidence gates

`strategy_performance(user_id)` powers the Method Lab panel on `/progress`. For each method it reports the
prompted-and-adhered sample size, the hidden-control sample size, accuracy in each condition, **lift** in
percentage points (prompted accuracy minus control accuracy, and `null` unless both conditions have data),
average prompt-adjusted seconds, pace adherence, and the number of skipped briefs.

Claims are gated behind three labels:

| Status | Threshold |
| --- | --- |
| `forming` | fewer than 4 prompted **or** fewer than 2 control observations |
| `directional` | at least 4 prompted and 2 control, but fewer than 8 prompted or 4 control |
| `supported` | at least 8 prompted and 4 control observations |

Only a `supported` method can be named as the learner's strongest, and the payload ships an `evidence_note`
saying so in plain language. Directional leaders stay visible but are explicitly not presented as winners. This
conservatism is the feature: the app would rather say "still forming" for a while than tell someone a technique
works on four data points.

The honest limits are documented in `docs/LSAT_STRATEGY_EXPERIMENTS.md` and are worth having ready if anyone
pushes: difficulty is only approximately matched (via question type), practice effects and time trends can
affect later observations, adherence is self-reported, a result on one question family should not be
generalized to the whole LSAT, and a supported method can later regress as data arrives.

---

## 4. The AI coaching layer

### 4.1 What the coach does — and cannot do

`backend/app/coaching.py` calls a TrueFoundry-hosted chat-completions endpoint (`TFY_URL` + `TFY_API_KEY`,
model `gpt-5.6-luna` at `xhigh` reasoning effort) and demands one JSON object back. The system prompt is
explicit that the verified answer key has *already* decided correctness and the model must not dispute it. The
coach's job is explanation grading and instruction, nothing else.

A coaching response contains an `explanation_grade` (0–100, or `null` when no reasoning was submitted), a
`reasoning_verdict` from a fixed vocabulary, a one-sentence bottom line, one specific thing the student did
well, a `first_error` diagnosis with a code from a fixed 13-value taxonomy plus a concrete repair step, an
explanation of the credited answer, an explanation of the selected answer, **an explanation for every single
answer choice**, a three-step solution method, a one-line transferable rule, and a two-sentence debrief.

The prompt also specifies exact grading bands — 0–24 Invalid, 25–49 Weak, 50–79 Good, 80–100 Excellent — and
tells the model that a correct answer with guessed or unsound reasoning still earns a low grade. That decoupling
is what makes the game economy reward thinking rather than letter-picking.

### 4.2 Not trusting the model

`_validate_coaching` rejects the response outright if the verdict is outside the allowed set, if the grade is
missing or non-numeric when reasoning was submitted, if answer analysis is absent, or — notably — if **any**
answer choice went unexplained. Every text field is length-capped and stripped of angle brackets. An unknown
first-error code degrades to `other` rather than failing.

Prompt-injection defense is layered: the student's submission is sent as JSON explicitly labeled "data, not
instructions," the system prompt tells the model to ignore every instruction, role request, URL, or command
inside the reasoning text, and the reasoning is treated as untrusted quoted evidence throughout. Because a
learner can type anything into that box and it is fed to a model whose output drives a currency payout, this is
security-relevant rather than cosmetic.

There is a second anti-gaming check in the game layer. `_is_reused_reasoning` normalizes the submitted text and
compares it against the learner's last 50 explanations; an exact repeat is zeroed out, re-verdicted
`unsupported`, and told plainly that recycled reasoning cannot validate a new answer. The coach also receives
the last five explanations as `recent_reasoning_samples` so it can catch generic boilerplate itself.

### 4.3 Sync and async paths

`AI_JOBS_MODE` selects between three execution paths for the same work.

**Sync (`sync`, the production default until a queue is declared).** `POST /v1/attempts/<id>/coaching` calls `run_attempt_coaching`
in-request. That function takes a soft lease — it marks the attempt `processing`, records
`coaching_started_at`, and refuses concurrent duplicate work for 150 seconds — then calls the provider, settles
the game reward, applies the explanation score to skill stats exactly once (guarded by
`explanation_score_applied`), stores the coaching inside `feedback_json`, and recomputes the session summary if
the run has finished.

**Async (`sqs`, production).** The same endpoint instead creates an `AiJob` row with dedup key
`coaching:<attempt_id>`, publishes `{job_id}` to SQS, and returns HTTP 202. `backend/lambda_handler.py` runs
`process_ai_job` in Lambda and reports partial batch failures so a single bad message cannot poison a batch.
Enqueueing is carefully idempotent: an already-completed job is returned as-is, a job under a current 255-second
processing lease is left alone, a queued job without a message ID is re-published, and a stale or failed job is
reclaimed and re-queued (with the attempt counter reset on a previous failure). Jobs retry up to
`AI_JOB_MAX_ATTEMPTS` (default 3), and deterministic errors fail immediately instead of retrying. The client
polls `GET /v1/jobs/<id>` for up to eight minutes.

**Local worker (`local`, the default outside production).** Grading is a 20–30 second frontier-model call, so
running it in-request would hold the learner on the debrief for that long, every case. This mode creates the
same `AiJob` row and returns HTTP 202 immediately, but drains it on a daemon thread inside the process instead
of publishing to SQS — no broker and no second deployment unit. The thread carries out its own retries up to
`AI_JOB_MAX_ATTEMPTS` (nothing else would redeliver the job), and a shutdown mid-grade simply lets the
processing lease expire so the next request for that attempt reclaims it.

Because grading is no longer on the critical path, `POST /v1/study-sessions/<id>/debrief/acknowledge` accepts a
debrief whose grade is still resolving (it returns `settlement_pending: true`) rather than answering
`409 settlement_required`; only a case that was never sent for grading is still refused. Correctness comes from
the verified answer key, not from the coach, so if grading fails terminally `settle_uncoached_attempt` settles
the case from the key alone, marks the write-up ungraded, and the endpoint reports `status: "unavailable"` so
the client stops polling and says so instead of spinning.

Either way the coaching is stored on the attempt, so it is generated once and re-read forever.

### 4.4 How coaching reaches the learner

Coaching is generated **on demand**, not eagerly for every answer, which keeps LLM cost proportional to
attention:

- **Cases** show the full coaching panel after every answer — keep this / fix this first / clean approach, why
  the credited answer wins, why your choice fell short, an expandable audit of all five choices, and the
  one-line rule — and it is also where the case settlement appears. The "Next case" button stays disabled until
  both the coaching and the settlement have arrived, so the learner cannot outrun their own feedback. Because
  every case now settles, that gate applies to the whole app rather than to one mode: a grader outage stops
  forward progress, which is the sharpest operational risk this design carries.
- **The mega-litigation** shows nothing during the run. In the post-run review screen, opening any question
  lazily requests coaching for that specific attempt, so explanations exist for timed work but are only paid for
  when someone actually reads them. If coaching is unavailable the panel degrades to the verified key and the
  choice texts, and says so.

---

## 5. The game layer

`backend/app/game.py` (about 1,670 lines) is the tycoon simulation; `backend/app/story.py` is the narrative
campaign it drives.

### 5.1 Firm tiers

Fifteen headquarters tiers, 0 through 14, from a "Wooden Shack" at $0 to a "Planetary Justice Nexus" at $160B.
Each tier has a name, a cash cost, a reputation requirement, a district name, a signature feature, and a
one-line description. The arc is intentionally silly at the top end — orbital hearing rings and a lunar embassy
of law — because the fiction has to keep escalating for a game that a learner might play for months.

Advancement is strict and sequential. `advance_firm` only ever moves you exactly one tier, and it requires the
reputation threshold, the cash, and — this is the load-bearing rule — ownership of **every** upgrade, staff
member, and rival acquisition below the target tier (`_tier_required_asset_keys`). Connections and cosmetics
never gate a headquarters. This is what stops a player from rushing tiers and skipping the content, and it is
why `_next_milestone` is careful never to advertise a locked headquarters as the next goal: it prefers a
currently affordable required purchase instead.

The 15 tiers are grouped by the 3D map into five career environments (Old Quarter, The Circuit, Treaty Sea,
Sovereign Arc, Global Compact), while each individual tier also carries a finer-grained district name used to
group catalog items.

### 5.2 The asset catalog

107 purchasable assets in five families:

- **35 upgrades** — physical improvements from a repaired oak desk to a justice constellation. These carry the
  payout multipliers, retainer storage hours, streak caps, contract multipliers, and reputation guards.
- **30 staff** — named characters (Maya the paralegal, Theo the junior associate, Nova the chief justice
  strategist) providing flat per-case bonuses, passive hourly income, or payout multipliers.
- **14 connections** — relationship unlocks. Their whole purpose is gating access to client tiers.
- **14 rivals** — acquisitions of competing firms, each giving payout and passive income, and each also being a
  target for the story layer's rival operations.
- **14 cosmetics** — purely decorative. A framed bar certificate, a brass banker's lamp, a Persian rug, a
  leather chesterfield, a grandfather clock, a marble bust of Justice, a stained-glass panel, a living orchid
  wall, and so on.

The cosmetics deserve a moment because they are the one category with *no* mechanical effect whatsoever. They
are deliberately cheaper than the functional asset at the same tier, they never gate a headquarters advance, and
they are excluded (via `UNBALANCED_ASSET_TYPES`) from the economy rebalance that reprices everything else. They
exist so a player can furnish the office to taste — pure expression, and a genuine reward for a learner who has
already bought what they need.

The rest of the catalog is **rebalanced at import time**, which is unusual enough to flag. `_rebalance_asset_catalog`
recomputes every non-cosmetic asset's payout percentage from its tier and original strength, then reprices it in
units of "successful cases": `_case_target_for_tier` derives the expected cash from one solid case at a tier from
the *next* tier's cost, and each asset is priced at 3–5 of those cases. `_rebalance_client_catalog` does the same
for client fees, equalizing expected commercial value across tiers while preserving each client's play style.
Benefit strings are rewritten to match. The upshot: the authored numbers in the source are inputs to a pacing
model, not the numbers the player sees, and a designer can add content without hand-tuning the whole economy.
Pro-bono clients are exempt, because their point is trading cash for standing.

### 5.3 Cash, the ledger, and profile-scoped source IDs

`PlayerProfile` holds the live economic state: cash (as a `BigInteger`, since the endgame is denominated in
hundreds of billions), reputation 0–100, office tier, streaks, lifetime earnings and spending, rent arrears, and
a fractional rent accrual counter.

Every cash movement also writes a `LedgerEntry` with a kind, a source ID, the signed amount, the balance after,
and a JSON detail blob. The table has a unique constraint on `(user_id, kind, source_id)`, which is what makes
each economic event recordable exactly once — you cannot be paid twice for the same attempt, claim the same
daily reward twice, or double-charge the same purchase.

That constraint created a subtle bug worth understanding, because it explains an entire design detail and a
migration. Ledger rows are owned by the *user* so that spending history survives a profile being replaced. But
the events themselves are per-*profile* facts: buying an asset, reaching a tier, or resolving a chapter all
describe one playthrough. Keyed on the bare content key, a replacement profile re-earning the same content would
collide with the old profile's history and the insert would fail. `_scoped_source` fixes this by prefixing every
source ID with the profile ID, and because every write funnels through `_ledger`, the rule is applied in one
place — so a newly added ledger kind cannot reintroduce the collision. Migration `0019_profile_scoped_ledger`
backfills existing rows into the same shape, idempotently, leaving alone the two kinds that were already unique.

### 5.4 How practice performance becomes money

This is the join between the two halves of the product, and it runs through `settle_attempt`.

**Every practice case earns; a mega-litigation answer never does.** `_freeze_current_case` attaches a game
context to an item when the session is a practice session, the item is the currently visible unfinished question,
and the learner has onboarded. Mega-litigation attempts have no game context, so `settle_attempt` returns `None`
for them and they pay nothing. That single exclusion is what protects measurement integrity now: the surface used
as the headline evidence is the one surface with no money riding on it.

The tier promotion in §2.5 is deliberately outside this path. It is granted once by `finalize_diagnostic` against
the whole form, not per answer, so no individual question is ever worth anything — which is the property that
matters. It also pays no cash: it moves the firm and waives the prerequisite upgrades, nothing more.

**The economy is frozen at question-view time.** `snapshot_case_context` captures the client key, base fee, firm
multiplier, staff bonuses, streak cap, contract multiplier, reputation guards, and pro-bono terms into the
session item the moment the question becomes visible. Buying an upgrade mid-question cannot retroactively
increase the fee for a case already in progress.

**The score is 1–20**, computed by `_points`:

- **Answer points:** 4 for correct, 1 for incorrect.
- **Explanation points:** driven by the coach's grade band — for a correct answer, Invalid 0 / Weak 4 / Good 10 /
  Excellent 12. Explanation is the single largest component, which is the whole thesis of the app in one line of
  code.
- **Time points:** up to 4, and only for a correct answer with Good or Excellent reasoning on an uncompromised
  timer. Finishing in under 25% of target earns **zero** time points and caps the total score at 8 — an explicit
  anti-speed-clicking rule.

The score maps through `_score_multiplier` to a payout multiplier from 0.55× to 1.70×, anchored so that a "solid
case" (14–16 points) is 1.20×. Payout is then
`base_fee × score_multiplier × firm_multiplier`, plus a streak bonus (2% per validated case up to a cap that
upgrades raise), plus flat staff bonuses, plus a contract-completion bonus, plus any quest bonus.

**A well-argued miss is not a total loss.** A wrong answer with Good or Excellent reasoning is treated as a
"well-reasoned miss": it earns 15–25% of a normal payout as a consultation fee, keeps partial reputation credit,
and has its reputation drop capped. Careless or unsupported misses earn nothing and take the full hit. A correct
answer remains clearly the most valuable outcome — this just stops a hard question from feeling like pure
punishment for someone who genuinely reasoned well.

**Reputation is a rolling quality average, not a point total.** `_new_reputation` recomputes it from the last 30
settlements' validated credits, double-weighting the most recent 10, and padding toward a provisional value
until 10 observations exist. Per-case drops are capped (reduced further by reputation-guard assets and pro-bono
protections), and a win applies a career floor that rises with lifetime correct and validated cases so a long
good record cannot be destroyed by one bad session.

`AttemptSettlement` records all of this immutably — every input, every component, and the before/after
reputation — one row per attempt, so any payout can be audited and never recomputed.

### 5.5 Clients, contracts, quests, rivals, and verdicts

**69 clients** span institutional tiers (walk-in through planetary assembly), character-driven archetypes
(an accused street magician, a teen hacker facing federal charges, a crypto founder under investigation), and
**10 pro-bono matters**. Clients unlock on reputation, tier, and owned connections — and once signed, a client
stays in your book even if a bad case temporarily lowers reputation, so a loss cannot collapse your fee tier.
Clients carry play-style modifiers: fee premiums, contract-completion multipliers, minimum payout floors that
protect a difficult matter, and reputation guards. Pro-bono clients pay less but grant a reputation bonus on a
win and cap the loss at −0.5, so service-minded play is a real strategy rather than a penalty. The public-charter
story choice amplifies those pro-bono bonuses by 1.5×.

**Contracts** are per-client dockets of 4–15 cases. Only a decisive win advances one; a thoughtful miss leaves
you on the same open matter. Completing a docket pays a bonus and auto-renews, so a player is never stranded
without an available case.

**Story and quests.** Eight chapters, gated by firm tier, each a two-choice permanent decision that moves
`ethics`, `heat`, `influence`, `intel`, cash, and reputation. Nineteen quests sit alongside them, tracked
against real case outcomes — "win 3 cases with Good or Excellent reasoning" is checked against actual
settlements, not a separate counter. Four are hidden "shadow" files that only surface when your ethics fall
below a threshold and your intel rises above one, which is a nice piece of design: the morally dubious content
finds you rather than being offered up front. The final quest, `constellation_charter`, is the game's completion
condition.

**Rival operations** let you make an acquisition cheaper before buying it. Five operations run from clean
(a public case challenge, a documented regulatory complaint) through gray (a talent raid) to sabotage (an
anonymous press whisper, docket-room sabotage). Each is usable once per rival, costs cash plus intel or
influence, and stacks a discount up to 45%. The gray and sabotage options carry an escalating heat surcharge, so
a firm already under scrutiny pays more to misbehave, and sabotage requires that your ethics already be low
enough to consider it.

**Verdicts** are the presentation of a settlement: a stamped correct/repair verdict, an animated score
breakdown across answer, explanation, and time points, the fee math, and the reputation change — with a judge
character ("The Hon. Logica") delivering the coach's bottom line. It is the moment where learning and game
visibly become the same event.

### 5.6 Upkeep: rent, arrears, and reputation decay

`_settle_upkeep_locked` runs on essentially every game request and charges elapsed time. Daily rent is
`max(15, tier_cost // 50)` — 2% of the headquarters price per day. Rent accrues at the full rate for 24 hours
after your last activity and then at **one fifth** the rate while you are away, so going on holiday does not
bankrupt you. Fractional cents are carried in `rent_accrual_micros` so frequent page loads cannot round rent
away. Unpaid rent becomes arrears capped at three days' worth, and any income — case payouts, passive
collection, daily rewards, story and quest cash — automatically pays it down first.

Reputation decays after a 48-hour grace period at `0.25 + 0.025 × tier` per day, reducible by up to 80% by
reputation-guard assets but never to zero: the firm always needs its lawyer to come back. Once the campaign is
complete, rent and decay stop entirely and any arrears are cleared.

Passive income accrues hourly from staff, upgrades, and acquired rivals, with an 8-hour storage cap that
retainer-storage assets extend — to 130 hours for a firm that owns every one of them. Daily goals pay out at 5,
10, and 20 completed cases.

---

## 6. The presentation layer

A React 19 + Vite + TypeScript SPA with TanStack Query for server state, React Router for routing, and Three.js
for the 3D scenes. The same responsive build serves desktop, mobile web, and the Expo WebView shell in `mobile/`.

### 6.1 Route map

| Route | Screen | Purpose |
| --- | --- | --- |
| `/login` | Login | Google Sign-In, plus a dev-only local sign-in |
| `/` | Redirect | Sends the user to `next_route` from `/v1/me` |
| `/onboarding` | Onboarding | Name the lawyer and firm, choose the character; creates the profile |
| `/office` | Office | The 3D office, daily state, and the day's entry point |
| `/progress` | Progress | Mega-litigation, performance analytics, skill matrix, and the Method Lab |
| `/cases` | Practice lobby | Daily Docket, mode selection, and the active client brief |
| `/cases/:sessionId` | Case session | The actual question flow, debrief, and post-run review |
| `/firm` | Firm | Catalog: upgrades, staff, connections, rivals, cosmetics, clients, tiers |
| `/story` | Story | Campaign chapters, quest caseboard, and rival operations |
| `/map` | Career map | The 3D progression map across five regions |

`/practice` and `/practice/:sessionId` redirect to their `/cases` equivalents for old links. Every protected
route runs through a `Protected` wrapper that loads the user and game state, redirects to `/login` on 401, sends
un-onboarded users to `/onboarding`, and renders a retryable error panel rather than a blank screen when a load
fails.

### 6.2 What each screen is for

**Onboarding** is the only route that works without a game profile. It collects a lawyer name, a firm name, and
a character, then creates the profile with $250 of starting cash, a walk-in client contract, and an opening
ledger entry.

**Office** is the home base: the 3D office scene reflecting everything you own, a greeting that changes with
time of day, the next milestone, daily goals, passive income collection, and the pending story chapter as a
cutscene overlay when one is due.

**Practice lobby (`/cases`)** presents the Daily Docket as the default path — one button that always knows the
next right action — with the four modes available underneath for when a learner wants something specific. It
also shows the current client and effective base fee, so the economic stake of the next question is visible
before starting, and a short "learning loop" explainer: answer → understand → repair → transfer.

**Case session (`/cases/:sessionId`)** is the heart of the app and handles a lot: passage/question split panes
(tabbed on mobile), a live timer against the target, autosaved drafts of both the selected answer and the
reasoning text, the 1–5 confidence check, the strategy-trial brief with its mandatory use/skip decision, the
verdict stamp, the coaching panel, the settlement breakdown, and a page-turn transition between questions. It
also renders the paused state and the completed-run review, where a priority-filtered answer audit ranks
confident misses first and lazily fetches a concise rationale for whichever question you open.

**Progress (`/progress`)** is the measurement surface: the Speedrun Index, deltas against the previous window,
the mega-litigation lab and its one-sitting confirmation gate, the practice-focus panel explaining what the last
form told practice to work on, comparison readiness, the accuracy trend by run, the weakest-link recommendation,
the skill matrix, and the Method Lab panel with its per-strategy lift and evidence status.

**Firm (`/firm`)** is the ledger and shop: every catalog family with requirement lines explaining exactly what
is missing, the next headquarters with its required-asset checklist, and client selection.

**Story (`/story`)** shows the eight-chapter campaign with the choices already made, the active quest and its
progress, the discovered optional files, and the rival operations board.

**Career map (`/map`)** is the 3D empire view.

### 6.3 The 3D art system

Three substantial WebGL systems, all hand-built with Three.js primitives rather than imported models — there
are no GLTF assets to download, which keeps the payload small and lets every scene be driven directly by game
state.

**The 3D office (`office-three.tsx`, ~2,600 lines).** Renders the interior of your current headquarters. Each of
the 15 tiers has its own material palette and exterior view (forest, street, city, harbor, world, ocean, orbit,
lunar, nexus), procedurally generated textures, and an environment description. Owned assets appear in their
assigned zones. Staff you have hired appear as animated actors seated at role-appropriate stations that walk
between their desk and an aisle, with per-character genders and appearances. A client actor sits in the waiting
area during an active case, and there is an office cat that wanders the floor between waypoints.

**The 3D career map (`map-three-scene.tsx`, ~3,800 lines, with the `unified-empire-map.tsx` shell).** Five
region "arcs" — Old Quarter, The Circuit, Treaty Sea, Sovereign Arc, Global Compact — each with its own sky
gradient, fog, lighting rig, camera framing, road route, and rail line. Headquarters, rival firms, and world
events are placed as points into the active region, each showing its state (complete, current, next, locked).
Three view modes filter to career, rivals, or dockets, with camera controls to zoom and refocus. Ambient music
changes per region.

**The stylized character rig (`stylized-character.tsx` + `stylized-counsel.ts`).** One shared humanoid rig used
everywhere a person appears: the office hero, staff actors, client portraits, and inline icons. It supports five
framing modes (hero, full, portrait, icon, scene), four moods, and eight activities including celebrating, a
heel-click, a courtroom bow, and a professional wave, with idle motion amplitudes tuned per framing so a tight
head crop does not look like it is vibrating. It also honors reduced-motion preferences and only re-renders when
dirty and visible.

All three scenes are lazily loaded through `scene-loaders.ts` and preloaded per route on idle, so the 3D code is
not in the critical path. `sound.tsx` (~940 lines) adds procedurally generated, seeded sound effects and
per-region ambient music with user-controllable volume and a reduced-audio mode.

**The guided tour.** `guided-tour.tsx` is the first-run walkthrough, and it explains the game rather than just
the navigation. Eighteen steps run in four kinds: `premise` sets the fiction over a cinematic office, `spotlight`
cuts a hole in a scrim around a real `data-tour` element and routes to the page it lives on, `practice` plays a
working LR question with a 1–5 confidence control and a written debrief, and `feature` covers a mechanic that has
no single element to point at — the mega-litigation, written reasoning, the repair queue, the Method Lab, the fee
formula, upkeep, and the campaign. A `feature` step pairs prose with a short `facts` list, because the prose is
where the reason lives and the list is where the numbers do; the numbers in it are the real ones (75 questions
across three 35-minute blocks, a 120-character reasoning floor, repairs capped at half a run, a 25% silent control
arm, three days of rent arrears, 48 hours of reputation grace). It runs once, is replayable from the header or the
mobile menu, and is gated on a versioned `localStorage` key so a rewrite re-shows it a single time.

---

## 7. Supporting systems

**Authentication and CSRF.** Google Sign-In is verified server-side: `_verified_google_claims` checks Google's
signature and issuer, then validates the audience against the configured web client ID — or, on the native
endpoint only, against explicitly configured iOS/Android client IDs — and requires a verified email. Browser
sessions get two cookies: `lsat_session`, an httpOnly opaque token stored only as a SHA-256 hash in
`auth_sessions`, and `lsat_csrf`, a readable token used for double-submit CSRF validation on every mutating
request. Native clients instead receive an opaque bearer token backed by the same hashed, revocable table (90
days by default), and bearer-authenticated requests skip the CSRF check because they cannot rely on cookies.
Development sign-in can impersonate any email, so it must be enabled explicitly and `create_app` refuses to
start if it is enabled in production. Responses carry `nosniff`, `DENY` framing, a strict referrer policy, and
`no-store`, plus gzip compression added in-app (the large game-state payload shrinks by roughly 85%).

**The async job system.** Covered in §4.3: an `AiJob` table with dedup keys and leases, SQS delivery, and a
Lambda consumer using partial-batch failures. Notably the same `run_attempt_coaching` code runs in both the sync
and async paths, so there is only one implementation of the actual work.

**Database and migrations.** SQLAlchemy models with Alembic migrations `0001` through `0019`, telling the
project's history in order: LLM coaching, resumable flow, saved drafts, recoverable debriefs, job leases, timer
activation, session sequence plans, review cards, async jobs, the lawyer tycoon layer, empire expansion, the
story campaign, attempt confidence, learning modes, strategy experiments, office upkeep, and the profile-scoped
ledger. SQLite is used locally and PostgreSQL in production; `_aware_utc` exists specifically because SQLite
drops timezone information while PostgreSQL preserves it, so review scheduling would otherwise behave
differently in tests and production. Outside tests, schema changes belong to Alembic — `create_all` is only
called under `TESTING`, because calling it on an older stamped database would pre-create future tables and break
upgrades. `scripts/migrate_sqlite_to_postgres.py` handles promotion, with foreign-key and target-revision
validation covered by `tests/test_migration_integrity.py`.

**The office manifest invariant checker.** `frontend/scripts/check-office-manifest.mjs` is the most unusual piece
of tooling here, and it is genuinely load-bearing. It parses the Python catalog in `backend/app/game.py` and the
TypeScript manifest in `frontend/src/art/office-manifest.ts` and enforces that they agree:

- every purchasable asset has a visual destination in the office, and every mapped key exists in the backend;
- no key appears in two catalog families;
- every backend staff member has a role-appropriate station, and no station exists for a non-staff key;
- no two upgrades share the same zone-and-stage signature — meaning **every upgrade must visibly create or
  advance an installation**, so no purchase is visually inert;
- office tiers are exactly 0–14, each with a distinct name and identity, monotonically increasing furnishing
  density, and 1–5 staff on shift;
- layout families cover every tier exactly once, each family is reused across at least two tiers, and each
  defines exactly three staff rows and angles within a supported room envelope;
- backend tier names match the scene's environment names one-for-one.

It exists because the office scene and the game catalog are maintained in two languages with no shared type
system. Without it, adding an asset in Python and forgetting the manifest entry would ship a purchase that costs
money and changes nothing visible — the exact failure that erodes trust in a progression system. It runs as
`npm run check:office-manifest` alongside the pytest suite, the frontend build, a strict `tsc` pass, and the
mobile typecheck.

**Testing.** `backend/tests/test_flow.py` is about 2,150 lines of end-to-end API tests covering the session
lifecycle, idempotency, review scheduling, settlements, upkeep, story progression, and the strategy system
(trial cadence, hidden controls, candidate boundaries, required decisions, and the dashboard's evidence gates).
`test_game_catalog.py` checks catalog invariants and `test_migration_integrity.py` guards the Postgres promotion
path.

---

## 8. How the pieces fit together

Follow one answer through the system. A learner in a cases run opens question 3 of a session.

1. **Serving.** `serialize_item` starts the server-side timer, freezes the economy into the item's
   `game_context_json` via `snapshot_case_context`, and — because every question in a cases run carries a trial —
   includes the strategy brief that `assign_strategy_trial` chose at session creation. If that trial was drawn
   into the invisible 25% control arm, the brief is withheld and the item looks completely ordinary.
2. **Answering.** The learner reads the brief, chooses "Use this brief," selects an answer, writes reasoning, and
   sets confidence. `submit_attempt` validates all of it, computes elapsed time server-side, and compares the
   answer against the verified key.
3. **Immediate consequences.** The attempt is stamped with its evidence class, the strategy key and variant, the
   adherence decision, and the capped prompt-reading time. `_update_skill` updates the skill counters.
   `_schedule_review` decides whether this question earns a review card, and under which reason code. The session
   advances and parks the attempt as a pending debrief so the learner cannot skip ahead.
4. **Coaching.** The client requests coaching. The provider returns a graded explanation, a first-error
   diagnosis, and an explanation of every choice; `_validate_coaching` rejects anything malformed. Reused
   reasoning is detected and zeroed.
5. **Settlement.** `settle_attempt` converts correctness, the coach's grade band, and pace-against-target into a
   1–20 score, then into a payout using the frozen economy snapshot. It updates streaks, advances the client
   contract, advances any active quest against the real outcome, recomputes reputation as a rolling weighted
   average, writes an immutable `AttemptSettlement`, writes a `LedgerEntry` keyed to the profile, and pays down
   any rent arrears from the proceeds.
6. **Aggregation.** The explanation score flows into skill stats once. The session summary is recomputed when the
   run ends. `/performance` recomputes accuracy, pace, reasoning, deltas, and evidence class breakdowns from
   first attempts, and `strategy_performance` recomputes each method's lift against its hidden controls and
   decides whether the evidence has crossed from forming to directional to supported.
7. **The game reflects it.** Cash and reputation change on the office HUD. The next purchase becomes affordable.
   Buying it changes the 3D office scene, unlocks a client tier, moves the career map, and raises the multiplier
   on the *next* question — closing the loop back to step one.

The dependency direction is worth noting as an architectural summary: `services.py` (learning) imports from
`game.py` (economy) and `strategies.py` (experiments), and `game.py` imports from `story.py`. The learning core
drives the game; the game never reaches back into what gets measured. That one-way flow is why the game layer
can be motivational without being able to corrupt the evidence.

---

## 9. Rough edges worth knowing

Stated plainly, because presenting is easier when you already know where the soft spots are.

- **Session start does more database work than it should.** In `select_random_questions`, the
  `_seen_question_ids(user_id)` call sits inside a list comprehension over the whole eligible pool, so it is
  re-evaluated per candidate question — thousands of identical queries per session creation. It is functionally
  correct and invisible on a fresh local SQLite database, but it is the most likely source of a slow "Start 10
  cases" click on a remote Postgres instance with a full 6,886-question bank.
- **No adaptive difficulty.** Every seeded question has `difficulty = 3`, so selection is uniform random within
  the (optionally type-filtered) pool. The system adapts *what it reviews* and *which method it tests*, not how
  hard the next question is. The `difficulty` column exists and is passed to the coach, but nothing varies it.
- **One of the 14 strategies can never be assigned.** `comparative_matrix` requires the substring "compar" in a
  question type or passage type, and neither the derived question types nor the seeded passage type ever contains
  it. The method is fully written but dormant, because the datasets don't label comparative passages. Say "14
  methods, 13 currently reachable" and you're safe.
- **`SkillProgress` is written and never read.** `/performance` recomputes skill breakdowns from `Attempt` rows,
  so the aggregate table is currently dead weight rather than a source of truth.
- **A few vestigial columns.** `Attempt.capm_points`, `pace_scored`, and `xp_earned` are always set to
  0/False/0 — leftovers from an earlier scoring model superseded by `AttemptSettlement`. `ReviewQueueItem.learner_rule`
  is never populated.
- **A mega-litigation has one clock, not four.** The whole-form deadline is enforced server-side and is real, but
  the blocks inside it are labels: nothing stops a learner spending 60 minutes on Logical Reasoning I. Calling it
  "sectioned, whole-form timing" is fair; calling it a proctored section timer is not.
- **Accommodation timing has no UI.** The API accepts 1.0×, 1.5×, and 2.0× mega-litigation timing, and the
  backend applies it to the form budget correctly, but the frontend always starts one at 1.0×. The feature is
  built but not exposed.
- **Every practice question carries a cash incentive.** This is intentional, but it inverts the old defence and
  a sharp audience member will notice ("doesn't paying for every answer corrupt your own numbers?"). The answer
  is that the diagnostic is the only surface feeding the headline, and it pays nothing, prompts nothing, and
  coaches nothing. Coached practice is reported separately, with the incentive stated rather than hidden.
- **Three questions in four require a strategy decision.** A prompted trial will not accept an answer until the
  learner says whether they applied the suggested approach. That is what makes the A/B comparison meaningful,
  but it is a real per-question friction cost on top of the 120-character explanation and the confidence rating.
- **README counts drift slightly.** The README calls all 19 quests "optional," but one of them
  (`constellation_charter`) is the game's completion condition rather than optional, and its catalog line omits
  the 14 cosmetics entirely. The counts themselves — 15 tiers, 35 upgrades, 30 staff, 14 connections, 14 rivals,
  14 cosmetics, 69 clients — are accurate.
- **Licensing is unresolved by design.** Every question is stamped `upstream_terms_apply`, and both the README
  and the question-bank README say dataset terms and LSAT content rights must be confirmed before publication or
  commercial use. Worth having a clear answer ready if it comes up.
