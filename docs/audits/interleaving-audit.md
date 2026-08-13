# Is this interleaving? An audit of question sequencing and strategy selection

**Written 2026-08-11. Annotated 2026-08-12 and not rewritten.**

> **How to read this document.** The body is the audit exactly as it was filed
> on 2026-08-11, including the parts that turned out to be wrong. Everything
> added since is in a blockquote like this one, dated, and says which of three
> things it is:
>
> * **Fixed** — the defect is gone, and the annotation says where and how to
>   check.
> * **Stands** — re-measured and still true, sometimes with a number that has
>   moved.
> * **Did not reproduce** — the mechanism is real and the figure is not, which
>   is a different and more interesting statement than either of the above.
>
> Nothing in the body has been edited. An audit whose findings are quietly
> updated to match the current code is not a record of anything: the value of
> a dated report is that it can be checked against what was actually true, and
> that includes checking it against its own mistakes. §6 is the summary, and
> "The short answer" immediately below is the version most people will read;
> both are annotated where a finding under them has moved.

**Report only. Nothing in the application was changed to produce this.** Two
read-only probes were added under `tools/audit/` so the numbers can be
reproduced and re-run; they call the app's own functions and write only to a
copy of a database.

Everything below was measured on the real 6,886-question bank. Where a number
comes from reading the source rather than running it, it says so.

---

## The short answer

**Review material is genuinely interleaved. Question types are genuinely
interleaved. Sections are not — and the failure is severe enough that Reading
Comprehension is unreachable as fresh practice material for any student who has
a review queue, which is every student after their first run.**

The strategy bandit adapts per student and is not a global winner, but it is
structurally incapable of reaching more than the top two candidates for a
question, and its 25% control arm is 25% across the hash space rather than 25%
for any given student — measured at 10.5% for one simulated student and 45.5%
for another, in the same 200-item sample.

Difficulty is not a silent no-op in the adaptive path. Nothing in the adaptive
path reads it at all. The only two readers of `Question.difficulty` are a
history export and the coaching prompt.

So the honest verdict is **"partly, and the parts are separable"**: the thing
the 2015 correction was about — front-loaded review wearing the name
interleaving — has genuinely been fixed and can be shown to have been fixed. A
different and larger blocking problem has appeared underneath it, in the
component that chooses the fresh material.

> **2026-08-12 — Two of the three paragraphs above have moved.** The section
> finding stands and is still the largest thing here: Reading Comprehension is
> a rounding error rather than a literal zero at a five-slot budget, and exactly
> zero at the budgets below it (§1.4). Nothing on this branch fixed it.
>
> The control arm is fixed (§2.6), and the 10.5%-versus-45.5% swing that
> sentence quotes is now flat across students. The bandit's rank ceiling stands,
> and the re-measurement makes it worse rather than better (§2.3). The claim
> under it that 45.8% of the bank has no real question type is fixed, to 12.5%
> (§1.3), and the weak-type signal that depended on it has been replaced
> outright (§1.5).
>
> Difficulty is still a constant nothing in the adaptive path reads. That work
> belongs to another branch and this one deliberately did not touch it.

---

## 1. Question sequencing

### 1.1 Review placement: interleaved, provably, and measurably

`create_study_session` asks the scheduler for `session_size // 2` review
questions, then calls `scheduling.interleave(repairs, fresh)`, which places
review *blocks* at even fractional positions instead of concatenating them at
the front.

Measured over 20 runs of 10 questions per cohort, driving the real
`create_study_session` (`tools/audit/interleaving_probe.py`):

| cohort | reviews/run | mean review position (0 = first, 1 = last) | share of reviews in the first third |
|---|---:|---:|---:|
| cold, 0 answered | 0.00 | — | — |
| mid, 60 answered | 5.00 | 0.57 | 20% |
| saturated, ~900 answered | 5.00 | 0.56 | 20% |

Under the old `repairs + fresh` concatenation the mean would be about 0.22 and
the first-third share 100%. It is not. **This is real interleaving of review
material and the earlier correction has been earned.**

### 1.2 But the placement is deterministic, and therefore learnable

`interleave` computes its slots as
`{round((i + 0.5) * total / len(review_blocks))}`. For an all-Logical-Reasoning
run — which, per §1.4, is nearly every run — blocks are questions, so the slots
are fully determined by the run length:

| run length | reviews | review slots (0-indexed) |
|---|---:|---|
| 3 (the Office quick practice) | 1 | **[2]** — always the last question |
| 5 (Continue review, from the session screen) | 2 | [1, 4] |
| 10 (Cases lobby, Dashboard) | 5 | [1, 3, 5, 7, 9] |

The measured per-slot review rate for the mid cohort was
`0:0%, 1:100%, 2:0%, 3:60%, 4:50%, 5:70%, 6:30%, 7:75%, 8:25%, 9:90%` — the odd
slots, softened only by the type-separation pass shuffling some blocks
afterwards.

This matters for the same reason front-loading did. Rohrer's mechanism, quoted
in `scheduling.py`'s own comment, is that blocking lets the student infer the
approach from the item's *position* rather than from the item. "Question 1 is
always a repeat and question 0 never is" is a positional cue of exactly that
kind, just a subtler one than "the first four are the ones you got wrong". A
student doing three runs an evening will notice.

