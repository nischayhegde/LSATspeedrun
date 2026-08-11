"""Projected LSAT score, built on LSAC's actual scoring methodology.

Why this is not "accuracy times sixty plus one twenty"
------------------------------------------------------
LSAC's own description of scoring is short and load-bearing: "Your LSAT score
is based on the number of questions you answered correctly — your raw score.
All test questions are weighted exactly the same... There is no deduction for
incorrect answers. To make it easier to compare scores earned across different
LSAT administrations, your raw score is converted to an LSAT scale [120-180]."
  — https://www.lsac.org/lsat/lsat-scoring

Three consequences drive everything below.

1. **Raw score, then a per-form conversion.** There is no universal raw-to-
   scaled formula. Each administered form gets its own conversion table from
   LSAC's equating process, which is what lets a harder form's raw 67 and an
   easier form's raw 69 both mean 170. So a projection needs a real conversion
   table, and it needs to admit that the table it used is not the table the
   student's actual test will use. `EQUATING_SD_SCALED` below is that admission,
   and it is measured rather than guessed.

2. **LSAC does not report a bare number either.** Every official score is
   reported with a score band derived from the standard error of measurement,
   "approximately 2.6 points", spanning roughly three points either side at a
   two-thirds confidence level.
     — https://www.lsac.org/lsat/lsat-scoring/lsat-score-bands
   If LSAC will not claim a point estimate from a whole administered form under
   proctored conditions, this app certainly cannot claim one from a few dozen
   untimed practice questions. The band is the product; the midpoint is a
   convenience.

3. **This app only has part of a form.** The question bank is Logical Reasoning
   and Reading Comprehension only, sampled in arbitrary proportions by whatever
   the student happened to practice. A real form is a fixed composition, so the
   observed rate is reweighted to form composition before conversion (see
   `FORM_LR_ITEMS` / `FORM_RC_ITEMS`) rather than pretending the practice mix is
   the test mix.

Sources used, and how each is classified
----------------------------------------
* **LSAC primary** — the scoring description and score-band/SEM figure above,
  and the percentile table (`PERCENTILE_BELOW`), taken verbatim from
  https://www.lsac.org/sites/default/files/media/lsat-percentiles_2021_2024_accessible.pdf
  ("LSAT PERCENTILE TABLE: 120 to 180 Scale, 2021-2024 Testing Years").
* **Derived from published conversion charts** — `RAW_TO_SCALED` is the *median*
  conversion across 59 real post-August-2024 LSAC charts (PrepTests 101-159),
  consolidated at https://7sage.com/lsat-resources/lsat-score-calculator. A
  median across the modern era is used in preference to any single released
  form for two reasons. Individual forms are outliers in both directions — the
  released Flex form FL0A08 needs only 71% correct for a 160 where the modern
  median needs 75% — and single-form reproductions are the least reliable
  category of source here: the widely-circulated Kaplan "May 2020 Flex" table
  disagrees with LSAC's own FL0A08 chart, and at least one published table is
  perfectly linear and so cannot be a real equated scale at all.

  Note also that the 2020 Flex is *not* the current composition, contrary to how
  it is usually described: it was one Logical Reasoning section, one Reading
  Comprehension, and one Analytical Reasoning. Analytical Reasoning was removed
  in August 2024 and the second Logical Reasoning section restored, which is why
  only PrepTest 101 onward is used here.
    — https://www.lsac.org/blog/what-to-expect-starting-with-august-2024-lsat
* **Derived from the same charts** — `EQUATING_SD_SCALED` is the standard
  deviation of scaled score at a fixed number of missed items across those 59
  charts. Measured at 1.09 scaled points, near-constant from 4 to 60 items
  missed, and consistent with the 1-2 point interquartile spread those charts
  show at a fixed raw score.

What this deliberately does not claim
-------------------------------------
The bank is not an equated, IRT-calibrated form. Its items were not pretested
on this population, and a practice set is not a proctored administration.
`BANK_CALIBRATION_SD` is a standing allowance for that, and unlike the other
terms it is a judgement call rather than a published or measured constant --
labelled as such so nobody later mistakes it for one.

Why the estimate is shrunk toward the population, and the two band invariants
-----------------------------------------------------------------------------
An unshrunk proportion is a terrible estimator at n = 1. One correct answer is
100% correct, converts to a raw 77, and reports a 180 at the 99.85th percentile
— which is not a projection, it is a restatement of the single answer. So the
observed rate is not used directly: it is shrunk toward a population prior with
a weight that decays in effective sample size (`PRIOR_STRENGTH`,
`PRIOR_ACCURACY`), which is the standard Beta-binomial / empirical-Bayes
posterior mean. The first few answers barely move the estimate off the
population median; a few hundred move it wherever the evidence says.

Two invariants are then enforced by construction rather than checked after the
fact, because both were violated before:

1. **The reported number is the midpoint of the reported band.** The band is
   built as centre +/- one half-width and the score *is* that centre, so the UI
   cannot print "MIDPOINT 180" under a 158-180 band again.
2. **The band never widens as evidence accumulates.** The half-width is a
   function of the effective sample size *alone* — never of the observed rate —
   and that function is strictly decreasing. See `_sampling_sd`.
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timedelta
from typing import NamedTuple

from sqlalchemy import select

from .extensions import db
from .models import Attempt, Question, ScoreProjection, SessionItem, User, utcnow


# Bumped when the tables or the weighting change, so a stored snapshot always
# says which model drew it and old points are not silently reinterpreted.
# v3 added shrinkage toward the population prior and rebuilt the band as a
# symmetric interval whose width depends only on the effective sample size.
MODEL_VERSION = "lsac-2023-2026.v3"

# --- LSAT form composition --------------------------------------------------
# LSAC: "The three scored sections of the LSAT will include two sections of
# Logical Reasoning questions and one section of Reading Comprehension
# questions", plus one unscored variable section.
#   — https://www.lsac.org/lsat/register-lsat/accommodations/specifications-lsat-and-lsat-argumentative-writing
# Sections run 24-26 (LR) and 26-28 (RC) items, so a form is 75-79 scored items.
# Across the 59 modern charts behind `RAW_TO_SCALED` the observed maximum raw is
# 76-79 with a mode of 78 and a median of 77, so 77 is the reference form here:
# two LR sections at 25 and one RC at 27. The app's mega-litigation imitates the
# same three-block shape.
FORM_LR_ITEMS = 50
FORM_RC_ITEMS = 27
FORM_ITEMS = FORM_LR_ITEMS + FORM_RC_ITEMS

# --- Uncertainty terms, all expressed as one standard deviation in scaled pts ---
# LSAC: "approximately 2.6 points... at a two-thirds confidence level".
LSAT_SEM_SCALED = 2.6
# Measured across 59 published LSAC conversion charts; see module docstring.
EQUATING_SD_SCALED = 1.09
# NOT a published figure. A deliberate allowance for the fact that this bank is
# not an equated form: unpretested items, no proctor, no fixed section order.
BANK_CALIBRATION_SD = 2.0
# Applied when a section has no attempts at all and its rate has to be borrowed
# from the other section. Also not a published figure.
MISSING_SECTION_SD = 3.0

# The reported band is a one-sigma (~68%) interval, matching the convention
# LSAC itself uses for score bands rather than inventing a wider or narrower one.
BAND_CONFIDENCE = 0.68

# --- Evidence weighting -----------------------------------------------------
# A student improves, so old work is weaker evidence about today. Exponential
# decay with a 30-day half-life: yesterday's answer counts ~1.0, a month-old
# answer counts 0.5, a three-month-old answer counts 0.125.
RECENCY_HALF_LIFE_DAYS = 30.0
# Coached practice is scored, paid, prompted, and untimed-ish; the diagnostic
# ("mega-litigation") pays nothing, prompts nothing, and coaches nothing, which
# is the only condition here that resembles sitting a test. The `evidence_class`
# column already draws that line — this is what it is worth.
EVIDENCE_WEIGHT = {
    "diagnostic": 1.0,
    "uncoached_practice": 0.8,
    "coached_practice": 0.55,
}
DEFAULT_EVIDENCE_WEIGHT = 0.55

# Kish effective sample thresholds for the same vocabulary `/performance`
# already uses, so one word does not mean two things in one dashboard.
EVIDENCE_GRADES = ((10, "baseline"), (30, "emerging"), (80, "directional"))


def _modern_raw_to_scaled() -> list[int]:
    """Median conversion across 59 modern LSAC charts, raw 0-77 -> scaled.

    Written as (highest raw in the band, scaled score) so the transcription can
    be checked line by line. Scaled scores 122, 128, 172, 175, and 178 are
    unreachable: a real equated chart prints "there is no raw score that will
    produce this scaled score for this form" against such rows, and taking a
    median across forms preserves that. It is a property of the conversion, not
    a gap in the transcription.

    Sanity anchors against the published charts: a 160 needs 58/77 (75.3%) and a
    150 needs 44/77 (57.1%). The 94-form pre-2024 dataset, a different era
    transcribed by different people, puts the same two scores at 73.3% and 55.4%
    — agreement to within two points of proportion-correct, which is the main
    reason to trust this table.
    """
    bands = [
        (11, 120), (12, 121), (13, 123), (14, 124), (15, 125), (16, 126), (17, 127),
        (18, 129), (19, 130), (20, 131), (21, 132), (22, 133), (23, 134), (24, 135),
        (26, 136), (27, 137), (28, 138), (29, 139), (30, 140), (32, 141), (33, 142),
        (34, 143), (35, 144), (37, 145), (38, 146), (40, 147), (41, 148), (42, 149),
        (44, 150), (45, 151), (46, 152), (48, 153), (49, 154), (51, 155), (52, 156),
        (53, 157), (55, 158), (56, 159), (57, 160), (59, 161), (60, 162), (61, 163),
        (63, 164), (64, 165), (65, 166), (66, 167), (67, 168), (68, 169), (69, 170),
        (70, 171), (71, 173), (72, 174), (73, 176), (74, 177), (75, 179), (77, 180),
    ]
    table: list[int] = []
    raw = 0
    for highest, scaled in bands:
        while raw <= highest:
            table.append(scaled)
            raw += 1
    assert len(table) == FORM_ITEMS + 1, len(table)
    return table


RAW_TO_SCALED = _modern_raw_to_scaled()

# LSAC, "LSAT PERCENTILE TABLE: 120 to 180 Scale", testing years 2023-24 through
# 2025-26. Percent of test takers scoring *below* each scaled score.
#   — https://www.lsac.org/data-research/data/lsat-percentiles
# This is versioned data, not a constant: LSAC recomputes it from the trailing
# three testing years around the end of each July. The 2021-2024 edition put the
# median at 153; on this one it is 154, the pool having got stronger. Re-check it
# each August rather than letting it quietly go stale.
PERCENTILE_TABLE_YEARS = "2023-2026"
PERCENTILE_BELOW = {
    180: 99.85, 179: 99.74, 178: 99.57, 177: 99.34, 176: 99.08, 175: 98.72,
    174: 98.24, 173: 97.59, 172: 96.72, 171: 95.77, 170: 94.48, 169: 93.03,
    168: 91.36, 167: 89.53, 166: 87.49, 165: 85.17, 164: 82.75, 163: 80.05,
    162: 77.20, 161: 74.22, 160: 71.06, 159: 67.93, 158: 64.48, 157: 61.04,
    156: 57.62, 155: 54.03, 154: 50.43, 153: 46.93, 152: 43.37, 151: 39.81,
    150: 36.56, 149: 33.24, 148: 30.07, 147: 27.06, 146: 24.20, 145: 21.48,
    144: 19.04, 143: 16.73, 142: 14.61, 141: 12.66, 140: 11.00, 139: 9.44,
    138: 8.05, 137: 6.89, 136: 5.86, 135: 4.96, 134: 4.22, 133: 3.57,
    132: 3.02, 131: 2.54, 130: 2.17, 129: 1.85, 128: 1.58, 127: 1.37,
    126: 1.20, 125: 1.04, 124: 0.93, 123: 0.83, 122: 0.76, 121: 0.66, 120: 0.00,
}

# --- The population prior the estimate is shrunk toward ---------------------
# The percentile table above puts the median of the 2023-2026 pool at 154
# (50.43% of test takers score below it), and 154 costs 49 of the 77 scored
# items on the conversion table above. So the honest description of a student
# nothing is yet known about is "a median test taker", i.e. 63.6% form
# accuracy — not the 100% that one lucky answer would otherwise assert.
PRIOR_SCALED = 154
PRIOR_RAW = next(raw for raw, scaled in enumerate(RAW_TO_SCALED) if scaled >= PRIOR_SCALED)
PRIOR_ACCURACY = PRIOR_RAW / FORM_ITEMS

# What the prior is worth, in units of "one fresh, uncoached answer". Deliberately
# equal to the `baseline` threshold in `EVIDENCE_GRADES`: at exactly the point the
# dashboard stops calling the estimate a placeholder, the population and the
# student's own record carry the same weight. Below it the population dominates,
# which is the intended behaviour — it is what stops a two-question account being
# shown a number that says anything about the student at all. A month of real
# work leaves the prior contributing a few percent and then a fraction of one.
PRIOR_STRENGTH = 10.0

# Average steepness of the conversion: 60 scaled points across 77 raw items.
# Used to carry an uncertainty in proportion-correct over into scaled points at
# a *fixed* rate. Using the local slope instead would make the band width depend
# on where the point estimate sits, which is precisely the coupling that let the
# band widen as evidence accumulated.
SCALED_POINTS_PER_ITEM = (180 - 120) / FORM_ITEMS


def scaled_from_raw(raw: float) -> float:
    """Convert a raw score out of 77 to the 120-180 scale, interpolating.

    A real raw score is an integer and the table is a step function. A
    *projected* raw score is a fraction of a form the student never sat, so the
    steps are interpolated: rounding to the nearest whole item would make the
    trend line jump two or three scaled points for a single extra question.
    """
    clamped = max(0.0, min(float(FORM_ITEMS), raw))
    low = int(math.floor(clamped))
    high = min(FORM_ITEMS, low + 1)
    fraction = clamped - low
    return RAW_TO_SCALED[low] + (RAW_TO_SCALED[high] - RAW_TO_SCALED[low]) * fraction


def percentile_for(scaled: int) -> float | None:
    return PERCENTILE_BELOW.get(int(round(scaled)))


def shrink_toward_prior(accuracy: float, effective_sample: float) -> float:
    """Posterior mean of a proportion under a Beta prior centred on the population.

    (kappa * p_prior + n * p_hat) / (kappa + n) — the Beta-binomial posterior
    mean, and the standard empirical-Bayes shrinkage estimator. The prior's
    share of the answer is kappa / (kappa + n), so it decays in evidence exactly
    as it should: everything at n = 0, half at n = kappa, nothing in the limit.

    This is what stops one correct answer reporting a 180. It is not a cosmetic
    clamp on the top of the scale — a single *wrong* answer is pulled up off 120
    by the same amount, because "we have one data point" is symmetric ignorance.
    """
    if effective_sample <= 0:
        return PRIOR_ACCURACY
    return (PRIOR_STRENGTH * PRIOR_ACCURACY + effective_sample * accuracy) / (
        PRIOR_STRENGTH + effective_sample
    )


def _sampling_sd(effective_sample: float) -> float:
    """One standard deviation of estimation error, in scaled points.

    A Beta posterior's variance is p(1-p)/(n + kappa + 1). Rather than evaluate
    that at the current estimate, it is evaluated at its maximum, p = 1/2, which
    buys the invariant this function exists for: the result depends on the
    effective sample size and nothing else, so it is strictly decreasing in
    evidence and no amount of extra practice can ever widen the band. The cost
    is a slightly conservative interval for a student far from 50% accuracy,
    which is the right direction to be wrong in — and it is dominated by LSAC's
    own SEM long before it matters.

    Wilson intervals were used here before. They are a good interval for a
    proportion and a bad *width*: the Wilson width depends on p-hat, so a run of
    answers that moved the estimate toward 50% widened the band even though the
    student had done more work, and at p-hat = 1 with n = 1 it produced a
    narrower band than n = 2 (the 22 -> 44 point jump QA measured).
    """
    posterior_n = PRIOR_STRENGTH + max(0.0, effective_sample) + 1.0
    return SCALED_POINTS_PER_ITEM * FORM_ITEMS * 0.5 / math.sqrt(posterior_n)


class AttemptFact(NamedTuple):
    """One filed answer, reduced to the columns the account-wide aggregates read.

    Every dashboard read that summarises a whole history — the projected score,
    `/performance`, the trial calendar — used to load the answer as a mapped
    `Attempt`, eager-joined to its `SessionItem` and that item's `Question`. It
    only ever reads the twelve scalars below off that graph, but a mapped entity
    arrives whole: `attempts.reasoning_text`, `attempts.strategy_artifact_json`,
    `session_items.draft_reasoning_text`, `questions.stimulus` and
    `questions.stem` all came too. On a 1,099-answer account that is 400 kB of
    question prose read out of the database, decoded, and attached to 3,500
    instrumented ORM instances so that `section` and `question_type` could be
    read off them.

    Selecting the columns instead costs one query and no identity map. It is a
    read model on purpose: these rows are immutable, they are never written back,
    and the flat shape means a future field cannot be added to the aggregates
    without also being added to the query — which is the property the eager-load
    version silently lacked.
    """

    created_at: datetime
    is_correct: bool
    evidence_class: str
    server_elapsed_ms: int
    explanation_score: float | None
    confidence: int | None
    question_id: str
    question_type: str
    section: str
    target_time_seconds: int
    timer_compromised: bool
    from_review_queue: bool


def attempt_facts(user_id: str) -> list[AttemptFact]:
    """Every answer this account has filed, oldest first, as flat rows.

    Inner joins rather than the outer joins an eager load would emit, which is
    the same set of rows: `attempts.session_item_id` and
    `session_items.question_id` are both NOT NULL foreign keys.
    """
    rows = db.session.execute(
        select(
            Attempt.created_at,
            Attempt.is_correct,
            Attempt.evidence_class,
            Attempt.server_elapsed_ms,
            Attempt.explanation_score,
            Attempt.confidence,
            SessionItem.question_id,
            Question.question_type,
            Question.section,
            SessionItem.target_time_seconds,
            SessionItem.timer_compromised,
            SessionItem.from_review_queue,
        )
        .join(SessionItem, SessionItem.id == Attempt.session_item_id)
        .join(Question, Question.id == SessionItem.question_id)
        .where(Attempt.user_id == user_id)
        .order_by(Attempt.created_at.asc())
    ).all()
    return [AttemptFact._make(row) for row in rows]


def _weight(attempt: AttemptFact, now) -> float:
    created = attempt.created_at
    if created.tzinfo is None:
        from datetime import timezone

        created = created.replace(tzinfo=timezone.utc)
    age_days = max(0.0, (now - created).total_seconds() / 86_400)
    recency = 0.5 ** (age_days / RECENCY_HALF_LIFE_DAYS)
    evidence = EVIDENCE_WEIGHT.get(attempt.evidence_class, DEFAULT_EVIDENCE_WEIGHT)
    return recency * evidence


def _section_estimate(weighted: list[tuple[float, bool]]) -> tuple[float, float, float]:
    """Weighted accuracy, total weight, and effective sample size.

    Two different things can weaken a sample and both have to be caught.

    Kish's n_eff = (Σw)² / Σw² handles *unequal* weighting — a handful of recent
    answers buried in a pile of stale ones does not get to claim the pile's
    precision. But Kish is scale-invariant: halve every weight and it does not
    move. So a history that is uniformly four months old, or uniformly coached,
    would still report full precision, which is precisely the claim this model
    exists to refuse.

    Σw is the complementary reading — evidence counted in units of "one fresh,
    uncoached answer". Taking the smaller of the two means a sample is only ever
    as strong as its weakest honest description of itself.

    Worth knowing for the band's monotonicity argument: every weight here is a
    product of two factors in (0, 1], so Σw² ≤ Σw and therefore Kish ≥ Σw
    always. The minimum is Σw, which is additive across sections and strictly
    increasing in the number of answers at a fixed `now`. That is what makes the
    band width — a decreasing function of this quantity — non-increasing in
    evidence. Kish stays in the expression because it is the correct guard if a
    weight above 1 is ever introduced, and it would silently stop being a guard
    if it were deleted as dead code.
    """
    if not weighted:
        return 0.0, 0.0, 0.0
    total_weight = sum(weight for weight, _ in weighted)
    if total_weight <= 0:
        return 0.0, 0.0, 0.0
    correct_weight = sum(weight for weight, correct in weighted if correct)
    sum_squares = sum(weight * weight for weight, _ in weighted)
    kish = (total_weight * total_weight / sum_squares) if sum_squares else 0.0
    return correct_weight / total_weight, total_weight, min(kish, total_weight)


def _band(point_scaled: float, total_sd: float) -> tuple[int, int, int]:
    """(reported score, lower bound, upper bound), midpoint-exact by construction.

    The score returned is the arithmetic midpoint of the bounds returned, in
    integers, always. The previous version computed the three numbers
    independently — `floor(point - sd)`, `round(point)`, `ceil(point + sd)` —
    and then forced the bounds to contain the point with `min`/`max`, which is
    how the dashboard came to print "MIDPOINT 180" beneath a 158-180 band whose
    real midpoint is 169.

    The 120-180 scale has hard ends, so a band that would run off one of them is
    clipped and the *reported score becomes the midpoint of what is left* rather
    than the bound being quietly stretched. That keeps the invariant at the cost
    of the score differing from the raw estimate at the extremes, which is the
    right trade: a student projecting 179 is being told "179 or 180", and there
    is no honest way to offer them a symmetric interval.
    """
    centre = max(120.0, min(180.0, point_scaled))
    lower_edge = max(120.0, centre - total_sd)
    upper_edge = min(180.0, centre + total_sd)
    scaled = int(round((lower_edge + upper_edge) / 2))
    half = int(round((upper_edge - lower_edge) / 2))
    half = max(0, min(half, scaled - 120, 180 - scaled))
    return scaled, scaled - half, scaled + half


def project_score(user: User, *, attempts: list[AttemptFact] | None = None, now=None) -> dict:
    """Estimate where this student's LSAT score currently sits, with a band.

    Pipeline, in order:
      1. one first attempt per question (a memorized repeat is not evidence);
      2. weight by recency and by evidence class;
      3. estimate LR and RC accuracy separately, each shrunk toward the
         population prior by its own effective sample size;
      4. reweight to real form composition (50 LR / 27 RC) -> projected raw;
      5. convert raw -> scaled through the median LSAC conversion table;
      6. build a symmetric band from sampling error, LSAC's SEM, measured
         equating spread, and an explicit allowance for this bank not being an
         equated form.

    `now` is the instant recency is measured from. It exists so a historical
    point can be reconstructed as the student would have seen it on the day,
    rather than with every attempt decayed to today.
    """
    now = now or utcnow()
    if attempts is None:
        # One statement for the five columns this function reads. Left lazy, the
        # loop below fired two statements per attempt — 2,100 statements and
        # 308ms for one dashboard load on a 1,099-attempt account, and worse
        # against RDS than against local SQLite because every one of them is a
        # network round trip. Eager-loading the mapped graph fixed the statement
        # count and left the payload: see `AttemptFact`.
        attempts = attempt_facts(user.id)

    first_by_question: dict[str, AttemptFact] = {}
    for attempt in attempts:
        first_by_question.setdefault(attempt.question_id, attempt)

    by_section: dict[str, list[tuple[float, bool]]] = defaultdict(list)
    counts: dict[str, int] = defaultdict(int)
    for attempt in first_by_question.values():
        by_section[attempt.section].append((_weight(attempt, now), attempt.is_correct))
        counts[attempt.section] += 1

    lr_observed, _, lr_effective = _section_estimate(by_section.get("Logical Reasoning", []))
    rc_observed, _, rc_effective = _section_estimate(by_section.get("Reading Comprehension", []))
    lr_attempts = counts.get("Logical Reasoning", 0)
    rc_attempts = counts.get("Reading Comprehension", 0)
    observed = lr_attempts + rc_attempts

    if observed == 0:
        return {
            "available": False,
            "reason": "no_evidence",
            "model_version": MODEL_VERSION,
            "note": (
                "A projected score needs answered questions. Run a set of cases, or sit a "
                "mega-litigation, and an estimate with its uncertainty band will appear here."
            ),
        }

    pooled_observed, _, pooled_effective = _section_estimate(
        by_section.get("Logical Reasoning", []) + by_section.get("Reading Comprehension", [])
    )
    # Step 3: each section is shrunk by its *own* evidence, so a student with a
    # hundred LR answers and three RC ones gets a firm LR rate and an RC rate
    # still mostly borrowed from the population.
    lr_accuracy = shrink_toward_prior(lr_observed, lr_effective)
    rc_accuracy = shrink_toward_prior(rc_observed, rc_effective)

    # A section with no attempts borrows the other one's rate rather than being
    # scored as zero — and pays for the assumption in the band, not silently.
    missing_sections = []
    pooled_accuracy = shrink_toward_prior(pooled_observed, pooled_effective)
    if lr_attempts == 0:
        lr_accuracy, missing_sections = pooled_accuracy, [*missing_sections, "Logical Reasoning"]
    if rc_attempts == 0:
        rc_accuracy, missing_sections = pooled_accuracy, [*missing_sections, "Reading Comprehension"]

    # Step 4: the practice mix is not the form's mix. Reweight before converting.
    form_accuracy = (FORM_LR_ITEMS * lr_accuracy + FORM_RC_ITEMS * rc_accuracy) / FORM_ITEMS
    observed_form_accuracy = (
        FORM_LR_ITEMS * (lr_observed if lr_attempts else pooled_observed)
        + FORM_RC_ITEMS * (rc_observed if rc_attempts else pooled_observed)
    ) / FORM_ITEMS
    projected_raw = form_accuracy * FORM_ITEMS
    point_scaled = scaled_from_raw(projected_raw)

    # Σw is additive across sections (see `_section_estimate`), so this is the
    # same number either way — written out because the pooled branch is what the
    # borrowed-rate case is actually estimated from.
    effective_sample = pooled_effective if missing_sections else (lr_effective + rc_effective)
    sampling_sd = _sampling_sd(effective_sample)

    variance = (
        sampling_sd**2
        + LSAT_SEM_SCALED**2
        + EQUATING_SD_SCALED**2
        + BANK_CALIBRATION_SD**2
        + (MISSING_SECTION_SD**2 if missing_sections else 0.0)
    )
    total_sd = math.sqrt(variance)
    # One standard deviation either side — a 68% two-sided interval, the same
    # convention LSAC reports its own score bands at.
    scaled, lower, upper = _band(point_scaled, total_sd)

    grade = "stable"
    for threshold, name in EVIDENCE_GRADES:
        if effective_sample < threshold:
            grade = name
            break

    return {
        "available": True,
        "model_version": MODEL_VERSION,
        "scaled_score": scaled,
        "lower_bound": lower,
        "upper_bound": upper,
        "band_confidence": BAND_CONFIDENCE,
        "percentile": percentile_for(scaled),
        "percentile_lower": percentile_for(lower),
        "percentile_upper": percentile_for(upper),
        "estimated_accuracy": round(form_accuracy, 4),
        # What the student actually scored, before shrinkage. Reported next to
        # the estimate rather than instead of it, so the gap between "what you
        # did" and "what that predicts" is visible instead of being a silent
        # adjustment inside the model.
        "observed_accuracy": round(observed_form_accuracy, 4),
        "projected_raw": round(projected_raw, 1),
        "form_items": FORM_ITEMS,
        "form_lr_items": FORM_LR_ITEMS,
        "form_rc_items": FORM_RC_ITEMS,
        "effective_sample": round(effective_sample, 1),
        "observed_attempts": observed,
        "lr_attempts": lr_attempts,
        "rc_attempts": rc_attempts,
        "lr_accuracy": round(lr_accuracy, 4),
        "rc_accuracy": round(rc_accuracy, 4),
        "lr_accuracy_observed": round(lr_observed, 4) if lr_attempts else None,
        "rc_accuracy_observed": round(rc_observed, 4) if rc_attempts else None,
        "prior_weight": round(PRIOR_STRENGTH / (PRIOR_STRENGTH + effective_sample), 3),
        "evidence_grade": grade,
        "missing_sections": missing_sections,
        # Every term that widened the band, in scaled points, so the number is
        # inspectable instead of being a black box the student has to trust.
        "uncertainty": {
            "sampling": round(sampling_sd, 2),
            "lsat_sem": LSAT_SEM_SCALED,
            "equating": EQUATING_SD_SCALED,
            "bank_calibration": BANK_CALIBRATION_SD,
            "missing_section": MISSING_SECTION_SD if missing_sections else 0.0,
            "total": round(total_sd, 2),
        },
        "method": {
            "conversion_table": (
                f"Median of 59 published LSAC conversion charts, August 2024 format "
                f"({FORM_ITEMS} scored items, 2 LR + 1 RC)"
            ),
            "percentile_table": f"LSAC LSAT Percentile Table, {PERCENTILE_TABLE_YEARS} testing years",
            "sem_source": "LSAC LSAT Score Bands (SEM approximately 2.6 scaled points)",
            "recency_half_life_days": RECENCY_HALF_LIFE_DAYS,
            "evidence_weights": EVIDENCE_WEIGHT,
            "prior": (
                f"Shrunk toward the {PERCENTILE_TABLE_YEARS} median of {PRIOR_SCALED} "
                f"({PRIOR_RAW}/{FORM_ITEMS} items) with the weight of "
                f"{PRIOR_STRENGTH:g} answers"
            ),
        },
    }


# How stale the newest snapshot has to be, or how far the estimate has to move,
# before another row is written. Without this a student who finishes three short
# runs in an evening would draw three points on their own trend line for what is
# really one sitting.
SNAPSHOT_MIN_INTERVAL = timedelta(hours=6)
SNAPSHOT_MIN_MOVEMENT = 1


def record_projection(user: User, projection: dict | None = None) -> ScoreProjection | None:
    """Persist today's estimate if it is new information, and return the row."""
    projection = projection or project_score(user)
    if not projection.get("available"):
        return None
    latest = (
        ScoreProjection.query.filter_by(user_id=user.id)
        .order_by(ScoreProjection.created_at.desc())
        .first()
    )
    if latest:
        created = latest.created_at
        if created.tzinfo is None:
            from datetime import timezone

            created = created.replace(tzinfo=timezone.utc)
        moved = abs(latest.scaled_score - projection["scaled_score"]) >= SNAPSHOT_MIN_MOVEMENT
        if not moved and (utcnow() - created) < SNAPSHOT_MIN_INTERVAL:
            return latest
    row = ScoreProjection(
        user_id=user.id,
        scaled_score=projection["scaled_score"],
        lower_bound=projection["lower_bound"],
        upper_bound=projection["upper_bound"],
        percentile=projection["percentile"],
        estimated_accuracy=projection["estimated_accuracy"],
        effective_sample=projection["effective_sample"],
        observed_attempts=projection["observed_attempts"],
        lr_attempts=projection["lr_attempts"],
        rc_attempts=projection["rc_attempts"],
        evidence_grade=projection["evidence_grade"],
        model_version=projection["model_version"],
        detail_json={
            "uncertainty": projection["uncertainty"],
            "projected_raw": projection["projected_raw"],
            "lr_accuracy": projection["lr_accuracy"],
            "rc_accuracy": projection["rc_accuracy"],
        },
    )
    db.session.add(row)
    db.session.commit()
    return row


