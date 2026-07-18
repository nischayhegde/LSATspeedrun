# LSAT SHERLOCK

## MVP

LSAT SHERLOCK is a story-driven LSAT practice app for pre-law students who are bored by normal study tools and short on time. The app uses real or properly licensed LSAT-style questions, adaptive practice, and short detective stories to make studying feel more personal without changing the logic of the questions.

The first version covers all modern LSAT sections: Logical Reasoning and Reading Comprehension. The launch question bank should contain at least a few thousand questions, with a target of around 5,000 questions across question types and difficulty levels. The source and licensing approach for the question bank is still to be decided. We must confirm that we have the right to use any question before it is shown to users.

Every new user starts with a 30–40 question diagnostic. The diagnostic is timed and includes a mix of normal multiple-choice questions and questions that ask the user to explain their reasoning in free text. At the end, the user sees:

- An initial estimated LSAT score
- A confidence level for that estimate
- Their weak areas
- A path into their first daily case session

Users sign in with Google. Their diagnostic, attempts, readiness score, weak areas, story progress, and scheduled reviews are saved from day one.

## Practice sessions

Users choose a daily session size between 20 minutes and 1 hour. All practice is timed. Time spent is one of the signals used to find weak areas, along with accuracy and the quality of the user’s explanations.

Before each session, the adaptive system selects questions using:

- Accuracy by question type
- Explanation accuracy by question type
- Time spent
- Recent mistakes
- Interleaving across skills and question types

The system should use these signals to create a daily session that focuses on the work most likely to improve the user’s score. More advanced prerequisites, retention models, and mastery rules can be added later.

Some questions ask the user to write out their reasoning. Other questions are quick and do not require a written explanation. Reasoning is entered as free text. The system must treat that text as untrusted input and protect the LLM workflow from prompt injection.

The timing of feedback can change based on the story beat. The app may give feedback after a question or hold it until the next appropriate part of the case. In every mode, the known answer key decides whether an answer is correct; the LLM does not decide correctness.

## Question content and feedback

The original LSAT stimulus, question stem, and answer choices must remain unchanged. Rewriting or paraphrasing them could alter the logic or make a different answer defensible. The app presents the official question as a document, testimony, report, advertisement, expert opinion, or other piece of evidence within the case.

Each question record should eventually contain its question type, tested skills, difficulty, canonical reasoning, logical structure, correct answer explanation, wrong-answer explanations, and trap suspects. The LLM can create initial metadata offline, but it must be reviewed before it is used for grading or instruction.

When a user gives a written explanation, the LLM uses the known answer, validated explanation, and structured metadata to identify the first reasoning error, classify the wrong-answer trap, give a hint, and write a short personal debrief. The LLM should never be allowed to alter the original question, answer choices, answer key, or validated learning content.

## Story mode

Each question is a short micro-case, not part of one large mystery that controls question selection. This lets the adaptive system choose the best question for learning instead of choosing an inferior question because it fits the current story.

The persistent story connects sessions through detective characters, recurring antagonists, side characters, and a cohesive detective world. For every question, the LLM can generate:

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

Story content must stay short. Around 90% of a student’s time should still be spent reading, analyzing, and answering LSAT questions.

The MVP does not include an interactive city map, exploration, inventory, or story choices unrelated to learning. Instead, it uses polished 2D scenes, graphics, and animations to support the story. XP is the main launch progression system. Ranks, district repairs, the Trap Vault, and other game systems can be added later if they clearly support learning.

### Example scenario

**Case 184: The Sleepless Trial**

A medical researcher claims that a new supplement caused participants to sleep longer. The department is preparing to approve the treatment, but the chief detective suspects that the study overlooked another explanation. Examine the researcher’s report before the department makes its decision.

The app then displays the corresponding LSAT question without changing its wording.

## User persona

We are targeting pre-law students who feel unmotivated or bored by typical LSAT study resources but need to prepare under a time crunch.

