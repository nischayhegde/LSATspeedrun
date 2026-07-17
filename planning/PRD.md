
**LSAT SHERLOCK**
MVP:

LSAT SHERLOCK will use a bank of real LSAT questions, answer choices, correct answers, and validated explanations. Before each study session, the adaptive system will select questions based on the student’s weak skills, prerequisite mastery, retention schedule, speed, and target difficulty. The LLM will then transform the selected questions into short detective cases by generating a case title, setting, character, case brief, narrative transition, and post-question outcome based on the subject matter of the original question.

The original LSAT stimulus, question stem, and answer choices should remain unchanged. Rewriting or paraphrasing them could unintentionally alter the logic or make a different answer defensible. Instead, the LLM will frame the stimulus as testimony, a report, an advertisement, an expert opinion, or another piece of evidence. For example, an LSAT question about a researcher’s causal conclusion could become a case in which the player investigates the researcher’s report. The official question would appear verbatim as the document being examined.

Each question will become a short micro-case rather than forcing unrelated LSAT questions into one complicated mystery. The persistent detective office, city map, characters, ranks, and larger narrative will connect the experience, while each question receives its own brief scenario. This allows the adaptive scheduler to prioritize learning instead of selecting inferior questions merely because their topics fit the current story.

For every question, the LLM can dynamically generate:

- A case name
- A two- or three-sentence case brief
- The character presenting the argument
- A reason the detective must evaluate it
- Short dialogue before the question
- Controlled hints
- A response to the student’s reasoning
- A correct and incorrect narrative outcome
- A transition to the next case
- A concise case debrief

**This story-mode procedural generation will come after a quick 30-40 holistic diagnostic which will comprehensively test the user's LSAT readiness to jumpstart the algorithm. This diagnostic won't just ask the user to answer mcq questions, it will ask them to provide reasoning/explanations which will also be graded.**


*A example scenario:*

**Case 184: The Sleepless Trial**
A medical researcher claims that a new supplement caused participants to sleep longer. The department is preparing to approve the treatment, but the chief detective suspects that the study overlooked another explanation. Examine the researcher’s report before the department makes its decision.

The app would then display the corresponding real LSAT question without changing its wording.

The LLM detective partner will evaluate how the student approaches the question, including their identification of the conclusion, evidence, assumption, prediction, eliminated choices, final answer, and confidence. Because the correct answer already exists in the question bank, the LLM will not decide correctness. It will use the answer key and validated explanation to identify the student’s first reasoning error, classify the wrong-answer trap, provide a hint, and produce a personalized debrief.

The question bank should contain more than questions and correct answers. Each question should eventually have a structured record containing its question type, tested skills, prerequisites, difficulty, canonical reasoning, logical structure, explanation for the correct answer, explanation for every wrong answer, and applicable trap suspects. The LLM can generate initial metadata offline, but it should be reviewed before being used for grading or instruction.

The detective gamification remains centered on mastery. Correctly solving and explaining questions earns XP, repairs districts, advances detective rank, and helps capture recurring trap suspects. Missed questions enter the Trap Vault and later return as appeals. Worked examples introduce new reasoning tools, guidance fades during subsequent cases, and timed trials remove all assistance. The system will use retrieval practice, spacing, interleaving, prerequisite sequencing, step-level feedback, transfer, and mastery learning to determine when questions reappear. We will have an LSAT "readiness" calculation which will translate into an estimated score.

To prevent distraction, the generated story content should be limited to a few sentences before and after each question. There should be no lengthy conversations, exploration requirements, inventory management, or story choices unrelated to learning. The LLM makes every session feel fresh and personalized, but approximately 90% of the student’s time remains focused on analyzing and answering real LSAT questions.


**USER PERSONA:**
We are targeting pre-law students who feel unmotivated/bored by the typical LSAT study resources out there but need to prepare for it under a time crunch.

**USER STORIES:**
- “I am a student who has never studied for the LSAT, and I want to be able to learn the foundational reasoning skills without feeling overwhelmed.”
- “I am a student who does not know what to study next, and I want to be able to receive a personalized daily study plan.”
- “I am a student who frequently gets questions wrong without understanding why, and I want to be able to see the first step where my reasoning failed.”
- “I am a student who watches LSAT lessons but struggles to apply them, and I want to be able to practice each concept with fading guidance.”
- “I am a student who loses motivation with conventional question banks, and I want to be able to see my progress through cases, ranks, and a developing 2D world.”
- “I am a student with limited study time, and I want to be able to spend each session on the activities most likely to improve my score.”
- “I am a student who repeatedly falls for the same wrong-answer patterns, and I want to be able to identify and eliminate my recurring trap suspects.”
- “I am a student who understands questions when practicing untimed, and I want to be able to gradually develop timed accuracy.”
- “I am a student who forgets concepts after learning them, and I want to be able to revisit them through automatically scheduled appeals.”
- “I am a high-scoring student trying to break through a plateau, and I want to be able to diagnose subtle reasoning, pacing, and confidence errors.”
- “I am an anxious student, and I want to be able to make mistakes without losing lives, ranks, or access to learning.”
- “I am a student preparing for a full LSAT, and I want to be able to progress from individual skills to mixed timed sections.”
- “I am a student who answers correctly by guessing, and I want the app to verify that I actually understand the reasoning.”
- “I am a student who wants affordable LSAT preparation, and I want to be able to receive personalized tutoring without paying for a private tutor.”




**TECH STACK:**

