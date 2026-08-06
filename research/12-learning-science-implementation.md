# Learning Science — Implementation Spec

Converts the findings in `01-learning-science.md` into mechanisms in this codebase. Every code
reference below was read and verified. This is a specification; no application code was modified.

**Framing constraint.** The evidence puts a realistic ceiling on this product at **2.5–4 LSAT points**
(`01 § realistic gains`). There is not room to build everything, so §10 ranks by expected point gain
per engineering hour and says plainly what to skip.

**Scarcity constraint.** The 6,886-item bank is being deleted. Replacement is a few hundred items, not
thousands. Every mechanism below is specified to work *better* as the pool shrinks, not worse — this
inverts several conventional recommendations and is the main reason this spec differs from a generic
"apply learning science" list.

---

## 1. Two defects found while reading the code

Both are prerequisites, not enhancements.

### 1.1 An N+1 query in the hot path

```339:341:backend/app/services.py
    unseen = [question for question in eligible if not user_id or question.id not in _seen_question_ids(user_id)]
    pool = unseen if len(unseen) >= count else unseen + [question for question in eligible if question not in unseen]
    return random.sample(pool, k=min(count, len(pool)))
```

`_seen_question_ids(user_id)` is a database query (`services.py:315-324`), and it sits inside the
comprehension's condition, so **it is re-executed once per candidate question**. The `not user_id`
short-circuit only saves the anonymous case, which is not the normal one.

Verified by executing the exact comprehension structure against a 6,886-element list: with `user_id`
set, the function is invoked **6,886 times**; with `user_id` as `None`, zero times. Each invocation is
a join across `SessionItem` and `Attempt`, so session creation currently issues several thousand
redundant queries for a result that never changes within the call.

Hoist it to a single call before the comprehension. One line, and it likely accounts for a visible
share of session-start latency today.

The second line has an `O(n²)` companion: `question not in unseen` performs a list scan per item.
Use a set of ids.

### 1.2 Selection is random, and "unseen" is the only memory

`select_random_questions` filters by source, optionally by type, prefers unseen items, and then calls
`random.sample`. There is no difficulty targeting, no interleaving policy, no spacing logic, and no
exposure control. This is the single largest gap between what the app does and what the evidence says
drives gains — `01`'s central finding is that **targeting, not volume, produces improvement**, and the
current selector is pure volume.

---

## 2. Question selection

**Evidence:** `01 § desirable difficulties`, `§ interleaving`, `§ deliberate practice`. Targeting is
the mechanism; interleaving by question type produces durable discrimination skill; items far above or
below current ability teach little.

**The blocking dependency.** Difficulty targeting is **impossible today** and will remain so until
items carry real parameters. Every current item has `difficulty = 3`, and `11-measurement-implementation-spec.md § 5`
specifies replacing that default with `NULL` meaning uncalibrated. So selection must be written to
degrade cleanly through three regimes, and will spend months in the first two.

**Specify a scored selector** replacing `random.sample`, choosing the top-k by weighted score:

```
score(q) = w_type   · type_need(q)        # under-practiced types score higher
         + w_space  · spacing_fitness(q)  # time since this student last saw it
         + w_diff   · difficulty_fit(q)   # 0 when uncalibrated — see below
         + w_expose · exposure_penalty(q) # global over-exposure suppressed
         + ε                              # small jitter to avoid deterministic sequences
```

- **Regime A (launch, no calibration):** `w_diff = 0`. Selection is type-balanced with spacing and
  exposure control. This is already far better than random, and it needs no item parameters.
- **Regime B (provisional):** once an item clears ~30 responses, `w_diff` fades in proportional to
  parameter confidence.
- **Regime C (calibrated):** target items where the student's success probability is roughly 0.6–0.8.
  Not maximum information — that is a testing objective, and `01` is clear that the learning optimum
  sits at a higher success rate than the measurement optimum.