There is no jitter anywhere in this path. `research/12-learning-science-implementation.md`
§2 explicitly specified an `+ ε` jitter term "to avoid deterministic sequences";
it was not implemented.

> **2026-08-12 — Stands. Still no jitter, and the ordering is now a measured
> layer rather than an assumption.** The slots formula is unchanged and there
> is still no `+ ε`. What changed is that the ordering itself is one of the
> arms of `run_ordering` in `app/experiments.py`: a quarter of the runs where
> the two orderings differ get `scheduling.front_load`, the app's own previous
> behaviour, and the layer is read on the delayed window and split by section.
> Adding jitter now would be a third arm, and it should be one — the argument
> against a positional cue is good and the argument for spending observations
> on it is not obvious.

### 1.3 Question types: interleaved, and the passage constraint is handled honestly

`_separate_same_type` swaps any block whose type repeats the previous block's
with the next differently-typed one. Measured same-type adjacency across
adjacent pairs:

| cohort | same-type adjacency | mean longest same-type run |
|---|---:|---:|
| cold | 0.22 | 2.50 |
| mid | 0.06 | 1.55 |
| saturated | 0.01 | 1.10 |

The residual 0.22 on the cold cohort is Reading Comprehension passage-mates,
which share a type and are deliberately kept together. **The passage constraint
is being handled well and is not an excuse for blocking**: `_blocks` treats
passage-mates as one indivisible unit and everything else as a block of one, so
the constraint costs exactly the adjacency it has to cost and nothing more.
`cluster_passage_mates` additionally pulls scattered due passage-mates together
so a run reads a passage once rather than twice, and its docstring is explicit
about deliberately *not* pulling in passage-mates the scheduler did not choose.

One caveat on what this measurement means. **3,157 of 6,886 questions (45.8%)
have `question_type` equal to their section name** — 1,784 typed "Logical
Reasoning" and 1,373 typed "Reading Comprehension". So for nearly half the bank
"type" is a placeholder, and both the type separation here and
`diagnostic_focus`'s weak-type list are operating on a label that is missing
almost half the time. `research/12` already recorded this as "~46% of items
untyped"; the measurement above confirms it exactly.

> **2026-08-12 — Fixed, from 45.8% to 12.5%.** The type is now read off the
> stem at ingest by `app/question_types.py`, and `Question.question_type_source`
> records whether a rule matched or the row fell through to its section's name,
> which is the difference this audit had to measure by string comparison.
> `python3 tools/audit/question_type_coverage.py` prints the before-and-after
> and, more usefully, what each rule *newly* matches — a rule that widens past
> its family improves the coverage number just as much as one that is right.
> The residual 12.5% is a real residue and is handled rather than ignored: see
> the note on §1.5 below.

### 1.4 Sections: not interleaved, and Reading Comprehension is effectively unreachable

This is the finding.

`_fill_blocks` adds whole passage blocks to a run and **never overshoots the
budget**: `if total + len(block) > budget: continue`. The budget for fresh
material is `session_size - len(repairs)`. The passage-size distribution in the
bank is:

| questions per passage | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 16 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| passages | 1 | 40 | 98 | 125 | 81 | 1 | 1 | 2 |

Only 41 of 349 passages (11.7%) are five questions or shorter. So a five-slot
fresh budget can admit 11.7% of the RC bank in principle — and in practice
almost none of it, because `_fill_blocks` walks a shuffled list of ~4,900 blocks
of which ~4,520 are single Logical Reasoning questions, and those fill the
budget first.

Measured directly by calling `select_random_questions` 40 times per budget:

| fresh budget | RC share of selected questions | runs containing any RC |
|---:|---:|---:|
| 3 | **0.0%** | 0 of 40 |
| 5 | **0.0%** | 0 of 40 |
| 7 | 5.0% | 2 of 40 |
| 8 | 13.8% | 8 of 40 |
| 9 | 13.3% | 7 of 40 |
| 10 | 18.5% | 12 of 40 |
| 12 | 24.4% | 17 of 40 |

The bank is 34.4% Reading Comprehension.

Now put that against the fresh budgets the app actually produces. Every
practice entry point in the frontend:

| entry point | requested size | reviews | **fresh budget** |
|---|---:|---:|---:|
| `office-page.tsx` quick practice | 3 | 1 | **2** |
| `case-session-page.tsx` "continue review" | ≤ 5 | 2 | **3** |
| `dashboard-page.tsx` focus drill | 3 | 0 (type-filtered) | 3 |
| `dashboard-page.tsx` / `cases-page.tsx` | 10 | 5 | **5** |

**Every one of them is at or below the budget at which measured RC share is
zero.** The only exception is a brand-new student on a size-10 run, who has an
empty review queue and therefore a fresh budget of 10 — and gets 18.5%.

The review queue fills fast enough that this exception lasts about one run.
Applying `_entry_reason` to the 920 attempts in the seeded database, **54.8%**
of attempts would enter the review queue — 25.8% incorrect, 20.5%
slow-correct, 6.6% high-confidence error, 1.8% low-confidence-correct. A
student needs five queued cards to saturate the five review slots of a size-10
run, which is roughly ten questions.