def projection_history(user: User, limit: int = 60) -> list[dict]:
    """Past snapshots oldest-first, which is the order a chart wants them in."""
    rows = (
        ScoreProjection.query.filter_by(user_id=user.id)
        .order_by(ScoreProjection.created_at.desc())
        .limit(limit)
        .all()
    )
    from .services import _iso_utc

    return [
        {
            "id": row.id,
            "date": _iso_utc(row.created_at),
            "scaled_score": row.scaled_score,
            "lower_bound": row.lower_bound,
            "upper_bound": row.upper_bound,
            "percentile": row.percentile,
            "effective_sample": row.effective_sample,
            "observed_attempts": row.observed_attempts,
            "evidence_grade": row.evidence_grade,
        }
        for row in reversed(rows)
    ]


def projection_snapshot(user: User, *, record: bool = False, attempts: list[AttemptFact] | None = None) -> dict:
    """The whole projected-score payload the dashboard renders.

    `attempts` lets `/performance`, which has already loaded the account's
    attempt history for its own aggregates, hand that list straight over rather
    than making this module read every row a second time.

    `record` defaults off. It used to default on, which made `GET /projection`
    and `GET /performance` — two plain reads, both hit on every dashboard visit —
    open a write transaction and commit a row. Snapshots are now written where
    the evidence changes rather than where it is read: a run completing is the
    event that moves the trend line, so `services` records there (still behind
    the interval/movement throttle above). Pass `record=True` only for a caller
    that genuinely means "and save this point".
    """
    projection = project_score(user, attempts=attempts)
    if record:
        record_projection(user, projection)
    target = user.target_score
    payload = {
        **projection,
        "history": projection_history(user),
        "target_score": target,
    }
    if projection.get("available") and target:
        payload["target_gap"] = target - projection["scaled_score"]
        payload["target_within_band"] = projection["lower_bound"] <= target <= projection["upper_bound"]
    return payload
