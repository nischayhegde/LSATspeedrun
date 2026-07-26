# Personalized LSAT Strategy Experiments

## Product claim

The Method Lab does not promise a 170+ score and does not treat a prep-provider technique as universally effective. It asks a narrower, testable question: **for this student, on this family of LSAT questions, does a short strategy prompt improve first-attempt accuracy without an unacceptable pace cost?**

No professional source located during this review offers a defensible guarantee that a particular method produces a 170+. LSAC is the authority on what the test asks. Commercial prep providers supply useful practitioner hypotheses. High-scorer accounts are anecdotal support, not proof of causation.

## Evidence hierarchy

1. **Official test guidance.** LSAC says LR answers must address the precise question, use only the supplied information, and not be selected merely because they are true. LSAC's RC guidance explicitly recommends experimenting with several reading approaches and deciding what works best for the individual student.
2. **Established practitioner guidance.** 7Sage recommends high-volume practice, focused drills based on observed weaknesses, and a wrong-answer journal that explains both why the credited answer is right and why the selected answer is wrong. PowerScore's LR materials are used for common conditional, causal, assumption, and prephrasing techniques.
3. **Learning science.** Retrieval practice, feedback, transfer practice, and distributed review support the broader practice architecture. They do not validate any one LSAT-specific commercial technique.
4. **Individual app evidence.** The Method Lab compares prompted and unprompted work inside the same learner. Until enough observations exist, results are explicitly labeled forming or directional.

## Fourteen testable methods

| Method | Section | Operational procedure | Why it is testable |
| --- | --- | --- | --- |
| Argument Core | LR | Identify conclusion, relevant premises, and the gap | Tests whether separating proof from support reduces structural errors |
| Prephrase Before Choices | LR | Name task, predict needed effect, then verify with choices | Tests whether a prediction reduces attractive-answer interference |
| Necessary-Assumption Negation | LR | Find gap, negate a contender, retain it only if the argument fails | A question-type-specific falsification procedure |
| Causal Alternatives Audit | LR | Name cause/effect, test reversal or confounds, identify isolating comparison | Tests whether a causal checklist reduces correlation mistakes |
| Conditional Chain | LR | Translate sufficient/necessary terms, link shared terms, test contrapositive | Tests disciplined diagramming without over-diagramming every stimulus |
| Abstract the Flaw | LR | State conclusion, name leap without topic words, match the same structure | Tests structural transfer across surface topics |
| Scope and Force Check | LR | Mark force words, match population/time, reject broader claims | Tests whether explicit quantifier checking reduces overstatement errors |
| Statement Role Map | LR | Find main conclusion, label support/objection/context, match function | Tests functional rather than topical reading |
| Low-Resolution Passage Map | RC | Record each paragraph's job, mark the major turn, return for details | Tests structure retention without attempting verbatim memory |
| Viewpoint Ledger | RC | Track speakers, agreements/conflicts, and author attitude | Tests viewpoint attribution in multi-position passages |
| Paragraph Function | RC | Name each paragraph's job and its relationship to the prior paragraph | Tests whether structure predicts purpose and organization answers |
| Textual Proof Standard | RC | Restate task, locate textual warrant, reject answers needing assumptions | Tests evidence discipline on detail and inference questions |
| Comparative Relationship Matrix | RC | Map A, map B, then state their relationship before choices | Tests explicit synthesis in comparative sets |
| Main-Point Synthesis | RC | Combine subject, central claim, and purpose in one sentence | Tests whether a compact global representation improves global questions |

Every in-product brief is intentionally limited to three steps. The full catalog stays collapsed on the dashboard so it does not compete with the current question.

## Assignment algorithm

### Eligible surfaces

- Deep Practice: eligible because immediate coaching and deliberate reasoning are already part of the mode.
- Infinite: eligible because it supplies enough volume for within-student comparisons.
- Story/case play: inherits Deep Practice assignments, so a brief appears as a partner's case instruction rather than an unrelated tutorial card.
- Diagnostic: excluded to preserve baseline validity.
- Sprint: excluded to preserve timed, unseen measurement.
- Review: excluded because repeated items and error-targeted selection would bias the comparison.

### Cadence and matching