So the practical statement is: **from roughly the tenth question onwards, a
student's fresh practice material is 100% Logical Reasoning.** The only Reading
Comprehension they meet after that is what the mega-litigation gave them, plus
whatever their first one or two full-size runs happened to include, recycled
through the review queue. Since fresh selection stops serving RC, no new RC can
enter the queue from practice either; from then on the queue can only return
what was already in it.

Measured same-section adjacency was 1.00 for the mid cohort — every adjacent
pair in every run was the same section — and its RC share was 0.00.

> **2026-08-12 — Stands, with the zero softened at one budget and not at the
> others.** `python3 tools/audit/section_reach.py` re-measures it over 200 runs
> per budget rather than 40, against the same bank and the current selector.
> The probe is new; the audit's own was not in this repository, and a figure
> nobody can re-run is the thing this branch exists to stop producing.
>
> | fresh budget | RC share | runs containing any RC |
> |---:|---:|---:|
> | 2 | 0.0% | 0 of 200 |
> | 3 | 0.0% | 0 of 200 |
> | 5 | **2.5%** | 5 of 200 |
> | 7 | 8.6% | 20 of 200 |
> | 10 | 16.2% | 50 of 200 |
>
> The passage-size distribution is unchanged, 41 of 349 passages at five
> questions or shorter. Two corrections and neither rescues the section. The
> original 0.0% at budget 5 was a forty-run sample of a rate near one run in
> forty, so it is a rounding error rather than a hard zero — and the right way
> to read the 2.5% is the column beside it, because a passage is served whole:
> 195 of those 200 runs contained no Reading Comprehension at all, and the five
> that did were almost entirely Reading Comprehension. The share at budgets 8
> and above is a little lower than the audit had it, 16.2% against 18.5%, which
> moves nothing. At budgets 2 and 3 — where every practice entry point except a
> cold student's first full run sits — it is still exactly zero.
>
> This branch did not fix it and should not be read as having done so. What it
> did do is make the *consequence* deliberate rather than accidental — see the
> annotation on §5, and `scheduling.BLOCKED_SECTIONS`. Getting Reading
> Comprehension back into practice is a change to `_fill_blocks` or to what a
> run is allowed to overshoot by, and it is still open.

**One warning about how this was missed.** `scripts/seed_demo.py` does not use
`select_random_questions`. It builds its own `SessionItem` rows against a
hand-authored balanced plan (`section = "Reading Comprehension" if 25 <= position < 52`,
and a `type_cycle`). The seeded demo account's practice history is therefore
42.9% Reading Comprehension — a section balance the real selector does not
produce. Any inspection of the demo data would show a healthy mix.

### 1.5 Does sequencing respond to the individual?

Partly, through three channels, none of which touch section balance:

* **Review content and order** — fully individual. `due_for_review` ranks the
  student's whole queue by current FSRS retrievability, lowest first. Different
  students get different questions in a different order.
* **Focus weighting** — individual but coarse. `diagnostic_focus` reads the
  student's *last completed mega-litigation* and returns up to 5 question types
  that fell below that run's own accuracy with at least 2 attempts;
  `FOCUS_FILL_RATIO = 0.6` of the fresh budget is then drawn from those types.
  A student who has never finished a mega-litigation gets no focus at all, and
  the signal never updates from practice. Note the interaction with §1.4: on a
  size-10 run the focus bias governs 3 of 10 questions.
* **Unseen-first** — individual. `select_random_questions` prefers questions the
  student has not answered, falling back to seen ones when the unseen pool is
  smaller than the run.

The *shape* of the run — how many reviews, where they sit, which slots — is
identical for every student at a given run length. There is no per-student
sequencing policy.

> **2026-08-12 — Fixed, on the focus channel.** "Reads the student's last
> completed mega-litigation and the signal never updates from practice" was
> the accurate description of `focus.diagnostic_focus`, and it is the sentence
> this branch's last piece of work is a response to. `app/type_focus.py`
> replaces it: every first encounter the account has filed, decayed on a
> 30-day half-life, the mega-litigation's answers still weighted highest, each
> type compared against the student's own accuracy on the rest of that section
> and shrunk toward it. A student who has never sat a form is no longer
> invisible and one who has improved stops being fed their old weakness.
>
> Three things in that replacement are answers to problems this audit raised
> elsewhere. Review returns are excluded from the rate, because a question
> comes back *because* it was missed and counting it would be the third time
> one wrong answer moved something. Types are compared within a section, so the
> section-mix knob keeps that gradient to itself. And the 12.5% of the bank
> still carrying a placeholder type can never be named a weakness — a bucket
> holding an eighth of the bank is not a category — while still being served:
> `python3 tools/audit/type_targeting.py` measures that at 6.4% of a targeted
> run against 10.5% of an untargeted one, reduced by the fill ratio and not
> hidden.
>
> It arrived measurable rather than on. `weak_type_targeting` is a registered
> layer with a quarter of eligible runs in the off arm, read on later first
> encounters with the types the run leaned into, over the population the draw
> recorded. `type_focus.rolling_population_reading` bands the cohort by how
> much history each student has, because the two ends are the interesting ones
> and a cold account must show as absent rather than as a null.
>
> The other two channels are unchanged, and "there is no per-student sequencing
> policy" is being addressed on a sibling branch rather than here.

### 1.6 The mega-litigation is deliberately blocked, and that is correct

