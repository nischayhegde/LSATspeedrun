# Learning Science Evidence Review for LSAT Speedrun ("Lawyer Tycoon")

**Compiled:** Sunday, August 2, 2026
**Purpose:** Evaluate the product's design thesis — *"LSAT takers mostly already have the prerequisite reasoning ability, so all they need is an engaging, iterative loop of lots of practice questions"* — against the current state of the learning-science and test-prep literature.
**Scope:** Prioritizes 2024–2026 work (meta-analyses, replications, boundary conditions), working backwards to foundational studies.
**Method note:** Every source consulted is logged below, including dead ends and low-value hits. Sources are logged in the themed section where they were most useful; some sources are relevant to multiple sections and are cross-referenced rather than duplicated.

**Reading key:**
- Effect sizes are reported as given by the source (Cohen's *d*, Hedges' *g*, correlation *r*, or η²). Where a source reports raw score gains I give those instead.
- **[K-12]** flags evidence drawn primarily from children/adolescents, which may not transfer to adult, high-stakes, self-selected test-prep populations.
- **[ADULT]** flags evidence from university-age or older adults, which is the closer analogue to the LSAT population.
- **[HIGH-STAKES]** flags evidence gathered under genuinely consequential conditions rather than lab/course-credit conditions.

---

## Section 1 — The "Desirable Difficulties" Family: Current State of Evidence

