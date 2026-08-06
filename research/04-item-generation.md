# Building an Original LSAT Item-Generation Pipeline

**Compiled:** Sunday, August 2, 2026
**Purpose:** Answer the question *"can LSAT Speedrun generate its own LSAT-quality items instead of relying on a question bank derived from copyrighted LSAC material, and what would that pipeline actually look like?"*
**Scope:** Automatic Item Generation (AIG) as a psychometric discipline; LLM-based item generation 2024–2026; distractor generation; validation/QC pipelines; frontier-model LSAT benchmarks; Reading Comprehension passage sourcing; difficulty prediction; cost/throughput; competitor practice.
**Method note:** Every source consulted is logged, including dead ends. Prioritised 2026/2025/2024 work, working backwards. Includes an **original empirical experiment** (Section E) run against frontier models on August 2, 2026.

---

## Bottom line up front

1. **I ran the experiment rather than only reading about it.** Three frontier models wrote 24 LSAT LR items against a demanding spec that explicitly forbade every failure mode I then tested for, benchmarked against 12 real LSAT items through an identical battery. **Nineteen of the 24 generated items were solved correctly by all four independent frontier solver models with the stimulus entirely removed** — the items announce their answers. Real items: half that rate, and that figure is inflated by contamination.
2. **Repairing that defect creates a worse one.** Targeted anti-cue rewriting cut blind-solve rates from 0.90 to 0.68 but drove critic-flagged "multiple defensible answers" from 8% to **63%**. Making distractors competitive enough to stop being giveaways makes them genuinely defensible. That trade *is* the difficulty of LSAT item writing.
3. **Compute is free; judgement is not.** The full generate → validate → repair → re-validate loop cost **$0.21 per candidate item** and ran 24 items in under 10 minutes. Human review is **75–80% of total cost** at every pool size.
4. **Reading Comprehension is a different and much better story.** LSAC's own disclosure booklets state that RC passages are *adapted from published third-party sources*, which they name. Substituting license-clean corpora (PMC `oa_comm`, U.S. government works, DOAJ CC-BY) for *Scientific American* reproduces LSAC's own method with a cleaner input. This removes the invention step that broke every LR item and amortises across 5–8 questions per passage.
5. **The comparison that matters: LSAC publicly lists official content licensing at $38/student.** At current scale, licensing is cheaper than generating and gives students content they already trust. Generation's real value is unlimited targeted drilling, supplier independence, and pre-annotated trap explanations — not replacement.
6. **Nothing here ships a replacement bank in 1.5 weeks.** A week of work produces measurement infrastructure, ~60–100 RC items, and a defensible answer to "can we do this."

---

## 0. Ground truth on the test we are generating for

Before anything else, the target had to be verified, because generating for the wrong test specification wastes the entire effort.

**Verified:** The Analytical Reasoning ("Logic Games") section was **permanently removed** from the LSAT effective with the **August 2024** administration. The current multiple-choice test is:

| Section | Time | Items |
|---|---|---|
| Logical Reasoning (scored) | 35 min | 24–26 |
| Logical Reasoning (scored) | 35 min | 24–26 |
| Reading Comprehension (scored) | 35 min | 26–28 |
| Unscored variable section (LR **or** RC only) | 35 min | 24–28 |
| Argumentative Writing (unscored, separate) | 50 min | essay |

~75–78 scored items; 120–180 scale unchanged. The change followed the 2019 *Binno/Taylor* ADA settlement.

**Two consequences that shape this entire document:**

1. **Item generation effort should be ~100% Logical Reasoning and Reading Comprehension.** Logic games are dead weight. This is *good news* for a generation pipeline: AR was by far the most structurally constrained section and, paradoxically, the easiest to generate algorithmically (constraint-satisfaction puzzles are the classic AIG use case) — but it no longer counts. What remains is the *hard* stuff: natural-language argumentation.
2. **LSAC itself runs the variable section as a field-test bed.** That is a direct, official precedent for the field-testing stage this document recommends: LSAC does not let an item count toward a score until it has been seeded unscored among real items and its statistics computed. Any credible pipeline we build must imitate this.

### Sources for Section 0

### LSAC — What to Expect Starting With the August 2024 LSAT
- **Citation**: Law School Admission Council, 2023/2024 (official blog post)
- **Link**: https://www.lsac.org/blog/what-to-expect-starting-with-august-2024-lsat
- **Type**: documentation (primary, test sponsor)
- **Key finding**: "Starting with the August 2024 test, the LSAT will consist of two scored Logical Reasoning (LR) sections, one scored Reading Comprehension (RC) section, plus one unscored section of either LR or RC that **enables us to pilot items for future tests**." AR removed after June 2024.
- **Relevance to this pipeline**: Confirms the generation target (LR + RC only) and confirms that the test sponsor's own item-validation model is seed-and-field-test.
- **Caveats**: Primary source, so no independent verification of the operational details; describes intent as of announcement.

### LSAC — Changes are coming to the LSAT in August 2024
- **Citation**: Law School Admission Council, 2023
- **Link**: https://www.lsac.org/lsat/lsat-changes-coming-august-2024
- **Type**: documentation (primary)
- **Key finding**: Same structural change, stated as the operative format definition.
- **Relevance to this pipeline**: Canonical citation for the test blueprint a generated pool must match.
- **Caveats**: None material.

### Reuters — LSAT to drop 'logic games' questions from exam
- **Citation**: Reuters Legal, 18 October 2023
- **Link**: https://www.reuters.com/legal/legalindustry/law-school-admission-test-drop-logic-games-questions-exam-2023-10-18/
- **Type**: industry / journalism
- **Key finding**: Independent confirmation of the AR removal and its origin in the 2019 ADA settlement with two blind test-takers.
- **Relevance to this pipeline**: Third-party corroboration of the format change.
- **Caveats**: Reports the announcement, not the implementation.

### Kaplan — LSAT Logic Games Changes and Updates
- **Citation**: Kaplan Test Prep, updated 2025/2026
- **Link**: https://www.kaptest.com/study/lsat/lsat-logic-games-changes-and-updates/
- **Type**: industry
- **Key finding**: Gives current per-section item counts (LR 24–26 each, RC 26–28, experimental 24–28) and confirms 50-minute Argumentative Writing.
- **Relevance to this pipeline**: Provides the per-section item counts a generated pool must be able to fill (a full practice test needs ~75 scored items).
- **Caveats**: Commercial prep vendor; item counts are approximate ranges.

---

## 1. AIG as an established psychometric discipline (the pre-LLM tradition)

This section matters for **credibility**, not for technique. The techniques below are mostly not the right technique for LSAT LR. But the *governance model* they established — what a testing organisation must do before a machine-made item is allowed to count — is exactly the model we should copy and be able to point to.

### 1.1 The canonical three-stage method (Gierl & Lai)

The dominant pre-LLM AIG paradigm, developed principally by Mark Gierl and Hollis Lai at the University of Alberta, is a **template-based** method with three stages:

1. **Cognitive model.** Content specialists write down, explicitly, the knowledge and reasoning a candidate must deploy to answer an item — the problem, the scenarios in which it arises, the *sources of information* (features), the *elements* (variables that can vary), and *constraints* (rules about which combinations are legal).
2. **Item model.** The cognitive model is cast into a template: a stem with slots, a correct-option rule, and distractor rules.
3. **Generation.** Software (Gierl's IGOR) enumerates legal combinations.

The yield is enormous — 1,248 items from a *single* item model in the surgery example; 16,384 from one n-layer model in a later study; 720 simultaneously in English and French in the multilingual paper.

**Why this does not straightforwardly work for LSAT Logical Reasoning.** Template AIG works when the construct is *decomposable into slot-fillers*: a clinical vignette where age, sex, presenting symptom, lab value, and correct diagnosis co-vary under medical constraints. LSAT LR items are not like that. The item's difficulty lives in the *rhetorical texture* of a novel argument and in distractors that are wrong for subtly different reasons. Slot-filling an LR template ("Some [X] are [Y]; all [Y] are [Z]…") produces items that are (a) immediately recognisable as formulaic, (b) trivially easy once a student sees the second one from the same model, and (c) exposed to the classic AIG problem of **item-model dependence**: items from the same model are statistically near-clones (an "enemy" set), so a bank of 5,000 items from 40 models has an effective size closer to 40.

**Where template AIG *is* useful for us:** it is the right technique for the *scaffolding* around an item — question stems (there are ~15 canonical LR stem phrasings), the trap taxonomy for distractors, and the domain/structure sampling grid. In the pipeline in Section F, the item model becomes a *structured generation spec* handed to an LLM rather than to a combinatorial enumerator. That is the hybrid that current practice has converged on.

### 1.2 What testing organisations require before a generated item can count

This is the part worth copying wholesale.

- **NBME** ran an AIG proof-of-concept in early 2020, then trained **38 subject-matter experts** from its test-development committees to build AIG models. Generated questions were **pretested** on four NBME Clinical Science Subject Exams and the Health & Wellness Coach Certifying Exam before counting. Item analyses showed AIG questions performing "at least as well as traditionally written items." NBME then built a bespoke tool, **IMAGE** (Item Modeling and Automated Generation Engine).
- **The validation-evidence framework** (Gierl, Lai, Pugh, et al., *Teaching and Learning in Medicine*, 2022) specifies **three required sources of evidence**: (i) the **item definition** — the explicit parameters, constraints and instructions, so the *input* can be critiqued; (ii) the **item development process** — a "validation table" summarising the content and constraints used, so an auditor can verify the SME's model assumptions; (iii) the **item quality review** — the *statistical* quality of generated items, i.e. difficulty and discrimination for the key and for each distractor.
- **LSAC's own process**, described by a former LSAT item writer: freelance writer → editorial selection and revision at the test contractor → second review at LSAC → placement in an **experimental (unscored) section** → live administration → item statistics computed → only then does an item enter the scored pool, and many are discarded at that gate.

The through-line: **nobody credible ships an item on the strength of the author's confidence.** The item is (a) produced against a written spec, (b) reviewed by someone other than its author, and (c) validated against real response data before it counts. A generation pipeline that skips (c) is not doing what the industry does — but note that for a *prep product* the stakes are lower than for licensure, and (c) can be done continuously and cheaply because our users generate response data constantly. That is a genuine structural advantage and Section H exploits it.

### Sources for Section 1

### Using automatic item generation to create multiple-choice test items
- **Citation**: Gierl, M. J.; Lai, H.; Turner, S. R. *Medical Education*, 46(8): 757–765, 2012
- **Link**: https://doi.org/10.1111/j.1365-2923.2012.04289.x (PubMed: https://pubmed.ncbi.nlm.nih.gov/22803753/)
- **Type**: peer-reviewed
- **Key finding**: Defines the canonical three-stage AIG method (cognitive model → item model → algorithmic generation). Demonstrated by generating **1,248 multiple-choice items from one item model** in surgery for a medical licensure test.
- **Relevance to this pipeline**: The reference definition of AIG. Establishes that the expensive, expert-intensive step is writing the *model*, not the items — which is the cost structure we want to reproduce with LLM prompts as the "model."
- **Caveats**: Content domain (medicine) is far more decomposable than LSAT argumentation. The 1,248-item yield is misleading for our purposes: those items are near-clones of each other and would function as enemies on a real test.

### Feasibility assurance: a review of automatic item generation in medical assessment
- **Citation**: Falcão, F., et al. *Advances in Health Sciences Education*, 2022
- **Link**: https://doi.org/10.1007/s10459-022-10092-z
- **Type**: peer-reviewed (review)
- **Key finding**: Reviews AIG feasibility across medical assessment. Documents the elements/constraints formalism and reports yields (256 items from a 1-layer item model; 16,384 from an n-layer model).
- **Relevance to this pipeline**: Best single summary of the pre-LLM state of the art and of how "layers" in an item model trade off volume against item independence.
- **Caveats**: Review of a medical-assessment literature; feasibility claims are about production volume, not about item independence or about non-decomposable constructs.

### Three Sources of Validation Evidence Needed to Evaluate the Quality of Generated Test Items for Medical Licensure
- **Citation**: Gierl, M. J., Lai, H., et al. *Teaching and Learning in Medicine*, 2022
- **Link**: https://doi.org/10.1080/10401334.2022.2119569
- **Type**: peer-reviewed
- **Key finding**: Specifies the three required evidence sources for generated items: **item definition** (parameters/constraints/instructions), **item development process** (a validation table verifying SME model assumptions), and **item quality review** (statistical difficulty and discrimination of key *and each distractor*).
- **Relevance to this pipeline**: This is the audit structure to adopt verbatim. If LSAT Speedrun is ever challenged on "are your questions any good," this is the framework that makes the answer defensible rather than rhetorical.
- **Caveats**: Written for licensure-grade stakes; a prep product does not need this level of rigour, but borrowing the vocabulary costs nothing and buys a lot of credibility.

### NBME — Leveraging technology to keep assessments up-to-date, relevant and flexible without sacrificing quality
- **Citation**: NBME Innovation Hub (industry publication), 2023/2024
- **Link**: https://www.innovationsinassessment.org/leveraging-technology-within-assessment/
- **Type**: industry (primary, from the testing organisation)
- **Key finding**: NBME piloted AIG in early 2020, trained **38 SMEs** to build AIG models, **pretested** the generated items on four Clinical Science Subject Exams plus a certifying exam, and found item analyses showed AIG items "performing at least as well as traditionally written items." Built the **IMAGE** engine off the back of it.
- **Relevance to this pipeline**: The single best "a serious testing organisation does this in production" citation. Also demonstrates the required sequencing: model-building by experts, then pretest, then operational use.
- **Caveats**: Self-reported by the organisation; no published item statistics accompany the claim. "Performing at least as well" is not quantified in the public write-up.

### NBME Item-Writing Guide
- **Citation**: National Board of Medical Examiners, current edition
- **Link**: https://info.nbme.org/rs/552-QHC-046/images/NBME_Item-Writing-Guide.pdf
- **Type**: documentation (industry standard)
- **Key finding**: The canonical MCQ item-writing rulebook. Rule 5 is the operative one for us: "Each item should be reviewed to identify and remove technical flaws that add irrelevant difficulty **or benefit savvy test-takers**" — i.e. cue-leakage is treated as a first-class defect, not a nicety.
- **Relevance to this pipeline**: Supplies a ready-made, citable checklist to encode as automated QC rules (length cues, absolute-language cues, grammatical-agreement cues, convergence cues, "all/none of the above," etc.).
- **Caveats**: Written for medical content and for human writers; several rules (e.g. avoid negatively-worded stems) are *deliberately violated* by the LSAT, which uses EXCEPT/LEAST items. Cannot be applied uncritically.

### Progress is impossible without change: implementing AIG in medical knowledge progress testing
- **Citation**: Falcão, F., et al. *Education and Information Technologies*, 2023
- **Link**: https://link.springer.com/article/10.1007/s10639-023-12014-x
- **Type**: peer-reviewed
- **Key finding**: Operational account of implementing AIG in a medical progress test, restating the Gierl/Lai three-step process and its guidelines for stem, options, lead-in and supporting information.
- **Relevance to this pipeline**: Confirms AIG has moved from research to routine operation in at least one high-volume testing context.
- **Caveats**: Same domain-decomposability caveat.

### A Methodology for Multilingual Automatic Item Generation
- **Citation**: Gierl, M. J., & Lai, H. *Mesure et évaluation en éducation*, 37(3), 2015
- **Link**: https://releve.erudit.org/en/journals/mee/2015-v37-n3-mee02497/1036327ar.pdf
- **Type**: peer-reviewed
- **Key finding**: 720 items (360 English / 360 French) generated from one multilingual item model.
- **Relevance to this pipeline**: Mostly a dead end for us — LSAT is monolingual — but it illustrates how far the template approach can be pushed when the construct is decomposable, which sharpens the contrast with LR.
- **Caveats**: Not applicable to LSAT.

### Being an LSAT Testmaker (interview with a former LSAT item writer)
- **Citation**: Unplugged Prep, interview with a freelance LSAT item writer active 1992–1997
- **Link**: https://www.unpluggedprep.com/lsat-prep/being-an-lsat-testmaker-interview/
- **Type**: industry (first-hand practitioner account)
- **Key finding**: Extremely valuable operational detail. (a) **Pay was $75/accepted LR item rising to $85 by 1997**; the interviewee notes this was a high rate for item writing even decades later. (b) An LR assignment was **10 items of specified types** ("two weakeners, one assumption, etc.") — i.e. writers were commissioned against a *blueprint*, exactly as our generation spec should be. (c) He averaged **~8.7 accepted out of 10**; writers averaging ~6/10 "didn't write many items, or didn't write for long." (d) The full pipeline: writer → contractor's editors select and revise → LSAC second review → **experimental sections** → live administration → statistics → promote or discard.
- **Relevance to this pipeline**: This is the reference process our pipeline is trying to replicate. Two numbers anchor the cost model: **~$85/item to a skilled human writer** (1997 dollars; see cost section for the 2026 adjustment) and an **87% acceptance rate for an *expert* writer** — which is the realistic ceiling, not 100%.
- **Caveats**: Recollection of 1990s practice by one person; rates and process may have changed. He notes items then went through ACT as contractor. Treat the $85 as a floor-anchor, not a current quote.

### LSAC Test Developer / Test Specialist job postings
- **Citation**: LSAC job listings (2017 LinguistList postings; recent Test Developer – Bilingual posting)
- **Link**: https://listserv.linguistlist.org/pipermail/linguist/2017-June/085724.html ; https://tallo.com/talent/job/design-and-media/writer/pa/test-developer-bilingual-a1d9663c
- **Type**: industry (primary hiring documents)
- **Key finding**: LSAT item writers are salaried **Test Developers** at **$68,000 (2017)** to **$75,000–$80,000 (recent)**, requiring "MA and doctoral-level work in philosophy, classics, history, theoretical linguistics, literature, or some related discipline," training in logic, and a broad liberal-arts background. Duties explicitly include writing, review, revision, **fairness review**, section assembly, and **post-administration review**.
- **Relevance to this pipeline**: Sets the labour market price for the human-in-the-loop reviewer we need, and describes the *profile* to hire: a philosophy/linguistics PhD-track person, not a lawyer. Also confirms review and fairness review are distinct, staffed activities.
- **Caveats**: Salary bands are for full-time LSAC staff in Pennsylvania; a contract reviewer in a prep company will price differently.

---

## 2. LLM-based item generation: the current state (2024–2026)

### 2.1 The headline: on *psychometric* measures, LLM items are already competitive

The strongest evidence is a **large-scale field study** (AAAI 2026): 91 college classes across CS, maths, chemistry and more, **~1,700 students**, IRT analysis. Using an **iterative generate → LLM-judge → revise** loop (Self-Refine style, o3-mini), the generated items came out:

- **more discriminating** than human-expert AP-exam items: mean IRT discrimination **α = 1.30 (AI) vs 1.20 (standardised)**, Pr(δ>0) ≈ 0.85; **36%** of AI items rated "highly/very highly" discriminating vs **21%** of standardised items;
- **easier**, and best targeted at slightly below-average ability (test information peaked at θ = −0.51 vs +0.32 for the standardised exams);
- higher aggregate test information: **I_max 3.85 (reliability 0.79)** vs **2.61 (0.72)**.

Multiple smaller studies replicate the same shape: **difficulty and discrimination statistically indistinguishable, with AI items skewing easier.** A pre-registered, blinded, within-subject radiology/radiation-oncology study (npj Digital Medicine 2025; 24 GPT-4o vs 24 human items, 128 participants) found difficulty 0.67 vs 0.65 and discrimination 0.29 vs 0.27, both n.s. — **and examinees could not identify item origin above chance (0.50)**. An emergency-medicine study found the same discrimination parity (0.172 vs 0.196, p = .63) and identical point-biserials (0.23 vs 0.23) but AI items significantly easier (P-index 0.76 vs 0.65, p = .02) and, importantly, **36% of AI items vs 24% of human items flagged as "problematic" on point-biserial (p = .015)**.

**How to read this for LSAT.** These results are encouraging but they are all from **knowledge-recall domains** where the correct answer is a fact and distractors are other facts. LSAT LR has no external fact to anchor correctness — the key is correct *only* in virtue of the argument's logical structure, and the distractors must be wrong in structurally-specified ways. Every one of these studies would be far harder to reproduce on LR. The "examinees can't tell which is AI" result is the most transferable and the most encouraging; the "discrimination parity" result is the least transferable.

### 2.2 The measured failure modes

Consolidating across sources, the recurring defects in LLM-generated items are:

| Failure mode | Reported frequency | Source |
|---|---|---|
| Any quality issue | **34%** of items | NCME 2024, via edugenius synthesis |
| Flawed distractors (too obvious or arguably correct) | **14%** of MCQs | same |
| Content inaccuracy | **12%** | same |
| Ambiguous wording → multiple defensible answers | **9%** | same |
| Wrong cognitive level | **8%** | same |
| Bias / cultural assumption | **5%** | same |
| Separately-generated answer key wrong | **19%** | NCTM 2024, via same |
| Psychometrically "problematic" on point-biserial | **36%** (vs 24% human) | BMC Med Educ 2025 |

For calibration on how bad *human*-curated banks can be: **MMLU** — the most-cited MCQ benchmark in the world — was independently re-annotated and found to have **6.5%** (Gema et al., 5,700-item manual re-annotation) to **25–30%** (broader audits) label problems, including no-correct-answer and multiple-defensible-answer items. This is a useful humility check: the bar is not perfection; it is "materially better than the noisy baselines already in circulation."

### 2.3 What the literature itself admits is missing

Tan, Armoush, Mazzullo, Bulut & Gierl's review of **60 LLM-AIG studies** (IJATE, 2025) is blunt: LLMs are flexible and effective at *producing* items across languages and domains, but "many studies have overlooked the quality of the generated items, indicating **a lack of a solid educational foundation**." The AAAI field-study authors make the same point, quoting the review's recommendation to evaluate "both the measurement properties and pedagogical soundness of generated items as an essential step in AIG." A 2026 STEM scoping review reaches the same conclusion and adds that reported limitations include "factual inaccuracies, construct [misalignment]" and calls for pilot testing, bias audits and governance controls.

**Implication for us:** the research frontier is *not* "can a model write a plausible-looking item" — that is solved. The frontier is *verification*. That is where our engineering effort should go, and it is why Sections 3–4 and the empirical work in Section E are weighted heaviest.

### Sources for Section 2

### Assessing the Quality of AI-Generated Exams: A Large-Scale Field Study
- **Citation**: AAAI 2026 (Vol. 40), authors per DOI record
- **Link**: https://doi.org/10.1609/aaai.v40i45.41205
- **Type**: peer-reviewed (AAAI)
- **Key finding**: 91 classes, ~1,700 students. Iterative generate/judge/refine with o3-mini. AI items: mean IRT discrimination **α = 1.30 vs 1.20** for AP-exam items (95% CrI [−0.09, 0.25], Pr(δ>0) ≈ 0.85); **36% vs 21%** highly/very-highly discriminating; AI exams **I_max = 3.85, R = 0.79** vs **2.61, R = 0.72**; AI exams peaked at θ = −0.51 (below-average ability) vs θ = +0.32.
- **Relevance to this pipeline**: The best existing evidence that an **iterative LLM-critique-and-revise loop** — not single-shot generation — produces items with real psychometric quality. This is the architecture to copy. Also confirms the "generated items skew easy" bias we must correct for.
- **Caveats**: Not LSAT and not reasoning-under-a-stimulus; the comparison condition (AP Statistics items matched to courses by an LLM) is an imperfect proxy for a bespoke expert-written exam, which the authors acknowledge. 10-item tests only. Population is college students in ordinary courses, not a self-selected high-stakes cohort near the top of the ability distribution — which is precisely where LSAT items must discriminate.

### Psychometric properties and detectability of GPT-4o–generated MCQs vs human-authored items across imaging specialties
- **Citation**: *npj Digital Medicine*, 2025
- **Link**: https://doi.org/10.1038/s41746-025-02313-7
- **Type**: peer-reviewed, pre-registered
- **Key finding**: 24 GPT-4o vs 24 topic-matched human items; 82 students + 46 physicians, origin masked. Difficulty **0.67 vs 0.65**, discrimination **0.29 vs 0.27**, both n.s. **Participants could not identify item origin above chance (0.50).** Expert ratings of appropriateness/didactic quality had **very low interrater agreement (ICC 0.07–0.18)**.
- **Relevance to this pipeline**: Two things. (1) Blinded indistinguishability is achievable in an expert-reviewed human-in-the-loop workflow — that is the target. (2) The **ICC 0.07–0.18** finding is a warning: *human experts barely agree with each other* about item quality on subjective dimensions. Any acceptance criterion we write must be behavioural/statistical, not "an expert liked it."
- **Caveats**: Small item count (48), single centre, imaging domain, and crucially the workflow **included expert review** — this is not a measurement of raw model output.

### Comparison of AI-generated and clinician-designed MCQs in an emergency medicine exam
- **Citation**: *BMC Medical Education*, 2025
- **Link**: https://link.springer.com/article/10.1186/s12909-025-07528-6
- **Type**: peer-reviewed
- **Key finding**: 50 ChatGPT-4o vs 50 clinician items, 18 residents. AI items significantly **easier** (P 0.76 vs 0.65, p = .02); discrimination n.s. (0.172 vs 0.196); point-biserial identical (0.23 vs 0.23); **56% of AI items classified "easy" vs 36%** of human; **36% of AI items vs 24% of human flagged "problematic" on PBCC (p = .015)**.
- **Relevance to this pipeline**: The single cleanest quantification of the "AI items are easier and have a higher problematic rate" pattern. The ~1.5× problematic-rate multiplier is a reasonable planning assumption for what QC must remove.
- **Caveats**: Only 18 examinees, so item statistics are very imprecise; discrimination estimates at n = 18 are near-meaningless individually.

### Fine-Tuned LLMs for Generating MCQs in Anesthesiology: Psychometric Comparison With Faculty-Written Items
- **Citation**: *JMIR Formative Research*, 2026;10:e84904
- **Link**: https://formative.jmir.org/2026/1/e84904
- **Type**: peer-reviewed
- **Key finding**: 14 expert vs 15 fine-tuned-LLM items. Difficulty 0.81 vs 0.79, point-biserial 0.19 vs 0.17, discrimination index 0.09 vs 0.08 — all n.s. But the authors note **both sets showed only modest psychometric quality**; neither reliably separated high from low performers.
- **Relevance to this pipeline**: A necessary corrective. "AI items are as good as expert items" sometimes means "both are mediocre." Parity with a weak human baseline is not the bar; LSAC items are a *strong* human baseline.
- **Caveats**: Tiny (29 items). Undergraduate anesthesiology exam.

### A review of automatic item generation techniques leveraging large language models
- **Citation**: Tan, B.; Armoush, N.; Mazzullo, E.; Bulut, O.; Gierl, M. J. *International Journal of Assessment Tools in Education*, 12(2): 317–340, 2025
- **Link**: https://doi.org/10.21449/ijate.1602294 (open PDF: https://files.eric.ed.gov/fulltext/EJ1476463.pdf)
- **Type**: peer-reviewed (systematic review)
- **Key finding**: 60 studies across 7 databases. LLMs are "flexible and effective in generating various types of items across different languages and subject domains," but **"many studies have overlooked the quality of the generated items, indicating a lack of a solid educational foundation."** Calls for interdisciplinary work between CS and measurement.
- **Relevance to this pipeline**: Authoritative statement (co-authored by Gierl himself, the founder of the template-AIG tradition) that the field's weak point is exactly the thing we most need: validated quality.
- **Caveats**: Literature cut-off is largely pre-2024, so it predates the strong reasoning models; the "LLMs are effective" claim rests on older models than we would use.

### LLM-Based Automated Item Generation in STEM Assessments: Historical Mapping and a Scoping Review
- **Citation**: *Journal of Educational Technology Development and Exchange* (JETDE), 2026
- **Link**: https://aquila.usm.edu/cgi/viewcontent.cgi?article=1950&context=jetde
- **Type**: peer-reviewed (PRISMA-ScR scoping review)
- **Key finding**: 1,26x records screened → ~7x empirical LLM-era STEM AIG studies retained. Across studies, the dominant pattern is generation of stems, keys, distractors and explanations by instruction-tuned models **with retrieval and human-in-the-loop review**. Psychometric properties are "comparable to those of human-[written] items," but persistent limitations include factual inaccuracies and construct misalignment; the review calls for pilot testing and bias audits plus governance controls.
- **Relevance to this pipeline**: Confirms that "retrieval-grounded generation + human-in-the-loop" is the converged-upon architecture, not an exotic choice.
- **Caveats**: STEM-only; scoping review, so no meta-analytic effect sizes.

### How to Evaluate the Quality of AI-Generated Assessment Items
- **Citation**: EduGenius (industry blog), synthesising NCME 2024 and NCTM 2024 figures
- **Link**: https://www.edugenius.app/blog/evaluate-quality-ai-assessment-items
- **Type**: industry (secondary synthesis)
- **Key finding**: **34%** of AI-generated items contain ≥1 quality issue — content inaccuracy 12%, ambiguous wording (multiple defensible answers) 9%, wrong cognitive level 8%, bias 5%, flawed distractors 14% (MCQ only). Separately-generated answer keys had a **19% error rate** for multi-step maths.
- **Relevance to this pipeline**: The most concrete failure-rate taxonomy I found, and it maps almost one-to-one onto the QC checks in the pipeline. The 19% answer-key error figure is the argument for **independent multi-model key verification** rather than trusting the generator's own key.
- **Caveats**: **This is a secondary industry source, not a paper.** It attributes figures to "NCME 2024" and "NCTM 2024" without precise citations, and I could not verify the primary sources. Treat the numbers as order-of-magnitude planning figures, not as established findings. The independent evidence (BMC 36% problematic; MMLU audits) is in the same range, which is mild corroboration.

### MMLU label-noise audits (Gema et al. 2024 re-annotation; LabelSets LQS audit)
- **Citation**: Gema et al., 2024 (MMLU-Redux); LabelSets public audit report
- **Link**: https://www.bestaiweb.ai/mmlu-s-6-5-label-error-rate-score-saturation-and-the-prerequisites-for-understanding-llm-benchmarks/ ; https://labelsets.ai/mmlu-lqs-audit
- **Type**: preprint-derived / industry audit
- **Key finding**: Manual re-annotation of **5,700 MMLU questions** found **6.49%** contain errors (33% of those are incorrect labels, 14% unclear/ambiguous, 4% multiple defensible answers); broader audits claim **25–30%** label noise. One subject had 57% of analysed questions flagged.
- **Relevance to this pipeline**: Calibrates the bar. A widely-used, human-sourced item bank carries 6–30% defects. Our target should be *better than that*, and it is achievable — but it also means "some defects exist" is not automatically disqualifying if the rate is low and the items are labelled as practice, not as official.
- **Caveats**: The 25–30% figure comes from a commercial audit vendor with an interest in the claim; the 6.49% figure from Gema et al. is the better-evidenced number. MMLU is crowdsourced from practice-exam websites, a much weaker provenance than LSAC.

---

## 3. Distractor generation — the actual hard problem

### 3.1 Why LSAT distractors are a different problem from the literature's distractors

Almost all published distractor-generation work assumes a **knowledge** item: there is a fact, the key states it, and distractors are *other facts* that a student with a specific misconception would believe. The research goal is therefore "generate distractors students actually pick." Techniques: rank distractors by predicted student choice and train a generator with DPO on those ranks; mine error-distractor pairs and enforce consistency; use hierarchical encoders with dissimilarity losses to diversify.

LSAT LR distractors are not that. An LR distractor is wrong **relative to the argument's structure**, and the trap it instantiates is a *reasoning* error, not a *knowledge* error. The catalogue is small, closed and well documented by the prep industry:

| Trap | What it does | Typically appears in |
|---|---|---|
| Out of scope / new concept | Introduces an entity or relation the stimulus never mentions or implies | all types |
| Too strong / overbroad | Right direction, but "all/never/must" where only "some/may" is supported | Inference, Necessary Assumption |
| Too weak / irrelevantly modest | Supports the direction but too feebly to do the job | Strengthen, Sufficient Assumption |
| Reversal / mistaken negation | Swaps necessary and sufficient; converse instead of contrapositive | Conditional, Inference, Parallel |
| Opposite direction | Strengthens when asked to weaken (and vice versa) | Strengthen/Weaken |
| Premise restater | Repeats given evidence, adds nothing | Strengthen, Weaken, Main Point |
| Correlation vs causation | Treats co-occurrence as cause, or ignores reverse causation | Flaw, Weaken, Assumption |
| Part / whole | Attributes a property of a part to the whole, or vice versa | Flaw, Parallel Flaw |
| Attacks a premise | Denies something the argument stipulates as true | Weaken |
| Wrong conclusion targeted | Bears on a claim the author never made | Weaken, Strengthen |
| Irrelevant comparison | Compares to a case the stimulus doesn't license | all types |
| Term shift / equivocation | Slides between two senses of a term | Flaw, Inference |
| Temporal shift | Confuses before/after or projects a trend the stimulus doesn't | Inference, Paradox |
| True but doesn't answer the question | Correct as a statement, wrong as an answer to *this stem* | all types |

This is *good news*: unlike student misconceptions in maths, the trap set is enumerable, so distractor generation can be **specified** — "produce five choices, one key and four distractors instantiating traps {T1..T4} drawn from this taxonomy, one trap per distractor." That is what I did in the empirical experiment (Section E), and it produced distractors that were correctly *labelled* with traps. The problem, as Section E shows, is a different one: models produce distractors that are **recognisably wrong from surface form alone**, which is a failure of *calibration*, not of taxonomy.

### 3.2 The measurable properties of a good distractor

Four operationalisable criteria emerge from the literature:

1. **Endorsement rate.** A distractor nobody picks does no work. The traditional threshold is that every distractor should be selected by **at least ~5%** of examinees; below that it is a "non-functioning distractor." (NBME's guide treats non-functioning distractors as a defect.)
2. **Distractor discrimination.** Compute an item-total correlation *per distractor*. A well-functioning distractor is chosen more by low scorers than high scorers, i.e. it has a **negative** distractor discrimination. Duolingo's large pilot found **~3% of all distractors were malfunctioning** — examinees endorsing them had *higher* mean total scores than examinees endorsing the key — and removing just those distractors cut the proportion of items with item-total correlation < 0.1 from **6% to 2%**. This is the single highest-leverage post-hoc repair available: you don't have to throw the item away, you fix or drop the one bad distractor.
3. **Entropy / confidence distribution.** D-GEN evaluates distractor quality by whether generated distractors reproduce the *confidence distribution* over options that the ground-truth distractors induce (Spearman ρ 0.99, Kendall τ 0.94 on ranking alignment). A cheap version of this is available pre-field-test: ask a *weaker* model (a proxy for a mid-ability student) for its full probability distribution over the five choices and require that the entropy be non-trivial.
4. **Guessability contribution.** If removing the stimulus still identifies the key, the distractor set has failed regardless of how good each distractor looks individually.

### 3.3 What actually works to improve distractors

- **Preference optimisation on predicted student choice.** Train a pairwise ranker to judge which of two distractors students are more likely to pick, then DPO the generator on those ranks. Produces items with **higher item discrimination index** than baselines. This is the strongest published result, but it presupposes student response data — which we won't have at launch and *will* have after a few months of operation. It is the right **v2** technique, not the right v1 technique.
- **Consistency between the named error and the distractor** (LOOKALIKE): forcing the generator to state the error and then produce the distractor that error yields, with preference regularisation on inconsistency. LLM-as-judge accuracy 51.6% distractor / 57.2% error vs 45.6%/47.7% for the prior SOTA (DiVERT). Note how low the absolute numbers are — **this is an unsolved problem even in maths, where the ground truth is crisp.**
- **Structural parity enforcement.** Not from the research literature but from the item-writing tradition and confirmed by my experiment: force all five options into the same syntactic frame, the same length band, the same quantifier strength, and the same subject matter. This is the highest-yield cheap intervention because the dominant observed failure was "the key is the only choice that is *shaped like* an answer."

### Sources for Section 3

### Generating Plausible Distractors for MCQs via Student Choice Prediction
- **Citation**: ACL 2025 (Long Papers); arXiv:2501.13125
- **Link**: https://aclanthology.org/2025.acl-long.1154.pdf ; https://arxiv.org/html/2501.13125v2
- **Type**: peer-reviewed (ACL)
- **Key finding**: Three-stage pipeline — pairwise ranker predicting which distractor students are more likely to pick → synthetic pairwise-rank dataset → DPO-trained generator. The ranker achieves **ranking accuracy comparable to human experts**; the generator beats baselines on plausibility and produces items with **higher discrimination index**.
- **Relevance to this pipeline**: The definitive statement that distractor quality is a *student-behaviour* prediction problem, not a text-similarity problem. Directly motivates the "once you have response data, mine it" phase of our roadmap.
- **Caveats**: Computer-science subjects (Python, DB, ML/DL) — knowledge domains. Requires student choice data to bootstrap the ranker. No LSAT-like reasoning items tested.

### D-GEN: Automatic Distractor Generation and Evaluation for Reliable Assessment of Generative Models
- **Citation**: Findings of ACL 2025
- **Link**: https://aclanthology.org/2025.findings-acl.174.pdf
- **Type**: peer-reviewed
- **Key finding**: Two new distractor-quality metrics that do not need student data: **ranking alignment** (do generated distractors preserve the relative ranking of models that ground-truth distractors produce? Spearman ρ **0.99**, Kendall τ **0.94**) and **entropy analysis** (does the confidence distribution over options match?).
- **Relevance to this pipeline**: A *pre-field-test* proxy for distractor quality that we can implement immediately: measure the answer-probability distribution a panel of models assigns across the five choices and require it to look like the distribution real LSAT items induce. This is the best "no student data yet" distractor metric I found.
- **Caveats**: Designed to evaluate *models*, not students; the assumption that model confidence tracks student choice is untested for LSAT-style reasoning, and given that frontier models are at ~98% on LSAT (Section 5), their confidence distribution over LSAT distractors is likely to be far more peaked than a student's.

### LOOKALIKE: Consistent Distractor Generation in Math MCQs
- **Citation**: BEA 2025 workshop (Lan et al. group, UMass)
- **Link**: https://people.umass.edu/~andrewlan/papers/25bea-cyclic.pdf
- **Type**: peer-reviewed (workshop)
- **Key finding**: Preference optimisation with inconsistency mining to make the generated distractor actually be the one the named student error produces. On 1,400+ real maths MCQs: **51.6% distractor accuracy and 57.2% error accuracy under LLM-as-judge**, vs 45.6%/47.7% for prior SOTA (DiVERT).
- **Relevance to this pipeline**: Two lessons. (1) Forcing an explicit error→distractor mapping is a real technique and it helps. (2) **Absolute performance is ~50%** on a domain far easier to verify than LSAT. Anyone claiming near-perfect automated distractor generation for LSAT should be disbelieved.
- **Caveats**: Maths only; evaluated by LLM-as-judge, which Section 4 shows is itself unreliable.

### Transformer-enhanced hierarchical encoding with multi-decoder for diversified MCQ distractor generation (THE-MD)
- **Citation**: *Artificial Intelligence Review*, 2025
- **Link**: https://link.springer.com/article/10.1007/s10462-025-11237-3
- **Type**: peer-reviewed
- **Key finding**: For *reading comprehension* distractors specifically. Identifies the two standing failures of neural distractor generation: (i) failure to capture long-range context → "overly general or context-independent distractors," (ii) generated distractors are semantically too similar to each other. Fixes with a hierarchical encoder + multiple decoders with a dissimilarity loss. BLEU-4 7.45/10.60 and ROUGE-L 22.96/34.88 on RACE/RACE++.
- **Relevance to this pipeline**: The diagnosis is exactly right for our RC case: the two failure modes to guard against are off-topic distractors and mutually redundant distractors. The *fix* is not directly usable (we are not training a seq2seq model), but the **dissimilarity constraint** translates into a prompt/QC rule: no two distractors may instantiate the same trap or be paraphrases of each other.
- **Caveats**: BLEU/ROUGE against reference distractors is a weak proxy for quality; the field itself acknowledges these metrics are unsuitable (see the READI paper in Section 4). RACE is school-level English comprehension, far below LSAT register.

### LSAT wrong-answer taxonomies (prep-industry sources)
- **Citation**: Impetus LSAT, "Logical Reasoning Patterns"; Test Ninjas, "Strengthen and Weaken Questions"; Varsity Tutors LSAT lessons (Weaken; Inference)
- **Link**: https://www.impetuslsat.com/post/logical-reasoning-patterns-that-will-boost-your-lsat-score ; https://test-ninjas.com/lsat-strengthen-and-weaken-questions ; https://www.varsitytutors.com/practice/subjects/lsat/lessons/weaken ; https://www.varsitytutors.com/practice/subjects/lsat-logical-reasoning/lessons/inference
- **Type**: industry (prep instruction)
- **Key finding**: Convergent, stable taxonomy of LR trap types across independent vendors: out-of-scope, too extreme, reversal/mistaken-negation, opposite direction, premise restater, irrelevant comparison, attacks-a-premise, wrong-conclusion-targeted, correlation/causation. Also gives per-type frequency estimates (e.g. Weaken ~9% of LR items, Strengthen ~7%).
- **Relevance to this pipeline**: This is the trap taxonomy to encode as the distractor generation spec and as the QC label set. The per-type frequencies are the blueprint weights for how many of each item type a pool needs.
- **Caveats**: Commercial prep sources, not LSAC. Frequencies are vendor tallies over released PrepTests and vary between vendors. The taxonomy is a pedagogical construct, not an official LSAC one — LSAC has never published a distractor taxonomy.

---

## 4. Validation and QC pipelines for generated items

### 4.1 The converged architecture

Across the strongest recent work, the architecture is the same:

**generate → automated deterministic filters → model-based verification (multi-model) → adversarial critique/revise loop → human review (sampled or full) → field test unscored → promote on statistics.**

Concrete instantiations:

- **AAAI 2026 field study**: generate → AI-judge labels good/bad → the labelled examples are fed back into the generator's few-shot prompt → after 20 items, a *second* AI-judge assesses appropriateness, difficulty and answer correctness → the hardest 10 become the test. This closed loop is what produced discrimination *above* the human-written comparison.
- **Duolingo English Test (Attali et al., 2022)** — the most production-realistic case study available: **14,000+ GPT-3-generated passages** → two rounds of automated filters (length 100–175 words, 5–20 sentences, no repeated 8-grams, profanity filter, per-sentence negative-log-likelihood coherence thresholds) → sample of 800 → items generated and passages *dropped if adequate distractors couldn't be produced* → **789 passages retained** → human content and fairness review by **12 external + 6 internal reviewers**, with a **minimum of three content reviews and two fairness reviews per passage and per question** → **454 passages / 5,246 items fielded** in a 21-day pilot with ~200k test-takers, ~425 responses per item.
- **Multi-agent frameworks** (EduAgentQG; BEA 2026 Bloom-agents): Writer / Solver / Educator / Checker roles, with explicit constraint checks (grounding, answer fidelity, level alignment) and only fully-passing candidates retained.

### 4.2 LLM-as-judge is the weakest link, and you must design around it

This matters enormously because the whole pipeline leans on model-based verification. The documented biases:

- **Position bias** — 15 judges, ~150,000 evaluation instances across MTBench and DevBench: position bias is "not due to random chance," varies significantly by judge and task, and is **strongly affected by the quality gap between candidates** (worse when candidates are close in quality — exactly our case).
- **Verbosity/length bias**, **self-preference bias** (models favour their own generations), **family bias** (same-provider favouritism), **concreteness bias**, **style bias**.
- **Provenance shortcut bias** — judges shown a "HUMAN" vs "LLM" vs "UNKNOWN" label shift verdicts by up to **+14–16%** (GPT-4o on LitBench) purely on the label. Order: Human > LLM > Unknown.
- **No judge is uniformly reliable** — RAND's Judge Reliability Harness (March 2026) stress-tested four judges and found consistency broke down on formatting changes, paraphrasing, and verbosity shifts. JudgeBiasBench reports frontier LLMs exceeding **50% error on some bias tests** across 12 bias types.

**Mitigations that the literature supports, and that I implemented:** randomise/shuffle option order per judge call and average or treat conflicting verdicts as ties; use judges from **different model families** than the generator; strip provenance cues; prefer **behavioural** probes (make the model *answer* the item) over **evaluative** probes (ask the model to *rate* the item). The behavioural probes are far more robust because there is a ground-truth key to score against.

My own measurement of this, in Section E: two frontier critics (Claude Opus 4.8 and GPT-5.6 Terra) given identical items and identical rubrics reached **exact verdict agreement on only 53%** of 30 items, and Opus issued **zero** "reject" verdicts where GPT issued five. That is a live demonstration that a single LLM judge is not a gate — it is a *signal*.

### 4.3 The best automated check: solvability with and without the stimulus

The single most useful published methodology I found is **text informativity** (Säuberli & Ebling, READI @ LREC-COLING 2024): let high-performing test takers (or LLMs) answer the item **twice** — once with the passage (*answerability*) and once without it (*guessability*) — and define

> **text informativity = answerability − guessability**

An item with high answerability but *also* high guessability is not measuring comprehension; it is measuring test-wiseness. The authors show LLM-based estimation works (GPT-4 over-estimates both answerability and guessability, but the *difference* normalises much of that, and GPT-4's inter-annotator agreement with humans was high).

This is the check I built and ran in Section E, and it is the check that found the most damaging defect in generated LSAT items. **If you implement only one automated QC gate, implement this one.**

Note the asymmetry created by Section 5's benchmark results: because frontier models score **97–100% on real LSAT items**, "a strong model can solve it" is a **weak positive** signal (nearly everything passes) but a **strong negative** signal (if two or more independent frontier models cannot recover the key from a generated item, the item is very likely broken, because their false-negative rate on genuine items is only 2–3%). Use solvability as a *rejection* filter, not an acceptance filter. Use *guessability* as the acceptance filter.

### 4.4 Human review: how much, and by whom

- Duolingo: **3 content + 2 fairness reviews minimum, on every passage and every item** — i.e. 100% human review at 5 passes. That is the high-stakes standard.
- NBME: 38 trained SMEs building models, plus standard committee review, plus pretest.
- LSAC (historical): editorial selection + revision by contractor, then a second LSAC review, then experimental-section field test.
- The npj Digital Medicine result is the cautionary note: **expert interrater agreement on subjective item-quality dimensions was ICC 0.07–0.18** — essentially zero. Human review is indispensable for catching *specific defects* ("this distractor is also defensible because…") and near-worthless as a holistic *rating* ("I'd give this a 4/5"). Design the human review as a **defect-finding checklist with binary items**, not a Likert score.

### Sources for Section 4

### The interactive reading task: Transformer-based automatic item generation
- **Citation**: Attali, Y., et al. *Frontiers in Artificial Intelligence*, 5:903077, 2022 (Duolingo English Test)
- **Link**: https://doi.org/10.3389/frai.2022.903077 ; PDF: https://duolingo-papers.s3.amazonaws.com/other/The+Interactive+Reading+Task.pdf
- **Type**: peer-reviewed
- **Key finding**: The most complete public end-to-end AIG production pipeline. **14,000+ passages generated** (GPT-3, 3–5 shot, conditioned on 270 university-study topics / 45 news categories) → automated filters (100–175 words, 5–20 sentences, no repeated 8-grams, profanity list, per-sentence NLL coherence bounds) → 800 sampled → **789 retained** after item/distractor generation feasibility filtering → **12 external + 6 internal human reviewers, min. 3 content + 2 fairness reviews each** → **454 passages, 5,246 items** fielded, ~425 responses/item over 21 days. Results: mean item easiness **0.70**; mean item-total correlation **0.27**; only **6%** of items had item-total r < 0.1; **~3% of all distractors were malfunctioning** (endorsers had higher mean total score than key endorsers), and dropping just those distractors reduced the sub-0.1 item rate from 6% to **2%**.
- **Relevance to this pipeline**: This is the template. It supplies (a) real yield numbers, (b) the exact deterministic filters worth copying, (c) the human-review intensity used by an organisation that actually ships this in a high-stakes test, and (d) the distractor-level statistic to compute in field testing. The "3% of distractors malfunction, and fixing just those halves the bad-item rate" finding is the most actionable single fact in this document.
- **Caveats**: GPT-3-era models (2022) — quality will be much higher now, but so will everyone's baseline. **Reading comprehension for English-language proficiency is a far easier construct than LSAT RC**, and the tasks (cloze, title selection, main idea) are much simpler than LSAT RC questions. It was fielded on the *practice* test, not the scored test. Duolingo has a large in-house psychometrics team; the human-review intensity described is not a small-team budget.

### Automatic Generation and Evaluation of Reading Comprehension Test Items with LLMs (text informativity)
- **Citation**: Säuberli, A., & Ebling, S. READI workshop @ LREC-COLING 2024
- **Link**: https://aclanthology.org/anthology-files/anthology-files/pdf/readi/2024.readi-1.3.pdf
- **Type**: peer-reviewed (workshop)
- **Key finding**: Introduces **text informativity = answerability − guessability**, measured by having high-proficiency humans *or LLMs* answer items twice, with and without the text. Worked example in the paper: 67% − 33% = **34%** informativity. Both GPT-4 and Llama 2 generated items of "acceptable quality" zero-shot, with GPT-4 clearly better on informativity and human ratings. GPT-4 **over-estimates both** answerability and guessability relative to humans, but the *difference* normalises this; GPT-4/human inter-annotator agreement was high, Llama 2's was not.
- **Relevance to this pipeline**: The methodological backbone of the QC stage, and independent published validation of the giveaway test I ran in Section E. Also explicitly warns that this protocol **cannot** catch items where the key reuses the passage's exact wording — so pair it with a lexical-overlap check.
- **Caveats**: German B1-level language-learner items, 50 texts, 6 annotators. The authors themselves note that with a *single* LLM you can only report informativity at the dataset level, not per item — you need **multiple models or prompt variation** to get per-item confidence. (That is why I used four independent solver models per item.)

### Judging the Judges: A Systematic Study of Position Bias in LLM-as-a-Judge
- **Citation**: Shi, L.; Ma, C.; Liang, W.; Diao, X.; Ma, W.; Vosoughi, S. IJCNLP-AACL 2025, pp. 292–314
- **Link**: https://aclanthology.org/2025.ijcnlp-long.18/
- **Type**: peer-reviewed
- **Key finding**: **15 LLM judges, 22 tasks, ~40 solution-generating models, >150,000 evaluation instances.** Position bias is not random; it varies significantly across judges and tasks; it is only weakly affected by prompt-component length but **strongly affected by the quality gap between the candidates** — i.e. worst exactly when the decision is hard.
- **Relevance to this pipeline**: Justifies mandatory option-order shuffling in every judging and solving call (which I implemented with a per-call seeded permutation), and justifies not trusting a single judge on close calls.
- **Caveats**: Studies pairwise/list-wise *comparison*, which is a slightly different task from our single-item defect review; the finding transfers by analogy rather than directly.

### A Survey on LLM-as-a-Judge
- **Citation**: arXiv:2411.15594 (v6, 2025)
- **Link**: https://arxiv.org/html/2411.15594v6
- **Type**: preprint (survey)
- **Key finding**: Catalogues length bias, position bias, concreteness bias, style bias, compassion-fade bias. Reviews mitigations: content swapping with score averaging (Wang et al.), shuffling (Auto-J, JudgeLM), and marking swap-inconsistent verdicts as "Tie" (PandaLM).
- **Relevance to this pipeline**: Source for the concrete mitigation menu. The PandaLM "conflicting after swap ⇒ tie" rule is a good design for our gate: if the verdict flips under permutation, escalate to human rather than accept either verdict.
- **Caveats**: Survey, not primary evidence; rapidly dating.

### The Silent Judge: Unacknowledged Shortcut Bias in LLM-as-a-Judge
- **Citation**: arXiv:2509.26072 (2025)
- **Link**: https://arxiv.org/html/2509.26072
- **Type**: preprint
- **Key finding**: Judges shown provenance cues (HUMAN / EXPERT / LLM / UNKNOWN) show a consistent trust hierarchy **Human > LLM > Unknown**. GPT-4o verdict-shift rates on LitBench: **+14%** Human-vs-Unknown, **+16%** Human-vs-LLM. Gemini-2.5-Flash shows the same ordering with smaller magnitude.
- **Relevance to this pipeline**: Operational rule — **never tell the judge that an item was model-generated**, and never mix real LSAC items and generated items in a labelled comparison prompt. My experiment stripped provenance for exactly this reason.
- **Caveats**: Preprint; two datasets (ELI5, LitBench), neither assessment-related.

### RAND Judge Reliability Harness / JudgeBiasBench (via industry summary)
- **Citation**: Sandler, M., et al. (RAND Corporation), March 2026; Zhou, H., et al., JudgeBiasBench, 2026 — accessed via Adaline's summary
- **Link**: https://www.adaline.ai/blog/llm-as-a-judge-reliability-bias
- **Type**: industry summary of preprints
- **Key finding**: RAND's open-source harness stress-tested four judges across safety/persuasion/misuse/agentic benchmarks and concluded **no judge was uniformly reliable**; consistency broke on formatting changes, paraphrasing, and verbosity shifts. JudgeBiasBench documents 12 bias types across four dimensions and reports frontier LLMs **exceeding 50% error** on some bias tests.
- **Relevance to this pipeline**: The strongest available statement that LLM-as-judge cannot be the final gate for anything that matters.
- **Caveats**: **Accessed via a vendor blog, not the primary papers** — I did not verify the RAND harness or JudgeBiasBench directly. Treat the specific numbers as unconfirmed; the directional claim is well supported by the peer-reviewed sources above.

### EduAgentQG: A Multi-Agent Workflow Framework for Personalized Question Generation
- **Citation**: arXiv:2511.11635 (2025)
- **Link**: https://arxiv.org/pdf/2511.11635
- **Type**: preprint
- **Key finding**: Writer / Solver / Educator / Checker agent loop. The Solver verifies that the reasoning chain is coherent and self-consistent, that no ambiguity exists, and that the solution path suits the intended level; only items passing *both* Solver and Educator go to the Checker, which does a final answer-correctness/unambiguity pass; failures are returned to the Writer with the evaluators' feedback for another round.
- **Relevance to this pipeline**: A clean role decomposition to copy. The important design choice is that the **Solver actually solves** rather than rating — a behavioural probe.
- **Caveats**: Preprint, no field testing with real students, no psychometric validation.

### From Questions to Assessment Tuples: A Multi-Agent Framework with Bloom-Specialized Agents and Automated Verification
- **Citation**: BEA 2026 workshop
- **Link**: https://aclanthology.org/2026.bea-1.22.pdf
- **Type**: peer-reviewed (workshop)
- **Key finding**: Verification acts as a hard filter on four constraints: (i) **Bloom/level alignment**, (ii) **grounding** — every generated component must be supported by the source context, (iii) **mark-scheme quality** (completeness, non-redundancy), (iv) **answer fidelity** — the expected answer satisfies all criteria without introducing unsupported information. Only candidates satisfying *all* constraints are retained.
- **Relevance to this pipeline**: The "grounding" constraint translates directly into the most important LSAT-specific check: **every element of the credited answer must be traceable to a specific span of the stimulus**, and the rationale must cite that span. That makes the check auditable by a human in seconds.
- **Caveats**: Short-answer/scenario-based questions, not 5-option MCQ; no field data.

---

## 5. How well do frontier models actually do on the LSAT?

### 5.1 The numbers (August 2026)

The decisive recent source is **"AI Achieves a Perfect LSAT Score"** (arXiv:2604.10034), which evaluates on an **officially disclosed LSAT (N = 77)** and on **PrepTests 150–159 (N = 1,037)**:

| Model | Official LR | Official RC | Official total | PT150-159 LR | PT150-159 RC | PT total |
|---|---|---|---|---|---|---|
| GPT-5 | 98.0 | 100.0 | 98.7 | 99.1 | 98.5 | 98.8 |
| Claude Opus 4 | 98.0 | 100.0 | 98.7 | 98.0 | 97.8 | 97.9 |
| Gemini 2.5 Pro | 94.0 | 100.0 | 96.1 | 99.1 | 97.8 | 98.6 |
| DeepSeek-R1 | 100.0 | 96.3 | 98.7 | 97.8 | 97.5 | 97.7 |
| Kimi K2 Thinking | **100.0** | **100.0** | **100.0** | 97.8 | 96.3 | 97.2 |
| QwQ-32B | 92.0 | 92.6 | 92.2 | 92.9 | 93.8 | 93.2 |
| DeepSeek-R1 Distill 7B | 54.0 | 59.3 | 55.8 | 54.0 | 60.9 | 56.7 |
| DeepSeek-R1 Distill Llama 8B | 46.0 | 66.7 | 53.2 | 57.0 | 72.8 | 63.2 |

Five of six frontier models exceed 97% across >1,000 questions. GPT-5 misses one of 77 (still a 180). Disabling the thinking phase costs **3–8 percentage points**, concentrated in LR.

Historical trajectory for context: GPT-3.5 ≈ 149 LSAT (2023) → GPT-4 ≈ 163 (2023) → frontier ≈ 180 (2026). On the older **AGIEval** benchmark (LSAT-AR/LC/RC splits among 20 exams), GPT-4 exceeded average human performance on SAT, LSAT and math contests; GPT-4o scores 62.3 on the AGIEval v1.1 aggregate, GPT-3.5-Turbo 46.0.

I **independently replicated the ceiling effect** in Section E: on 12 real LSAT LR items from the app's existing bank, four frontier models (GPT-5.6 Luna, Claude Sonnet 5, Grok 4.5, Gemini 3.5 Flash) scored **12/12, 11/12, 12/12, 11/11** — 97.9% pooled — *with answer options randomly permuted per call* to control for memorised option positions.

### 5.2 What this means for the pipeline — the important, counterintuitive part

The brief asked whether near-ceiling performance makes "can a model solve it" a weak filter. The answer is **it makes it a weak *acceptance* filter and an excellent *rejection* filter**, and the distinction is worth being precise about:

- Because a strong model's error rate on *genuine* LSAT items is only ~2%, the probability that two or more independent frontier models from different families all fail a genuine, well-formed item is very small. So **model disagreement or model failure on a generated item is strong evidence the item is defective** (bad key, ambiguous stimulus, two defensible answers). Precision of this signal is high.
- Conversely, essentially **every** competently-shaped item passes — including, as Section E shows, items that are badly broken in a *different* way (cue leakage). So passing tells you almost nothing. Recall of this signal is near zero.

The corollary is that the useful filters are the ones that create a **contrast**: with/without the stimulus (guessability), with/without option permutation (position sensitivity), and strong-model vs deliberately-weakened-model (does a weak model also get it right? — an easiness proxy).

### 5.3 A second corollary: model solvability cannot proxy for student difficulty

Because models are at ceiling, model accuracy carries no information about how hard an item is for a human at the 155–170 band. Any difficulty estimate must come from either (a) a text-feature model, (b) a deliberately handicapped model (small model, no chain of thought, token budget), or (c) real response data. See Section 7 — (a) barely works, (c) works but needs users.

### Sources for Section 5

### AI Achieves a Perfect LSAT Score
- **Citation**: arXiv:2604.10034 (2026)
- **Link**: https://arxiv.org/html/2604.10034v1 ; https://arxiv.org/pdf/2604.10034
- **Type**: preprint
- **Key finding**: Full table reproduced above. Kimi K2 Thinking **100%** on an officially disclosed LSAT (N=77); GPT-5 and Claude Opus 4 **98.7%**; five of six frontier models >97% across 1,037 PrepTest questions. Disabling thinking costs **3–8pp**, concentrated in LR. Best-of-5 selection and process reward models give only marginal further gains. Small distilled models (7–8B) score **53–63%**.
- **Relevance to this pipeline**: (a) Establishes that a frontier model is a *competent LSAT solver* and can therefore be trusted as a **negative** verifier. (b) Establishes the ceiling that kills solvability as an acceptance filter. (c) The 7–8B models at 53–63% are interesting as a **handicapped-solver difficulty proxy** — a model in that accuracy band sits roughly where a mid-scoring human sits, so its per-item behaviour may carry difficulty signal that frontier models do not.
- **Caveats**: **Preprint, not peer-reviewed.** The PT 150–159 questions are almost certainly in the models' training data — contamination is a serious confound, and the paper's own "officially disclosed test" is also public. So these numbers likely overstate true reasoning ability on *unseen* LSAT items. For our purposes this cuts both ways: it means models may be *worse* at verifying genuinely novel generated items than the benchmark suggests.

### AGIEval: A Human-Centric Benchmark for Evaluating Foundation Models
- **Citation**: Zhong, W.; Cui, R.; Guo, Y.; et al. Findings of NAACL 2024, pp. 2299–2314
- **Link**: https://aclanthology.org/2024.findings-naacl.149/ ; data: https://github.com/ruixiangcui/AGIEval
- **Type**: peer-reviewed
- **Key finding**: 20 official admission/qualification exams including LSAT splits (AR/LC/RC). GPT-4 exceeds average human performance on SAT, LSAT and math contests. AGIEval v1.1 aggregate: GPT-4o **62.3**, GPT-3.5-Turbo **46.0**, open models mostly 29–52.
- **Relevance to this pipeline**: The standard reference benchmark containing LSAT splits, and a useful reminder that the *aggregate* AGIEval number is much lower than the LSAT-specific number — LSAT is one of the easier AGIEval subsets for modern models.
- **Caveats**: AGIEval's LSAT splits still include **Analytical Reasoning**, which no longer exists on the test — so AGIEval LSAT numbers are not directly comparable to current-format performance. Also derived from the same public LSAT corpora as our own question bank, with the same provenance concerns.

### Reasoning leaderboard snapshot (August 2026)
- **Citation**: llm-stats.com reasoning leaderboard, accessed 2 Aug 2026
- **Link**: https://llm-stats.com/leaderboards/best-ai-for-reasoning
- **Type**: industry (aggregator)
- **Key finding**: As of August 2026 the reasoning leaders are GPT-5.6 Sol (58.1), Claude Opus 5 (57.7), Claude Mythos Preview (56.6), aggregated over 429 benchmarks. Also lists Claude Opus 5 pricing at **$5.00 / $25.00 per M tokens (input/output)**, 1M context.
- **Relevance to this pipeline**: Current pricing anchor for the cost model, and confirmation of which model families to use as independent verifiers.
- **Caveats**: Aggregator site; benchmark composition is opaque and the composite score is not a standard metric. Pricing is list price and changes frequently.

---

## E. Empirical component: I actually built and ran a miniature version of the pipeline

I had usable model access via the app's existing gateway (the same OpenAI-compatible endpoint that powers `backend/app/coaching.py`), which exposes multiple frontier families. So rather than only reading about this, I ran the experiment. Throwaway scripts live in `/tmp/lsat_gen/`; no application code was touched.

### E.1 Design

**Generation.** Three frontier models — **Claude Opus 4.8**, **GPT-5.6 Terra**, **Gemini 3.6 Flash** — each asked to write **8 LSAT LR items** against an identical, deliberately demanding spec: assigned item type and target difficulty per item (Flaw/hard, Necessary Assumption/hard, Strengthen/medium, Weaken/hard, Inference/medium, Paradox/medium, Principle-Apply/hard, Parallel Flaw/hard); 35–100-word stimulus; canonical LSAC stem phrasing; five choices; **each distractor required to instantiate a distinct named trap** from the Section 3.1 taxonomy, with a written rationale for why it is wrong and who falls for it; explicit instructions on length parity, no quantifier clustering on the key, key must not be longest, **and an explicit instruction that the item must not be solvable above chance from the stem and choices alone**. So the generators were *told about* every failure mode I then tested for. **24 items generated.**

**Control.** **12 real LSAT LR items** sampled from the app's existing `tasksource/lsat-lr`-derived bank, stratified across types, put through the identical battery. This is the crucial design element: without a same-instrument control, "generated items score X" is meaningless.

**Battery, run identically on all 36 items.** Every call permuted the five options with a per-call seed, so position and memorised-position effects are controlled.
1. **Solve test** — four independent solver models (**GPT-5.6 Luna, Claude Sonnet 5, Grok 4.5, Gemini 3.5 Flash**), full item, do they recover the key?
2. **Giveaway test** (= *guessability*, per Säuberli & Ebling) — same four models, **stimulus withheld**, stem + five choices only, forced choice. Chance = 0.20.
3. **Adversarial critique** — two critics from different families (**Claude Opus 4.8** and **GPT-5.6 Terra**) with an identical hostile-reviewer rubric: find the strongest case for a non-keyed answer, flag multiple-defensible/no-correct-answer, list defects with severity, name trivial distractors, name any surface-cue leak, rate register authenticity 1–5, give ship/revise/reject.

**Repair experiment (stage 3).** Every generated item was then fed back to Claude Opus 4.8 with its own diagnosed leak and defects, and asked to **rewrite only the five answer choices** to kill the cue while preserving the key — enforcing structural parity, on-topic distractors, and at least two genuinely competitive distractors. All 24 repaired items went through the identical battery again.

### E.2 Headline results

| | n | Solve acc. (4 models, stimulus shown) | **Giveaway acc. (stimulus withheld)** | Items where **all 4** models guessed the key blind | Critic flags "multiple defensible answers" (Opus / GPT) | Register authenticity (Opus, 1–5) |
|---|---|---|---|---|---|---|
| **Real LSAC items** | 12 | 0.979 | **0.514** | 25% | 17% / 8% | **4.58** |
| **Generated v0** | 24 | 0.990 | **0.896** | 79% | 8% / 17% | **3.88** |
| **Generated v1 (after anti-cue repair)** | 24 | 0.760 | 0.677 | 42% | **63% / 58%** | — |

Per-solver breakdown:

| Solver | Real: solve | Real: giveaway | Generated: solve | Generated: giveaway |
|---|---|---|---|---|
| GPT-5.6 Luna | 100% | 50% | 100% | 89% |
| Claude Sonnet 5 | 92% | 50% | 100% | 94% |
| Grok 4.5 | 100% | 42% | 100% | 89% |
| Gemini 3.5 Flash | 100% | 70% | 94% | 78% |

Giveaway distributions (chance = 0.20):
- **Real:** 0.0, 0.0, 0.25, 0.25, 0.25, 0.25, 0.67, 0.75, 0.75, 1.0, 1.0, 1.0 — median ≈ 0.25
- **Generated:** 0.25, 0.25, 0.5, 0.75, 0.75, then **nineteen items at 1.0** — median 1.0

### E.3 What this means

**1. Frontier models replicate the near-ceiling LSAT result, so solvability is a rejection filter only.** 97.9% on real items with permuted options. Confirms Section 5.2.

**2. The dominant failure mode of LLM-generated LSAT items is surface-cue leakage, and it is severe.** Nineteen of 24 generated items were solved by *all four independent frontier models with the stimulus entirely removed*. That is not a subtle statistical tendency; it is the item announcing its answer. Real items sat at roughly half that rate — and the real-item figure is almost certainly *inflated* by training-data contamination (these are public released PrepTest items the models have seen), which means the true gap is **wider** than 0.51 vs 0.90.

Crucially, the generation prompt **explicitly forbade this**, in the system prompt, as constraint 6. Instructing a frontier model not to leak the answer does not stop it leaking the answer.

**3. The mechanism is specific and nameable.** The critic's leak diagnoses cluster into four patterns, and each is mechanisable as an automated check:
- **Template recognition.** "(B) is the classic 'fails to consider alternative causes' template answer… seasoned test-takers will reflexively pick the causation/correlation answer."
- **Quantifier isolation.** "(C) is the only answer choice using hedged/existential quantifiers ('At least some,' 'can be'); every distractor uses a universal or superlative… so the key is identifiable by quantifier form alone."
- **Topical isolation.** "(A) is the only choice that mentions deer eating something… (B)–(E) either omit deer entirely or discuss deer only as population counts."
- **Direction isolation.** "The key is the sole option that favors the director's conclusion; every other option either licenses the sale or is off-topic. Direction-of-support alone isolates (D)."

**4. Structural statistics corroborate.** The key was the longest of the five choices in **71% of generated items vs 50% of real items** (chance = 20%). Generated stimuli averaged **53 words** against **70** for real LSAT stimuli, despite a 35–100-word instruction — models systematically under-write the stimulus, which is exactly what strips out the extraneous-but-plausible material real items use to create difficulty.

**5. Two frontier critics with an identical rubric agreed on the final verdict for only 53% of 30 items.** Claude Opus 4.8 issued **zero** "reject" verdicts across all 30; GPT-5.6 Terra issued five. Opus logged 49 "minor" and only 2 "major" defects on generated items while still recommending revision — classic leniency. Both critics also *under-detected* the leak: Opus flagged "multiple defensible answers" on only 8% of v0 items and wrote "NONE… no obvious surface tell" for an item all four solvers cracked blind. **A single LLM judge is not a gate.**

**6. The repair loop trades one fatal defect for another — this is the most important finding.** Targeted anti-cue rewriting *did* reduce mean giveaway (0.90 → 0.68, mean Δ = −0.22), but:
- **8 of 24** items went from unanimous solver agreement with the key to solvers disagreeing with it;
- **"multiple defensible answers" exploded from 8% to 63%** (Opus) and 17% to 58% (GPT);
- Opus "reject" verdicts went 0 → 8; GPT's went 5 → 14.

Making distractors competitive enough to stop being giveaways makes them **actually defensible**. This is precisely the difficulty that makes LSAT item writing a skilled profession, and it is now measured rather than asserted. Any pipeline that optimises against a guessability metric alone will manufacture ambiguous items.

**7. Joint-gate yield.** Requiring *unanimous* solver agreement with the key **and** giveaway ≤ 0.5 **and** neither critic flagging multiple defensible answers:

| | n | pass |
|---|---|---|
| Real LSAC items | 12 | **33%** |
| Generated v0 | 24 | **8.3%** |
| Generated v1 (repaired) | 24 | 4.2% |
| Best of v0-or-v1 per item | 24 | 8.3% |

Two caveats on these numbers, both important. First, **the gate is mis-calibrated: it rejects two-thirds of genuine LSAC items**, so its absolute pass rate is not a yield forecast. The right way to set thresholds is *relative to the real-item distribution* (e.g. "giveaway must fall at or below the 75th percentile of real LSAT items"), not at an arbitrary absolute. Second, the ratio is the meaningful quantity, and it is stark: **generated items pass a fixed quality gate at roughly one-quarter the rate of real ones.**

**8. Cost and speed.** Phase 1 (24 generated + 12 control items, full battery = 10 model calls per item) cost **$2.21 total, 283 calls, 264k tokens, 180 seconds wall-clock** at 6-way concurrency. The repair phase cost a further **$2.82**. So a full generate + validate + repair + re-validate cycle ran at roughly **$0.21 per candidate item, in under 10 minutes for 24 items**. Compute is emphatically *not* the constraint. Judgement is.

### E.4 Three actual generated items, with my own critique

#### Item 1 — Claude Opus 4.8, "Flaw in the Reasoning", target: hard, public policy

> A city introduced a program offering cash grants to residents who install rooftop solar panels. In the two years since, the city's total residential electricity consumption from the utility grid has fallen sharply. City officials concluded that the grant program has been effective at reducing residents' reliance on grid electricity and should therefore be expanded to neighboring towns.
>
> **The reasoning in the officials' argument is most vulnerable to criticism on the grounds that it**
>
> (A) takes for granted that a program successful in one city will be equally successful in towns that differ from it
> (B) ✱ fails to consider whether the decline in grid consumption resulted from factors other than the grant program
> (C) presumes, without justification, that reducing reliance on grid electricity is a worthwhile policy goal
> (D) overlooks the possibility that the grant program is more expensive than alternative means of reducing grid consumption
> (E) draws a conclusion about all residents from evidence concerning only those who installed panels

*Battery:* solve 4/4; **giveaway 4/4** — every model picked (B) without seeing the stimulus. Opus register rating 4/5.

*My critique.* Superficially this is a competent item — the stimulus is clean, the register is close, the traps are correctly labelled. It is nevertheless **not shippable**, for three separable reasons.

First, the giveaway. Both critics and all four blind solvers converged on the same explanation: (B) is the *stock* answer shape for any stimulus containing "in the two years since [intervention], [outcome] changed." A student who has done 200 LR questions will pattern-match this without reading. Real LSAT Flaw items defeat this by making at least two choices state plausible-sounding causal flaws, so that recognising "it's the causal one" narrows you to two, not one.

Second — and the generator did not catch this, though both critics did — the stimulus has a **compound conclusion**: an empirical claim ("has been effective") *and* a normative recommendation ("should therefore be expanded"). (B) attacks the first; (A) attacks the second; (D) attacks the cost-justification of the second. The stem ("the reasoning… is most vulnerable to criticism") does not disambiguate which conclusion is at issue. Under LSAC conventions this is a defect: the *argument's* main conclusion must be unambiguous, or the stem must name it. This is the kind of flaw a human LSAT writer would catch in ten seconds and a model will not, because the model wrote the rationale for (B) and then stopped looking.

Third, (C) and (D) are dead. (C) attacks a value premise nobody disputed; (D) raises cost-efficiency, which is not a *reasoning* flaw at all. Two of four distractors do no work, so the item is effectively a three-way choice.

*After repair,* all four distractors were rebuilt as competing causal explanations. Giveaway stayed at 1.0 — because now the key was the only *general* statement among four *specific* ones, which is just a different cue — and Opus immediately identified (D) ("grid consumption fell because fewer residents lived in the city") as arguably correct, since it *is* an alternative cause. The repair moved the leak, then created an ambiguity.

#### Item 2 — Gemini 3.6 Flash, "Must Be True / Inference", target: medium, history of science

> Prior to the mid-nineteenth century, astronomers calculated planetary orbits using classical mechanics, which assumed space was a complete vacuum. However, when predictions regarding Mercury's orbit consistently deviated from observations, some scientists postulated the existence of an undiscovered planet, Vulcan, whose gravitational pull was thought to cause the discrepancy. Vulcan was never found. In 1915, general relativity resolved the discrepancy by demonstrating that massive bodies like the Sun warp surrounding spacetime, altering orbital paths without requiring additional planets.
>
> **If the statements above are true, which one of the following must also be true on the basis of them?**
>
> (A) Classical mechanics cannot accurately predict the orbital paths of any planets in the solar system.
> (B) The postulation of Vulcan was the first time classical mechanics failed to explain an astronomical observation.
> (C) ✱ At least some orbital deviations that classical mechanics could not account for can be explained without assuming the presence of unobserved planets.
> (D) General relativity entirely replaced classical mechanics for all standard astronomical calculations after the year 1915.
> (E) Mercury is the only planet in the solar system whose orbit is affected by the warping of spacetime near the Sun.

*Battery:* solve 4/4; **giveaway 4/4**.

*My critique.* This is the **quantifier-isolation** failure in its purest form, and it is worth dwelling on because it is the single most mechanical, most detectable, and most common defect I saw. The key is the only choice hedged with "at least some" and "can be." Every distractor carries a universal or superlative: "any," "the first," "entirely… all," "the only." A test-taker who knows nothing about Mercury and has read one LSAT lesson picks (C) in three seconds. One of the blind solvers said exactly that: *"It is the most hedged, moderate claim ('at least some'), consistent with typical must-be-true correct answers, while [the others] contain absolute/extreme [language]."*

Real LSAT Inference items are written to defeat this. LSAC routinely makes two or three choices modestly hedged and puts the discrimination in whether the hedged claim is actually *entailed* — the classic hard Inference item has three "some/may" answers of which exactly one is supported. The model here used hedging as a *marker of correctness* rather than as a property to be distributed.

Secondary defect, caught only by the GPT critic: **the stimulus is factually wrong in a way a science-literate test-taker would notice.** Classical mechanics does not "assume space was a complete vacuum," and Mercury's perihelion precession has nothing to do with a vacuum assumption. LSAC RC/LR stimuli are adapted from real sources precisely to avoid this class of error. This is the "content inaccuracy — 12% of items" failure mode from Section 2.2, showing up on schedule.

*After repair,* all five choices were rewritten into a uniform "Some X that Y were/can be Z" frame. Giveaway halved to 0.5 — the fix worked — but solver agreement collapsed to 0.5 and both critics flagged multiple defensible answers, because new choice (A) ("Some orbital predictions that classical mechanics could not reconcile with observation were resolved without positing an additional planet") is a **near-paraphrase of the key**. It is straightforwardly true on the stimulus. The item is now unscorable.

#### Item 3 — GPT-5.6 Terra, "Parallel Flaw", target: hard, the arts

> Every mural that received the festival's highest award used layered pigments. This year's mural uses layered pigments. Therefore, this year's mural will receive the festival's highest award. The curator adds that the mural's technique has already been praised by several critics, but this praise does not establish that the award judges will select it.
>
> **The flawed reasoning in the argument is most similar to that in which one of the following?**
>
> (A) ✱ Every acclaimed poem in a journal uses ambiguity; a submitted poem uses ambiguity, so it will be acclaimed
> (B) Several admired sculptures use recycled metal; therefore, recycled metal causes sculptures to be admired
> (C) Each panel in a proposed exhibition is innovative; therefore, the exhibition as a whole is innovative
> (D) No painting rejected by the gallery was purchased; this painting was not rejected, so it was purchased
> (E) A composer was praised after revising a symphony; therefore, the revision was praised by every listener

*Battery:* solve 4/4; **giveaway 0.5** (the best-performing generated item on this metric). Opus: revise, register **3/5**. GPT: **reject**, "fatal: multiple defensible answers."

*My critique.* The core logic is right — the stimulus mistakes a necessary condition for a sufficient one, and (A) reproduces it. But three things are wrong.

The **syntactic-mirroring cue**: (A) is the only choice that opens "Every … uses …" and reuses the stimulus's exact "uses [feature]" frame. On Parallel questions this is a well-known LSAC anti-pattern — official Parallel items put all five choices in similar frames so you must actually abstract the logical form.

The **register failure** (Opus rated it 3/5, against 4.58 for real items) is real and instructive. The last sentence — "The curator adds that the mural's technique has already been praised by several critics, but this praise does not establish that the award judges will select it" — is a sentence that pre-empts its own objection. Real LSAC stimuli do not editorialise about their own inferential gaps; they state the argument and leave the gap for you. This sentence exists because the model was told "no extraneous sentences" and interpreted that as "explain yourself." It is a tell.

The **genuine ambiguity**, which GPT flagged as fatal and Opus explicitly denied: (D) is "No painting rejected by the gallery was purchased; this painting was not rejected, so it was purchased" — a **mistaken negation**. Mistaken negation and affirming-the-consequent are both conditional-direction errors, and on a "most similar" stem, a strong student can construct a defence of (D). (A) is *more* similar and I think (A) is defensible as the intended key — but the two critics split on whether the item is fatally flawed, which is exactly the situation where you need a human.

*After repair,* all five choices were forced into an identical "Every X had F; this…; so…" frame. **Giveaway fell to 0.0** — a genuine, complete fix of the leak, and solve stayed at 4/4. But the critic then rejected it, because with all five in the same frame, (C) and (E) became valid inferences of *different* forms and the discrimination now turns on very fine conditional-direction distinctions that arguably admit more than one "most similar" reading. This item is the closest to salvageable of the three, and it would need a human editor for maybe five minutes.

### E.5 Honest limitations of this experiment

- **n = 36** (24 generated, 12 real). Every percentage here has a confidence interval of roughly ±15–20 points. These are directional findings, not estimates.
- **The control is contaminated.** The 12 "real" items are public released LSAT items; models have almost certainly memorised them, which inflates both their solve accuracy and — critically — their giveaway accuracy. The real-vs-generated giveaway gap is therefore a **lower bound**.
- **One generation prompt.** A better prompt (few-shot with real items, explicit negative examples, forced quantifier distribution, item-type-specific templates) would very likely improve v0. I deliberately used a strong-but-generic prompt to see the *default* failure surface. The AAAI field study's iterative loop with good/bad exemplars is the obvious next thing to try and I did not have time.
- **Models are not students.** Giveaway measured on frontier models is a *proxy* for test-wise-student guessability. The direction is right and the READI paper validates the substitution, but the absolute rates would differ with humans.
- **The critics grade partly on the same priors that produced the items.** Cross-family critics mitigate but do not eliminate this.
- **The repair prompt was single-shot and aggressive.** A gentler, multi-round repair with the answer-uniqueness gate *inside* the loop (rather than checked afterwards) would plausibly do much better. The finding "naive repair trades leak for ambiguity" is robust; the finding "repair cannot work" is **not** established.
- **The existing bank has its own data-quality problems.** While sampling the control set I found stimuli in the app's `tasksource`-derived table containing raw HTML fragments (e.g. a stray `</html>`). That is orthogonal to this brief but worth flagging to whoever owns the bank.

---

## 6. Reading Comprehension: the open-licensed-passage path

### 6.1 The specification to hit

Verified current RC format:
- **Four passage sets**, 35 minutes, **26–28 questions total**, 5–8 questions per set.
- **Three or four single passages** of roughly **450–550 words**, and **one or zero** comparative reading sets (two shorter passages together totalling ~450–550 words).
- **Important 2026 change:** until January 2026 every RC section had exactly one comparative set. On the January 2026 LSAT, multiple test-takers reported *no* comparative passage, and LSAC quietly amended its website afterwards. The official description now reads "either 3 or 4 single reading passages, and either one or no comparative reading passages." A generated pool must cover both configurations.
- Subject areas: humanities, social sciences, biological and physical sciences, and law-related topics. LSAC's own description: "densely written, use high-level vocabulary, and contain sophisticated argument or complex rhetorical structure (for example, multiple points of view)."
- Comparative sets specifically test relationships: "generalization/instance, principle/application, or point/counterpoint."

### 6.2 The decisive fact: **LSAC does this exact thing already**

This is the most important discovery in the RC part of this research, and it reframes the whole question.

**LSAT RC passages are not original creations ex nihilo, and they are not verbatim excerpts either. They are LSAC-written adaptations of published third-party works, and LSAC acknowledges the sources in every disclosed test.** The January 2023 LSAT disclosure booklet says, verbatim: *"Acknowledgment is made to the following sources from which material has been adapted for use in this test,"* and then lists, among others:

- Steven Ashley, "It's Not Easy Being Green," *Scientific American* ©2002
- Scott DeVeaux, *The Birth of Bebop*, ©1997 University of California Press
- Freeman J. Dyson, "One in a Million," *New York Review of Books* ©2004
- Geoffrey W. G. Leane, "Testing Some Theories About Law," *Melbourne University Law Review* ©1995
- Michael Shermer, "Freeman Dyson, Miracles, and the Belief in the Paranormal," *eSkeptic* ©2004
- John Timpane, "How to Convince a Reluctant Scientist," *Scientific American* ©1995

And observers who have gone and compared the sources to the passages confirm what "adapted" means in practice: LSAC **paraphrases and restructures** so heavily that almost no source wording survives. One writer compared PrepTest 30 §3 Passage 4 to its source (a May 1994 NYT book review) and found "almost none of the article itself appears in the passage… LSAC basically took parts of the article and paraphrased them with the purpose of making them uninteresting." Another summary of the practice: "adapted means they wrote them themselves."

So the "open-licensed passage + original questions" idea is not a shortcut *around* how the LSAT works. **It is how the LSAT works** — with one substitution: instead of licensing (or fair-using) *Scientific American*, we seed from a corpus that is unambiguously free for commercial reuse.

### 6.3 Why this is much easier than LR, and what it buys

1. **The hardest generative problem disappears.** For LR, the model must invent an argument with a specific, exploitable logical gap — and my experiment shows it does that badly, producing arguments whose gap is so canonical that the answer is predictable from the choices. For RC, the *argumentative substance* is imported from real scholarship written by real experts. The model's job shrinks to (a) compress and neutralise into LSAC register at 450–550 words, and (b) write questions against a text that already exists. Both are far more tractable.
2. **Factual-accuracy errors mostly vanish.** The Section 2.2 "content inaccuracy — 12%" failure mode, which I observed live in the Mercury/Vulcan item, is largely an artefact of the model inventing content. Grounding in a real peer-reviewed source removes most of it.
3. **The grounding check becomes trivially auditable.** The BEA 2026 framework's "grounding" constraint — every component traceable to the source — is directly checkable: require the generator to emit a character span of the passage supporting the key and each distractor's wrongness. A reviewer can verify in seconds.
4. **Difficulty control has a real handle.** Readability and syntactic complexity of the seed text can be measured, and controllable-generation techniques (below) can push toward a target band, because you are *editing* rather than *inventing*.
5. **Topic and viewpoint diversity comes free**, and with it fairness: sampling across four subject areas and multiple author demographics is a corpus-selection decision, not a prompting problem.

### 6.4 Named, verified license-clean corpora

Ranked by how usable each is for a **commercial** product, with the actual license position:

| Corpus | Licence position | Commercial use | Verdict for LSAT RC |
|---|---|---|---|
| **PMC Open Access Subset — `oa_comm` directory** | CC0 / CC BY only (the AWS `oa_comm` bucket is explicitly the commercial-permitted grouping; `oa_noncomm` holds NC licences) | **Yes** | **Best single source for the science passages.** Millions of full-text biomedical/life-science articles. Must retrieve via the sanctioned channels (PMC Cloud Service on S3 `pmc-oa-opendata`, OAI-PMH, FTP, E-Utilities, BioC API) — bulk scraping by other means is prohibited. Note: NLM is moving full-text access from FTP to the Cloud Service in **August 2026**. |
| **U.S. federal government works** | Not copyrightable under 17 U.S.C. §105; public domain in the U.S. | **Yes** | Excellent for **law and public policy**: court opinions, CRS-adjacent material, agency reports, GAO, NIH/NSF/NOAA/USGS reports, Federal Register. Dense, argumentative, formal — the closest natural register to LSAT law-related passages. Caveat: works *commissioned* by the government from contractors may be copyrighted; check per document. |
| **DOAJ journals with CC BY** | CC BY 4.0 — explicitly permits commercial adaptation with attribution | **Yes** | The route to **humanities and social science** passages, which PMC does not cover. DOAJ lets you filter by licence. Requires per-journal verification because DOAJ also indexes NC-licensed journals; and quality varies a lot across the long tail. |
| **Project Gutenberg** | The *text* is public domain; the **"Project Gutenberg" trademark, header and footer are not**. Strip the PG branding and "you are left with a text unrestricted by U.S. intellectual property law." Keep the branding in a commercial product and royalties are owed. | **Yes, if you strip PG branding** | Useful for **humanities/history of ideas**, but the prose is pre-1929 and reads like it. LSAT RC register is modern academic, not Victorian. Use as *subject-matter* seed, not as style seed. ~1% of the collection is donated-and-still-copyrighted — check the footer. Non-U.S. status must be checked separately. |
| **Wikipedia** | CC BY-SA 4.0 | Yes, but **share-alike** | **Avoid as a passage source.** ShareAlike would arguably require licensing derivative passages under CC BY-SA, which is incompatible with a proprietary item bank. Fine as a *research/fact-check* input; not as passage substrate. |
| **arXiv** | **The overwhelming majority use the arXiv perpetual non-exclusive licence, which does *not* grant reuse rights.** Only the CC-licensed minority is reusable, and the licence is per-paper (exposed in OAI-PMH `arXiv`/`arXivRaw` output, not the search API). Papers 1991–2003 have an "assumed licence" equivalent to the non-exclusive one. | **Only for the CC-licensed subset** | Usable *if* you filter strictly on licence via OAI-PMH. Higher effort than PMC for less benefit. Also: arXiv prose is mathematical and technical, further from LSAT register than biomedical review articles. |

**Practical recommendation:** `PMC oa_comm` (science) + U.S. government works (law/policy) + DOAJ CC-BY humanities/social science journals gives full coverage of the four LSAT subject areas with a clean, auditable, per-document licence record. Store the licence, source URL and retrieval date alongside every passage — that provenance record is itself the legal defence.

**A licence-risk note that makes this even safer.** Because the pipeline *rewrites* the seed into a 450–550-word original text in LSAC register (as LSAC itself does), the output is at most an adaptation of factual/ideational content. CC BY permits adaptation outright with attribution; public-domain material permits it unconditionally. The residual risk is not copyright but **accuracy** — misrepresenting a real researcher's findings under a paraphrase. Mitigation: keep the attribution line ("adapted from…"), exactly as LSAC does.

### 6.5 Controllable difficulty for passages

Reality check: readability control is **partially solved and does not saturate at the top end**.
- The **TSAR 2025 shared task** on readability-controlled simplification drew 48 submissions from 20 teams; the winning approaches were "iterative refinement, multi-agent setups, and LLM-as-a-judge pipelines," and the organisers' conclusion was that "dependable and controlled simplification often requires complex, multi-iterative processes" — single-shot prompting is not enough.
- Zero-shot readability control **degrades as the gap between source and target grows**, and CEFR predictors "often misjudge the true difficulty of simplified texts."
- RL-tuned approaches reach ~**89.3% CEFR match rate**, +15.7pp over GPT-3.5, but that is at A1–C1 levels for language learners.

**LSAT RC sits above CEFR C2** — this literature's hardest target is our floor. So do not expect off-the-shelf readability control to deliver "hard LSAT passage." What transfers is the **architecture**: generate → measure with a difficulty critic → re-prompt with the discrepancy → loop up to N times. And for our case the more reliable levers are structural rather than lexical: number of distinct viewpoints in the passage, whether the author's own position is stated or must be inferred, density of qualification, and how much of the passage is devoted to a position the author ultimately rejects. Those are specifiable in a generation spec and checkable by a critic.

### Sources for Section 6

### LSAC — Reading Comprehension (official section description)
- **Citation**: Law School Admission Council, current
- **Link**: https://www.lsac.org/lsat/prepare/types-lsat-questions/reading-comprehension
- **Type**: documentation (primary)
- **Key finding**: Four sets, 5–8 questions each; "either 3 or 4 single reading passages, and either one or no comparative reading passages"; selections "drawn from a wide range of subjects in the humanities, the social sciences, the biological and physical sciences, and areas related to the law"; "densely written, use high-level vocabulary, and contain sophisticated argument or complex rhetorical structure (for example, multiple points of view)"; comparative sets test "generalization/instance, principle/application, or point/counterpoint."
- **Relevance to this pipeline**: The authoritative generation spec for RC. The three named comparative relationships are directly usable as generation templates.
- **Caveats**: LSAC does not publish word counts or a question-type taxonomy, so those come from prep sources.

### The LSAT Quietly Changed The Reading Comprehension Section
- **Citation**: Blueprint Prep LSAT blog, 2026
- **Link**: https://blog.blueprintprep.com/lsat/lsat-changed-the-reading-comprehension-section/
- **Type**: industry
- **Key finding**: On the **January 2026 LSAT** multiple test-takers reported no comparative passage; LSAC amended its website afterwards without advance notice. Comparative reading is now optional per administration (0 or 1).
- **Relevance to this pipeline**: A generated RC pool must include comparative sets but cannot assume exactly one per section. Also a reminder that the spec moves and the pipeline needs a way to re-target.
- **Caveats**: Vendor blog reporting test-taker accounts; the underlying LSAC page change is verifiable and consistent.

### LSAT RC passage length (prep-industry sources)
- **Citation**: LSATScoreCalculator RC Strategy Guide 2025; Greentestprep
- **Link**: https://lsatscorecalculator.com/lsat-reading-comprehension-guide/ ; https://greentestprep.com/easy-lsat-reading-comprehension-practice/
- **Type**: industry
- **Key finding**: Single passages typically **450–550 words**; comparative sets two shorter passages totalling ~450–550 words (~250 each); ~8–9 minutes per set.
- **Relevance to this pipeline**: The target length band. Note this is **450–550**, slightly wider than the "~450–500" in the brief.
- **Caveats**: Two independent vendors agree, but neither is LSAC and neither publishes a measurement methodology. Worth measuring directly against the existing RC bank before fixing the spec.

### January 2023 LSAT Disclosure Booklet — source acknowledgments
- **Citation**: Law School Admission Council, January 2023
- **Link**: https://www.lsac.org/sites/default/files/media/January-2023-LSAT-Disclosure-Booklet.pdf
- **Type**: documentation (primary, and the strongest evidence in this section)
- **Key finding**: LSAC states in its own disclosed test booklet: *"Acknowledgment is made to the following sources from which material has been adapted for use in this test"* and lists six third-party copyrighted works (*Scientific American* ×2, University of California Press, *New York Review of Books*, *Melbourne University Law Review*, *eSkeptic*). Also confirms "Passage A is adapted from a book review by physicist Freeman Dyson. Passage B is adapted from a response to the review" — i.e. comparative sets are built by pairing a real published exchange.
- **Relevance to this pipeline**: **Direct precedent from the test sponsor for the entire RC shortcut.** It also reveals a concrete comparative-set recipe: find a published point/counterpoint exchange (a review and its response, two papers disputing a finding) and adapt both sides. Open-access journals with published comment/reply pairs are ideal for this, and PMC is full of them.
- **Caveats**: LSAC presumably clears permissions or relies on the adaptation being transformative; we cannot see their agreements. Our version removes that uncertainty by seeding only from CC BY / public-domain material.

### Is the LSAT Based in Reality? (analysis of RC source adaptation)
- **Citation**: LSATHacks
- **Link**: https://lsathacks.com/is-lsat-real/
- **Type**: industry (practitioner analysis)
- **Key finding**: "LSAC writes its own RC passages… The [acknowledgment] says that LSAC *adapted* the articles from the sources. Adapted means they wrote them themselves." Documents cases where LSAC's adaptation preserves a source's dubious claims (the dowsing passage from PrepTest 81, summarised from a pseudoscience journal, presents dowsing as real).
- **Relevance to this pipeline**: Clarifies that "adapted" = substantially rewritten, not excerpted — which is both the legal safety margin and the register-control mechanism. The dowsing example also establishes useful precedent that a passage need not be *true*, only internally coherent and faithfully questioned.
- **Caveats**: Commercial prep site; the source-comparison analysis is not systematic.

### "The Truth About Reading Comp" (source-vs-passage comparison)
- **Citation**: LSAT Blog, 2009
- **Link**: https://lsatblog.blogspot.com/2009/07/newer-lsat-reading-comp-tips-and-truth.html
- **Type**: industry (practitioner analysis)
- **Key finding**: Direct comparison of PrepTest 30 §3 Passage 4 against its acknowledged source (a May 8, 1994 NYT book review): "almost none of the article itself appears in the passage, and I had difficulty finding any direct quotes. LSAC basically took parts of the article and paraphrased them with the purpose of making them uninteresting." Also notes RC passages are "structured like big Logical Reasoning stimuli."
- **Relevance to this pipeline**: Confirms the degree of rewriting empirically, and gives the single most useful stylistic instruction for the passage-rewriting prompt: **flatten the rhetoric, remove the journalism, preserve the argumentative structure.**
- **Caveats**: 2009, one passage, one analyst. Older test form.

### PMC Open Access Subset & AWS access documentation
- **Citation**: U.S. National Library of Medicine / NCBI
- **Link**: https://pmc.ncbi.nlm.nih.gov/tools/openftlist/ ; https://pmc.ncbi.nlm.nih.gov/tools/pmcaws/ ; https://registry.opendata.aws/ncbi-pmc/
- **Type**: documentation (primary)
- **Key finding**: The OA Subset is split into three licence groupings. **"For commercial usage, you are limited to the articles in the `oa_comm` directory which includes articles licensed under CC BY and CC0 licenses"** plus the `phe_timebound` COVID collection. Bulk retrieval is permitted **only** via PMC Cloud Service (S3 `pmc-oa-opendata`), OAI-PMH, FTP, E-Utilities or BioC API; any other automated systematic retrieval is prohibited. Articles supplied as JATS XML, plain text and PDF with JSON metadata and a CSV inventory. NLM is moving full-text file access from FTP to the Cloud Service in **August 2026**.
- **Relevance to this pipeline**: The single best license-clean scientific corpus, with machine-readable per-article licence codes so the provenance record can be generated automatically. `oa_comm` is a directory-level guarantee, not a per-article judgement call — that is exactly what a small team wants.
- **Caveats**: Biomedical/life sciences only. NLM warns license terms vary and users are "directly and solely responsible for compliance." The FTP→Cloud migration lands this month, so build against the Cloud Service.

### Project Gutenberg licence and permissions policy
- **Citation**: Project Gutenberg Literary Archive Foundation
- **Link**: https://www.gutenberg.org/policy/license.html ; https://www.gutenberg.org/policy/permission.html
- **Type**: documentation (primary)
- **Key finding**: "If you strip the Project Gutenberg license and all references to Project Gutenberg from the text, you are left with a text unrestricted by U.S. intellectual property law." The trademark, header and footer are *not* public domain; commercial use trading on the PG name requires royalties (pro-rated by proportion of PG-sourced items). ~1% of the collection is donated copyrighted work with additional terms in the footer. Non-U.S. status must be checked by the user.
- **Relevance to this pipeline**: Establishes that Gutenberg is genuinely usable commercially provided you strip branding — and that PG explicitly cannot and does not grant permission for public-domain works because nobody can.
- **Caveats**: U.S.-centric; the 1% donated-copyright subset must be filtered out via the footer. Prose register is a poor stylistic match for the modern LSAT.

### arXiv permissions and reuse
- **Citation**: arXiv (Cornell)
- **Link**: https://info.arxiv.org/help/license/reuse.html
- **Type**: documentation (primary)
- **Key finding**: "All e-prints submitted to arXiv are subject to copyright protections. arXiv is not the copyright holder." **"The overwhelming majority of e-prints are submitted using the arXiv perpetual non-exclusive license, which does not grant further reuse permissions directly."** CC-licensed papers are the exception; the licence is exposed in OAI-PMH output but **not** in the search API schema. 1991–2003 papers have an assumed non-exclusive licence.
- **Relevance to this pipeline**: Important negative finding. **arXiv is not a license-clean corpus by default** — a common misconception. Only the explicitly CC-licensed subset is usable, and you must go through OAI-PMH to know which.
- **Caveats**: None material; this is the primary source.

### DOAJ / CC BY open-access humanities and social science journals
- **Citation**: Directory of Open Access Journals; representative journal policies
- **Link**: https://doaj.org/ ; e.g. https://jananexushst.com/licensing-and-copyright/
- **Type**: documentation (primary, per-journal)
- **Key finding**: DOAJ indexes journals by licence; CC BY 4.0 journals explicitly permit "Remixing, transforming, and building upon the material for any purpose, **including commercial use**," subject to attribution.
- **Relevance to this pipeline**: The route to humanities/social-science passages, which PMC cannot supply.
- **Caveats**: **Quality is highly variable in the long tail of DOAJ**, and some indexed journals are weak or predatory. Filter on both licence *and* indexing (Scopus/Web of Science) before using as a seed. Also requires per-journal licence verification rather than a directory-level guarantee like PMC's `oa_comm`.

### Findings of the TSAR 2025 Shared Task on Readability-Controlled Text Simplification
- **Citation**: TSAR workshop, 2025
- **Link**: https://aclanthology.org/2025.tsar-1.8.pdf
- **Type**: peer-reviewed (workshop)
- **Key finding**: 48 submissions from 20 teams, simplifying English text to target CEFR levels. Winning approaches used "iterative refinement, multi-agent setups, and LLM-as-a-judge pipelines." Conclusion: "dependable and controlled simplification often requires complex, multi-iterative processes," and current systems are beginning to saturate the automatic evaluation metrics.
- **Relevance to this pipeline**: Confirms the iterate-with-a-critic architecture for hitting a text-difficulty target, and warns that the automatic difficulty metrics are themselves not trustworthy at the top end.
- **Caveats**: Targets are A1–B1 (simplification *downwards*); LSAT needs control at and above C2. The direction of the task is opposite to ours.

### Analysing Zero-Shot Readability-Controlled Sentence Simplification
- **Citation**: COLING 2025
- **Link**: https://aclanthology.org/2025.coling-main.452.pdf
- **Type**: peer-reviewed
- **Key finding**: LLMs struggle with readability control, "especially when there is a large gap between source and target readability levels." Adding CEFR descriptions and example sentences helps but "not uniformly." **CEFR predictors often misjudge the true difficulty** of rewritten texts.
- **Relevance to this pipeline**: The measurement side is as weak as the generation side. Do not build an RC difficulty gate on an automated readability classifier alone.
- **Caveats**: Sentence-level, not passage-level; ESL learners, not LSAT candidates.

### From Tarzan to Tolkien: Controlling the Language Proficiency Level of LLMs
- **Citation**: Findings of ACL 2024
- **Link**: https://aclanthology.org/2024.findings-acl.926.pdf
- **Type**: peer-reviewed
- **Key finding**: Systematic comparison of proficiency-control strategies: bare instruction < include official CEFR level descriptions < include an expert-written exemplar at the target level (few-shot). Each step costs more tokens and buys more control.
- **Relevance to this pipeline**: Directly actionable — **the exemplar is what matters**. For LSAT this means the passage-rewriting prompt should carry one or two real LSAT-style passages as style targets, not just an instruction to "write at LSAT level."
- **Caveats**: CEFR/proficiency framing; does not test at LSAT register.

### RL-tuned CEFR-aligned ESL material generation
- **Citation**: *Discover Artificial Intelligence*, 2025
- **Link**: https://link.springer.com/article/10.1007/s44163-025-00762-3
- **Type**: peer-reviewed
- **Key finding**: RL fine-tuning with CEFR feature extraction and multi-objective reward shaping reaches **89.3% CEFR match rate**, +15.7pp over GPT-3.5, and reduces misalignment errors by 15.6%; largest gains at B2–C1.
- **Relevance to this pipeline**: Sets the ceiling for what fine-tuned difficulty control achieves — high but not exact, at levels below ours. Confirms this is a v3 technique at best for a small team.
- **Caveats**: ESL levels, not LSAT; single-paper result; the training pipeline is well beyond a small team's budget.

### Transformer-enhanced hierarchical encoding for RC distractors (THE-MD)
- Cross-referenced from Section 3 — its diagnosis of RC-distractor failure modes (off-topic and mutually-redundant distractors) applies directly here.

---

## 7. Predicting item difficulty before field testing

**Short answer: from item text alone, this barely works, and you should not build a plan that depends on it.**

The cleanest evidence is the **BEA 2024 Shared Task** on predicting difficulty and response time for retired USMLE items. Across **17 submitting teams (48 registered)**:

| System | Difficulty RMSE |
|---|---|
| EduTec (ELECTRA) — 1st place | **0.299** |
| UPN — 2nd | 0.303 |
| EduTec (RoBERTa) — 3rd | 0.304 |
| ITEC (RandomForest) — 4th | 0.305 |
| **DummyRegressor baseline** | **0.31** |
| DeBERTa-v3 | 0.31 |

The winner beat "always predict the mean" by **0.011 RMSE**. Correlation with true difficulty for the top system was r = 0.27, Spearman 0.25. The organisers' own summary: "predicting item difficulty remains a highly challenging task, with the best results surpassing the DummyRegressor baseline by a minimal margin."

By contrast **response time** prediction worked well (best 23.9 vs dummy 31.7 RMSE; RoBERTa r = 0.60), which tells you something real: *how long an item takes* is legible from its text; *how many people get it wrong* is not.

Follow-up work does improve on this. Fine-tuned small models (BERT/RoBERTa) with **augmentation-on-the-fly and distribution balancing** beat the BEA first-place model; majority voting across SLMs helps further. But notably, **GPT-4 struggled with difficulty prediction** despite strong general ability, and **chain-of-thought prompting and rationale generation did not substantially help**. Embedding methods (NV-Embed-v2) showed promise but did not beat the augmentation strategies.

**Consequences for us.**
1. **Do not promise a difficulty-balanced pool at launch.** You cannot get it from text.
2. **Do use difficulty prediction as a coarse 3-bin sorter**, not as a calibrated parameter. Even r ≈ 0.3 is enough to sort easy/medium/hard better than chance, and a prep product's UX needs bins, not θ values.
3. **The best pre-field-test difficulty signal available to us is probably a *handicapped solver ensemble*, not a text model.** The perfect-LSAT-score paper shows 7–8B distilled models score 53–63% on LSAT — roughly where a mid-band human sits. A panel of such models, sampled multiple times at temperature, gives a per-item empirical accuracy that plausibly tracks human difficulty far better than a regression on text features. **I did not test this** and it is the highest-value cheap experiment left undone; it would take about a day.
4. **Real response data solves this immediately and we will have it.** An LSAT prep app with even a few hundred active users generates hundreds of responses per item within weeks. That is the same instrument LSAC uses. See Section H.

### Sources for Section 7

### BEA 2024 Shared Task on Automated Prediction of Item Difficulty and Response Time
- **Citation**: SIGEDU / BEA 2024 (Yaneva, V., et al.)
- **Link**: https://sig-edu.org/sharedtask/2024
- **Type**: peer-reviewed (shared task report)
- **Key finding**: 48 teams registered, 17 submitted. Best difficulty RMSE **0.299** vs DummyRegressor **0.31**. Best response-time RMSE 23.927 vs dummy 31.68. Organisers: difficulty prediction "remains a highly challenging task… surpassing the DummyRegressor baseline by a minimal margin."
- **Relevance to this pipeline**: The definitive negative result on text-only difficulty prediction, on retired USMLE items with real calibrated difficulties. Kills any plan that requires accurate a-priori difficulty.
- **Caveats**: USMLE clinical vignettes, not reasoning items. It is *possible* LSAT difficulty is more text-legible (it depends less on background knowledge), but there is no published evidence either way.

### Predicting Item Difficulty and Response Time with Scalar-mixed Transformer Encoders (EduTec, 1st place)
- **Citation**: BEA 2024 workshop
- **Link**: https://aclanthology.org/2024.bea-1.40.pdf
- **Type**: peer-reviewed (workshop)
- **Key finding**: ELECTRA: RMSE 0.29, MAE 0.24, **r = 0.27, Spearman 0.25** — 1st of 43 for difficulty. Same architecture placed 5th of 34 on response time with r = 0.60, Spearman 0.67. DeBERTa-v3 did not beat the dummy.
- **Relevance to this pipeline**: Quantifies exactly how weak the signal is (r ≈ 0.27) and confirms the difficulty/response-time asymmetry.
- **Caveats**: Workshop paper; cross-validation on the training set for model selection.

### Item Difficulty Modeling Using Fine-tuned Small and Large Language Models
- **Citation**: 2025 (PMC12230038)
- **Link**: https://pmc.ncbi.nlm.nih.gov/articles/PMC12230038/
- **Type**: peer-reviewed
- **Key finding**: Augmentation-on-the-fly + distribution balancing let fine-tuned **BERT/RoBERTa beat the BEA 2024 first-place model**. Majority voting across SLMs improved further. Domain-specific models (BioClinicalBERT, PubMedBERT) did *not* help due to distributional gaps. **GPT-4 "struggled with item difficulty prediction"**; CoT prompting and rationale generation "did not yield substantial improvements." Embedding methods (NV-Embed-v2) promising but not best.
- **Relevance to this pipeline**: Establishes the current ceiling and, more usefully, tells us what *not* to build: don't expect a frontier LLM prompted for a difficulty rating to work. If we build a difficulty model at all, it should be a small fine-tuned encoder over our own response data.
- **Caveats**: Same USMLE dataset; improvements are still modest in absolute terms.

### UnibucLLM and LLM-based difficulty/response-time pipelines
- **Citation**: BEA 2024 workshop papers
- **Link**: https://aclanthology.org/2024.bea-1.41.pdf ; https://aclanthology.org/2024.bea-1.49.pdf
- **Type**: peer-reviewed (workshop)
- **Key finding**: Augmenting the dataset with **zero-shot LLM answers** to the items improved difficulty prediction — top models "consistently include the question text, and benefit from the variability of LLM answers." A separate system using NER + semantic role labelling + linguistic features achieved RMSE 0.308 difficulty / 27.474 response time.
- **Relevance to this pipeline**: The "variability of LLM answers" finding is the most interesting hint in this whole section, and it points the same way as my Section 7 recommendation: **disagreement among model responses is a difficulty signal**. That is cheap to compute and I would test it first.
- **Caveats**: Small margins; the effect was found on USMLE items with 2023-era models that were *not* at ceiling. With frontier models at ceiling on LSAT, the variability must be induced deliberately (weaker models, temperature, truncated reasoning).

---

## 8. Cost and throughput

**The headline: compute is free and labour is not.** I measured the compute directly rather than estimating it, which makes this section unusually solid.

### 8.1 Measured compute cost

From the Section E experiment, at real August-2026 gateway prices, mixing Claude Opus 4.8 / GPT-5.6 Terra / Gemini 3.6 Flash for generation and four solvers + two critics for validation:

| | Value |
|---|---|
| Full battery per item | 10 model calls (4 solve + 4 giveaway + 2 critique) |
| Phase 1: 36 items, 283 calls, 264k tokens | **$2.21**, 180 s wall-clock at 6-way concurrency |
| Phase 2 (repair + full re-validation, 24 items) | $2.82 |
| **All-in per candidate item** (generate + validate + repair + re-validate) | **≈ $0.21** |
| Throughput | 24 items through the full loop in **< 10 minutes** |

Scaling that, and adding an RC path where each passage supports ~6 questions (so the passage-generation cost amortises):

| Pool | LR items | RC sets (×6 Q) | Compute at $0.21/candidate, at the measured 8% joint-gate pass rate | Compute if a tuned pipeline reaches 30% |
|---|---|---|---|---|
| **500 shipped** | 350 | 25 sets / 150 Q | ~$920 | ~$245 |
| **2,000 shipped** | 1,400 | 100 sets / 600 Q | ~$3,700 | ~$980 |
| **5,000 shipped** | 3,500 | 250 sets / 1,500 Q | ~$9,200 | ~$2,450 |

Even the pessimistic column is a rounding error against a single engineer-month. **Do not optimise the token spend.** Use the most capable models available for generation and criticism; the marginal cost of Opus-tier generation over Flash-tier is a few thousand dollars at 5,000 items, and my data shows model choice materially affects defect rates.

Wall-clock at 6-way concurrency is roughly **2.5 items/minute** through the full loop, so 5,000 candidates ≈ 33 hours of unattended running, or a couple of hours at higher concurrency. **Generation throughput is not a constraint on any timeline that matters.**

### 8.2 Human review cost — the real number

Three anchors:

1. **LSAC's own item writers.** LSAC's posted Test Specialist role — "writing, review, and revision of questions designed to assess informal reasoning and deductive reasoning skills" — requires "an MA and doctoral-level work in philosophy, theoretical linguistics, literature, or some related discipline," with "a PhD preferred," at **$65,000/year or more**. A more recent Test Developer posting is **$75,000–$80,000**. Loaded (benefits, overhead) that is roughly **$45–55/hour**.
2. **What published pipelines actually staff.** None of the studies in Sections 1–2 report per-item review time, which is itself telling. What they do report is that review is universal: the AAAI 2026 field study had domain experts review every generated item, and template-AIG at NBME requires content-expert review of the item model *plus* review of generated output. Template AIG gets a speed advantage LSAT LR cannot have — a template with a verified key means review is accept/reject triage, whereas an open-generated LR item requires re-deriving the logic from scratch.
3. **What my experiment implies.** Three of the three items I critiqued in depth needed substantive editorial intervention, and the one closest to shippable ("Item 3") would need roughly five minutes of skilled editing plus a re-run of the battery. Realistic rate for a qualified reviewer doing **real LR editing**, not triage: **6–12 items/hour**.

That gives:

| Review mode | Rate | Cost/item at $50/hr loaded |
|---|---|---|
| Accept/reject triage of pre-filtered items | 30–60/hr | **$0.85–$1.70** |
| Substantive edit-to-ship | 6–12/hr | **$4–$8** |
| Write from scratch (LSAC-equivalent) | ~1–2/hr incl. review cycles | $25–$50 |

**Full-pool human cost, assuming every shipped item gets a substantive human pass and rejects get triage:**

| Pool | Human hours | Human $ | Compute $ | **Total** |
|---|---|---|---|---|
| 500 | ~75 | ~$3,800 | ~$900 | **~$4,700** |
| 2,000 | ~300 | ~$15,000 | ~$3,700 | **~$18,700** |
| 5,000 | ~750 | ~$37,500 | ~$9,200 | **~$46,700** |

**Human review is 75–80% of the cost at every scale.** That is the single most important number in this document for planning purposes, and it inverts the intuition that this is an AI-compute problem.

### 8.3 The minimum viable human-in-the-loop rate

The published guidance is unanimous and clear:
- Kıyak & Emekli's ChatGPT-AIG protocol requires **100% expert review** and states explicitly that AI "should be seen as a *co-pilot* rather than an autopilot."
- The AAAI 2026 field study, the largest real deployment, had **domain experts review every generated item** before any student saw it.
- NBME's production practice: AIG items enter the pool only after human review *and* field-testing as unscored items.

**No published methodology permits shipping unreviewed AI-generated items into a scored context.** My own results give the mechanistic reason: 79% of generated items were solvable blind by all four frontier models, and the two frontier critics agreed on a verdict only 53% of the time — automated QC is a filter, not a gate.

Practical minimum for a *prep product* (lower stakes than a scored exam):
- **100% human review of every item that ships**, at triage-or-edit depth.
- Automated gates first, so the human sees maybe 1 in 4 candidates — that is where the compute spend earns its keep.
- **A defensible fallback if 100% is unaffordable:** ship unreviewed items only into an explicitly-labelled "AI drill" surface that is excluded from score prediction and from any timed section that claims to simulate the test. Reviewed items only in anything that looks like a PrepTest. This preserves the product's honesty and is what the market leaders effectively do (Section 9).

### Sources for Section 8

### LSAC Test Specialist / Test Developer job postings
- **Citation**: Law School Admission Council, via PhilJobs:JFP and Hirequill
- **Link**: https://philjobs.org/job/show/3537 ; https://philjobs.org/job/show/31041
- **Type**: industry (primary — employer postings)
- **Key finding**: Test Specialists "develop high-quality questions for the LSAT that are sensitive to the diversity of the LSAT population… writing, review, and revision of questions designed to assess informal reasoning and deductive reasoning skills." Requires "an MA and doctoral-level work in philosophy, theoretical linguistics, literature, or some related discipline"; "a PhD is preferred." **Salary $65,000/yr or more**; the Test Developer posting states **$75,000–$80,000**. Test Developers also do "scored and unscored section assembly and review, and post-administration review."
- **Relevance to this pipeline**: Anchors the human-review cost, and tells us the *qualification profile* to hire against — philosophy/linguistics graduate training, not "LSAT tutor." Also confirms from the employer side that LSAC runs unscored sections and post-administration item review, i.e. the field-testing loop in Section 4.
- **Caveats**: Full-time salaried roles doing much more than item writing, so per-item cost must be inferred. One posting is undated/expired.

### LSAC — Official LSAT Content Licensing (fee schedule)
- **Citation**: Law School Admission Council, current
- **Link**: https://www.lsac.org/contact/official-lsat-content-licensing
- **Type**: documentation (primary)
- **Key finding**: LSAC publicly lists licensing tiers: **Coaching integration — $38 per student** ($19 for nonprofits offering free prep), giving use of official questions and disclosed tests plus a link to LawHub's authentic interface; **Public Marketing — $5,000/year** for one full test (June 2007) plus selected PrepTest 65 questions; **Book Publishing — fees based on item/test usage**. Student-side, LawHub Advantage is **$115–$124/year** for 50–80+ PrepTests.
- **Relevance to this pipeline**: **This is the number the whole build-vs-license decision turns on.** At $38/student, a licensed official bank costs less per user than most SaaS line items, and it is the *same content students consider authoritative*. Any generation programme must be justified against $38/student, not against "unavailable."
- **Caveats**: The posted $38 is a headline rate; actual terms, minimums, and approval criteria are negotiated (contact licensing@LSAC.org) and LSAC can and does terminate licences (see *LSAC v. Tatro*). It also presupposes LSAC will license to you at all.

### LSAC, Inc. v. Tatro, 153 F. Supp. 3d 714 (E.D. Pa. 2015)
- **Citation**: U.S. District Court, Eastern District of Pennsylvania, 2015
- **Link**: https://case-law.vlex.com/vid/law-sch-admission-council-894786702
- **Type**: peer-reviewed equivalent (primary legal source)
- **Key finding**: The court records that LSAC "owns all copyrights for each of the LSAT tests it creates," covering "not only the exam questions but the instructions, answers, answer keys, and materials," and that LSAC "grants royalty-bearing licenses to test-preparation companies." LSAC terminated Cambridge LSAT's licence in 2015 and sued over distribution format (materials downloadable and printable without restriction).
- **Relevance to this pipeline**: Two things. (1) Confirms the copyright position over the material the current bank is derived from — relevant to why this workstream exists. (2) **Licence termination is a real risk**, which is the strongest business argument for having an original-item capability even if licensing succeeds: it is insurance against single-supplier dependency.
- **Caveats**: 2015 district-court procedural posture; not a merits ruling on generation of *original* items, which is a different question entirely.

---

## 9. How competitors actually do it

The research here produced a clear and slightly deflating answer.

**Finding 1: The established prep companies do not write original LSAT items as their primary bank. They license LSAC's.** 7Sage, Blueprint, Kaplan, Princeton Review, Manhattan Prep and PowerScore all build on official content — Blueprint advertises "over 6,000 real LSAT questions" and "57 official practice exams" with "Integrated LawHub"; Manhattan Prep bundles "six official PrepTests"; 7Sage "includes every released LSAT PrepTest" and integrates with LawHub. Their differentiation is **curriculum, analytics, explanations, scheduling and instruction** — not item supply. This is the market's revealed answer to "should we write our own items": mostly, no.

**Finding 2: The one category that does write originals is the AI-native entrants, and they explicitly position originals as a *supplement*, not a substitute.** LSAT Crusher (launched into the 2026 market, Claude-powered, $29/mo) claims **2,178 expert-calibrated original items across all 16 LR and 11 RC types with IRT difficulty** — and answers its own FAQ "Can this replace LawHub?" with: *"No — and they're not trying to be. Use LawHub Advantage ($120/yr) for the 80+ official PrepTests. Use LSAT Crusher for what LawHub doesn't do: an AI tutor that explains your wrong answers, adaptive drills targeting your specific weaknesses."* Others (InfinityMock, PDFQuiz, StudyPDF, Cramberry) generate items on demand from user-uploaded materials, mostly free or near-free, with no visible QC claim. Note that InfinityMock still advertises **Analytical Reasoning**, two years after its removal — a useful signal of how much care goes into this tier.

**Finding 3: Student sentiment is the binding constraint, and it is consistent.** The community consensus is that AI-generated items are a reasonable **supplement for pattern reinforcement and drilling volume**, but not a replacement for official PrepTests, and specifically not for **score prediction or timed simulation**. Even the vendors selling originals concede this in their own marketing. The r/LSAT norm of treating official PrepTests as the only trustworthy measurement instrument is deeply entrenched, and a product that claimed otherwise would be attacked on it.

**What this means strategically.** The realistic target for a generated bank is not "replace LawHub." It is:
- **unlimited type-targeted drilling** (the thing a fixed bank cannot do, and the thing students actually run out of);
- **fresh items for a student who has burned through the official bank** — a real and common problem for high scorers;
- **explanation-rich practice** where the item ships with its own trap taxonomy already annotated (which generated items get for free and official items do not).

Positioned that way, an 85%-quality item is genuinely useful. Positioned as "practice test," it is not.

### Sources for Section 9

### Prep-market surveys (7Sage / Blueprint / Kaplan / Manhattan / PowerScore)
- **Citation**: PracticeTestGeeks 2026; Pass4Sure 2025; Miami Herald (sponsored) 2025; Zipdo 2026
- **Link**: https://practicetestgeeks.com/lsat/online-courses ; https://pass4-sure.us/standardized-tests/online-prep-courses/best-lsat-prep-courses-2025 ; https://www.miamiherald.com/careers-education/blueprint-vs-7sage-lsat/
- **Type**: industry (review aggregators, some affiliate-driven)
- **Key finding**: Every major provider's question supply is **licensed official LSAT content via LawHub**: Blueprint "over 6,000 real LSAT questions… 57 official practice exams… Integrated LawHub"; 7Sage "includes every released LSAT PrepTest"; Manhattan Prep "six official PrepTests are included." Differentiation is on curriculum depth, adaptivity, analytics and instruction. 7Sage Core is $799.
- **Relevance to this pipeline**: The competitive baseline. If the incumbents all license, the market's expectation of "practice question" is *an official question*, and an original bank is competing against that reference point in the student's mind.
- **Caveats**: These are affiliate-monetised review sites with promotional language; treat rankings as noise but the licensing/LawHub facts are consistent across all of them and match LSAC's own licensee documentation.

### LSAT Crusher (AI-native competitor with an original bank)
- **Citation**: lsatcrusher.io, 2026
- **Link**: https://lsatcrusher.io/
- **Type**: industry (vendor marketing)
- **Key finding**: Claims **2,178 "expert-calibrated originals" across all 16 LR and 11 RC types with IRT difficulty**, Claude-powered, $29/mo, correctly targets the post-Aug-2024 format. Explicitly positions *against* replacing official content: "No — and they're not trying to be. Use LawHub Advantage ($120/yr) for the 80+ official PrepTests."
- **Relevance to this pipeline**: The closest direct analogue to what is being contemplated here, and the most useful competitive datapoint in this section. **Pool size ~2,178 is achievable and is being achieved.** Their positioning — originals for drilling, official for measurement — is the honest positioning and is probably the right one to copy.
- **Caveats**: All claims are unverified vendor marketing. "Expert-calibrated… with IRT difficulty" is a strong claim that would require thousands of student responses per item to be literally true; more likely these are predicted or heuristic difficulty labels. No public QC methodology.

### On-demand AI item generators (InfinityMock, PDFQuiz, StudyPDF, Cramberry)
- **Citation**: vendor sites, 2026
- **Link**: https://infinitymock.com/exam/lsat ; https://pdfquiz.com/lsat-practice-test ; https://studypdf.net/use-cases/lsat-practice-questions ; https://www.cramberry.study/lsat-prep
- **Type**: industry (vendor marketing)
- **Key finding**: A tier of free/freemium tools generating "unlimited" LSAT items, typically from user-uploaded prep materials. No QC methodology disclosed by any of them. **InfinityMock still advertises Analytical Reasoning practice** and "questions match the latest 2026 LSAT exam pattern" simultaneously — two years after AR was removed.
- **Relevance to this pipeline**: Establishes the low-quality floor of this market and, usefully, how easy it is to be visibly better than it: get the format right, publish the QC process, and label AI items honestly. Also a warning that "unlimited AI questions" is already a commoditised, near-zero-price claim — it is not a differentiator on its own.
- **Caveats**: Marketing pages only; no way to assess actual output quality without subscribing.

---

## 10. The quality bar

Synthesising Sections 1–9 and the experiment, an item is defensible in a commercial LSAT prep product when it clears **four gates**. The framing that matters: the bar is not "indistinguishable from LSAC," it is **"no student ever loses a point of real-world score because they learned something false from this item, and no student can reasonably post it on r/LSAT as broken."**

**Gate 1 — Correctness (absolute, non-negotiable).** Exactly one defensible answer. Operationally: unanimous agreement across ≥3 independent frontier solvers *and* neither cross-family critic able to construct a defence of a non-keyed choice *and* human confirmation. My data: this alone kills a large fraction — post-repair, 63% of items had a critic-constructible alternative answer.

**Gate 2 — Non-guessability (relative, calibrated to real items).** The item must not be solvable from stem + choices alone. **Set the threshold from the real-item distribution, not absolutely** — my real-LSAT control had a median blind-solve rate of 0.25 with a long tail up to 1.0, so an absolute gate at 0.5 rejects a third of genuine LSAC items. Proposed gate: **blind-solve rate ≤ the 75th percentile of a real-item reference sample**, measured on the same solver panel.

**Gate 3 — Register and construct fidelity.** Stimulus length within the real-item distribution (my generated items averaged 53 words vs 70 real — a measurable, fixable gap); no key-is-longest bias beyond chance (71% generated vs 50% real vs 20% chance); no quantifier isolation on the key; canonical LSAC stem phrasing; no self-commenting sentences. **Every one of these is a computable statistic over the existing 6,886-item bank**, which makes the existing bank valuable as a *reference distribution* even if it is legally unusable as content — an important and non-obvious point.

**Gate 4 — Empirical performance (post-launch, the only one that actually proves anything).** Once seeded to students: **p-value 0.25–0.90**, **point-biserial / item-total correlation ≥ 0.20** (the conventional floor; ≥0.30 good), no distractor chosen by <5% of examinees who miss the item, and no distractor with a *positive* correlation with total score. Items failing r_pb ≥ 0.20 get pulled regardless of how good they look.

**How you know you've hit it.** Two measurements, both cheap:
1. **A blind discrimination study.** Show 20 generated and 20 real items, unlabelled and interleaved, to 5–10 experienced LSAT tutors; ask them to label each as official or original and to rate quality 1–5. If tutors classify at ≈50% (chance) you are done. If they classify at 80%, ask them *what tipped them off* — that is your defect list for the next iteration. This costs a few hundred dollars and is the single highest-value evaluation available.
2. **Head-to-head item statistics in-product.** Once both generated and official-derived items are being answered by real users, compare the p-value and point-biserial *distributions*. If the generated pool's discrimination distribution is indistinguishable from the official pool's, the items work — that is the same evidence NBME accepted for AIG.

**What the bar is not.** It is not "a frontier model can solve it" (models are at 97–100%, the filter is vacuous as an acceptance test). It is not "an LLM judge said ship" (two frontier critics with an identical rubric agreed 53% of the time). And it is not "it looks like an LSAT question," because my generated items *did* look like LSAT questions and 79% of them announced their answers.

---

# A concrete, buildable item-generation pipeline

Two tracks, because **RC and LR are different problems with very different difficulty**. Build RC first: it is easier, safer, and produces 5–8 items per unit of work.

## Track A — Reading Comprehension (the one that will work)

```
[0] CORPUS INTAKE
    PMC oa_comm (science) · US federal works (law/policy) · DOAJ CC-BY (humanities/social science)
    → store per-document: licence code, source URL, retrieval date, title, author
    → REJECT: anything not CC0 / CC BY / US-gov PD. No arXiv default licence. No Wikipedia (ShareAlike).

[1] SEED SELECTION
    Filter for: argumentative structure, ≥2 identifiable viewpoints, 1500–6000 source words,
    no heavy maths/figures dependency, publication date spread, topic quota across 4 subject areas.
    → REJECT ~70% of the corpus. Cheap: a classifier prompt at Flash-tier prices.

[2] PASSAGE ADAPTATION  (this is literally what LSAC does — see the Jan 2023 disclosure booklet)
    Rewrite to 450–550 words in LSAC register. Few-shot with 2 real passages as style exemplars
    (per "From Tarzan to Tolkien": exemplars beat instructions).
    Flatten journalism, preserve argument, keep the author's stance recoverable but not announced.
    Emit: passage + a structural map (main point, author stance, viewpoints, paragraph functions).
    For comparative sets: seed from a published exchange (article + reply); PMC has many.

[3] PASSAGE GATES (automated)
    · word count 450–550
    · faithfulness check: cross-family model compares passage to source, flags misrepresentation
    · no verbatim span >12 words from source (n-gram overlap check — cheap, decisive)
    · viewpoint count ≥2; author stance recoverable
    → REJECT ~20%.

[4] QUESTION GENERATION  (5–8 per passage, type quota: main point / author's attitude /
    inference / function / detail / analogy / strengthen-weaken-on-passage / comparative-relationship)
    REQUIRE per question: credited answer + character span in the passage justifying it,
    + per distractor a named trap + the span it misreads (or "no span — out of scope").
    Grounding is the whole advantage of this track; enforce it structurally.

[5] ITEM GATES — the same battery as Track B steps [2]–[5] below
    (structural filters → giveaway → solvability → adversarial critique),
    with the giveaway test run as "stem + choices, passage withheld".

[6] HUMAN REVIEW — set-level, ~10 min per passage set (6 items) = ~$8/set, ~$1.40/item.
```

**Why this works and LR doesn't:** the argumentative substance is imported from real experts, so the model never has to invent a reasoning gap. Expected yield after all gates: **I'd forecast 50–70% of question-attempts surviving**, versus 8% measured for LR — but note I did **not** empirically test the RC track, so that is an informed projection, not a measurement. It is the first thing I would test.

## Track B — Logical Reasoning (the hard one)

```
[0] REFERENCE DISTRIBUTION  ← build this first, it costs one afternoon
    Compute over the existing 6,886-item bank: stimulus word-count distribution by type,
    choice-length distributions, key-is-longest rate, quantifier distributions by position,
    stem phrasing inventory, blind-solve rate on a 100-item sample.
    These become the acceptance thresholds. The bank is a *measuring instrument* even if
    it is not shippable content.

[1] GENERATION — 3 families in parallel, item-type × difficulty × domain spec per item.
    Few-shot with real items of the same type (I did NOT do this and should have).
    Require: distractor rationales with named traps, and a declared "why this is hard" claim.

[2] CHEAP STRUCTURAL FILTERS (free, run first, no model calls)
    · key is longest choice → REJECT or force rewrite
    · key is the only hedged choice / only choice with "some", "can", "at least" → REJECT
    · key is the only choice mentioning entity X → REJECT
    · choice length CV outside real-item range → REJECT
    · stimulus < 45 or > 105 words → REJECT
    These four cues explained essentially all the leakage I observed. They cost nothing.
    Expect to reject 40–60% here alone.

[3] GIVEAWAY GATE  ← the single most valuable check in this document
    4 solvers × stimulus withheld × permuted options.
    Threshold: ≤ 75th percentile of the real-item reference sample.
    In my run this rejected 79% of what survived to it. It is the workhorse.

[4] SOLVABILITY GATE (rejection filter only)
    4 solvers × full item × permuted options. Require unanimous agreement with the key.
    Any disagreement → the key is wrong, ambiguous, or the item is broken. Near-free to run
    because models are at 97–100% on real items.

[5] ADVERSARIAL CRITIQUE — ≥2 critics from different families, hostile rubric,
    task framed as "construct the best case for a non-keyed answer."
    Treat as a *flag generator*, not a verdict: my two critics agreed only 53% of the time,
    and one issued zero rejections across 30 items. Union of flags, not intersection.

[6] REPAIR — bounded, and with the uniqueness gate INSIDE the loop.
    ⚠️ My key negative result: naive single-shot anti-cue repair cut giveaway 0.90→0.68 but
    drove critic-flagged multiple-defensible-answers from 8%→63%. If you repair, re-run
    gates [3] AND [4] AND [5] and accept only strict improvements on all three. Max 2 rounds,
    then discard. Never optimise guessability alone.

[7] HUMAN REVIEW — 100% of shipping items. Triage-then-edit. ~$4–8/item.

[8] FIELD TEST — seed as unlabelled unscored items; pull on p<0.25/p>0.90 or r_pb<0.20.
```

## Minimum viable version — buildable in days

This is genuinely a 3–5 day build for one engineer, and it is worth doing regardless of how the licensing workstream lands:

| Day | Build |
|---|---|
| 1 | **Reference distribution** over the existing bank (Track B step 0). Pure SQL + Python, no models. Also measure real RC passage lengths to fix the spec. |
| 2 | **Structural filters** (step 2) + **giveaway harness** (step 3) — this is ~200 lines; I built a working version in an afternoon. Run it over 100 real items to calibrate thresholds. |
| 3 | **RC Track step 0–3**: pull 200 `oa_comm` articles, adapt 20 passages, run the n-gram and faithfulness checks. |
| 4 | **Question generation + full battery** on those 20 passages (~120 questions). |
| 5 | **Blind discrimination study**: 20 generated vs 20 real, unlabelled, to 5 tutors. |

Output: a defensible answer to "can we do this," roughly 60–100 shippable RC items, and a measured yield rate — for a few hundred dollars of compute and a week of one person's time.

## Full version — months

| Phase | Duration | Content |
|---|---|---|
| **1. Foundations** | Weeks 1–3 | Everything above, hardened. Provenance database. Item schema with trap annotations. |
| **2. RC at scale** | Weeks 3–8 | 250+ passage sets, 1,500 questions. Hire one reviewer (philosophy/linguistics PhD-track, per LSAC's own hiring profile). |
| **3. LR iteration** | Weeks 6–16 | Few-shot with real items; per-type generation templates; iterative good/bad exemplar loop (the AAAI 2026 method). This is where the 8% yield has to be moved to 25–40%, and it is genuine research, not integration work. |
| **4. Field testing** | Weeks 10+ | Unscored seeding, item statistics, promote/pull. Requires user volume; starts the day the app has users. |
| **5. Difficulty calibration** | Month 4+ | Replace predicted difficulty with empirical p-values and r_pb. Only real response data solves this. |

---

# Cost model

Assumptions stated: measured gateway pricing as of Aug 2026 (mixed Opus-4.8 / GPT-5.6 / Gemini-Flash); 10 validation calls per candidate; $50/hr fully-loaded reviewer; RC amortised at 6 questions per passage set; **LR yield 8% (measured, pessimistic) to 30% (achievable after iteration)**; RC yield 55% (projected, untested).

| Target pool | Mix | Compute | Human review | **Total** | Elapsed (small team) |
|---|---|---|---|---|---|
| **500 items** | 150 LR / 350 RC | $500–$900 | ~$3,000 | **$3,500–$4,000** | **2–3 weeks** |
| **2,000 items** | 700 LR / 1,300 RC | $1,500–$3,700 | ~$13,000 | **$15,000–$17,000** | **2–3 months** |
| **5,000 items** | 2,000 LR / 3,000 RC | $3,500–$9,200 | ~$34,000 | **$38,000–$43,000** | **5–7 months** |

Plus fixed engineering: roughly **0.5 FTE for 3 months** to build and harden the pipeline (~$40–60k loaded), and **1 part-time reviewer ongoing**.

**Reality check against the alternative.** LSAC's posted coaching-integration licence is **$38/student** ($19 nonprofit). At 1,000 paying students that is $38,000 — about the cost of generating 5,000 original items, for content students already consider authoritative. **At small scale, licensing is cheaper and better. Generation only wins on:** (a) unlimited volume per student at zero marginal cost, (b) independence from a supplier that has terminated licences before, (c) content types LSAC does not license, and (d) the fact that generated items arrive pre-annotated with trap taxonomies, which is a genuine teaching asset official items do not have.

**Timeline reality for the 1.5-week launch: nothing in this document ships a replacement bank before launch.** The MVP week produces evidence and maybe 60–100 RC items. That is the honest answer.

---

# The RC shortcut

**Assessment: this is the strongest finding in the report, and it should be the first thing built.**

The argument in four steps:

1. **LSAC does this exact thing.** Their own disclosure booklets say "material has been adapted for use in this test" and name the sources — *Scientific American*, University of California Press, *Melbourne University Law Review*, *NYRB*. Independent source-comparison shows the adaptation is heavy enough that almost no source wording survives. The comparative set in that same booklet was built by adapting a real published review and a real published response to it. **We are not inventing a workaround; we are reproducing the sponsor's own method with a cleaner input corpus.**
2. **It removes the failure mode that killed the LR experiment.** My generated LR items failed because the model invented arguments whose logical gaps were canonical and therefore predictable from the answer choices, and because it invented facts (the Mercury/Vulcan item is factually wrong about classical mechanics). Grounding in real scholarship removes both.
3. **The economics are 5–8× better** because one adapted passage supports 5–8 questions.
4. **The licence position is auditable per document**, which converts a legal question into a database field.

**Verified license-clean corpora, in build order:**

| Rank | Corpus | Covers | Licence guarantee |
|---|---|---|---|
| 1 | **PMC Open Access Subset, `oa_comm` directory** (S3 `pmc-oa-opendata`) | Biological + physical sciences | **Directory-level**: `oa_comm` is by construction CC BY / CC0 only. Machine-readable per-article licence codes. |
| 2 | **U.S. federal government works** — court opinions, agency reports, GAO, NIH/NSF/NOAA/USGS, Federal Register | Law, public policy, social science | 17 U.S.C. §105 — not copyrightable. Closest natural register to LSAT law passages. |
| 3 | **DOAJ journals filtered to CC BY 4.0**, cross-filtered on Scopus/WoS indexing | Humanities, social sciences | CC BY 4.0 permits commercial adaptation with attribution. Per-journal verification required. |
| 4 | **Project Gutenberg**, PG branding stripped | History of ideas, humanities | Text is PD; strip header/footer and the trademark. Filter the ~1% donated-copyright items via footer. |

**Explicitly excluded, with reasons:** **Wikipedia** (CC BY-SA — ShareAlike is incompatible with a proprietary bank); **arXiv by default** (the majority licence "does not grant further reuse permissions directly" — only the CC-licensed subset, identified via OAI-PMH, is usable).

**Operational requirements** (cheap, and they are the legal defence): store licence + source URL + retrieval date + attribution string per passage; carry an "Adapted from…" line exactly as LSAC does; enforce an automated n-gram overlap check so no >12-word span survives from the source; run a faithfulness check so the adaptation does not misattribute claims to real researchers.

**Residual risks, honestly:** the `oa_comm` bucket depends on publishers having tagged licences correctly upstream, and NLM disclaims responsibility ("you are directly and solely responsible for compliance"); DOAJ's long tail contains weak and predatory journals, so seed quality must be filtered independently of licence; and NLM's FTP→Cloud migration lands **this month (August 2026)**, so build against the Cloud Service.

**What this does not solve:** RC is one of three scored sections. **The two Logical Reasoning sections — the majority of the scored test — get no benefit from this at all.** The shortcut is real and I recommend it without reservation, but it addresses roughly a third of the problem.

---

# Quality bar and how to measure it

**Acceptance criteria** (an item ships only if all pass):

| # | Criterion | Threshold | When |
|---|---|---|---|
| 1 | Structural cue filters | key not longest; not sole hedged choice; not sole entity-mentioning choice; length CV in real-item range | Pre-flight, free |
| 2 | **Giveaway / guessability** | blind-solve rate ≤ **75th percentile of a real-item reference sample** on the same solver panel | Automated |
| 3 | Solvability | **unanimous** agreement with key across ≥3 independent frontier solvers, options permuted | Automated |
| 4 | Answer uniqueness | neither of ≥2 cross-family critics can construct a defence of a non-keyed choice | Automated (flag) |
| 5 | Register fidelity | stimulus length, stem phrasing, no self-commenting sentences; critic register rating ≥4/5 | Automated + human |
| 6 | Grounding (RC) | credited answer and every distractor's defect cite a passage span | Automated |
| 7 | **Human sign-off** | 100% of shipping items | Human |
| 8 | Field statistics | **p-value 0.25–0.90**, **r_pb ≥ 0.20** (≥0.30 preferred), every distractor chosen by ≥5% of those who miss, no distractor positively correlated with total score | Post-launch |

**Two critical calibration notes.** First, **set thresholds relative to the real-item distribution, never absolutely.** My fixed joint gate rejected 67% of genuine LSAC items — a gate that fails two-thirds of the real test is measuring the wrong thing. Second, **the reference sample is contaminated**: models have memorised public PrepTest items, which inflates real-item blind-solve rates and makes the gate more lenient than it should be. Where possible calibrate against items the models are least likely to have seen.

**Field-testing design** (this is the part that actually proves quality, and it is available to us the moment the app has users):
- Seed generated items **unlabelled and unscored** among official-derived items, matched on type and apparent difficulty — exactly NBME's and LSAC's own practice (LSAC's Test Developer posting names "unscored section assembly and review, and post-administration review" as core duties).
- Target **≥200 responses per item** before promoting; ~100 gives a usable early read.
- Compute p-value and point-biserial per item; distractor endorsement distribution; response-time distribution.
- **Promote** items meeting Gate 8; **pull** the rest; **route** items failing on a single distractor back for targeted repair rather than discarding.
- Compare the **generated pool's r_pb distribution against the official pool's**. Indistinguishable distributions is the evidence standard NBME accepted for AIG, and it is the strongest claim we could make.

**The one cheap experiment that settles it before any of that:** a **blind discrimination study** — 20 generated and 20 real items interleaved and unlabelled, 5–10 experienced tutors asked to classify and rate. Near-chance classification means done. High classification accuracy plus "here's what gave it away" is a directly actionable defect list. A few hundred dollars, one week.

---

# Honest verdict

**Can generated items realistically replace a licensed bank? For Reading Comprehension, largely yes, on a 2–3 month timeline. For Logical Reasoning, not on any timeline that matters to this launch, and possibly not at full parity at all.**

The evidence for that split is specific rather than impressionistic:

**On LR.** I generated 24 items with three frontier models, with a prompt that explicitly named and forbade every failure mode I then tested for. **Nineteen of 24 were solved by all four independent frontier models with the stimulus entirely removed.** They looked right — good register, correct stems, plausible traps, sensible rationales — and they were broken in a way that a test-wise student exploits and a casual reader does not notice. When I repaired the leak, "multiple defensible answers" went from 8% to 63%. **That trade is the whole difficulty of LSAT item writing, and it is now measured rather than asserted.** LSAC staffs this job with philosophy PhDs at $65–80k and puts every item through committee review plus unscored field-testing, and that is not bureaucratic excess — it is the minimum process that catches what I just observed.

The 8% joint-gate yield is not fatal on its own; compute is $0.21 per candidate, so you can afford to throw away 92%. What is not free is that **every survivor still needs a human**, and the human is 75–80% of the cost at every scale.

**On RC.** The picture is genuinely different, and I am confident about it for a structural reason: **LSAC builds RC passages by adapting published third-party work, and says so in its own disclosure booklets.** Substituting `oa_comm`, U.S. government works and CC-BY journals for *Scientific American* changes the input corpus, not the method. This removes the invention step that produced every LR failure I measured, makes grounding auditable, and amortises across 5–8 questions. I did not empirically test it and I would not want that caveat lost — but the argument is strong and the test is a few days' work.

**Would a serious LSAT student notice?**

- On **RC**: probably not, once the pipeline is tuned. Passages adapted from real scholarship read like passages adapted from real scholarship.
- On **LR**: **yes, and quickly.** The specific failure I measured is exactly the thing a 170-scorer's trained pattern recognition picks up — they will notice that the hedged answer is always right and that the causal-alternative answer is always the flaw. Worse, they will *learn* that heuristic, it will work on our items, and it will fail them on the real test. **A badly-calibrated item bank is not merely useless; it teaches the wrong reflexes.** That is the real risk and it deserves to be stated plainly.
- On **measurement**: certainly. The community treats official PrepTests as the only valid score predictor, and no generated bank will change that.

**What I would actually do, in order:**

1. **Keep pushing the licensing workstream — it is the dominant option at current scale.** LSAC publicly lists coaching integration at **$38/student** ($19 nonprofit). At 1,000 students that is $38k, roughly what generating 5,000 original items costs, for content students already trust. Build-vs-license is not close today. (Caveat: LSAC has terminated licences before, so this is a dependency, not a solution.)
2. **Build the measurement infrastructure this week regardless.** The reference distribution over the existing bank plus the giveaway harness is 3 days of work, costs almost nothing, is useful whichever way licensing lands, and would have caught defects in *any* bank — including flagging the HTML fragments I found in the current one.
3. **Build the RC track next.** It is the highest-confidence win, it is legally the cleanest thing in this document, and it produces content LSAC does not license.
4. **Treat LR generation as a research programme, not a delivery.** Move the yield from 8% toward 30% with few-shot real exemplars, per-type templates and the iterative exemplar loop from the AAAI 2026 field study. Do not put it on the launch critical path.
5. **Position originals the way the market already does.** Even the AI-native competitor selling 2,178 original items answers "can this replace LawHub?" with "No — and we're not trying to be." Unlimited targeted drilling plus pre-annotated trap explanations is a real product. "Practice test" is not, and claiming it would invite exactly the scrutiny this pipeline cannot yet survive.

**The one-sentence version:** compute is free, the RC shortcut is real and is what LSAC itself does, but LSAT Logical Reasoning item writing is a genuinely hard expert task that frontier models fail at in a specific, measurable, and — importantly — *fixable-but-not-yet-fixed* way, and no honest pipeline ships LR items without a human in the loop.
