# The strategy apparatus: what it is delivering, and what I would change

**Written as a recommendation with nothing acted on. Two items have since been
acted on, and they are marked where they appear.** The rest still stands as a
recommendation and is deliberately not implemented: §3 and most of §5 are
changes to what students see or to how the trial allocates, and neither is mine
to make. §7 lists everything this branch actually touched.

The one decision that changed between the first draft and now is §8's first
question, "may the trial be analysed across students?". It was answered yes,
and the query exists — see §2 and §7. Nothing a student sees changed with it.

The question I was asked: fourteen strategies, enforcement gates, a bandit, an
intention-to-treat trial, forced arms and a mandatory no-skip sub-arm add up to
a research instrument bolted to a feature roughly 47% of users skip. Is it
worth its complexity?

My answer, in one paragraph:

> The machinery is well built and almost all of it is worth keeping. It is not
> one feature, though: it is a teaching feature and a research instrument
> sharing a column, and they want different things. The research instrument is
> the part I would change, and not by cutting it — by **pointing it at cohorts
> instead of individuals**. Every estimator in `strategies.py` filters on
> `user_id`. The file's own comments say a per-student verdict needs thousands
> of observations and correctly refuse to give one. So the app runs a
> randomised trial whose per-student output is known in advance to be
> unusable, and never computes the pooled estimate the same randomisation
> already supports. That is one query away, and it changes what the whole
> apparatus is for.

---

## 1. What is actually there

Nine mechanisms, and it is worth seeing them listed because no summary of this
feature has ever listed them:

1. **A catalogue of 14 approaches** — eight Logical Reasoning, six Reading
   Comprehension — each with a published name, a plain-language name, three
   steps, and citations to LSAC, 7Sage or PowerScore.
2. **Candidate matching** (`_candidate_keys`) — which approaches a question may
   carry, read off its type, stem, stimulus and passage. Two to six per
   question; mean 2.83.
3. **A per-student selector** among the candidates — uniform over the
   least-sampled while any candidate is under three observations (five on the
   types the last mega-litigation marked weak), then ranked on that student's
   own posterior accuracy, pace, calibration and explanation quality, with a
   30% chance of taking the runner-up.
4. **An offer trial** — 75% prompt, 25% control, drawn per question, with the
   propensity recorded on the row.
5. **Fourteen enforcement gates**, one per approach, all deterministic: word
   counts, sentence counts, set membership, token overlap. No model opinion
   ever blocks a submission.
6. **A mastery step-down** — eight satisfied gates at 75% accuracy and the gate
   relaxes to an attestation.
7. **A mandatory sub-arm** — a quota of two per run, six per day, drawn
   uniformly from a pool restricted to the three strata where the estimate is
   thinnest and offers are most often declined.
8. **A stand-down exit** from a mandatory approach — two server-side rejections
   or ninety seconds in the panel.
9. **A per-student dashboard reading** — intention-to-treat, Hájek-weighted by
   the recorded propensity, both arms shrunk toward no difference, an evidence
   grade on the contrast, and arithmetic telling the student how many more
   questions each side needs.

Every one of these is carefully built and carefully commented. This is not a
pile of accreted features; somebody thought about each piece.

---

## 2. What it is delivering

### The teaching feature is delivering, and I cannot prove how much

A student meets a named technique with three concrete steps on most questions,
and on some of them the interface will not accept an answer until the steps are
on the record. That is a real intervention with a plausible mechanism. It is
also, for the moment, the only thing here whose value is not in doubt.

The 47% decline rate is the one number that could argue against it, and it has
two readings that the current data cannot separate:

- **The offer is unwanted.** Students decline because a suggestion mid-question
  is an interruption.
- **The offer is wanted but expensive.** Students decline because the *gate* is
  heavy, not because the technique is unwelcome.

These have opposite remedies and the query that separates them is small: split
`strategy_gate_status` by `strategy_key`, by position in the run, and by
`strategy_enforcement_level`. If declines cluster on the heavy gates and late
positions, it is cost. If they are flat across approaches and positions, it is
the interruption. **I would run that before changing anything about the gates.**

### The research instrument is not delivering, and the arithmetic says it cannot