`select_diagnostic_questions` builds LR / intact-RC / LR blocks and
`assign_strategy_trial` returns `None` for `practice_style == "diagnostic"`. A
mock exam should look like the exam and should not be coached mid-form. No
issue here; it is worth stating so it is not mistaken for the same defect.

> **2026-08-12 — Still correct, but that guard has gone and it was never doing
> the work.** `practice_style` had exactly one legal value, `"cases"`, so the
> `== "diagnostic"` branch was a guard against a call nobody makes, reading a
> parameter that could not take the value it tested for. The invariant is real
> and is held where it is true: `create_diagnostic_session` and the sectioned
> form build their items without ever calling `assign_strategy_trial`, and
> `test_exam.py` and `test_flow.py` assert it on the items rather than on the
> function's willingness to refuse. The parameter and the constant are deleted;
> a selector with one option is not a layer.

---

## 2. Strategy selection

### 2.1 The algorithm

Not a named bandit. `assign_strategy_trial` is a hand-rolled two-phase rule:

**Coverage phase.** While the least-sampled candidate has fewer than
`BASE_COVERAGE_TRIALS = 3` prompt-arm observations (`FOCUS_COVERAGE_TRIALS = 5`
on the last mega-litigation's weak types), pick uniformly among the
least-sampled candidates.

**Exploit phase.** Score each candidate and take the leader, or the runner-up on
a 30% draw:

```
score = posterior_accuracy·0.50 + explanation_mean·0.30 + pace·0.14 + calibrated·0.06
        (or ·0.76/·0.18/·0.06 with no graded explanation yet)
posterior_accuracy = (correct + 1) / (n + 2)      # Beta(1,1)
```

So it optimises a weighted blend of accuracy, coach-graded explanation quality,
speed against the item's target, and confidence calibration. It is closest to
**ε-greedy with a Laplace-smoothed mean**, ε = 0.30, over a per-question
candidate set. It is not Thompson sampling and not UCB: nothing in the score
grows with uncertainty, so a candidate is never selected *because* it is
under-explored once coverage is satisfied.

### 2.2 It does adapt per student, and does not converge to a global winner

The posterior is built from `Attempt.user_id == user_id`. Two simulated
students with different histories produced different leaders over 200
assignments each: `argument_core` at 68.5% of assignments for the mid cohort,
`prephrase` at 33.5% for the saturated one. **Per-student adaptivity is real.**

### 2.3 Exploration is starved, and provably so

```python
ranked = sorted(candidates, key=score, reverse=True)
explore = _stable_fraction(f"explore:{seed}") < .30
key = ranked[1 if explore and len(ranked) > 1 else 0]
```

Only `ranked[0]` and `ranked[1]` are reachable. **Everything from rank 2 down is
permanently unreachable for that student on that candidate set**, and because
it is never selected its sample never grows, so it can never climb back.

Measured (`tools/audit/bandit_probe.py`): a five-candidate question, coverage
satisfied on all five, 400 draws.

```
candidates: ['role_map', 'conditional_chain', 'scope_precision', 'argument_core', 'prephrase']
over 400 draws: {'role_map': 279, 'conditional_chain': 121}
never offered: ['scope_precision', 'argument_core', 'prephrase']
```

279/121 is exactly the 70/30 split between ranks 0 and 1. Three of five
approaches were locked out on the strength of three observations each.

Three observations is a very thin basis for a permanent exclusion. A candidate
that goes 0/3 by luck has a posterior mean of 1/5 = 0.20 against a candidate
that went 3/3 at 4/5 = 0.80, and there is no mechanism that will ever revisit
it.

> **2026-08-12 — Stands, and the probe that found it could not have found
> anything else.** This was the finding left unresolved, so it is worth being
> precise about both halves.
>
> **The method was not sound.** `bandit_probe.py` wrote three coverage
> observations per candidate and then drew 400 times *without recording a
> single outcome*. The posteriors could not move, so the ranking could not
> move, so rank 2 was unreachable by construction — whatever the mechanism
> does. What the 400 draws demonstrated is that the exploit branch reads
> `ranked[0]` and `ranked[1]`, which is visible in four lines of source and did
> not need a probe. Whether ranks move in use is the question the finding turns
> on, and it was not asked.
>
> **The conclusion is right anyway, and the reason is sharper than the audit
> gave.** `python3 tools/audit/rank_reachability.py` re-runs it with every draw
> answered and recorded, so the ranking is free to move. An approach goes 1 for
> 3 in coverage by bad luck, which pins its posterior at 0.40 against a field on
> 0.80 and 0.60, and finishes last. Twenty runs of 300 draws per condition,
> because release turns out to be a coin and one run of a coin measures nothing
> — which is this audit's own mistake, in a different place:
>
> | condition | offered again | share of offers |
> |---|---:|---:|
> | held, and truly the **best** at 78% | **1 of 20 runs** | 0.0% |
> | held, and truly the **worst** at 30% | **2 of 20 runs** | 0.0% |
> | the field falls to a true 25% | 20 of 20 runs | 65.3% |
> | uniform — the off arm this branch added | 20 of 20 runs | 25.0% |
>
> The first two rows are the finding. They differ only in whether the shut-out
> approach is the best one on the question or the worst, and they come back at
> the same rate, because a frozen posterior cannot be evidence about itself:
> nothing in the mechanism can tell those two cases apart. The 5% that do come
> back are not earned either — what releases a candidate is the *runner-up*
> drawing a bad streak of its own and falling under 0.40.
>
> So the release threshold is the frozen posterior of the excluded candidate,
> and the trigger is somebody else's luck. The mechanism lets a candidate back
> reliably when the exclusion turned out to be right — row three, where the
> field really is worse — and holds it in nineteen runs out of twenty when the
> exclusion was a mistake. That is the wrong way round, and it is a more
> damning statement than "rank 2 is unreachable".
>
> Not fixed here. What this branch added is an off arm: `strategy_selection` is
> registered in `app/experiments.py`, and a quarter of eligible questions pick
> uniformly over the candidates, which reaches every rank. That is not a
> repair, it is the measurement of what the ranking is worth — and it is nested
> inside the prompt arm of the offer trial, because adaptive-versus-uniform is
> only defined for a student who is shown an approach at all.

### 2.4 The candidate lists are narrower than "two to five"

Measured across the whole bank:

| candidates | questions | share |
|---:|---:|---:|
| 2 | 3,088 | 44.8% |
| 3 | 2,830 | 41.1% |
| 4 | 894 | 13.0% |
| 5 | 74 | 1.1% |

**85.9% of questions offer only two or three approaches.** On the 44.8% with
exactly two, §2.3 is harmless — ranks 0 and 1 are the whole set, and the
mechanism degenerates to a 70/30 split between two options. On the 14.1% with
four or five, one to three approaches are unreachable.

> **2026-08-12 — Stands, and the type fix made it worse rather than better.**
> Filling in 3,157 placeholder types widened candidate lists, because
> `_candidate_keys` matches on the type as well as the stem: 293 Logical
> Reasoning questions went from two candidates to three, 121 from three to
> four, 102 from two to four. So the share of questions on which §2.3 can bite
> went up, and the mandatory-approach draw now charges to 150 strata rather
> than 92, with a median of 55 questions each rather than 83 — thinner cells,
> more of them. `python3 tools/audit/strategy_candidates.py` prints both.
>
> This is the one place in the branch where a fix made a measurement harder,
> and it is worth stating plainly rather than netting off against the coverage
> improvement.

### 2.5 What the bandit does with a mis-fitting candidate

Confirming the other audit's finding on this bank: `causal_audit` is offered on
426 of 4,520 Logical Reasoning questions, and **275 of those 426 (64.6%) are
triggered solely because the substring `"cause"` matches inside the word
`"because"`** — `_candidate_keys` tests `any(token in stimulus for token in ("cause", ...))`
against raw lowercased text with no word boundary.

The bandit has no defence against this, and it is worse than "one wasted
candidate":

1. **Coverage is taxed.** Every spurious candidate demands 3 (or 5) more
   observations before the exploit phase can begin at all, on every question
   whose candidate set it joins.
2. **It can evict a good approach permanently.** Widening a 3-candidate set to
   4 pushes whatever was rank 1 to rank 2, and per §2.3 rank 2 never comes
   back. A spurious candidate that gets lucky on its three coverage
   observations displaces a real one forever.
3. **Nothing downstream can tell.** The score is computed from outcomes on the
   question, not from whether the approach was applicable, so a strategy that
   does not fit simply looks like a strategy that does not work — which is
   indistinguishable from a strategy that fits and is unhelpful.

> **2026-08-12 — Stands, reduced, and the reduction was a side effect.**
> `_candidate_keys` still tests `"cause" in stimulus` with no word boundary, so
> `"because"` still matches. What narrowed it is that the causal branch now
> also requires a strengthen / weaken / flaw / explain task. Re-measured against
> the current bank by `python3 tools/audit/strategy_candidates.py`:
> `causal_audit` is a candidate on 488 Logical Reasoning questions, of which
> **143 (29.3%)** stop being candidates if `"because"` is rewritten to
> `"since"` — down from 64.6%, and still 143 questions carrying a spurious
> candidate that taxes coverage and can evict a real approach.
>
> A word boundary is a one-line change and is not in this branch, because
> changing which approaches a question offers changes the strata the strategy
> trial is charged to, and doing that in the same change as the type fix — which
> already moved them — would make neither measurable.

### 2.6 The control arm is 25% across the hash space, not 25% per student

The arm is drawn as
`_stable_fraction(f"control:{user_id}:{question_id}:{position}:{style}:{key}") < 0.25`.
That is deterministic. A question that comes back at the same slot draws the
same arm every time — and per §1.2 review slots are fixed, and per §1.4 the
review half of every run is a small recirculating set.

Measured over 200 assignments per cohort:

| cohort | control share, fresh questions | control share, repeated questions | **overall** |
|---|---:|---:|---:|
| cold (no repeats) | 29.5% | — | 29.5% |
| mid | 25.0% | 36.0% | 30.5% |
| saturated | 19.0% | **2.0%** | **10.5%** |

Fresh questions sit at 25% within binomial noise, exactly as designed. Repeated
questions are frozen at whatever their hash gave once, so they land at 2% or
36% and stay there. Because the repeats are half of every run, the per-student
realised control share swung from 10.5% to 30.5% across three students in
identically sized samples. Across 20 runs the saturated cohort's recurring
(question, slot) pairs got the same arm 14 times out of 16.

This does not corrupt the estimate — `_contrast_sample` is the harmonic mean of
the two arm sizes, so a starved control arm correctly reports a tiny effective
sample and a weak evidence grade, and `_section_reading` will decline to name an
approach. **The consequence is not a wrong recommendation, it is a
never-arriving one**: the student who practices most is the student whose
control arm collapses fastest, so the app keeps accumulating prompt-arm data it
cannot use and keeps telling them there is not enough evidence yet.

It also breaks an assumption the design is explicit about. The comment above
`VARIANT_PROMPT_REQUIRED` states that "the propensity of *being offered a
technique at all* is still `1 - CONTROL_PROBABILITY` on every question in every
stratum", and `strategy_propensity` is written to every row as the design
constant for the arm it landed in — 0.75 on prompt rows, 0.25 on control ones.
For a question the student has seen before at that slot, neither is the
propensity: the assignment probability conditional on (question, slot) is 0 or
1. The stored column is the design's number, not the realised one, so any later
IPW or CACE fit that trusts it will be weighting on a propensity the mechanism
did not use.

> **2026-08-12 — Fixed. And the 2.0% did not reproduce, which is worth more
> than the fix.** The mechanism is exactly as described and is gone: the arm now
> takes the run's id as a required, keyword-only `exposure`, so each encounter
> is its own draw. `python3 tools/audit/control_arm_exposure.py` simulates 200
> students under both seeding schemes.
>
> The structural measurement is the one that settles it. Under the old seed,
> **100.0%** of recurring (question, slot) pairs got the same arm every time
> they recurred. Under the new one that falls to **62.5%**, which is not a
> partial fix — it is 0.75² + 0.25², exactly how often two independent draws of
> this coin agree by chance. The freezing is not reduced; it is gone, and what
> is left is the coin agreeing with itself.
>
> The **2.0%** is a different matter. At the twelve-card queue this probe
> models, the old scheme gives a pooled 24.6% and a *lowest student* of 17.0%,
> nowhere near 2%. The figure only appears when the recirculating set is very
> small:
>
> | review queue | lowest student's share, old seed | students off design | (new seed) |
> |---:|---:|---:|---:|
> | 2 | 9.5% | 57 of 200 | flat |
> | 3 | 11.5% | 33 of 200 | flat |
> | 6 | 14.0% | 11 of 200 | flat |
> | 12 | 17.0% | 3 of 200 | flat |
> | 24 | 18.5% | 1 of 200 | flat |
>
> So the severity is not a constant, and the audit reported a figure from one
> cohort of one simulation as though it were. The finding is not weakened by
> that — it is sharpened. Severity is a function of how concentrated a student's
> review set is, which means the collapse is worst for exactly the student who
> is failing the same few cards over and over: the one practising hardest, the
> one generating the most rows, the one whose control arm the app most needs.
>
> The second half of the finding is also fixed. Rows now carry the *realised*
> propensity, computed from the shares in force at the moment of the draw, so a
> later IPW or CACE fit is reading what the mechanism actually did rather than
> what the design intended.

### 2.7 Enforcement and gate-skipping do not feed back into selection

Deliberately, and correctly. Both the coverage count and the exploit posterior
filter on `Attempt.strategy_variant in PROMPT_VARIANTS` — the *assignment* —
and never on `strategy_applied` or `strategy_gate_status`. The docstring
explains why at length: `strategy_applied` is post-randomisation and
self-reported, and conditioning on it would select on exactly the
question-recognition that predicts a correct answer.

The consequence, though, is worth stating plainly. For a student who skips
every gate, the bandit is still "adapting" — it is estimating the effect of
*being shown a card* on someone who does not read cards, which is noise, and it
will still converge to a leader and still recommend it. With the user's quoted
gate usage of 259 satisfied against 228 skipped, roughly 47% of the treated
population is in that condition. Nothing in the selection path knows.

---

## 3. Difficulty

**Every one of the 6,886 questions has `difficulty = 3`.** Confirmed by direct
query: the distribution is a single bucket.

The important correction to the framing in the request: **nothing in the
adaptive path reads it, so there is nothing that is silently a no-op.** The
complete set of readers of `Question.difficulty` in the backend is:

| reader | what it does with it |
|---|---|
| `history.py:250` | includes it in a serialised question record |
| `coaching.py:331` | puts it in the LLM coaching prompt |

`select_random_questions`, `_weight_toward_focus`, `interleave`,
`assign_strategy_trial`, `plan_forced_arms` and `due_for_review` never mention
it. There is no dead difficulty branch to enable.

Two things follow.

* The `difficulty` that FSRS uses is **a different quantity** and does vary:
  `ReviewQueueItem.difficulty` is the DSR model's per-card D, updated by
  `next_difficulty` from the derived grade. So the scheduler is not affected by
  the constant column. (In the seeded database all 34 cards have `reps = 0` and
  a null stability, because `seed_demo.py` writes queue rows without running
  `apply_review`. That is a seeding artefact, not a product defect — but it does
  mean the seeded data cannot be used to judge whether FSRS is working.)
* The coaching prompt is told "difficulty: 3" on every single question. It is a
  constant presented as information. Harmless, but it is a token of prompt
  budget spent saying nothing, and a model told a question is mid-difficulty
  when it is a five-star Parallel Reasoning item has been mildly misinformed.

`research/12-learning-science-implementation.md` §2 already specified the right
shape here — a three-regime selector with `w_diff = 0` at launch, fading in as
items acquire real parameters — and `research/11 § 5` specified replacing the
default with `NULL` meaning uncalibrated. Neither has been done. The `NULL`
change is the cheap and valuable half: it makes the absence of calibration
visible instead of forgeable.

---

## 4. Robustness

**Cold start (no history).** Handled, and it is the *best* case for sequencing:
no review queue means the full run is fresh, so RC share is 18–26% rather than
zero. The bandit is in its coverage phase and samples uniformly among
least-sampled candidates, which is correct. `diagnostic_focus` returns an empty
list and the focus bias is skipped cleanly. No crash paths.

**Saturation (~900 attempts).** Degrades in three ways at once, all measured
above: the fresh budget halves so RC disappears (§1.4); the same small set of
review questions recirculates at fixed slots, freezing their arms and collapsing
the control share to 10.5% (§2.6); and the bandit has long since locked out
everything below rank 1 (§2.3). There is no exposure control — `research/12` §2
called for `exposure_penalty` and it does not exist — so item reuse happens
through the unseen-pool fallback rather than deliberately.

**Gate-skipping.** No effect on selection by design (§2.7). Worth noting that
the app has no signal at all that a student is a systematic skipper.

**Degenerate input.** `_fill_blocks` has a documented last-resort branch for a
pool whose only remaining block is longer than the run. `interleave` returns
the non-empty side when either list is empty. `due_for_review` returns `[]` for
`count <= 0`. `_candidate_keys` always returns at least two candidates.
`retrievability(None, ...)` returns 0.0, which puts never-graded cards first —
correct, but note that when *every* card is never-graded the ranking degenerates
to `due_at` order, i.e. FIFO.

**Signal sufficiency.** The user's framing is right. With 45.8% of items
untyped, 44.8% of questions offering only two candidate approaches, a control
arm that freezes on the material a student sees most, and roughly half of gate
offers skipped, there is not much signal to adapt on. The system's behaviour is
better described as *responsive* than *adaptive*: it reacts correctly to the
signals it has, and it has few.

---

## 5. Research grounding

**What is cited, and it is cited well.** `scheduling.py`'s module docstring is
one of the better pieces of research documentation in this repository. It names
FSRS-6, links the reference implementation and the specification, cites Ye et
al. (SIGKDD 2022) and Woźniak, and — unusually — records what was *rejected and
why*: half-life regression (Settles & Meeder, ACL 2016) and DASH (Lindsey et
al., Psych Science 2014), both correctly rejected on the grounds that they are
*trained* models and there is no corpus here to train them on. The FSRS-6
default parameters are transcribed verbatim. The `derive_grade` mapping is
flagged as the one bespoke part and defended explicitly.

The interleaving section cites Rohrer, Dedrick & Stershic (J. Ed. Psych. 2015)
with the effect sizes, and the implementation follows the mechanism that paper
identifies rather than just the headline.

**Where the grounding and the code have drifted apart.**

1. **The stronger and more relevant paper is in the repository and is not the
   one the implementation cites.** `research/01-learning-science.md` carries
   Brunmair & Richter (Psychological Bulletin 2019), the definitive interleaving
   meta-analysis: 59 studies, N ≈ 8,466, overall *g* = 0.42 — but heavily
   moderated by material, with **expository text at *g* = 0.01, a null**. The
   repository's own note on it says so: "Reading Comprehension (expository text,
   g = 0.01) is the case where interleaving buys nothing."

   This is the interesting collision. The one section the sequencer *fails* to
   interleave is the one section the evidence says interleaving does not help.
   The outcome is accidentally defensible and the reasoning is absent — nothing
   in `services.py` or `scheduling.py` mentions the moderator, and the exclusion
   is a consequence of `_fill_blocks` never overshooting a budget, not a
   decision. It is also not the right response to that evidence: g = 0.01 means
   interleaving RC does not *help*, not that RC should be *dropped from
   practice*.