**`type_need`** is the important term at launch and requires only a question type, which
`11 § 5` makes mandatory at ingestion. Compute it from the student's per-type accuracy and volume in
`SkillProgress`, favouring types that are both weak and under-practiced. Interleave by construction:
never emit more than two consecutive items of one type unless the pool is too small to avoid it.

**Exposure control matters far more than it used to.** With ~350 items and a committed student doing
40 questions a week, the pool is exhausted in about nine weeks. `exposure_penalty` should suppress
globally over-exposed items so anchors and hard items are not burned early, and item reuse should be
routed deliberately through the review queue (§4) rather than happening accidentally through
`random.sample` running out of unseen items — which is what the current fallback at `services.py:340`
does silently.

**Effort:** 1.5–2 days including the two fixes in §1. **Verification:** per-type distribution flattens
over a session; no student sees the same item twice outside the review queue.

---

## 3. Self-explanation dosage

**Evidence:** `01` found mandatory self-explanation on 100% of items is **not** evidence-supported —
the effect is real but subject to diminishing returns and fatigue, and blanket application is one of
the clearest instances of the expertise-reversal effect.

**Current state.** Written reasoning is required in deep and review at 120 characters, and in speedrun
and infinite at 40:

```35:35:backend/app/services.py
REASONING_MIN_CHARS = {"deep": 120, "review": 120, "speedrun": 40, "infinite": 40}
```

`requires_reasoning=True` is set unconditionally for deep sessions (`services.py:500`) and for appended
infinite items (`services.py:852`). Diagnostics correctly exempt it (`services.py:40-41`).

**This is also the largest variable cost in the product** — every explanation triggers frontier-model
grading — so dosage is simultaneously a pedagogical and a margin decision. A parallel workstream is
costing it.

**Specify a trigger rule** rather than a blanket flag. Require written reasoning when any of these
hold, and otherwise offer it as optional:

1. The answer was **wrong**.
2. The answer was right but **confidence was low** (`confidence <= 2`).
3. The answer was right but **slow** (elapsed > target).
4. The item is of a **type the student is currently weak in** (below their own median accuracy).
5. A **random 15% sample** of everything else — needed so the graded-explanation signal stays
   unbiased for the review scheduler in §4, which consumes it.

Conditions 1–3 are already computed, in `_entry_reason` (`services.py:873-885`). That function encodes
a good theory of when an item is worth revisiting; the same predicate should govern when explanation
is worth demanding. Reusing it keeps the two systems consistent by construction.

Expected effect: reasoning demanded on roughly 35–45% of items instead of 100%, concentrated where it
teaches. Note the ordering problem — conditions 1–3 are only knowable *after* the answer. That is
fine and in fact better: post-answer explanation is where the self-explanation literature's evidence
actually sits, and it removes the pre-answer typing tax that makes the current loop feel heavy.

**Effort:** ~1 day. **Verification:** explanation rate lands in the target band; per-type accuracy
trends do not degrade relative to the current cohort.

---

## 4. Spaced repetition and the review queue

**Evidence:** `01 § spacing`, `§ retrieval practice`. Also `06-current-app-audit.md`, which lists the
explanation-grade-to-interval coupling among things worth protecting.

**The audit is right, and this is the best-built part of the app.** Entry into the queue is governed
by a genuinely thoughtful predicate — not merely "got it wrong," but high-confidence errors,
*unsupported* correct answers, low-confidence correct answers, and slow correct answers
(`services.py:873-885`). Advancement is driven by explanation quality, with `Excellent` skipping two
intervals and `Invalid` resetting to zero (`services.py:888-917`). The two-phase scheduling that
recomputes from `pre_grade_interval_index` so a provisional advance is not compounded
(`services.py:919-926`) is careful work. **Do not rewrite this.**

Three targeted changes:

