# Measurement & Score Prediction for LSAT Speedrun

**Compiled:** Sunday, August 2, 2026
**Purpose:** Answer the founder's question — *"how do we statistically predict whether our student will perform better on the LSAT?"* — with a defensible measurement design built from non-official practice items and no official raw-to-scaled conversion.
**Scope:** Prioritizes 2024–2026 work; works backwards to foundational psychometrics. Covers LSAT test specs and published reliability, IRT calibration sample sizes, cold-start ability estimation (Elo/Glicko/BKT/DKT/PFA/AFM), CAT and MST feasibility at small scale, linking/equating without official conversions, growth and reliable-change modeling, predictive validity, response-time modeling, power analysis for the in-app A/B system, fixed-parameter calibration for growing an item pool, and uncertainty communication.
**Source count:** 69 formally logged entries plus a dead-end register.
**Method note:** Every source consulted is logged, including dead ends and low-value hits. Sources are logged once, in the section where they were most load-bearing, and cross-referenced elsewhere.

**Reading key:**
- **[HARD NUMBER]** flags a source that supplies a concrete quantity we can design against (sample size, SEM, correlation, effect size).
- **[DEAD END]** flags a source consulted that did not pay off, logged so we don't re-crawl it.
- **[PAYWALL]** flags a source where only the abstract/metadata was accessible; findings are reported at the confidence that allows.
- Throughout, **θ (theta)** is the IRT latent ability parameter, **SE(θ)** its standard error, **SEM** the classical standard error of measurement in score units.

---

## Executive orientation: the three numbers that shape everything

Before the source log, three empirical anchors that constrain every design choice below. All are sourced in detail later.

1. **The official LSAT's own SEM is ~2.6 scaled points** (LSAC). A test with 75–78 scored items, professionally calibrated and equated, with reliability >0.90, still cannot resolve a student's score more finely than roughly ±2.6 points (a ~5-point band). Any product claim tighter than that from uncalibrated practice items is false on its face.
2. **The average real-world LSAT retake gain is ~2.4 scaled points** (LSAC TR 26-01, 2024–2025 testing year: 2.39 points for second-time takers, 2.03 for third-time). That is the *entire* average effect of months of additional study plus familiarity, and it is *smaller than the test's own SEM*. This is the central measurement problem: **the signal we want to detect is smaller than the noise of a single official administration.**
3. **Consequently, detecting improvement requires aggregating far more items than a single test.** The good news is that this is exactly what a practice app is positioned to do — it can accumulate hundreds of item responses per student, which a single 75-item test cannot. The design implication is that our comparative advantage is *precision through volume*, not *scale fidelity*.

---

## 1. The current LSAT: structure, scoring, reliability, and published technical documentation

### LSAC — "Changes are coming to the LSAT in August 2024" (official announcement)
- **Citation**: Law School Admission Council, 2023/2024, official test-change announcement
- **Link**: https://www.lsac.org/lsat/lsat-changes-coming-august-2024
- **Type**: documentation (primary, test sponsor)
- **Key finding**: Confirmed from the sponsor: starting with the August 2024 LSAT, the multiple-choice portion is **two scored Logical Reasoning sections + one scored Reading Comprehension section**, plus **one unscored variable section that is either LR or RC**. Analytical Reasoning (Logic Games) is permanently removed. LSAC states the 120–180 score scale and the score-band/equating approach are unchanged.
- **Relevance to this product**: **[HARD NUMBER]** The scored construct is now ~2/3 LR, ~1/3 RC by section count. Our app's two question domains are exactly right, but the *weighting* matters: a composite ability estimate should weight LR roughly 2:1 against RC to mirror the operational form, not 1:1. Our readiness gate's 40 LR / 20 RC ratio is coincidentally close to 2:1 — that part is defensible; the absolute counts are not (see §2).
- **Caveats**: The announcement is promotional in tone and does not give item counts or psychometric detail. Confirmed against TR 26-01 below.

### LSAC TR 26-01 — LSAT Performance with Regional, Gender, Racial/Ethnic, Repeater, and Accommodation Breakdowns, 2018-19 through 2024-25
- **Citation**: Kelly, R., & Morgan, J. (2026). *LSAT Technical Report TR 26-01*, Law School Admission Council, May 2026
- **Link**: https://www.lsac.org/sites/default/files/research/TR-26-01.pdf
- **Type**: technical report (test sponsor, primary, current)
- **Key finding**: **[HARD NUMBER]** The single most useful public document for our purposes. (a) **Mean retake gain, 2024–25: +2.39 scaled points** for second-time takers, **+2.03** for third-time takers; these have been stable across seven testing years (2nd-take gain range 2.18–2.69, 3rd-take 1.92–2.40). (b) The **score-gain distribution for retakers spans roughly −10 to +15 points** — i.e. a substantial minority of retakers *lose* points. (c) **49.1% of 2024–25 test takers tested more than once**; 50.9% first-time, 29.7% second, 13.1% third, 4.7% fourth, 1.6% fifth-or-more. (d) Population mean score ≈ **152.29** for first-time takers in 2024–25, with **SD ≈ 10.3–11.6** depending on subgroup and quarter. (e) Confirms the section-structure timeline: three scored sections since May 2020 (COVID), AR re-added Aug 2021, AR removed and replaced by a second LR section Aug 2024.
- **Relevance to this product**: This is our **prior distribution** and our **effect-size benchmark**. (i) The population prior for an unknown new student is approximately N(152, 11²) — that is what a Bayesian ability estimate should shrink toward before any evidence arrives. (ii) If the product claims "you improved," the improvement that a *real retake* buys on average is 2.4 points. A product claiming a student gained 10 points should be regarded with deep suspicion unless the evidence base is very large. (iii) The −10 to +15 spread tells us the *within-person* test-retake SD is on the order of 5–6 points, which is consistent with two administrations each with SEM 2.6 (√(2.6²+2.6²) ≈ 3.7) plus genuine study effects and day-to-day state variance.
- **Caveats**: Descriptive, self-selected sample; LSAC explicitly warns against causal reading. Retake gains conflate true learning, practice/familiarity effects, and regression to the mean (retakers are disproportionately those who underperformed — see §6). The report gives no item-level psychometrics, no SEM, no reliability coefficients.

### LSAC — "The Law School Admission Test: Reliability and Validity in Brief"
- **Citation**: Law School Admission Council, undated (current as of 2026), research summary page
- **Link**: https://www.lsac.org/data-research/research/lsat-reliability-validity
- **Type**: documentation (test sponsor)
- **Key finding**: **[HARD NUMBER]** LSAT form reliability coefficients are **consistently above 0.90**; mean reliability for all eight administrations in 2021–2022 exceeded 0.90. LSAC states reliability coefficients are computed per form and published in the annual *Interpretive Guide for LSAT Score Users*.
- **Relevance to this product**: Sets the ceiling. A 75–78 item professionally built form achieves r ≈ 0.90–0.93. Reliability of 0.90 with SD 11 implies SEM = 11·√(1−0.90) ≈ **3.5 points**; at r = 0.94, SEM ≈ 2.7 — which reconciles with LSAC's published ~2.6. **The practical lesson: our app cannot beat 0.90 reliability on a 75-item diagnostic even in principle, and will do much worse because our items are uncalibrated and unequated.** But we can exceed it by aggregating 300+ items over time.
- **Caveats**: The page is a summary, not a technical document. It does not report the reliability estimator used (LSAC historically used KR-20 / coefficient alpha variants and IRT marginal reliability). The *Interpretive Guide* itself is the primary source and is not freely linkable from this page.

### LawHub (LSAC) — "How Is the LSAT Scored?" / score bands
- **Citation**: LSAC LawHub, current 2026, test-taker documentation
- **Link**: https://www.lawhub.org/prepare-for-the-lsat/lsat-scoring
- **Type**: documentation (test sponsor, test-taker facing)
- **Key finding**: LSAC reports every score **together with a score band** derived from the SEM, computed as score ± SEM. LSAC's own framing to test-takers: "your actual proficiency ... may be slightly higher or slightly lower than the score you received"; the band "reflects the range of scores you likely would receive if you took the LSAT again." Explicitly attributes variation to guessing, illness, hunger — i.e. state noise.
- **Relevance to this product**: **This is the model we should copy for uncertainty reporting (§10).** The test sponsor itself refuses to report a bare point estimate to score users. If LSAC bands its own professionally equated score, our product banding an unofficial estimate is not a weakness to apologize for — it is *conformity with the sponsor's own reporting standard*, and can be framed to users exactly that way.
- **Caveats**: Consumer-facing page; the ±1 SEM band is a ~68% interval, not 95%. LSAC does not disclose the band computation at the scale extremes.

### Manhattan Review — LSAT scoring system (secondary, used only for the SEM figure)
- **Citation**: Manhattan Review, LSAT Scoring System, commercial prep page
- **Link**: https://www.manhattanreview.com/lsat-scoring-system/
- **Type**: documentation (commercial, secondary)
- **Key finding**: States LSAC's SEM is **approximately 2.6 scaled points**, giving a 160 a band of roughly 157–163, and notes LSAC does not disclose the band computation at scale extremes.
- **Relevance to this product**: Corroborates the ~2.6 SEM figure that circulates widely; used here only as corroboration because LSAC's *Interpretive Guide* is not freely accessible.
- **Caveats**: **Commercial secondary source.** The 2.6 figure should be treated as approximately right and cited as "LSAC-reported, ~2.6" rather than as a precisely verified constant. It also predates the 2024 structure change; a 75-item test is shorter than the ~100-item pre-2024 test, so the current SEM is plausibly *slightly larger*.

### Wainer & Thissen-lineage testlet analysis of LSAT sections (ERIC ED468956)
- **Citation**: (LSAC-sponsored testlet study, reproduced via ERIC), analysis of testlet effects on LSAT section reliability
- **Link**: https://files.eric.ed.gov/fulltext/ED468956.pdf
- **Type**: technical report (LSAC-sponsored, archived)
- **Key finding**: **[HARD NUMBER — conceptual]** Reading Comprehension (and the former Analytical Reasoning) sections have a **testlet structure**: multiple items share a stimulus passage, violating IRT's local independence assumption. When modeled correctly with a polytomous testlet model (Bock, 1972), **testlet-based reliability of these sections is *considerably lower* than the value computed under the false assumption of conditional independence.** The authors recommend section reliability always be computed with the testlet structure modeled explicitly. They judge total-test reliability to be only mildly affected because of overall test length.
- **Relevance to this product**: **Directly falsifies a naive design we would otherwise build.** Our app has a `same-passage follow-up` concept (135s target time) — meaning we already know RC items cluster by passage. If we fit an IRT model treating each RC item as independent, **we will systematically overstate our precision on RC** — our reported SE(θ) will be too small and our confidence bands too narrow. The fix is either (a) score each RC passage as a single polytomous "testlet" item (number correct out of 5–7), or (b) apply a variance inflation / design-effect correction. Option (a) is simpler and is what we should do. It also means **RC evidence accumulates much more slowly than item counts suggest**: 20 RC items from 3 passages is closer to 3 independent observations than 20.
- **Caveats**: Older analysis (pre-2010) on pre-2024 forms; AR no longer exists. The RC finding still applies since RC is unchanged in format.

### LSAC — Research Archive / Research Library (index pages)
- **Citation**: LSAC Research Library and Research Archive indices
- **Link**: https://www.lsac.org/data-research/research | https://www.lsac.org/data-research/research/research-archive
- **Type**: documentation (index)
- **Key finding**: LSAC maintains three public report series — **LSAT Technical Reports (TR)**, **Psychometric Research Reports (PR/CT)**, and **Social Science Research Reports (RR)**. Critically: *"All reports in LSAC's Research Library are available upon request. Executive summaries are available below for the latest LSAT Technical Reports and other research published within the last 10 years."* The archive contains directly relevant historical psychometric work, e.g. van der Linden's *Adaptive Testing With Corrected-for-Guessing Scoring* (CT 99-12) and Glas's work on IRT model fit.
- **Relevance to this product**: **Actionable, non-obvious**: most LSAC psychometric reports are **not freely downloadable but ARE available on request**. If the founder wants the actual raw-to-scaled conversion methodology and current SEM by score level, the correct move is to **email LSAC research and request the current *Interpretive Guide for LSAT Score Users* and relevant TRs** — that is a free, legitimate, one-email action with a high payoff, and I'd put it at the top of the follow-up list.
- **Caveats**: Only executive summaries are posted for the last 10 years; older full reports are in the archive. Request fulfillment is at LSAC's discretion.

---

## 2. Item Response Theory: model choice, calibration sample sizes, and items-per-theta-precision

### The arithmetic that governs everything (derived, not cited — but from cited constants)

Before the sources, here is the calculation the founder should have on a whiteboard. It is elementary IRT and everything downstream depends on it.

Under the Rasch/1PL model, the **information** a single item contributes at ability θ is `I_i(θ) = p(1−p)`, where p is the probability of a correct response. The standard error of the ability estimate from n items is `SE(θ) = 1 / √(Σ I_i(θ))`.

- **Perfectly targeted item** (p = 0.5): information = 0.25 per item ⟹ `SE(θ) = 2/√n`.
- **Poorly targeted item** (p = 0.13 or 0.87): information ≈ 0.113 ⟹ `SE(θ) = 3/√n`. (Both bounds from Wright & Stone via Linacre, logged below.)

Now anchor the logit scale to the LSAT scale. Population SD of LSAT scores ≈ **11 points** (LSAC TR 26-01). In a Rasch model with a standard-normal ability distribution, **1 logit ≈ 11 scaled LSAT points**. Therefore:

| Target precision | SE(θ) in logits | Items needed (well-targeted, `n = 4/SE²`) | Items needed (poorly targeted, `n = 9/SE²`) |
|---|---|---|---|
| ±11 pts (±1 SD) | 1.00 | 4 | 9 |
| ±5.5 pts | 0.50 | 16 | 36 |
| ±3.7 pts | 0.33 | 37 | 82 |
| **±2.6 pts (matches official LSAT SEM)** | **0.236** | **72** | **161** |
| ±2.0 pts | 0.18 | 123 | 277 |
| ±1.0 pt | 0.09 | 494 | 1,111 |

**Sanity check that this is right:** the number of well-targeted items required to hit the official LSAT's own SEM of 2.6 points is **72** — and the actual LSAT has **75–78 scored items**. The model reproduces the real test's design point almost exactly. That is strong evidence this arithmetic is the correct frame.

**Three brutal implications for the product:**

1. **Our 75-item diagnostic can, at absolute best, achieve ±2.6 scaled points of precision — and only if every item is perfectly targeted to that student and every item parameter is known exactly.** Neither is true. Realistically, with unknown item parameters and non-adaptive (fixed) item selection, expect **±4 to ±6 scaled points** from a 75-item diagnostic. That is a 8–12 point wide band. That is honest, and it is still useful.
2. **A "±1 point" or even "±2 point" claim requires 120–500+ items.** No single diagnostic gets there. Only cumulative practice data does. **This is the product's actual advantage** and should be the core of the design.
3. **The cost of imprecision is quadratic.** Halving the band costs 4× the items. There is no clever workaround for this; it is a property of Fisher information. Adaptive item selection (§4) is the only thing that improves the constant factor, and it improves it by roughly 2×, not 10×.

### Schroeders & Gnambs (2025) — Sample-Size Planning in Item-Response Theory: A Tutorial
- **Citation**: Schroeders, U., & Gnambs, T. (2025). *Advances in Methods and Practices in Psychological Science*, 8(1). doi:10.1177/25152459251314798 (preprint: 10.31234/osf.io/hv6zt)
- **Link**: https://journals.sagepub.com/doi/10.1177/25152459251314798 | preprint https://timo.gnambs.de/sites/default/files/gnambstimo/publications/schroeders2025.pdf
- **Type**: peer-reviewed (tutorial/methods), 2025 — the most current authoritative treatment
- **Key finding**: **[HARD NUMBER]** Textbook rules of thumb converge on **≥250 or ≥500 respondents**, or a **respondent-to-parameter ratio of 10:1 to 20:1** (De Ayala & Sava-Bolesta, 1999; DeMars, 2003, 2010; van der Linden, 2018). But the authors' central argument is that these are unreliable: required N depends on item type, model (1PL/2PL/3PL), estimation method (JMLE/MMLE/Bayes), dimensionality, latent trait distribution, item pool size/homogeneity, and missing-data design. Crucially for us: **accurate estimates are achievable with as few as 100 respondents *if prior information is incorporated into estimation*** (König et al., 2020; Sheng, 2013), while **models with guessing or slipping parameters may be inadequately estimated even at N = 2,000** (Cuhadar, 2022). They recommend Monte Carlo simulation tailored to the specific design rather than rules of thumb, and give a 10-decision procedure.
- **Relevance to this product**: **Decisive for model choice.** (a) 3PL is off the table — we will never have the N to estimate guessing parameters, and the source explicitly says even N=2,000 can be insufficient for guessing/slipping models. (b) **Bayesian estimation with informative priors is the enabling technology at our scale**: it drops the requirement from ~500 to ~100 per item. This means our stack should use a hierarchical Bayesian 1PL/2PL (e.g. Stan, `brms`, or `pymc`), not classical MMLE via `mirt` defaults. (c) The recommendation to run our own Monte Carlo is directly actionable and cheap — simulate our actual expected data-sparsity pattern before committing.
- **Caveats**: A tutorial, not new empirical evidence; the concrete numbers are drawn from the cited simulation literature. Their examples are psychology-questionnaire-flavored (polytomous scales) more than achievement testing.

### Linacre (1994) — Sample Size and Item Calibration or Person Measure Stability
- **Citation**: Linacre, J. M. (1994). *Rasch Measurement Transactions*, 7(4), p. 328
- **Link**: https://www.rasch.org/rmt/rmt74m.htm (and follow-up https://www.rasch.org/rmt/rmt94h.htm)
- **Type**: peer-reviewed-adjacent (methodological note, widely cited standard reference)
- **Key finding**: **[HARD NUMBER]** The canonical Rasch sample-size table, derived from `2/√N < SE < 3/√N`:

| Calibration stable within | Confidence | N range (best→poor targeting) | Practical N |
|---|---|---|---|
| ±1 logit | 95% | 16–36 | **30** |
| ±1 logit | 99% | 27–61 | **50** |
| ±½ logit | 95% | 64–144 | **100** |
| ±½ logit | 99% | 108–243 | **150** |
| Definitive / high-stakes | 99%+ | 250 – 20×test length | **250** |
| Adverse circumstances | Robust | 450+ | **500** |

Also: requirements are **symmetric** in the Rasch model — you need as many *items* for a stable person measure as *persons* for a stable item calibration. Inflate by 10–40% when unmodeled disturbances exist (different testing conditions, different curricula).
- **Relevance to this product**: **This is our item-calibration roadmap, and it's much more encouraging than "you need 1,000 users."** In logit terms, ±½ logit ≈ ±5.5 LSAT points of item-difficulty uncertainty; ±1 logit ≈ ±11 points. Concretely: **50 responses per item** gives a difficulty estimate good to ±1 logit at 99% — enough to *route* adaptively and to rank items, not enough to score with. **150–250 responses per item** gives ±½ logit — the point at which item parameters stop being the dominant error source in a person's θ. With a few hundred active users each doing a few hundred items, a pool of ~500–1,000 items reaches 150 responses/item within months, not years. **And critically: the "inflate by 10–40% for unmodeled disturbance" caveat definitely applies to us** — our users practice under wildly heterogeneous conditions (Sprint vs. Deep vs. Infinite modes, different time pressure, coaching present or absent). See the instrumentation gaps section.
- **Caveats**: Rasch/1PL only. 2PL discrimination parameters need substantially more. Assumes reasonable targeting and model fit; adaptively selected items violate the "reasonably targeted" premise in the direction of *helping* (better targeting → lower end of range).

### Hambleton / Wright & Stone / Lord — classical minimum test-length and sample-size guidelines
- **Citation**: Summarized in "Small sample IRT item parameter estimates" (UMass dissertation, ScholarWorks), citing Hambleton (1979), Wright & Stone (1979), Lord (1968), Ree & Jansen (1980), Thissen & Wainer (1982)
- **Link**: https://doi.org/10.7275/16131835
- **Type**: peer-reviewed (dissertation, simulation study) with authoritative secondary summary
- **Key finding**: **[HARD NUMBER]** Hambleton's (1979) classical minimums for satisfactory MLE parameter estimates: **1PL — 20 items, 200 examinees; 2PL — 30 items, 500 examinees; 3PL — 60 items, 1,000 examinees.** Lord (1968) and Thissen & Wainer (1982) put 3PL requirements at **1,000 examinees and 50 items**. Ree & Jansen (1980): 2PL discrimination parameters need **≥1,000 examinees** for reasonably small standard errors. The dissertation's own simulation (item banks of 30 and 60 items; samples of 100, 200, 500; four estimation procedures) concludes: **"the Rasch model may be preferable to the two- and three-parameter logistic models if the available sample is small, and the model approximately fits the data."**
- **Relevance to this product**: **Confirms the model decision: use 1PL/Rasch (optionally 2PL later with strong priors), never 3PL.** The 3PL is what "should" be used for 5-option multiple-choice items where guessing is real — the LSAT has a floor of ~120 precisely because of guessing. But we cannot estimate c. **The practical workaround is to fix the guessing parameter at a known constant rather than estimate it** — for 5-option MC, fix c = 0.20 (or slightly lower, ~0.15, since LSAT distractors are engineered to be attractive). This gives you a "1PL-with-fixed-guessing" (sometimes 1PL-G / Rasch-with-asymptote) model that has 3PL's most important behavior at 1PL's data cost. This is a specific, buildable recommendation.
- **Caveats**: These are 1970s–80s guidelines assuming MLE without priors; Bayesian methods (Schroeders & Gnambs above) relax them materially. The dissertation is old.