2. **`research/01` also carries counter-evidence to blanket interleaving that
   the implementation does not engage with.** The 2025 replication of Little et
   al. found a strategy-by-sequence interaction: interleaving beats blocking for
   similarity-based memorising (*d* = 0.65), while blocking is numerically
   better for rule-finding (*d* = 0.33, n.s.) — and the repository's own note
   argues LSAT prep is explicitly rule-finding, suggesting "a blocked →
   interleaved progression rather than always-mixed". The code always mixes.
   That may well be the right call, but it is an unargued one.

3. **Three specified items were not built.** `research/12` §2 specified a scored
   selector with `type_need`, `spacing_fitness`, `difficulty_fit`,
   `exposure_penalty` and a jitter term, plus the rule "never emit more than two
   consecutive items of one type unless the pool is too small". What exists is
   `_weight_toward_focus` (a 60% bias from the last mega-litigation only) and
   `_separate_same_type`. There is no exposure control and no jitter. §2 also
   noted `SkillProgress` is written on every attempt and read by no selector;
   that is still true.

---

## 6. Findings by severity

> **2026-08-12 — Where each of these stands.** In the order they appear below,
> so this can be read against the list rather than instead of it.
>
> | finding | now | where |
> |---|---|---|
> | RC unreachable as fresh material | **stands**, zero at budgets 2–3, 2.5% at 5 | §1.4 |
> | control arm collapses | **fixed**, and the 2.0% did not reproduce | §2.6 |
> | bandit cannot reach below rank 1 | **stands**, and the reason is worse than stated | §2.3 |
> | eligibility misfires on `"because"` | **stands**, reduced from 64.6% to 29.3% | §2.5 |
> | 45.8% of the bank has no real type | **fixed**, to 12.5% | §1.3 |
> | review placement is deterministic | **stands**, and is now a measured layer | §1.2 |
> | `difficulty` is a constant | **stands**, and belongs to another branch | §3 |
>
> Two of the seven were fixed here, one of those two carried a figure that did
> not reproduce, and one of the five that stand got worse when it was measured
> properly. The severity ordering below is the author's as of 2026-08-11 and has
> not been re-sorted.