The dashboard names a leading approach for a section only once the *thinner*
side of that approach's comparison is worth at least ten questions — an
effective sample of ten, which is cheapest at twenty prompt-arm questions
against twenty controls. Controls are a quarter of assignments, so that is
eighty assignments of one approach.

Divide by how much of a section each approach is even a candidate on
(`python3 tools/audit/strategy_candidates.py`):

| approach | candidate on | questions that student must be served |
|---|---|---|
| `argument_core`, `prephrase` | 100% of LR | 80 |
| `passage_map`, `textual_proof` | 100% of RC | 80 |
| `viewpoint_ledger` | 32.6% of RC | 245 |
| `scope_precision` | 25.6% of LR | 312 |
| `main_point_synthesis` | 18.2% of RC | 440 |
| `flaw_abstraction` | 17.1% of LR | 467 |
| `paragraph_function` | 15.8% of RC | 505 |
| `role_map` | 15.3% of LR | 522 |
| `conditional_chain` | 14.3% of LR | 558 |
| `causal_audit` | 10.8% of LR | 741 |
| `comparative_matrix` | 8.5% of RC | 946 |
| `negation_test` | 3.8% of LR | 2,078 |

Three things make this worse than it reads.

**It is a lower bound, and a generous one.** It assumes the approach is chosen
every single time it is a candidate. The coverage phase roughly delivers that
for a rare approach, for its first three observations. After that the selector
offers its leader, so only the four approaches that are candidates on *every*
question in their section keep accumulating at anything like this rate.

**Declines dilute it.** An intention-to-treat difference measured where roughly
half the offers are declined is roughly half the technique's own effect, and a
halved effect needs about four times the sample to resolve. That is not my
argument; it is the argument `strategies.information_need` already encodes as
its dilution factor. Multiply the table by four for the sample that would
actually separate anything: `argument_core` at 320 questions, `negation_test`
at eight thousand.

**The file already knows.** `_result_copy` carries a comment saying a
per-student verdict on twelve named strategies needs roughly 11,000
observations, and every student-facing sentence it writes is scrupulously
non-committal because of it. The instrument is honest about being unable to
answer its own question. It just keeps asking.

Priced against the other adaptive layers, that comment is if anything
understated. `python3 tools/audit/measurement_cost.py` puts the offer trial at
**468,907 answers** to settle, because it is not one question but twenty-eight
— fourteen approaches in each of two sections — against 36,284 for interleaving
and 47,100 for weak-type targeting. It is the most expensive question in the
product by an order of magnitude, and the multiplier is the reason.

### And the estimate it could answer was never computed

Here is the part I did not expect. `strategy_performance(user_id)` was the only
reading of the trial in the codebase, and every query inside it filters on that
student. There was no cross-student estimator anywhere in the application.

The randomisation did not need fixing for one. It is already a valid trial at
cohort scale: arms drawn independently per encounter, propensity written to the
row, intention-to-treat discipline held throughout, control and prompt labels
kept apart so two presentations of the same assignment can be separated later.
Everything a pooled analysis needs was on the table. Nobody had run the query
without the `WHERE user_id =` clause.

And pooling does not merely help — it changes the shape of the cost. Twenty
controls on one approach take eighty assignments **from one student**. Across a
hundred students they take eighty assignments **in total**, which is under one
question each. The holdback stops being a tax each student pays in full and
becomes one the cohort shares.

> **Done.** `strategies.strategy_population_reading()` is that query. It groups
> by section and approach across all students, applies the same Hájek weighting
> and the same intention-to-treat discipline the per-student reading uses, and
> reports a 95% interval on each difference alongside a student-stratified
> estimate as a check against one heavy account carrying a cell.
>
> Two things about it are worth knowing before it is read. It distinguishes
> **measured** from **leading**: a cell with enough sample to say something is
> measured, and only a cell whose interval clears zero is leading. Reporting the
> best point estimate of a set of noisy cells as a winner is how a trial of
> fourteen approaches finds a winner every time it is run. And it changes
> nothing about what any student is served — it is a reading, not a mechanism.
>
> `python3 tools/audit/strategy_trial_population.py` prints it, together with
> the selection layer's reading and the independence check between the two
> draws.

---

## 3. What I would cut