### Stone & Yumoto (2004) / He (2019) — Effect of sample size on Rasch equating and person estimates
- **Citation**: Stone, M. H., & Yumoto, F. (2004). *Journal of Applied Measurement*, 5(1), 48–61; He, W. et al. (2019), "Effect of Sample Size on Common Item Equating Using the Dichotomous Rasch Model," *Applied Measurement in Education*, doi:10.1080/08957347.2019.1674309
- **Link**: https://doi.org/10.1080/08957347.2019.1674309
- **Type**: peer-reviewed
- **Key finding**: **[HARD NUMBER]** Resampling design with 9 sample-size conditions (200, 100, 50, 45, 40, 35, 30, 25, 20), 10 replications each, benchmarked against a full-sample calibration of **N = 9,678**. Finding: **item calibration instability rises sharply as N falls — but the decreasing sample size has *minimal* effect on the resulting person ability estimates.**
- **Relevance to this product**: **This is the single most reassuring result in the whole review, and it should drive the build order.** It says: item-parameter noise partially *washes out* when you aggregate across many items to produce a person score, because item difficulty errors are roughly independent and average toward zero. Practically: **we can start estimating student ability with badly-calibrated items and still get usable person estimates, as long as each student answers many items.** We do *not* need to wait for a perfectly calibrated pool before shipping ability estimation. What we *cannot* do is trust any *individual* item's reported difficulty, or make item-level claims ("this question type is your weakness") from thin item data.
- **Caveats**: **[PAYWALL]** — read from abstract and secondary citation. Rasch model only, common-item equating context. The "minimal effect" claim is relative; it will not hold if item selection is adaptive *based on* the noisy parameters (error becomes correlated with selection).

### Local independence / testlet violation
See the LSAC testlet study logged in §1. Its conclusion — that RC items sharing a passage are not independent, and treating them as such inflates apparent reliability — is a first-order constraint on our IRT implementation and is repeated here because it is easy to forget when writing the code.

---

## 3. Cold-start and sparse-data ability estimation: Elo, Glicko, BKT, DKT, PFA, AFM

### Pelánek (2016) — Applications of the Elo Rating System in Adaptive Educational Systems
- **Citation**: Pelánek, R. (2016). *Computers & Education*, 98, 169–179
- **Link**: https://www.fi.muni.cz/~xpelanek/publications/CAE-elo.pdf
- **Type**: peer-reviewed — **the single best practical reference for our situation**
- **Key finding**: **[HARD NUMBER]** A systematic treatment of Elo for simultaneous on-the-fly estimation of student skill and item difficulty. Concrete results:
  - **"The system needs at least 100 students to get good estimates of item difficulty."**
  - Elo with an **uncertainty function** `U(n) = a/(1 + b·n)` (n = number of prior answers) beats fixed K: fast coarse estimates early, stability later. Recommended starting values **a = 1, b = 0.05** for item difficulty; the paper's simulation used a = 4, b = 0.5. Author notes the exact values are not critical.
  - Prior student-modeling work used a fixed **K = 0.4** (Antal 2013; Wauters et al. 2012).
  - **Elo estimates are nearly identical to Joint Maximum Likelihood estimation of the Rasch model**, at a tiny fraction of the compute, and unlike JMLE it updates online in a single pass. Elo is formally equivalent to **stochastic gradient descent on the Rasch likelihood**, with K as the learning rate.
  - **Critical negative result:** when items are selected **adaptively**, the naive "proportion correct" difficulty estimator **gives poor estimates and does not improve as more students are added** — the bias is structural, not a sample-size problem. Under *random* item selection, proportion-correct, JMLE, and Elo all agree.
  - Use **different uncertainty functions for items and for students**, because items accumulate responses orders of magnitude faster than students do.
  - Elo naturally handles **changing skill** (which IRT does not) by keeping K non-negligible; and adding a new item is trivial (set difficulty 0, let it learn).
  - **Multivariate extension**: with correlations `c_ij` between knowledge components, a response on component i updates skill j by `θ_sj += c_ij·K·(correct − p)`.
  - Explicit scope statement: *"the Elo rating system is suitable mainly for adaptive practice or low-stakes testing. The system provides reasonable estimates that are sufficient for guiding adaptive behaviour, but does not provide statistical guarantees on estimated skills (as opposed to well calibrated IRT models used in computerized adaptive testing)."*
- **Relevance to this product**: **This should be the v1 engine.** It solves our exact problem — unknown item parameters, unknown student ability, both must be learned simultaneously from a trickle of data, with skill genuinely changing over time (which is the *whole point* of a prep app and is something standard IRT forbids). Specific mappings: (i) implement Elo with `U(n)=a/(1+bn)`, separate a,b for students and items; (ii) **the "proportion correct" warning is a direct hit on our current design** — our performance snapshot computes raw accuracy per question type, and if Infinite/Review modes serve items non-randomly (they do — spaced review deliberately re-serves items you got wrong), **our accuracy numbers are structurally biased and will not converge to the truth no matter how much data we collect**; (iii) the multivariate extension is the principled version of our per-question-type "skill breakdown," letting an LR-Flaw response inform the LR-Assumption estimate.
- **Caveats**: Author is explicit that Elo gives **no standard errors and no statistical guarantees**. We cannot report a confidence interval from vanilla Elo. That is exactly why §3's next source matters.

### Bolsinova, Maris, Hofman, van der Maas, Brinkhuis (2020) — Tracking with (Un)Certainty
- **Citation**: Hofman, A. D., Brinkhuis, M. J. S., Bolsinova, M., Klaiber, J., Maris, G., & van der Maas, H. (2020). *Journal of Intelligence*, 8(1), 10. doi:10.3390/jintelligence8010010
- **Link**: https://doi.org/10.3390/jintelligence8010010
- **Type**: peer-reviewed
- **Key finding**: Identifies **three statistical defects of the Elo Rating System**: (1) it provides **no standard errors**; (2) it causes **rating variance inflation** (estimated ability spread drifts wider than true spread); (3) the underlying update is not a proper posterior. Proposes an **urn-based tracking system** (each person and item is an urn of green/red marbles; marbles are exchanged after each response) that fixes all three while retaining online updating. Validated by simulation and on real Math Garden data.
- **Relevance to this product**: **This is the fix for Elo's fatal flaw for our use case.** The founder wants to *report* uncertainty ("X ± Y"), and vanilla Elo cannot produce Y. Two options: (a) implement the urn scheme, which is genuinely simple — an urn of size N is literally a beta-binomial posterior with a fixed effective sample size, so the "standard error" falls out; or (b) use **Glicko**, which carries an explicit rating deviation (RD). **The variance-inflation warning is a concrete bug to watch for**: if we run Elo and then report "our students' ability ranges from 135 to 175," that range will be too wide, and the tails will be fake. Any calibration check should compare the *spread* of our estimates to the known population SD of ~11 points and shrink if inflated.
- **Caveats**: Urn scheme is less battle-tested than Elo. The paper is about tracking systems generally, not LSAT-scale reporting.

### Klinkenberg, Straatemeier & van der Maas (2011) — Math Garden / computer adaptive practice with response-time scoring
- **Citation**: Klinkenberg, S., Straatemeier, M., & van der Maas, H. L. J. (2011). *Computers & Education*, 57(2), 1813–1824
- **Link**: https://www.sciencedirect.com/science/article/abs/pii/S0360131511000418
- **Type**: peer-reviewed — the foundational applied paper for Elo-in-education
- **Key finding**: **[HARD NUMBER]** Deployed to **3,648 children completing over 3.5 million arithmetic problems in 10 months** (~33% outside school hours). Key design choices: (i) a **new item response model based on Elo enabling on-the-fly calibration — "pre-testing is no longer required"**; (ii) an **explicit scoring rule combining accuracy AND response time**, disclosed to the subject during the test; (iii) items sampled at a **mean success probability of 0.75** — "challenging yet not too difficult," deliberately *not* the information-maximizing p=0.5, for motivational reasons; (iv) incorporating speed into scoring **increases the information obtained per item**, which in turn lets you serve *easier* items with less loss of measurement precision than the pure-accuracy result of Eggen & Verschoor (2006) would predict. Results: better measurement precision, high validity and reliability, high user satisfaction.
- **Relevance to this product**: **Three directly transferable design decisions.** (1) **Target p ≈ 0.75, not 0.5.** Information-theoretically p=0.5 is optimal, but this study — the largest real deployment of its kind — deliberately gives up some information to preserve engagement, and compensates by harvesting information from response time. For a product whose retention is its business model, this is the right trade, and there is a real citation for it. (2) **Response time is not decoration; it is measurement information.** Our app already logs pace. The Klinkenberg scoring rule is the principled way to use it (see §8). (3) **Disclose the scoring rule to the user.** They made speed-accuracy scoring transparent, and satisfaction was high. That is an argument for showing the user *how* the estimate is computed rather than hiding it behind a "speedrun index."
- **Caveats**: Children, arithmetic, very short items with near-instant responses. LSAT items take 90–330 seconds; the speed-accuracy relationship at that timescale is different in kind (see the van der Linden material in §8). Their "high validity" claim is internal, not against an external gold-standard test.

### Dynamic-K Elo in adaptive learning environments (2025)
- **Citation**: (2025). "Balancing stability and flexibility: investigating a dynamic K value approach for the Elo rating system in adaptive learning environments." *Behavior Research Methods* / PMC12682724
- **Link**: https://pmc.ncbi.nlm.nih.gov/articles/PMC12682724/
- **Type**: peer-reviewed, 2025 (most current Elo-in-education work found)
- **Key finding**: Reaffirms the K-value tension: high K tracks rapid learning but is unstable; low K is stable but lags true change. Investigates dynamic K schedules. Notes Elo is "less precise than more complex models such as Bayesian knowledge tracing... when items are not independent," but its "transparency and efficiency make it a pragmatic choice." Traces the lineage to Brinkhuis & Maris (2009) and Klinkenberg et al. (2011).
- **Relevance to this product**: Confirms in 2025 that the 2016 Pelánek recommendation is still current practice — Elo has not been superseded for this use case. The "less precise when items are not independent" caveat is our RC-testlet problem again.
- **Caveats**: Incremental methodological work; the practical gain of dynamic K over `U(n)=a/(1+bn)` appears modest.

### Wauters, Desmet & Van den Noortgate (2012) — comparison of item difficulty estimation methods
- **Citation**: Wauters, K., Desmet, P., & Van den Noortgate, W. (2012). *Journal of Computer Assisted Learning* — as reported in Pelánek (2016)
- **Link**: (accessed via Pelánek 2016 summary)
- **Type**: peer-reviewed **[secondary — read via Pelánek]**
- **Key finding**: **[HARD NUMBER]** Compared proportion-correct, IRT, Elo, and human judgment (student feedback, expert rating) for estimating item difficulty. Conclusion: **with a sample of 200 students, all data-driven methods give reliable and highly correlated estimates** — including plain proportion-correct. Pelánek's reanalysis qualifies this heavily: it holds only under *random* item selection.
- **Relevance to this product**: Gives us a concrete "when does the item pool become trustworthy" milestone: **~200 responses per item under random exposure.** It also gives a cheap fallback: if we don't build IRT at all, plain p-values from 200 randomly-served responses are nearly as good — *provided the serving is random*. That in turn is an argument for deliberately **reserving a randomized slice of item exposure** (see instrumentation gaps).
- **Caveats**: Read through a secondary source, not the original. Language-learning items, not LSAT.

### Bayesian Knowledge Tracing, Deep Knowledge Tracing, PFA, AFM
Logged together in the next block after further searching, since the comparative literature treats them as a family.

### Wilson, Karklin, Han & Ekanadham (2016) — Back to the Basics: Bayesian extensions of IRT outperform neural networks for proficiency estimation
- **Citation**: Wilson, K. H., Karklin, Y., Han, B., & Ekanadham, C. (2016). *Proceedings of EDM 2016* / arXiv:1604.02336 (Knewton)
- **Link**: https://arxiv.org/abs/1604.02336 | https://ar5iv.labs.arxiv.org/html/1604.02336 | code: github.com/Knewton/edm2016
- **Type**: peer-reviewed (EDM) + preprint, with released code
- **Key finding**: **[HARD NUMBER]** Compared 1PO (one-parameter ogive) IRT, **hierarchical IRT (HIRT)**, **temporal IRT (TIRT)**, and DKT on three datasets (ASSISTments, KDD Cup, proprietary Knewton), using an online-response-prediction protocol with 5-fold cross-validation by student. Findings: (1) **IRT-based methods consistently matched or outperformed DKT on all datasets.** (2) **HIRT — which models item difficulty as `β_i ~ N(μ_j(i), σ²)` with items nested in groups and `μ_j ~ N(0, τ²)` — was the best model overall.** (3) DKT's famous ASSISTments AUC of 0.86 **did not replicate**: "proper accounting for duplicate data negates the claimed performance gains"; the original number was reproducible only with duplicates left in. (4) TIRT (temporal) helped only where the data had genuine autocorrelation; a "windowed percent correct" diagnostic revealed which datasets had temporal structure. (5) IRT models scaled to fine-grained content labels where DKT was computationally intractable.
- **Relevance to this product**: **This is the "don't build a neural net" citation, and more importantly it hands us the exact model to build.** HIRT is precisely right for our data: we have items nested in **question types** (LR-Assumption, LR-Flaw, RC-Inference, …) and in **passages**. Modeling `β_item ~ N(μ_question_type, σ²)` means **a brand-new item with zero responses inherits its question type's mean difficulty as a prior** — solving item cold-start for free — and an item with 5 responses gets shrunk sensibly toward its type. This is the single highest-leverage modeling decision in this document, it is implementable in Stan/PyMC in a day, and the reference implementation is public. The "windowed percent correct" diagnostic is also a cheap thing to run on our own data to decide whether we need a temporal model at all.
- **Caveats**: 2016 (pre-transformer). Modern KT architectures (SAKT, AKT, SAINT) postdate it, but the replication concerns and the interpretability/data-hunger arguments are unchanged, and none of them address uncertainty quantification, which is what we need.

### Khajah, Lindsey & Mozer (2016) — How Deep is Knowledge Tracing?
- **Citation**: Khajah, M., Lindsey, R. V., & Mozer, M. C. (2016). *Proceedings of EDM 2016* / arXiv:1604.02416
- **Link**: https://educationaldatamining.org/EDM2016/proceedings/paper_144.pdf | https://arxiv.org/pdf/1604.02416
- **Type**: peer-reviewed (EDM)
- **Key finding**: **[HARD NUMBER]** DKT's advantage over BKT largely disappears when BKT is given equivalent flexibility. First, evaluation bias: replicating the original BKT simulations gave **AUC 0.73 vs. the reported 0.67 on ASSISTments, and 0.62 vs. 0.54 on Synthetic** — i.e. the baseline was under-tuned. Second, after adding four previously-published extensions to BKT — **forgetting, latent student abilities, skill induction (inter-skill similarity), and recency/contextualized trial sequence** — enhanced BKT reached performance **statistically indistinguishable from DKT across four datasets.** Conclusion: "knowledge tracing may be a domain that does not require 'depth'."
- **Relevance to this product**: Confirms the previous source from a different angle. The four regularities DKT exploits are a **checklist of features our simple model must include to be competitive**: (a) forgetting (we have a spaced-review mode — decay matters), (b) individual ability variation (our θ), (c) inter-skill similarity (the multivariate Elo / HIRT grouping), (d) recency (weight recent responses more — which Elo does natively via K). If we cover those four in a logistic/Bayesian model, we are at the deep-learning frontier for this problem, at 1/1000th the data and compute.
- **Caveats**: 2016; K-12 math tutoring datasets; "indistinguishable" was on average across datasets, with variation.

### Pavlik, Cen & Koedinger (2009) — Performance Factors Analysis
- **Citation**: Pavlik, P. I., Cen, H., & Koedinger, K. R. (2009). *Proceedings of AIED 2009*, 531–538
- **Link**: http://pact.cs.cmu.edu/pubs/AIED%202009%20final%20Pavlik%20Cen%20Keodinger%20corrected.pdf | https://files.eric.ed.gov/fulltext/ED506305.pdf
- **Type**: peer-reviewed (AIED)
- **Key finding**: PFA is a **logistic regression** predicting correctness from: one **difficulty parameter per item**, plus **two parameters per skill** capturing the effect of prior *successes* and prior *failures* on that skill. It is a reconfiguration of Learning Factors Analysis / the Additive Factors Model (AFM) that drops the student term and replaces the skill term with item identity, making it usable for adaptive item selection rather than only for domain-model search. Handles multi-skill items (which BKT cannot) and can be extended to latencies. In head-to-head with two KT versions, PFA had better log-likelihood, BIC, r, and A′, though "the differences are not large."
- **Relevance to this product**: **PFA is the model that separates "how much you know" from "how much you've practiced" — which is exactly the founder's question about improvement.** The AFM/PFA form is `logit(p) = θ_student + Σ_k (β_k + γ_k·successes_k + ρ_k·failures_k)`. The **γ_k coefficient is literally an estimated learning rate per skill**: how much each additional correct practice on skill k raises the probability of future success. If we want to say "this student is improving on Flaw questions at rate X," γ_k is the defensible statistic. Two big cautions: PFA has one parameter per item plus two per skill (Gong et al. report **1,013 parameters** for a modest dataset vs. 416 for KT), so it needs regularization at our scale; and the counts (successes/failures) are endogenous with our adaptive serving.
- **Caveats**: PFA models learning as a function of *practice count*, not time — no forgetting term in the base model. Assumes a correct skill-tagging ("Q-matrix"); a wrong Q-matrix corrupts everything.

### Gong, Beck & Heffernan (2010/2011) — Comparing KT and PFA with multiple model-fitting procedures
- **Citation**: Gong, Y., Beck, J. E., & Heffernan, N. T. (2010). *Proc. ITS 2010*, 35–44; extended as (2011) *IJAIED*, 21(1-2)
- **Link**: https://web.cs.wpi.edu/~nth/pubs_and_grants/ITS%202010/Gong%20Comparing%20Knowledge%20Tracing%20and%20Performance.pdf | https://dl.acm.org/doi/10.5555/2336135.2336138
- **Key finding**: **[HARD NUMBER]** Cross-validated head-to-head on ASSISTments: **KT+EM: AUC 0.661, R² 0.072, 416 params. KT+Brute Force: AUC 0.656. PFA_S: AUC 0.673, 1,013 params. PFA_M_bounded: AUC 0.690.** In the extended IJAIED version, PFA had "considerably higher predictive accuracy than KT" and "more plausible" parameter estimates. Their **best model was a PFA variant that ignored the tutor's transfer model entirely — i.e. assumed all skills influence performance on all problems.** Also: both KT and PFA had **relatively low predictive accuracy for incorrect responses; 2/3 of model errors were false positives** (predicting correct when the student erred).
- **Relevance to this product**: **Two sobering, concrete numbers.** (1) **AUCs in the 0.65–0.69 range are what real student models achieve on next-response prediction.** That is well above chance and genuinely useful for item selection, but it is nowhere near "we can predict what you'll do." Any internal claim of a highly accurate predictive model should be checked against this benchmark; if we report AUC 0.85+ on our own data, we probably have a leakage bug. (2) **The best model ignored the skill taxonomy.** That is a direct challenge to our per-question-type skill breakdown: the evidence says a single global ability plus item difficulty predicts about as well as, or better than, a fine-grained skill decomposition. Our question-type breakdown may be more valuable as *coaching narrative* than as *measurement*, and we should be honest internally about which job it is doing. (3) The false-positive asymmetry means **we will systematically over-predict student success** — relevant if we ever show "you have an 80% chance of hitting your target score."
- **Caveats**: Middle-school math. AUC values are dataset-specific; absolute levels don't transfer, the ordering does.

### "Few hundred parameters outperform few hundred thousand" (EDM 2017)
- **Citation**: (2017). *Proceedings of EDM 2017*, paper 50 (funtoot dataset)
- **Link**: http://educationaldatamining.org/EDM2017/proc_files/papers/paper_50.pdf
- **Type**: peer-reviewed (EDM)
- **Key finding**: **[HARD NUMBER]** 3 replications of 2-fold CV. AUC averaged over all data points: **PFA and DKT tie at 0.88**; multi-skill DKT 0.85; BKT variants 0.83–0.85 (plain BKT lowest at 0.83). But AUC averaged **over skills**: **PFA 0.88, DKT 0.75, BKT+F 0.64** — PFA outperforms DKT by 17% and BKT+F by 37.5%. Notes explicitly that how you average AUC materially changes the conclusion.
- **Relevance to this product**: (a) The title is the thesis: a few hundred well-chosen parameters beat a few hundred thousand learned ones on this task. (b) **The averaging warning is an evaluation-protocol trap we will fall into**: if we evaluate our model by pooling all responses, common/easy question types dominate and everything looks good; averaging by question type reveals whether the model actually works on rare types. **We should report both.**
- **Caveats**: Single proprietary dataset (funtoot, Indian K-12 math).

### Assessment of the family — which of these is right for us
Synthesizing the above, for an app with hundreds-to-thousands of users and an uncalibrated pool:

| Method | Handles unknown item difficulty | Handles changing ability | Gives uncertainty | Data hunger | Verdict for us |
|---|---|---|---|---|---|
| Proportion correct | No (and **biased under adaptive serving**) | No | Binomial only | Very low | **Currently what we do. Structurally broken for adaptive/review modes.** |
| Elo (+ uncertainty fn) | **Yes, online** | **Yes** | No (needs urn/Glicko) | ~100 students for item difficulty | **Ship this first** |
| Glicko / urn tracker | Yes, online | Yes | **Yes** | Same as Elo | **Ship this second — needed for "± Y"** |
| 1PL/Rasch (MMLE) | Yes, batch | No | Yes | ~200 examinees, 20 items | Nightly batch recalibration layer |
| **Hierarchical Bayesian IRT** | **Yes, with cold-start priors** | With a temporal extension | **Yes, full posterior** | ~100/item with priors | **The target architecture** |
| 2PL | Yes | No | Yes | ~500–1,000/item | Later, if ever |
| 3PL | Yes | No | Yes | 1,000–3,000+/item; may fail at 2,000 | **Never. Fix c = 0.20 instead.** |
| BKT | No (no item params) | Yes | Weak | Moderate | No — wrong shape for LSAT (no discrete skills to "master") |
| PFA / AFM | Yes (item difficulty) | **Yes, and estimates a learning rate** | Via GLM SEs | Moderate; many params | **Yes, as the *growth* model (§6)** |
| DKT / deep KT | Implicitly | Yes | No | Very high; doesn't replicate | **No** |

