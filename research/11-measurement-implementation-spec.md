# Measurement & Experimentation — Implementation Spec

Turns the statistical findings in `02-measurement-and-score-prediction.md` into changes in this
codebase. Every line reference below was read and verified, not copied from the audit.

**Scope note.** This is a specification. No application code was modified in producing it.

---

## 0. Summary of what changes

| # | Change | Ships pre-launch | Reason it can't wait |
|---|---|---|---|
| 1 | Fix the strategy estimator's **selection bias** | Yes — 2h | Currently biased in an unknown direction; not a sample-size problem |
| 2 | Retire the word **"confirmed"** | Yes — 1h | Four strings making a causal claim the data cannot support |
| 3 | Stop showing **quantized lift** as a precise number | Yes — 1h | Lift is a difference of rounded percentages; the digits are noise |
| 4 | **Log assignment propensity + a randomized exposure slice** | Yes — 4h | Unrecoverable retroactively |
| 5 | **Verified official score** capture | Yes — 4h | Unrecoverable, and the highest-value asset available |
| 6 | Item metadata **ingestion constraint** | Yes — 1.5d | Cheap now, impossible later |
| 7 | Pooled hierarchical estimate for strategies | Phase 1 | Needs volume that doesn't exist yet |
| 8 | Rasch ability engine + anchor set | Phase 1–2 | Blocked on item metadata and response volume |

---

## 1. The finding that outranks the sample-size problem

`02` established that the strategy A/B threshold of 8 prompted + 4 control has 5.3% power against a
plausible +5-point effect. That is correct and damning, but reading the code surfaced something worse,
which no prior memo caught: **the estimator is biased, not merely imprecise.** Raising the sample size
would not fix it.

The treatment group is constructed here:

```443:445:backend/app/strategies.py
        prompted = [value for value in values if value.strategy_variant == "prompt" and value.strategy_applied is True]
        controls = [value for value in values if value.strategy_variant == "control"]
        skipped = sum(value.strategy_variant == "prompt" and value.strategy_applied is False for value in values)
```

`strategy_applied` is **self-reported by the student after seeing the prompt** — it is posted from the
client at `frontend/src/components.tsx:638` and written through `backend/app/services.py:1023-1049`.
So the contrast being computed is:

- **Treatment:** students who were offered a strategy *and chose to apply it*
- **Control:** everyone assigned to control

That is a per-protocol comparison with **post-randomization selection on an endogenous variable**.
Randomization guarantees that `prompt` and `control` groups are exchangeable; it guarantees nothing
about the subset of `prompt` who opted in. A student is more likely to apply a strategy when they
recognize the question type and feel confident — exactly the conditions under which they were going to
answer correctly anyway. The `skipped` count is computed and then discarded from the analysis entirely.

The bias almost certainly inflates measured lift, though the sign is not guaranteed: a student might
also reach for a strategy precisely when stuck, which would push the other way. **That ambiguity is
the point** — the estimate is uninterpretable rather than merely noisy.

It also contaminates the bandit, which selects on the same filtered quantity:

```314:321:backend/app/strategies.py
    observations = (
        Attempt.query.filter(
            Attempt.user_id == user_id,
            Attempt.strategy_key.in_(candidates),
            Attempt.strategy_variant == "prompt",
            Attempt.strategy_applied.is_(True),
        ).all()
    )
```

So the allocation policy optimizes toward whichever strategies students *opt into* most successfully,
which is not the same as the strategies that *work*.

### The fix — intention-to-treat

Compare **all** assigned `prompt` against **all** assigned `control`, regardless of `strategy_applied`.
This is the standard remedy and it is a two-line change in each of the two call sites above: drop the
`strategy_applied` filter from both the analysis in `strategy_performance` and the bandit's posterior
in `assign_strategy_trial`.

Keep recording `strategy_applied`. It stops being the treatment definition and becomes two useful
things: a **compliance rate** worth displaying on its own ("you used this on 6 of 9 offers"), and the
input to a CACE/instrumental-variable estimate later, once volume supports it. Do not report the
per-protocol contrast as an effect at any sample size.

**Effort:** ~2 hours including test updates. **Verification:** `skipped` should become non-zero in the
prompted denominator; measured lift should move, and probably shrink.

---

## 2. Retiring "confirmed"

Four surfaces currently assert a causal finding. All originate in `_result_copy`.

```382:386:backend/app/strategies.py
    verdict = "confirmed" if status == "supported" else "checking"
    helping = (lift or 0) > 0
    if verdict == "confirmed":
        summary = f"{subject} is helping you." if helping else f"{subject} is not helping you."
        next_step = "Keep using it when it comes up." if helping else "Feel free to skip it when it comes up."
```