**High — Reading Comprehension is unreachable as fresh practice material.**
`_fill_blocks` never overshoots its budget and 88.3% of passages are six
questions or longer, so at the fresh budgets every entry point in the app
actually produces (2, 3, 3, 5), measured RC share is 0.0% over 40 runs each.
A student sees RC only through the mega-litigation and its review echoes.
Hidden by `seed_demo.py`, which fabricates a 42.9%-RC practice history without
going through the selector.

**High — the control arm collapses for the students with the most data.**
Deterministic hashing on (user, question, position, style, key), fixed review
slots, and a small recirculating review set combine so that repeated questions
are frozen in one arm: 2.0% control on repeats for the saturated cohort against
25% by design. `strategy_propensity` is nonetheless written as the constant
0.75 on every row.

**Medium — the bandit cannot reach below rank 1.** Three of five candidates
were never offered in 400 draws. Exclusions are made on three observations and
are permanent. Affects the 14.1% of questions with four or five candidates,
and interacts badly with the eligibility bug below.

**Medium — eligibility misfires feed the bandit directly.** 275 of 426
`causal_audit` offers (64.6%) come from `"cause"` matching inside `"because"`.
A spurious candidate taxes coverage and can permanently evict a real approach
via the rank-2 lockout.

**Medium — 45.8% of the bank has no real question type.** Both the type
separation and the weak-type focus list run on a label that is a placeholder
for nearly half the items.