## User stories

- I am a student who has never studied for the LSAT, and I want to learn foundational reasoning skills without feeling overwhelmed.
- I am a student who does not know what to study next, and I want a personalized daily study plan.
- I am a student who gets questions wrong without understanding why, and I want to see the first step where my reasoning failed.
- I am a student who watches LSAT lessons but struggles to apply them, and I want practice with fading guidance.
- I am a student who loses motivation with conventional question banks, and I want XP, detective characters, and a developing story world that shows my progress.
- I am a student with limited study time, and I want each session to focus on the activities most likely to improve my score.
- I am a student who repeatedly falls for the same wrong-answer patterns, and I want to identify my recurring traps.
- I am a student who understands questions when practicing untimed, and I want to develop timed accuracy.
- I am a student who forgets concepts after learning them, and I want to revisit them through automatically scheduled practice.
- I am a high-scoring student trying to break through a plateau, and I want to diagnose subtle reasoning, pacing, and confidence errors.
- I am an anxious student, and I want to make mistakes without losing access to learning.
- I am a student preparing for the full modern LSAT, and I want to progress from individual skills to mixed timed sections.
- I am a student who answers correctly by guessing, and I want the app to verify that I understand the reasoning.
- I am a student who wants affordable LSAT preparation, and I want personalized tutoring without paying for a private tutor.

## Launch goal

A new user can sign in with Google, complete the diagnostic, receive an initial readiness score and weak-area breakdown, start the AI-generated detective storyline, and have all progress saved.

## Tech stack

- **Frontend — React, TypeScript, and Vite, deployed on Vercel:** React is a strong fit for the diagnostic, guided reasoning steps, timed practice, debriefs, daily plans, and progress screens. TypeScript keeps question, attempt, skill, and feedback data consistent across the UI and API. Official question content and core controls remain accessible HTML rather than being drawn in a canvas.

- **2D graphics — PixiJS with `@pixi/react`:** PixiJS renders the detective scenes, characters, animations, and effects. It supports the story without turning the MVP into an interactive game world. Question answering and reasoning remain in the DOM for readability, accessibility, and reliable text selection.

- **Backend — Flask (Python) with SQLAlchemy and Alembic, deployed on Railway:** Flask owns the adaptive scheduler, readiness calculation, attempt grading workflow, saved progress, and LLM orchestration. Slow work, such as generating case framing, precomputing metadata, and calling an LLM, runs in a Railway worker so it does not delay answer submission or timed practice.

- **Database — PostgreSQL on Railway:** PostgreSQL stores questions, answer choices, skills, explanations, attempts, feedback, review schedules, story progress, and generated content. `JSONB` can hold versioned story content and structured LLM feedback while canonical question content and correctness data remain protected.

- **Authentication — Google sign-in:** Google authentication is required for the MVP so users can save and return to their progress.

- **Architecture principle:** The Vercel-hosted React/PixiJS client communicates only with the Railway-hosted Flask API. Flask owns application and learning logic, and Railway PostgreSQL is the auditable source of truth. Canonical question content, answer keys, and validated explanations remain separate from generated narrative and coaching output.

## MVP boundaries

- The MVP launches as a web app. A React Native and Expo mobile app is a later decision, not a required launch deliverable.
- The question-bank source and licensing plan must be decided before production launch.
- The MVP focuses on timed adaptive practice, short story scenes, XP, and saved progress. It does not require an interactive game world.

## Timeline

**July 19:** Complete the LSAT-prep brainlift and decide the question-bank sourcing plan.

**Week 1:** Build the rough web MVP and begin preparing a large, structured question bank across modern LSAT sections.

**Week 2:** Refine the web app, graphics, UX, and adaptive system. Deploy the web app to production once question-content rights are confirmed. Decide later whether to build a React Native and Expo app.

**Week 3:** Start go-to-market work, collect user feedback, and prepare the presentation.