The threshold that gates it:

```468:468:backend/app/strategies.py
        status = "forming" if sample < 4 or control_sample < 2 else "directional" if sample < 8 or control_sample < 4 else "supported"
```

### Replacement copy

| Location | Current | Replace with |
|---|---|---|
| `strategies.py:382` | `verdict = "confirmed" if ...` | `verdict = "measuring"` for every state; drop the binary |
| `strategies.py:414` | `verdict_label: "confirmed"` | `"experiment running"` |
| `strategies.py:385` | `"{subject} is helping you."` | `"So far you're at {accuracy}% with it and {control_accuracy}% without."` |
| `strategies.py:386` | `"Keep using it when it comes up."` | `"Not enough to call yet — keep going and we'll keep counting."` |
| `strategies.py:409` | `"+{lift} points"` | See §3 |
| `strategies.py:528` | `"An approach is only called confirmed after at least eight questions with it and four without."` | `"We show your running totals. Telling a real effect from luck takes far more questions than a single person usually answers, so we report the counts rather than a verdict."` |
| `frontend/src/pages.tsx:112` | fallback `evidence_note` | match the new backend string |

The three-tier `status` (`forming` / `directional` / `supported`) can stay as an internal ordering
signal for `leader` selection at `strategies.py:504-509`, but must not reach the UI as a claim.
`frontend/src/pages.tsx:207` and `:232` render `verdict_label` into `strategy-evidence-badge`; the
badge should carry a neutral style, so the CSS class for the former `confirmed` state should be
retired alongside it.

**This is a positioning asset, not a retreat.** `05-market-and-competition.md` found that the audience
punishes overclaiming and that anonymity is the product's largest credibility gap. An app that says
"experiment running, here are the counts" is making a *stronger* trust claim than one that says
"confirmed" on twelve observations.

---

## 3. Lift is quantized; stop printing digits

```469:469:backend/app/strategies.py
        lift = accuracy - control_accuracy if sample and control_sample else None
```

`accuracy` and `control_accuracy` are each `round(correct / len(sample) * 100)`. With a control sample
of 4, `control_accuracy` can only take the values 0, 25, 50, 75, 100. **Every reported lift is a
difference of two coarse grids**, so a headline of "+7 points" implies a precision the arithmetic
cannot carry. At `control_sample = 4`, one additional correct control answer moves lift by 25 points.

Replace the headline at `strategies.py:409` with the raw fractions — `"9/14 with · 5/11 without"` —
and only introduce a percentage once both arms exceed ~30 observations. Fractions are honest at every
sample size and communicate uncertainty implicitly: a reader seeing `3/4` intuits what `75%` conceals.

---

## 4. Logging that must start before launch

`02` identifies data that is unrecoverable retroactively. Three items apply.

### 4.1 Assignment propensity

Assignment is currently a deterministic hash:

```355:356:backend/app/strategies.py
    variant = "control" if _stable_fraction(f"control:{seed}:{key}") < .25 else "prompt"
    return {"key": key, "variant": variant}
```

The variant propensity is therefore a known constant (0.25 / 0.75) and is technically recoverable. The
**key selection** propensity is not: it comes from the adaptive branch at `strategies.py:327-353`,
which depends on the student's entire history at that moment. That state is not reconstructible after
the fact.

Add to `Attempt`:

```python
strategy_propensity   = db.Column(db.Float, nullable=True)   # P(assigned variant | history)
strategy_policy       = db.Column(db.String(24), nullable=True)  # 'coverage' | 'exploit' | 'explore' | 'random'
strategy_candidates_n = db.Column(db.Integer, nullable=True)  # len(candidates) at assignment
```

Populate in `assign_strategy_trial` and persist through the write path in `services.py:1023-1049`.
Without these, inverse-propensity weighting is impossible and the bandit's allocation bias can never
be undone.

### 4.2 A randomized exposure slice

Under a pure bandit, no strategy is ever observed on a random sample of questions, so the pooled
estimate stays confounded however much data accumulates. Reserve a slice — **10% of eligible trials**,
selected by a hash on a dedicated namespace — where the key is chosen **uniformly at random** from
`_candidate_keys` and `strategy_policy` is recorded as `'random'`.

This slice is small enough to barely affect the student experience and is the only subset admitting a
clean unconfounded estimate. It cannot be recovered later; a bandit's history is permanently
non-random.

### 4.3 Verified official scores

`02` calls this the highest-value asset available, since no rigorous public quantification of the
practice-to-official-score relationship exists. New table:

```python
class OfficialScore(db.Model):
    id            = db.Column(db.String(80), primary_key=True)
    user_id       = db.Column(db.String(80), db.ForeignKey("users.id", ondelete="CASCADE"),
                              nullable=False, index=True)
    scaled_score  = db.Column(db.Integer, nullable=False)   # 120-180
    percentile    = db.Column(db.Float, nullable=True)
    test_date     = db.Column(db.Date, nullable=False)
    verification  = db.Column(db.String(24), nullable=False)  # 'self_report' | 'screenshot' | 'verified'
    consent_at    = db.Column(db.DateTime, nullable=False)
    consent_version = db.Column(db.String(24), nullable=False)
    created_at    = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    __table_args__ = (
        db.CheckConstraint("scaled_score >= 120 and scaled_score <= 180", name="ck_official_score_range"),
    )
```

Note `ondelete="CASCADE"` — and see §7 on the existing foreign-key hazard.

**Do not ship this without the consent flow.** A parallel workstream is producing
`09-privacy-and-compliance.md`; verified standardized test scores tied to identity are plausibly
sensitive personal data, and `consent_at` / `consent_version` exist so the lawful basis is provable
per row. Store the verification tier honestly — self-reported scores are the common case and must not
be silently modelled as verified.

---

## 5. Item metadata: constrain ingestion, don't backfill

The audit found all 6,886 items carry `difficulty = 3` and ~46% lack a question type, which blocks
targeting, adaptivity, and IRT. The takedown converts this from a backfill problem into a **schema
problem**, because the replacement pool starts empty.

Make it structurally impossible to ingest an unusable item:

- `Question.question_type` → `nullable=False`, constrained to a controlled vocabulary.
- Drop the `difficulty` default. An item enters with `difficulty = NULL` meaning *uncalibrated*, and
  acquires a value only from the Rasch fit. A hardcoded 3 is worse than a null, because it silently
  poisons any downstream targeting with fake information.
- Add `Question.calibration_status` — `'uncalibrated' | 'provisional' | 'calibrated' | 'anchor'`.
- Add `Question.exposure_count`, needed for exposure control against a small pool.

`07-corpus-reference-distribution.md` supplies the controlled vocabulary: the LR and RC type
distributions there were recovered from stem phrasing for ~69% of the old corpus and are a reasonable
starting taxonomy.

**Effort:** ~1.5 days including migration and ingestion validation. Trivial now, since the tables are
about to be emptied anyway.

---

## 6. The ability engine

### 6.1 Library decision: add nothing

`backend/requirements.txt` currently contains no numerical stack — no numpy, scipy, statsmodels, or
pandas. The deployment bootstraps by pip-installing on an **EC2 spot instance** at
`deploy/ec2/cloudformation.yaml:675-677`, so every dependency added is bootstrap time and a new
failure mode on an instance type that can be reclaimed and rebuilt at any moment.

**Recommendation: implement Rasch in pure Python.** This is not a compromise at the relevant scale.
JMLE for the Rasch model is Newton–Raphson on a one-parameter-per-item logistic — roughly 150 lines
using only `math`. At launch scale (a few hundred items, a few hundred students, tens of thousands of
responses) a fit is a few seconds of arithmetic. Revisit numpy when responses exceed ~10⁶, which is
far beyond the current horizon.

Reject PyMC or Stan outright: the full hierarchical Bayesian model `02` recommends is statistically
ideal and operationally wrong for a spot instance with no GPU and a 1.5-week runway. The honest
interim is JMLE with a fixed guessing correction, upgraded later.

### 6.2 Schema

```python
class ItemParameter(db.Model):        # one row per item per calibration run
    question_id      = db.Column(db.String(80), db.ForeignKey("questions.id", ondelete="CASCADE"),
                                 nullable=False, index=True)
    difficulty       = db.Column(db.Float, nullable=False)     # logits
    standard_error   = db.Column(db.Float, nullable=False)
    n_responses      = db.Column(db.Integer, nullable=False)
    infit            = db.Column(db.Float, nullable=True)      # misfit detection
    calibration_run  = db.Column(db.String(80), nullable=False, index=True)

class AbilityEstimate(db.Model):      # one row per student per run
    user_id          = db.Column(db.String(80), db.ForeignKey("users.id", ondelete="CASCADE"),
                                 nullable=False, index=True)
    theta            = db.Column(db.Float, nullable=False)
    standard_error   = db.Column(db.Float, nullable=False)
    n_responses      = db.Column(db.Integer, nullable=False)
    calibration_run  = db.Column(db.String(80), nullable=False, index=True)
```

Keeping every run rather than overwriting gives longitudinal ability trajectories for free, which is
what the progress surface needs, and makes a bad fit diagnosable after the fact.