**Low — review placement is deterministic.** Fixed slots per run length; on a
3-question run the repeat is always the last question. `research/12` specified
a jitter term that was not implemented.

**Low — `Question.difficulty` is a constant fed to the coaching prompt.** Not an
adaptive-path defect, because the adaptive path never reads it. `research/11 § 5`
specified changing the default to `NULL` so the absence of calibration is
visible.

**Not a defect, recorded so it is not re-audited.** The mega-litigation is
deliberately section-blocked and trial-free. Review placement is genuinely
interleaved. The passage-integrity constraint is handled correctly and is not
being used as cover for blocking. Enforcement and gate-skipping deliberately do
not feed back into selection, and the reasoning for that is sound.

---

## 7. Reproducing this

```bash
# Never point these at a live database; building a run writes rows.
mkdir -p /tmp/ilaudit && cp <a copy of the app database> /tmp/ilaudit/audit.db

DATABASE_URL=sqlite:////tmp/ilaudit/audit.db PRACTICE_SESSION_SIZE=10 \
  .venv/bin/python tools/audit/interleaving_probe.py --runs 20

DATABASE_URL=sqlite:////tmp/ilaudit/audit.db \
  .venv/bin/python tools/audit/bandit_probe.py
```

The RC-by-budget table in §1.4 and the eligibility counts in §2.5 were taken
with short inline scripts against the same copy; both are a handful of lines
over `select_random_questions` and `_candidate_keys` respectively.