**The per-student "leader" and the shortfall arithmetic.** The panel tells a
student "about 25 more with it and 25 more without would put splitting the
argument over that line". For ten of the fourteen approaches, the line is
hundreds of questions away and the selector has stopped offering the approach.
The sentence is arithmetically correct and practically false, which is the
worst combination: it is a promise the machinery cannot keep, and it is exactly
the kind of confident-and-wrong claim this project has been burned by.

I would keep the panel and change what it is a panel *about*: this student's
running totals and compliance, plainly labelled as description, next to what
the cohort has found. That is a smaller claim and a true one.

**Nothing else here, but one thing next door.** I looked for a layer to delete
in this apparatus and did not find one. I did find one adjacent to it and it is
gone: `practice_style` had a single legal value, so the "two case shapes" it
implied were one code path, and `assign_strategy_trial` carried a guard against
a value nobody could pass. Deleted, with the invariant it was nominally
protecting reasserted where it is true. See `docs/learning-system.md` §6.

The closest candidate inside the apparatus is the 30% runner-up explore, which
buys little per student. I would still not touch it on this evidence, and now
there is a better reason than deference: `strategy_selection` has an off arm as
of this branch, so what the ranked selector is worth — exploration term
included — is a question the app can now answer rather than argue about.
Changing the term before that reading exists would throw away the comparison.

---

## 4. What I would keep, and why

**The 25% control arm.** It is the only thing in the product that makes any
claim about approaches falsifiable, and deleting it would leave the effective
contrast sample at zero forever — the panel would go on advising students to
collect questions the app had stopped producing. Once the analysis is pooled I
would narrow it, to 10% or lower, since a cohort fills a comparison far faster
than a person; but the arm stays.

**The gates.** They are the only compliance signal in the app that is not a
self-report about a private mental act, and everything downstream — the
dilution factor, the mastery step-down, the CACE fit that becomes possible —
rests on them. Their design rule, structure over nagging with the weakness
written down where a gate cannot be strong, is better than most of what I have
read in production code.

**The mandatory sub-arm.** It is the newest and most suspicious-looking piece,
and it is the one attacking the real problem. Declines are what makes the ITT
estimate weak, so an arm that removes the decline is buying dose rather than
rows, which is the correct thing to buy. The design keeps the two decisions
apart properly: *which strata* to invest in is optimised, *which question
inside them* is a uniform draw with an exactly writable propensity, and the
prompt-versus-control draw is untouched.

One caution, which is my own doing. `stratum_key` is
approach × section × question type, and the type fix in this branch takes the
bank from 92 strata to 150, with the share holding fewer than twenty questions
rising from 27% to 36%. The fix did not create the thin cells — the old count
was small because the placeholder pooled the whole untyped bank into single
cells — but `information_need` now ranks more, thinner cells, and a mechanism
that concentrates on the three thinnest may now be spending its two questions a
run on cells that will never fill. If the mandatory arm produces nothing over
the next few weeks of data, this is the first place I would look.

**The intention-to-treat discipline, unconditionally.** Defining treatment by
assignment rather than by `strategy_applied` is the single most important
decision in this file, and it would be quietly undone by anyone who thought
they were improving the estimate.

---

## 5. What I would merge

**The offer trial's control draw into the spine.** `assign_strategy_trial`
draws prompt-versus-control at a fixed threshold and writes its own propensity
column — the same shape as `experiments.assign` on an `item` exposure. Merging
them puts one draw, one propensity convention and one health check across the
whole product, and it puts the strategy trial inside the per-student allocation
audit that would have caught its own collapse. The two are close enough that
this is a merge and not a rewrite.

**~~`_contrast_sample`, which now exists twice.~~ Done.**
`strategies._contrast_sample` is a call to `experiments.contrast_sample`. It
was duplicated deliberately while both files were being rewritten at once; two
copies of an estimator is two things to keep in step.

**The selector's prior with the cohort's.** Today a new student's bandit starts
from nothing and spends its coverage phase re-discovering what every other
student has already shown. Seeding each approach's posterior from the pooled
estimate would fix the cold start and the unreachability at once: the student's
own data still moves the ranking, it just no longer has to carry it alone. This
is the change I would make second, after the pooled analysis exists to seed
from — which it now does, so this is the next thing rather than a distant one.