---

## 4. Computerized Adaptive Testing and Multistage Testing: can a small app run one?

### Weiss (1982) — Improving Measurement Quality and Efficiency with Adaptive Testing
- **Citation**: Weiss, D. J. (1982). *Applied Psychological Measurement*, 6(4), 473–492
- **Link**: https://journals.sagepub.com/doi/10.1177/014662168200600408
- **Type**: peer-reviewed — the foundational CAT efficiency reference
- **Key finding**: **[HARD NUMBER]** Live-testing (not just simulation) data show **adaptive tests requiring half the number of items of conventional tests to achieve equal reliability, and almost one-third the number to achieve equal validity.** With an adequately designed item pool, CAT achieves **equal precision at all trait levels**, in contrast to conventional tests which trade bandwidth against fidelity.
- **Relevance to this product**: **[HARD NUMBER]** Combined with the arithmetic at the top of §2: if a fixed 75-item form gets us to SE(θ) ≈ 0.24 logits (±2.6 pts) *at best*, an adaptive version reaches the same precision in **~37 items**, or gets to ±1.8 points in the same 75. The "equal precision at all trait levels" property matters commercially: our fixed 75-item diagnostic is presumably built around a mid-range student and therefore measures a 175-scorer and a 140-scorer badly. Adaptive selection fixes that at zero item-writing cost.
- **Caveats**: 1982, pre-dating modern exposure-control concerns; assumes a well-calibrated pool, which is the thing we don't have.

### Feasibility of CAT evaluated by Monte-Carlo and post-hoc simulations (FedCSIS)
- **Citation**: *Annals of Computer Science and Information Systems*, Vol. 21, paper 197
- **Link**: https://annals-csis.org/Volume_21/drp/pdf/197.pdf
- **Type**: peer-reviewed (conference)
- **Key finding**: **[HARD NUMBER]** With a stopping rule of **SE(θ)max = 0.30**, an adaptive version of a **100-item linear test terminated after an average of 25 items — a 75% reduction** — while keeping ability estimates correlated at **Pearson ρ = 0.96** with the full-linear-test estimates. Mismatch (misclassification) rate under SE=0.30 was **under 10%**. Tolerating larger SE shrinks the test to ~10 items. Average adaptive test length is **shorter for average-ability examinees** and longer at the extremes. Content balancing via a combinatorial approach significantly improved domain coverage; item-exposure control had little effect in their setting.
- **Relevance to this product**: **[HARD NUMBER]** Concrete target for our diagnostic: **an adaptive 25–35 item diagnostic can match our current 75-item fixed diagnostic's precision.** That is a huge UX win (a 75-item diagnostic is a ~2.5 hour commitment; 30 items is under an hour) and a huge item-economy win. The ρ=0.96 figure is the number to quote when justifying the change. Note also the corollary: **extreme-ability students need *more* items, not fewer** — our stopping rule must be SE-based, not fixed-length, or we will systematically under-measure our strongest and weakest students, who are exactly the users most likely to churn from a bad estimate.
- **Caveats**: Not an LSAT-like instrument; 100-item pool. Real CAT length reductions depend heavily on pool depth *at the relevant difficulty*, which is our binding constraint.

### Hendrickson — An NCME Instructional Module on Multistage Testing
- **Citation**: Hendrickson, A. (2007). *Educational Measurement: Issues and Practice*, NCME Instructional Module 25
- **Link**: https://ncme.org/wp-content/uploads/2025/10/Module-25-Multi-stage-Testing-Hendrickson-Summer-1.pdf
- **Type**: peer-reviewed (instructional module, NCME)
- **Key finding**: MST advantages over item-level CAT: (1) preassembled and human-reviewable modules, (2) better content balance, (3) control over item ordering/context effects, (4) **greater test security / exposure control**, (5) **allows item review and answer changing within a module**, (6) far lower data-management and compute demands. Critically for us: **"Local independence between the testlets, and thus the unidimensionality of the multistage test composed of testlets, is better assured compared to item-level adaptive tests"** — because a passage-plus-items set is treated as **one polytomous item** and within-set independence is not required. Testlet-based adaptive tests "provide more accurate (often lower) estimates of the reliability of test scores compared to item-level CAT estimates because local item dependence often exists on item-level CATs."
- **Relevance to this product**: **This is the answer to "can a small app run a CAT?" — the answer is: don't, run an MST.** MST solves three of our problems at once: (a) it dissolves the RC testlet problem by making the passage the unit of adaptation, which is *also* the natural UX unit (you can't sensibly serve half a passage); (b) it lets a human review each module, which matters when our item quality is unverified; (c) it needs far less engineering than item-level CAT — no per-response re-estimation in the request path, no real-time optimization, just "score module, look up route, serve next module." A **1-3-3 or 1-2-2 panel design** is a few hundred lines of code. And the reliability point is important: an item-level CAT over our RC items would *report* better precision than it actually has.
- **Caveats**: MST is slightly less efficient than ideal item-level CAT. Needs enough items to build multiple parallel panels, or exposure becomes a problem.

### Kim, Chung & Dodd / panel design comparison
- **Citation**: (2014). "A comparison of panel designs with routing methods in the multistage test with the partial credit model." *Behavior Research Methods*, 46. doi:10.3758/s13428-013-0316-3
- **Link**: https://doi.org/10.3758/s13428-013-0316-3
- **Type**: peer-reviewed
- **Key finding**: MST vocabulary: **panels** (≈ test forms) → **stages** → **modules** (easy/medium/hard item sets) → **pathways**. Two main routing rules: **Defined Population Interval (DPI)** and **Approximate Maximum Information (AMI)**, where AMI routes at the θ where two adjacent modules' information curves cross. Result: **smaller panel structures such as the 1-2-2 design produced similar results to larger structures.** Luecht et al. (2006) found simple **true-score routing** (compare raw correct count to a cut score) is sufficient — you do not need to compute θ to route.
- **Relevance to this product**: **[HARD NUMBER]** This makes MST embarrassingly cheap for us. **A 1-2-2 panel with true-score routing means: serve a 12-item routing module, count correct, if ≥ 7 serve the hard module else the easy module, repeat once.** No IRT computation at serve time whatsoever — just two integer comparisons. That's a one-sprint build. We can compute θ properly offline afterwards. Start here; graduate to AMI/θ-routing when the pool is calibrated.
- **Caveats**: Partial-credit model context. True-score routing is "sufficient," not optimal; it loses a little precision.

### Hendrickson / ETS — MST vs. CAT vs. paper-and-pencil on MCAT verbal reasoning
- **Citation**: (2007). "Comparison of Multistage Tests with Computerized Adaptive and Paper-and-Pencil Tests." *ETS Research Report Series*. doi:10.1002/j.2333-8504.2007.tb02046.x
- **Link**: https://doi.org/10.1002/j.2333-8504.2007.tb02046.x
- **Type**: technical report (ETS)
- **Key finding**: **[HARD NUMBER]** Using a **440-item pool** (64 passage-based sets: eight 10-item, five 8-item, fourteen 7-item, thirty-seven 6-item sets) drawn from eight operational **MCAT Verbal Reasoning** paper forms, compared a **32-item CAT vs. a 33-item MST**, and a **55-item P&P vs. a 54-item MST**.
- **Relevance to this product**: **This is the closest published analogue to our exact problem** — a passage-based reading-reasoning test, adapted via testlets. The item-pool figure is the useful one: **440 items in 64 passage sets was enough to run a real MST.** Our RC pool needs to be in that neighborhood (roughly 60+ passages) to support MST routing on RC; LR, being single items, needs far fewer per module but more total for exposure control. It also confirms 32–33 items suffices for a verbal-reasoning adaptive test.
- **Caveats**: **[PAYWALL]** — read from abstract and search summaries. MCAT VR, not LSAT; the pool was professionally calibrated.

### Duolingo English Test Technical Manual (2025) — an existence proof at tech-company scale
- **Citation**: Duolingo, Inc. (2025). *Duolingo English Test: Technical Manual*, July 2025 edition
- **Link**: https://duolingo-papers.s3.amazonaws.com/other/technical_manual/DET_technical_manual_2025_07.pdf (2023 edition: https://rubypark.com/wp-content/uploads/2024/05/duo-lingo-technical-mannual-2023.pdf)
- **Type**: technical report (test sponsor, current)
- **Key finding**: **[HARD NUMBER]** A software company running a genuinely high-stakes CAT. Numbers from the 2024-07-01 to 2025-06-30 window (**467,174 certified tests**): **test–retest reliability 0.95 (Literacy), 0.94 (Conversation), 0.92 (Comprehension), with SEMs of 5.18, 5.57, and 6.16** respectively on a 10–160 scale. Design: variable-length CAT, EAP θ updated after each item, minimum and maximum item/minute stopping criteria, **over 200 item measurements collected in under an hour**, θ estimated per task type then combined. Item difficulties are **predicted by machine learning from item features** and then updated from live response data. Concordance with IELTS/TOEFL was built with **equipercentile and kernel equating**, and they cite **Kolen & Brennan's recommended minimum of 1,500 examinees for an equipercentile concordance table**; the 2024 subscore study used **1,943 usable IELTS score reports** with a **≤90 day gap** requirement between the two tests. Correlation of DET overall with IELTS overall: **r = 0.73**; subscore correlations lower (Reading .53, Listening .57). They also run "AQuAA," a continuous automated quality-assurance monitor tracking score distributions, internal consistency, SEM, repeater score change, and demographic composition over time with seasonality adjustment.
- **Relevance to this product**: **The single most useful "what does good look like for a company like us" document in this review, and it should be read cover-to-cover by whoever builds this.** Four transferable facts: (1) **A concordance/linking study needs ~1,500+ paired scores.** That is the real price of ever saying "your estimated LSAT score is X" — see §5. (2) **Even a mature, well-funded CAT with r = 0.94 has an SEM of ~5.6 on a 150-point scale (≈3.7%)** — proportionally similar to the LSAT's 2.6/60. Precision is hard for everyone. (3) **The DET–IELTS correlation of 0.73 between two tests measuring the same construct** is a ceiling reminder: even a professionally equated cross-test prediction leaves ~47% of variance unexplained. (4) **Predicting item difficulty from item features via ML** (their AutoIRT work, below) is how they solve cold-start on new items — we can do a cheap version with an LLM.
- **Caveats**: Duolingo has ~half a million tests/year and a psychometrics team. Their reliability comes from scale we don't have. Self-selected repeater sample for test-retest (they acknowledge this and cite Belzak 2024 for the correction).

### AutoIRT (2024) — calibrating IRT with AutoML on item features
- **Citation**: (2024). "AutoIRT: Calibrating Item Response Theory Models with Automated Machine Learning." arXiv:2409.08823 (Duolingo)
- **Link**: https://arxiv.org/pdf/2409.08823
- **Type**: preprint (arXiv), 2024
- **Key finding**: A Monte Carlo EM outer loop with a two-stage inner loop — a non-parametric AutoML grade model trained on **item features**, followed by an item-specific parametric model. Beats both non-explanatory IRT and BERT-IRT on calibration, predictive performance, and score accuracy on the DET. Notably reports that **BERT-IRT is most competitive specifically in the cold-start setting**, and that a **reliability ratio (RR) of 0.5 yields a 30.3% reduction in SEM from the no-measurement baseline.**
- **Relevance to this product**: **The practical cold-start recipe.** Predict a brand-new item's difficulty from its *features* before anyone answers it. For LSAT items our features are cheap and obvious: question type, stimulus word count, answer-choice mean length, presence of quantifiers/negation, Flesch-Kincaid, passage word count and subject area for RC, and — the modern option — an LLM's own estimate of difficulty. Fit a regression from features → calibrated difficulty on the subset of items that *do* have response data, then use it to seed priors for the rest. This is essentially free once we have ~200 calibrated items, and it collapses the "new item is useless for months" problem.
- **Caveats**: Preprint. Their item types (dictation, c-test, yes/no vocab) are far more feature-predictable than LSAT reasoning items, where difficulty comes from argument subtlety that surface features may not capture. Expect a weaker feature→difficulty R² than they get.

### Duolingo English Test: Psychometric Considerations (DRR-20-02)
- **Citation**: Duolingo Research Report DRR-20-02
- **Link**: https://go.duolingo.com/drr-20-02
- **Type**: technical report
- **Key finding**: Explains why Duolingo did *not* simply use Elo in production: "Rating systems, such as the Elo rating system... are highly scalable, but come with their own shortcomings. The main shortcoming is that their statistical properties are not very well understood, making it difficult to assess standard errors or evaluate model fit." Points to Brinkhuis & Maris (2019) for the minimal properties a tracking system should have. Uses a 2PL-family model with **item difficulties predicted by machine learning**. CAT items: minimum 3, maximum 7 of each of five adaptive item types.
- **Relevance to this product**: Independent corroboration of the Elo weakness identified in §3, from a company that actually had to make this decision commercially. Their resolution — **Elo-style scalability is unnecessary below a certain scale; use proper IRT with ML-predicted difficulties** — is a reasonable model for us too, since we are far below the scale where likelihood-based inference is computationally hard. **We can just fit the model nightly in batch.** A few thousand users × a few hundred responses is a rounding error for Stan.
- **Caveats**: 2020; superseded in parts by the 2025 manual.

### Exposure control and the small-pool problem
- **Note (synthesis, not a new source)**: Every CAT source above assumes a pool large enough that maximum-information selection doesn't repeatedly serve the same items. Standard fixes are the **Sympson-Hetter** method, **randomesque** selection (choose randomly among the top-k most informative items), and **a-stratified** selection. For our scale, **randomesque with k = 5–10 is the correct choice**: it is three lines of code, it prevents deterministic item sequences, and — crucially for us — **it restores enough randomness in item exposure to keep item-difficulty estimation unbiased**, addressing Pelánek's warning that adaptive selection breaks naive difficulty estimation. This is a rare case where the cheap solution to one problem also fixes a different problem.

---

## 5. Linking and equating without an official conversion: what is and isn't legitimate