### 6.3 Nightly batch

Existing SQS/Lambda infrastructure already handles async work (`backend/app/jobs.py`). Add a scheduled
job that fits the model and writes a new `calibration_run`. Anchor items are held at fixed difficulty
so runs stay on a common scale — this is the **fixed item parameter calibration** that ETS RR-24-03
found performs as well as separate calibration at double the sample size, which `02` identifies as the
single best return on engineering effort in its whole document. It is a constraint in the fit loop, not
an algorithm change: roughly a day of work for the equivalent of doubling the user base.

### 6.4 Day one, with zero response data

Every item is `uncalibrated`; no student has a theta. The app must behave well in this state for
**months**, not days, so this is the common case rather than an edge case.

- Selection falls back to type-balanced sampling with spacing (see the parallel learning-science spec),
  not difficulty targeting, since no difficulty exists.
- No percentile band is shown. The readiness surface says what it knows.
- A provisional theta appears once a student has ~30 responses on provisionally-calibrated items,
  labelled as provisional with its standard error visible.

---

## 7. Anchor items with a bank that is about to be deleted

Anchors must be **written first and protected**, since none can be inherited. From the replacement
pool, designate **25–40 items** spanning the ability range as `calibration_status = 'anchor'`.

Requirements that follow from `02`: anchors need ~400+ responses each to establish the scale, after
which new items join at ~250 responses. Every student must see anchors early — the natural vehicle is
the diagnostic, which also solves the sequencing problem, since diagnostic items are seen by everyone
before personalization begins. Anchors are exempt from exposure control, and must be excluded from
review-queue recycling so their response data stays close to first-exposure conditions.

**The binding constraint is anchor quality, not new-item volume.** 40 good anchors × 400 responses is
16,000 responses — reachable with a few hundred committed students, but only if anchor exposure is
deliberately engineered from day one rather than left to the selection policy.

---

## 8. What the readiness surface says

A 120–180 scaled score must not ship. `02` is unambiguous: it needs a common scale, ~400+ users with
*verified* official scores, and propagated linking error, and below ~100 paired scores the identity
function beats equating, meaning conversion would **add** error. Report instead:

- **Percentile band against an explicitly named norm group** — "among LSATSpeedrun users who have
  answered at least 100 questions," never an implied national percentile.
- **The band, not a point.** Show ±1 SE and let it visibly narrow as evidence accumulates. A band that
  tightens is a better progress motivator than a point estimate that jitters.
- **Honest unknown state:** "We don't know yet. Ability estimates need about 100 questions; you're at
  34." Do not fill the gap with a placeholder number.

### The improvement gate

Never claim a gain under ~3 points. LSAC's observed mean retake gain is **2.39 points**, below the
test's own measurement error and statistically indistinguishable from a generic practice effect. Gate
any improvement claim behind a Minimal Detectable Change computed from the student's own two standard
errors, with a practice-effect prior subtracted first. When the gate is not met, say "your estimate
moved, but not by more than our measurement error" — which is both true and, per `05`, a differentiator
no competitor offers.

---

## 9. Build order

**Pre-launch (~3.5 days)**
1. Intention-to-treat fix — 2h — §1
2. Retire "confirmed"; fractions instead of quantized lift — 2h — §2, §3
3. Propensity + policy + randomized exposure slice logging — 4h — §4.1, §4.2
4. `OfficialScore` table, gated on the consent flow — 4h — §4.3
5. Item metadata constraints and ingestion validation — 1.5d — §5
6. Anchor designation on the replacement pool — 0.5d — §7

**Phase 1 (weeks 2–6)**
7. Pure-Python Rasch JMLE + nightly batch + parameter tables — 3–4d — §6
8. Percentile band UI with honest unknown states — 2d — §8
9. Pooled empirical-Bayes estimate across students for strategies — 2d

**Phase 2 (triggered by data, not by date)**
10. Fixed-parameter anchor calibration — promote once anchors clear ~400 responses each
11. IPW-corrected strategy estimate — promote once the randomized slice clears ~500 observations
12. Practice-to-official score linking — promote at ~100 paired verified scores, per §8

---

## 10. What I judge not buildable now

- **The full hierarchical Bayesian Rasch model.** Right in principle, wrong for a spot instance with a
  1.5-week runway and no numerical stack. JMLE with fixed anchors gets most of the value.
- **Any per-student strategy verdict.** `02` shows the required n is unreachable for one person at
  realistic volumes. The per-student surface should show counts only; verdicts belong to the pooled
  cross-student model, and even then as posterior intervals rather than a binary.