It is also more urgent than it looked, because the unreachability is worse than
the earlier audit stated. `python3 tools/audit/rank_reachability.py` runs an
approach that goes 1-for-3 in coverage by bad luck, twenty times per condition,
with every outcome fed back so the ranking is free to move. It is offered again
in **1 run of 20** when it is genuinely the best approach on the question, and
**2 of 20** when it is genuinely the worst. The same rate, because its posterior
is frozen until it is offered and therefore cannot be evidence about itself.
What releases it is the *runner-up* drawing a bad streak — someone else's luck.
A cohort-seeded prior attacks this at the root: the exclusion would then be made
against evidence from every student rather than against three observations.

---

## 6. What would change my mind

I would rather state these than pretend the recommendation is unconditional.

- **If declines turn out to be concentrated in a few heavy gates**, the
  dilution factor above is overstated for most approaches and the per-student
  reading is less hopeless than the table suggests. The query in §2 decides it.
- **If the strategy agent's rewrite widens candidate matching substantially**,
  every number in the reachability table moves. It should be re-run after that
  branch merges; the probe is checked in for exactly that reason.
- **If the population is small** — a handful of students rather than hundreds —
  pooling buys much less than I have claimed, and the honest conclusion becomes
  "this cannot be measured at all", which argues for keeping the teaching
  feature and retiring the instrument rather than re-aiming it.
- **If a cohort estimate is unwanted for product reasons** — if the point was
  always personalisation rather than knowledge — then the recommendation
  inverts: cut the trial, keep the gates, and stop implying the app is learning
  anything about the techniques.

---

## 7. What I touched

**The data underneath.** `question_type` is the first thing `_candidate_keys`
reads, and 45.8% of the bank was carrying a placeholder equal to its own section
name. That is now 12.5%, and the effect on this apparatus is measured: questions
with only two candidate approaches fall from 44.8% to 36.6%, with
`scope_precision` gaining 280 questions, `conditional_chain` 201 and
`flaw_abstraction` 123. A two-candidate question is a two-armed bandit, so this
widens the instrument's choice set as a side effect of fixing the routing.

**A reading, and only a reading.** `strategy_population_reading` and
`strategy_selection_reading` compute across students; `strategy_selection_health`
checks the two draws are independent per student. None of them decides anything.

**One off arm, and the independence it required.** `strategy_selection` is now
registered with the spine: a quarter of eligible questions pick uniformly among
the candidates instead of by the student's ranking. Making that safe meant one
change to the offer trial — the chosen approach is no longer part of the offer
arm's hash. Two randomisations sharing an input are not independent, and the
whole argument for reading the selection layer inside the treated population
rests on them being so. Same propensity, same shares, different draw, and the
design version moves accordingly.

**The exposure the trial draws on**, which arrived from a sibling branch and is
the failure the whole spine generalises: `assign_strategy_trial` now takes a
required, keyword-only `exposure` so each encounter is its own draw.

`backend/app/enforcement.py` is untouched, and nothing in this branch changes
which approach a student is offered except by way of the uniform arm above.
`python3 tools/audit/strategy_trial_population.py` prints the new readings;
`python3 tools/audit/measurement_cost.py` prices them.

---

## 8. The decision I am asking for

Three, in order of how much they change:

1. ~~**May the trial be analysed across students?**~~ **Answered yes, and
   built.** One new reading, no change to how anything is drawn, no change to
   what a student sees.
2. **Should the holdback narrow from 25%?** A cohort fills a comparison far
   faster than a person, so the current holdback buys precision nobody needs at
   a cost every student pays. This is now a decision with a number behind it
   rather than an intuition: the pooled reading will show how fast the cells
   actually fill, and the honest moment to narrow the holdback is when it does.
   Narrowing it is a new `design_version`, and the two periods must not be
   pooled.
3. **Should the per-student panel stop promising a verdict it cannot reach?**
   This one is visible to students and is the only item here with a UI
   consequence. It is also the one I feel most strongly about, and the pooled
   reading now gives the panel something true to say instead: this is what you
   have done, and here is what the cohort has found.

Reproduce the numbers with:

```
python3 tools/audit/strategy_candidates.py        # candidate widths, reachability, strata
python3 tools/audit/measurement_cost.py           # what each layer costs to settle
python3 tools/audit/rank_reachability.py          # whether a shut-out approach returns
python3 tools/audit/strategy_trial_population.py  # the pooled readings, needs a database
```