1. **Extend the ladder.** `REVIEW_INTERVAL_DAYS = (1, 3, 7, 21)` (`services.py:34`) tops out at 21
   days, so an item can be "mastered" 32 days after first contact. For a 3–6 month prep cycle, add a
   45-day and a 90-day interval. Cheap, and it converts the queue from a within-month tool into one
   that spans the whole study period.
2. **Resolve spacing versus scarcity.** With a small pool, review items and new items compete for the
   same slots. Specify the split explicitly — target ~30% review when the queue has due items, and
   let review take priority as the unseen pool depletes. Today the two paths are independent
   (`_questions_due_for_review` at `services.py:397` versus `select_random_questions`), with nothing
   arbitrating.
3. **Make mastery revocable.** Currently `mastered` is terminal. With a small pool, a mastered item is
   a wasted asset; re-test a sample of mastered items near the test date, which is also the highest-value
   retrieval practice available.

**Effort:** ~1 day for all three.

---

## 5. Feedback timing and content

**Evidence:** `01 § feedback timing` — immediate correctness feedback is fine for retrieval practice;
elaborated explanation is more effective slightly delayed, and delay costs nothing when review is
scheduled anyway.

The current loop shows a verdict stamp immediately (`frontend/src/components.tsx:972`). Keep that.
Specify the split:

- **Immediate:** correct/incorrect, the credited answer, and one sentence naming the trap the student
  fell into. Trap identification is the single most instructive element and belongs in the moment.
- **Deferred to review:** full elaborated explanation and explanation grading. This also lets the LLM
  call move off the critical path into the existing async job system (`backend/app/jobs.py`), which
  improves both perceived latency and cost.

**What makes an explanation instructive** rather than merely correct: it must say why the attractive
wrong answer is attractive. Per `07-corpus-reference-distribution.md`, an isolated extreme quantifier
marks a *wrong* answer 84% of the time — that is a concrete, teachable trap pattern the explanation
generator should name explicitly when it applies.

---

## 6. Metacognitive calibration

**Evidence:** `01 § metacognition`. Real but modest effects; the strongest results come from
calibration *feedback*, not from collecting confidence ratings alone.

Confidence is already collected (`models.py:170`, constrained 1–5) and already used well — it feeds
`_entry_reason` to flag high-confidence errors. **The collection is earning its keep; a dedicated
calibration interface would not.**

Specify the minimum: a single calibration line on the progress surface — "you were confident and wrong
on 12 questions this month; that number is down from 19." That is the feedback the literature supports,
costs almost nothing, and needs no new input from the student. **Do not build a blind-review mode or a
predicted-score interface.** Ranked against a 2.5–4 point ceiling, they do not clear the bar.

---

## 7. Deliberate practice and the grinding problem

**Evidence:** `01 § deliberate practice` — effortful practice at the edge of ability with immediate
feedback and specific goals; volume without targeting is the thing that does not work.

Most of this is delivered by §2 and §4. The one addition worth building is a **grind detector**: when a
student's recent accuracy on a type is flat across 40+ attempts, the app should say so and route them
to review or to a different type rather than serving more of the same. `01`'s central correction to
the founder's thesis is that volume is not the mechanism, and a product that silently accepts grinding
is endorsing the wrong model even if its selector is good.

Keep it a suggestion, not a block. Half a day.

---

## 8. The gamification rewrite — with a correction to `01`

**I partially disagree with `01` here, and the code is the reason.**

`01` characterises the case-fee system as **completion-contingent** reward, which the motivation
literature treats as the most damaging contingency. Reading `settle_attempt` in `backend/app/game.py`,
that is not what is implemented:

```
reward_eligible = locked_attempt.is_correct and band != "Invalid"
effort_eligible = (not locked_attempt.is_correct) and band in EFFORT_MISS_MULTIPLIER
validated       = locked_attempt.is_correct and band in {"Good", "Excellent"}
```

