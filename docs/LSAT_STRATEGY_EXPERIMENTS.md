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

### Student-facing names

The names above are the ones these techniques carry in LSAC and prep-provider materials. Students see a plain name instead, so the question card reads as help rather than as terminology. The formal name appears only as a subtitle in the dashboard catalog, which preserves the link to the published sources. Both strings live in `backend/app/strategies.py`.

| Formal name | Student-facing name |
| --- | --- |
| Argument Core | Split the argument |
| Prephrase Before Choices | Guess before you look |
| Necessary-Assumption Negation | Negate the answer |
| Causal Alternatives Audit | Question the cause |
| Conditional Chain | Follow the if-thens |
| Abstract the Flaw | Name the bad move |
| Scope and Force Check | Watch the wording |
| Statement Role Map | Label each sentence |
| Low-Resolution Passage Map | Map the paragraphs |
| Viewpoint Ledger | Track who thinks what |
| Paragraph Function | Ask why this paragraph |
| Textual Proof Standard | Point to the line |
| Comparative Relationship Matrix | Compare the two passages |
| Main-Point Synthesis | Say the point in one line |

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
- Students receive one assigned brief and choose `Use it` or `Skip this one`. They do not select their favorite strategy from a menu, which would create severe self-selection bias. The two options are deliberately unequal in visual weight — one primary button, one quiet link — because the point is to lower the cost of the decision, not to present it as a dilemma.

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

These three tiers remain the internal state and are still returned by `strategy_performance`. The dashboard collapses them to two words — `still checking` for forming and directional, `confirmed` for supported — so a student is never asked to interpret a sample threshold. The distinction survives in the sentence attached to each approach: an unconfirmed one always says more questions are needed.

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

## The Reading Comprehension passages have no paragraphs, so the app derives parts

Two of the six RC approaches — Low-Resolution Passage Map and Paragraph Function — ask a student to say what each paragraph of a passage is doing. Every one of the 349 passages in this bank arrived from its Hugging Face snapshot as a single unbroken run of prose, with no newline, tab, doubled space or line separator anywhere, so the paragraph breaks were lost upstream and there is nothing in the data to read them from. Until this was fixed, "give each paragraph its job in three to twelve words" asked for one note covering three thousand characters, and Paragraph Function's requirement that the parts not all share a function was skipped on every question in the section, because it needs more than one part before it has anything to compare.

`app/passage_structure.py` divides each passage by lexical cohesion, following Hearst's TextTiling: score every gap between sentences by how far the vocabulary on one side differs from the vocabulary on the other, and cut where that difference is locally deepest. An authored break is used where one exists, and the seam between Passage A and Passage B on the 32 comparative sets is always a cut.

**These are topical parts, not the author's paragraphs, and the app says so.** The 32 comparative seams are the only boundaries in the bank that are genuinely known, so stripping the headings and asking the segmenter to find the seam blind is a held-out test against the easiest boundary there is. It lands within one sentence of the seam 26 times in 32, which a chooser given the same number of boundaries in the same admissible places matched in 1 of 300 draws; it lands on the exact sentence 11 times in 32 against 7.9 expected, which chance matched in 44 of 300. So there is good evidence about roughly where a passage turns and none that the exact sentence is better than a guess.

Three consequences, all deliberate:

- Every boundary is stored on the passage with the provenance `derived_cohesion_v1`, so a later reader can tell a derived boundary from an authored one without inferring it from the shape of the data.
- The student-facing copy asks what each **part** of the passage is doing, never each paragraph. The operation the technique teaches — read for structure, name what each stretch is doing — is unchanged by the rename, and it is what makes a boundary that lands a sentence early an odd division rather than a false claim about the writing.
- Both graders are told the boundaries are derived and instructed never to mark a student down for a division they did not choose.

`scripts/derive_passage_paragraphs.py --verify` re-runs the measurement, and `--sample N` prints whole passages divided as the app divides them. The second is not a formality: reading the output is what found a division that had cut the case citation "Charrier v. Bell" in half, which no aggregate score could have shown.

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
- Hearst (1997), [TextTiling: Segmenting Text into Multi-paragraph Subtopic Passages](https://aclanthology.org/J97-1003/) — the method used to divide the RC passages, which arrived with no paragraph breaks
- Shute (2008), [Focus on Formative Feedback](https://doi.org/10.3102/0034654307313795)