The numbers here were taken against a database seeded by
`backend/scripts/seed_demo.py` (920 attempts, one account) plus two synthetic
cohorts built by the probe. The bank is the real 6,886-question bank, so every
bank-level statistic — passage sizes, type labelling, candidate widths, the
`because` count, the difficulty distribution — is a fact about production
content and not about the fixture. The cohort-level statistics are about
simulated students and should be re-run against real usage before being quoted
as production rates; the mechanisms they demonstrate are properties of the code
and do not depend on the fixture.

> **2026-08-12 — Neither probe above is in this repository**, and the two
> "short inline scripts" were never checked in at all, so most of this document
> could not be re-run by the person reading it. That is the failure mode this
> section was written to prevent, and it is worth being blunt that it did not
> work: a probe that exists on the machine of whoever ran it is an assertion.
>
> Every re-measurement in the annotations above is checked in, needs no database
> and no arguments, and prints the numbers quoted:
>
> ```
> python3 tools/audit/section_reach.py            # §1.4, RC by fresh budget
> python3 tools/audit/question_type_coverage.py   # §1.3, types before and after
> python3 tools/audit/type_targeting.py           # §1.5, what targeting serves
> python3 tools/audit/rank_reachability.py        # §2.3, the rank ceiling
> python3 tools/audit/strategy_candidates.py      # §2.4 widths and strata, §2.5 "because"
> python3 tools/audit/control_arm_exposure.py     # §2.6, the control arm, old and new
> ```
>
> They build their own in-memory data where they need any, so the warning at the
> top of this section does not apply to them: there is no database to point them
> at and nothing of yours for them to write to.