Payment requires a **correct answer plus a non-Invalid explanation**, with a reduced consolation
payment for a wrong answer accompanied by genuine reasoning. That is **performance-contingent** reward
carrying competence information — a materially different category, and one the literature treats far
more favourably. Deci, Koestner and Ryan's meta-analytic finding of undermining is strongest for
task- and completion-contingent rewards; performance-contingent rewards that signal competence are
roughly neutral and can be positive.

**So the recommendation to move fees to session boundaries is weaker than `01` implies, and I would
not spend pre-launch time on it.** What remains genuinely worth changing:

1. **Reward density, not contingency.** A payout on every item makes the economy the loudest signal in
   the loop. Keep per-item settlement, but move the *salient* celebration to case completion, which is
   already a natural unit — clients have a `length` of 6–10 questions (`game.py:310-320`).
2. **Re-tie firm tier to demonstrated ability.** This one I fully endorse. Progression currently keys
   off accumulated earnings, so a grinder outranks a stronger student who practiced less. Gate tier on
   ability estimate or per-type mastery once `11`'s engine exists. Until then, gate on validated
   correct answers rather than raw fee totals — a small change to the same ledger.
3. **Default the economy off in Focus Mode**, per the market finding that 168+ targeters read the game
   layer as unserious.

Do **not** rip out the economy. `01`'s own gamification section, and the market research, agree it buys
dosage — and dosage is worth real points when the selector is finally targeting well.

---

## 9. What is blocked, and on what

| Mechanism | Blocked by | Unblocks when |
|---|---|---|
| Difficulty targeting (Regime C) | No calibrated item parameters | Rasch engine + ~30 responses/item |
| Information-based readiness | Same | Same |
| Adaptive item selection (CAT) | Same, plus pool size | Not before Phase 2 |
| Type-based interleaving | ~46% of items untyped | Mandatory type at ingestion (`11 § 5`) |
| Everything else here | Nothing | Now |

The takedown helps rather than hurts: it converts "backfill 6,886 rows" into "constrain the ingestion
path," which is a day and a half of work on a pool that starts empty.

---

## 10. Priority, by expected point gain per engineering hour

**Pre-launch, in order:**

1. **Fix the N+1 and the O(n²) scan** — 1h — §1.1. Pure latency win, no pedagogy required.
2. **Scored selector, Regime A** — 1.5–2d — §2. *The highest score-impact item available.* Targeting is
   the mechanism `01` identifies; the app currently does none of it.
3. **Self-explanation trigger rule** — 1d — §3. Pedagogically better and materially cheaper; reuses an
   existing predicate.
4. **Exposure control + review/new arbitration** — 1d — §2, §4.2. Without it the small pool is
   exhausted in about nine weeks.
5. **Extend review intervals to 45 and 90 days** — 2h — §4.1. Nearly free.
6. **Firm tier keyed to validated correct answers** — 4h — §8.2.

**Phase 1:** grind detector (§7); calibration line (§6); deferred elaborated feedback moved async (§5);
revocable mastery (§4.3).

**Phase 2, gated on the measurement engine:** difficulty targeting Regimes B and C; ability-gated
progression.

### Honest assessment: what actually moves a score

**Genuinely score-moving:** targeted selection (§2), the review queue that already exists (§4), and
trap-naming in feedback (§5). These are the mechanisms with both good evidence and real leverage here.

**Good practice, marginal points:** calibration feedback (§6), the grind detector (§7). Cheap enough to
justify, but do not expect them to show up in a score.

**Not worth building:** blind-review mode, a dedicated metacognition interface, predicted-score
display (and `11 § 8` independently forbids the last one). Against a 2.5–4 point ceiling, these consume
weeks and return approximately nothing.

**The uncomfortable one:** the strongest available intervention is not on this list, because it is
content. A selector cannot target difficulty that does not exist, and interleaving cannot balance types
that are not labelled. `01`'s "targeting beats volume" finding presupposes an item pool with real
metadata, which is precisely what the app is about to have to rebuild.