### Kolen & Brennan — Test Equating, Scaling, and Linking (as cited across the equating literature)
- **Citation**: Kolen, M. J., & Brennan, R. L. (2004/2014). *Test Equating, Scaling, and Linking: Methods and Practices* (2nd/3rd ed.). Springer. Accessed via multiple secondary technical reports (ETS RR-06-xx, RR-13-xx; Duolingo 2025 manual, p. 304 citation)
- **Link**: (book; cited numbers verified via https://doi.org/10.1002/j.2333-8504.2006.tb02033.x and the DET 2025 manual)
- **Type**: peer-reviewed (the standard reference text) **[read via authoritative secondary citations]**
- **Key finding**: **[HARD NUMBER]** The canonical sample-size rules for equating: **≥400 examinees per form for linear equating or Rasch-IRT equating; ≥1,500 per form for equipercentile equating or 3PL-IRT equating** (Harris, 1993; Kolen & Brennan, 2004). Anchor-test length (Angoff, 1971/1984): **at least 20 items or 20% of total test length, whichever is greater.** Counterpoint from the same literature: **Wingersky & Lord (1984) found that when item parameters of both forms are estimated *concurrently*, as few as five or six carefully chosen items can serve as satisfactory anchors in IRT equating.** Also: Hanson, Zeng & Colton (1991) found that at **N = 100, the identity function (i.e. "don't equate at all") had lower total linking error than any linear or equipercentile method** — small-sample equating can be worse than no equating. Norcini (1990) found errors not appreciably worse at N=250 than N=500.
- **Relevance to this product**: **These numbers define the boundary of legitimacy for a "your estimated LSAT score is X" claim.** Three concrete conclusions: (1) **Concurrent calibration with a modest anchor set is the realistic path** — Wingersky & Lord's 5–6 item result means we don't need a 20-item anchor if we calibrate everything on one scale simultaneously. (2) **We need ~400 students who have both our internal θ and an official LSAT score to do a Rasch-based linking.** That is the actual number. Not 40, not 4,000. (3) **The identity-function result is the humbling one**: below ~100 paired observations, attempting a conversion is *worse than not attempting one*, because you add estimation error on top of the error you were trying to remove. **This is the strongest technical argument for the app's current refusal to show a scaled score — and it should be stated in exactly those terms rather than as a vague disclaimer.**
- **Caveats**: Read via secondary sources rather than the book itself. The rules of thumb assume a form-to-form equating context with representative samples; our situation (self-selected users, self-reported official scores) is worse in a way none of these numbers account for.

### ETS RR-06-xx — An Alternative to Equating with Small Samples in the NEAT design
- **Citation**: Livingston, S. A., & Kim, S. (2006/2008). *ETS Research Report Series*. doi:10.1002/j.2333-8504.2006.tb02033.x (the "circle-arc" method line of work)
- **Link**: https://doi.org/10.1002/j.2333-8504.2006.tb02033.x
- **Type**: technical report (ETS)
- **Key finding**: Surveys small-sample equating. Reiterates the 400/1,500 thresholds. Reports that with samples of 100, the **identity function beat every linear and equipercentile method** in a random-groups design. Notes that log-linear presmoothing (Holland & Thayer, 2000) materially changes small-sample equipercentile behavior, and that some studies with N as small as 25–200 plus heavy smoothing found small samples "could be appropriate in some situations." Concludes the literature offers **"no definitive recommendation for sample sizes for an appropriate linking process"** because linking is situation-specific.
- **Relevance to this product**: Gives us a defensible *interim* method. If we eventually have, say, 150 users with self-reported official scores, the honest options are (a) don't convert, or (b) use a heavily-smoothed / strongly-shrunken linking with an *explicitly widened* interval that accounts for linking error, not just measurement error. **Anything that reports a converted score without propagating linking error into the interval is misrepresentation.** ETS's own "circle-arc" line of work exists precisely because small-sample equating is a recognized hard problem at organizations with vastly more data than us.
- **Caveats**: **[PAYWALL]** — abstract and secondary summaries only.

### Angoff anchor-length rule and CINEG/NEAT mechanics
- **Citation**: Angoff, W. H. (1971/1984). *Scales, Norms, and Equivalent Scores*. ETS. Verified via the Buros licensure chapter and the Rasch bootstrap-equating study.
- **Link**: https://digitalcommons.unl.edu/cgi/viewcontent.cgi?article=1015&context=buroslicensure | https://doi.org/10.37745/bje.2013/vol10n135667
- **Type**: peer-reviewed / foundational **[read via secondary]**
- **Key finding**: Under the **common-item nonequivalent groups (CINEG/NEAT)** design, Group A takes Test X + Common Set U, Group B takes Test Y + Common Set U; the anchor U carries the scale between them. Anchors may be **internal** (count toward the score, dispersed through the form) or **external** (a separate unscored section — exactly what the LSAT's variable section is). Angoff's rule: anchor ≥ 20 items or 20% of test length. Klein & Kolen (1985) and Norcini et al. (1987) found lengths beyond 20 items add little **if the groups are similar in ability**. Anchor items must be *representative* of the full test in content and difficulty — a "mini-version" of the test — or the equating is biased.
- **Relevance to this product**: **This is the design we should copy, and it is the one legitimate path to a scaled score.** The LSAT itself uses an external anchor (the unscored variable section). Our analogue: **designate a fixed set of ~20–25 items (a "calibration anchor") that every user sees, embedded invisibly in their practice, drawn to be a mini-version of the test in question-type proportions.** Every user's responses to that anchor put them on a common internal scale regardless of what else they practiced. Then, if we ever collect official scores from a subset, the linking function is estimated *once*, on the anchor, and applies to everybody. **Without a common anchor, users who practiced different item mixes are not comparable to each other at all** — which is a defect our current design has right now, since accuracy is computed over whatever items a user happened to see.
- **Caveats**: Anchor items get memorized. They must be refreshed, and refresh breaks the chain unless overlapping. Also: anchor representativeness is a real constraint — a 20-item anchor for a test that is 2/3 LR should be ~13 LR / ~7 RC, and the RC part will be one passage, which is a weak sample.

### ETS RR-13-xx — Exploring alternative test form linking designs with modified equating sample size and anchor test length
- **Citation**: (2013). *ETS Research Report Series*. doi:10.1002/j.2333-8504.2013.tb02309.x
- **Link**: https://doi.org/10.1002/j.2333-8504.2013.tb02309.x
- **Type**: technical report (ETS)
- **Key finding**: Describes **"common item equating to a calibrated item pool"** (Kolen & Brennan, 2004, pp. 201–205) — a variant of NEAT where a new form is equated not to a specific reference form but **to a calibrated pool**, via anchor items drawn from any previously scaled items. Also finds that **splitting an anchor into two subanchors, each seen by ~1,000 rather than 2,000 examinees, yields very small differences** from using the full anchor.
- **Relevance to this product**: **This is architecturally the right target.** We don't have "forms"; we have a pool and a stream of practice. "Equating to a calibrated pool" is exactly the frame: maintain one master IRT scale, add new items by calibrating them against already-scaled items co-administered with them, never re-scale the whole pool. Practically: **every new item should be introduced alongside already-calibrated items in the same session**, so its parameters land on the existing scale automatically. That is a scheduling rule, cheap to implement, and it is the difference between a pool that stays coherent and one that drifts.
- **Caveats**: **[PAYWALL]** — abstract only. Their sample sizes (1,000–2,000 per anchor) are far beyond us.

### Bootstrap equating errors for CINEG with Rasch methods
- **Citation**: (2022). "Bootstrap Equating Errors for the Common-item Nonequivalent Groups Design: A Comparison of Rasch Equating Methods." *British Journal of Education*. doi:10.37745/bje.2013/vol10n135667
- **Link**: https://doi.org/10.37745/bje.2013/vol10n135667
- **Type**: peer-reviewed
- **Key finding**: Simulation with 80 total items and anchor sets of 16, 20, and 24 items (20%, 25%, 30%), comparing Rasch equating methods via bootstrap standard errors. Confirms Angoff's 20-item/20% rule as a reasonable operating point; longer anchors reduce random equating error. Cites Wingersky & Lord (1984) for the concurrent-calibration result that 5–6 well-chosen anchors can suffice.
- **Relevance to this product**: Supplies the method for **quantifying our own linking error**: bootstrap it. If we ever attempt a conversion, we should resample our paired (θ, official score) data a few thousand times and report the bootstrap SE of the conversion, then **add it in quadrature to the measurement SE** before showing a band. `SE_total = √(SE_measurement² + SE_linking²)`. This is a small amount of code and is the difference between an honest band and a fake one.
- **Caveats**: Simulation study in a lower-tier journal; the underlying Angoff/Wingersky results are the load-bearing citations.

### Verdict on §5 — the blunt version
There is no statistical trick that converts an uncalibrated practice item pool into a 120–180 scaled score. The requirements are known and specific:

1. **A common internal scale.** Requires an anchor set every user sees, or a fully concurrent calibration. **Cost: an anchor design + a nightly IRT fit. Achievable now.**
2. **A linking sample.** Requires **N ≈ 400+ users with both an internal θ and a verified official LSAT score**, ideally with a short interval between them (Duolingo required ≤90 days for their concordance). Below ~100 pairs the literature says the identity function beats equating — meaning we'd be adding error. **Cost: a long data-collection campaign. Not achievable now.**
3. **Verified, not self-reported, official scores.** Duolingo found self-reported scores biased enough to require an explicit MDIA bias correction (Haberman, 1984) before use. Self-reported LSAT scores from users who liked our product will be biased upward. **Any conversion built on unverified self-report is not defensible.**
4. **Propagated linking error in the reported band.**

Until 1–4 hold, "your estimated LSAT score is 164" is not a defensible claim, and "164 ± 3" is worse because the interval implies a precision we cannot support. What *is* defensible is described in the design section at the end.

---

## 6. Growth and trajectory: measuring *improvement* rather than level

### The single most important finding in this document

Put two cited numbers next to each other:

- **Hausknecht et al. (2007) meta-analysis, 107 samples, 134,436 participants: the mean practice effect from a first to a second administration of a cognitive ability test is d = 0.24–0.26.**
- **LSAT population SD ≈ 11 points (LSAC TR 26-01). 0.26 × 11 = 2.9 scaled points.**
- **LSAC's observed mean LSAT retake gain, 2024–25: 2.39 points.**

**The entire average LSAT retake gain is statistically indistinguishable from the generic, content-free practice effect observed across the whole cognitive-ability testing literature.** The average LSAT retaker — who typically studies for months between attempts — gains approximately what a person gains from simply having taken the test once before.

This is not an argument that prep doesn't work. It is an argument that **the average is dominated by practice effects, and that any real instructional effect must be detected *against* a ~2.4–2.9 point baseline of pure retest gain.** For the product this has two consequences: (1) **never attribute a user's retake gain of ~2–3 points to our product**; that is the null. (2) **A product claim of value requires showing gains materially above ~3 points, with a control or benchmark.**

### Hausknecht, Halpert, Di Paolo & Moriarty Gerrard (2007) — Retesting in selection: a meta-analysis
- **Citation**: Hausknecht, J. P., Halpert, J. A., Di Paolo, N. T., & Moriarty Gerrard, M. O. (2007). *Journal of Applied Psychology*, 92(2), 373–385. doi:10.1037/0021-9010.92.2.373
- **Link**: https://doi.org/10.1037/0021-9010.92.2.373
- **Type**: peer-reviewed (meta-analysis) — top-tier journal, very large
- **Key finding**: **[HARD NUMBER]** 50 studies, **107 samples, 134,436 participants.** Adjusted overall effect size **d = .26** (sample-weighted mean d = .24) for the first→second administration. **Second→third: d = .18** (k = 16). **First→third: d = .51** (k = 15). **Moderators: effects were larger when practice was accompanied by coaching, and larger when identical forms were used** (vs. alternate forms). 25–50% of applicants in organizational/educational settings retest.
- **Relevance to this product**: **[HARD NUMBER]** (1) Supplies the null model for improvement, as above. (2) **The alternate-form moderator is a design instruction:** if we want our internal progress measurement to reflect learning rather than item memorization, we must **never re-serve the same items in a measurement context.** Our `spaced_review` mode deliberately re-serves items — which is pedagogically correct but means **review-mode responses must be excluded from ability estimation, or the estimate will drift upward for reasons that won't transfer to test day.** Our existing "evidence class" tagging (`timed_unseen`, `spaced_review`, …) is exactly the right instrument for enforcing this, and it may be the best-designed thing in the current system. It should be *used* as an inclusion filter, not just a label. (3) **The coaching moderator cuts against us:** coached practice produces *larger* retest gains, meaning our `coached_practice` (Deep) mode responses will inflate estimated ability relative to what the uncoached official test will show.
- **Caveats**: Selection settings (employment testing), not admissions specifically. d = .26 is an average over heterogeneous tests and intervals.

### Scharfen, Peters & Holling (2018) — Retest effects in cognitive ability tests: a meta-analysis
- **Citation**: Scharfen, J., Peters, J. M., & Holling, H. (2018). *Intelligence*, 67, 44–66
- **Link**: https://gwern.net/doc/iq/2018-scharfen.pdf
- **Type**: peer-reviewed (meta-analysis) — the most recent and largest
- **Key finding**: **[HARD NUMBER]** 174 samples from 122 studies, **786 outcomes, N = 153,185**, longitudinal multilevel meta-analysis for up to four administrations. **SMCR (standardized mean change) 1→2 = 0.327; 1→3 = 0.495; 1→4 = 0.516; 2→3 = 0.169; 3→4 = 0.148.** Critically: **"no further score gains after the third test administration"** — the 3→4 increment is not distinguishable from the 2→3 increment and the curve plateaus. **Heterogeneity is high: for the mean effect of 0.33, τ = 0.32, giving a prediction interval of roughly 0.33 ± 1.96 × 0.32, i.e. −0.30 to +0.96.** Moderators: cognitive operation, test content, **form equivalence (identical > alternate, but this moderator's influence diminishes with more administrations)**, retest interval (longer interval → smaller effect), and age. Theoretical framing: the **power law of practice** predicts a decelerating curve, which the data support.
- **Relevance to this product**: **[HARD NUMBER]** (1) **Practice effects plateau after ~3 administrations.** Our product's diagnostics/full practice tests should therefore expect roughly: +0.33 SD (≈3.6 LSAT points) of pure practice effect by test 2, +0.50 SD (≈5.5 points) by test 3, and **essentially nothing after that.** This is a *directly usable adjustment*: when reporting progress across repeated diagnostics, subtract a decaying practice-effect prior of approximately [0, 3.6, 5.5, 5.7, 5.7, ...] points. Implementing this single adjustment would make our progress reporting dramatically more honest than any competitor's. (2) **The prediction interval spanning −0.30 to +0.96 is the honest expression of individual variability**: for any given student, the practice effect might be nothing, or might be a full SD. This is why we cannot subtract a point estimate and call it done — the adjustment must widen the interval, not just shift it. (3) The **power-law-of-practice** shape is the right functional form for our growth model, not a straight line.
- **Caveats**: Cognitive ability tests broadly (figural, numerical, verbal), not admissions tests. Retest intervals in the meta-analysis vary from days to years. 72% missing data on the sample-intelligence moderator.

### Calamia, Markon & Tranel (2012) — Scoring higher the second time around
- **Citation**: Calamia, M., Markon, K., & Tranel, D. (2012). *The Clinical Neuropsychologist*, 26(4), 543–570. doi:10.1080/13854046.2012.680913
- **Link**: https://doi.org/10.1080/13854046.2012.680913
- **Type**: peer-reviewed (meta-analysis)
- **Key finding**: Meta-analyses of **nearly 1,600 individual effect sizes** for changes in mean performance on standard neuropsychological tests. Practice effects are moderated by **use of alternate forms, participant age, clinical diagnosis, and test-retest interval.** Effects are smaller in clinical than healthy samples. The authors' explicit conclusion is that practice effects must be accounted for when interpreting change over time.
- **Relevance to this product**: Third independent confirmation, from a different field with a different incentive structure (clinicians who *need* to detect real change in patients), that **you cannot interpret a retest gain without a practice-effect correction.** Clinical neuropsychology solved this problem decades ago by publishing practice-effect-adjusted normative change data; we should regard that as the template.
- **Caveats**: **[PAYWALL]** — abstract + secondary summaries. Neuropsych tests, clinical populations.

### Scharfen, Jansen & Holling (2018) — Retest effects in working memory capacity tests
- **Citation**: Scharfen, J., Jansen, K., & Holling, H. (2018). *Psychonomic Bulletin & Review*, 25, 2175–2199. doi:10.3758/s13423-018-1461-6
- **Link**: https://link.springer.com/article/10.3758/s13423-018-1461-6
- **Type**: peer-reviewed (meta-analysis)
- **Key finding**: **[HARD NUMBER]** 234 effect sizes from 95 samples, 68 studies. Retest effect 1→2 **g = 0.28** (raw range **−0.47 to +1.22**, mean 0.31, SD 0.30), with a significant increase in effects **up to the fourth administration**. Test-retest interval and publication year were significant moderators.
- **Relevance to this product**: Reinforces the ~0.25–0.33 SD magnitude across another test family. **The raw range of −0.47 to +1.22 is the number to internalize**: individual retest effects run from meaningfully *negative* to more than a full SD positive. Applied to the LSAT scale that is roughly **−5 to +13 points of pure retest noise per person.** Any per-user "you improved" claim built on two measurements is inside that noise band.
- **Caveats**: Working memory tasks, quite different from LSAT reasoning items.

### Jacobson & Truax (1991) — Reliable Change Index; and Minimal Detectable Change
- **Citation**: Jacobson, N. S., & Truax, P. (1991). *Journal of Consulting and Clinical Psychology*, 59(1), 12–19. Method summaries: Evans, Margison & Barkham (1998), *Evidence-Based Mental Health*, 1(3), 70–72, doi:10.1136/ebmh.1.3.70; PSYCTC RCSC reference page
- **Link**: https://doi.org/10.1136/ebmh.1.3.70 | https://www.psyctc.org/psyctc/root/stats/rcsc/ | tutorial: http://hdl.handle.net/10092/13399
- **Type**: peer-reviewed (foundational method + tutorial reviews)
- **Key finding**: **[HARD NUMBER — this is a formula we should ship]** For change between two occasions:
  - `SEM = SD₁ × √(1 − r)`
  - `S_diff = √2 × SEM = SD₁ × √2 × √(1 − r)`
  - `RCI = (x₂ − x₁) / S_diff`; reliable change is declared when **|RCI| ≥ 1.96** (95%).
  - Equivalently, the **Minimal Detectable Change**: `MDC₉₅ = 1.96 × √2 × SEM`.
  - Reliability of a change score itself: `r_D = (r_tt − r₁₂)/(1 − r₁₂)`, where r₁₂ is the pre-post correlation. **Note what this implies: when the pre-post correlation is high (as it is for a stable trait), the reliability of the difference score is low.** This is the classic difference-score problem.
  - The tutorial review notes explicit **modifications of the RCI for neuropsychological testing to take account of practice effects.**
- **Relevance to this product**: **[HARD NUMBER] Run the numbers for the LSAT and the answer is brutal and extremely useful.** With SD = 11 and r = 0.92: SEM = 11 × √0.08 = **3.11 points**. `S_diff` = √2 × 3.11 = **4.40**. **MDC₉₅ = 1.96 × 4.40 = 8.6 scaled points.**
  > **To be 95% confident that a student's LSAT ability genuinely changed, using two official-length administrations, you need an observed gain of about 9 scaled points.** The average retaker gains 2.4. Which means: **for the large majority of real LSAT retakers, the observed score change is not statistically distinguishable from measurement error.**

  This is the founder's problem stated precisely. It also points at the solution: **the MDC shrinks as reliability rises, and reliability rises with the number of items.** If we accumulate enough practice items that our internal θ has SEM equivalent to 1.5 scaled points instead of 3.1, MDC₉₅ drops from 8.6 to **4.2 points** — and now the typical real improvement becomes detectable. **That is the entire strategic case for the measurement build, in one number.** Also: we should relax to **MDC₈₀ (z = 1.28)** for in-app feedback, which at SEM 1.5 gives ~2.7 points — an appropriate confidence level for a formative, low-stakes progress indicator, provided we label it as such.
- **Caveats**: RCI assumes the two measurements are parallel forms with equal SD and no practice effect; both assumptions are violated here, and the practice-effect correction from §6 must be applied. RCI also uses the *baseline population* SD — using our app's user SD instead of the LSAT population SD will give a different (probably smaller, because our users are less heterogeneous) threshold, and we must be explicit about which we use.

### Willett (1989) / growth-curve reliability, and the number of measurement occasions
- **Citation**: Willett, J. B. (1989), "Some results on reliability for the longitudinal measurement of change," *Educational and Psychological Measurement*, 49, 587–602. Accessed via Rast & Hofer (2014), *Psychological Methods*, PMC4080819; and Brandmaier et al. (2018), *Frontiers in Psychology*, 9:294
- **Link**: https://pmc.ncbi.nlm.nih.gov/articles/PMC4080819/ | https://doi.org/10.3389/fpsyg.2018.00294
- **Type**: peer-reviewed
- **Key finding**: **[HARD NUMBER — conceptual]** The **growth rate reliability (GRR)** / **effective curve reliability (ECR)** of an individual slope estimate depends on (a) between-person heterogeneity in true growth rate σ²_S, (b) measurement error variance σ²_ε, and (c) **SST — the sum of squared deviations of the measurement time points from their mean**, which depends on the number of waves W, their spacing, and total study duration. Willett's key warning: GRR **"confounds the unrelated influences of group heterogeneity in growth-rate and measurement precision"** and must not be read as instrument reliability — if nobody's slope differs, GRR is zero even with a perfect instrument. The most under-exploited lever is **SST, which is directly under the designer's control**: spreading measurements further apart in time increases slope reliability more than adding closely-spaced measurements.
- **Relevance to this product**: **Two concrete design rules.** (1) **Measurement occasions should be *spread out*, not clustered.** A student who takes three diagnostics in one week gets almost no slope information; three diagnostics spaced 3 weeks apart gets a lot. Our product should actively schedule measurement occasions on a spacing designed to maximize SST across the user's expected prep window, rather than letting users take diagnostics whenever. (2) **We should not report a per-user "improvement rate" early.** With W = 2 occasions over 2 weeks, the slope estimate is nearly pure noise. This is a case where the right product behavior is to *withhold* a number the user wants.
- **Caveats**: Developed for multi-year lifespan studies. Our timescale (weeks–months) and our ability to take dozens of measurements are more favorable than the typical longitudinal study, which pushes in our favor.

### Zhang & Wang (2009) — Statistical power analysis for growth curve models
- **Citation**: Zhang, Z., & Wang, L. (2009). *Behavior Research Methods*, 41(4), 1083–1094
- **Link**: https://nd.psychstat.org/_media/research/zhangwang2009.pdf
- **Type**: peer-reviewed
- **Key finding**: **[HARD NUMBER]** Power curves for detecting a mean slope in a latent growth curve model. For effect size γ_S = 0.2, **to reach power = .80 requires N ≈ 300 with three measurement occasions, but only N ≈ 210 with six occasions.** Power rises with both N and the number of occasions, and the two trade off against each other.
- **Relevance to this product**: **[HARD NUMBER]** Gives us the *cohort-level* sample size for answering "does our product produce improvement?": roughly **200–300 users with 3–6 measurement occasions each**, for a modest effect. That is a realistic target for a growing app and should be the design of our first real efficacy study. Note that this is for the *mean* slope (does the average user improve?), which is a much easier question than *individual* slopes.
- **Caveats**: Continuous outcomes, normal errors, no practice-effect term. Adding a practice-effect nuisance parameter costs power.

### Brandmaier, von Oertzen, Ghisletta, Lindenberger & Hertzog (2018) — Precision, reliability and effect size of slope variance in LGCM
- **Citation**: Brandmaier, A. M., et al. (2018). *Frontiers in Psychology*, 9, 294. doi:10.3389/fpsyg.2018.00294; companion tool: LIFESPAN, doi:10.3389/fpsyg.2015.00272
- **Link**: https://doi.org/10.3389/fpsyg.2018.00294 | http://www.brandmaier.de/lifespan
- **Type**: peer-reviewed
- **Key finding**: Formalizes **Effective Curve Reliability (ECR)** and shows power to detect individual differences in change is governed by total study duration, number and distribution of measurement occasions, measurement precision at each occasion, and N. Introduces **power-equivalence** — different designs can have identical power, so one can trade duration against occasions against precision. Provides a free design tool.
- **Relevance to this product**: The **power-equivalence** idea is directly actionable: we can *buy* slope precision either by measuring more often, measuring over a longer window, or **measuring more precisely at each occasion** (more items). For a prep app where users churn, extending duration is not available — so **the lever we must pull is precision-per-occasion, i.e. items.** LIFESPAN can be used to check specific designs before building them.
- **Caveats**: Lifespan-development context; assumes linear growth.

### Ghisletta, Parsons, McCormick, Brandmaier & Lindenberger (2024) — Optimal two-time-point longitudinal models
- **Citation**: Brandmaier, A. M., Lindenberger, U., & McCormick, E. M. (2024). *Developmental Cognitive Neuroscience*, 70, 101450. doi:10.1016/j.dcn.2024.101450
- **Link**: https://doi.org/10.1016/j.dcn.2024.101450
- **Type**: peer-reviewed, 2024
- **Key finding**: **[HARD NUMBER]** **"A minimum of four time points or more is required to model quadratic or exponential trajectories."** Two-time-point designs are not inherently low-powered; their low power in practice comes from a sub-optimal combination of design parameters. Key nuance: **"more time points are better. But just waiting longer for individual differences to develop further may be even better."**
- **Relevance to this product**: (1) If we want to model the *decelerating* (power-law) improvement curve that the practice-effects literature says is the true shape, we need **≥4 measurement occasions per user.** With fewer, we should fit a straight line and say so. (2) The "waiting longer is better than measuring more" result is counterintuitive and commercially awkward — it means a user who studies for 12 weeks and takes 3 diagnostics gives us a better slope estimate than one who studies 4 weeks and takes 6. **Slope confidence should therefore be gated on elapsed time as well as occasion count.**
- **Caveats**: Neuroimaging context; the asymptotic results assume specific error structures.

### Regression to the mean in repeated testing
- **Note (synthesis across the above sources)**: No single source in this review is dedicated to RTM, but it is implicated everywhere and must be handled explicitly. The mechanism: **LSAT retakers are a self-selected group who disproportionately underperformed relative to their true ability on attempt 1** (people who over-perform take the score and go to law school). Their attempt-2 score therefore rises partly because their attempt-1 score was negatively biased by selection, not because they improved. **LSAC's TR 26-01 explicitly warns that its retake findings are descriptive and cannot support causal conclusions** — this is the reason. The magnitude: if attempt-1 error has SD 2.6 and selection into retaking is driven partly by that error, the expected RTM component of a retake gain is a meaningful fraction of the observed 2.4 points.
  - **Product implication, concrete:** our app will observe the same thing. Users who take a diagnostic, score badly, and then study hard will show inflated apparent gains. **The correction is to always compare against a model-based expected value that conditions on the baseline (i.e., include baseline θ as a covariate and expect shrinkage), never against the raw baseline observation.** A Bayesian ability estimate with shrinkage toward the population prior does this automatically — which is another argument for the Bayesian model over raw scores.

---

## 7. Predictive validity: what actually predicts LSAT performance, and what does the LSAT predict?

### LSAC — Summary of 2021–2025 LSAT Correlation Study Results
- **Citation**: Law School Admission Council (2026). *Summary of 2021-2025 LSAT Correlation Study Results*. Released January 2026.
- **Link**: https://www.lsac.org/sites/default/files/research/summary-of-2021-2025-lsat-correlation-study-results_accessible.pdf | landing: https://www.lsac.org/data-research/research/lsat-correlation-study-results
- **Type**: technical report (test sponsor, current)
- **Key finding**: **[HARD NUMBER]** 170 participating schools; 154 with complete data; mean combined class size 457. Ten-year trend of **raw** correlations with first-year average (FYA), using **average** LSAT: **LSAT/FYA r ≈ 0.38–0.42** (0.42 in 2024 and 2025); **UGPA/FYA r ≈ 0.24–0.27**; **LSAT+UGPA/FYA R ≈ 0.47–0.50**. Using **highest** LSAT: LSAT/FYA 0.35–0.38. After **multivariate correction for restriction of range** (applicant-pool estimates): **LSAT/FYA r ≈ 0.55–0.61** (0.60 in 2025), UGPA/FYA ≈ 0.40–0.44, **LSAT+UGPA/FYA R ≈ 0.62–0.67**. Between-school spread is wide: raw LSAT/FYA ranges from **0.15 to 0.61** across schools (SD 0.08). Matriculant LSAT mean rose from 154.60 (2016) to **156.54 (2025)** with SD **5.38** — i.e., *within a law school class* the LSAT SD is about half the SD of the full test-taker population. UGPA has developed a ceiling effect (SD fell 0.20 → 0.16); LSAT has not.
- **Relevance to this product**: **[HARD NUMBER]** Three uses. (1) **A ceiling on all prediction claims.** The LSAT — a professionally built, highly reliable test — correlates about **0.42 raw / 0.60 corrected** with the outcome it is explicitly designed to predict. That is r² ≈ 0.18 raw / 0.36 corrected. **If the gold-standard instrument in this domain explains 18–36% of variance in the thing it targets, our app's internal metrics should never be described as "predicting" anything with confidence.** This is the number to quote internally whenever someone proposes a bold predictive claim. (2) **The average-vs-highest finding is directly relevant to our reporting**: LSAC finds *average* LSAT is a slightly *better* predictor than *highest* LSAT. The analogue for us: **a student's average performance across many sessions is a better estimate of ability than their best session.** Our UI should therefore lead with a smoothed/averaged estimate, not a personal best — the opposite of typical gamified-app instinct. (3) **The restriction-of-range correction is a technique we will need.** Our users are self-selected and probably narrower in ability than the test-taker population; any correlation we compute on our own users will be attenuated by the same mechanism and should be corrected before comparison to published figures.
- **Caveats**: Correlations are with 1L grades, not with LSAT scores — this is validity of the LSAT for *its* purpose, not a model for predicting LSAT scores. Restriction-of-range corrections are model-dependent and inflate estimates.

### LSAC RR-21-01 — LSAT Takers and Khan Academy Preparation
- **Citation**: Dustman, K., Gallagher, A., & Camilli, G. (2021). *LSAT Takers and Khan Academy Preparation*, LSAC Research Report RR 21-01
- **Link**: https://lsac.org/sites/default/files/research/LSAT-Test-Taker-Khan-Preparation_RR-21-01_full-report.pdf | summary: https://www.lsac.org/blog/study-shows-lsat-score-increases-candidates-who-use-free-khan-academy-prep-tools
- **Type**: technical report (test sponsor) — **the single best published study of a prep platform's relationship to LSAT scores**
- **Key finding**: **[HARD NUMBER]** Quasi-experimental, N = 6,938 (6,550 with LPM ≥ 2), matched Khan Academy usage logs to actual LSAT scores, June 2018 – July 2020.
  - **Pearson correlations: practice minutes with LSAT score r = 0.19; UGPA with LSAT r = 0.33; practice minutes with UGPA r = 0.08.** (All p < .0001.)
  - **Video minutes were NOT correlated with LSAT scores** — only *practice* minutes were. (Video minutes correlated with age, r = 0.16.)
  - Regression controlling UGPA, Pell status, age: **standardized β = 0.17–0.18 for log practice minutes; R² = 0.21.**
  - **Dose-response by practice time**, relative to the 10th percentile (26 minutes) baseline: 25th pct (3 h) **+1.7 points** (d = 0.16); 50th pct (11 h) **+2.9** (d = 0.27); 75th pct (27 h) **+3.8** (d = 0.35); 90th pct (**47 hours**) **+4.3 points** (d = 0.40). Effect sizes computed against LSAT SD = 10.7.
  - **Dose-response by practice exams taken** (vs. zero exams, controlling covariates): 1–2 exams **+1.59**; 3–4 **+3.58**; 5–6 **+4.39**; 7–8 **+5.59**; 9–10 **+7.26 points**.
  - **Interaction with baseline:** using first-practice-exam (FPE) score quartiles, standardized LPM effects were **larger for FPE quartiles 2 and 3 (β = .24) than quartile 4 (β = .18)** — lower-scoring students got more return per practice minute (ceiling effect at the top). The model including FPE reached **R² = 0.64**, with FPE4 β = .68 — i.e., **the first practice exam score is by far the dominant predictor of the eventual official score.**
  - Average users: 4.5 unique practice exams; **average gain from first to most recent practice exam ≈ 3 points.**
- **Relevance to this product**: **[HARD NUMBER] This is the closest thing that exists to an answer to the founder's question, and the numbers are humbling but usable.**
  1. **The strongest single predictor of a student's official LSAT score is their first practice exam score** (β = .68, and the R² jumps from .21 to .64 when FPE enters). That is: **baseline ability dominates; everything the platform does is a modest increment on top.** Our product's estimate of a student's *level* is far more predictively valuable than our estimate of their *growth*.
  2. **47 hours of practice — the 90th percentile of engagement — was worth 4.3 points.** That is the realistic ceiling of a free-practice platform's observable association. **Any marketing claim above ~5 points from practice volume alone is outside what LSAC's own data supports.**
  3. **Video minutes did nothing; practice minutes did.** Direct support for the product's practice-first thesis, and an argument against investing in passive content.
  4. **The practice-exam dose-response (+7.26 points at 9–10 exams) is bigger than the practice-minutes effect** — full-length exams appear to carry more value per unit than diffuse practice, though this is confounded with motivation. It also overlaps heavily with the practice-effect literature in §6: 9–10 exams should produce ~0.5 SD ≈ 5.5 points of pure retest effect, meaning **most of the +7.26 may be practice effect rather than learning.** This is the most important caveat in the whole report and LSAC does not draw it out.
  5. **Lower-scoring students have more headroom.** Consistent with our product's likely user base.
- **Caveats**: LSAC states plainly this is quasi-experimental, not randomized, and "the possibility of alternative explanations cannot be ruled out." Engagement is confounded with motivation, conscientiousness, and available time — the students who practiced 47 hours differ from those who practiced 26 minutes in ways UGPA/Pell/age do not capture. Data is from 2018–2020, pre-dating the 2024 format change.

### Practice-test-to-official-score prediction: the state of public evidence
- **Citation**: Multiple commercial/secondary sources: lsatscorecalculator.com PrepTest accuracy page; Magoosh LSAT blog; ScoreGap LSAT score prediction guide
- **Link**: https://lsatscorecalculator.com/lsat-preptest-scores/ | https://magoosh.com/lsat/predict-lsat-score/ | https://scoregap.com/guides/lsat-score-prediction
- **Type**: documentation (commercial, secondary) — **[DEAD END for rigorous evidence, logged so we don't re-search it]**
- **Key finding**: The consistent commercial claim is that **most test-takers score within 2–4 points of their average across the last 5–8 official PrepTests taken under strict conditions**, and that a *single* PrepTest is much less reliable than a multi-test average. Commercial sources also assert a **"practice-to-official gap" of roughly −2 to −5 points** for first-time takers. Critically, ScoreGap states directly: **"LSAC has not published data specifically quantifying this gap... No rigorous published study confirms a specific number, so treat this as a planning heuristic rather than a rule."**
- **Relevance to this product**: **The honest finding here is a gap in the literature, and that is itself valuable.** There is **no peer-reviewed or sponsor-published quantification of the practice-test-to-official-score relationship.** Every number in circulation is tutor folklore. Two implications: (1) **We must not cite the "±2–4 points" or "−2 to −5 gap" figures as if they were established.** (2) **This is a genuine research opportunity for the product.** If we systematically collect (practice θ, official score) pairs with dates, we would possess data that literally does not exist publicly. That is a defensible long-term moat and a credible publishable result. It also happens to be exactly the data required for the linking in §5. **This should be the highest-priority instrumentation add.**
  Note also that the "average of last 5–8 tests" heuristic is *statistically sensible* for a reason the commercial sources don't state: averaging k independent measurements reduces SEM by √k. Averaging 5 tests with SEM 3 gives SEM 1.34 — which is precisely the mechanism our whole design exploits.
- **Caveats**: All three sources are commercial content marketing with an incentive to sound authoritative. Treated here as evidence about *what is claimed*, not about what is true.

### LSAC — LSAT Validity and ABA Standard 503; Research Archive holdings
- **Citation**: LSAC, *LSAT Validity and ABA Standard 503*; also references LSAC (2019), *2018 Skills Analysis Study: Content Validity of the LSAT* (RR 19-01)
- **Link**: https://www.lsac.org/data-research/research/lsat-validity-and-aba-standard-503
- **Type**: documentation (test sponsor, advocacy-flavored)
- **Key finding**: Historical context: ~105 LSAC-sponsored studies 1949–1983 compiled into 4 volumes, of which **53 address validity.** Notes that **163 law schools participated in the most recent annual correlation study cycle**, and that LSAC regularly publishes technical reports on repeat test takers and differential prediction. Points to **RR 19-01 (2018 Skills Analysis Study)** as the current content-validity basis for the LSAT's skill claims.
- **Relevance to this product**: **RR 19-01 is worth requesting from LSAC.** A published skills analysis of what the LSAT actually measures is the closest thing to an official Q-matrix / skill taxonomy for LSAT items — which is exactly what our per-question-type breakdown needs in order to be more than an invented taxonomy. If our question types don't map to LSAC's own skills analysis, our "skill breakdown" is measuring categories the test doesn't have.
- **Caveats**: This page is partly institutional defense of the LSAT against ABA Standard 503 test-optional proposals; read with that framing in mind.

---

## 8. Speededness and response time: is "pace adherence" psychometrically meaningful?

### van der Linden (2007) — A Hierarchical Framework for Modeling Speed and Accuracy on Test Items
- **Citation**: van der Linden, W. J. (2007). *Psychometrika*, 72(3), 287–308. doi:10.1007/s11336-006-1478-z (LSAC-affiliated preprint version: LSAC RR 05-02)
- **Link**: https://doi.org/10.1007/s11336-006-1478-z | full text: https://ris.utwente.nl/ws/files/5129699/Linden05hierarchical.pdf
- **Type**: peer-reviewed (Psychometrika) — **and note: the preprint is an LSAC Research Report, so LSAC itself has invested in this framework**
- **Key finding**: The now-standard framework for joint speed-accuracy modeling. Structure: **Level 1 (within-person)** has two component models — an IRT model for the response (correct/incorrect) with person parameter θ (ability) and item parameters, and a **lognormal model for the response time** with person parameter **τ (speed)** and item parameters **time intensity (β) and time discrimination (α)**. **Level 2 (population)** joins them: (θ, τ) have a bivariate normal distribution capturing how speed and accuracy covary in the population, plus an **item-domain model relating items' time intensities to their difficulties.** Key architectural claim: **speed and accuracy are separate person parameters, and the framework explicitly rejects earlier models that "have a parameter structure chosen to represent a speed-accuracy tradeoff" or that "equate speed directly with response time."** A "plug-and-play" design with Bayesian MCMC (Gibbs) estimation. Explicitly demonstrates **using response times as an additional source of information for estimating ability**, and shows how the level-2 model can **predict a test taker's accuracy from their speed**.
- **Relevance to this product**: **This is the correct rebuttal to how our app currently treats time, and it is a fundamental correction.**
  - Our "pace adherence" score compares a student's time to a fixed per-item target (150s LR / 330s RC / 135s same-passage follow-up) and folds the result into a composite index as a *component of merit*. **van der Linden's framework says this conflates two distinct latent traits.** Speed (τ) and ability (θ) are separate person parameters; being fast is neither good nor bad in itself. A student can be fast and inaccurate, or slow and accurate. **Rewarding pace adherence inside an ability composite is a category error** — it makes the index respond to a trait that isn't the one we claim to measure.
  - Worse: because θ and τ covary in the population (and the sign of that covariance is an empirical question, not an assumption), **adding pace to an ability score double-counts whatever part of speed is already reflected in accuracy** and adds noise for the rest.
  - **The right use of our timing data is as a second information channel for estimating θ**, exactly as van der Linden shows and as Klein Entink/Klinkenberg operationalize: model log(RT) as `log t_ij ~ Normal(β_i − τ_j, 1/α_i²)`, estimate τ_j jointly with θ_j, and let the correlation between them be estimated from data. **This strictly increases the information per item** — which means fewer items needed for the same precision, which is the product's core constraint.
  - **The item-level payoff is also large**: `β_i` (time intensity) is a per-item property we can estimate from the same data. Fixed per-type target times (150s/330s/135s) are a crude stand-in for a parameter we could actually measure. A 40-word LR stimulus and a 110-word one do not have the same time intensity, and treating them as if they do injects error into every pace score we show.
- **Caveats**: Requires MCMC and a joint model — more implementation work than a threshold comparison. Assumes constant speed within a test session, which is violated by fatigue and end-of-section rushing (see below).

### van der Linden (2006) — A Lognormal Model for Response Times on Test Items
- **Citation**: van der Linden, W. J. (2006). *Journal of Educational and Behavioral Statistics*, 31(2), 181–204. doi:10.3102/10769986031002181
- **Link**: https://doi.org/10.3102/10769986031002181
- **Type**: peer-reviewed
- **Key finding**: **[HARD NUMBER — model form]** The lognormal RT model has a parameter structure analogous to the 2PL: a **speed parameter per person**, and **time intensity + time discrimination per item**. Estimated via Gibbs sampling. Validated on the adaptive ASVAB: **the lognormal model showed excellent fit; a normal model could not accommodate the characteristic skew of RT distributions.** Constraining time-discrimination parameters to be equal across items **cost only a slight loss of fit** — i.e. a simplified one-parameter time model is nearly as good.
- **Relevance to this product**: **[HARD NUMBER]** Two immediately usable facts. (1) **Model log(time), not time.** Response times are right-skewed; every mean, every "pace adherence" ratio, and every threshold we compute on raw seconds is distorted by that skew. Switching all our timing statistics to the log scale is a one-line change that measurably improves them. (2) **The equal-discrimination simplification is nearly free**, so we can use the simpler one-parameter-per-item time model (just time intensity β_i) and skip estimating α_i. That is a meaningful reduction in what we need to fit.
- **Caveats**: ASVAB items are far shorter than LSAT items. The model assumes a constant within-session speed.

### Klein Entink et al. (2009) / three-parameter lognormal extension, and the response-time threshold
- **Citation**: Klein Entink, R. H., Fox, J.-P., & van der Linden, W. J. (2009), *Psychometrika*; extended in (2020) "Modeling Responses and Response Times in Tests With the Hierarchical Model and the Three-Parameter Lognormal Distribution," *Educational and Psychological Measurement* / PMC7565119
- **Link**: https://pmc.ncbi.nlm.nih.gov/articles/PMC7565119/
- **Type**: peer-reviewed
- **Key finding**: The standard lognormal has support from **zero** to infinity, which is unrealistic: any real solution process requires a **minimum processing time**. Ignoring this **threshold misspecifies the model and threatens the validity of model-based inferences.** Replacing the lognormal with a **three-parameter lognormal** — adding a location/shift parameter that bounds support away from zero — improved fit in both real datasets tested.
- **Relevance to this product**: **[HARD NUMBER — conceptual, but very concrete for us]** LSAT items have a large and obvious minimum processing time: you physically cannot read a 60-word LR stimulus, five answer choices, and select one in under ~20 seconds. **Responses below that floor are not fast correct answers; they are guesses, misclicks, or disengagement.** Two actions: (1) fit a shift parameter, or more cheaply (2) **flag and exclude sub-threshold responses from ability estimation** — this is rapid-guessing detection, and it is the highest-value, lowest-effort item on the entire response-time list. Any practice app that doesn't filter rapid guesses has its accuracy statistics contaminated by them, and the contamination is worst in exactly the mode where engagement is lowest (probably Infinite/fluency).
- **Caveats**: Choosing the threshold is somewhat arbitrary; common practice is a fixed floor (e.g. 3–5 seconds for short items) or a visual-inspection/mixture-model approach.

### Bürkner et al. — Bayesian hierarchical response time modelling: a tutorial
- **Citation**: (2023). "Bayesian hierarchical response time modelling — A tutorial." *British Journal of Mathematical and Statistical Psychology*. doi:10.1111/bmsp.12302
- **Link**: https://doi.org/10.1111/bmsp.12302
- **Type**: peer-reviewed (tutorial), recent
- **Key finding**: Step-by-step implementation guidance for the three-parameter lognormal RT model jointly estimated with IRT models in van der Linden's hierarchical framework, in a Bayesian setting. Covers three extensions: (a) the **distance-difficulty hypothesis**, (b) **conditional dependence between response times and accuracy** (Bolsinova, de Boeck & Tijmstra, 2017) — i.e. RT and correctness are related *even after* conditioning on θ and τ, which the base framework assumes away, and (c) **mixture modelling of qualitatively different response behaviours** (Ulitzsch et al., 2019) — e.g. solution behaviour vs. rapid guessing as distinct latent states.
- **Relevance to this product**: **The implementation manual.** Specifically: the **mixture-modelling extension is the principled version of rapid-guessing detection** — instead of a hard time threshold, model each response as coming from either a "solution behaviour" state or a "guessing" state and estimate the probability. That is more defensible and would let us report, honestly, "18% of your Infinite-mode responses look like guesses, so we've down-weighted them." The **conditional-dependence extension** matters because it is the formal statement of the thing our "pace adherence" is groping at: *given* a student's ability and speed, does taking unusually long on a particular item predict getting it wrong? If yes, residual time is informative and we can use it. That is a testable question on our own data and a much better foundation than a hardcoded 150-second target.
- **Caveats**: Assumes comfort with Stan/JAGS and Bayesian workflow. The extensions add substantial estimation cost.

### Assessment: is "pace adherence" psychometrically meaningful?
Synthesizing: **partly, but not in the way the product currently uses it.**

- **Defensible**: (a) using response time as *additional information* about θ, which reduces the item count needed for a given precision; (b) estimating a separate **speed parameter τ** and reporting it as its own thing; (c) using time to **detect rapid guessing** and exclude those responses; (d) using per-item **time intensity β_i** instead of per-type constants; (e) a genuine **speededness diagnostic** — "at your current speed, you would not finish a 35-minute section" — which is a real, actionable, and separately meaningful claim.
- **Not defensible**: folding a pace-adherence score into a composite ability index (the "speedrun index" = 0.55×accuracy + 0.25×reasoning + 0.20×pace). That composite is not measuring one thing. Its weights are arbitrary, it mixes an ability estimate with a speed estimate and an LLM's opinion, and it has no standard error. **It is a product metric, not a measurement — and it should be labeled as such, or removed from anything that looks like a score.**
- **The single highest-value change**: replace the fixed 150s/330s/135s targets with **empirically estimated per-item time intensities**, and report pace as a percentile against other students on *the same items* rather than against a constant. This is straightforward once we log per-item response times (which we already do) and it immediately makes pace feedback correct rather than approximately correct.

---

## 9. Sample-size reality check on the within-student A/B strategy trials

### The design under review
Per the product spec: a within-student strategy A/B bandit, measuring per-strategy accuracy/pace/calibration "lift" against a **silent 25% control**, with maturity labels `forming` / `directional` / `supported`, where **`supported` requires ≥8 prompted + ≥4 control observations.**

### Method
Two-proportion power analysis, α = 0.05 two-sided, computed directly (verified numerically). Baseline accuracy assumed **p = 0.60**, which is a reasonable central value for LSAT practice accuracy; results are insensitive to this within 0.5–0.7. Outcome is binary item correctness. All computations reproducible from the formula `n = [z_{α/2}√(2p̄q̄) + z_β√(p₁q₁+p₂q₂)]² / (p₁−p₂)²`.

### Result 1 — Power of the current thresholds (8 prompted vs. 4 control)

| True effect of the strategy prompt | SE of the difference | **Power** |
|---|---|---|
| +5 percentage points | 0.297 | **5.3%** |
| +10 points | 0.294 | **6.3%** |
| +20 points | 0.283 | **10.9%** |
| +30 points | 0.267 | **20.3%** |

**At the current thresholds the test has essentially no power.** With a true +5 point effect — already an optimistic effect for a UI prompt — the probability of detecting it is **5.3%**, which is indistinguishable from the 5% false-positive rate. **The test cannot tell a real effect from no effect at all.**

- **Minimum detectable effect at 80% power with 8 vs. 4: 84 percentage points.**
- **Minimum detectable effect at 50% power: 59 percentage points.**

A strategy that moved accuracy by 59 points would take a student from 60% to 119%. **The current design's minimum detectable effect is outside the range of possible values.** That is the cleanest way to state the problem: the test is not underpowered, it is *arithmetically incapable* of the inference it is labeled as making.

### Result 2 — Measurement granularity makes it worse
With 8 prompted observations, the observed accuracy can only take 9 values (0/8 … 8/8) — **granularity 12.5 percentage points.** With 4 control observations, only 5 values — **granularity 25 percentage points.** The *observed* "lift" is therefore quantized in steps of 12.5–25 points. **We are reporting a continuous-looking lift statistic computed from a variable that can only move in 25-point jumps.** Any decimal place in that number is fiction.

### Result 3 — Multiple comparisons
If k strategies are each evaluated at α = 0.05 with no correction:

| Number of strategies tested | P(at least one spurious "supported") |
|---|---|
| 3 | 14.3% |
| 5 | 22.6% |
| 8 | 33.7% |
| 12 | 46.0% |

With a dozen strategies in the system, **it is close to a coin flip that at least one gets a spurious "supported" label** — before accounting for the fact that a bandit *preferentially surfaces* whichever arm currently looks best, which is a winner's-curse amplifier on top of this.

### Result 4 — What N is actually required
Required **total** observations (prompted + control combined), at 80% power, α = .05 two-sided, from p = 0.60, under the current **75/25 allocation** (the unequal split costs a 1.33× inflation over a balanced design):

| True effect | Balanced total | **Total at 75/25 split** |
|---|---|---|
| +2 points | 18,670 | **24,894** |
| +3 points | 8,257 | **11,010** |
| +5 points | 2,941 | **3,921** |
| +10 points | 712 | **949** |
| +15 points | 304 | **405** |
| +20 points | 162 | **217** |

**Honest assessment of plausible effect size.** A strategy prompt shown before an item is a small intervention. Comparable interventions in educational technology move binary accuracy by low single-digit percentage points at most. A **+3 point effect is a realistic optimistic estimate**, and it requires roughly **11,000 observations.** Even a very generous +10 point effect requires **~950 observations.**

**The current thresholds are off by a factor of roughly 20× (for an implausibly large +20 point effect) to 900× (for a realistic +3 point effect).**

### Result 5 — Per-student vs. pooled: the design flaw underneath the numbers
The critical point is *where* those observations must come from. **The current design frames this as a within-student question — "is this strategy working for you?"** The numbers above are the per-comparison requirements, and no individual student will ever produce 11,000 practice items. **A per-student "supported" verdict is not achievable at any realistic level of engagement, ever.**

But the same numbers are entirely achievable **pooled across the user base**. 3,900 observations for a +5 point effect is roughly 130 students × 30 items. That is a completely reasonable milestone for a growing app.

**So the recommendation is not "raise the thresholds." It is "change the estimand."**

- Fit a **hierarchical (mixed-effects) logistic regression**: `correct ~ strategy + (1 | student) + (1 | item) + (strategy | student)`.
- The **fixed effect of strategy** is estimated by pooling all students' data — this is the question we can actually answer, and it needs the N in the table above.
- The **random slope `(strategy | student)`** gives each student a *shrunken* personal estimate. With 12 observations, that estimate will be shrunk almost entirely to the population mean — **which is exactly correct behavior**, and it means the model will honestly tell a student "the evidence for you specifically is that this works about as well for you as for everyone else."
- This is a strictly better product too: a new user gets a useful strategy recommendation on day one from the pooled effect, instead of waiting for 12 personal observations that would tell them nothing anyway.

### Result 6 — The bandit invalidates the inference
- **Citation**: Zhang, Janson & Murphy / Hadad et al., "Demystifying Inference After Adaptive Experiments," *Annual Review of Statistics and Its Application*, doi:10.1146/annurev-statistics-040522-015431; Johari, Koomen, Pekelis & Walsh (2017/2022), "Peeking at A/B Tests" (KDD 2017) and "Always Valid Inference: Continuous Monitoring of A/B Tests," *Operations Research*, doi:10.1287/opre.2021.2135; Liang & Bojinov (2024), "An Experimental Design for Anytime-Valid Causal Inference on Multi-Armed Bandits," arXiv:2311.05794; Ham, Bojinov et al., "Design-Based Confidence Sequences," arXiv:2210.08639
- **Link**: https://doi.org/10.1146/annurev-statistics-040522-015431 | http://library.usc.edu.ph/ACM/KKD%202017/pdfs/p1517.pdf | https://arxiv.org/html/2311.05794v3 | https://arxiv.org/pdf/2210.08639
- **Type**: peer-reviewed (Annual Review, Operations Research, KDD) + preprints
- **Key finding**: **Two independent problems, both of which our design has.** (1) **Adaptivity**: in multi-armed bandits, "the asymptotic normality we would usually appeal to in nonadaptive settings can be imperiled by adaptivity"; **the sample mean of a bandit arm is biased, and the bias can be positive or negative** (Shin, Ramdas & Rinaldo, 2019). Standard confidence intervals do not have their nominal coverage. Fixes: **inverse-propensity reweighting to stabilize variances and recover asymptotic normality**, always-valid inference, or explicitly inverting the non-normal adaptive distribution. (2) **Peeking**: continuously monitoring a test and stopping when it looks significant **inflates Type I error without bound**; Optimizely built the mSPRT-based always-valid p-value machinery specifically because their users did this. Liang & Bojinov's **Mixture Adaptive Design (MAD)** mixes any bandit with a Bernoulli design at a controlled, decaying rate, which restores anytime-valid inference on the ATE while preserving most of the bandit's reward.
- **Relevance to this product**: **Our silent 25% control is already the right instinct — MAD is the formalization of it, and it says the fix is nearly free.** Concretely: (a) **Log the assignment propensity for every single observation** and use IPW when estimating lift; without stored propensities the bias is not correctable after the fact, and this is data we cannot reconstruct later. (b) **The maturity labels are a peeking mechanism.** The system continuously re-evaluates and flips a strategy to `supported` the moment thresholds are crossed — this is textbook peeking and it inflates false positives on top of everything above. (c) **Use a confidence sequence rather than a fixed-horizon test** if we want a label that updates continuously; that is what always-valid inference is for and it is the only statistically correct way to have a live-updating "is this supported yet?" indicator. (d) Keep the control floor at 25% or use a decaying-but-bounded-away-from-zero exploration rate, per MAD.
- **Caveats**: The always-valid machinery costs power relative to a fixed-horizon test in exchange for the freedom to peek — typically a modest constant factor, which is a trivial price given we're currently off by 20–900×.

### N-of-1 trial design (for completeness on the within-subject framing)
- **Citation**: Lillie, E. O. et al. (2011), "The n-of-1 clinical trial: the ultimate strategy for individualizing medicine?", *Personalized Medicine* / PMC3118090; Percha et al. (2019), "Designing Robust N-of-1 Studies for Precision Medicine," *JMIR* / PMID 30932871; Rochon-lineage serial-correlation t-tests, *PLOS ONE*, doi:10.1371/journal.pone.0228077
- **Link**: https://pmc.ncbi.nlm.nih.gov/articles/PMC3118090/ | https://pubmed.ncbi.nlm.nih.gov/30932871/ | https://doi.org/10.1371/journal.pone.0228077
- **Type**: peer-reviewed
- **Key finding**: N-of-1 (within-subject crossover) designs use `n ≥ 2σ²(z_{α/2}+z_β)²/δ²` cycles, where each cycle is a treatment period + control period. For continuous outcomes with moderate effects and within-patient SD ≈ 1, **4–8 cycles** reach 80% power. Critical design requirements: **randomize order within each cycle, insert washout between periods to prevent carryover**, and account for **serial correlation** — the serial-correlation literature notes that ignoring it "can lead to erroneous inferences," and that guidance on N-of-1 sample sizes was essentially absent from the literature until recently. Wang & Schork's power work used **n = 400** observations per individual.
- **Relevance to this product**: The reason N-of-1 trials work with 4–8 cycles and ours doesn't is that they use **continuous outcomes measured with low noise**, whereas ours is **a single binary item**, which carries at most 1 bit and has variance p(1−p) ≈ 0.24 per observation. **The lesson is transferable and useful: if we want a within-student verdict in a realistic number of trials, we must move to a lower-variance outcome.** Options: aggregate a *block* of 10 items into a single continuous accuracy score and treat the block as the unit; or use **response time** (continuous, log-normal, much more information per observation) as a co-primary outcome; or use an **IRT-residual** outcome (observed correct minus model-predicted probability), which removes item-difficulty variance and is far less noisy than raw correctness. The **carryover/washout** point is also directly relevant — a strategy prompt shown on item 1 plausibly affects behavior on item 2, which violates independence and further inflates the effective variance beyond what the tables above assume. **The real numbers are therefore somewhat worse than the ones I computed.**
- **Caveats**: Clinical context. Our "treatment" is a UI prompt, far weaker and far less separable than a drug.

---

## 10. Reporting uncertainty to users

### LSAC's own practice as the reference standard
Re-citing the LawHub scoring page from §1, because it is the most defensible model available: **the test sponsor itself never reports a bare point estimate.** Every official score is accompanied by a score band of ±1 SEM (~±2.6 points, so a ~5-point band), and LSAC explains it to test-takers in plain, non-defensive language: your proficiency "may be slightly higher or slightly lower"; the band "reflects the range of scores you likely would receive if you took the LSAT again"; variation comes from "guessing, being sick, or being hungry."

**Three things to steal from this framing:**
1. **Attribute the uncertainty to the world, not to the product.** LSAC blames guessing, illness, hunger — not "our test is imprecise." This is both true and non-alienating.
2. **Use the counterfactual-retake frame.** "The range of scores you'd likely get if you took it again" is far more intuitive than "95% credible interval," and it is the correct interpretation.
3. **Band width is a feature to explain, not hide.** LSAC bands a professionally equated score. Our banding is conformity with the sponsor's own standard, not an admission of weakness, and should be said in those words.

### Duolingo's AQuAA and reliability disclosure
Re-citing the DET Technical Manual (§4): Duolingo publishes its reliability and SEM by subscore in a public technical manual (0.92–0.95 reliability, SEM 5.18–6.16), and runs a continuous automated quality-assurance system tracking score distributions, internal consistency, SEM, and repeater score change over time.
- **Relevance**: The commercial move here is worth noting. **Publishing your own SEM is a trust asset, not a liability** — no competitor LSAT prep product publishes anything like this, and doing so would be genuinely differentiating for a product whose whole pitch is measurement rigor.

### Practical guidance synthesized across sources
No single source in this review is *about* uncertainty communication to test-takers specifically; the guidance below is synthesized from LSAC's and Duolingo's operational practice plus the measurement constraints established above. Flagging that honestly rather than dressing it up as a citation.

- **Report an interval, always. Never a bare point estimate.** If we cannot compute an interval, we cannot report the number.
- **Use ~80% intervals for formative in-app feedback and ~95% for anything decision-grade** (e.g. "are you ready to sit the test?"). An 80% interval is narrower and less demoralizing while remaining honest; the confidence level must be labeled.
- **Make the interval narrow visibly as evidence accumulates.** This turns uncertainty into a progress mechanic — the user watches their band tighten as they practice, which is motivating *and* is a truthful depiction of what is happening. This is probably the single best UX idea in this document.
- **Never let a displayed interval imply more precision than the model has.** If the band is 14 points wide, show 14 points wide.
- **Separate "level" from "change."** These have different and much larger uncertainties (change uncertainty is √2 × level uncertainty at minimum, per §6). A user should never see a change statement unless it clears the MDC.
- **Prefer ranked/ordinal statements when the interval is wide.** "You're currently in the range that typically corresponds to the mid-150s" survives a wide band far better than a number does.
- **Show the evidence base.** "Based on 240 clean items over 6 weeks" is honest, calibrates trust, and gives the user an actionable lever (do more items → narrower band).

---

## 11. Two additional load-bearing sources: professional standards, and the confidence-calibration metric

### AERA, APA & NCME (2014) — Standards for Educational and Psychological Testing
- **Citation**: American Educational Research Association, American Psychological Association, & National Council on Measurement in Education (2014). *Standards for Educational and Psychological Testing*. AERA. **Open access since March 2021.**
- **Link**: https://www.testingstandards.net/uploads/7/6/6/4/76643089/standards_2014edition.pdf | https://ncme.org/resources/books/testing-standards/
- **Type**: technical standards (the governing professional document in the field)
- **Key finding**: The controlling principles for what we may claim. (1) **"Validity refers to the degree to which evidence and theory support the interpretations of test scores for proposed uses of tests."** (2) **"It is the interpretations of test scores for proposed uses that are evaluated, not the test itself"** — and the Standards explicitly instruct that one should **never use the unqualified phrase "the validity of the test."** (3) Each distinct interpretation requires its own validation: describing a test-taker's *current level* and *predicting a future outcome* are **two different claims requiring two different bodies of evidence.** (4) **"Higher levels of evidence are required when test use has important consequences for individuals or for society"** — evidence must be proportional to stakes. (5) Validation is open-ended and continuous: evidence should be collected before initial use and analyzed on an ongoing basis. (6) The five essential validity elements: careful test construction; **adequate score reliability**; appropriate administration and scoring; **accurate score scaling, equating, and standard setting**; and fairness/access. (7) Documentation must communicate intended interpretations, **measurement error**, and appropriate uses to all audiences including test takers. (8) The 2014 edition added specific attention to technology-based assessment, automated scoring of open-ended items, and automated score reporting.
- **Relevance to this product**: **This is the document that adjudicates "what can we legitimately claim," and it is free.** Direct applications: (a) **Our two headline ambitions are separate claims.** "Here is your current ability" and "you will do better on the LSAT" require separately assembled evidence; we currently have a partial basis for the first and essentially none for the second. (b) **Element (D), "accurate score scaling, equating, and standard setting," is precisely the element we cannot satisfy** — which is the formal statement of why we cannot show a 120–180 score (§5). (c) **The proportionality principle is our friend**: a formative, low-stakes in-app progress indicator requires materially less evidence than a score report used for a decision. This means **framing matters legally and ethically, not just cosmetically** — a "practice progress estimate" and an "LSAT score prediction" sit at different evidentiary thresholds, and we get to choose which product we are building. (d) The requirement to document **measurement error** to test takers is a standards-level obligation, not a nicety, and supports the banding recommendations in §10. (e) The 2014 attention to **automated scoring of open-ended items** is directly relevant to our LLM-graded "reasoning" score, which is currently an unvalidated automated score being fed into a composite with a 0.25 weight.
- **Caveats**: US-centric; aspirational for high-stakes programs. A practice app is not an admission test and is not bound by the Standards — but the Standards are the yardstick any expert critic would apply, and the founder's stated ambition ("statistically predict") is a claim that invites exactly that scrutiny.

### Guggenmos (2021/2022) and Rahnev-lab work — reliability of metacognitive/calibration measures
- **Citation**: Guggenmos, M. (2021). "Measuring metacognitive performance: type 1 performance dependence and test-retest reliability." *Neuroscience of Consciousness*, 2021(1), niab040. doi:10.1093/nc/niab040. Companion: Rahnev, D., "Measuring metacognition: A comprehensive assessment of current methods," doi:10.31234/osf.io/waz9h. Foundational: Fleming, S. M., & Lau, H. C. (2014), "How to measure metacognition," *Frontiers in Human Neuroscience*, 8, 443
- **Link**: https://doi.org/10.1093/nc/niab040 | https://doi.org/10.31234/osf.io/waz9h | https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2014.00443/full
- **Type**: peer-reviewed
- **Key finding**: **[HARD NUMBER — and it is bad news for our confidence-calibration feature]** Analyses of the Confidence Database (**total N = 6,912**) show: (1) **No current metacognitive performance measure is independent of type-1 (task) performance** — calibration metrics move mechanically with how well the person is doing on the underlying task. (2) **Reliability is highly sensitive to trial number and performance level: at 250 trials and 60% correct, test-retest Pearson reliability is only r = 0.2.** For contrast, **the reliability of type-1 performance itself is close to 1.0 at around 250 trials.** (3) Rahnev's assessment: all measures have high **split-half** reliability above 100 trials, but **test-retest reliabilities are often very low**, with serious implications for individual-differences use. Commonly recommended minimum for stable estimates: **~400 trials.** (4) Fleming & Lau: **sensitivity** (can you discriminate your correct from incorrect answers?) and **bias** (are you over/underconfident overall?) are distinct constructs that are routinely conflated. (5) Under guessing (as in 5-option MC), **correct guesses inflate observed accuracy and bias calibration measures toward apparent underconfidence, most strongly for the lowest performers.**
- **Relevance to this product**: **Our "high-confidence error rate" metric is far less trustworthy than it appears, and the fix is specific.**
  - At the item counts our users will realistically reach, **a calibration metric has test-retest reliability around 0.2** — meaning a user's calibration score this week barely predicts their calibration score next week. Showing it as a stable personal trait ("you are overconfident") is not supportable. **We should require several hundred confidence-rated items before showing any calibration statistic, and we should present it as a property of a *time window*, not of the person.**
  - The **type-1 dependence** means our calibration number will move whenever a student's accuracy moves, creating a spurious "your calibration improved" signal that is really just "you got better at the test." **This must be residualized against accuracy before display.**
  - **The guessing bias is directly applicable**: LSAT items are 5-option MC, so ~20% of "correct" answers by a struggling student are lucky guesses, which systematically distorts their calibration toward apparent underconfidence. Applying **Abbott's correction** for guessing before computing calibration is the standard remedy and is a one-line change.
  - **Separate sensitivity from bias.** "High-confidence error rate" conflates them. The genuinely useful, actionable signal for a test-taker is **sensitivity** — can you tell which of your answers are shaky? — because that is what drives good time-allocation and review decisions. That should be reported (as a within-person AUC of confidence predicting correctness), and it should be reported separately from overall over/underconfidence.
- **Caveats**: This literature comes from perceptual decision-making tasks with hundreds of fast trials, not 90-second reasoning items. Whether reliability accrues faster per item on high-information LSAT items is an open question — plausibly yes, but we should not assume it. The core warning about type-1 dependence is structural and transfers regardless.

## 12. Additional primary sources (supplementing §§3, 8, and 10)

These were consulted after the thematic sections above were drafted, to log primary sources for claims that were initially made through secondary citations, and to close gaps on rapid-guessing detection, uncertainty rating systems, and score reporting.

### Wise & Kong (2005) — Response Time Effort: a new measure of examinee motivation
- **Citation**: Wise, S. L., & Kong, X. (2005). *Applied Measurement in Education*, 18(2), 163–183. (Also NCME 2005 conference paper, ERIC ED490203.)
- **Link**: https://files.eric.ed.gov/fulltext/ED490203.pdf | https://eric.ed.gov/?id=ED490203
- **Type**: peer-reviewed
- **Key finding**: **[HARD NUMBER]** Introduces **Response Time Effort (RTE)**: for each item i there is a threshold T_i separating **rapid-guessing behavior** from **solution behavior**; RTE is the proportion of items on which the examinee showed solution behavior, ranging 0–1, with values near 1 indicating strong effort. Thresholds are set from **item length** (stem + options in characters) plus inspection of the bimodal spike in the short-time region of each item's RT distribution. In their 80-item instrument the final thresholds were **3 s (27 items), 5 s (46 items), 10 s (7 items).** Their key validity check (H4): **rapid-guessing responses should be correct at a rate consistent with chance** — this is the empirical test that a threshold has been set correctly.
- **Relevance to this product**: **This is the citation and the method for the rapid-guessing filter recommended in §8 and the design section, and it comes with a built-in validation test we can run on our own data.** Concretely: bucket our response times per item, look for the short-time spike, set T_i, then **verify that responses below T_i are correct at ≈20% (chance for 5-option MC)**. If they're correct at 45%, the threshold is too high and we're discarding real work. This turns an arbitrary cutoff into an empirically checkable one, and it costs an afternoon. Note LSAT items are far longer than these — our thresholds will be tens of seconds, not 3–10, and the item-length-based rule is the right way to derive them.
- **Caveats**: Low-stakes institutional testing, where disengagement is rampant; our users are self-motivated and presumably guess less. But `fluency`/Infinite mode is exactly the low-stakes condition where this behavior appears.

### Wise and colleagues / normative-threshold methods — Test engagement and rapid guessing in a large-scale state assessment
- **Citation**: (2023). *Frontiers in Education*, 8, 1127644. doi:10.3389/feduc.2023.1127644, applying Wise & Kong (2005) and Wise & Ma (2012)
- **Link**: https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2023.1127644/full
- **Type**: peer-reviewed
- **Key finding**: **[HARD NUMBER]** Formalizes the **normative threshold (NT)** family, which is simpler than per-item inspection: **NT10 sets the threshold at 10% of the mean time all students spent on that item, capped at 10 seconds.** NT20 and NT30 use 20% and 30% with the same cap. The operational convention: **RTE below 0.90 is defined as meaningful disengagement** (Wise, 2015; Wise & Kingsbury, 2016; Wise & Gao, 2017). The paper uses all three variants as a sensitivity analysis.
- **Relevance to this product**: **[HARD NUMBER] NT10 is the version to implement — it is literally one line and requires no per-item hand-tuning:** `threshold_i = min(0.10 × mean_time_i, 10s)`. Given LSAT item times (mean ~90 s for LR), NT10 gives a ~9-second threshold, which is a sensible floor. **Recommend computing RTE per user per session and flagging sessions below 0.90 as disengaged**, both for excluding them from ability estimation and as a genuinely useful piece of user feedback ("this session looked rushed — we haven't counted it toward your estimate"). Running NT10/NT20/NT30 as a sensitivity check, as they do, is the cheap way to confirm our conclusions aren't threshold artifacts.
- **Caveats**: The 10-second cap is calibrated to K-12 items much shorter than LSAT items; we should probably raise or drop the cap and rely on the 10%-of-mean rule.

### Glickman (1995/1999) — The Glicko and Glicko-2 rating systems
- **Citation**: Glickman, M. E. (1999). "Parameter estimation in large dynamic paired comparison experiments." *Journal of the Royal Statistical Society: Series C (Applied Statistics)*, 48(3), 377–394. Practitioner write-ups: *The Glicko System* and *Example of the Glicko-2 System*.
- **Link**: https://www.glicko.net/glicko/glicko.pdf | https://glicko.net/glicko/glicko2.pdf
- **Type**: peer-reviewed (Applied Statistics) + author documentation
- **Key finding**: **[HARD NUMBER]** Glicko augments each competitor's rating **r** with a **rating deviation (RD)** — literally a posterior standard deviation — and Glicko-2 adds a **volatility σ** capturing how erratic the competitor's performance is. **Elo is a special case of Glicko.** Operational conventions: **a new player starts at RD ≈ 350; RD shrinks toward 30–80 as games accumulate; RD inflates between rating periods** (√(σ² + c²)) to allow for skill drift during inactivity. Glickman's own guidance is that **it is "usually informative to summarize a player's strength in the form of an interval rather than merely report a rating"** — a 95% interval is r ± 2·RD. Rating periods should contain an average of **at least 10–15 games** per player.
- **Relevance to this product**: **Glicko is the drop-in fix for Elo's missing standard error (§3), and its design choices map onto our problem almost line for line.** (1) **RD inflation during inactivity is exactly what we need**: a student who hasn't practiced in three weeks *should* have a wider band, and Glicko gives us that mechanic for free — it also creates an honest, non-manipulative re-engagement hook ("your estimate has gotten fuzzier; a short session will sharpen it"). (2) **Glicko-2's volatility parameter is a genuinely interesting product signal**: a student with high volatility is inconsistent session-to-session, which is a real and coachable phenomenon distinct from being low-ability. (3) **Glickman independently arrives at the same reporting conclusion as LSAC and this document**: report the interval, not the point. (4) The rating-period concept maps naturally onto our practice sessions.
- **Caveats**: Glicko assumes competitor strength is roughly constant within a rating period — reasonable at session granularity, less so over months. Its uncertainty is a normal approximation, not a full posterior; the hierarchical Bayesian model in the design section gives strictly better uncertainty if we can afford to fit it.

### Corbett & Anderson (1994/1995) — Knowledge Tracing: modeling the acquisition of procedural knowledge
- **Citation**: Corbett, A. T., & Anderson, J. R. (1994). *User Modeling and User-Adapted Interaction*, 4, 253–278. doi:10.1007/BF01099821
- **Link**: http://act-r.psy.cmu.edu/wordpress/wp-content/uploads/2012/12/893CorbettAnderson1995.pdf
- **Type**: peer-reviewed — the primary source for BKT
- **Key finding**: The original BKT. A two-state hidden Markov model per skill with four parameters: **P(L₀)** initial knowledge, **P(T)** probability of learning at each opportunity, **P(G)** guess, **P(S)** slip. Knowledge probability is updated after each response; the tutor sequences exercises until each rule is "mastered." Built on the ACT-R production-rule cognitive model of programming knowledge.
- **Relevance to this product**: **Logged mainly to justify not using it.** BKT's core assumption — that a skill is a discrete production rule that a student transitions from "unlearned" to "learned" and then retains — is a good model for *procedural* skills like a programming construct or a multiplication fact. **It is a poor model for LSAT reasoning ability**, which is a continuous latent trait, not a set of binary mastery states, and which is what the 120–180 scale explicitly assumes. BKT also **has no item-difficulty parameter at all** (see §3 comparison table), which for us is disqualifying: our central problem is an uncalibrated item pool, and BKT cannot even represent item difficulty.
- **Caveats**: Foundational and enormously influential; the criticism here is about fit to our construct, not quality.

### Beck & Chang (2007) — Identifiability: a fundamental problem of student modeling; and van de Sande (2013)
- **Citation**: Beck, J. E., & Chang, K.-m. (2007). *Proceedings of User Modeling 2007*, LNAI 4511, 137–146. Follow-up: van de Sande, B. (2013), "Properties of the Bayesian Knowledge Tracing Model," *Journal of Educational Data Mining*, 5(2)
- **Link**: https://www.cs.cmu.edu/~kkchang/paper/BeckChang.2007.UserModeling.IdentifiabilityStudentModel.pdf | https://files.eric.ed.gov/fulltext/EJ1115329.pdf
- **Type**: peer-reviewed
- **Key finding**: **The identifiability problem.** Multiple, materially different parameter sets for BKT produce **identical predictions** — "statistically there is no justification for preferring one model over another," yet they "make different assertions about student knowledge." Van de Sande's analysis explains the origin: the BKT Markov chain is **actually a three-parameter model in functional form**, so the four nominal parameters are over-specified; different combinations of P(G) and P(L₀) that yield the same composite quantity produce exactly the same functional form. Related: **model degeneracy**, where fitted parameters violate their conceptual meaning (e.g. the model implying knowledge *decreases* after a correct answer). Which parameter set you get depends on the optimizer's starting point.
- **Relevance to this product**: **A general warning that applies well beyond BKT, and one worth internalizing before we build anything.** If a model's parameters are not identifiable, the software will still return numbers, they will still look plausible, and **they will still be shown to users as if they meant something.** Our own risk surface: the "priority" score (0.65×accuracy + 0.2×reasoning + 0.15×pace) and the "speedrun index" have arbitrary rather than estimated weights, which is a related pathology — the numbers are stable only because the weights are hardcoded, not because they were identified from data. **The practical discipline: for any model we fit, run a recovery check** — simulate data from known parameters, refit, and confirm we get the parameters back. If we don't, the model is not identified and its outputs are not interpretable. This is a half-day of work that prevents shipping a confidently-wrong number.
- **Caveats**: The identifiability critique is specific to BKT's parameterization; hierarchical IRT with proper priors is much better behaved (the priors resolve the non-identifiability), which is another argument for the design recommended above.

### Piech et al. (2015) — Deep Knowledge Tracing (the original claim)
- **Citation**: Piech, C., Bassen, J., Huang, J., Ganguli, S., Sahami, M., Guibas, L., & Sohl-Dickstein, J. (2015). *NeurIPS 2015*
- **Link**: (referenced throughout the EDM 2016 replication literature logged in §3; original arXiv:1506.05908)
- **Type**: peer-reviewed **[read via the two independent replication papers in §3]**
- **Key finding**: Trained an RNN to predict student responses and reported an **AUC of 0.86 on ASSISTments**, roughly a **20 percentage-point improvement** over the best published prior results — the result that launched the deep-knowledge-tracing literature.
- **Relevance to this product**: Logged because it is the claim that everything in §3 is arguing against, and because the failure mode is instructive. **Two independent groups found the headline result did not survive scrutiny**: Wilson et al. reproduced 0.86 only with duplicate rows left in the data, and Khajah et al. found the BKT baseline had been under-tuned (0.67 reported vs. 0.73 achievable). **Neither problem was in the model; both were in the evaluation.** For us the transferable lesson is about our own evaluation hygiene: **deduplicate, split by student not by response, and tune the baseline as hard as the new model.** Our performance snapshot already deduplicates to first-attempt-per-question, which is the right instinct — the same discipline needs to extend to any model evaluation we run.
- **Caveats**: **[SECONDARY]** Read through replications rather than the original. DKT remains a legitimate and useful line of work; the criticism is of the specific reported margin and of its applicability at our scale.

### Zenisky & Hambleton (2012) — Developing test score reports that work
- **Citation**: Zenisky, A. L., & Hambleton, R. K. (2012). *Educational Measurement: Issues and Practice*, 31(2), 21–26. doi:10.1111/j.1745-3992.2012.00231.x. See also Hambleton & Zenisky (2013), and the edited volume *Score Reporting Research and Applications* (Routledge, 2019), doi:10.4324/9781351136501
- **Link**: https://doi.org/10.1111/j.1745-3992.2012.00231.x | https://doi.org/10.4324/9781351136501
- **Type**: peer-reviewed
- **Key finding**: Score reports are the vehicle through which nearly all test-takers get their information, and **historically they have not met examinees' information or usability needs.** The authors argue for an **iterative design-and-evaluate process**: build a report, then collect empirical validity evidence on whether users actually understand it, using **interviews, think-aloud protocols, eye tracking, and formal experimental designs.** The 2019 volume states the obligation plainly: **"our professional guidelines (Standards, 2014, Standard 6.10) expect that score reports will include explicit information about the measurement error (imprecision) associated with reported test scores"** — while acknowledging that communicating uncertainty to non-specialists "is not easy." Recommended report elements include guidance on score use, next steps, and links to resources.
- **Relevance to this product**: **[HARD NUMBER — a specific Standard]** Two things. (1) **Standard 6.10 of the 2014 Standards is the specific provision requiring measurement error to be reported**; that is the exact citation for the banding recommendation in §10 and it is worth quoting in any internal debate about whether bands are "too discouraging." (2) **The methodological instruction is directly actionable and cheap for a software team: test the score report the way we'd test any UI.** Run five think-alouds on the ability-band screen and ask users to say what the band means. This is a normal week of product research, and it is *also* the professional standard for score-report validation. It would be a genuine differentiator: no LSAT prep product treats its score display as something requiring validity evidence.
- **Caveats**: K-12 accountability and large-scale admissions context; our formative, low-stakes use case has more latitude.

### Zwick, Zapata-Rivera & Hegarty (2014) — Comparing graphical and verbal representations of measurement error
- **Citation**: Zwick, R., Zapata-Rivera, D., & Hegarty, M. (2014). *Educational Assessment*, 19(2), 116–138. doi:10.1080/10627197.2014.903653
- **Link**: https://doi.org/10.1080/10627197.2014.903653
- **Type**: peer-reviewed (randomized experiment)
- **Key finding**: **[HARD NUMBER]** Created four alternative score reports representing measurement error in different graphical and verbal ways, randomly assigned them, and compared comprehension and preference. **N = 148 teachers**, plus **98 introductory psychology students** for comparison. Findings: (1) **No statistically significant differences in comprehension across the four conditions** — the specific representation mattered less than expected. (2) **Participants with greater self-reported comfort with statistics had higher comprehension and preferred more informative displays including variable-width confidence bands.** (3) The study "yielded a wealth of information regarding existing misconceptions about measurement error and about score-reporting conventions" — **many educators do not understand the terminology or displays used in score reports, and measurement error is a particularly challenging concept.**
- **Relevance to this product**: **The most honest and most useful finding here is the null result, and it should change how we spend effort.** Agonizing over whether the band is a violin plot, an error bar, or a shaded region is not where the value is — **comprehension did not differ across representations.** What did predict comprehension was the user's statistical background. So: (a) **don't over-invest in chart design; invest in the words.** (b) **Our users are LSAT candidates — a highly educated, quantitatively-screened population, likely at the high-comfort end** of this study's distribution, which means the finding that statistically-comfortable users *prefer more informative displays with variable-width bands* probably describes our users. That is a rare case where the rigorous option is also the one users want. (c) **Assume baseline misconceptions exist anyway** and state the interpretation in words next to the graphic, rather than relying on the graphic to carry it.
- **Caveats**: Teachers and psych undergrads, not admissions-test candidates. Null results on comprehension may reflect limited power (n = 148 across four conditions).

### British Psychological Society — Communicating Test Results: Guidance for Test Users
- **Citation**: British Psychological Society, Psychological Testing Centre, *Communicating Test Results: Guidance for Test Users* (PTC37)
- **Link**: https://cms.bps.org.uk/sites/default/files/2022-07/ptc37_communicating_test_results_0.pdf
- **Type**: documentation (professional body guidance)
- **Key finding**: Explicit practitioner guidance. **"Raw scores should not generally be communicated to test takers... as they are not usually meaningful in themselves. Raw scores need putting into context through norm referencing, criterion referencing or similar, and it is these contextualised scores that should be communicated."** Test users are responsible for ensuring communicated results are *accurately understood by the recipient*, considering the audience's test literacy, the purpose, and the presentation medium. Under UK GDPR/DPA 2018 subject access rights, information provided must be understandable and **"would therefore typically be presented in terms of a contextualised score, including information about the norm group... and confidence band,"** plus a description of the test and the constructs it measures.
- **Relevance to this product**: **Independent, non-US professional confirmation of the entire §10 recommendation set, and it adds one thing the other sources don't: identify the norm group.** Our percentile band must say *percentile among whom* — "among Speedrun users who have completed 50+ items" is a very different claim from "among LSAT test takers," and users will assume the latter unless told. **This is the single most likely way our reporting could mislead in good faith**, and it is fixed by one line of copy. The BPS framing also usefully reframes raw accuracy: our "overall accuracy %" is a **raw score**, and by this guidance should not be the headline number at all, because 68% accuracy is uninterpretable without knowing the difficulty of the items it came from — which is precisely what IRT fixes.
- **Caveats**: UK professional guidance for occupational and clinical testing; not binding on a US consumer education product. Included because it states the norm-group obligation more plainly than the US sources.

---

## 13. Fixed-parameter calibration: how to grow an item pool without re-equating everything

This cluster was pursued late, after §5 established that our real long-run problem is not "equate once" but **"keep adding items to a scale that already exists."** That is a different and much easier problem than equating, and it has a well-developed literature with usable small-sample numbers. **This is arguably the most operationally important section in the document for a team that will be writing new items every week.**

### Guo, Johnson, McCaffrey & Gu (2024) — Practical considerations in item calibration with small samples under multistage test design
- **Citation**: Guo, H., Johnson, M. S., McCaffrey, D. F., & Gu, L. (2024). *ETS Research Report Series*, RR-24-03. doi:10.1002/ets2.12376
- **Link**: https://files.eric.ed.gov/fulltext/EJ1459579.pdf
- **Type**: technical report (ETS), December 2024 — recent and directly on point
- **Key finding**: **[HARD NUMBER]** An operational small-sample MST program. Compared three methods for calibrating **new** items — traditional separate-calibration-with-Stocking-Lord-scaling, a new minimum-discriminant-information-adjustment (MDIA) matching approach, and **fixed item parameter calibration (FIPC)** — at **N = 250, 500, and 1,000**. Results: **FIPC performed consistently best for new items across all sample sizes and all underlying ability distributions** (including skewed ones). The headline efficiency result: **"the performance of FIPC was generally as accurate as that from separate calibrations with a doubled sample size."** Consequently, **"if the program switched to the FIPC method, the sample size requirement (for example, N = 1,000) could be relaxed (say, N > 500)"** with no loss of quality. **Concurrent FIPC pooling data across multiple administrations further improved new-item accuracy.** Practical recommendation: **fix only the routing-block items** — this is stable, satisfies the ≥20% anchor-proportion requirement (Kolen & Brennan), preserves the missing-at-random condition MST calibration needs, and simplifies implementation. They also confirm Kim's (2006) reassuring result that **"unstable parameter estimates of the fixed items due to small-sample sizes may not appear to have much effect on the performance of the FIPC methods in calibrating new items."** Counter-result on model choice: for their program, **switching to 1PL did not help at small N** — 1PL conversion-table error stayed large even as N grew, because their pool had been well calibrated under 2PL with a large field trial.
- **Relevance to this product**: **This is the operating manual for our item pipeline, and it changes the build plan.** (1) **We should never separately calibrate new items and then scale them.** Once we have any calibrated core, every new item gets FIPC'd onto it: fix the core parameters, estimate only the new items. This is one function call — `mirt::fixedCalib()` in R, or a Stan model with the core β's as data rather than parameters. (2) **The "as accurate as double the sample" result is the single best return-on-effort finding in this document**: choosing FIPC over separate-calibration-plus-scaling is worth as much as doubling our user base, and it costs a day of engineering. At our scale that is decisive. (3) **The routing-block recommendation maps exactly onto the "calibration anchor" of ~20-25 items proposed in §5** — that anchor becomes our permanent fixed set, and we should protect it: never retire it, never let it leak, never let LLM-generated variants contaminate it. (4) **Concurrent FIPC across administrations means our historical data keeps working for us**; we pool everything rather than treating each cohort separately. (5) The 1PL counter-result does **not** override the 1PL recommendation in §2 — theirs was a pool already well estimated under 2PL from a large field trial, which is the opposite of our situation. But it is an honest flag that if we ever *do* get large-N calibration, 2PL is where we should end up.
- **Caveats**: A specific operational program with its own pool characteristics; the authors are explicit that Study 3's model-selection result may not generalize. Their "small sample" (250-1,000 per form) may still exceed what we have per item in year one.

### Kim (2006) — A comparative study of IRT fixed parameter calibration methods
- **Citation**: Kim, S. (2006). *Journal of Educational Measurement*, 43(4), 355-381. doi:10.1111/j.1745-3984.2006.00021.x
- **Link**: https://doi.org/10.1111/j.1745-3984.2006.00021.x
- **Type**: peer-reviewed — the primary methodological source for FIPC
- **Key finding**: **[HARD NUMBER]** Describes and evaluates five FIPC variants distinguished by how many times they update the prior ability distribution and how many EM cycles they run: NWU-OEM, NWU-MEM, OWU-OEM, OWU-MEM, and **MWU-MEM (multiple weights updating, multiple EM cycles)**. Simulated with fixed parameters from a reference N(0,1) group and calibration groups drawn from N(0,1), N(0.5, 1.2²), and N(1, 1.4²). **Only MWU-MEM performed properly under all three distributions**; the other four **under-estimated, sometimes severely, whenever the calibration group's ability distribution differed from the reference group's.** Accuracy improved from **N = 300 to N = 3,000**, and improved slightly with **more fixed items (10 → 40)**.
- **Relevance to this product**: **[HARD NUMBER] The specific configuration to use is MWU-MEM, and the reason matters enormously for us.** The other variants fail precisely when the new sample's ability distribution differs from the reference group's — and **our samples will always differ**, because the students answering a brand-new item this week are a self-selected, non-random, drifting subset of our users (newer cohorts, whoever happened to be in the relevant practice mode, whoever the adaptive engine routed there). We are permanently in the N(0.5, 1.2²) / N(1, 1.4²) condition, never the clean N(0,1) one. **Using the default single-update FIPC would systematically bias our new-item difficulties, and the bias would be invisible.** In `mirt`, `fixedCalib()` implements Kim's methods directly, so this is a parameter choice, not an implementation project. The "more fixed items helps" result supports making the anchor 25-40 items rather than the bare minimum of 20.
- **Caveats**: 2006, unidimensional dichotomous models, BILOG/ICL/PARSCALE-era software. The distributional-mismatch finding is the durable part.

### Robitzsch (2024) — Linking error estimation in fixed item parameter calibration
- **Citation**: Robitzsch, A. (2024). *Foundations*, 5(1), 4. doi:10.3390/foundations5010004
- **Link**: https://www.mdpi.com/2673-9321/5/1/4
- **Type**: peer-reviewed
- **Key finding**: Treats the fact that FIPC's fixed item parameters are themselves estimates, and that **item parameters do not transfer perfectly across groups (differential item functioning is the norm, not the exception)**. Derives linking-error estimates for the group mean and SD under FIPC with 2PL models, simulated at **N = 500, 1,000, and 2,000**. The framing: linking error is a distinct, additional source of uncertainty on top of ordinary sampling error, and it must be **added to** the standard error rather than ignored.
- **Relevance to this product**: **Closes the loop on the §5 requirement that any reported score band must propagate linking error.** This gives the actual estimator. Practically, for us it means the honest uncertainty on a student's ability estimate is **√(measurement error² + linking error²)**, and the second term does not shrink as the student answers more items — it is a floor set by the quality of our calibration, not by the student's effort. **This is the mathematical reason our score band can never narrow past a certain width**, and it is the thing to point at if anyone asks why we can't get to ±2 points.
- **Caveats**: Large-scale-assessment context (PISA) with country-level groups; the estimators need adaptation for individual-level reporting. Recent and not yet widely replicated.

### Fixed item parameter calibration in small samples in large-scale assessments
- **Citation**: (2020). *Educational Measurement: Issues and Practice*, 39(4). doi:10.1111/emip.12381
- **Link**: https://doi.org/10.1111/emip.12381
- **Type**: peer-reviewed
- **Key finding**: **[HARD NUMBER]** Using real PISA 2015 Science field-trial data, demonstrates that **FIPC yields stable item parameter estimates for samples as small as n = 250 per country**, versus the n = 1,950 per country PISA normally uses. The estimates of the **trend items — the information introduced into the calibration — are crucial** for recovering the latent trait distributions.
- **Relevance to this product**: **[HARD NUMBER] Independent confirmation of the n ≈ 250 floor, this time on real rather than simulated data, and it names the binding constraint.** It is not the size of the new-item sample that determines whether FIPC works — it is **the quality of the fixed anchor.** For us: **spend our scarce early data disproportionately on nailing down the anchor set.** Show the ~25 anchor items to everyone, early, in the diagnostic, until each has 400+ responses; after that, new items need only ~250 responses each to join the scale cleanly. That is a concrete, schedulable data-collection plan, and it is very achievable — 250 responses per item at a few hundred active users is weeks, not years.
- **Caveats**: PISA's field-trial structure and its very large trend-item base; our anchor will be far weaker than PISA's trend items for a long time.

### LSAT PrepTest score accuracy (commercial claim, logged for Q7 completeness)
- **Citation**: lsatscorecalculator.com, "LSAT PrepTest Scores: How Accurate Are They? (Real Data)"
- **Link**: https://lsatscorecalculator.com/lsat-preptest-scores/
- **Type**: documentation (commercial content marketing) — **[LOW VALUE, no underlying data published]**
- **Key finding**: Claims **"most test-takers score within 2-4 points of their consistent PrepTest average"** under strict timed conditions, and that reliability is highest when averaging **5-8 recent official PrepTests** rather than any single administration. Notes that only **PrepTests 101+** reflect the current three-section, no-Logic-Games format. No data, sample, or methodology is provided despite the "(Real Data)" headline.
- **Relevance to this product**: Logged because the practice-to-official gap is one of the ten research questions and **this is representative of the entire publicly available evidence base on it: confident point claims with no data behind them.** The searches in §7 and here did not surface a single peer-reviewed or testing-organization study quantifying the practice-test-to-official-score relationship. Two things are still worth taking from it. (1) **The "average your last 5-8" advice is directionally correct and is just the reliability-through-aggregation principle restated** — averaging k tests each with SEM ≈ 3 gives SEM ≈ 3/√k, so 6 tests gets to ≈ 1.2 points, which is how you'd get a ±2-4 band. **The advice is right; the stated precision is a coincidence, not a finding.** (2) The claim is about **official** LawHub PrepTests, which are equated, real forms. It says nothing about third-party items — which is exactly our situation and exactly the gap this document exists to fill. **The absence of any credible published practice-to-official study is itself the finding, and it is an opportunity: if we collect verified official scores from consenting users, we would hold data nobody else has published.**
- **Caveats**: Uncited commercial claims; treat every number as marketing. Included as evidence about the state of the evidence, not as evidence.

---

## 14. Sources consulted that did not pay off (logged to prevent re-crawling)
- **LSAC Research Library / Interpretive Guide for LSAT Score Users** — **[DEAD END, but actionable]** The *Interpretive Guide*, which contains the actual per-form reliability coefficients and SEM values, is **not freely downloadable**. LSAC states all reports are "available upon request." No public URL found. **Action: email LSAC research and request it.**
- **Magoosh "How to Predict Your LSAT Score"** (https://magoosh.com/lsat/predict-lsat-score/) — **[DEAD END]** Content marketing; the operative advice is "take your practice average and add/subtract three points," with no supporting data. Author anecdote reports a practice average of 159 with official scores of 150 and 164 — which is actually a nice illustration of the ±9-point MDC from §6, but it is n = 1.
- **Test-Ninjas / Leland / CollegeSimplified LSAT format pages** (https://test-ninjas.com/lsat-new-format-2026-changes, https://www.joinleland.com/library/a/lsat-format, https://www.collegesimplified.in/post/lsat-exam-pattern-2026-complete-guide-2026-...) — **[LOW VALUE]** Consulted only to triangulate the current test structure, which was then confirmed against LSAC primary sources. One useful uncorroborated claim from Test-Ninjas: LSAC's analysis of "over 200,000 test sessions" found substituting a second LR section for Logic Games had virtually no impact on scoring, and that the current test has **75–78 scored questions** (down from ~100–101 pre-2024). The 75–78 figure is consistent with the arithmetic in §2 and with LSAC's structural description, but I could not verify it in an LSAC primary document.
- **LSAC TR 24-01** (https://www.lsac.org/sites/default/files/research/TR-24-01.pdf) — superseded by TR 26-01; consulted and set aside.
- **Duolingo "Validity, Reliability and Concordance" (Ye, 2014)** (http://duolingo-papers.s3.amazonaws.com/other/ye.testcenter14.pdf) — **[SUPERSEDED]** Early independent study, n = 107 repeat testers, alternate-form test-retest reliability **0.79**, average test ~16 minutes. Historical interest only; the 2025 technical manual supersedes it. Worth one note: their 0.79 with a ~16-minute test versus 0.95 with the current ~1-hour, 200-measurement test is a clean demonstration of the reliability-through-volume principle this whole document rests on.
- **LSAT Score Calculator / ScoreGap** — logged in §7 as evidence about commercial claims, not as evidence about reality.
- **`rgt47/nof1power`** (https://github.com/rgt47/nof1power) — an R package for N-of-1 power analysis, created May 2026, zero stars, no releases. Noted as potentially useful tooling, not as a source.

---

# A concrete, implementable measurement design for this product

Buildable by one team in roughly 1.5 weeks for the core, with clearly marked later phases. Every number below traces to a source above.

## The core model

**One hierarchical Bayesian Rasch model with fixed guessing, fit nightly in batch.**

```
P(correct_ij = 1) = c + (1 − c) · logistic(θ_j − b_i)

c      = 0.20                          # fixed, NOT estimated (5-option MC; §2, Schroeders & Gnambs)
b_i    ~ Normal(μ_type(i), σ²_type)    # item difficulty, nested in question type (§3, Wilson et al. HIRT)
μ_type ~ Normal(0, τ²)                 # question-type mean difficulty — solves item cold-start
θ_j    ~ Normal(0, 1)                  # student ability, shrunk to population prior
```

Why each piece:
- **Fixed c = 0.20** rather than estimated: 3PL guessing parameters need 1,000–3,000+ responses per item and can fail even at N = 2,000 (§2). Fixing it gets the important behavior at 1PL data cost.
- **Hierarchical b_i nested in question type**: a brand-new item inherits its type's mean difficulty as a prior and shrinks toward its own data as responses arrive. This was the best-performing model in Wilson et al. (§3) and it eliminates the cold-start problem for free.
- **Nightly batch, not online**: at a few thousand users we are nowhere near the scale where likelihood-based inference is hard (§4, Duolingo DRR-20-02). Elo exists to solve a scaling problem we don't have. Use Stan/PyMC/`brms`; the fit will take minutes.
- **Serve-time θ** can be a cheap Elo/Glicko update between nightly refits if we want live adaptivity, reconciled to the batch fit each night.

**Treat each RC passage as one polytomous testlet item** (score = number correct out of the passage's items), not as k independent items. Non-negotiable: modeling RC items as independent inflates apparent precision (§1, LSAC testlet study; §4, NCME MST module).

**Exclude from ability estimation:** any `spaced_review` response on a previously-seen item (§6, Hausknecht form-equivalence moderator), and any response below a rapid-guessing time threshold. Use the existing `evidence_class` tags as the inclusion filter — this machinery already exists and just needs to be wired to the estimator.

**The rapid-guessing rule, concretely** (§12, Wise & Kong; normative-threshold method): set `threshold_i = 0.10 × mean_response_time_i` per item, drop the 10-second cap used in K-12 work since LSAT items are far longer, and **validate the threshold by checking that sub-threshold responses are correct at ≈20%** — chance for five options. If they come back at 45%, the threshold is too aggressive and is discarding real work. Compute **Response Time Effort** per session (the proportion of items showing solution behavior) and treat **RTE < 0.90 as a disengaged session**: exclude it from estimation and tell the user it wasn't counted. Run the 10%/20%/30% variants once as a sensitivity check to confirm conclusions aren't threshold artifacts.

**Growing the item pool: use fixed item parameter calibration, not separate calibration plus scaling** (§13). Once a calibrated core exists, every new item is added by fixing the core's parameters and estimating only the new items — `mirt::fixedCalib()`, or a Stan model with the anchor β's passed as data. Use the **MWU-MEM variant specifically**: the single-update variants bias estimates whenever the calibration sample's ability distribution differs from the reference group's, and ours always will, because whoever answers a new item this week is a self-selected, drifting subset. This choice is worth as much as **doubling our user base** (Guo et al. 2024) and costs about a day. New items then need roughly **250 responses each** to join the scale cleanly, provided the anchor itself is solid.

**Run a parameter-recovery check before trusting any fitted model** (§12, Beck & Chang): simulate data from known parameters, refit, confirm the parameters come back. Unidentified models still return plausible-looking numbers, and those numbers still get shown to users. Half a day; prevents shipping a confidently wrong estimate.

## Item counts required for each claim

Computed from `SE(θ) = 1/√(n·I)` with I = 0.170, the maximum information per item under a 1PL with c = 0.20 (numerically derived; guessing costs a **1.47× item-count inflation** versus pure Rasch). Assumes well-targeted items; poorly targeted items need ~2.2× more. 1 logit ≈ 11 LSAT points.

| Claim the product wants to make | Required SE(θ) | ≈ 1 SEM in LSAT pts | **Clean items needed** | 95% band |
|---|---|---|---|---|
| "Roughly where you stand" (a 20-point range) | 0.50 | 5.5 | **23** | ±11 |
| "Your working estimate" (a 14-point range) | 0.33 | 3.6 | **54** | ±7 |
| "A solid estimate" (a 13-point range) | 0.30 | 3.3 | **65** | ±6.5 |
| **Precision equal to the official LSAT's own SEM** | 0.236 | 2.6 | **105** | ±5 |
| "A tight estimate" | 0.20 | 2.2 | **147** | ±4 |
| "Very tight" | 0.15 | 1.6 | **261** | ±3 |
| Genuinely better than one official sitting | 0.10 | 1.1 | **587** | ±2 |

**Read this table as the product roadmap.** The interesting fact is that **105 clean items buys precision equal to the real LSAT's**, and **~260 items beats it.** A committed user generates that in weeks. **This is the product's genuine, defensible edge: not scale fidelity, but precision through volume.**

**Verdict on the current readiness gate (40 LR + 20 RC + 1 diagnostic):** applying a testlet design effect of ~2.5 to the RC items gives ~48 effective independent items ⟹ **SE ≈ 0.35 logits ≈ 3.8 LSAT points, a 95% band of ±7.5 points** (well-targeted) or **±11 points** (poorly targeted). So the gate is roughly the "solid estimate" tier — **defensible as a threshold for showing a *range*, and nowhere near enough to show a point score.** The current hardcoded maturity labels (`baseline`<10, `emerging`<30, `directional`<80, `stable`≥80) are in the right ballpark by luck; replace them with **the actual computed SE(θ)**, which is the quantity they are approximating, and which the model gives us for free.

## What to compute and show

**1. Ability estimate (θ) with a credible interval — the primary number.**
Report as a **percentile band against our own user population** plus a **descriptive range**, not a scaled score. Example: *"Your current estimate places you around the 62nd percentile of Speedrun users, in a range of roughly the 52nd–72nd. Based on 118 clean items over the last 4 weeks."*

**Name the norm group explicitly, every time.** "62nd percentile of Speedrun users who have completed 50+ items" is a completely different claim from "62nd percentile of LSAT test takers," and users will assume the second unless told otherwise. This is the single most likely way our reporting misleads in good faith, and it is fixed by one line of copy (§12, BPS guidance). The same source is the reason **raw accuracy should not be the headline number**: "68% correct" is uninterpretable without knowing the difficulty of the items it came from, which is precisely what θ fixes.

Show the band narrowing as evidence accumulates — this is both honest and the best engagement mechanic available (§10). Two supporting findings on how to render it: comprehension **did not differ significantly across four different graphical and verbal representations of measurement error** (§12, Zwick et al.), so **do not over-invest in chart design — invest in the words next to it**. But statistically comfortable readers both understood more and *preferred* more informative displays with variable-width bands, and LSAT candidates are a quantitatively self-selected population, so the rigorous option is probably also the one our users want. Finally, **test the score display the way we'd test any UI**: five think-alouds asking users to say what the band means (§12, Zenisky & Hambleton). That is a normal week of product research and it is simultaneously the professional standard for score-report validation.

**2. Separate LR and RC estimates, weighted 2:1 for the composite**, mirroring the operational form's two LR sections to one RC section (§1).

**3. A speed parameter (τ), reported separately from ability.** Not folded into an ability composite. Model `log(t_ij) ~ Normal(β_i − τ_j, σ²)`; estimate per-item time intensity β_i from data instead of using the hardcoded 150s/330s/135s constants (§8). Report pace as a percentile against other students **on the same items**. Add one genuinely actionable derived claim: *"At your current pace you would complete 22 of 25 items in a 35-minute section."*

**4. Change, gated by the Minimal Detectable Change.** Never show "you improved" unless the change clears MDC. `MDC = z × √2 × SEM`:

| Current SEM (pts) | MDC₉₅ | MDC₈₀ |
|---|---|---|
| 3.11 (two official-length tests, r = .92) | **8.6** | 5.6 |
| 2.6 | 7.2 | 4.7 |
| 2.0 | 5.5 | 3.6 |
| 1.5 | 4.2 | 2.7 |
| 1.0 | 2.8 | 1.8 |

Use **MDC₈₀ for formative in-app feedback** (labeled as such) and MDC₉₅ for anything decision-grade. **Subtract a practice-effect prior before declaring improvement across repeated diagnostics**: approximately [0, +3.6, +5.5, +5.7, +5.7…] points for diagnostics 1, 2, 3, 4, 5+ (from Scharfen et al.'s SMCR of 0.33/0.50/0.52 × SD 11, plateauing after the third; §6). **No competitor does this, and it is the difference between honest progress reporting and flattery.**

**5. Growth, only when earned.** Fit a hierarchical growth model with student random intercepts and slopes. Require **≥4 measurement occasions spread over ≥4 weeks** before showing a trajectory, and ≥4 occasions before fitting any curvature (§6, Brandmaier et al. 2024). Spread occasions deliberately to maximize SST — spacing buys more slope precision than frequency does (Willett).

**6. Strategy effects from a pooled hierarchical model**, not per-student thresholds. `correct ~ strategy + (1|student) + (1|item) + (strategy|student)` with IPW using logged assignment propensities. Report the population effect once it clears the N in §9; report the personal effect as a shrunken random slope that will honestly sit near the population mean for almost everyone.

## Build order

**Week 1** — (a) Wire `evidence_class` to an inclusion filter for ability estimation; exclude repeated-item review responses. (b) Add rapid-guessing detection and exclusion using the 10%-of-mean-time rule, validated against the 20% chance-rate check; compute per-session RTE. (c) Implement the hierarchical Rasch-with-fixed-guessing model as a nightly batch job; output θ and SE(θ) per student, b_i per item. (d) Run the parameter-recovery check on simulated data before wiring any output to the UI. (e) Replace the hardcoded maturity labels with computed SE(θ) thresholds. (f) Score RC passages as testlets.

**Week 2** — (g) Replace the readiness gate with an SE-based rule. (h) Ship the percentile band UI with a visible narrowing mechanic and an explicit norm-group label. (i) Implement MDC-gated change reporting with the practice-effect prior. (j) Add per-item time intensity estimation; move pace reporting onto it; remove pace from the composite index. (k) Add randomesque (top-k) item selection to preserve exposure randomness for unbiased calibration. (l) Stand up the FIPC path so new items can be added to the scale without a re-fit of everything.

**Later** — MST (a 1-2-2 panel with true-score routing is a few hundred lines and cuts the diagnostic from 75 to ~30 items at equal precision; §4). Joint response-time/accuracy modeling. Think-aloud validation of the score display. The linking study, if and when the paired-score data exists.

---

# What we can and cannot legitimately claim

**We CAN claim, today, with the design above:**
- A student's **relative standing** within our user population, as a percentile band. *(Requires: internal scale + ~50+ clean items.)*
- A student's **ability estimate in logits with a credible interval**, and how that interval narrows with practice.
- **Separate LR and RC estimates**, and separate **speed** and **accuracy** parameters.
- A **speededness diagnostic**: whether their current pace completes a 35-minute section. This is a real, verifiable, useful claim.
- **Change that exceeds the MDC**, after subtracting the practice-effect prior, framed with its confidence level.
- **Rank-ordered weaknesses** by question type, as coaching guidance — *provided* we do not attach precision claims to them. Note the Gong et al. finding (§3) that a model ignoring the skill taxonomy predicted as well as one using it: our type breakdown is **coaching narrative, not measurement**, and we should be internally clear about that.
- **Our own reliability and SEM, published.** No LSAT competitor does this. Note that this is not optional generosity: **Standard 6.10 of the 2014 *Standards for Educational and Psychological Testing* expects score reports to include explicit information about the measurement error associated with reported scores** (§11, §12). That is the citation to point at whenever someone argues that bands are too discouraging to show.

**We CANNOT legitimately claim, and should not attempt:**
- **A 120–180 scaled score. Not now, and not with any statistical trick.** This is the blunt answer to the central question. It requires all four of: (1) a common internal scale via an anchor or concurrent calibration; (2) **~400+ users with both an internal θ and a *verified* official LSAT score**, since below ~100 pairs the literature shows the identity function beats equating — i.e., converting would *add* error (§5); (3) verified rather than self-reported official scores (Duolingo needed an explicit bias correction for self-report); (4) linking error propagated into the reported band via `SE_total = √(SE_measurement² + SE_linking²)`. **Until all four hold, the app's current refusal is not excessive caution — it is the technically correct position, and the existing note should be strengthened to say why.**
- **"You will score X on the LSAT."** Even a perfectly linked score is a statement about *current* ability, not about a future administration, which adds test-day state variance and the practice-to-official gap (which, note, **has never been rigorously quantified in any published source** — §7).
- **A precision tighter than ±2.6 points** from any single sitting. That is the official test's own SEM (§1); we cannot beat it on a comparable number of items, only by aggregating many more.
- **A band that keeps narrowing indefinitely with practice.** Even in the best case where linking becomes possible, the honest uncertainty is `√(measurement error² + linking error²)`, and **the linking term does not shrink as a student answers more items** — it is a floor set by the quality of our calibration, not by the student's effort (§13, Robitzsch). This is the mathematical reason a band can never reach ±2 points, and it is worth stating internally before someone promises it.
- **Attributing a ~2–3 point improvement to our product.** That is the null: LSAC's observed mean retake gain (2.39 points) is statistically indistinguishable from the generic cognitive-test practice effect of d ≈ 0.26 (≈2.9 points) found across 134,436 participants (§6). A product effect must be demonstrated *above* that baseline.
- **Marketing a score gain above ~5 points from practice volume.** LSAC's own study of Khan Academy found the 90th percentile of engagement — **47 hours** — associated with **+4.3 points** (§7). Claims beyond that exceed what the sponsor's own data supports.
- **"Supported" strategy effects at the current thresholds.** See below.
- **A stable personal calibration trait** at realistic item counts. Test-retest reliability of metacognitive measures is ~0.2 at 250 trials (§11).
- **Any composite "speedrun index" presented as a score.** It mixes an ability estimate, a speed estimate, and an unvalidated LLM judgment under arbitrary weights, and has no standard error. Keep it if it's a useful product metric — but label it a product metric, not a measurement.

---

# The power analysis verdict on the current A/B thresholds

**The current thresholds (≥8 prompted + ≥4 control for "supported") are not merely too small — they make an inference that is arithmetically impossible.**

1. **Power at the current thresholds, α = .05 two-sided, from a 60% baseline:** +5 point true effect → **5.3% power**. +10 points → **6.3%**. +20 points → **10.9%**. At a plausible effect size, **the detection rate is indistinguishable from the false-positive rate.**
2. **Minimum detectable effect at 80% power with 8 vs. 4: 84 percentage points.** At 50% power: **59 points.** From a 60% baseline these are outside the range of possible values.
3. **Granularity:** 8 prompted observations can only produce 9 distinct accuracy values (steps of 12.5 points); 4 control observations only 5 (steps of 25 points). **The reported "lift" is quantized in 25-point jumps.** Any decimal place shown is fiction.
4. **Multiple comparisons:** with no correction, the chance of at least one spurious "supported" label is 14.3% with 3 strategies, 33.7% with 8, and **46.0% with 12** — before the bandit's winner's-curse amplification.
5. **Required totals** (80% power, α = .05, 60% baseline, accounting for the 1.33× penalty of the 75/25 allocation): **+20 points → 217 observations. +10 → 949. +5 → 3,921. +3 → 11,010. +2 → 24,894.** A realistic effect for a UI prompt is ~3 points, so the honest requirement is **on the order of 11,000 observations.** **The current thresholds are off by roughly 20× to 900×.**
6. **The inference is also invalidated in kind, not just in degree.** Bandit-adaptive allocation biases arm means in either direction and breaks the asymptotic normality that standard intervals assume; the continuously-updating maturity label is textbook peeking, which inflates Type I error without bound (§9).

**Recommended fix — change the estimand, not the threshold:**
- Move to a **pooled hierarchical logistic model** with student and item random effects and a random slope per student. The population effect is estimable at the N above (3,900 observations ≈ 130 users × 30 items — very reachable). The personal effect becomes a shrunken random slope that will correctly sit near the population mean for nearly everyone.
- **Log assignment propensity on every observation** and use IPW. This is not reconstructible after the fact.
- **Use an always-valid confidence sequence (mSPRT) or a Mixture Adaptive Design** if the label must update live.
- **Reduce outcome variance**: use a 10-item block accuracy, or an IRT residual (observed minus model-predicted probability), or response time as a co-primary. A single binary item carries at most one bit; that is the root cause.
- **Retire the word "supported"** until the pooled model clears a pre-registered threshold. In the meantime `forming` / `directional` are fine, and a fourth honest state — *"we will probably never be able to tell for you individually, but here's what it does on average"* — is more useful than a false verdict.

---

# Instrumentation gaps: what to start logging now

Ordered by *cost of not having it later*. Items 1–4 are unrecoverable retroactively.

1. **Official LSAT scores, verified where possible, with the administration date.** This is the single highest-value data asset the product can accumulate and the *only* path to a defensible scaled score (§5 requires ~400+ pairs). Offer a real incentive for uploading a score report, exactly as Duolingo did for their concordance study. Store: score, date, attempt number, and whether verified vs. self-reported — **never mix them.** Also capture **target score** and **planned test date**, which are needed for any readiness claim. **There is currently no public, rigorous quantification of the practice-to-official relationship (§7); collecting this would give us data nobody else has.**
2. **Assignment propensity for every bandit/experiment observation** (§9). Without the stored propensity, adaptive-allocation bias is not correctable afterwards. Log the arm, the propensity, the randomization seed, and the experiment version.
3. **A designated calibration anchor set.** ~25–40 items (≈2:1 LR:RC, matching the operational ratio; Angoff's 20-item/20% rule is the floor, and Kim (2006) found accuracy improves as the fixed set grows from 10 to 40) that **every user sees**, embedded invisibly in normal practice. Without a common anchor, users who practiced different item mixes are not on a common scale and are **not comparable to each other at all** — a defect the current accuracy-over-whatever-you-saw metric has right now. **Spend early data disproportionately here: the binding constraint on the whole calibration pipeline is anchor quality, not new-item sample size** (§13). Target 400+ responses per anchor item before relying on it; after that, new items join the scale at ~250 responses each. Protect the anchor — never retire it, never let it leak, never let generated variants contaminate it — and plan refresh with overlap so the chain isn't broken.
4. **A randomized exposure slice.** Reserve ~10–15% of item serving to be genuinely random. This is what keeps item-difficulty estimation unbiased: Pelánek's finding (§3) is that under adaptive selection, naive difficulty estimates are **structurally biased and do not improve with more data.** Randomesque (top-k) selection partially achieves this; an explicit random slice guarantees it.
5. **Per-item response time with a start/stop event model**, not just total elapsed. Needed: time to first interaction, time to first answer selection, number of answer changes, and idle/blur detection. Without idle detection, a user who walks away mid-item poisons the time data. Log in milliseconds; **analyze on the log scale** (§8).
6. **Item exposure counts and per-item response history**, so we know each item's calibration maturity and can report which claims it can support (Linacre's table: 50 responses → ±1 logit; **150–250 → ±½ logit**; §2).
7. **Item content features for cold-start difficulty prediction** (§4, AutoIRT): question type, stimulus word count, answer-choice lengths, negation/quantifier presence, readability, passage subject and length, and an LLM-estimated difficulty. Cheap to compute once, enables seeding priors for new items.
8. **Confidence ratings on a consistent scale, with the item, every time** — and enough of them. Calibration needs several hundred rated items before it is stable (§11). Log the raw rating, not a derived bucket.
9. **Session context**: mode, device, time of day, session position (item 1 vs. item 40 — fatigue), whether coaching/explanations were shown before the response, and whether the item had been seen before. These are the "unmodeled measurement disturbances" that Linacre warns inflate required sample sizes by 10–40% (§2), and they are only correctable if logged.
10. **Model version and parameter snapshots for every displayed estimate.** When we change the model, we need to be able to explain why a user's number moved. Store the θ, SE, model version, and the item set it was computed from, at display time.
11. **A frozen holdout of responses** never used in item calibration, for honest out-of-sample evaluation. Report AUC both pooled and averaged by question type — the two can differ dramatically and only reporting the first hides failures on rare types (§3, EDM 2017).