### Testing (Quizzing) Boosts Classroom Learning: A Systematic and Meta-Analytic Review
- **Citation**: Yang, C., Luo, L., Vadillo, M. A., Yu, R., & Shanks, D. R. (2021). *Psychological Bulletin*, 147(4), 399–435.
- **Link**: https://gwern.net/doc/psychology/spaced-repetition/2021-yang.pdf
- **Date accessed / recency**: Aug 2, 2026. 2021 — still the largest classroom-based meta-analysis of the testing effect; not superseded as of 2026.
- **Type**: Meta-analysis (222 independent studies, 48,478 students, 573 effect sizes)
- **Population**: Real classrooms, K-12 through higher education. Mixed ages; includes substantial university-level data. **[K-12 + ADULT mix]**
- **Key finding**: Quizzing raises academic achievement by *g* = 0.499 (95% CI [0.442, 0.557]) — roughly half a standard deviation. Median *g* = 0.446. 82.9% of effects positive, 15.5% *negative*, 1.6% null. The magnitude is moderated by: what the control condition does (vs. nothing vs. restudy vs. another active strategy), test-format consistency between practice and criterion, material matching, provision of corrective feedback, number of test repetitions, and treatment duration.
- **Relevance to this product**: This is the strongest single justification for the entire product category — a question-answering app that repeatedly tests is doing the highest-utility thing known. But the moderator list is a design spec: format consistency (practice items must look like real LSAT items), corrective feedback (the app's LLM coaching), and repetition (the Review queue) are all *necessary* to land near g = 0.50 rather than near zero.
- **Confidence / caveats**: High confidence in the aggregate. Note that 15.5% of effects were negative — quizzing is not automatically beneficial. Heterogeneity was substantial (Q = 4,816). Most classroom studies measure retention of taught content, not fluid reasoning skill, which is a real gap for LSAT Logical Reasoning.

### Retrieval-Based Learning (2025 review)
- **Citation**: Karpicke, J. D. (2025). Retrieval-based learning. Chapter/review, Purdue Learning Lab.
- **Link**: https://learninglab.psych.purdue.edu/downloads/2025/2025_Karpicke_Retrieval_Based_Learning_Review.pdf
- **Date accessed / recency**: Aug 2, 2026. Published 2025 — current.
- **Type**: Narrative review by the field's leading proponent
- **Population**: Synthesis across ages; heavy lab-study weighting.
- **Key finding**: Reaffirms Rowland (2014): across 159 studies, retrieval practice vs. repeated study yields *g* = 0.50, with 81% of comparisons favoring retrieval. Karpicke states the basic effect is "beyond dispute." However he also documents that *increasing retrieval difficulty does not monotonically increase benefit* — e.g., Smith & Karpicke found only *d* = 0.07 for short-answer vs. multiple-choice retrieval. Difficulty per se is not the active ingredient; *successful* retrieval is.
- **Relevance to this product**: Supports the core loop. Also a warning against the intuition that "harder = better": forcing a full written explanation on every item is a difficulty manipulation, and difficulty manipulations often produce near-zero incremental benefit over easier retrieval formats.
- **Confidence / caveats**: Author is a partisan of the effect; read alongside the skeptical sources below. The *d* = 0.07 short-answer-vs-MC finding is directly relevant to the written-explanation mandate.

### Testing the testing effect on Prolific: when retrieval practice fails to boost learning
- **Citation**: (2026). *Frontiers in Psychology*, 17, 1727423.
- **Link**: https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2026.1727423/full (also PMC12894256)
- **Date accessed / recency**: Aug 2, 2026. Published 2026 — the most recent item in this section.
- **Type**: Two pre-registered online experiments (failed replications)
- **Population**: Adult online crowdworkers (Prolific). **[ADULT]**, low-stakes.
- **Key finding**: Two adequately-powered studies using well-established materials, with corrective feedback and delayed assessment, found **no significant retrieval advantage**. The authors attribute the failure to lack of sustained engagement in unsupervised online settings and to cognitively demanding, open-ended tasks. They explicitly do not claim the testing effect is false, but conclude that it can fail to emerge "for cognitively demanding educational studies — particularly those involving extended learning phases, delayed assessments, and open-ended tasks" when participants are unsupervised online.
- **Relevance to this product**: **This is the single most product-relevant caution in Section 1.** LSAT Speedrun *is* an unsupervised online environment with extended learning phases and open-ended tasks (written explanations). The result implies that engagement quality — not the presence of a retrieval mechanic — is the binding constraint on whether retrieval practice pays off in a web app. It is an argument *for* the gamification layer's motivational function and *against* assuming lab effect sizes will materialize in-product.
- **Confidence / caveats**: Two studies, one paper, online sample. Prolific participants are paid strangers, not motivated LSAT candidates with $200k of law-school ROI at stake — the motivational gap cuts the other way for this product. Still, it is the cleanest available demonstration that the effect is not automatic in unsupervised digital contexts.

### Meta-analytic review of spacing and retrieval practice for mathematics learning
- **Citation**: Murray, E., Horner, A. J., & Göbel, S. M. (2025). *Educational Psychology Review*, 37, 75.
- **Link**: https://link.springer.com/article/10.1007/s10648-025-10035-1 (PDF: http://aidanhorner.org/papers/Murrayetal_EdPsychReview_2025.pdf)
- **Date accessed / recency**: Aug 2, 2026. Published July 29, 2025 — current.
- **Type**: Pre-registered meta-analysis (27 spacing studies / 53 ES; 7 testing studies / 32 ES)
- **Population**: Mathematics learners, mixed ages, mostly school and university. **[K-12 + ADULT mix]**
- **Key finding**: Spacing vs. massing: *g* = 0.28 overall (95% CI [0.188, 0.376]); *g* = 0.43 for isolated skill learning, *g* = 0.24 course-embedded. **Testing vs. restudy in mathematics: *g* = 0.18 with a 95% CI that crosses zero — i.e., the testing effect was NOT robust in this domain.** Authors note the effect "may be smaller than in other domains."
- **Relevance to this product**: Mathematics is the closest well-studied analogue to LSAT reasoning — it is a *procedural/reasoning* domain, not a factual-recall domain. The testing effect shrinks dramatically when the criterion is problem-solving skill rather than fact retention. This is direct evidence that the founder should NOT assume the g ≈ 0.50 headline number applies to LSAT Logical Reasoning.
- **Confidence / caveats**: Only 7 studies in the testing subset — genuinely underpowered, so "not robust" means "not established," not "shown to be zero." Still, this is the best available domain-transfer estimate and it argues for humility.

### Retrieval practice versus elaborative encoding: a systematic and meta-analytic review
- **Citation**: (2025). *Educational Psychology Review*, 37(4). Preprint at OSF (Aug 2024).
- **Link**: https://osf.io/4xszh ; https://eric.ed.gov/?id=EJ1492680
- **Date accessed / recency**: Aug 2, 2026. 2025 publication — current.
- **Type**: Systematic review + meta-analysis (44 studies, 142 comparisons)
- **Population**: Mostly university students. **[ADULT]**
- **Key finding**: When retrieval practice is compared not to *rereading* but to genuinely *elaborative* alternatives (concept mapping, explanation generation, group discussion), the advantage collapses to *g* = 0.14. **Critically: the retrieval advantage was conditional on corrective feedback (*g* = 0.50 with feedback); without feedback, elaborative encoding outperformed retrieval.** The retrieval advantage was confined to comparisons against concept mapping and group discussion; against other elaborative tasks it was indistinguishable.
- **Relevance to this product**: Two direct implications. (1) The app's LLM feedback is not a nice-to-have — it is the thing that makes retrieval practice beat the alternatives. Without it, forced written explanation (an elaborative task) would be the better use of the student's minute. (2) The huge headline testing effects come from an unfair control (rereading). Against a serious active alternative, the margin is small.
- **Confidence / caveats**: High relevance, adult population, recent. The g = 0.14 figure should temper claims that "testing is the best studied intervention in education" into "testing *with feedback* is."

### Does difficulty moderate learning? Desirable difficulties framework vs. cognitive load theory
- **Citation**: (2025). *Quarterly Journal of Experimental Psychology*. doi:10.1177/17470218241308143
- **Link**: https://doi.org/10.1177/17470218241308143
- **Date accessed / recency**: Aug 2, 2026. Published online late 2024 / 2025 — current.
- **Type**: Theoretical review + proposed integrative model
- **Population**: N/A (review)
- **Key finding**: The Desirable Difficulties Framework and Cognitive Load Theory make *opposing* predictions about difficulty, and have essentially never been directly compared. The proposed resolution: **increasing difficulty helps for low-element-interactivity tasks, but reducing difficulty helps for high-element-interactivity (complex, many-interacting-parts) tasks, where added difficulty causes overload.** Difficulty should be calibrated to material complexity *and* learner expertise.
- **Relevance to this product**: LSAT Logical Reasoning and Reading Comprehension are archetypal *high-element-interactivity* tasks (stimulus + question stem + five answer choices + argument structure, all held simultaneously). Under this model, piling additional difficulty (mandatory writing, strategy prompts, timers, gamified stakes) onto an already high-load task is more likely to overload than to produce a "desirable" difficulty — especially for lower-scoring students.
- **Confidence / caveats**: Theoretical, not empirical. The model is a proposal, not a tested finding. But it aligns with the expertise-reversal evidence in Section 5 and should be treated as a serious design constraint.

### Distributed practice effect on classroom learning: meta-analytic review of applied research
- **Citation**: (2025). *Behavioral Sciences*, 15(6), 771.
- **Link**: https://www.mdpi.com/2076-328X/15/6/771
- **Date accessed / recency**: Aug 2, 2026. Published June 2025 — current.
- **Type**: Systematic review + meta-analysis (3,000+ articles screened → 22 reports, 31 effect sizes, N > 3,000)
- **Population**: Classroom learners across education levels; effects larger at higher education levels. **[K-12 + ADULT]**
- **Key finding**: *d* = 0.54 (95% CI [0.31, 0.77]) favoring distributed over massed practice on curriculum-relevant material. Larger effects with **longer retention intervals, higher education levels, and FEWER re-exposures to the material**. Notably smaller than Donoghue & Hattie's (2021) d = 0.85, which the authors attribute to Hattie having pooled lab and applied studies.
- **Relevance to this product**: Strong support for the Review mode's 1/3/7/21-day schedule and for a product design that pushes daily short sessions over weekend cram blocks. The "fewer re-exposures produce larger effects" moderator is a caution against over-scheduling the repair queue — repeating an item many times has diminishing and possibly negative marginal value.
- **Confidence / caveats**: Only 22 reports; heterogeneity I² = 92%. Directionally very safe (spacing is among the most replicated effects in psychology); the point estimate is soft.

### Similarity matters: a meta-analysis of interleaved learning and its moderators
- **Citation**: Brunmair, M., & Richter, T. (2019). *Psychological Bulletin*, 145(11), 1029–1052.
- **Link**: https://doi.org/10.1037/bul0000209
- **Date accessed / recency**: Aug 2, 2026. 2019; still the definitive interleaving meta-analysis, ~160+ citations.
- **Type**: Multilevel meta-analysis (59 studies, 238 effect sizes, 158 samples, N ≈ 8,466)
- **Population**: Mostly university students. **[ADULT]**
- **Key finding**: Overall interleaving effect *g* = 0.42 (95% CI [0.34, 0.50]) — but wildly moderated by material. Paintings/visual category discrimination *g* = 0.67; artificial visual stimuli *g* ≈ 0.32; **mathematics *g* = 0.34; expository text *g* = 0.01 (null); word lists *g* = −0.39 (blocking WINS)**. Meta-regression: interleaving helps more when categories are *similar to each other* and *internally variable*, and when material is more complex.
- **Relevance to this product**: LSAT question types (Strengthen / Weaken / Assumption / Flaw / Parallel) are precisely the "highly similar categories that must be discriminated" case where interleaving should give near its maximum benefit — arguably the single strongest theoretical argument for the app's mixed-question Infinite/Sprint modes over type-blocked drilling that most commercial LSAT prep uses. Reading Comprehension (expository text, g = 0.01) is the case where interleaving buys nothing.
- **Confidence / caveats**: High confidence in the moderator structure. But no study in this meta-analysis used LSAT-type items; the LR mapping is an inference from category-similarity theory, not a direct finding. Worth an in-product A/B test.

### Whether interleaving or blocking is more effective depends on one's learning strategy
- **Citation**: (2025). *Cognitive Research: Principles and Implications* / PMC12108632. Replication + extension of Little et al. (2025).
- **Link**: https://pmc.ncbi.nlm.nih.gov/articles/PMC12108632/
- **Date accessed / recency**: Aug 2, 2026. 2025 — current.
- **Type**: Two experiments (replication + extension), with 48h delay
- **Population**: Undergraduates. **[ADULT]**
- **Key finding**: A significant interaction between practice sequence and learner strategy that persists over a 48h delay. When learners are *memorizing* (similarity-based classification), interleaving beats blocking (*d* = 0.65). When learners are *trying to find a rule*, blocking is numerically better than interleaving (*d* = 0.33, n.s.). Rule-based learning appeared more resistant to forgetting than memory-based learning.
- **Relevance to this product**: LSAT prep is explicitly *rule-finding* ("what is the structure of an Assumption question?"), not similarity-memorization. This is meaningful counter-evidence to the blanket "interleave everything" recommendation: **a student in the early, rule-acquisition phase for a question type may genuinely learn faster from a blocked run of that type**, switching to interleaved practice once the rule is acquired. Suggests a blocked→interleaved progression rather than always-mixed.
- **Confidence / caveats**: Category-learning lab task, not LSAT items. The blocking advantage was not statistically significant. But the interaction itself replicated, which is the load-bearing claim.

### Transfer of test-enhanced learning: meta-analytic review and synthesis
- **Citation**: Pan, S. C., & Rickard, T. C. (2018). *Psychological Bulletin*, 144(7), 710–756.
- **Link**: https://doi.org/10.1037/bul0000151 ; preprint https://doi.org/10.31234/osf.io/4qpyn
- **Date accessed / recency**: Aug 2, 2026. 2018; remains the definitive transfer meta-analysis.
- **Type**: Meta-analysis (192 transfer effect sizes, 122 experiments, 67 articles, N = 10,382)
- **Population**: Predominantly university students. **[ADULT]**
- **Key finding**: Testing produces transferrable learning at *d* = 0.40 (95% CI [0.31, 0.50]) vs. a re-exposure control. But this is heavily conditional on three moderators: **response congruency** (overlap in answers between practice and criterion — no congruency → *d* = 0.28; congruency → *d* = 0.58), **initial test performance** (you must get items right for transfer to occur), and **elaborated retrieval practice** (+*d* = 0.23). Transfer is strongest to *application and inference questions* and across test formats; weakest to rearranged stimulus-response items and to worked-example problems. **Under publication-bias correction (PET-PEESE and selection methods), the intercept dropped substantially — often indicating NO positive transfer when none of these moderators are present.**
- **Relevance to this product**: This is arguably the most important single source in the whole review for the app's *design*. "Elaborated retrieval practice" is explicitly defined by Pan & Rickard to include *constructing a detailed explanation of one's response* — which is exactly what LSAT Speedrun's mandatory written explanation does, and it buys *d* = 0.23. It also means: practicing on real, novel LSAT items (high format/response congruency with the criterion test) is essential, and drilling items the student cannot get right yields little transfer.
- **Confidence / caveats**: Very high confidence — comprehensive, bias-corrected. The bias-corrected null-without-moderators result is a serious warning: naive drilling with no elaboration and no format match may produce nothing.

### Inducing self-explanation: a meta-analysis
- **Citation**: Bisra, K., Liu, Q., Nesbit, J. C., Salimi, F., & Winne, P. H. (2018). *Educational Psychology Review*, 30(3), 703–725.
- **Link**: https://gwern.net/doc/psychology/spaced-repetition/2018-bisra.pdf ; https://eric.ed.gov/?id=EJ1186664
- **Date accessed / recency**: Aug 2, 2026. 2018; still the reference meta-analysis for self-explanation.
- **Type**: Meta-analysis (69 effect sizes, 64 reports, N = 5,917)
- **Population**: Mixed; includes substantial university-level samples. **[K-12 + ADULT]**
- **Key finding**: Overall *g* = 0.55 (95% CI [0.45, 0.65]) favoring prompted self-explanation. Effects held across nearly all of 20 coded moderators — task type, subject area, education level, inducement type, treatment duration. The authors explicitly recommend exploring **computer-generated** self-explanation prompts because instructor-scripted prompts don't scale.
- **Relevance to this product**: Directly supports the mandatory written-explanation feature at a respectable effect size, and the recommendation for computer-generated prompts is essentially a description of what an LLM-graded explanation system does. See Section 2 for the cost side.
- **Confidence / caveats**: 2018 vintage; heterogeneity was detectable (Q = 196.63, df = 68). The meta-analysis compares *prompted self-explanation vs. no prompt at constant item count* — it does NOT answer whether self-explanation is worth it when it reduces the number of items practiced. That is the real product question (Section 2).

### A meta-analysis of ten learning techniques (Dunlosky re-analysis)
- **Citation**: Donoghue, G. M., & Hattie, J. A. C. (2021). *Frontiers in Education*, 6, 581216.
- **Link**: https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2021.581216/full
- **Date accessed / recency**: Aug 2, 2026. 2021.
- **Type**: Meta-meta-analysis (1,619 cases, N = 169,179)
- **Population**: Pooled across all ages and settings. **[K-12 + ADULT, pooled]**
- **Key finding**: Quantifies Dunlosky et al.'s (2013) qualitative utility ratings. Distributed practice *d* = 0.85; practice testing *d* = 0.74; elaborative interrogation *d* = 0.56; imagery *d* = 0.56; self-explanation *d* = 0.54; mnemonics *d* = 0.50; **re-reading *d* = 0.47; interleaved practice *d* = 0.47; underlining *d* = 0.44; summarization *d* = 0.44**. Grand mean across all ten = 0.56.
- **Relevance to this product**: A useful sanity check that also *undercuts* the standard narrative: the supposedly "low utility" techniques (re-reading d = 0.47, summarization d = 0.44) are barely distinguishable from the "moderate utility" ones, and re-reading actually ties interleaved practice. The gap between the top two and everything else is real but the rest of the ranking is noise.
- **Confidence / caveats**: **Treat these numbers as inflated.** Pooling lab and applied studies systematically inflates estimates (the same authors' d = 0.85 for spacing vs. the 2025 applied-only d = 0.54). Use this for *relative ordering*, not absolute magnitudes.

### The generation effect: meta-analytic reviews
- **Citation**: (a) Bertsch, S., Pesta, B. J., Wiscott, R., & McDaniel, M. A. (2007). *Memory & Cognition*, 35(2), 201–210. (b) McCurdy, M. P., Viechtbauer, W., Sklenar, A. M., Frankenstein, A. N., & Leshikar, E. D. (2020). *Psychonomic Bulletin & Review*. (c) Schindler, J., & Richter, T. (2023). *Educational Psychology Review*, 35, 44.
- **Link**: https://pubmed.ncbi.nlm.nih.gov/17645161/ ; https://doi.org/10.3758/s13423-020-01762-3 ; https://link.springer.com/content/pdf/10.1007/s10648-023-09758-w.pdf
- **Date accessed / recency**: Aug 2, 2026. 2007 / 2020 / 2023.
- **Type**: Three meta-analyses
- **Population**: (a) 445 effect sizes, 86 studies, N = 17,711, mostly young adults; older adults d = 0.50 vs. younger d = 0.41. (b) 126 articles, 310 experiments, 1,653 estimates. (c) Text generation specifically, 20 studies, 129 ES, N = 3,551. **[ADULT]**
- **Key finding**: (a) Overall generation effect *d* = 0.40; within-subjects designs give ~0.5x, between-subjects smaller. (b) **Generation constraint is a critical moderator: LESS constrained generation tasks produce LARGER effects.** Two-factor and transfer-appropriate-processing accounts best supported. (c) Text generation *g* = 0.41; largest for free-recall criterion (*g* = 0.60); **not explained by additional time on material**.
- **Relevance to this product**: (b) is the actionable one: an *unconstrained* "write your reasoning in your own words" prompt should produce a larger generation benefit than a constrained fill-in-the-blank or a menu of canned reasoning options. The app's free-text explanation is the right format. (c) matters because it rules out "the benefit is just extra time" — the generation act itself carries the effect.
- **Confidence / caveats**: These are memory-for-material effects. The LSAT criterion is not "remember this passage" but "solve a novel argument." Generation-effect transfer to novel problem-solving is not established by these meta-analyses.

---

## Section 2 — Self-Explanation and Written Justification: Does the Benefit Survive the Cost?

**Framing:** Section 1 established that *prompted self-explanation vs. no prompt at equal item count* gives roughly g = 0.55 (Bisra et al., 2018). That is the wrong comparison for this product. The product's real counterfactual is: **the same 30 minutes spent writing explanations on 12 items vs. not writing and doing 25 items.** That is the literature searched here.

### Is self-explanation worth the time? A comparison to additional practice
- **Citation**: McEldoon, K. L., Durkin, K. L., & Rittle-Johnson, B. (2013). *British Journal of Educational Psychology*, 83(4), 615–632.
- **Link**: https://cdn.vanderbilt.edu/vu-sub/wp-content/uploads/sites/280/2023/08/04183702/ATME3b_McEldoonDurkinRittleJohnson_BJEP2012-1.pdf
- **Date accessed / recency**: Aug 2, 2026. 2013 — dated, but this is the *canonical* experiment on the exact question and it has not been superseded.
- **Type**: Randomized experiment, three conditions
- **Population**: 69 children, grades 2–4, mathematical equivalence. **[K-12 — a significant transfer caveat]**
- **Key finding**: Three conditions: (1) self-explain, (2) additional practice equated for **time on task**, (3) same number of problems. Self-explanation beat the *same-number-of-problems* control. **But against the time-equated additional-practice control, the benefits were "not as strong."** The authors' own conclusion: "greater attention needs to be paid to how much self-explanation prompts offer advantages over alternative uses of time."
- **Relevance to this product**: This is the closest direct test of the founder's implicit tradeoff. It says the honest answer is *not established*: when you hold minutes constant, forced explanation and just-do-more-problems come out close. It does not say explanation is worthless — it says the app's "explain on every item" mandate is an unvalidated bet, not a settled best practice.
- **Confidence / caveats**: Small N (69), young children, a narrow arithmetic topic. Do NOT over-read this to adults doing verbal reasoning. But note that no better-powered adult replication of the time-equated comparison appears to exist — which is itself the finding.

### In pursuit of knowledge: comparing self-explanations, concepts, and procedures as pedagogical tools
- **Citation**: Matthews, P., & Rittle-Johnson, B. (2009). *Journal of Experimental Child Psychology*, 104(1), 1–21.
- **Link**: https://cdn.vanderbilt.edu/vu-sub/wp-content/uploads/sites/280/2023/08/04183157/ATME_MatthewsandRittle-Johnson_2009.pdf
- **Date accessed / recency**: Aug 2, 2026. 2009.
- **Type**: Two randomized experiments
- **Population**: Children, mathematical equivalence. **[K-12]**
- **Key finding**: In Experiment 2, when all students received good conceptual instruction and the no-explain group was given **additional problem-solving practice to equate time**, self-explanation prompts produced **no improvement** in either procedural or conceptual knowledge. Notably, the extra practice let many students *discover a new strategy* on their own. The authors conclude "the benefits of conceptual instruction may sometimes supplant the utility of self-explanation prompts."
- **Relevance to this product**: Directly relevant. If the app already delivers high-quality conceptual explanation (which the LLM coach does), the *incremental* value of forcing the student to write their own explanation may be near zero — and the volume cost is real. Also: additional practice produced *strategy discovery*, which is exactly the outcome the app's explicit strategy prompts are trying to engineer.
- **Confidence / caveats**: **[K-12]**, small-scale, single narrow topic. Two experiments only. But it converges with McEldoon et al.

### Promoting self-explanation to improve mathematics learning: a meta-analysis and instructional design principles
- **Citation**: Rittle-Johnson, B., Loehr, A. M., & Durkin, K. (2017). *ZDM Mathematics Education*, 49, 599–611.
- **Link**: https://www.researchgate.net/publication/313794629
- **Date accessed / recency**: Aug 2, 2026. 2017.
- **Type**: Meta-analysis restricted to mathematics
- **Population**: Mathematics learners; mix of K-12 and undergraduate. **[K-12 + ADULT]**
- **Key finding**: Immediate outcomes: procedural knowledge **ES = 0.28**, conceptual knowledge **ES = 0.33**, procedural transfer **ES = 0.46** — noticeably smaller than Bisra's g = 0.55. **After a delay (1 week–1 month, only 9 experiments): procedural transfer ES = 0.32, but procedural knowledge ES = 0.13 and conceptual knowledge ES = −0.05, both far from significant.** In classroom (rather than lab) contexts, only 7 experiments: procedural knowledge ES = 0.38 (p = .08), conceptual ES = 0.15 (p = .56). Crucially, **the moderator analysis found the effect did NOT vary based on whether time on task was controlled**, but it *was* stronger when high-quality explanation was scaffolded.
- **Relevance to this product**: Three concrete implications. (1) The best-surviving outcome over a delay is *procedural transfer* (ES = 0.32) — which is exactly the LSAT-relevant outcome, so this is a point in the feature's favor. (2) Benefits in real classrooms are much weaker than in lab, and the product is a real-world context. (3) **Scaffolding explanation quality raises the effect** — so the app should give students a structure to write into (e.g., "name the conclusion / name the flaw / say why the trap answer is tempting") rather than a blank box.
- **Confidence / caveats**: Mathematics only; delayed-outcome subset is only 9 experiments; substantial heterogeneity (Q(8) = 21.27, p = .006 for transfer). Moderate confidence.

### Eliciting explanations: constraints on when self-explanation aids learning
- **Citation**: Rittle-Johnson, B., & Loehr, A. M. (2017). *Psychonomic Bulletin & Review*, 24, 1501–1510.
- **Link**: https://doi.org/10.3758/s13423-016-1079-5
- **Date accessed / recency**: Aug 2, 2026. 2017.
- **Type**: Theoretical review of boundary conditions
- **Population**: Synthesis; includes Kuhn & Katz (2009) with middle-school students. **[K-12 emphasis]**
- **Key finding**: Two boundary conditions matter enormously here. (1) **Explaining one's OWN solution methods or choices can be neutral or NEGATIVE when those choices are likely to be incorrect** — Kuhn & Katz (2009) found that prompting students to explain their own (often wrong) predictions *reduced* subsequent evidence-based reasoning vs. no explanation, apparently by anchoring attention on the preexisting wrong theory. (2) Self-explanation helps in domains with general principles/heuristics (math, science) and helps less in domains of arbitrary conventions. The review also flags that in Chi et al.'s (1994) seminal study the self-explain group spent 2h05m vs. 1h06m — nearly double the time.
- **Relevance to this product**: **This is the strongest single argument against forcing explanation BEFORE feedback on every item.** LSAT Speedrun asks students to write their reasoning for an answer they have chosen, and a substantial fraction of those answers are wrong. Kuhn & Katz's mechanism — explanation entrenching a wrong theory — is a live risk. The mitigation the literature supports is: explain *correct* information, and explain *why the wrong answer is wrong*, after feedback. That argues for restructuring the app's explanation step to be post-feedback ("why is C right and D tempting?") at least for items the student got wrong.
- **Confidence / caveats**: The Kuhn & Katz result is one study with middle-schoolers on a scientific-reasoning task. But the mechanism is plausible for adults and the cost of being wrong here is high. Worth an in-product experiment.

### Conditions for effective learning from erroneous examples: a systematic review
- **Citation**: (2025). *Educational Psychology Review*, 37. doi:10.1007/s10648-025-10071-x
- **Link**: https://link.springer.com/article/10.1007/s10648-025-10071-x
- **Date accessed / recency**: Aug 2, 2026. 2025 — current.
- **Type**: Systematic review
- **Population**: Mixed; substantial K-12 and undergraduate. **[K-12 + ADULT]**
- **Key finding**: Learning from erroneous examples (studying/explaining why a wrong solution is wrong) works, but is conditional on **sufficient prior knowledge**. Renkl's position, endorsed here: "learners with very low prior knowledge may need additional support, such as highlighted errors or expert explanations." Studies confirming self-explanation prompts alongside worked examples are mixed; success depends on whether learners actually engage in the intended cognitive activity, and the necessary amount of prior knowledge "remains unclear."
- **Relevance to this product**: Directly supports building a **"why was the trap answer tempting?"** feature, which the LSAT domain is unusually well-suited to (LSAT wrong answers are engineered traps with named failure modes). But it also says: for a student starting at ~145, error-analysis without heavy scaffolding will not work. Fade the scaffolding in the other direction from what's intuitive: heavy expert explanation early, student-generated error analysis later.
- **Confidence / caveats**: Systematic review, not a quantitative meta-analysis — no pooled effect size. Moderate confidence.

### Learning from interactive video: the influence of self-explanations, navigation, and cognitive load
- **Citation**: (2024). *Instructional Science*. doi:10.1007/s11251-024-09693-5
- **Link**: https://link.springer.com/article/10.1007/s11251-024-09693-5
- **Date accessed / recency**: Aug 2, 2026. 2024 — current.
- **Type**: Experiment + review of null results
- **Population**: University students. **[ADULT]**
- **Key finding**: Found **no significant benefit** of self-explanation prompts, and catalogs converging nulls: Zheng et al. (2022) found prompting to self-explain did not increase engagement; Hefter et al. (2023) found prompting did not affect learning even though it did elicit explanations. The authors' proposed mechanisms for the null are directly transferable: prompts may have been too demanding given low prior knowledge; **"the need to TYPE self-explanations may have a negative impact on their quality compared to verbal expression"** (writing is itself effortful, lowering response quality); and prompts may interfere with self-regulated learning by making students respond to the prompt rather than to their own diagnosed gaps.
- **Relevance to this product**: The typing point is a concrete, testable product hypothesis: **voice input for explanations may produce higher-quality reasoning than a text box**, at lower time cost. Given that the app requires typed explanations on *every* non-diagnostic item, this is a cheap, high-leverage experiment. The self-regulation point is also relevant: a mandatory prompt on every item may crowd out the student's own error-triage instincts.
- **Confidence / caveats**: One study plus a null-results review; the typing-vs-speaking claim traces to Fonseca & Chi (2011), not a new test. Directionally worth testing, not established.

### Optimal learning under time constraints: empirical and simulated trade-offs between depth and breadth of study
- **Citation**: Eglington, L. G., & Kang, S. H. K. / (2022). *Cognitive Science*, 46(5), e13136.
- **Link**: https://doi.org/10.1111/cogs.13136
- **Date accessed / recency**: Aug 2, 2026. 2022.
- **Type**: Empirical study + simulation
- **Population**: Adults studying **GRE-synonym word pairs** — an actual standardized-test-prep stimulus set. **[ADULT]**
- **Key finding**: Holding total trials (study time) constant, conditions varying depth (repetitions per item) vs. breadth (number of items) differed significantly in both mean and variance of day-delayed performance. The simulation found a **medium-depth / medium-breadth strategy was appropriate for most learning situations**, with high-depth/low-breadth only paying off for learners with *well-calibrated judgment about which items matter*.
- **Relevance to this product**: The most direct quantitative guidance available on the volume-vs-depth dial. It argues against both extremes: neither "write a full explanation on every item" (max depth) nor "blast through items with no reflection" (max breadth) is optimal; a middle setting is. And it says the high-depth strategy only wins for students who can *correctly identify* which items deserve depth — i.e., students with good metacognitive calibration, which most LSAT students lack (see Section 4).
- **Confidence / caveats**: Vocabulary pairs, not reasoning items — depth here means repetitions, not explanation writing. The analogy is loose. But it is a real GRE-prep population and the simulation logic generalizes.

### Optimizing schedules of retrieval practice for durable and efficient learning: how much is enough?
- **Citation**: Rawson, K. A., & Dunlosky, J. (2011). *Journal of Experimental Psychology: General*, 140(3), 283–302.
- **Link**: https://psycnet.apa.org/doiLanding?doi=10.1037%2Fa0023956
- **Date accessed / recency**: Aug 2, 2026. 2011; still the standard prescriptive reference.
- **Type**: Three experiments, N = 533, >100,000 hand-scored short-answer responses
- **Population**: University students, conceptual material. **[ADULT]**
- **Key finding**: Effects of initial learning criterion and relearning are **subadditive**. Prescriptive conclusion: practice recalling to an initial criterion of **3 correct recalls**, then **relearn 3 times at widely spaced intervals**. Relearning delivered large long-term retention gains at "relatively minimal cost in additional practice trials"; pushing the initial criterion higher had sharply diminishing returns once relearning was in place.
- **Relevance to this product**: A defensible default for the Review queue: an item should exit the repair queue after ~3 successful spaced retrievals, not be drilled indefinitely. Front-loading many repetitions in one session is the *inefficient* half of the tradeoff; spaced relearning is the cheap half.
- **Confidence / caveats**: Conceptual declarative material (key-term definitions), not reasoning problems. The "3 and 3" numbers should be treated as a starting prior for A/B testing, not a law.

### Evidence and theory for why the best example-problem ratio depends on knowledge content
- **Citation**: (2025). *International Journal of Artificial Intelligence in Education*. doi:10.1007/s40593-025-00511-8
- **Link**: https://link.springer.com/article/10.1007/s40593-025-00511-8
- **Date accessed / recency**: Aug 2, 2026. 2025 — current.
- **Type**: Human experiment + cognitive-model simulation
- **Population**: Adults + simulated learners. **[ADULT]**
- **Key finding**: A significant interaction between training type and knowledge-component type (F(1,471) = 9.448, p = .002, η² = 0.020). For **skills** (selectivity + inference), study-plus-practice with worked examples outperformed practice-only (19.9% vs. 15.8% gain, *d* = 0.286). For **facts**, practice-only outperformed study-plus-practice (15.6% vs. 12.7%, *d* = 0.300). "Skills learning involves more selectivity and inference, which are better aided by worked examples than by increased memory activation through retrieval practice."
- **Relevance to this product**: LSAT Logical Reasoning is unambiguously a *skill* KC, not a *fact* KC. This is direct evidence that **pure high-volume drilling is the wrong regime for LSAT** and that interleaving worked examples (full expert solutions) with practice beats practice alone. It is a quantitative counterweight to the founder's volume thesis.
- **Confidence / caveats**: Effect sizes small (η² = 0.02, d ≈ 0.29); heavily simulation-based. Domain was not LSAT. Moderate confidence, but the direction converges with the worked-example literature in Section 5.

### Heuristics and optimal solutions to the breadth–depth dilemma
- **Citation**: Moreno-Bote, R., Ramírez-Ruiz, J., Drugowitsch, J., & Hayden, B. Y. (2020). *PNAS*, 117(33).
- **Link**: https://www.pnas.org/doi/abs/10.1073/pnas.2004929117
- **Date accessed / recency**: Aug 2, 2026. 2020.
- **Type**: Formal/computational analysis
- **Population**: N/A (theory)
- **Key finding**: With very small capacity (~<10 samples), breadth is optimal (one sample per alternative). Above that there is a **sharp transition** where it becomes optimal to deeply sample a small fraction of alternatives, that fraction decreasing roughly with the square root of capacity.
- **Relevance to this product**: **Dead end for direct application** — this is about information sampling for risky choice, not learning. Logged for completeness. The only transferable intuition is that optimal depth allocation is non-linear in total budget, which supports adapting the explanation-mandate rate to how much total study time a student has, rather than a fixed "every item."
- **Confidence / caveats**: Not a learning study. Do not cite as learning evidence.

### Perceived 'optimal efficiency': theorization and conceptualization
- **Citation**: (2021). *Heliyon* / PMC7848644.
- **Link**: https://pmc.ncbi.nlm.nih.gov/articles/PMC7848644/
- **Date accessed / recency**: Aug 2, 2026.
- **Type**: Conceptual paper
- **Population**: N/A
- **Key finding**: Defines learning efficiency as the ratio of performance outcome to expenditure of time/effort/resources, following the Paas & van Merriënboer instructional-efficiency tradition.
- **Relevance to this product**: **Low value / near dead end.** Useful only as a pointer that the right product metric is *score gain per hour of app time*, not score gain per item or engagement minutes. That framing is genuinely worth adopting.
- **Confidence / caveats**: Purely conceptual, no data.

**Section 2 verdict:** The evidence supports self-explanation as a real effect (g ≈ 0.55 vs. no prompt; ES ≈ 0.32–0.46 for the transfer outcomes that matter most for LSAT, even after a delay), but does **not** support mandating it on 100% of items. Three specific findings argue for a lower, targeted rate: (a) time-equated comparisons against "just do more problems" have repeatedly failed to show a self-explanation advantage; (b) explaining one's *own, possibly wrong* choice before feedback can be actively harmful; (c) scaffolded/structured explanation substantially outperforms unstructured, so the same benefit can be bought at lower time cost with a structured template. The volume-vs-depth literature converges on a medium-depth/medium-breadth setting.

---

## Section 3 — Feedback Timing: Immediate vs. Delayed for Complex Reasoning

### A meta-analysis of the impact of feedback timing on learning outcomes in computer-assisted learning
- **Citation**: Kandemir, E. N., et al. (2025/2026 preprint). HAL hal-05546645.
- **Link**: https://hal.science/hal-05546645v1/file/Meta_HAL_submission.pdf
- **Date accessed / recency**: Aug 2, 2026. **The newest meta-analysis on this question (studies 1988–2024); the previous direct comparison was Kulik & Kulik 1988.** Preprint.
- **Type**: Meta-analysis, 51 studies, 160 effect sizes, robust variance estimation
- **Population**: Computer-assisted learning environments; mixed education levels. **[K-12 + ADULT]**
- **Key finding**: **Feedback timing does not significantly influence learning outcomes on average: *g* = 0.03, 95% CI [−0.08, 0.13], p = .61.** Substantial between-study heterogeneity. Educational level, learning domain, and response-time constraints significantly moderate the effect. Delays ranged from 1 second to 7 days (time-based) or 1–60 intervening items (item-based). Authors flag that few studies used delays of ≥1 day, so multi-day delays remain poorly evidenced.
- **Relevance to this product**: **This is the single most decision-relevant finding for the founder's feedback-timing question.** The app currently uses immediate feedback (Infinite, Method Lab) and delayed feedback (Sprint, Diagnostic). The best current evidence says *this choice is close to a wash for learning* — so it should be made on other grounds: engagement, test-condition fidelity, and time efficiency. Delayed feedback in Sprint/Diagnostic is justified by *test simulation fidelity*, not by a learning advantage. Immediate feedback in Infinite/Method Lab is justified by engagement and error-correction speed. Both are defensible; neither is "the science-backed one."
- **Confidence / caveats**: Preprint, not yet peer-reviewed as of access. Confidence intervals are tight around zero, which is informative. But moderators were partially confounded and the multi-day-delay case is under-studied.

### A meta-analysis of context, content, and task factors of digitally delivered instructional feedback
- **Citation**: (2024). *Learning Environments Research*. doi:10.1007/s10984-024-09501-4
- **Link**: https://research-portal.uu.nl/ws/portalfiles/portal/248498845/s10984-024-09501-4.pdf
- **Date accessed / recency**: Aug 2, 2026. 2024 — current.
- **Type**: Meta-analysis of digitally delivered feedback
- **Population**: Mixed across education sectors. **[K-12 + ADULT]**
- **Key finding**: Both immediate and delayed feedback had significant and strong effects; **delayed was slightly more effective than immediate**, but critically — **"a combination of feedback timing approaches was ineffective."** The authors' conclusion: *"clarity and consistency — as to whether participants receive immediate or delayed feedback — is more essential than the actual timing."* Also found that **process-focused feedback outperformed task-focused feedback**, and that whether participants received a **reward** made no significant difference to learning performance (Q-between = 1.54, df = 1, p = 0.21).
- **Relevance to this product**: **Two direct hits.** (1) The app mixes immediate and delayed feedback across five modes, which is precisely the "combination of timing approaches" this meta-analysis found ineffective. The fix is not to pick one globally but to make the timing *predictable and explicit within each mode* so the student knows the contract before starting. (2) The reward null (Q-between = 1.54, p = 0.21) is an early, quantitative data point on the gamification question — see Section 8.
- **Confidence / caveats**: The "combination is ineffective" result may reflect study heterogeneity rather than a real interference mechanism; treat as suggestive. The reward null is a subgroup analysis, not a designed test.

### Effects of computer-based feedback on lower- and higher-order learning outcomes: a network meta-analysis
- **Citation**: Wisniewski, B., et al. (2022). *Journal of Educational Psychology*, 114(8). ERIC EJ1372783.
- **Link**: https://eric.ed.gov/?id=EJ1372783
- **Date accessed / recency**: Aug 2, 2026. 2022.
- **Type**: Network meta-analysis (163 effect sizes, 77 experimental studies) — allows *ranking* of feedback types
- **Population**: Mixed; includes prior-knowledge-level subgroups. **[K-12 + ADULT]**
- **Key finding**: Ranking of feedback types: **Elaborated Feedback (EF) is most likely the most effective for BOTH lower-order (recall/recognition) AND higher-order (transfer) outcomes.** Knowledge of Correct Response (KCR) and Answer-Until-Correct (AUC) gave small-to-large effects. **Knowledge of Results (KR — just "right/wrong") was least effective.**
- **Relevance to this product**: Strongly validates the LLM-coaching architecture over a bare correct/incorrect indicator. The differentiator between LSAT Speedrun and a free question bank is precisely that it delivers *elaborated* feedback. This is the app's most defensible pedagogical feature and it should be protected in any redesign that tries to trim time cost. Note: it also means the *quality* of the LLM explanation is the product's core learning asset — a bad LLM explanation degrades EF toward KCR.
- **Confidence / caveats**: Network meta-analyses infer indirect comparisons; rankings carry uncertainty. But the KR-is-worst / EF-is-best ordering is consistent across the entire feedback literature back to Shute (2008) and Hattie & Timperley (2007).

### Focus on formative feedback
- **Citation**: Shute, V. J. (2008). *Review of Educational Research*, 78(1), 153–189.
- **Link**: https://andymatuschak.org/files/papers/Shute%20-%202008%20-%20Focus%20on%20Formative%20Feedback.pdf
- **Date accessed / recency**: Aug 2, 2026. 2008 — foundational.
- **Type**: Narrative review / synthesis
- **Population**: Synthesis
- **Key finding**: Articulates the mechanism now most relevant to LSAT: the **interference-perseveration hypothesis** (Kulhavy & Anderson, 1972) — delayed feedback works because the initial *error* has been forgotten by the time the correction arrives, so it cannot compete with the correct response at retention. Shute's synthesis: **"delayed feedback may be superior for promoting transfer of learning, especially in relation to concept-formation tasks, whereas immediate feedback may be more efficient, particularly in the short run and for procedural skills."** Also: immediate feedback is more beneficial for *lower-achieving* students regardless of task level; higher-achieving students benefit more from delayed feedback on higher-order tasks (Mason & Bruning, 2001).
- **Relevance to this product**: The achievement-level interaction is directly actionable: **a 145-scorer should probably get immediate feedback; a 168-scorer probably benefits more from delayed feedback on full sections.** That maps cleanly onto a mode-recommendation engine: push beginners to Infinite/Method Lab, push advanced students to Sprint/Diagnostic. It also gives the *interference-perseveration* rationale for why the app should not let a student sit staring at their wrong answer immediately after being told it was wrong.
- **Confidence / caveats**: 2008; the Mason & Bruning interaction is a single study, and the 2025/26 meta-analysis above found timing effects near zero overall, which weakens the strong version of this claim. Use as a hypothesis for personalization, not as established fact.

### The effects of delay of feedback on a delayed concept-formation transfer task
- **Citation**: Schroth, M. L. (1992). *Contemporary Educational Psychology*, 17(1), 78–82.
- **Link**: https://www.sciencedirect.com/science/article/abs/pii/0361476X92900484
- **Date accessed / recency**: Aug 2, 2026. 1992 — foundational primary source behind Shute's claim.
- **Type**: Experiment (delays of 0/10/20/30 s; three verbal-feedback types; 7-day delayed transfer test)
- **Population**: Adults, conjunctive concept-formation task. **[ADULT]**
- **Key finding**: **Delaying feedback slowed the rate of initial learning but facilitated transfer after a 7-day delay.** Also: right-wrong feedback gave fastest initial learning, but *no differences between feedback types* on the delayed transfer task.
- **Relevance to this product**: This is the primary source I traced for the "delayed feedback helps transfer" claim, and it is worth knowing that the delays involved were **10–30 seconds**, not days. That is a *very* achievable product manipulation — inserting a short buffer (a few seconds, or one intervening item) between answer and feedback, rather than restructuring modes around multi-day delays. Also worth noting: the effect is a *slower-but-more-durable* tradeoff, which is exactly the desirable-difficulty pattern.
- **Confidence / caveats**: Small, old, single study on an artificial concept-formation task. The 0-vs-30-second manipulation is tiny and the finding has not, as far as this search found, been robustly replicated. Low confidence; interesting cheap experiment.

### The power of feedback revisited: a meta-analysis of educational feedback research
- **Citation**: Wisniewski, B., Zierer, K., & Hattie, J. (2020). *Frontiers in Psychology*, 10, 3087.
- **Link**: https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2019.03087/full
- **Date accessed / recency**: Aug 2, 2026. 2020.
- **Type**: Meta-analysis of meta-analyses
- **Population**: Broad. **[K-12 + ADULT]**
- **Key finding**: Feedback *type* is decisive; feedback *timing* produced "inconsistent results." Praise, punishment, and rewards had low to low-medium effects; **corrective feedback was highly effective for learning new skills and tasks.** "Forms of feedback with a lack of information value have low effects." Specific written comments beat grades.
- **Relevance to this product**: Reinforces Section 3's conclusion and adds a warning relevant to Section 8: **praise and rewards have low effect sizes on achievement.** The app's gamified reward layer should not be understood as a feedback mechanism — its only defensible job is getting the student to show up.
- **Confidence / caveats**: Hattie-lineage meta-meta-analyses systematically inflate effect sizes and are methodologically contested. Use qualitatively.

**Section 3 verdict:** Timing is nearly a wash (*g* = 0.03). Feedback *content* is what matters (elaborated > correct-answer > right/wrong), and *consistency within a mode* matters more than which timing you pick. The delayed-feedback-helps-transfer story has theoretical support and a real but thin empirical base; it is a reasonable justification for Sprint/Diagnostic's delayed results but should not be sold as settled science. The strongest actionable hypothesis: match timing to student level (immediate for low scorers, delayed for high scorers on section-length work).

---

## Section 4 — Metacognition, Confidence, and Calibration

### Meta-analysis of interventions for monitoring accuracy in problem solving
- **Citation**: (2024). *Educational Psychology Review*, 36. doi:10.1007/s10648-024-09936-4
- **Link**: https://doi.org/10.1007/s10648-024-09936-4 ; PDF: https://repository.ubn.ru.nl/bitstream/handle/2066/310049/310049.pdf
- **Date accessed / recency**: Aug 2, 2026. 2024 — current.
- **Type**: Meta-analysis, 35 studies
- **Population**: Primary, secondary, and adult learners; **explicitly reports that adults and primary students benefited MORE than secondary students.** **[K-12 + ADULT]**
- **Key finding**: All monitoring-accuracy interventions combined: **small positive effect, *g* = 0.25.** Intervention type strongly moderated: **whole-task interventions, metacognitive-knowledge interventions, and external-standards interventions all significantly IMPROVED monitoring accuracy. Interventions targeting the TIMING of the metacognitive judgment significantly DECREASED monitoring accuracy** and differed significantly from all other types (z = −4.56 vs. whole-task). Lab studies showed larger effects than classroom studies. **Interventions were more effective for retrospective confidence judgments than for prospective judgments of learning.**
- **Relevance to this product**: Highly actionable and partially contrarian. (1) The app captures **retrospective confidence** on answers — the meta-analysis says that is the *more improvable* judgment type, so this is the right choice. (2) **"External standards" is a supported intervention type** — showing the student a concrete benchmark (e.g., "students who eventually scored 170 got this item right 82% of the time") is evidence-backed. (3) The **timing-of-judgment** intervention type actively *hurt*, and the authors recommend "reconsideration and possibly discontinuation." So do not build features that merely move *when* the confidence rating is collected. (4) Adults benefit more than secondary students, so this transfers to the LSAT population.
- **Confidence / caveats**: 35 studies, g = 0.25 is small. This measures improvement in *monitoring accuracy*, not in *task performance* — the transfer to actual score gain is a separate question (see next entry).

### Learning behaviors mediate the effect of AI-powered support for metacognitive calibration on learning outcomes
- **Citation**: Lee, et al. (2025). *Proceedings of LAK/CHI* — doi:10.1145/3706598.3713960
- **Link**: https://doi.org/10.1145/3706598.3713960 ; https://pnigel.com/papers/lee-inpress-6MQTQZ8D.pdf
- **Date accessed / recency**: Aug 2, 2026. 2025 — current.
- **Type**: **Randomized controlled trial (N = 133)** in a college-level computer-based learning environment
- **Population**: College students. **[ADULT]**
- **Key finding**: An AI tool that gave early, real-time feedback using ML-model-predicted end-of-learning performance to correct miscalibration **improved learning gains by 8.9 percentage points vs. control (16.3% vs. 7.4% mean gain; t = −2.384, p = .019)**, and the effect was **significantly mediated by learning behaviors** (i.e., calibration changed what students did, which changed what they learned). Overconfident students showed 4.1% greater calibration improvement than control (t = 2.001, p = .049). **Important honesty note: when race/ethnicity and gender were added to a regression model, the intervention effect was no longer significant (p = .248)**, which the authors attribute to lost power.
- **Relevance to this product**: **This is the closest analogue in the literature to what LSAT Speedrun could build, and it is a genuine RCT with a large gain.** The mechanism is exactly available to the app: it already captures confidence, already has per-student performance data, and could predict an LSAT score and show it early to correct miscalibration. The mediation result answers the founder's question directly — *calibration training does transfer to performance gains, via changed study behavior.* This argues for a "predicted LSAT score" feature not just as a benchmarking tool but as an *intervention*.
- **Confidence / caveats**: **Single RCT, N = 133, one domain, and the effect became non-significant with covariates added.** Do not treat the 8.9% as a reliable point estimate. Treat it as the best available proof-of-concept and a strong reason to run this experiment in-product.

### Calibration discrepancy predicts students' subsequent metacognitive strategy use
- **Citation**: (2025). *International Journal of Artificial Intelligence in Education*. doi:10.1007/s40593-025-00514-5
- **Link**: https://link.springer.com/article/10.1007/s40593-025-00514-5
- **Date accessed / recency**: Aug 2, 2026. 2025 — current.
- **Type**: Observational study in a computer-based learning environment
- **Population**: Students in a CBLE. **[ADULT, college]**
- **Key finding**: Pretest calibration discrepancy predicts subsequent metacognitive strategy use. Synthesizes the established pattern: **overconfidence leads students to adopt ineffective strategies and reduce study time and effort**, producing worse outcomes (Dunlosky & Rawson, 2012). **Low achievers are systematically more overconfident (Dunning–Kruger); high achievers are better calibrated and sometimes underconfident.**
- **Relevance to this product**: The app's highest-value use of confidence data may not be scheduling review — it may be *detecting the students who are about to under-study*. A 152-scorer who is confidently wrong is the student most likely to plateau, and the app can identify them from day one. This is a concrete, differentiated product feature that no LSAT question bank currently offers.
- **Confidence / caveats**: Correlational, not causal. The Dunning–Kruger framing has been criticized as partly a statistical artifact (regression to the mean), so treat the "low achievers are overconfident" claim as a robust empirical pattern with a contested explanation.

### Errors committed with high confidence are hypercorrected
- **Citation**: Butterfield, B., & Metcalfe, J. (2001). *JEP: LMC*, 27(6), 1491–1494. Plus Metcalfe & Finn (2011), *JEP: LMC* — "People's hypercorrection of high-confidence errors: Did they know it all along?"
- **Link**: https://doi.org/10.1037//0278-7393.27.6.1491 ; https://doi.org/10.1037/a0021962
- **Date accessed / recency**: Aug 2, 2026. 2001 / 2011 — foundational, heavily replicated.
- **Type**: Experiments
- **Population**: Young adults (also replicated in children). **[ADULT]**
- **Key finding**: Contrary to the prediction of interference models, **errors made with HIGH confidence are the MOST likely to be corrected after feedback** — the hypercorrection effect. Metcalfe & Finn (2011) showed this is not hindsight bias: participants given high-confidence errors were more likely to pick the right answer on a second guess, more likely to generate it after being told they were wrong, and needed fewer letter cues to reach it. They genuinely had partial knowledge.
- **Relevance to this product**: **This directly validates the app's high-confidence-error detection as a targeting mechanism, but flips the interpretation.** High-confidence errors are not the student's most stubborn problems — they are the *cheapest to fix*, because the student is sitting on partial knowledge. The product implication is that flagging high-confidence errors and delivering an immediate elaborated correction should produce disproportionate return per minute. That is a strong, evidence-backed reason to prioritize them at the top of the Review queue.
- **Confidence / caveats**: Established on general-knowledge factual questions, not multi-step reasoning items. Whether "high-confidence wrong on a Parallel Reasoning question" behaves like "high-confidence wrong on a trivia question" is untested. Also note the next entry: the effect is not universal across populations.

### The hypercorrection effect in younger and older adults
- **Citation**: Eich, T. S., Stern, Y., & Metcalfe, J. (2013). *Journal of Experimental Psychology: LMC*. PMC3604148.
- **Link**: https://pmc.ncbi.nlm.nih.gov/articles/PMC3604148/
- **Date accessed / recency**: Aug 2, 2026. 2013.
- **Type**: Experiment contrasting age groups
- **Population**: Younger vs. older adults. **[ADULT]**
- **Key finding**: Younger adults hypercorrected (γ = .51, SD = .55); **older adults showed a significantly diminished effect (γ = .14, SD = .68, F(1,63) = 5.87, p = .02) that did not differ from zero** — despite higher overall accuracy and good basic metacognition.
- **Relevance to this product**: A boundary condition worth knowing but of limited product impact: the LSAT population is overwhelmingly 21–30, i.e., squarely the "younger adults" group where the effect is strong. Mildly reassuring for the targeting strategy above.
- **Confidence / caveats**: Small N (63 in the reported contrast). Included mainly to document that the effect has known population boundaries.

### The influence of delaying judgments of learning on metacognitive accuracy: a meta-analytic review
- **Citation**: Rhodes, M. G., & Tauber, S. K. (2011). *Psychological Bulletin*, 137(1), 131–148.
- **Link**: https://doi.org/10.1037/a0021705
- **Date accessed / recency**: Aug 2, 2026. 2011 — definitive on this sub-question.
- **Type**: Two meta-analyses (112 effect sizes / N = 4,554; 98 effect sizes / N = 3,807)
- **Population**: Predominantly adults. **[ADULT]**
- **Key finding**: **Delaying judgments of learning produces a large improvement in the RELATIVE ACCURACY of those judgments (*g* = 0.93), but only a tiny improvement in actual memory performance (*g* = 0.08).**
- **Relevance to this product**: The cleanest available statement of the metacognition trap: **you can make students dramatically better at knowing what they know (g = 0.93) while barely improving what they know (g = 0.08).** Calibration is not a performance intervention by itself. It becomes one only when better calibration changes study allocation — which is precisely the mediation the Lee et al. (2025) RCT demonstrated. Product implication: never ship calibration features as an end in themselves; ship them wired to a concrete "so study this next" action.
- **Confidence / caveats**: High confidence — large, well-powered meta-analyses. The g = 0.08 figure should be the founder's default expectation for any calibration feature not coupled to behavior change.

**Section 4 verdict:** Confidence capture is one of the better-supported features in the app, but for a non-obvious reason. Calibration by itself moves performance almost not at all (*g* = 0.08). It pays off through two specific channels: (1) **high-confidence errors are the cheapest errors to fix** (hypercorrection), so they belong at the front of the Review queue; and (2) **early, explicit correction of overconfidence changes study behavior**, which in one adult RCT produced an 8.9-point learning gain. Retrospective confidence (what the app collects) is the more improvable judgment type. Avoid building features that just change *when* judgments are collected — that intervention class made accuracy worse.

---

## Section 5 — Worked Examples, Faded Scaffolding, and the Expertise-Reversal Effect
*(Directly relevant to the strategy-prompt bandit: should named strategies be shown at all, and should they fade?)*

### A cornerstone of adaptivity — a meta-analysis of the expertise reversal effect
- **Citation**: Tetzlaff, L., Simonsmeier, B., Peters, T., & Brod, G. (2025). *Learning and Instruction*, 98, 102142.
- **Link**: https://doi.org/10.1016/j.learninstruc.2025.102142 ; open copy: https://www.pedocs.de/frontdoor.php?source_opus=34113
- **Date accessed / recency**: Aug 2, 2026. **Published 2025 — the first and only meta-analysis of the expertise reversal effect. Searches run Dec 2022 and Nov 2024.**
- **Type**: PRISMA meta-analysis; 1,590 studies screened → 60 experimental studies, 176 effect sizes, N = 5,924
- **Population**: Mixed education levels; effects moderated by educational status. **[K-12 + ADULT]**
- **Key finding**: **Low-prior-knowledge learners learn better from high-assistance instruction (*d* = 0.505). High-prior-knowledge learners learn better from LOW-assistance instruction (*d* = −0.428)** — i.e., giving experts scaffolding actively *hurts* them by nearly half a standard deviation. Moderated by type of prior-knowledge assessment, educational status, and content domain; evidence is weaker for younger students and for humanities/language learning. **The effect is asymmetric: giving assistance to novices matters more than withholding it from experts.**
- **Relevance to this product**: **This is the decisive source for the strategy-prompt feature.** A named strategy with three concrete steps *is* high-assistance instruction. The meta-analysis says it should help a 148-scorer (+0.5 SD) and hurt a 168-scorer (−0.43 SD). The app's ~every-4th-question strategy surfacing should therefore be **prior-knowledge-gated, not uniformly applied** — high rate for low scorers, tapering toward zero as the student's accuracy on that question type rises. The good news: the app's within-student bandit with a 25% silent control is already an instrument that can *measure* exactly this reversal per student. That is a genuinely well-designed feature that happens to be aimed at the right effect.
- **Confidence / caveats**: High confidence — recent, large, PRISMA-compliant, and the effect sizes are substantial in both directions. Caveat: "humanities and language learning" is one of the domains where evidence was less clear, and LSAT verbal reasoning arguably sits in that family. Also, prior-knowledge assessment type was a moderator, so *how* the app measures a student's expertise on a question type will affect whether the gating works.

### A meta-analysis of the worked examples effect on mathematics performance
- **Citation**: Barbieri, C. A., Miller-Cotto, D., Clerjuste, S. N., & Chawla, K. (2023). *Educational Psychology Review*, 35, 35.
- **Link**: https://www.danamillercotto.com/uploads/4/7/7/2/47725475/barbieri_et_al__2023__we_meta-analysis.pdf ; https://eric.ed.gov/?id=EJ1364058
- **Date accessed / recency**: Aug 2, 2026. 2023 — the first meta-analysis of the worked-examples effect despite thousands of primary studies.
- **Type**: Meta-analysis; 8,033 abstracts screened → 43 articles, 55 studies, 181 effect sizes; robust variance estimation
- **Population**: Elementary through postsecondary. **[K-12 + ADULT]**
- **Key finding**: Worked examples produce a medium effect on mathematics performance, ***g* = 0.48, 95% CI [0.36, 0.60], p = 0.01**, with severe heterogeneity (I² = 93%; 38 of 181 effects were negative). Moderators: **correct examples alone outperformed incorrect examples alone and correct+incorrect combinations.** The effect holds whether examples are used for initial acquisition or for practice. **Most importantly for this product: pairing worked examples with SELF-EXPLANATION PROMPTS significantly moderated the effect in the NEGATIVE direction relative to worked examples without such prompts** — the authors conclude "pairing examples with self-explanation prompts may not be a fruitful design modification."
- **Relevance to this product**: A direct, quantified warning about a combination the app currently ships. The Method Lab flow is roughly *item → student writes explanation → LLM delivers an expert explanation (a worked example)*. This meta-analysis says stacking a self-explanation demand on top of a worked example is net-negative in mathematics. It argues for **separating the two**: either give the worked example cleanly, or ask for the student's explanation, but not both on the same item every time.
- **Confidence / caveats**: I² = 93% is enormous heterogeneity — the pooled g = 0.48 hides a very wide distribution. Mathematics only. The self-explanation moderator is a subgroup finding and contradicts Bisra et al. (2018); the contradiction is honest and unresolved. Note that Barbieri et al. compare *worked example + SE prompt vs. worked example alone*, whereas Bisra compares *SE prompt vs. nothing* — so both can be true, and together they suggest self-explanation substitutes for, rather than adds to, expert explanation.

### After initial acquisition, problem-solving leads to better long-term performance than example study, even for complex tasks
- **Citation**: (2024). *Learning and Instruction*, 94, 102027.
- **Link**: https://doi.org/10.1016/j.learninstruc.2024.102027
- **Date accessed / recency**: Aug 2, 2026. 2024 — current.
- **Type**: Multi-classroom randomized experiment, 2×2×2 between-subjects
- **Population**: 366 sixth-grade students (mean age 11.14). **[K-12 — significant transfer caveat]**
- **Key finding**: A significant two-way interaction between acquisition strategy and retention interval, **independent of task complexity**. At a 5-minute retention interval there was no difference between studying worked examples and solving practice problems. **At a 1-week interval, students who solved practice problems significantly outperformed those who studied worked examples.** The hypothesized three-way interaction with task complexity was not supported.
- **Relevance to this product**: An important corrective to Section 5's worked-example enthusiasm and a partial vindication of the founder's volume thesis. **After the initial acquisition phase, actually solving problems beats studying solutions for durable performance — which is the LSAT-relevant outcome (performance weeks later on test day).** Combined with the expertise-reversal meta-analysis, this yields a clean staged design: heavy worked examples and strategy scaffolds early, aggressive high-volume solving later.
- **Confidence / caveats**: **[K-12]**, sixth graders, mathematics. The generalization to adult verbal reasoning is an inference. But the mechanism (desirable difficulty at acquisition producing durable performance) is the same one supported across Section 1.

### The expertise reversal effect and worked examples in tutored problem solving
- **Citation**: Salden, R. J. C. M., Aleven, V., Schwonke, R., & Renkl, A. (2010). *Instructional Science*, 38, 289–307.
- **Link**: http://www.cee.uma.pt/ron/Salden%20et%20al.%20-%20The%20Expertise%20Reversal%20Effect%20and%20Worked%20Examples.pdf
- **Date accessed / recency**: Aug 2, 2026. 2010 — foundational for adaptive fading in software tutors.
- **Type**: One lab + one classroom experiment with a Cognitive Tutor
- **Population**: Students using an intelligent tutoring system. **[K-12 / early ADULT]**
- **Key finding**: Three conditions — standard tutored problem solving, **fixed** fading of worked examples, and **adaptive** fading based on each student's demonstrated understanding of the examples. **Adaptive fading outperformed fixed fading, which outperformed problem-solving alone, on both immediate and delayed posttests. The adaptive condition also required significantly FEWER worked steps than the fixed condition** — students got there faster. Interactive worked examples subsequently made it into real curriculum.
- **Relevance to this product**: The clearest existence proof that the thing LSAT Speedrun should build is buildable and works: **fade scaffolding adaptively, per student, per skill, based on demonstrated mastery — not on a fixed schedule and not uniformly.** The app currently surfaces strategy prompts on roughly every 4th eligible question regardless of student level, which is the "fixed fading" condition at best. Moving to adaptive fading is a concrete, evidence-backed upgrade with a demonstrated advantage over both alternatives.
- **Confidence / caveats**: 2010; two studies; a geometry Cognitive Tutor, not verbal reasoning. But the finding has been influential and durable, and it aligns exactly with the 2025 expertise-reversal meta-analysis.

**Section 5 verdict:** The strategy-prompt feature is defensible *if and only if it fades*. Uniform delivery is predicted to help weak students (*d* ≈ +0.51) and harm strong ones (*d* ≈ −0.43). Adaptive fading beat fixed fading in the one ITS study that tested it directly, and got students to mastery in fewer steps. Separately, the app should be careful about stacking a self-explanation demand on top of an expert explanation on the same item — the one meta-analysis that tested that combination found it *negative*.

---

## Section 6 — Transfer of Learning and Explicit Strategy Instruction

### Cognitive training: a field in search of a phenomenon
- **Citation**: Gobet, F., & Sala, G. (2023). *Perspectives on Psychological Science*, 18(1), 125–141.
- **Link**: https://journals.sagepub.com/doi/10.1177/17456916221091830 ; PMC9903001
- **Date accessed / recency**: Aug 2, 2026. 2023.
- **Type**: Review + second-order meta-analysis (14 independent first-order meta-analyses; 332 samples, 1,555 effect sizes, N = 21,968)
- **Population**: Children, adults, and older adults across working-memory, video-game, music, chess, and exergame training. **[K-12 + ADULT]**
- **Key finding**: **"The overall effect of far transfer is null, and there is little to no true variability between the types of cognitive training."** Near transfer is real and moderated by population. Far transfer is negligible uncorrected and **exactly zero once placebo effects and publication bias are controlled** — and second-order sampling error explained *all* the between-meta-analysis variance, meaning there is no hidden subgroup where it works. Sala et al. (2019) put it bluntly: *"The lack of generalization of skills acquired by training is thus an invariant of human cognition."*
- **Relevance to this product**: **This is the hard boundary on what LSAT Speedrun can promise, and it is good news framed correctly.** It says: do not build the product on a theory of "training reasoning ability." General reasoning ability does not improve from training. What *does* improve — reliably, with real effect sizes — is **near transfer**: performance on tasks structurally similar to what was practiced. Since the criterion (the actual LSAT) is *identical in structure* to the practice items, LSAT prep is a near-transfer problem, and near transfer works. The product should therefore maximize *structural similarity to the real test* and stop implicitly promising to make anyone smarter.
- **Confidence / caveats**: Very high confidence — second-order meta-analysis with placebo and publication-bias controls, and the authors are the field's most rigorous skeptics. Counterpoint noted below (CT-STEM meta-analysis) reports far-transfer effects, but those studies typically lack the active-control and bias corrections Sala & Gobet apply.

### Working memory training does not enhance older adults' cognitive skills
- **Citation**: Sala, G., et al. (2019). *Intelligence*, 77, 101386.
- **Link**: https://doi.org/10.1016/j.intell.2019.101386
- **Date accessed / recency**: Aug 2, 2026. 2019.
- **Type**: Three robust-variance-estimation meta-analyses (N = 2,140; m = 43; k = 698)
- **Population**: Older adults. **[ADULT, but older than the LSAT population]**
- **Key finding**: Large effects on the *trained tasks themselves* (*ḡ* = 0.877), modest near transfer (*ḡ* = 0.274), near-zero far transfer (*ḡ* = 0.121) — and **when active control groups were used, far transfer was exactly null (*ḡ* = −0.008)**. Effects were highly consistent across studies (low true heterogeneity).
- **Relevance to this product**: The gradient — trained task 0.88 → near transfer 0.27 → far transfer 0.00 — is the single most useful number set in this section. **It quantifies how fast benefit decays with structural distance from what was practiced.** Product implication: every design decision that makes practice items *less* like real LSAT items (custom question formats, gamified variants, simplified stimuli) is spending down a steep gradient.
- **Confidence / caveats**: Older adults, working-memory training specifically. The 0.88/0.27/0.00 gradient is a reasonable general prior, not an LSAT-specific measurement.

### Near and far transfer in cognitive training: a second-order meta-analysis
- **Citation**: Sala, G., Aksayli, N. D., Tatlidil, K. S., Tatsumi, T., Gondo, Y., & Gobet, F. (2019). *Collabra: Psychology*, 5(1), 18.
- **Link**: https://doi.org/10.31234/osf.io/9efqd
- **Date accessed / recency**: Aug 2, 2026. 2019. Primary source behind the Gobet & Sala (2023) review.
- **Type**: Second-order meta-analysis
- **Population**: Children, adults, older adults. **[K-12 + ADULT]**
- **Key finding**: Working-memory training induces near transfer, moderated by population. Far transfer effects are small or null; **when placebo effects and publication bias were controlled, "the overall effect size and true variance equaled zero."**
- **Relevance to this product**: Logged as the primary source; same implication as above.
- **Confidence / caveats**: High.

### The transfer effect of computational thinking (CT)-STEM: systematic review and meta-analysis
- **Citation**: (2024). *International Journal of STEM Education*, 11, 44.
- **Link**: https://link.springer.com/article/10.1186/s40594-024-00498-z
- **Date accessed / recency**: Aug 2, 2026. 2024 — current.
- **Type**: Meta-analysis, 37 studies, 7,832 students, 96 effect sizes
- **Population**: Predominantly K-12 students. **[K-12]**
- **Key finding**: Overall transfer *g* = 0.601; **near transfer *g* = 0.645; far transfer *g* = 0.444** (95% CI [0.312, 0.576]) to generic skills including creativity, critical thinking, and problem solving. Cognitive benefits (*g* = 0.628) exceeded noncognitive (*g* = 0.510).
- **Relevance to this product**: **Included specifically as contradictory evidence.** This meta-analysis reports substantial far transfer, in direct conflict with Sala & Gobet. The reasons to weight Sala & Gobet more heavily: this analysis is K-12 only, does not appear to apply placebo/active-control or publication-bias correction of the kind Sala & Gobet insist on, and "far transfer" here is measured with generic critical-thinking instruments that overlap conceptually with the training. The founder should know this disagreement exists rather than be given a false consensus.
- **Confidence / caveats**: Moderate-to-low confidence in the far-transfer estimate for the reasons above. Genuine disagreement in the field.

### Evaluation of the effectiveness of critical thinking training by mixed-meta method
- **Citation**: (2025). *Review of Education*. doi:10.1002/rev3.70001
- **Link**: https://doi.org/10.1002/rev3.70001
- **Date accessed / recency**: Aug 2, 2026. 2025 — current.
- **Type**: Mixed meta-analysis + meta-thematic analysis
- **Population**: Predominantly primary and secondary students. **[K-12]**
- **Key finding**: Critical-thinking training contributes positively to cognitive, affective, and social domains and to academic achievement and critical-thinking skills.
- **Relevance to this product**: **Low value / partial dead end.** The paper does not report a clean pooled effect size in the accessible abstract, is K-12-focused, and its outcome measures are critical-thinking instruments rather than performance on an independent high-stakes criterion. Logged for completeness; it is the kind of source that would let one claim "teaching reasoning works" without actually supporting it.
- **Confidence / caveats**: Low. Do not rely on it.

### The active ingredient in reading comprehension strategy intervention: a Bayesian network meta-analysis
- **Citation**: (2024). *Review of Educational Research*, 94(2), 228–267. ERIC EJ1414842.
- **Link**: https://eric.ed.gov/?id=EJ1414842
- **Date accessed / recency**: Aug 2, 2026. 2024 — current.
- **Type**: Bayesian network meta-analysis, 52 studies
- **Population**: Grades 3–12 students with reading difficulties. **[K-12]**
- **Key finding**: Four results, all directly transferable in structure to LSAT Reading Comprehension strategy design. **(1) Teaching MORE strategies did not produce stronger effects. (2) No single strategy was strongest. (3) Main idea + text structure + retell, taught TOGETHER as primary strategies, was the most effective combination. (4) Strategy effects held ONLY when background-knowledge instruction was included.** The authors describe this as an "ingredient-interaction model" and explicitly reject "the more we teach, the better."
- **Relevance to this product**: **This is a direct challenge to the app's ~13 named strategies.** The best available evidence on strategy-count says that a large menu of named strategies is not better than a small one, and may be worse. It suggests consolidating to a small core set (for RC: identify main point, map passage structure, summarize) rather than expanding the strategy library. The background-knowledge finding also matters: strategies only worked when paired with content knowledge, which for LSAT RC means familiarity with the recurring passage domains (law, science, humanities, social science).
- **Confidence / caveats**: **[K-12] and struggling readers specifically — a real transfer gap to adult LSAT candidates who are, by selection, strong readers.** But the "more strategies ≠ better" result is a design warning that should be taken seriously given how cheap it is to heed.

### Inference instruction meta-analysis
- **Citation**: (2024). *Journal of Educational Psychology*. APA manuscript 2024-63383-001.
- **Link**: https://psycnet.apa.org/manuscript/2024-63383-001.pdf
- **Date accessed / recency**: Aug 2, 2026. 2024 — current.
- **Type**: Meta-analysis, 56 studies, N = 5,088, 81 independent samples, 138 effect sizes, robust variance estimation
- **Population**: **Preschool to adulthood** — explicitly includes adults. **[K-12 + ADULT]**
- **Key finding**: Inference instruction had a moderate positive effect on comprehension outcomes — approximately **half a standard deviation**. Notably: **instruction where students read the text independently was far more effective (*g* = 0.79) than instruction where text was read TO students (*g* = 0.28).** Study quality was tested as a moderator across six characteristics and **found no significant differences** between higher- and lower-quality studies. Effects held "regardless of age, reading ability, type of instruction, and text."
- **Relevance to this product**: The most directly LSAT-relevant strategy-instruction finding in this section. LSAT Reading Comprehension and Logical Reasoning are fundamentally *inference* tasks, and instruction in inference generation — including "practice with inferential questions," which is literally what the app does — produces ~0.5 SD gains that hold across age and ability. The independent-reading moderator (0.79 vs. 0.28) also argues against any feature that reads or summarizes passages *for* the student.
- **Confidence / caveats**: Good confidence — large, RVE, quality-moderator tested. Comprehension outcomes are not LSAT scores, but the construct overlap is high.

### Impact of reading strategy instruction on strategy use and reading comprehension: a meta-analysis
- **Citation**: (2024/2025). *Language Learning & Technology* / doi:10.64152/10125/67505
- **Link**: https://doi.org/10.64152/10125/67505
- **Date accessed / recency**: Aug 2, 2026. Recent.
- **Type**: Meta-analysis, 27 articles
- **Population**: **English L2 learners** — a substantial transfer caveat. **[K-12 + ADULT, L2]**
- **Key finding**: Medium-to-large effects (*g* = 0.62–1.24, p < .001) on both strategy use and reading comprehension.
- **Relevance to this product**: **Weak relevance / near dead end for this product.** L2 reading-strategy instruction addresses a bottleneck (language processing) that LSAT candidates do not have. The large effect sizes here should NOT be transferred to the LSAT population. Logged because it is the kind of result that could easily be misapplied.
- **Confidence / caveats**: Low transferability. Effects also include within-group pre-post comparisons, which inflate estimates.

### Adult basic education reading meta-analysis
- **Citation**: (2023). *Review of Educational Research*. KU CRL manuscript.
- **Link**: https://kucrl.ku.edu/sites/kucrl/files/files/RER%20Manuscript%203-28-23.pdf
- **Date accessed / recency**: Aug 2, 2026. 2023.
- **Type**: Meta-analysis, 17 experimental/quasi-experimental studies, 198 effect sizes, N = 2,340
- **Population**: **Adult Basic Education students** — adults, but low-literacy adults. **[ADULT]**
- **Key finding**: Overall *g* = 0.168 (p < 0.001, 95% CI [0.113, 0.222]) — **small**. Word-level interventions *g* = 0.154; comprehension-type interventions *g* ≈ 0.21; **vocabulary interventions were not significant (*g* = 0.059, p = 0.436)**. Heterogeneity substantial (I² = 60.8%).
- **Relevance to this product**: A sobering adult-population anchor. When you move reading interventions from children in schools to *adults choosing to improve*, effect sizes drop to roughly *g* = 0.17 — about a third of what the K-12 literature reports. This is the best single quantitative illustration of why the **[K-12]** flags in this document matter. The LSAT population is different again (high-ability adults), but the direction of the adjustment is clear: **discount K-12 effect sizes substantially before projecting them onto this product.**
- **Confidence / caveats**: ABE students are low-literacy adults, at the opposite end of the ability distribution from LSAT candidates. The transfer is about *adulthood and voluntariness*, not ability level.

### Reading comprehension interventions in the German language
- **Citation**: (2024). *Zeitschrift für Pädagogische Psychologie*. doi:10.1024/1010-0652/a000397
- **Link**: https://doi.org/10.1024/1010-0652/a000397
- **Date accessed / recency**: Aug 2, 2026. 2024 — current.
- **Type**: Meta-analysis, 45 intervention-control samples, N = 6,402, 88 effect sizes
- **Population**: Primary, secondary, and post-secondary German-language students. **[K-12 + ADULT]**
- **Key finding**: Immediate post-test *d* = 0.37; follow-up *d* = 0.31; **long-term (up to 20 weeks) *d* = 0.28**. All the long-term interventions were strategy instruction. Authors note effects are smaller than previously reported and flag **potential publication bias**.
- **Relevance to this product**: Useful because it tracks *decay*. Strategy instruction gains hold up reasonably: 0.37 → 0.31 → 0.28 over roughly 20 weeks, which is longer than a typical LSAT prep cycle. This is genuine evidence that strategy instruction is not purely a testing-day trick.
- **Confidence / caveats**: German-language, mostly secondary school; long-term subset is only 6 samples from 3 studies (N = 1,370). Publication bias acknowledged by the authors.

### Teaching for near transfer: is maths instruction aimed at schema formation associated with answering unfamiliar questions?
- **Citation**: (2024). *Learning and Individual Differences*, 111, 102609.
- **Link**: https://doi.org/10.1016/j.lindif.2024.102609
- **Date accessed / recency**: Aug 2, 2026. 2024 — current.
- **Type**: Observational/associational study + literature synthesis
- **Population**: School pupils, mathematics. **[K-12]**
- **Key finding**: The framing is the value here: **"even near transfer appears to regularly fail."** The word-problem literature shows students who demonstrably understand the underlying mathematics often cannot solve the same problem expressed differently — *"students are sometimes unable to transfer their learning to the very same problem, expressed differently."* Whether near transfer succeeds appears to depend heavily on how the material was taught (schema formation and abstraction vs. procedure memorization).
- **Relevance to this product**: A crucial caution against surface-feature learning. If a student learns "when I see the words 'depends on the assumption that,' pick the answer with a negation," they have learned a surface rule that will fail on a rephrased item. **The app's ~13 named strategies are at risk of being taught as surface procedures.** The countermeasure the literature supports is instruction aimed at schema formation and abstraction — i.e., framing strategies around *argument structure* rather than *question-stem keywords*.
- **Confidence / caveats**: Associational, K-12, mathematics. The claim is a synthesis of prior work rather than a new causal result. Directionally important.

**Section 6 verdict:** The founder should abandon any implicit claim that the app improves reasoning ability. Far transfer from training is null (corrected effect = 0.00) and this is one of the most robust negative findings in psychology. But this is not bad news, because **LSAT prep is a near-transfer problem** — and near transfer is real (*ḡ* ≈ 0.27 in the strictest analyses, ~0.5 SD for inference instruction specifically, holding across age and ability). Two design consequences: **maximize structural fidelity to the real test**, and **teach strategies as schemas about argument structure, not as keyword-triggered procedures**. Also: the strategy library is probably too large — the best network meta-analysis on strategy instruction found more strategies did not mean better outcomes.

---

## Section 7 — Deliberate Practice: What Volume Actually Buys

### Deliberate practice and performance in music, games, sports, education, and professions: a meta-analysis
- **Citation**: Macnamara, B. N., Hambrick, D. Z., & Oswald, F. L. (2014). *Psychological Science*, 25(8), 1608–1618. Plus Corrigendum (2018), doi:10.1177/0956797618769891.
- **Link**: https://doi.org/10.1177/0956797614535810 ; corrigendum https://journals.sagepub.com/doi/10.1177/0956797618769891
- **Date accessed / recency**: Aug 2, 2026. 2014 + 2018 corrigendum. 639+ citations. No 2024–2026 update found.
- **Type**: Meta-analysis across all major deliberate-practice domains
- **Population**: Musicians, athletes, chess/game players, students, professionals. **[ADULT mostly]**
- **Key finding**: Deliberate practice explained **26% of variance for games, 21% for music, 18% for sports, 4% for EDUCATION (corrected to 5% in the 2018 corrigendum, r̄ = .22), and <1% for professions (r = .05, p = .62, n.s.).** Domain was a significant moderator (Q(4) = 49.09, p < .001). **Predictability of the task environment was also a significant moderator: 24% of variance explained for highly predictable activities, 12% for moderately predictable, 4% for low-predictability activities.**
- **Relevance to this product**: **The two most important numbers in this document for the founder's thesis.** (1) **In education, accumulated practice explains only ~4–5% of performance variance.** That is a direct, quantitative rebuttal of "all they need is lots of practice." (2) **But the predictability moderator is the founder's best defense.** The LSAT is an extraordinarily *predictable* task environment — a fixed, published item taxonomy, stable answer-construction conventions, and a scoring scale unchanged for decades. That places it toward the "highly predictable" end where practice explains ~24% of variance, much closer to chess (26%) than to generic "education" (4%). The honest reading: **practice volume matters far more for the LSAT than for education broadly, precisely because the LSAT is a closed, rule-governed game — but it still leaves ~75% of variance to other factors.**
- **Confidence / caveats**: Correlational studies of accumulated practice, so causality is not established and reverse causation (better performers practice more) is live. The education subgroup is heterogeneous. The predictability argument for the LSAT is *my* inference from the moderator, not a finding about the LSAT.

### Deliberate practice and proposed limits on the effects of practice: why the original definition matters
- **Citation**: Ericsson, K. A., & Harwell, K. W. (2019). *Frontiers in Psychology*, 10, 2396.
- **Link**: https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2019.02396/full
- **Date accessed / recency**: Aug 2, 2026. 2019 — Ericsson's definitive rebuttal.
- **Type**: Critique + reanalysis of Macnamara et al.'s dataset
- **Population**: Same underlying studies
- **Key finding**: Ericsson argues Macnamara et al. measured *structured practice*, not deliberate practice, whose original definition requires **(a) individualized training tasks selected by a supervising teacher to target the learner's specific weaknesses, (b) a clear performance goal, and (c) immediate informative feedback.** Excluding effect sizes failing these criteria, **accumulated practice explained 29% of variance, or 61% after correction for attenuation** (r = 0.54, 95% CI [0.44, 0.63]). He notes that 88% of the education-domain effect sizes came from studies that never used the term "deliberate practice" anywhere except the reference list.
- **Relevance to this product**: **This is the strongest pro-product argument in the entire review, and it doubles as a specification.** Ericsson's three criteria are precisely what distinguishes LSAT Speedrun from a PDF of past exams: (a) the app individualizes item selection via the review queue and bandit; (b) each item has a clear correct/incorrect goal; (c) the LLM delivers immediate informative feedback. **If the founder wants the 29–61% figure rather than the 4% figure, the product must satisfy all three criteria — and the criteria are a design checklist, not a slogan.** The weakest of the three today is (a): genuinely individualized item selection targeting each student's specific weaknesses.
- **Confidence / caveats**: **Ericsson is an interested party and the reanalysis is contested** (see next entry). The 61% attenuation-corrected figure is the most aggressive number in this literature and should not be quoted as settled. Treat the *criteria* as the durable takeaway, not the percentage.

### Is the deliberate practice view defensible? A review of evidence and discussion of issues
- **Citation**: Hambrick, D. Z., Macnamara, B. N., & Oswald, F. L. (2020). *Frontiers in Psychology*, 11, 1134.
- **Link**: https://doi.org/10.3389/fpsyg.2020.01134
- **Date accessed / recency**: Aug 2, 2026. 2020 — the counter-rebuttal.
- **Type**: Review + methodological critique of the reanalyses
- **Population**: N/A
- **Key finding**: Documents that Miller et al.'s (2018) reanalysis found *r* = 0.40 for "deliberate practice" vs. Macnamara's original *r* = 0.38 — i.e., **essentially no difference** — and that numerous studies Miller et al. coded as deliberate practice did not meet their own stated inclusion criteria (e.g., a chess study whose authors explicitly disclaimed measuring deliberate practice). Argues the reanalyses either miscoded studies or used criteria different from those they reported.
- **Relevance to this product**: The honest bottom line for the founder: **this is an unresolved, personally acrimonious dispute between two camps, and both have motivated reasoning.** The defensible middle position is that practice quantity is a real but far-from-sufficient predictor; that *quality* attributes (individualization, clear goals, immediate feedback) plausibly matter but are hard to measure; and that no one has a credible number for a task like the LSAT. Anyone quoting either 4% or 61% as "the answer" is overclaiming.
- **Confidence / caveats**: High confidence in the description of the dispute, low confidence that any single variance estimate is correct.

### Summing up hours of any type of practice versus identifying optimal practice activities
- **Citation**: Ericsson, K. A. (2016). *Perspectives on Psychological Science*, 11(3), 351–354.
- **Link**: https://journals.sagepub.com/doi/abs/10.1177/1745691616635600
- **Date accessed / recency**: Aug 2, 2026. 2016.
- **Type**: Commentary
- **Population**: N/A
- **Key finding**: Ericsson's core methodological objection: summing every hour of every type of practice assumes all practice hours are equally valuable, an assumption he argues is inconsistent with the evidence. Calls for research measuring *quality* of practice — concentration, analysis, problem solving — not just duration.
- **Relevance to this product**: **A directly actionable metric recommendation.** The app should not measure or reward raw questions-completed or minutes-in-app. It should measure and reward practice *quality*: items attempted at the edge of the student's competence, with genuine effort, followed by processed feedback. This has an uncomfortable implication for the gamification layer, which currently rewards volume-shaped behavior (streaks, case fees per question).
- **Confidence / caveats**: Commentary, no new data. But the metric-design point stands independent of who wins the variance dispute.

### Given that the detailed original criteria for deliberate practice have not changed... (response to Macnamara & Hambrick 2020)
- **Citation**: Ericsson, K. A. (2020/2021). *Psychological Research*. doi:10.1007/s00426-020-01368-3
- **Link**: https://link.springer.com/content/pdf/10.1007/s00426-020-01368-3.pdf
- **Date accessed / recency**: Aug 2, 2026. 2020/21.
- **Type**: Rejoinder
- **Population**: N/A
- **Key finding**: Reiterates that studies in the education domain of Macnamara's meta-analysis measured things like watching TV coverage of one's sport, coach-led team practice (not individualized), and middle-school students studying at home — and that Plant et al. (2005), one of the cited sources, actually concluded that **student study hours do NOT measure effective practice.**
- **Relevance to this product**: **Mostly a dead end for new information** — it is the fourth round of the same argument. Logged for completeness and because the Plant et al. point is genuinely useful: *hours studied* is a bad proxy for *effective practice*, which is a warning about the app's own analytics.
- **Confidence / caveats**: Partisan rejoinder. No new data.

**Section 7 verdict:** Volume alone is weak. In the education domain, accumulated practice explains ~4–5% of performance variance, and even Ericsson's most favorable reanalysis of *properly individualized, goal-directed, immediately-fed-back* practice reaches only 29% (61% under an aggressive attenuation correction that should be discounted). Two things rescue the founder's thesis partway: **the LSAT is an unusually predictable task environment**, where the moderator analysis suggests practice explains closer to 24% of variance; and **the app is architecturally capable of satisfying all three of Ericsson's original criteria**, which is what separates "practice" from "deliberate practice." The actionable conclusion is that the product's differentiator is not item count — it is individualization of item selection.

---

## Section 8 — Gamification in Serious / Adult / High-Stakes Learning
*(The founder's key concern: is the app too gamified to be taken seriously, and does gamification help or hurt learning outcomes?)*

### The gamification of learning: a meta-analysis
- **Citation**: Sailer, M., & Homner, L. (2020). *Educational Psychology Review*, 32(1), 77–112.
- **Link**: https://doi.org/10.1007/s10648-019-09498-w ; https://eric.ed.gov/?id=EJ1245270
- **Date accessed / recency**: Aug 2, 2026. 2020 — the most methodologically careful gamification meta-analysis and still the field's reference point.
- **Type**: Meta-analysis with methodological-rigor subsplit analysis
- **Population**: Mixed education levels. **[K-12 + ADULT]**
- **Key finding**: Small significant effects: **cognitive *g* = 0.49** (95% CI [0.30, 0.69], k = 19, N = 1,686); **motivational *g* = 0.36** (k = 16, N = 2,246); **behavioral *g* = 0.25** (k = 9, N = 951). Crucially: **the cognitive effect remained stable when restricted to high-methodological-rigor studies, while motivational and behavioral effects became less stable.** Moderators: **including game FICTION (narrative) and combining COMPETITION WITH COLLABORATION were the design elements that significantly boosted behavioral outcomes.** Duration was not a significant moderator for cognitive or behavioral outcomes, weakening the "novelty effect" objection; for motivational outcomes, interventions of a month to half a year showed medium effects while one-day interventions were non-significant — motivation may take *longer* to move, not shorter.
- **Relevance to this product**: **The most reassuring source in this section, with two specific endorsements of what LSAT Speedrun already built.** (1) The cognitive-learning effect (*g* = 0.49) is the one that survives methodological scrutiny — so gamification is not merely an engagement trick. (2) **Game fiction was a significant positive moderator.** The story mode with narrative chapters and the law-office tycoon fiction are, on this evidence, the *right kind* of gamification, not the frivolous kind. (3) The duration null undercuts the "it'll wear off" worry. What the app is missing from the supported list is the **collaboration** half of "competition augmented with collaboration."
- **Confidence / caveats**: k = 9–19 per outcome is small. The comparison condition varies across studies. Note the tension with Section 8's other sources: this is the most favorable credible estimate, and the SDT-focused meta-analysis below is much less favorable.

### Gamification enhances intrinsic motivation, autonomy and relatedness, but minimal impact on competency
- **Citation**: Li, L., Hew, K. F., & Du, J. (2024). *Educational Technology Research and Development*, 72(2), 765–796.
- **Link**: https://doi.org/10.1007/s11423-023-10337-7
- **Date accessed / recency**: Aug 2, 2026. 2024 — current.
- **Type**: Meta-analysis (35 independent interventions, N ≈ 2,500) + systematic review of 31 studies
- **Population**: Students, 2011–2022 studies. **[K-12 + ADULT]**
- **Key finding**: Overall effect on intrinsic motivation is **significant but SMALL: *g* = 0.257 (95% CI [0.043, 0.471], p = .019), with no evidence of publication bias.** Decomposed by SDT need: **autonomy *g* = 0.638; relatedness *g* = 1.776; but competence only *g* = 0.277** (95% CI [0.001, 0.553], p = .049 — barely significant, CI nearly touching zero). The accompanying systematic review identified the two main obstacles as **students' lack of perceived competence and lack of perceived autonomy in gamified classes.**
- **Relevance to this product**: **The single most important diagnostic in this section.** Gamification reliably delivers *autonomy* and *relatedness* but barely moves *competence* — and for an LSAT student, **competence is the only need that actually correlates with the outcome they came for.** A student who feels autonomous and connected but not more capable will churn. This suggests reallocating gamification design effort away from cosmetics/economy (autonomy-flavored) and toward **visible, credible competence signals**: mastery meters per question type, a predicted score that moves, "you now get Flaw questions right 78% of the time, up from 51%." Those are game mechanics *and* competence signals at once.
- **Confidence / caveats**: The relatedness effect (*g* = 1.776) has an enormous CI [0.737, 2.814] and is based on few studies — do not take it literally. The competence null is the robust and product-relevant finding. Also note: LSAT Speedrun is largely single-player, so the relatedness channel is mostly unavailable to it anyway.

### The impact of different combinations of game elements on student learning outcomes: a multilevel meta-analysis
- **Citation**: (2024). *Studies in Higher Education*. doi:10.1080/03075079.2024.2416498
- **Link**: https://doi.org/10.1080/03075079.2024.2416498
- **Date accessed / recency**: Aug 2, 2026. 2024 — current.
- **Type**: Multilevel meta-analysis, 143 effect sizes from 32 studies (2013–2024)
- **Population**: **Higher education students specifically.** **[ADULT]**
- **Key finding**: Gamified learning *g* = 0.515 overall. **Cognitive outcomes *g* = 0.716; skill-based *g* = 0.605; affective *g* = 0.317.** The most effective element combinations for cognitive outcomes were "Performance/Measurement + Ecological + Social + Personal"; for skill-based, "Performance/Measurement + Social + Personal." **Performance/Measurement elements (points, progress bars, feedback on performance) appear in every winning combination.** Learning domain and intervention duration were moderators.
- **Relevance to this product**: An adult-population estimate that is more favorable than Li et al. and points in a consistent direction: **the game elements that carry the learning effect are the measurement/feedback ones, not the reward ones.** Progress indicators, performance tracking, and level/mastery displays are doing the work. "Ecological" (environment/world) and "Personal" (avatar, customization) elements also appear — which is a partial defense of the tycoon world and cosmetics, as long as they sit on top of a strong performance-measurement layer rather than replacing it.
- **Confidence / caveats**: Element combinations were derived post hoc from a taxonomy; the specific combination recommendations are exploratory. Effect sizes are notably higher than Sailer & Homner's, likely reflecting weaker rigor controls.

### Examining the effectiveness of gamification as a tool promoting teaching and learning: a meta-analysis
- **Citation**: (2023). *Frontiers in Psychology*, 14, 1253549. PMC10591086.
- **Link**: https://pmc.ncbi.nlm.nih.gov/articles/PMC10591086/
- **Date accessed / recency**: Aug 2, 2026. 2023.
- **Type**: Meta-analysis, 41 studies, 49 independent samples, N > 5,071
- **Population**: Primary through higher education. **[K-12 + ADULT]**
- **Key finding**: Overall *g* = 0.822 (95% CI [0.567, 1.078]). But the moderator analysis is wild: **primary school *g* = 1.293 vs. secondary school *g* = 0.014 (Q-between = 10.010, p = .002); higher education *g* = 0.869 vs. secondary *g* = 0.014 (Q-between = 15.757, p < .001).** By discipline: science *g* = 3.220, math *g* = 2.005, engineering/computing *g* = 0.998, social science *g* = 0.472, **business *g* = 0.031.**
- **Relevance to this product**: I include this mainly as a **credibility warning about the gamification literature itself.** Effect sizes of *g* = 3.220 for science are not plausible; they indicate small, low-quality primary studies. The higher-education estimate (*g* = 0.869) is the relevant cell for this product but should be discounted heavily toward Sailer & Homner's more rigorous *g* = 0.49. The one genuinely useful signal: **secondary-school effects were essentially zero (*g* = 0.014) while higher-education effects were large** — gamification is not automatically a "kid stuff" intervention, and there is no evidence base saying adults reject it.
- **Confidence / caveats**: Low confidence in magnitudes. Publication type was tested and found non-significant as a moderator, which the authors take as reassurance but which is weak evidence against publication bias given the implausible extremes.

### Effects of gamification on behavioral change in education: a meta-analysis
- **Citation**: (2021). *International Journal of Environmental Research and Public Health*, 18(7), 3550.
- **Link**: https://www.mdpi.com/1660-4601/18/7/3550
- **Date accessed / recency**: Aug 2, 2026. 2021.
- **Type**: Meta-analysis of controlled experimental designs, 2010–2019
- **Population**: K-12, college, and adult learners. **[K-12 + ADULT]**
- **Key finding**: Overall *d* = 0.48 (95% CI [0.33, 0.62]). **Adults in higher education *ES* = 0.95; K-12 *ES* = 0.92; but college students *ES* = 0.15 (95% CI [−0.04, 0.35] — non-significant).** Critically on duration: **interventions under one hour *ES* = 1.57; 2–16 weeks *ES* = 0.39; 1–2 years *ES* = −0.20 (i.e., NEGATIVE).** "Interventions incorporating gamification elements across years was adversely associated with behavioral change."
- **Relevance to this product**: **This is the strongest evidence for the novelty-decay concern, and it directly contradicts Sailer & Homner's duration null.** The gradient 1.57 → 0.39 → −0.20 says gamification's behavioral effect is front-loaded and eventually inverts. An LSAT prep cycle is typically 3–6 months — squarely in the 2–16 week to sub-year band where the effect is real but modest (*ES* ≈ 0.39) and falling. The honest product implication: **treat gamification as an activation and habit-formation tool for the first weeks, and design the product so that by month three the student is being held by score progress rather than by cash and cosmetics.** The app's career map / firm tiers structure is actually well-suited to this if tiers are gated on *measured skill* rather than on accumulated currency.
- **Confidence / caveats**: The college-student cell being non-significant (*ES* = 0.15) while "adults in higher education" is *ES* = 0.95 is internally confusing and suggests unstable coding. Behavioral change, not learning outcomes. Moderate confidence in the duration gradient's *direction*, low confidence in the magnitudes.

### Gamification suffers from the novelty effect but benefits from the familiarization effect: a longitudinal study
- **Citation**: Rodrigues, L., et al. (2021). *International Journal of Educational Technology in Higher Education*, 18, 55.
- **Link**: https://link.springer.com/article/10.1186/s41239-021-00314-6
- **Date accessed / recency**: Aug 2, 2026. 2021.
- **Type**: 14-week longitudinal study
- **Population**: CS1 STEM undergraduates. **[ADULT]**
- **Key finding**: Directly tests the duration question using a design featuring **both** fictional and competitive-collaborative elements (the combination Sailer & Homner identified as optimal). Finds gamification's effect is subject to a novelty effect (initial boost that decays) but *also* a familiarization effect (users who stay get more out of it as they learn the system).
- **Relevance to this product**: The two-force framing is more useful than a single decay curve: early users are over-responding to novelty, and long-term users are under-responding until they understand the system. Product implication: **don't judge gamification features on week-1 engagement metrics** — they will look better than they are — and don't kill them on week-8 metrics either, since familiarization is still accruing.
- **Confidence / caveats**: Single study, one course, CS students. 14 weeks is short relative to the 1–2 year window where the meta-analysis above found negative effects.

### When do extrinsic rewards undermine intrinsic motivation? A meta-analysis
- **Citation**: (2024). Doctoral dissertation / meta-analysis, University of Turku (UTUPub 10024/173853). Updates Deci, Koestner, & Ryan (1999).
- **Link**: https://www.utupub.fi/items/67992930-a325-47d5-ab87-90d42f9adcc9/full
- **Date accessed / recency**: Aug 2, 2026. 2024 — the most recent comprehensive treatment of the overjustification question.
- **Type**: Meta-analysis of experiments + separate meta-analysis of observational studies
- **Population**: Broad; age is a tested moderator. **[K-12 + ADULT]**
- **Key finding**: Undermining of free-choice intrinsic motivation: **all rewards *d* = −0.28; tangible rewards *d* = −0.39; expected rewards *d* = −0.41.** By contingency: **engagement-contingent *d* = −0.42; completion-contingent *d* = −0.48; performance-contingent *d* = −0.24.** No significant undermining when rewards are **unexpected (*d* = −0.04)** or **not tied to a specific task (*d* = 0.10)**. **The only clear enhancement is positive feedback: *d* = +0.33** (free-choice) and *d* = +0.26 (self-reported interest). On self-reported interest, **performance-contingent rewards were actually slightly POSITIVE (*d* = +0.11)** while engagement-contingent rewards were negative (*d* = −0.16). In observational (real-world) studies, the overall association was non-significant, and performance-based rewards showed *r* = 0.05 (n.s.).
- **Relevance to this product**: **This is the most directly actionable finding in Section 8, and it gives a precise design rule.** The app's reward structure should be audited against this contingency table:
  - **Rewards for merely engaging (streaks, daily-login bonuses, per-question cash): *d* = −0.42. The worst category.** These are exactly the mechanics most ed-tech apps lean on hardest.
  - **Rewards for completing a set number of items: *d* = −0.48. The worst category of all.**
  - **Rewards contingent on PERFORMANCE (accuracy, mastery, score improvement): *d* = −0.24 on free-choice behavior but *d* = +0.11 on self-reported interest** — by far the least damaging and possibly net-positive.
  - **Unexpected rewards: *d* = −0.04 — essentially harmless.**
  - **Positive informational feedback: *d* = +0.33 — the only reliably motivating "reward."**

  The concrete recommendation: **shift the game economy from engagement/completion contingency to performance contingency and surprise**, and lean hardest on the thing that actually enhances motivation — specific, competence-affirming feedback. This is a change in *what* triggers rewards, not a removal of the game layer.
- **Confidence / caveats**: High confidence — this replicates and extends the classic Deci et al. (1999) meta-analysis of 128 studies (which found engagement-contingent *d* = −0.40, completion-contingent *d* = −0.36, performance-contingent *d* = −0.28; positive feedback *d* = +0.33). The convergence across 25 years is strong. Caveat: mostly lab experiments with free-choice behavioral measures; the observational meta-analysis found no significant real-world association, which is a meaningful weakening. Age moderates several effects, and tangible rewards were *more* detrimental for children than for college students — mildly reassuring for an adult product.

### A meta-analytic review of experiments examining the effects of extrinsic rewards on intrinsic motivation
- **Citation**: Deci, E. L., Koestner, R., & Ryan, M. (1999). *Psychological Bulletin*, 125(6), 627–668.
- **Link**: https://pubmed.ncbi.nlm.nih.gov/10589297/
- **Date accessed / recency**: Aug 2, 2026. 1999 — the foundational overjustification meta-analysis.
- **Type**: Meta-analysis, 128 studies
- **Population**: Children and college students. **[K-12 + ADULT]**
- **Key finding**: Engagement-, completion-, and performance-contingent rewards undermined free-choice intrinsic motivation (*d* = −0.40, −0.36, −0.28). Positive feedback enhanced both free-choice behavior (*d* = 0.33) and self-reported interest (*d* = 0.31). **Tangible rewards were more detrimental for children than for college students; verbal rewards were less enhancing for children than for college students.**
- **Relevance to this product**: The age moderator is the good news: **the undermining effect of tangible rewards is weaker in college-age adults**, which is the LSAT population. It is not absent, but the founder's fear that gamification will destroy a serious student's motivation is not well-supported at adult ages.
- **Confidence / caveats**: Extremely well-cited and heavily contested at the time (Eisenberger & Cameron argued the opposite). The 2024 replication above resolves most of that dispute in Deci et al.'s favor.

### Intrinsic motivation and extrinsic incentives jointly predict performance: a 40-year meta-analysis
- **Citation**: Cerasoli, C. P., Nicklin, J. M., & Ford, M. T. (2014). *Psychological Bulletin*, 140(4), 980–1008.
- **Link**: https://doi.org/10.1037/a0035661
- **Date accessed / recency**: Aug 2, 2026. 2014.
- **Type**: Meta-analysis, k = 183, **N = 212,468** — school, work, and physical domains
- **Population**: Very broad, heavily adult. **[ADULT]**
- **Key finding**: **Intrinsic motivation is a medium-to-strong predictor of performance (ρ = .21–.45), and this held whether or not incentives were present.** The key moderated result: **intrinsic motivation mattered LESS to performance when incentives were DIRECTLY tied to performance, and MORE when incentives were INDIRECTLY tied** — a crowding-out pattern. And decisively for this product: **intrinsic motivation predicted more unique variance in QUALITY of performance, whereas incentives were a better predictor of QUANTITY of performance.** The authors conclude incentives and intrinsic motivation "are not necessarily antagonistic and are best considered simultaneously."
- **Relevance to this product**: **The cleanest theoretical statement of the gamification tradeoff for this exact product.** Extrinsic incentives buy you *quantity* — more questions attempted, more sessions started. Intrinsic motivation buys you *quality* — genuine engagement with hard items, real effort on explanations. LSAT score improvement needs both, but the evidence in Sections 5–7 says quality of practice matters more than raw volume. So the game layer should be tuned to get students *in the door and back tomorrow* (quantity) while being careful not to crowd out the intrinsic engagement that produces quality once they are there. Practically: **rewards at the session boundary, not inside the question loop.**
- **Confidence / caveats**: Very high confidence — N > 212,000, 40 years, published in *Psychological Bulletin*. Correlational at the level of intrinsic motivation, so causal claims are limited.

### Negative effects of gamification in education software: systematic mapping and practitioner perceptions
- **Citation**: (2022). *Information and Software Technology*, 156, 107142.
- **Link**: https://doi.org/10.1016/j.infsof.2022.107142
- **Date accessed / recency**: Aug 2, 2026. 2022.
- **Type**: Systematic mapping study (87 papers reporting negative effects) + developer focus group
- **Population**: Education/learning software users. **[K-12 + ADULT]**
- **Key finding**: **The game design elements most often reported as causing negative effects are, in order: badges, leaderboards, competitions, and points.** The most-cited negative effects: lack of effect, **worsened performance**, motivational issues, lack of understanding, and irrelevance. Ethical issues of **gaming the system and cheating** were also frequently reported. The developer focus group revealed practitioners were **unaware of most of these effects.**
- **Relevance to this product**: The named offenders — badges, leaderboards, competitions, points — are exactly the "BPL triad" that LSAT Speedrun's cash/reputation/streak systems instantiate. The "gaming the system" risk is concrete and severe here: **if case fees are paid per question answered, the dominant strategy is to answer fast and carelessly, which is anti-correlated with learning.** Any economy tied to volume creates an incentive to degrade practice quality. This is probably the sharpest specific risk in the current design.
- **Confidence / caveats**: A mapping study of papers *reporting* negative effects — by construction it is a biased sample and does not estimate how often negatives occur. Use it as a hazard list, not a base rate.

### Exploring the negative effects of gamification on students: a PRISMA-based systematic literature review
- **Citation**: (2025). *ICCA 2025*. doi:10.1109/icca66035.2025.11431021
- **Link**: https://doi.org/10.1109/icca66035.2025.11431021
- **Date accessed / recency**: Aug 2, 2026. 2025 — current.
- **Type**: PRISMA 2020 systematic literature review; 206 studies (2020–2025) screened → 20 included
- **Population**: Students. **[K-12 + ADULT]**
- **Key finding**: Negative impacts fall into four categories: **performance pressure and psychological strain; superficial learning effects; motivational engagement decline syndrome; and psychological distress and emotional strain.** Leaderboards, challenges, points, narratives, and rewards **weaken the three SDT needs (autonomy, competence, relatedness) if poorly designed.** Core mechanism: **"Gamification can shift students' focus from primary learning to competition, achievement, and performance demands."**
- **Relevance to this product**: "Superficial learning effects" is the failure mode that matters most for an LSAT product — a student optimizing for cash and firm tier rather than for understanding why answer choice D is wrong. The **performance-pressure** category is also worth attention: LSAT students are already anxious, and layering a game economy with visible stakes onto an already high-stakes activity can compound rather than relieve that. Note that this review lists **narratives** among the risky elements, which is in direct tension with Sailer & Homner's finding that game fiction was a *positive* moderator.
- **Confidence / caveats**: Only 20 studies included; qualitative categorization with no pooled effect sizes; conference paper. The narrative-is-risky finding contradicts stronger evidence and should be discounted.

### Gamification is not working: why?
- **Citation**: (2024). *Games and Culture*. doi:10.1177/15554120241228125
- **Link**: https://openurl.ebsco.com/contentitem/doi:10.1177/15554120241228125
- **Date accessed / recency**: Aug 2, 2026. 2024 — current.
- **Type**: Critical review
- **Population**: N/A
- **Key finding**: Four diagnosed causes of gamification's underperformance in education: **(1) "shallow gamification"** — bolting game elements onto a learning system without transforming the core experience; **(2) the overjustification effect** from excessive and arbitrary extrinsic rewards; **(3) over-reliance on the "badges, points, leaderboards" (BPL) triad**; and **(4) over-reliance on narrow theoretical models** (the authors argue SDT and flow theory are used too narrowly). Recommends "deep gamification" — designs that transform the core loop rather than decorate it.
- **Relevance to this product**: The shallow/deep distinction is the most useful framing available for the founder's "too gamified" worry. **The question is not "how much game is there" but "does the game live inside the learning loop or beside it."** A 3D law office that you decorate with earned cash is *beside* the loop — the game rewards do not shape how you practice. By contrast, the strategy-trial bandit with a silent control is *deep* — it is simultaneously a game mechanic (try a named technique, see if it works for you) and the learning intervention itself. The Method Lab economy sits ambiguously between the two. **The redesign question is which mechanics can be moved from beside-the-loop to inside-the-loop.**
- **Confidence / caveats**: Critical essay, not empirical. The critique of SDT is idiosyncratic and not widely shared. The shallow/deep framing is a useful heuristic, not a validated construct.

### The winner takes it all — effects of leaderboard-based feedback on cognitive performance and motivation
- **Citation**: (2025). *Learning and Individual Differences*, 118, 102836.
- **Link**: https://doi.org/10.1016/j.lindif.2025.102836
- **Date accessed / recency**: Aug 2, 2026. 2025 — current.
- **Type**: Randomized experiment, **N = 427**, five leaderboard conditions (position high/low × trend up/down, plus no-feedback control)
- **Population**: Adults. **[ADULT]**
- **Key finding**: Leaderboard feedback produced **small and non-substantial differences in cognitive performance**, but **significant differences in intrinsic motivation** — highest for *high position with upward trend*. **This held even though the feedback was FICTITIOUS and not based on actual performance.** Most important: **negative leaderboard feedback was more detrimental than NO feedback at all.** No moderating effect of individual achievement motives was found.
- **Relevance to this product**: A well-powered adult RCT with a clean, directly implementable conclusion: **an LSAT leaderboard will motivate the top of the distribution and actively harm the bottom, worse than showing nothing.** Since LSAT students at the bottom of a leaderboard are precisely the ones with the most to gain and the highest churn risk, a global leaderboard is a bad trade. The supported alternative is **personal-trend framing** — show each student their own upward trajectory, since the motivational lift came from *position + upward trend* and the effect appeared even when the comparison was not real.
- **Confidence / caveats**: Strong design (N = 427, randomized, fictitious feedback isolates the framing effect). Caveat: the task was a lab cognitive task over a short period, not a months-long prep cycle.

### The role of usability, aesthetics, usefulness and primary task support in predicting perceived credibility
- **Citation**: (2022). *Behaviour & Information Technology*, 41(16), 3617–3632.
- **Link**: https://ideas.repec.org/a/taf/tbitxx/v41y2022i16p3617-3632.html
- **Date accessed / recency**: Aug 2, 2026. 2022.
- **Type**: Survey study with PLS-SEM, using the Persuasive System Design framework
- **Population**: Adult users of academic social networking sites. **[ADULT]**
- **Key finding**: **Perceived Primary Task Support was the MOST relevant determinant of perceived credibility**, followed by Perceived Aesthetics and Perceived Usefulness. Perceived Usability was **not** a significant determinant.
- **Relevance to this product**: The closest thing I found to direct evidence on the founder's "will serious students take it seriously?" question, and the answer is encouraging but conditional. **Credibility is driven primarily by whether the system visibly supports the user's actual goal** — not by how polished or how sober it looks. A product that obviously and measurably helps you improve your LSAT score will be perceived as credible even with a cartoon law office attached; a product that is beautifully austere but doesn't visibly move your score will not. **The credibility fix is a visible, defensible score-progress narrative, not the removal of the game layer.**
- **Confidence / caveats**: Different domain (academic social networks), survey-based, cross-sectional, self-reported credibility. This is analogical evidence, not direct. But it is the best available and the mechanism is plausible.

### Design establishes trust and credibility / educational website design and student trust
- **Citation**: (a) Center for Engaged Learning (2024–25) synthesis, citing Larson, Cheng, Chen & Rolandi (2017) and Barness & Papaelias (2019). (b) (2025). *Journal of Posthumanism*, 5(2), 496.
- **Link**: https://www.centerforengagedlearning.org/design-establishes-trust-and-credibility/ ; https://doi.org/10.63332/joph.v5i2.496
- **Date accessed / recency**: Aug 2, 2026.
- **Type**: (a) Blog/synthesis of peer-reviewed work; (b) survey study, N = 1,215 students
- **Population**: (a) Readers of academic work; (b) university students. **[ADULT]**
- **Key finding**: (a) Larson et al. (2017) found that **graphical abstracts redesigned per visual-communication principles led readers to perceive the IDENTICAL research as more clearly written, more scientifically rigorous, and more interesting.** Typography, layout, and visual hierarchy shape perceptions of "professionalism, seriousness, and scholarly authority." (b) Fonts, images, colors, and menus significantly predicted student trust and satisfaction in an educational website.
- **Relevance to this product**: Confirms that visual register is a real credibility lever independent of content quality — the founder's instinct that a too-playful aesthetic could undercut perceived seriousness is directionally correct. **The practical resolution is register separation: the practice surfaces (question, timer, explanation, results) should read as sober and test-like; the meta-game surfaces (office, career map, story) can be playful.** This also has a learning rationale from Section 9 (context fidelity/encoding specificity), not just a marketing one.
- **Confidence / caveats**: (a) is a secondary source; I did not reach the Larson et al. primary study. (b) is a single-institution survey with self-reported trust, in Jordan, with no experimental manipulation. **Low-to-moderate confidence — this is the weakest evidence base in the entire document, and the "seriousness signaling in ed-tech" literature I was asked to look for essentially does not exist in rigorous form.** That is itself a finding: the founder's credibility concern cannot be resolved from the literature and must be tested with users.

**Section 8 verdict — direct answer to the founder's key question:**

1. **Gamification does not hurt learning outcomes on average; the cognitive-outcome effect (*g* ≈ 0.49) is the one that survives methodological scrutiny.** The "too gamified to be serious" worry is not supported as a *learning* claim. There is no evidence base showing adults reject gamified learning — higher-education effects are consistently among the largest, and secondary school is where they vanish.

2. **But gamification's benefit is concentrated in autonomy and relatedness, and it barely touches perceived competence (*g* = 0.277, CI nearly zero).** Competence is the only need that maps to LSAT score. So the current game layer is probably buying the wrong thing.

3. **The reward contingency is the highest-leverage fixable problem.** Engagement-contingent (*d* = −0.42) and completion-contingent (*d* = −0.48) rewards are the most damaging to intrinsic motivation; performance-contingent are much less so (*d* = −0.24, and *+0.11* on self-reported interest); unexpected rewards are harmless (*d* = −0.04); and informational positive feedback is the only reliably *enhancing* reward (*d* = +0.33). **Paying case fees per question answered is the single worst-designed incentive available.**

4. **Extrinsic incentives buy quantity; intrinsic motivation buys quality.** Since practice *quality* is what the rest of this document says drives score gains, keep the game rewards at session boundaries and out of the question loop.

5. **Drop or radically rethink competitive leaderboards.** In a well-powered adult RCT, negative leaderboard feedback was worse than no feedback, and the motivational lift came from *personal upward trend* — which can be delivered without ranking students against each other.

6. **The credibility question is not answerable from the literature.** The one relevant finding is that *primary task support* — visible evidence that the product advances your actual goal — is the dominant driver of perceived credibility, above aesthetics. **The founder's fear is best addressed by shipping a credible score-progress measurement, not by deleting the tycoon.** Register separation (sober practice surfaces, playful meta-game) is a low-cost hedge with an independent learning rationale.

---

## Section 9 — Full-Length Simulated Testing vs. Distributed Item Drilling
*(The founder's most important practical question. This section carries the strongest numbers in the document.)*

### Examining the relationship between full-length digital SAT practice tests and SAT performance
- **Citation**: College Board Research (May 2025). *Examining the Relationship Between Completing Full-Length Digital SAT Practice Tests in Bluebook and SAT Performance.*
- **Link**: https://research.collegeboard.org/media/pdf/DigitalSATPracticeTests_052025.pdf
- **Date accessed / recency**: Aug 2, 2026. **Published May 2025 — the most recent, largest-sample evidence on this exact question.**
- **Type**: Large-sample observational study with matching on observationally similar test-takers
- **Population**: SAT takers, class of 2025, large national sample. **[HIGH-STAKES, adolescent/young adult]**
- **Key finding**: **Students who completed 1, 2, and 3+ full-length digital practice tests scored 25.7, 45.5, and 61.4 points higher, respectively**, than observationally similar test-takers who completed none. **The marginal value per test is sharply diminishing: +25.7 for the first, +19.8 for the second, +15.9 for the third.** Gains were **larger for lower-achieving students** (PSAT ≈ 900: +29.4 / +53.4 / +79.0). Positive gains across all demographic groups. Separately, Weatherholtz et al. (2020) found 6+ hours on Official SAT Practice was associated with 20–40 additional points, and students following "best practice behaviors (e.g., taking a full-length practice test)" gained more than similar students who did not.
- **Relevance to this product**: **This is the single most defensible quantitative answer to the founder's question, and it points in a specific direction.** Full-length tests do help, substantially — but with steeply diminishing returns, and the first two or three carry most of the value. On the SAT scale (SD ≈ 100/section, ~200 total), 61.4 points from 3+ full tests is roughly *d* ≈ 0.3. **The product recommendation: build in 3–4 full-length simulations spread across a prep cycle, not "as many as possible."** The marginal fourth, fifth, and sixth full test is very likely worth less than the same 3 hours spent on targeted drilling with elaborated feedback — which is exactly the app's strength. The larger gains for lower-scoring students also argue for pushing full-length simulations harder to students below ~155 and less hard to students above ~165.
- **Confidence / caveats**: **Observational, not randomized.** Students who take practice tests are more motivated, and matching on prior achievement does not fully remove that. The true causal effect is almost certainly smaller than 61.4 points. It is also College Board research on College Board products. Still: large sample, sensible controls, and consistent with everything else in this section. Treat the *shape* of the curve (steep diminishing returns) as more reliable than the levels.

### Cognitive endurance as human capital
- **Citation**: Brown, C., Kaur, S., Kingdon, G., & Schofield, H. (2025). *Quarterly Journal of Economics*, 140(1). doi:10.1093/qje/qjae043
- **Link**: https://doi.org/10.1093/qje/qjae043
- **Date accessed / recency**: Aug 2, 2026. Published 2025 in the QJE — top-tier venue, current.
- **Type**: **Randomized field experiment (N = 1,636)** plus large-scale observational analysis of PISA and TIMSS
- **Population**: Indian primary school students (grades 1–5) for the experiment; global PISA/TIMSS samples; plus adult data-entry workers and voters. **[K-12 for the RCT — flag this — but the mechanism analysis includes ADULTS]**
- **Key finding**: This is the paper that establishes **cognitive endurance is a trainable capacity, not a fixed trait.** (1) Baseline: control students' probability of getting a given question correct **declines by 12% from the beginning to the end of a test**, replicated across listening comprehension, Raven's Matrices, and mathematics. (2) Randomly assigning **20-minute sustained cognitive-practice sessions, 1–3× per week over ~5 months (10–20 hours total)**, reduced the within-test performance decline by **21.9% (p = .006)**. (3) **A non-academic "Games" arm (mazes, tangrams) worked exactly as well as a math arm (22.0% vs. 21.9%)** — the endurance benefit does not depend on the content. (4) Effects **persisted 3–5 months after the intervention ended.** (5) Treatment effects were **absent in the first quintile of the test and emerged only later**, ruling out confidence/motivation/working-memory explanations. (6) **Decisively: cross-randomized performance incentives (a chance to win toys) sharply increased performance at the START of the test but did NOT reduce the rate of decline** — motivation cannot substitute for endurance. (7) An additional year of schooling mitigated decline by 31%, concentrated in schools assigning more independent focused practice.
- **Relevance to this product**: **The most important single source in this section for product design, and it partially rescues the founder from having to build full-length tests.**
  - Stamina is real (12% decline within a test), trainable, and *durable* (3–5 months).
  - **The training stimulus is "sustained continuous cognitive effort," not "full-length LSAT simulation."** The Games arm matching the Math arm is the key result: what builds endurance is uninterrupted effortful thinking for a continuous stretch, not test-specific content.
  - This means **section-length (35-minute) uninterrupted blocks should capture most of the endurance benefit of a full-length test, at a fifth of the time cost.** The app's Sprint mode (10 timed questions) is almost certainly too short to train endurance; a 35-minute uninterrupted section is the right unit.
  - **The incentive result is a direct warning to the gamification layer**: rewards raise early-test effort but do nothing for the fatigue curve. You cannot gamify your way to stamina.
  - Practical dosage prior from the experiment: ~10–20 hours of sustained practice produced a 22% improvement in the decline rate.
- **Confidence / caveats**: **The RCT is on Indian primary schoolchildren — the transfer to adult LSAT candidates is a genuine leap, and I flag it strongly.** However: (a) the PISA/TIMSS analyses cover adolescents globally; (b) the paper documents the same decline pattern in adult data-entry workers and voters; (c) the mechanism (sustained attention capacity) is not developmentally specific. The *direction* is well-supported; the 22% magnitude should not be assumed to hold for adults. This is the highest-value replication target for the product's own data.

### Test length and cognitive fatigue: an empirical examination of effects on performance and test-taker reactions
- **Citation**: Ackerman, P. L., & Kanfer, R. (2009). *Journal of Experimental Psychology: Applied*, 15(2), 163–181.
- **Link**: https://psycnet.apa.org/doiLanding?doi=10.1037/a0015719
- **Date accessed / recency**: Aug 2, 2026. 2009 — the definitive experiment on SAT-length fatigue.
- **Type**: **Within-participant randomized experiment with fully counterbalanced conditions and test forms**
- **Population**: **239 first-year university students** — the closest population match to LSAT candidates in this whole section. **[ADULT]**
- **Key finding**: Participants completed a **3½-hour, a 4½-hour (standard), and a 5½-hour SAT battery**. **Subjective fatigue increased with time-on-task as expected — but MEAN PERFORMANCE was HIGHER in the longer conditions than the shorter condition.** Individual differences in personality/interest/motivation trait complexes predicted subjective cognitive fatigue far better than the test-length manipulation did.
- **Relevance to this product**: **A major and genuinely surprising counterweight to the stamina narrative, and it is the best-designed study in this section on the right population.** For university-age adults on an SAT-type battery, going from 3½ to 5½ hours did *not* degrade performance — it improved it. Students *felt* more fatigued and performed *no worse*. Combined with the Ackerman & Kanfer (2010) 4-hour verbal study below, this substantially weakens the case that "LSAT stamina" is a large, real constraint for adults. Product implication: **do not build full-length tests primarily to train stamina for adults — the evidence that adults need it is weak.** Build them for pacing, section-transition management, and anxiety habituation, which are different (and less well-evidenced) mechanisms.
- **Confidence / caveats**: High-quality design (within-participant, counterbalanced, N = 239). Caveat: low-stakes lab administration; real test-day stress could change the picture. Also, "performance increased with length" may reflect warm-up/practice effects within the session rather than absence of fatigue.

### Cognitive fatigue during testing: trait, time-on-task, and strategy influences
- **Citation**: Ackerman, P. L., Kanfer, R., et al. (2010). *Human Performance*, 23(5), 381–402.
- **Link**: https://doi.org/10.1080/08959285.2010.517720
- **Date accessed / recency**: Aug 2, 2026. 2010.
- **Type**: Experiment, 4 hours of near-continuous verbal testing
- **Population**: N = 99 adults. **[ADULT]**
- **Key finding**: **A clear dissociation: subjective fatigue increased steadily over time-on-task, while performance measures were STABLE or showed SLIGHT IMPROVEMENTS.** Trait complexes accounted for significant variance in subjective fatigue. Three performance strategies were identified (overactivity, withdrawal, mixed).
- **Relevance to this product**: Replicates the 2009 finding on verbal tasks specifically — which is the relevant modality for the LSAT. **Adults feel exhausted on long verbal tests without actually performing worse.** The "withdrawal" strategy is the interesting product hook: some test-takers respond to felt fatigue by disengaging, and that (not fatigue itself) is what costs them points. That is an *attitudinal/strategic* target, not an endurance-training target.
- **Confidence / caveats**: N = 99, low-stakes. Consistent with the 2009 study.

### Investigating and predicting the cognitive fatigue threshold as a factor of performance reduction in assessment
- **Citation**: (2024). *ASEE Annual Conference Proceedings*. doi:10.18260/1-2--47688
- **Link**: https://doi.org/10.18260/1-2--47688
- **Date accessed / recency**: Aug 2, 2026. 2024 — current.
- **Type**: Review + empirical study of cognitive fatigue thresholds
- **Population**: Engineering students; reviews large-scale datasets. **[ADULT + K-12]**
- **Key finding**: Summarizes the large-scale evidence that *does* find decline: **Reyes analyzed 1.9 million Brazilian high-school students on a 180-item, four-subject high-stakes admissions test and found a 5–7% performance decline across the exam** — with declines appearing even within the first 10 items. **Balart found a 9–11% decline across a 25-item exam.** Declines are **greater among male participants and those with lower academic performance**, and are moderated by anxiety, mood, intrinsic motivation, goal orientation, and socioeconomic conditions. Also notes that where the hardest questions sit in an exam affects the observed fatigue impact.
- **Relevance to this product**: This is the evidence that reconciles the conflict with Ackerman & Kanfer. **In real high-stakes admissions testing at scale (1.9M students), within-test decline is real and is roughly 5–11%.** The lab studies that found no decline were low-stakes. So the honest position is: **within-test decline exists on real admissions tests, is on the order of 5–12%, and disproportionately affects lower-performing students** — exactly the students LSAT Speedrun most wants to help. That is a real, targetable product opportunity: the app can measure each student's own decline curve across a 35-minute section, which almost no competitor does.
- **Confidence / caveats**: Conference proceedings; the strongest numbers cited are secondary (Reyes, Balart). The Reyes and Balart studies are on adolescents. But the pattern is consistent across the QJE paper's PISA/TIMSS analysis.

### Investigating the effects of exam length on performance and cognitive fatigue
- **Citation**: (2013). *PLOS ONE*, 8(7), e70270.
- **Link**: https://doi.org/10.1371/journal.pone.0070270
- **Date accessed / recency**: Aug 2, 2026. 2013.
- **Type**: Quasi-experiment, standard- vs. extended-length exams in an undergraduate biology course
- **Population**: Non-majors biology undergraduates. **[ADULT]**, higher-order-thinking exam items
- **Key finding**: **Lengthier exams led to BETTER performance on the assessment items shared between conditions, and to better performance on the FINAL exam** (the authors attribute this to the testing effect in creative problem solving). **Length did not lower performance despite students perceiving substantial subjective fatigue** — student course evaluations were scathing ("the tests were ridiculously long"). Students in the extended condition took 1.5× as long.
- **Relevance to this product**: Reinforces the subjective-vs-objective dissociation on *higher-order* items specifically, which is the relevant item type. It also flags the commercial risk plainly: **longer assessments produce real learning benefits AND real user resentment.** For a consumer product where retention matters, the felt cost of a 3-hour simulation is a business problem even where the learning is fine.
- **Confidence / caveats**: Quasi-experimental, two class populations, single course. Confounded with number of items (more items = more retrieval practice), so "length helps" may just be "more testing helps."

### Females show more sustained performance during test-taking than males
- **Citation**: Balart, P., & Oosterveen, M. (2019). *Nature Communications*, 10, 3798.
- **Link**: https://doi.org/10.1038/s41467-019-11691-y
- **Date accessed / recency**: Aug 2, 2026. 2019.
- **Type**: Large-scale analysis of PISA (exogenous variation in question order) + multi-test replication
- **Population**: 15-year-olds across 74 countries. **[K-12]**
- **Key finding**: Females sustain performance better across a test than males, **regardless of whether the domain favors them** (holds for reading AND math/science). In >50% of countries where females started at a math/science disadvantage, they cut that disadvantage by at least half after 2 hours of testing. In no country did males show a significantly smaller decline. Because the pattern is domain-independent, the authors argue the decline reflects noncognitive rather than cognitive factors.
- **Relevance to this product**: Establishes that **within-test decline is a stable individual difference, not noise** — which means it is measurable per student and worth measuring. If an LSAT student's accuracy on the last 8 questions of a section is reliably below their first 8, that is a diagnosable, addressable problem distinct from their content mastery. **No LSAT prep product I am aware of reports a per-student decline curve. This is a concrete, differentiated, evidence-backed feature.**
- **Confidence / caveats**: **[K-12]**, 15-year-olds. The gender finding itself is not directly actionable for the product and I would not build on it. The *existence and stability* of individual decline curves is the transferable part.

### The predictive value of full-length practice exams for the new MCAT
- **Citation**: (2020). *Journal of Medical Education and Curricular Development*, 7.
- **Link**: https://journals.sagepub.com/doi/10.1177/2382120520981979
- **Date accessed / recency**: Aug 2, 2026. 2020.
- **Type**: Regression study on premedical students
- **Population**: Premedical students preparing for the MCAT. **[ADULT, HIGH-STAKES]** — a very close analogue to the LSAT population.
- **Key finding**: Adding full-length practice-exam scores significantly improved the regression model predicting MCAT performance (F-change significant). **Median practice-exam score had a standardized β = 0.74 for predicting MCAT score, versus β = 0.34 for English proficiency** — practice-exam performance was by far the dominant predictor. Students' performance improved across successive practice exams. The authors "strongly recommend that examinees use full-length practice exams as a LEARNING resource throughout the whole preparation stage," not merely to drill interface mechanics.
- **Relevance to this product**: **The strongest available evidence that full-length simulated tests are an excellent BENCHMARK — which is exactly the founder's third concern (the app can't predict real improvement).** β = 0.74 means practice-test scores are a very strong predictor of real high-stakes performance in an adult admissions-test population. The product implication is that a small number of full-length or near-full-length simulations, administered under realistic conditions, would give the app a *calibrated score-prediction anchor* it currently lacks — and that anchor is what makes the calibration intervention in Section 4 possible.
- **Confidence / caveats**: **Very small sample** (the F-statistics indicate df in the teens). Correlational. Reverse causation is obvious — better students score better on both. But as a *measurement* argument (practice tests predict real scores) rather than a *causal* argument (practice tests cause higher scores), the small sample matters less.

### Transfer-appropriate processing in the testing effect
- **Citation**: (2015). *Memory*, 23(7). doi:10.1080/09658211.2014.970196 ; plus Roediger, Tekin, & Uner (2017) chapter on encoding specificity and TAP; plus Morris, Bransford, & Franks (1977), *JVLVB*, 16(5), 519–533.
- **Link**: https://doi.org/10.1080/09658211.2014.970196 ; http://psychnet.wustl.edu/memory/wp-content/uploads/2018/04/Roediger_Tekin_Uner_2017.pdf
- **Date accessed / recency**: Aug 2, 2026. 1977 / 2015 / 2017.
- **Type**: Foundational theory + experiments
- **Population**: Adults. **[ADULT]**
- **Key finding**: **Transfer-appropriate processing**: final-test performance is high when the cognitive processes engaged during practice overlap with those required at test, and is *optimized when they are identical*. Morris et al. (1977) showed the classic reversal — semantically encoded words won on a standard recognition test, but phonetically encoded words won on a rhyme recognition test. **Encoding specificity** (Tulving & Thomson, 1973) makes the parallel claim for contextual consistency. The 2015 experiment found memory improved monotonically as review cues and final-test cues became more similar. Empirically, **when practice test format differs from the final assessment format, the testing effect is appreciably reduced** (Johnson & Mayer, 2009; McDaniel & Fisher).
- **Relevance to this product**: **The theoretical backbone for the whole fidelity argument, and it cuts against several of the app's current design choices.** Every way in which practice differs from the real LSAT is a TAP violation that shrinks transfer:
  - Real LSAT: no immediate feedback. Infinite/Method Lab: immediate feedback. (Justified by learning value, but it is a fidelity cost.)
  - Real LSAT: no writing. Method Lab/Infinite: mandatory typed explanation on every item. **This is the largest TAP violation in the product** — students are practicing a fundamentally different cognitive operation (articulate your reasoning in prose) from the one they will perform on test day (silently eliminate four choices under time pressure).
  - Real LSAT: continuous 35-minute sections. Sprint: 10 questions.
  - Real LSAT: no strategy prompts. Deep/Infinite: named strategy every ~4th question.
  
  This does not mean these features are wrong — several have strong independent learning support. But it means **the app needs a substantial fraction of practice conducted under strict test-fidelity conditions**, and TAP gives a principled reason why: the processes must be the ones the criterion test demands.
- **Confidence / caveats**: TAP is a well-established theoretical framework with strong lab support. The specific magnitude of the fidelity penalty for each of the app's deviations is unmeasured and could be small. High theoretical confidence, unknown practical magnitude.

**Section 9 verdict — a defensible recommendation with numbers:**

The literature supports a **hybrid, and it is not the founder's "as many full tests as possible."**

1. **Full-length tests deliver real but sharply diminishing returns.** Best available numbers (College Board, 2025, N large): +25.7 points for the first, +19.8 for the second, +15.9 for the third on the SAT. **Recommendation: 3–4 full-length simulations across a prep cycle, front-loaded as a diagnostic and back-loaded as a dress rehearsal.** Beyond ~4, the marginal 3 hours is almost certainly better spent on targeted drilling with elaborated feedback.

2. **Section-length simulation captures most of the endurance benefit at a fifth of the cost.** The QJE cognitive-endurance RCT found that ~20-minute blocks of *any* sustained cognitive effort, 1–3× per week for ~10–20 total hours, cut within-test performance decline by 22%, with effects persisting 3–5 months. The stimulus is *uninterrupted effortful thinking*, not test-length fidelity. **Recommendation: make the 35-minute uninterrupted single-section simulation the product's core "test-condition" unit.** Sprint's 10 questions is too short to train endurance.

3. **Adult stamina may be less of a problem than assumed.** Two well-designed adult experiments (Ackerman & Kanfer 2009, N = 239; 2010, N = 99) found subjective fatigue rose with time-on-task while performance stayed flat or *improved*. Real high-stakes data (Reyes, 1.9M students; Balart) does show 5–11% within-test decline, concentrated in lower-performing students. **Reconciliation: decline is real under high stakes, modest in size, and worst for weak students. Target stamina training at students who demonstrably decline, not at everyone.**

4. **Measure each student's own decline curve.** It is a stable individual difference (Balart & Oosterveen), it is measurable from a single 35-minute section, and no competitor reports it. This is the cheapest differentiated feature in this document.

5. **Full-length tests are a better BENCHMARK than a better TRAINER.** Practice-exam median score predicted real MCAT performance at β = 0.74. This is the direct answer to the founder's "we can't predict real improvement" concern.

6. **Preserve strict test-fidelity conditions for a meaningful share of practice** (transfer-appropriate processing). The mandatory typed explanation is the app's largest fidelity deviation and the strongest argument for making it optional or targeted rather than universal.

---

## Section 10 — Standardized Test-Prep Effectiveness Generally

### The effect of admissions test preparation: evidence from NELS:88
- **Citation**: Briggs, D. C. (2001/2004). *Chance*, 14(1) / NEPC working paper.
- **Link**: https://www.nepc.colorado.edu/sites/default/files/Briggs_Theeffectofadmissionstestpreparation.pdf
- **Date accessed / recency**: Aug 2, 2026. 2001 — still the most-cited controlled estimate of commercial coaching effects.
- **Type**: Analysis of the National Education Longitudinal Study (N ≈ 16,500 tracked across 1988/1990/1992)
- **Population**: US high-school students taking SAT/ACT. **[HIGH-STAKES, K-12/young adult]**
- **Key finding**: After controlling for group differences, **the average commercial-coaching boost on SAT-Math is 14–15 points; on SAT-Verbal just 6–8 points; combined ≈ 20 points** (SAT section SD ≈ 100, so *d* ≈ 0.06–0.15). ACT math: 0 to 0.4 points; ACT English 0.3–0.6 points; **ACT Reading: coaching had a NEGATIVE effect of about 0.6–0.7 points.** Briggs' conclusion: "the average effect of coaching is nowhere near the levels previously suggested by commercial test preparation companies."
- **Relevance to this product**: **The sobering baseline the founder needs to internalize.** Commercial LSAT prep companies advertise 10+ point LSAT gains. The best controlled evidence on the analogous SAT says the *causal* coaching effect is roughly 0.1 SD. **On the LSAT's 120–180 scale (SD ≈ 10), 0.1 SD is about 1 point.** That is the honest prior for "generic commercial test prep." Two important qualifications follow in the entries below — this is not the ceiling, it is the industry average.
- **Confidence / caveats**: Observational with controls, not randomized; self-reported coaching. Relies on 1990s data and the pre-2005 SAT. **The verbal-vs-math asymmetry is the most concerning part for an LSAT product**: coaching worked substantially better on the more curriculum-like math section than on the verbal-reasoning section, and the LSAT is entirely verbal reasoning.

### Evaluating the effect of coaching on SAT scores: a meta-analysis
- **Citation**: DerSimonian, R., & Laird, N. (1983). *Harvard Educational Review*, 53(1), 1–15.
- **Link**: https://www.harvardeducationalreview.org/content/53/1/1
- **Date accessed / recency**: Aug 2, 2026. 1983 — foundational, methodologically important.
- **Type**: Meta-analysis with explicit modeling of study methodology
- **Population**: SAT takers. **[HIGH-STAKES]**
- **Key finding**: **Studies comparing coached students' gains to national norms produced "coaching effects" FOUR TO FIVE TIMES LARGER than matched or randomized evaluations of the same interventions.** The matched/randomized studies also agreed with each other far more closely. Their estimate from the rigorous studies: **~10 points**, which they judged "too small to be practically important."
- **Relevance to this product**: **The methodological warning that matters most for how the app measures itself.** Comparing your users' score gains to a population baseline will overstate your effect by 4–5×. If LSAT Speedrun ships a "our students improve by X points" claim built on pre/post comparison against national norms, that number will be wrong by a large factor and the founder will believe his own marketing. **The app needs a genuine control or matched comparison built into its measurement design from the start** — which, notably, is exactly the discipline the strategy-trial bandit's 25% silent control already demonstrates the team is capable of.
- **Confidence / caveats**: 1983, pre-modern SAT. The methodological finding (norm comparisons inflate by 4–5×) is the durable part and has been repeatedly confirmed.

### Coaching for the Scholastic Aptitude Test: further synthesis and appraisal
- **Citation**: Becker, B. J. (1990). *Review of Educational Research*, 60(3), 373–417.
- **Link**: https://doi.org/10.3102/00346543060003373
- **Date accessed / recency**: Aug 2, 2026. 1990.
- **Type**: Meta-analysis, 23 reports / 48 studies
- **Population**: SAT takers. **[HIGH-STAKES]**
- **Key finding**: Coaching helps on average but with considerable variability. Published comparison studies: **coached groups exceeded controls by *d* = 0.09 on SAT-Verbal and *d* = 0.16 on SAT-Math.** Study characteristics related to effect magnitude included: **whether instruction included test practice and attention to test-taking skills, and whether HOMEWORK WAS ASSIGNED.** Effects stronger on the math subtest.
- **Relevance to this product**: The moderator list is the useful part. **The two coaching ingredients associated with larger effects — item practice with explicit test-taking skills, and assigned homework — are precisely what a daily-habit app delivers better than a weekend classroom course.** The homework moderator in particular is an argument that the *distributed, high-frequency* nature of an app is a structural advantage over the traditional prep-course format, independent of content quality.
- **Confidence / caveats**: 1990; the studies were "rather poorly reported and designed" by Becker's own assessment. *d* = 0.09 verbal is the number most relevant to the LSAT and it is very small.

### The impact of test preparation on performance of large-scale educational tests: a meta-analysis of experimental studies
- **Citation**: (2025). *Review of Educational Research*. doi:10.3102/00346543251360775
- **Link**: https://doi.org/10.3102/00346543251360775
- **Date accessed / recency**: Aug 2, 2026. **Published 2025 — the newest meta-analysis on test-prep effectiveness and the first restricted to (quasi-)experimental designs.**
- **Type**: Meta-analysis of experimental and quasi-experimental studies only
- **Population**: Large-scale educational tests; includes language proficiency tests and admissions tests. **[HIGH-STAKES, mixed ages]**
- **Key finding**: **Overall significant positive effect of test preparation: *g* = 0.26 (SE = 0.08, 95% CI [0.10, 0.42], p < .001).** Interpreted by the authors as large by Kraft's (2020) education-intervention benchmarks (>0.20), corresponding to a randomly selected treated individual having ~60% probability of outscoring a randomly selected control. Notes that prior observational work (Briggs, Domingue & Briggs, Powers & Rock) found inconsistent and much smaller effects, with only private tutoring and commercial courses showing small positive effects on SAT-Math (13–15 points) and **no significant effects on SAT-Verbal or ACT.**
- **Relevance to this product**: **The most encouraging recent number, and it reframes the ceiling.** When you restrict to experimental designs and include modern, structured, practice-based preparation (not just 1990s commercial cram courses), the effect is *g* = 0.26. **On the LSAT scale (SD ≈ 10 points), *g* = 0.26 is roughly 2.6 points — meaningful for law-school admissions, where 2–3 points can move an applicant across a scholarship threshold.** Combined with the College Board full-length-practice-test data (~+61 SAT points ≈ *d* ≈ 0.3 for 3+ tests), a realistic, defensible target for a well-executed prep product is somewhere in the **0.25–0.35 SD range, i.e., roughly 2.5–3.5 LSAT points on average**, with larger gains for lower-starting students and smaller gains at the top due to ceiling effects.
- **Confidence / caveats**: Access was via a proxied mirror of the SAGE page; I read the abstract and results text but did not obtain the full moderator tables. The included studies are heterogeneous and skew toward language-proficiency tests, where prep effects are typically larger than for reasoning tests. **The *g* = 0.26 figure should be treated as an optimistic upper-middle estimate for LSAT, not a promise.**

### SAT coaching: what effect size? (independent synthesis)
- **Citation**: Kaufman, J. (n.d., ~2019). Personal blog synthesis of Briggs (2001), Hansen (2004), Buchmann et al. (2010).
- **Link**: https://www.jefftk.com/p/sat-coaching-what-effect-size
- **Date accessed / recency**: Aug 2, 2026.
- **Type**: **Blog post** — lower source quality, included because it usefully aggregates three primary studies and flags each one's directional bias.
- **Population**: SAT takers. **[HIGH-STAKES]**
- **Key finding**: Briggs (2001): commercial classes 15% SD (~30 points), private tutor 13% SD (~26 points). Hansen (2004), using full matching on College Board data: 12% SD (~27 points) — **noted as likely biased downward because College Board has an institutional interest in its test being prep-resistant.** Buchmann et al. (2010): commercial classes ~15% SD (30 points), tutors ~19% SD (37 points) — **noted as likely biased upward because the authors were arguing for coaching-driven inequality.** Convergent range: **12–19% of a standard deviation.**
- **Relevance to this product**: The bias-direction analysis is genuinely useful: three studies with opposite institutional incentives converge on 12–19% SD, which increases confidence that the true generic-coaching effect really is in that band. **On the LSAT, 12–19% SD ≈ 1.2–1.9 points from generic commercial coaching.**
- **Confidence / caveats**: **Blog post, not peer-reviewed.** I include it explicitly flagged as such because its aggregation is sound and it points to three primary sources. Do not cite it as evidence in its own right.

### Coaching for aptitude tests other than the SAT (Kulik, Bangert-Drowns, & Kulik)
- **Citation**: Kulik, J. A., Bangert-Drowns, R. L., & Kulik, C. C. (1984). ERIC ED235195 / *Psychological Bulletin*.
- **Link**: https://files.eric.ed.gov/fulltext/ED235195.pdf
- **Date accessed / recency**: Aug 2, 2026. 1984.
- **Type**: Meta-analysis, 38 coaching studies
- **Population**: SAT and non-SAT aptitude tests. **[HIGH-STAKES + lab]**
- **Key finding**: **"There are two distinct literatures."** SAT coaching shows small effects. **Coaching for aptitude tests OTHER than the SAT shows substantial effects: across 24 studies, average *ES* = 0.43; among the 17 that used a pretest, the coaching effect was 0.51 SD** (experimental pre-post gain 0.76 SD minus control gain 0.25 SD). **Use of a pretest was the ONLY study feature significantly related to effect size.**
- **Relevance to this product**: **This is the most important and most overlooked finding in Section 10.** The small-coaching-effect story is specific to the SAT, a test explicitly engineered by its publisher to resist coaching. Other aptitude tests show coaching effects around *d* = 0.43–0.51 — **which on the LSAT scale would be 4–5 points.** Whether the LSAT behaves like the SAT (coaching-resistant) or like "other aptitude tests" (coachable at ~0.5 SD) is genuinely open, but the LSAT's highly regular, published, learnable item taxonomy suggests it sits closer to the coachable end. Second: **the pretest moderator is directly actionable** — programs that began with a diagnostic produced significantly larger gains, which is an evidence-backed argument for the app's existing 75-item Diagnostic mode being mandatory rather than optional.
- **Confidence / caveats**: 1984, and pre-post designs with a control gain subtracted are weaker than randomized designs. The 0.43–0.51 figure is from an older, methodologically looser literature and should be discounted. But the SAT-vs-other-tests distinction is real and important.

### Estimating the effects of various methods of preparing for the SAT / synthesis of four SAT coaching meta-analyses
- **Citation**: Powers, D. E. (1993/1995). ERIC ED385593, synthesizing Messick & Jungeblut (1981), DerSimonian & Laird (1983), Kulik et al. (1984), Becker (1990). Plus Powers & Rock (1999), *Journal of Educational Measurement*.
- **Link**: https://files.eric.ed.gov/fulltext/ED385593.pdf
- **Date accessed / recency**: Aug 2, 2026. 1993/1995 + 1999.
- **Type**: Synthesis of four meta-analyses
- **Population**: SAT takers. **[HIGH-STAKES]**
- **Key finding**: Converged conclusions: coaching effects are greater on the **more curriculum-related math section** than on verbal. **Longer coaching programs yield greater effects, but "simply doubling the effort does not double the effect"** — diminishing returns in study duration, mirroring the practice-test diminishing returns in Section 9. Norm-referenced studies inflate effects 4–5×. Powers & Rock (1999): SAT-Math 13–18 points, SAT-Verbal 6–12 points, combined 21–34 points. Powers' closing advice: prospective students "should consider not only expected benefits, but also the cost in terms of time and money."
- **Relevance to this product**: The **diminishing-returns-in-duration** finding is the single most consistent pattern across Sections 9 and 10: more practice tests → diminishing; more coaching hours → diminishing; more retrieval repetitions → subadditive (Rawson & Dunlosky). **The product should be designed around the first 20–40 hours of a student's time being worth far more than the next 40**, which argues for aggressive prioritization of the highest-yield activities early, and against engagement mechanics that maximize total time-in-app.
- **Confidence / caveats**: Synthesis of pre-2000 work on a test that no longer exists in that form. Directionally reliable.

### Briggs meta-analysis (methodological treatment of coaching effect sizes)
- **Citation**: Briggs, D. C. (n.d.). *Meta-Analysis: A Case Study*. University of Colorado.
- **Link**: https://www.colorado.edu/education/sites/default/files/attached-files/Briggs_Meta-Analysis.pdf
- **Date accessed / recency**: Aug 2, 2026.
- **Type**: Methodological case study
- **Population**: N/A
- **Key finding**: Defines coaching as "content review, item drill and practice, and an emphasis on specific test-taking strategies and general test wiseness." Provides the scale anchor: **SAT section SD ≈ 100 points, so a 10-point coaching effect = 0.1 SD (small) and a 60-point effect = 0.6 SD (large).**
- **Relevance to this product**: **Mostly a units-conversion reference** — logged because the scale anchoring is what makes every other number in this section interpretable, and because its three-part definition of coaching maps exactly onto the app's three main activities (elaborated feedback = content review; question modes = item drill; strategy prompts = test-taking strategies). The app is, definitionally, a coaching product.
- **Confidence / caveats**: Methodological illustration, not new evidence.

**Section 10 verdict — how much score gain is realistically achievable:**

| Evidence base | Effect | LSAT-scale equivalent (SD ≈ 10) |
|---|---|---|
| SAT commercial coaching, rigorous designs (DerSimonian & Laird 1983) | ~10 points ≈ 0.10 SD | ~1 point |
| SAT coaching, NELS controlled (Briggs 2001) | ~20 points combined; verbal only 6–8 | ~1 point |
| SAT coaching, three converging studies (Briggs/Hansen/Buchmann) | 0.12–0.19 SD | 1.2–1.9 points |
| SAT coaching by section (Becker 1990) | *d* = 0.09 verbal / 0.16 math | ~1 point verbal |
| Test prep, 2025 experimental-only meta-analysis | *g* = 0.26 | ~2.6 points |
| Full-length practice tests, 3+ (College Board 2025) | ~61 SAT points ≈ 0.30 SD | ~3 points |
| Coaching for aptitude tests OTHER than the SAT (Kulik 1984) | *d* = 0.43–0.51 | 4–5 points |

**Defensible synthesis: a well-executed, high-engagement, distributed prep product should target roughly 0.25–0.40 SD, i.e., about 2.5–4 LSAT points on average**, with substantially larger gains for students starting low (ceiling effects compress gains at the top, per the College Board data) and near-zero gains for students already at 172+. Claims of 10+ point average gains are not supported by any controlled evidence and are almost certainly artifacts of norm-referenced comparison (which inflates 4–5×) plus self-selection. Note that even 3 points is commercially enormous in law-school admissions — the honest number is a good number, and it does not need inflating.

---

## Section 11 — Cross-Cutting: LLM Tutoring, Adaptive Systems, and LSAT-Specific Base Rates
*(Not in the original brief, but unavoidable: the app's core differentiator is an LLM coach, and the founder's benchmarking question needs LSAT-specific numbers.)*

### Generative AI without guardrails can harm learning: evidence from high school mathematics
- **Citation**: Bastani, H., Bastani, O., Sungu, A., Ge, H., Kabakcı, Ö., & Mariman, R. (2025). *PNAS*, 122. doi:10.1073/pnas.2422633122
- **Link**: https://www.pnas.org/doi/10.1073/pnas.2422633122
- **Date accessed / recency**: Aug 2, 2026. 2025, *PNAS* — the single most important AI-in-education RCT to date.
- **Type**: **Three-arm randomized field experiment** (GPT Base / GPT Tutor with guardrails / no AI), with a subsequent unassisted exam
- **Population**: ~1,000 high school students in Turkey, mathematics. **[K-12]**
- **Key finding**: **On practice problems, students with GPT Tutor performed 127% better and GPT Base 48% better than control.** But **on the subsequent unassisted exam, GPT Base students performed 17% WORSE than control** (statistically significant). The guardrailed GPT Tutor eliminated the harm but produced **no positive effect** on the exam either. Interaction analysis: students used GPT Base as a "crutch," asking for and copying solutions, while they used GPT Tutor to ask for help and independently attempt answers. **Critically: students did not perceive any reduction in their learning — they were unaware the AI was impeding them.**
- **Relevance to this product**: **The defining cautionary result for an LLM-coached LSAT product, and it maps onto a specific risk in the current design.** The pattern — huge apparent gains during practice, worse performance when the AI is gone — is exactly what LSAT Speedrun risks if the LLM coach explains items in a way students can lean on rather than reason through. Two guardrails follow directly: (1) the LLM must never be reachable *before* the student commits to an answer; (2) the app must measure performance on **unassisted, no-feedback items** (which is precisely what Sprint and Diagnostic modes provide) and treat those, not in-session accuracy, as the real progress metric. The student-unawareness finding also means user satisfaction will not detect this failure mode — only unassisted measurement will.
- **Confidence / caveats**: **[K-12]**, mathematics, Turkey. The 17% harm is from an unguardrailed general chatbot, which is not what the app ships. The more sobering finding for this product is the *null* for the guardrailed tutor: even well-designed AI tutoring produced no exam gain in this study.

### The evidence base on AI in K-12: a 2026 review
- **Citation**: Stanford SCALE Initiative (2026). *The Evidence Base on AI in K-12.*
- **Link**: https://scale.stanford.edu/sites/default/files/The%20Evidence%20Base%20on%20AI%20in%20K-12%20Report.pdf
- **Date accessed / recency**: Aug 2, 2026. **2026 — the most recent synthesis available.**
- **Type**: Evidence review
- **Population**: K-12 primarily, some college. **[K-12]**
- **Key finding**: Consistent pattern: **AI tools improve performance while students have access to them, but effects on unassisted assessments are mixed to negative.** Positive: AI essay feedback improved Brazilian students' high-stakes writing exam scores (Ferman et al., 2021). Null: automated feedback plus a tutoring chatbot did not improve US college students' math exam scores (Chen et al., 2025). Negative: German college students using general chatbots for research showed **lower-quality reasoning and argumentation** than those using a search engine (Stadler et al., 2024); a field study found worse programming outcomes from general-purpose chatbot study (Lehmann et al., 2025).
- **Relevance to this product**: The Stadler finding is the most alarming for an LSAT product specifically — **the degraded outcome was reasoning and argumentation quality**, which is the LSAT's entire construct. It suggests the risk is not merely "students don't learn as much" but "students' independent argument analysis gets worse." Strengthens the case for hard separation between the reasoning phase (no AI) and the feedback phase (AI).
- **Confidence / caveats**: Review, K-12 focus, and the cited studies vary widely in quality. The overall pattern (assisted gains, unassisted nulls) is consistent enough to act on.

### AI tutors in Nigeria: randomized controlled trial
- **Citation**: De Simone, M. E., et al. (2025). World Bank / VoxDev summary.
- **Link**: https://voxdev.org/topic/education/how-ai-tutors-improved-learning-nigeria
- **Date accessed / recency**: Aug 2, 2026. 2025.
- **Type**: **Randomized controlled trial**, 9 public secondary schools
- **Population**: Nigerian secondary students. **[K-12]**
- **Key finding**: A six-week after-school programme (12 sessions × 90 minutes) with students working in pairs on GPT-4 under teacher supervision, with prompts designed to promote reasoning rather than shortcuts, produced **~0.3 SD overall learning gain (~0.24 SD in English)** on a pen-and-paper endline, plus better end-of-year exam performance. Equivalent to ~1.5 years of typical learning in six weeks; outperformed ~80% of RCT-studied education interventions in the developing world.
- **Relevance to this product**: The positive counterweight to Bastani et al. **LLM tutoring works when it is (a) structured, (b) prompted to promote reasoning rather than answers, and (c) monitored to prevent over-reliance.** All three are implementable in software. The 0.3 SD figure is in the same range as the test-prep ceiling estimated in Section 10, which is a coherent picture.
- **Confidence / caveats**: Developing-country setting with a low counterfactual (business-as-usual schooling), which inflates effect sizes relative to what a motivated US adult with existing resources would gain. Teacher facilitation was a key ingredient the app cannot replicate. Accessed via a summary rather than the primary paper — a partial dead end on source depth.

### The efficacy of AI-enabled adaptive learning systems, 2010–2022: a meta-analysis
- **Citation**: (2024). *Journal of Educational Computing Research*. doi:10.1177/07356331241240459
- **Link**: https://doi.org/10.1177/07356331241240459
- **Date accessed / recency**: Aug 2, 2026. 2024 — current.
- **Type**: Meta-analysis, 18 databases, N = 45 independent studies (k = 47 effects)
- **Population**: Mixed, moderated by student classification level. **[K-12 + ADULT]**
- **Key finding**: AI-enabled adaptive learning systems vs. non-adaptive interventions: **medium-to-large effect, *g* = 0.70.** Significantly moderated by publication type, study origin, student level, discipline, duration, and research design. **All three adaptive sources (cognitive, affective, behavioral) and both adaptive targets (navigation and assessment) were significant moderators. The type of AI in the adaptive engine did NOT moderate the effect.**
- **Relevance to this product**: The "type of AI doesn't matter" finding is worth internalizing: **the win comes from adapting at all, not from model sophistication.** A simple, well-tuned mastery model that picks the right next item beats a sophisticated model that doesn't change item selection. Given Section 7's conclusion that individualization is the app's real differentiator, this says the highest-ROI engineering is item-selection logic, not prompt engineering.
- **Confidence / caveats**: *g* = 0.70 is high for an education intervention and moderated by publication type, which is a publication-bias tell. Discount substantially. Direction is well-supported.

### Adaptive training instructional interventions: a meta-analysis
- **Citation**: (2024). *Military Psychology*, 36(6). doi:10.1080/08995605.2024.2377884
- **Link**: https://doi.org/10.1080/08995605.2024.2377884
- **Date accessed / recency**: Aug 2, 2026. 2024 — current.
- **Type**: Meta-analysis of adaptive training interventions
- **Population**: **Adult trainees (military and related).** **[ADULT]**
- **Key finding**: Decomposes adaptive training by intervention type. **Adaptive spacing** (adjusting intervals based on performance so poorly-learned items appear at shorter intervals) is described as prioritizing *training efficiency* — reaching baseline proficiency faster — and notes that **some studies found this comes "at the cost of overall learning outcomes compared to non-adaptive versions"** (Blalock, 2022; Whitmer et al., 2020), though not universally. Interventions adapting **task difficulty or scaffolding** showed larger effects than adaptive spacing or adaptive feedback.
- **Relevance to this product**: An honest caution about the Review queue. **Adaptive spacing buys efficiency (proficiency per hour), not necessarily higher ceiling performance.** For a time-constrained LSAT student that is still the right trade. But the finding that *adapting difficulty and scaffolding* outperforms *adapting spacing* points the roadmap: the higher-value adaptation is the expertise-reversal gating from Section 5 (fade strategy prompts and worked examples per student), not further tuning of the 1/3/7/21-day intervals.
- **Confidence / caveats**: Military training tasks, mostly procedural. Adult population is a plus. No single pooled effect size extracted.

### Adaptive vs. fixed spacing of learning items: evidence from chemistry education
- **Citation**: Mettler, E., Massey, C. M., & Kellman, P. J. (2021). PMC8324178.
- **Link**: https://pmc.ncbi.nlm.nih.gov/articles/PMC8324178/
- **Date accessed / recency**: Aug 2, 2026. 2021.
- **Type**: Three experiments (lab + community college classrooms)
- **Population**: Community college chemistry students. **[ADULT]**
- **Key finding**: ARTS (Adaptive Response-Time-based Sequencing), which sets spacing intervals dynamically from each learner's ongoing speed *and* accuracy, **outperformed fixed expanding-interval schedules on efficiency and durability, with gains persisting after a two-week delay and generalizing to a standardized ACS chemistry assessment 2–3 months later.**
- **Relevance to this product**: The most useful specific finding here is that **response TIME, not just accuracy, drove the adaptive schedule.** The app already captures per-item timing; using latency as a mastery signal (a fast correct answer means something very different from a slow correct answer, especially on a speeded test like the LSAT) is a concrete, evidence-backed improvement over an accuracy-only review queue. The transfer to an independent standardized assessment months later is the strongest form of evidence available for this class of system.
- **Confidence / caveats**: Chemistry nomenclature is closer to paired-associate learning than to LSAT reasoning. Adult population and real classrooms are strong points. Authors note considerable variability across their own studies.

### The performance of repeat test takers on the LSAT (TR 14-01) and LSAT performance breakdowns 2018–2025 (TR 26-01)
- **Citation**: Law School Admission Council. TR 14-01 (2006–07 through 2012–13); **TR 26-01 (2018–19 through 2024–25)**.
- **Link**: https://www.lsac.org/data-research/research/performance-repeat-test-takers-law-school-admission-test-2006-2007-through ; https://www.lsac.org/sites/default/files/research/TR-26-01.pdf
- **Date accessed / recency**: Aug 2, 2026. **TR 26-01 covers through the 2024–25 testing year — the most current LSAT-specific data available.**
- **Type**: Official technical reports from the test publisher (full population data)
- **Population**: **All LSAT test takers.** **[ADULT, HIGH-STAKES]** — the exact target population.
- **Key finding**: **Repeat test takers gain an average of 2.8 points on the second sitting and 2.2 points on the third (relative to the second).** More recent LSAC data give 2.6–2.8 and 2.2–2.3. Mean scores by attempt: second-time 151.7, first-time 151.0, third-time 149.4 — third-timers are a negatively selected group. **In 2024–25, 49.1% of all test takers tested more than once**, and first-timers averaged ~1.5 points below repeaters. Format note: **as of August 2024 the Analytical Reasoning ("Logic Games") section was removed and replaced by a second Logical Reasoning section** — the current LSAT is 2× Logical Reasoning + 1× Reading Comprehension.
- **Relevance to this product**: **Two critical calibration points.**
  - **The 2.8-point retake gain is the honest benchmark the product must beat.** A student who simply retakes with no structured prep gains ~2.8 points. Section 10's estimate of what good prep adds (0.25–0.40 SD ≈ 2.5–4 points) is *of the same order*. So the product's claim cannot be "we get you +3 points" — a retake alone does that. **The defensible claim is that structured prep gets a student to their gain in ONE additional sitting rather than two or three, and shifts the distribution's upper tail.** Related distributional data (secondary sources citing LSAC): ~70% of retakers improve, ~1/3 improve by 5+, ~1 in 5 by 7+, only ~1 in 16 by 10+. And **~70% of those originally scoring ≤141 improved vs. only 37% of those scoring ≥172** — ceiling effects are severe.
  - **The August 2024 format change is a product-content risk that must be checked.** If the app's item bank or strategy library still weights Analytical Reasoning / Logic Games, that content is now obsolete, and the current test is 50%+ Logical Reasoning. Given transfer-appropriate processing (Section 9), item-mix fidelity to the *current* format is a first-order concern.
- **Confidence / caveats**: LSAC population data is authoritative for the base rates. It is *not* causal evidence about prep — retake gains confound practice effects, regression to the mean, additional study, and self-selection into retaking. The distributional figures (1/3 improve by 5+, etc.) came via secondary LSAT-prep sites citing LSAC reports; **I did not verify those specific percentages in the primary LSAC PDFs and they should be confirmed before being used externally.**

### The effect of ChatGPT on students' learning performance, learning perception, and higher-order thinking: a meta-analysis
- **Citation**: Wang, J., & Fan, W. (2025). *Humanities and Social Sciences Communications*, 12(1). doi:10.1057/s41599-025-04787-y
- **Link**: Cited in https://www.microsoft.com/en-us/research/wp-content/uploads/2025/10/GenAILearningOutcomes_published_2025-12-16.pdf
- **Date accessed / recency**: Aug 2, 2026. 2025.
- **Type**: Meta-analysis, 51 experimental studies (Nov 2022 – Feb 2025)
- **Population**: Mixed, heavily higher education. **[K-12 + ADULT]**
- **Key finding**: Large positive effect of ChatGPT on learning performance in **44 of 51** experimental studies. Moderators: course type (STEM vs. language), learning approach (personalized pacing, problem-based), and **how ChatGPT is used (scaffolded/intelligent tutoring and instant feedback vs. open-ended use).**
- **Relevance to this product**: The optimistic side of the AI ledger, and consistent with Bastani: **structured, scaffolded, feedback-oriented AI use works; open-ended answer-seeking does not.** The app's architecture (LLM grades and coaches *after* a committed answer) is on the right side of this distinction by design.
- **Confidence / caveats**: **Accessed via a Microsoft Research secondary summary, not the primary paper — I did not read the original moderator tables or the pooled effect size.** "44 of 51 positive" is vote-counting, which is a weak meta-analytic summary statistic. Treat with caution. Also, most included studies measured performance *with* AI available, which Bastani et al. showed is the misleading measure.

---

## Section 12 — Measurement, Prediction, and Benchmarking
*(Founder concern (c): "the app can't currently predict or benchmark real LSAT improvement.")*

### An astonishing regularity in student learning rate
- **Citation**: Koedinger, K. R., Carvalho, P. F., Liu, R., & McLaughlin, E. A. (2023). *PNAS*, 120(13). doi:10.1073/pnas.2221311120
- **Link**: https://doi.org/10.1073/pnas.2221311120
- **Date accessed / recency**: Aug 2, 2026. 2023, PNAS, 59 citations. **The single most theoretically important paper for the founder's thesis.**
- **Type**: Large-scale learning-curve modeling (logistic regression growth models, iAFM)
- **Population**: **1.3 million observations across 27 datasets**, elementary school through college, in math, science, and language. **[K-12 + ADULT/COLLEGE]**
- **Key finding**: Modeling initial correctness and learning rate separately per student and per knowledge component:
  - **Initial performance after lectures/readings averaged only ~65% correct** — verbal instruction alone does not produce mastery.
  - **Students vary substantially in initial performance**: ~55% correct for the lower half vs. ~75% for the upper half (median SD of student intercepts ≈ 0.65 log odds).
  - **But students are "astonishingly similar" in learning RATE** — typically **+0.1 log odds ≈ +2.5 percentage points of accuracy per practice opportunity**, with strikingly little between-student variance.
  - **Median ~7 practice opportunities** for a typical student to take a typical knowledge component to 80% mastery (mean 12.3, 95% CI [7.1, 17.5]).
- **Relevance to this product**: **This is the best available empirical arbitration of the founder's thesis, and it splits the verdict cleanly.**
  - **What it vindicates**: practice volume genuinely is the mechanism, and the rate of return per opportunity is remarkably uniform across people. A student who does the practice will improve at roughly the population rate. Practice-heavy design is not naive.
  - **What it refutes**: "students already have the prerequisite ability" is precisely the claim the data contradict — students arrive at ~65% on the components they've supposedly been taught, and they differ enormously in *which* components they start weak on. **Since rate is constant but starting point varies, the entire leverage of a practice product is in TARGETING — identifying each student's weak knowledge components and routing opportunities there.** Undifferentiated volume spends the same ~7 opportunities per component on components a given student has already mastered.
  - **A concrete design number**: if the app can decompose LSAT performance into knowledge components (e.g., "negate the necessary assumption," "identify a sufficient-vs-necessary confusion," "locate the conclusion when it is not last"), then **~7–12 targeted opportunities per weak component** is the evidence-backed practice budget, and progress becomes forecastable rather than mysterious.
- **Confidence / caveats**: Large, high-quality, and the analysis is careful. But the domains are ones with **well-defined knowledge components** (algebra steps, chemistry nomenclature, language grammar). **Whether LSAT logical reasoning decomposes into discrete knowledge components with clean learning curves is an open empirical question — arguably the single most valuable thing this product could find out from its own data** (see Open Questions). Also, "similar learning rate" is an average over components; it does not mean every student learns every component equally fast. **[Partly K-12.]**

### Examining the relationship between digital SAT practice tests and SAT performance
- **Citation**: College Board Research (May 2025). *Examining the Relationship Between Digital SAT Practice in Bluebook and SAT Performance.*
- **Link**: https://research.collegeboard.org/media/pdf/DigitalSATPracticeTests_052025.pdf
- **Date accessed / recency**: Aug 2, 2026. **May 2025 — very recent, and directly on the founder's practice-test question.**
- **Type**: Large-sample observational study with **propensity-style matched comparison groups** (explicitly non-causal)
- **Population**: US high school class of 2025 who took the SAT as juniors in March 2024, with prior PSAT scores. Large N. **[K-12, high-stakes admissions testing]**
- **Key finding**: Relative to matched peers who completed **zero** full-length digital practice tests, students who completed **1, 2, and 3+ full-length practice tests scored 25.7, 45.5, and 61.4 points higher** on the SAT, respectively. **Gains were substantially larger for lower-prior-achievement students** (at PSAT 900: **29.4 / 53.4 / 79.0** points) and muted at the top due to ceiling effects. **Marginal returns decline sharply after the second test**: for White students at moderate-to-high prior achievement, a third practice test produced gains no larger than a single one; Black and Hispanic students at PSAT 1300 gained 54 and 44 points from two tests but "few additional point gains" from a third. Earlier College Board research (Weatherholtz et al., 2020) found 6+ hours on Official SAT Practice associated with 20–40 additional points.
- **Relevance to this product**: **The most directly usable number in this entire report for the full-test question.** It supports a specific, defensible product policy: **two full-length simulations produce most of the available benefit; the third is where returns clearly flatten.** Combined with Section 9's transfer-appropriate-processing argument, this justifies a design of roughly **2–3 full-length simulations across a prep cycle, with section-length (35-minute) simulations as the recurring stamina/pacing vehicle** — rather than either "as many full tests as possible" or "no full tests at all." The larger gains for lower-scoring students also tell you where the product's marketable improvement lives: **a student starting at 150 has far more headroom than one starting at 168**, which should shape both targeting and the claims made in marketing.
- **Confidence / caveats**: **Explicitly not causal — the authors say so in a footnote.** Matching was on observables (PSAT, demographics, parental education); the authors openly concede that students completing 3+ practice tests likely also received structured guidance, targeted academic support, and motivational support that the design cannot separate. **Treat 25/45/61 as an upper bound on the practice-test effect, not a point estimate.** Also SAT, not LSAT, and **[K-12]** population. The *shape* (diminishing after 2, larger at the bottom) is more trustworthy than the magnitudes.

### The effect of admissions test preparation: evidence from NELS:88
- **Citation**: Briggs, D. C. (2001/2004). *Chance* / NEPC reprint.
- **Link**: https://www.nepc.colorado.edu/sites/default/files/Briggs_Theeffectofadmissionstestpreparation.pdf
- **Date accessed / recency**: Aug 2, 2026. Older but the canonical careful estimate; retained because it is the properly-controlled counterweight to the College Board study above.
- **Type**: Observational study with statistical controls, nationally representative longitudinal sample (NELS:88)
- **Population**: US high school students. **[K-12]**
- **Key finding**: After controlling for group differences, **commercial coaching raises SAT Math by 14–15 points and SAT Verbal by 6–8 points — about 20 points combined**, against advertised claims of 100–200+ points. Private tutoring had a similarly small effect on Math and none on ACT Math. Briggs' framing is the key methodological lesson: **advertised "average score gains of students who used our service" is not an effect, because it lacks a control group and confounds selection.**
- **Relevance to this product**: **The discipline this product needs.** Any internal or marketed improvement number computed as "average gain among LSAT Speedrun users" will be inflated by exactly the mechanisms Briggs identifies: motivated self-selection, concurrent other prep, retake practice effects (the ~2.8 points from Section 11 that everyone gets), and regression to the mean. **The only credible claim is one estimated against a matched or randomized comparison.** The app's existing 25% silent-control design for strategy trials shows the team already knows how to do this — the same discipline needs to be applied at the level of overall efficacy.
- **Confidence / caveats**: SAT-specific, dated, and pre-dates modern digital prep. Observational, though carefully controlled. The 20-point figure translates to roughly 0.1–0.2 SD, at the low end of Section 10's range.

### Predictive value of full-length practice exams for the MCAT
- **Citation**: (2020). *Journal of Medical Education and Curricular Development*, 7. doi:10.1177/2382120520981979
- **Link**: https://journals.sagepub.com/doi/10.1177/2382120520981979
- **Date accessed / recency**: Aug 2, 2026. 2020.
- **Type**: Correlational study with multiple regression
- **Population**: **Premedical students (adults, high-stakes admissions test).** **[ADULT]** — closest population match to LSAT takers found in this literature. **Very small N (df suggests N ≈ 19).**
- **Key finding**: Full-length practice exam performance strongly predicted actual MCAT score: **r = 0.92 for the MEDIAN practice score**, r = 0.79 for the most recent score, r = 0.60 for the maximum score. In regression, practice-exam median (β = 0.74) predicted MCAT far better than English proficiency (β = 0.34). Critically: **the NUMBER of practice exams completed correlated with the final practice score (r = 0.46) but NOT with actual MCAT performance (r = 0.24, p = 0.32).**
- **Relevance to this product**: **Two directly actionable results for the benchmarking problem.**
  - **Use the MEDIAN of a student's practice scores, not their best and not their most recent, as the score predictor.** The median outperformed both max (r = .92 vs .60) — a huge difference, and it is exactly the mistake students make when they anchor on their best practice test.
  - **The null for practice-exam COUNT is the more sobering finding**: taking more practice exams improved practice-exam scores without improving real MCAT scores — a within-format practice effect masquerading as learning. This is the Bastani "assisted gains, unassisted null" pattern in a different guise, and it argues the app's headline metric must be predicted-real-score-from-median, never "your scores are going up in our app."
- **Confidence / caveats**: **Very small sample — r = 0.92 from N ≈ 19 is unstable and almost certainly an overestimate.** Correlational. Single institution, English-proficiency-focused. The *ordering* (median > recent > max) is plausible on statistical grounds independent of this study (medians are robust to good/bad days), which is why I'd act on the direction while distrusting the magnitudes.

### College Board: practice test predictive validity (publisher guidance)
- **Citation**: College Board SAT Suite Help Center. "Is my child's score on a practice test a good indication..."
- **Link**: https://satsuite.collegeboard.org/help-center/my-childs-score-practice-test-good-indication-what-theyll-get-actual-test
- **Date accessed / recency**: Aug 2, 2026.
- **Type**: **Publisher FAQ — lowest-quality source in this report; logged for completeness as a partial dead end.**
- **Population**: SAT takers. **[K-12]**
- **Key finding**: The publisher states that a full-length official practice test score is "highly indicative" of the actual score, **especially when taken within a couple of weeks of the test and under the same time limits**, because many practice tests are retired live forms.
- **Relevance to this product**: Only useful for the boundary condition, which is consistent with Section 9's encoding-specificity argument: **predictive validity depends on timing proximity and on strict timing fidelity.** A practice score from an untimed, at-home, interruption-friendly session predicts poorly. If the app wants to output a predicted LSAT score, it must gate that prediction on sessions taken under enforced timing.
- **Confidence / caveats**: **Marketing-adjacent source from an interested party with no effect sizes and no methodology. Do not cite externally.** Included because the timing-proximity and timing-fidelity conditions are corroborated by the independent literature in Section 9.

### Interactions between termination criteria and ability estimators in computerized adaptive testing
- **Citation**: (2026). *Educational and Psychological Measurement*. doi:10.1177/00131644261453945
- **Link**: https://sage.cnpereading.com/doi/10.1177/00131644261453945
- **Date accessed / recency**: Aug 2, 2026. **2026 — current.**
- **Type**: Simulation study, 3PL IRT
- **Population**: Simulated examinees. **[N/A — psychometric simulation]**
- **Key finding**: Compared four ability estimators (MLE, WLE, MAP, EAP) against four stopping rules (fixed-length, standard error, minimum information, change-in-estimate) across 100-item and 500-item banks. **WLE (weighted likelihood) was the most robust estimator across all conditions**, avoiding MLE's boundary problems and Bayesian estimators' shrinkage bias. In **high-information banks**, SEM or fixed-length stopping gave the lowest RMSE. **In low-information, peaked banks (the realistic case for a startup's item bank), the strict SEM rule frequently failed to reach precision targets at the ability extremes**, producing inefficient maximum-length tests; the **change-in-estimate (Δθ) rule paired with WLE** gave the best accuracy/efficiency balance. Minimum-information stopping was consistently worst.
- **Relevance to this product**: **The concrete engineering recipe for turning the app's data into a credible LSAT score estimate — which is founder concern (c).** With a modest, unevenly-calibrated item bank, the recommendation is explicit: **weighted-likelihood ability estimation with a change-in-estimate stopping rule.** This also reframes the Diagnostic mode: 75 fixed items is a fixed-length rule, which this paper says is only optimal with a high-information bank. **An adaptive diagnostic could reach the same precision in materially fewer items**, freeing time for practice — and, unlike a raw percent-correct, an IRT θ estimate is on a scale that can be mapped to the 120–180 LSAT scale.
- **Confidence / caveats**: Simulation, not empirical, so it tells you what works given correct IRT assumptions. **The binding constraint for this product is not the estimator — it is item calibration.** θ estimates are only as good as the item parameters, and calibrating a bank requires substantial response data per item. This is a prerequisite, not a quick win.

### Piecewise power laws in individual learning curves
- **Citation**: Donner, Y., & Hardy, J. L. (2015). *Psychonomic Bulletin & Review*, 22(5). doi:10.3758/s13423-015-0811-x
- **Link**: https://pmc.ncbi.nlm.nih.gov/articles/PMC4577530/
- **Date accessed / recency**: Aug 2, 2026. 2015.
- **Type**: Large-scale learning-curve model comparison
- **Population**: **25,280 individual learning curves of 500 sessions each**, adults on cognitive training tasks (Lumosity). **[ADULT]**
- **Key finding**: Individual learning is **not** well described by a single smooth power law. **Piecewise power law (PPL) models fit significantly better than a single power law for every task** (PPL explained 90.7% of variance vs. 86.0% for PL1 vs. 33.9% for autoregressive). **Two- and three-piece solutions were most common** — transitions are infrequent but change the curve substantially when they occur. The authors interpret the breakpoints as **discrete strategy shifts**.
- **Relevance to this product**: **This is the statistical signature the strategy-trial bandit should be hunting for.** If a named strategy ("Argument Core," "Prephrase Before Choices") genuinely works for a given student, the evidence will not be a gentle slope change — it will be a **detectable breakpoint in that student's accuracy/latency curve**. Fitting a piecewise model to per-student curves and testing whether breakpoints cluster at strategy-adoption events is a far more sensitive test than comparing mean accuracy on strategy-shown vs. control trials, and would let the app answer "did this strategy change this student" with much less data. It also warns against a common analytics error: **averaging learning curves across students smooths away the very transitions that matter**, since breakpoints occur at different times for different people.
- **Confidence / caveats**: Cognitive-training tasks (speeded, narrow), not complex verbal reasoning; whether LSAT item performance shows comparable discrete breakpoints is untested. Lumosity data has known self-selection and engagement confounds. Adult population is a strength. The model-fit superiority is not in doubt given the sample size; the *interpretation* as strategy shifts is inference, not demonstration.

---
---

# PART II — SYNTHESIS

*~90 sources examined across 12 themed sections. Everything below is traceable to a logged source. Where the literature does not support a claim, I say so.*

---

## Top 12 actionable, evidence-backed findings

*Ranked by expected impact on real LSAT score improvement. "Expected impact" is my judgment combining effect size, how confidently it transfers to adult high-stakes verbal reasoning, and how large a change it represents from the app's current behavior. Where I'm extrapolating beyond the evidence, I flag it.*

---

### 1. Make the strategy prompt fade adaptively per student. Right now it is probably hurting your strong users.
**Support: Section 5** (expertise-reversal meta-analysis, 2025; Salden et al. adaptive fading).

The 2025 expertise-reversal meta-analysis finds high-assistance instruction helps novices (*d* ≈ +0.51) and **harms** more knowledgeable learners (*d* ≈ −0.43). The app currently surfaces a named strategy on roughly every 4th eligible question regardless of student level — that is uniform delivery, which the literature predicts is net-negative for anyone above roughly the median. In the one study that tested fading policies head-to-head, **adaptive fading beat fixed fading beat no fading, and adaptive got students to mastery in fewer steps.**

**Concrete change:** gate strategy-prompt frequency on per-student, per-question-type mastery. Someone at 90% accuracy on Flaw questions should never see the Flaw strategy card again. The existing bandit already collects the per-strategy-per-student lift data needed to drive this — the missing piece is letting the estimated lift drive *exposure rate*, not just reporting.

**Why it's #1:** it is the largest signed effect in the document (a ~0.9 SD swing between helping and harming), it applies to the users most likely to pay and evangelize, and the instrumentation to fix it already exists.

---

### 2. Stop requiring a written explanation on 100% of items. Target it, and structure it.
**Support: Section 2** (Bisra et al. 2018; time-equated comparisons; erroneous-examples review; breadth–depth literature).

Self-explanation is real: *g* ≈ 0.55 versus no prompt at equal item count, and ES ≈ 0.32–0.46 on transfer outcomes. But that is the wrong comparison. **The product's actual counterfactual is 12 explained items versus 25 unexplained items in the same 30 minutes, and time-equated studies have repeatedly failed to show a self-explanation advantage over simply doing more problems.** Two further findings sharpen this: explaining your own *possibly wrong* choice before feedback can be actively harmful, and **structured/scaffolded explanation substantially outperforms unstructured free text** — so you can buy most of the benefit at a fraction of the time cost.

**Concrete change:** require full written reasoning on roughly 25–40% of items — chosen for information value (wrong answers, high-confidence errors, question types where the student is weak, first exposure to a new type) — and replace free text with a short structured template (conclusion / premises / the gap / why the trap answer is tempting) on the rest. Let Infinite mode run mostly explanation-free.

**Counter-evidence, stated honestly:** Pan & Rickard's transfer meta-analysis credits "elaborated retrieval practice" — explicitly including *constructing a detailed explanation of one's response* — with **+*d* = 0.23**, and their bias-corrected analysis suggests naive drilling with no elaboration may transfer at approximately zero. So the answer is emphatically **not** "drop explanations." It is "stop taxing every item."

---

### 3. Decompose the LSAT into knowledge components and route practice to each student's weak ones. This is the whole ballgame for a practice-volume product.
**Support: Section 12** (Koedinger et al., PNAS 2023) **+ Section 7** (deliberate practice).

Across 1.3 million observations, students varied enormously in **initial** performance (~55% vs. ~75% correct) but were "astonishingly similar" in **learning rate** (~+2.5 percentage points per practice opportunity), needing a median of **~7 opportunities** to bring a knowledge component to 80% mastery. Meanwhile the deliberate-practice meta-analysis finds accumulated practice explains only ~4–5% of performance variance in education — because most of it is undirected.

**Concrete change:** define a knowledge-component taxonomy for the current LSAT (necessary vs. sufficient assumption, conclusion identification when the conclusion isn't last, causal-to-correlational flaws, principle matching, RC main-point vs. author-attitude, etc.), tag every item, fit per-student per-KC learning curves, and spend the ~7–12 opportunity budget only on components where the student is below mastery.

**Why this matters more than it sounds:** it converts the founder's thesis from an assertion into a mechanism. "Volume works" is weakly supported. "**Targeted** volume works, at a knowable rate, with a forecastable number of items to mastery" is well supported — and it is also the foundation for the score-prediction feature in #4.

---

### 4. Ship a credible predicted-LSAT-score number based on the MEDIAN of timed, unassisted performance. It fixes the benchmarking gap *and* the credibility gap at once.
**Support: Section 12** (MCAT predictive-validity study; CAT estimator study; College Board timing-fidelity guidance) **+ Section 8** (primary task support drives perceived credibility).

Practice-exam **median** score predicted actual MCAT score at *r* = 0.92, far better than **maximum** (*r* = 0.60) — students anchor on their best score and are systematically misled. Meanwhile, the number of practice exams taken predicted final *practice* score (*r* = 0.46) but **not** real MCAT score (*r* = 0.24, n.s.). For the estimator itself, the 2026 CAT simulation study recommends **weighted likelihood estimation with a change-in-estimate stopping rule** for the small, unevenly-calibrated item banks a startup actually has.

This also answers the founder's gamification anxiety from a direction he may not expect. In the credibility literature (Section 8), **primary task support — visible evidence the product advances your actual goal — outweighed aesthetics as a driver of perceived credibility.** The most effective response to "is this too gamey to be serious?" is not deleting the tycoon; it is putting a defensible score projection on the dashboard.

**Concrete change:** compute θ from timed, feedback-free, explanation-free items only (Sprint and Diagnostic qualify). Report the median, with an honest interval. Never report a projection from a session with LLM coaching, untimed work, or strategy prompts active.

---

### 5. Move all game rewards out of the question loop and onto session boundaries — and make them performance-contingent, never engagement- or completion-contingent.
**Support: Section 8** (Deci/Ryan meta-analyses; Cerasoli et al. 40-year meta-analysis; leaderboard RCT).

This is the highest-leverage *cheap* fix in the document. The reward-contingency data is unusually specific: engagement-contingent rewards (*d* = −0.42) and completion-contingent rewards (*d* = −0.48) do the most damage to intrinsic motivation; performance-contingent do far less (*d* = −0.24, and *+0.11* on self-reported interest); unexpected rewards are essentially harmless (*d* = −0.04); and **informational positive feedback is the only reward type that reliably *enhances* intrinsic motivation (*d* = +0.33).** Separately, extrinsic incentives predict work *quantity* while intrinsic motivation predicts work *quality* — and everything else in this document says quality is what moves scores.

**Concrete change:** paying case fees per question answered is a completion-contingent reward — the single worst-designed incentive available — and it is currently attached to the core loop. Pay on accuracy/calibration/mastery milestones at session end instead. Drop competitive leaderboards (in a well-powered adult RCT, negative leaderboard feedback was *worse than no feedback*); replace with personal upward-trend displays, which carried the motivational benefit without the ranking.

---

### 6. Two full-length simulations, then stop. Make the 35-minute single section your recurring test-condition unit.
**Support: Section 9** (College Board 2025; cognitive-endurance RCT; adult fatigue experiments) **+ Section 12**.

The founder's "as many full tests as possible" is not supported. Best available numbers (College Board, May 2025, large N, matched comparison): **+25.7 points for the first full-length practice test, +19.8 for the second, +15.9 for the third**, with returns clearly flattening — for several subgroups a third test produced no more gain than a first. Meanwhile the cognitive-endurance RCT found that **~20-minute blocks of sustained effortful thinking, 1–3× weekly for ~10–20 total hours, cut within-test performance decline by 22%, persisting 3–5 months.** The stimulus is *uninterrupted effortful concentration*, not test-length fidelity.

**Concrete change:** 2–3 full-length simulations across a prep cycle (one early as a diagnostic, one late as a dress rehearsal), and make the **uninterrupted 35-minute single section** the core repeatable test-condition unit. Sprint's 10 questions is far too short to train endurance.

**Caveat I want on the record:** the College Board numbers are explicitly non-causal, and the authors concede that students taking 3+ tests likely also got structured guidance they couldn't control for. Treat 25/45/61 as an upper bound. The *shape* (sharp diminishing returns after two) is more trustworthy than the magnitudes.

---

### 7. Hard-separate the reasoning phase from the AI phase, and measure progress only on unassisted items.
**Support: Section 11** (Bastani et al., PNAS 2025; Stanford 2026 AI review; Stadler et al. 2024).

In the defining RCT, students using an unguardrailed GPT scored **48% better on practice problems and 17% WORSE on the subsequent unassisted exam.** The guardrailed tutor eliminated the harm but produced **no positive exam effect**. Most alarming for an LSAT product specifically: in Stadler et al., what degraded under general chatbot use was **reasoning and argumentation quality** — the LSAT's entire construct. And students in Bastani et al. **did not perceive any reduction in their learning**, which means user satisfaction will never surface this failure mode.

**Concrete change:** the LLM must be unreachable before answer commitment (architecturally, not by convention). Treat unassisted Sprint/Diagnostic performance as the only real progress metric. If in-app accuracy is climbing while unassisted accuracy is flat, you have built the GPT Base condition.

---

### 8. Put high-confidence errors at the front of the Review queue.
**Support: Section 4** (hypercorrection effect; delayed-JOL meta-analysis; Lee et al. 2025 RCT).

Confidence capture is one of the better-supported features already in the app, but for a non-obvious reason. Calibration by itself barely moves performance — delaying judgments of learning improves judgment accuracy enormously (*g* = 0.93) while improving actual memory almost not at all (*g* = 0.08). **Calibration pays off only when it changes what gets studied.** The hypercorrection literature gives you the specific lever: **errors committed with high confidence are corrected more readily and more durably than low-confidence errors.**

**Concrete change:** rank the Review queue by confidence-weighted error, not recency. A confidently-wrong answer is the cheapest point on the board. And never ship a calibration display that isn't wired to a "so do this next" action.

---

### 9. Use response latency, not just accuracy, to drive the review schedule.
**Support: Section 11** (Mettler/Kellman ARTS studies) **+ Section 1** (spacing).

Adaptive spacing driven by each learner's ongoing **speed and accuracy** beat fixed expanding-interval schedules on efficiency and durability, with gains persisting to an independent standardized assessment 2–3 months later — in adults, in real classrooms. The app's fixed 1/3/7/21-day intervals are the "fixed schedule" comparison condition in that literature.

**Concrete change:** feed per-item latency into review scheduling. This matters more on the LSAT than in most domains because the test is speeded: a fast correct answer and a slow correct answer represent genuinely different mastery states, and only one of them survives under timed conditions.

**Honest caveat:** the adaptive-training meta-analysis (Section 11) found adaptive spacing buys *efficiency* — proficiency per hour — more reliably than a higher ceiling, and that **adapting difficulty and scaffolding outperformed adapting spacing.** So #1 (adaptive fading) should be built before this one.

---

### 10. Rebuild the strategy library around argument structure, and cut its size.
**Support: Section 6** (near/far transfer; reading-strategy network meta-analysis; near-transfer failure literature).

Far transfer from training is null — corrected effect ≈ 0.00, one of the more robust negative findings in psychology — so **the app should make no claim to improve reasoning ability.** That's fine, because LSAT prep is a *near*-transfer problem, and near transfer is real (*ḡ* ≈ 0.27 in strict analyses, ~0.5 SD for inference instruction specifically). But near transfer fails routinely when strategies are learned as surface procedures: students who understand the underlying structure often cannot solve *the same problem expressed differently*. And the best network meta-analysis on reading-strategy instruction found **more strategies did not mean better outcomes.**

**Concrete change:** ~13 named strategies is likely too many. Cut to the 5–7 with demonstrated per-student lift in your own bandit data. Frame each around argument structure ("find the conclusion, then find what must be true for the premises to reach it") rather than question-stem keywords ("when you see 'assumption,' negate the answer choices").

---

### 11. Measure each student's within-test performance decline curve, and train stamina only for those who show one.
**Support: Section 9** (Reyes et al. 1.9M students; Balart & Oosterveen; Ackerman & Kanfer adult experiments).

Real high-stakes data shows a 5–11% within-test performance decline, **concentrated in lower-performing students**, and the decline rate is a **stable individual difference**. But two well-designed adult experiments (N = 239 and N = 99) found subjective fatigue rising with time-on-task while performance stayed flat or *improved* — so decline is not universal, and generic "build your stamina" advice is misallocated for many students.

**Concrete change:** a single 35-minute section yields the decline curve. Report it. Prescribe endurance work only to students who demonstrably decline. **No competitor reports this, it costs one analysis on data you already collect, and it is legitimately differentiating.**

---

### 12. Separate visual registers: sober practice surfaces, playful meta-game.
**Support: Section 8** (gamification meta-analyses; credibility literature) **+ Section 9** (transfer-appropriate processing).

I want to be clear that **this is the weakest-evidenced recommendation in the list**, and I'm including it because it's cheap and has two independent rationales rather than because the evidence is strong. The "seriousness signaling in ed-tech" literature the brief asked for **essentially does not exist in rigorous form** — the best I found was a single-institution survey with self-reported trust and no experimental manipulation. On the learning side, gamification does **not** hurt outcomes on average (*g* ≈ 0.49 for cognitive outcomes among methodologically stronger studies), and effects in higher education are among the largest, so the "adults reject gamified learning" fear is **unsupported**.

The stronger argument for register separation is transfer-appropriate processing (Section 9): practice conditions should resemble criterion conditions. A question screen that looks like the real LSAT is justified by encoding specificity regardless of what it does for brand perception.

**Concrete change:** make question/timer/explanation/results screens visually sober and test-like. Keep the office, career map, and story exactly as playful as they are. Then A/B test it, because the literature cannot answer this for you.

---

## What the evidence says the founder's core thesis got RIGHT and WRONG

> **The thesis:** *"LSAT takers mostly already have the prerequisite reasoning ability, so all they need is an engaging, iterative loop of lots of practice questions."*

The thesis has three claims embedded in it. The evidence splits them: one is largely right, one is defensible-with-conditions, and one is wrong in a way that has direct product consequences.

### RIGHT: Practice really is the mechanism, and the rate of return is remarkably uniform.

Koedinger et al.'s 1.3-million-observation analysis (Section 12) found students "astonishingly similar" in learning rate — about **+2.5 percentage points of accuracy per practice opportunity**, with a median of ~7 opportunities to bring a knowledge component to mastery. That is a genuine vindication of a practice-heavy design. It says that if you get a student to do the reps on the right material, they will improve at roughly the population rate, and **you can forecast how many reps it will take.** Most ed-tech cannot say that.

The retrieval-practice family also holds up under 2024–2026 scrutiny better than the replication crisis might lead you to expect. Testing effects in classrooms remain solid, elaborated retrieval practice transfers at *d* = 0.40, and interleaving works when items are confusable — which LSAT question types conspicuously are.

### RIGHT, WITH A LARGE ASTERISK: "Engaging" is a legitimate design goal, and the gamification panic is not supported by evidence.

The founder's worry (a) — that serious students won't take a gamified product seriously — **is not supported as a learning claim.** Gamification's cognitive-outcome effect survives methodological scrutiny at *g* ≈ 0.49, and higher-education effects are consistently among the *largest* in the literature, not the smallest. There is no evidence base showing adults reject gamified learning.

The asterisk is that gamification is buying the wrong thing in the wrong place. Its benefits concentrate in **autonomy and relatedness**, and it **barely touches perceived competence** (*g* = 0.277, confidence interval nearly touching zero) — and competence is the only self-determination-theory need that maps to a score. Worse, the app's core reward is completion-contingent (case fees per question answered), which is the reward contingency most damaging to intrinsic motivation (*d* = −0.48). **So the correct diagnosis is not "too gamified." It is "gamified with the wrong contingency, in the wrong place in the loop."** That is a much cheaper problem to fix than a redesign.

### WRONG: "Takers mostly already have the prerequisite ability."

This is the load-bearing claim, and it is the one the evidence contradicts most directly.

Koedinger et al. found that **after** lectures and readings on the material, students sat at only **~65% correct** on the components they had ostensibly been taught — and they varied hugely in *which* components they were weak on (~55% for the lower half vs. ~75% for the upper half). Since learning *rate* is nearly constant across people but *starting point* is not, **essentially all of the leverage in a practice product lies in targeting.** Undifferentiated volume spends the same ~7 opportunities per component on components a given student already owns.

The deliberate-practice literature says the same thing from the other direction: accumulated practice explains only **~4–5% of performance variance in education** (Macnamara et al.), and even Ericsson's most favorable reanalysis of *properly individualized, goal-directed, immediately-fed-back* practice reaches 29%. **The gap between 4% and 29% is exactly the gap between "lots of practice questions" and "the right practice questions with feedback."** That gap is the product.

### WRONG: The implicit claim that the loop improves *reasoning ability*.

Far transfer from cognitive training is null (corrected effect ≈ 0.00; Section 6). Nothing in this app will make anyone a better reasoner in general. **This should be scrubbed from any marketing copy that implies it.** The good news is it doesn't matter: LSAT prep is a *near*-transfer problem — improving performance on a specific, stable, well-defined task format — and near transfer demonstrably works (~0.27 to ~0.5 SD depending on how it's measured).

### The honest magnitude, and why it's still a good business.

Section 10 synthesized seven independent evidence bases into a defensible target: **a well-executed distributed prep product should aim for roughly 0.25–0.40 SD, i.e., about 2.5–4 LSAT points on average**, larger for students starting low, near zero for students already at 172+.

The sobering context (Section 11): **LSAC's own data show repeat test takers gain 2.6–2.8 points on a second sitting with no structured product at all.** So the product cannot honestly claim "+3 points" as its contribution — a retake alone does roughly that. **The defensible claim is that structured, targeted prep gets a student their gain in one additional sitting instead of two or three, and shifts the upper tail** (roughly a third of retakers gain 5+, but only about 1 in 16 gains 10+). Any internal efficacy number computed as "average gain among our users" will be inflated by self-selection, concurrent prep, retake practice effects, and regression to the mean — this is precisely the error Briggs documented in commercial SAT coaching claims, where advertised gains of 100–200 points shrank to ~20 under proper controls.

**Also flagging a content risk that fell out of this research:** as of **August 2024, the LSAT removed Analytical Reasoning ("Logic Games")** and replaced it with a second Logical Reasoning section. The current test is 2× LR + 1× RC. If any part of the item bank or strategy library still weights Logic Games, that content is now dead weight, and given the transfer-appropriate-processing argument, item-mix fidelity to the *current* format is a first-order concern.

### The one-sentence version

**The loop is the right idea; the loop is currently untargeted, taxed on every item, uniformly scaffolded, rewarded on the wrong contingency, and unmeasured — and each of those five is separately fixable without abandoning the thesis.**

---

## Open questions the literature cannot answer for us

These are the questions where I looked and the evidence genuinely isn't there. Each would have to be measured internally. I've ordered them by how much I think the answer would change the product, and noted the cheapest experiment I can think of for each.

**1. Does LSAT logical reasoning decompose into knowledge components with clean learning curves?**
The Koedinger result — constant learning rate, ~7 opportunities to mastery — comes from domains with well-defined components (algebra steps, chemistry nomenclature, grammar). Whether "identify the necessary assumption" behaves like a knowledge component with a learnable curve, or whether LSAT reasoning is irreducibly holistic, is **unknown and, I'd argue, the single most valuable thing this product could discover from its own data.** Recommendation #3 depends entirely on the answer.
*Cheapest test:* tag existing items with a candidate taxonomy, fit per-student per-KC logistic growth models on data you already have, and check whether the curves are orderly and whether KC-level mastery predicts held-out items of the same KC better than overall ability does.

**2. What is the actual volume-vs-depth optimum for LSAT items specifically?**
The breadth-depth literature converges on "medium-depth, medium-breadth," and time-equated self-explanation studies suggest explanation doesn't beat more problems — but none of this is on LSAT items, on adults, under high stakes. **Recommendation #2's specific 25–40% figure is my extrapolation, not a finding.**
*Cheapest test:* randomize explanation-required rate (100% / 40% / 0%) within a fixed weekly time budget, outcome = unassisted timed section score at 4 weeks. This is a clean, high-value experiment and you have the infrastructure.

**3. Does the gamification layer change perceived credibility, and does that change conversion or retention among serious students?**
The seriousness-signaling literature the brief asked for **does not exist in rigorous form.** I found one single-institution self-report survey. Nobody has run the experiment.
*Cheapest test:* A/B the visual register of the practice surfaces (sober vs. current) against sign-up-to-first-session-completion and 14-day retention, split by self-reported target score. My honest expectation is that the effect is small and concentrated in high-target-score users — but that's a guess.

**4. Do the ~13 named strategies produce durable gains, or transient compliance?**
Your bandit measures within-session lift. It does not measure whether a strategy is still being used, and still helping, three weeks later without a prompt — which is the only thing that matters. The near-transfer literature specifically warns that strategies learned as surface procedures fail on rephrased items.
*Cheapest test:* the piecewise-power-law method from Section 12 — fit breakpoint models to individual accuracy/latency curves and test whether breakpoints cluster at strategy-adoption events. This is far more sensitive than mean comparison and works on existing data. Pair it with unprompted follow-up items of the same type weeks later.

**5. Does the LLM coach teach or does it become a crutch?**
Bastani et al. is the warning; nobody has run it on adult high-stakes verbal reasoning with a post-hoc (answer-committed) coach, which is a meaningfully different architecture from the chatbot-during-practice condition that caused harm.
*Cheapest test:* randomize coaching depth (full LLM coaching / correct-answer-only / brief rationale) and measure **unassisted** Sprint accuracy at 3 weeks. The critical design detail is that the outcome must be measured with the coach unavailable — the whole point of the Bastani result is that assisted performance lies.

**6. How much do full-length simulations add over section-length ones, for adults, on the LSAT?**
Section 9's recommendation is a synthesis across the SAT (non-causal, K-12), a cognitive-endurance RCT (not test prep), and adult fatigue experiments (not LSAT). **No study has directly compared full-length vs. section-length simulation on an adult admissions test.** The "2–3 full tests" figure is my synthesis, not a measured result.
*Cheapest test:* randomize students to 3 full-length vs. 9 section-length simulations at matched total time; outcome = a held-out full-length score. Expensive in student time, and honestly may not be worth running before questions 1, 2, and 5.

**7. Is the within-test decline curve stable enough per student to be worth reporting?**
Balart & Oosterveen say decline rate is a stable individual difference in population data. Whether it's stable enough *within one student across sessions* to be a trustworthy personal metric — rather than mostly noise — is a measurement-reliability question only your data can answer.
*Cheapest test:* compute test-retest reliability of per-student decline slope across sessions. If it's below ~0.6, don't ship it as a personal metric. This is a one-afternoon analysis and it should gate recommendation #11.

**8. What does the item bank's IRT calibration actually support?**
Recommendation #4 (predicted score) is only as good as item parameters, and calibrating a bank needs substantial responses per item. Whether you have enough data density is unknown to me.
*Cheapest test:* fit a 2PL/3PL on existing response data and inspect the standard errors of item parameters and the information function's coverage across the θ range you care about (roughly 150–170). **If the bank is thin at the top, your score predictions will be worst exactly for the users who care most.**

**9. Does the 1/3/7/21-day interval schedule beat a latency-adaptive one here?**
The ARTS results are from chemistry nomenclature, which is much closer to paired-associate learning than LSAT reasoning is. Whether response-time-based scheduling helps on complex verbal reasoning is untested.
*Cheapest test:* randomize the Review queue between fixed intervals and a latency-weighted schedule; outcome = accuracy on unassisted re-tests of the same KCs at 30 days.

---

### A closing note on the quality of this evidence base

Two things about the sources deserve to be stated plainly rather than buried in caveats.

**First, the population problem is pervasive.** A large share of the strongest evidence here — worked examples, expertise reversal, most gamification studies, the College Board practice-test data, Koedinger's learning-rate work, virtually all AI-tutoring RCTs — comes from K-12 or undergraduate populations in low-stakes settings. LSAT takers are self-selected adults, highly motivated, facing an expensive high-stakes outcome. **That population differs on precisely the dimensions (intrinsic motivation, self-regulation, prior ability) that moderate most of these effects.** Every effect size in this document should be read with that discount applied. Where I found adult-specific evidence (Ackerman & Kanfer, the Deci/Ryan meta-analyses, Pan & Rickard, the ARTS classroom studies), I've flagged it, and those findings deserve more weight.

**Second, the strongest and weakest parts of this report are not where you'd expect.** The best-evidenced recommendations are the unglamorous ones: fade the scaffolding, fix the reward contingency, target the practice. The founder's two headline anxieties are both, in their way, mis-specified — **the gamification worry is largely unsupported by evidence (the contingency is the real problem, not the quantity), while the benchmarking worry is the most tractable and most valuable thing on the list.** And the practice-loop worry sits in between: the loop works, but only to the extent that it is targeted, which it currently isn't.

*End of report. ~90 sources examined; two are logged twice where they bear on two sections (the College Board practice-test study in Sections 9 and 12, and Briggs' NELS:88 analysis in Sections 10 and 12).*