- Only question positions where `position % 4 == 2` are eligible: question 3, 7, 11, and so on.
- The candidate set is restricted by section and question type. A necessary-assumption procedure is not tested on an unrelated main-point question.
- The assignment is stable for the same user, question, position, and mode. Reloading cannot reroll a preferred condition.
- Twenty-five percent of eligible assignments are hidden controls. The question is served normally, while its strategy key is retained for comparison.
- The first three adhered prompted observations for each applicable method prioritize coverage.
- After exploration, 70% of assignments favor the current leader and 30% test the next challenger. This prevents the system from permanently locking onto an early lucky result.
- Students receive one assigned brief and choose `Use this brief` or `Solve normally`. They do not select their favorite strategy from a menu, which would create severe self-selection bias.

### Timing

The interface requires the method decision before answer entry. Prompt-reading time is recorded and capped at 60 seconds. That time is subtracted from the strategy's pace estimate, not from the official session timer or raw attempt record. Accuracy remains the primary outcome.

## Measurement

For each student and method, the dashboard reports:

- Prompted, adhered sample size
- Hidden-control sample size
- First-attempt accuracy in each condition
- Accuracy lift in percentage points
- Average server-measured response time after subtracting capped prompt-reading time
- Percentage within the question's target time
- Skipped method briefs

Evidence labels are deliberately conservative:

- **Forming:** fewer than four prompted observations or fewer than two controls
- **Directional:** at least four prompted and two controls, but fewer than eight prompted or four controls
- **Supported:** at least eight prompted and four controls

The dashboard names a strongest method only at the supported threshold. Directional leaders remain visible but are not presented as winners. These thresholds reduce overclaiming; they do not turn the result into a population-level clinical or educational trial.

## Why the design uses an individualized comparison

Students differ in baseline skill, pacing, reading habits, and error patterns. Comparing one student's prompted work with another student's unprompted work would confound the method with those differences. A sparse within-student comparison reduces that problem and fits LSAC's own recommendation to experiment with RC approaches. Hidden controls also avoid expectancy effects created by always announcing that a technique should help.

The design still has limits:

- Question difficulty is only approximately matched through type and repeated allocation.
- Practice effects and time trends can affect later observations.
- Adherence is self-reported by the `Use this brief` decision.
- A positive result for one question family should not be generalized to the entire LSAT.
- A supported method can later regress as more data arrives.

For a production study, add stratified randomization by calibrated difficulty, preregistered primary outcomes, minimum detectable-effect analysis, and an export suitable for independent review.

## Integration with the learning loop

1. Diagnostic establishes a neutral LR/RC baseline without strategy prompts.
2. Sprint supplies timed, unseen accuracy and pacing evidence.
3. Deep Practice repairs selected weaknesses and occasionally introduces a matched method brief.
4. Infinite supplies additional fluent practice and sparse method trials.
5. Immediate concise reasoning explains the credited answer after each eligible practice response.
6. Review schedules errors and confidence mismatches without contaminating method estimates.
7. The Progress dashboard separates test performance, review recovery, confidence calibration, and Method Lab results.

This preserves gamification as a complement to instruction. The game fiction delivers a partner brief and case context; the underlying instructional content, response evidence, and feedback remain the learning mechanism.

## Sources

### Official LSAT guidance

- [LSAC: Suggested Approach for Logical Reasoning](https://www.lsac.org/lsat/taking-lsat/test-format/logical-reasoning/suggested-approach-logical-reasoning)
- [LSAC: Suggested Approach for Reading Comprehension](https://www.lsac.org/lsat/taking-lsat/test-format/reading-comprehension/suggested-approach-reading-comprehension)

### Practitioner guidance

- [7Sage: Learning Logical Reasoning for the New LSAT](https://7sage.com/blog/learning-logical-reasoning-for-the-new-lsat)
- [7Sage: LSAT Reading Comprehension Tips](https://7sage.com/blog/lsat-reading-comprehension-tips)
- [7Sage: Cracking 170 — LSAT Strategies](https://www.youtube.com/watch?v=x1ZmXWqaLOU)
- [PowerScore: Logical Reasoning Help](https://help.powerscore.com/lsat/logical-reasoning)

### Learning science supporting the surrounding architecture

- Roediger & Karpicke (2006), [Test-Enhanced Learning](https://doi.org/10.1111/j.1467-9280.2006.01693.x)
- Butler (2010), [Repeated Testing Produces Superior Transfer of Learning](https://doi.org/10.1037/a0019902)
- Dunlosky et al. (2013), [Improving Students' Learning With Effective Learning Techniques](https://doi.org/10.1177/1529100612453266)
- Cepeda et al. (2006), [Distributed Practice in Verbal Recall Tasks](https://doi.org/10.1037/0033-2909.132.3.354)
- Shute (2008), [Focus on Formative Feedback](https://doi.org/10.3102/0034654307313795)