- **CAT / adaptive item selection.** Requires calibrated items, which requires response volume on a
  pool that does not yet exist. Attempting it early produces adaptivity driven by noise, which is worse
  than random selection because it is confidently wrong.

---

## 11. Mandatory approaches: what forcing does to the estimate

Shipped. `strategies.plan_forced_arms`, `enforcement.STATUS_STOOD_DOWN`, migration 0035.

### The trap this avoids

An approach offered as a suggestion can be skipped, and a student who skips most of
them leaves a record made of the questions they already felt confident about. The
obvious fix — require the approach on the questions where the evidence is thinnest —
destroys the thing it is meant to feed. §1 established that the estimate reads as
causal only because the arm is unrelated to the question. Choosing the treated
questions *for* their characteristics is precisely that relationship, and the result
would be more data and worse recommendations, with a dashboard that looks better
while getting worse.

### The split

Two decisions, kept apart:

1. **Which strata to invest in.** Approach × question-type cells, scored by
   `information_need`: the posterior variance of the cell's current difference
   (∝ 1 / `_contrast_sample`, prior-damped) times the smoothed rate at which the
   offer there is being declined. The score reads four counts and no accuracy. This
   is a legitimate adaptive-design choice and is where "enrich the data" is satisfied.
2. **Which question inside them.** A fixed quota drawn uniformly without replacement
   from the pool, so every pool member carries one exact inclusion probability. This
   is what preserves identification.

### What each estimand now assumes

**Offer versus nothing** (the ranking in `_section_reading`, unchanged in code
except for pooling both prompt labels). The prompt/control draw is still one fixed
threshold at 0.25 in every stratum, so the arms still have the same question
composition and the propensity is still constant. What changed is the *content* of
the offer on some treated questions. The estimand is therefore the effect of the
offer regime as deployed — a mixture of suggestions and requirements whose
proportions move as strata fill — rather than a fixed treatment. `strategy_variant`
and `strategy_stratum` are on every row so a later analysis can split the mixture
rather than inherit this pooling.

**Required versus optional** (`_forcing_contrast`, new). Restricted to rows with a
forcing propensity strictly inside (0, 1), i.e. rows that were in a pool and could
have gone either way, and Hájek-weighted by that propensity because pool size and
quota vary run to run. Rows outside a pool have no counterfactual for this draw and
are excluded; they remain in the offer contrast, where they are still randomized.

Forcing does not add rows. It adds **dose**: an ITT difference measured where half
the offers are declined is roughly half the effect and needs four times the sample.
That is the mechanism by which this is an information gain rather than merely more
enforcement.

### Rejected: Thompson sampling over the forcing decision

Attractive and wrong here, for three reasons.

- The objective is wrong. Which approach to offer is already an adaptive choice
  (`assign_strategy_trial`); forcing is not a second attempt at that question. Its
  job is to buy information, and a variance-reduction rule states that directly
  where a reward-maximising one states it by accident.
- It would make the draw a function of accumulated *outcomes*. IPW stays valid
  conditional on history, but the naive within-cell mean on adaptively collected data
  is biased when the arm proportion tracks the running estimate — and this product
  lives at 10–30 observations per cell, which is exactly where that bias bites and
  asymptotics do not help.
- Propensities sharpen toward 0 and 1 as posteriors concentrate, so weights blow up
  in the cells with the most data and positivity fails in the rest.

The rule that shipped reads sample sizes and compliance only, both fixed before the
question is served, which makes the draw randomization conditional on history and
keeps it independent of the outcome being estimated.

### Rejected: moving the control share

Purely statistically, 25/75 is the wrong split: `_contrast_sample` at n₁ = 0.75N,
n₀ = 0.25N is 0.1875N against the 0.25N a balanced split would give, so a third of
the effective sample is being left on the table, and §1's shortfall copy already
tells students the control side fills slowest. It stays at 25% anyway. Halving the
share of questions that carry coaching to buy precision on a per-student estimate
that §10 says will never reach a verdict is paying in the product for something the
measurement cannot spend. Revisit if the pooled cross-student model lands.

### Caps and the way out

Two mandatory questions per run and six per day, so the mechanism reads as structure
rather than as nagging. The cap is applied to the run as a whole, which is why the
draw is planned for the whole run at once: a position-by-position draw under a cap
makes each position's probability depend on the ones before it, which is a valid
sequential randomization but leaves every row carrying a different propensity for
reasons unrelated to its stratum.

Standing down is recorded as `stood_down`, kept apart from `skipped`, and opens after
two server-side refusals or ninety seconds in the panel. It never costs anything: the
economy does not read compliance, and gate time is already held out of the pace score.
