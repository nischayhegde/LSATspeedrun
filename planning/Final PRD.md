# LSAT SHERLOCK

## MVP

LSAT SHERLOCK is a story-driven LSAT practice app for pre-law students who are bored by normal study tools and short on time. It uses adaptive practice, short detective stories, and speed training to make studying more motivating without changing the logic of LSAT questions.

The first version covers all modern LSAT sections: Logical Reasoning and Reading Comprehension. The launch question bank should contain at least a few thousand questions, with a target of around 5,000 questions across question types and difficulty levels. The source and licensing approach for this bank is still to be decided. We must confirm that we have the right to use every question before it is shown to users.

## Core user flow

Users sign in with Google. Their diagnostic, attempts, readiness score, weak areas, story progress, pace history, and scheduled reviews are saved from day one.

Every new user starts with a 30–40 question diagnostic. The diagnostic is timed and includes a mix of normal multiple-choice questions and questions that ask the user to explain their reasoning in free text. At the end, the user sees:

- An initial estimated LSAT score
- A confidence level for that estimate
- Their weak areas
- A path into their first daily case session

Users choose a daily session size between 20 minutes and 1 hour. All practice runs under a timer. New skills can use a generous timer and no pace pressure until the student is accurate, but the app still records time spent.

The launch goal is simple: a new user can sign in, complete the diagnostic, receive an initial readiness score and weak-area breakdown, start the AI-generated detective storyline, and have all progress saved.

## Practice and adaptive learning

Before each session, the adaptive system selects questions using:

- Accuracy by question type
- Explanation accuracy by question type
- Time spent
- Recent mistakes
- Interleaving across skills and question types

The system uses these signals to create a daily session that focuses on the work most likely to improve the user’s score. More advanced prerequisites, retention models, and mastery rules can be added later.

Session construction has two bounded stages. First, the deterministic learning scheduler filters eligible Qbank records, ranks them from the signals above, selects a complete fallback sequence, and creates a bounded candidate pool of no more than 96 questions. Second, the TrueFoundry session planner may select and order only unique question IDs from that pool. It cannot introduce a question the learning layer did not make eligible. Diagnostic output must also pass deterministic coverage checks for section balance, question-type diversity, and difficulty bands.

The planner receives an answer-safe candidate manifest: internal candidate ID, bounded question stem or evidence excerpt, topic, question type, section, difficulty, and backend-derived `story_fit` allowlists for canonical character and location IDs. It must never receive answer choices, the answer key, canonical explanations, wrong-answer analysis, or trap metadata. Planning output must match a strict JSON schema and is rejected if it has the wrong count, duplicates, out-of-pool IDs, invented or question-incompatible cast/locations, copied question language, answer-like language, unsafe instructions, or insufficient diagnostic/daily diversity coverage.

An accepted plan contains one cohesive session arc plus a story role, pre-answer setup hook, and answer-neutral post-grade payoff hook for every selected question. The selected order and plan are saved before the session begins. Refreshing, signing out, pausing, or resuming restores the same order and current beat; resume never silently asks the LLM to plan a different session. If TrueFoundry is unavailable or any validation fails, the deterministic fallback questions open inside a deterministic connected arc. The planner uses `gpt-5.6-luna` at `xhigh` reasoning effort.

Some questions ask the user to write out their reasoning. Other questions are quick and do not require a written explanation. Reasoning is entered as free text. The system must treat that text as untrusted input and protect the LLM workflow from prompt injection.

The timing of feedback can change based on the story beat. The app may give feedback after a question or hold it until the next appropriate part of the case. In every mode, the known answer key decides whether an answer is correct; the LLM does not decide correctness.

## Question content and coaching

The original LSAT stimulus, question stem, and answer choices must remain unchanged. Rewriting or paraphrasing them could alter the logic or make a different answer defensible. The app presents the official question as a document, testimony, report, advertisement, expert opinion, or other piece of evidence within the case.

Each question record should eventually contain its question type, tested skills, difficulty, canonical reasoning, logical structure, correct-answer explanation, wrong-answer explanations, and trap suspects. The LLM can create initial metadata offline, but it must be reviewed before it is used for grading or instruction.

When a user gives a written explanation, the LLM uses the known answer, validated explanation, and structured metadata to identify the first reasoning error, classify the wrong-answer trap, give a hint, and write a short personal debrief. The LLM must never alter the original question, answer choices, answer key, or validated learning content.

## Story mode

Each diagnostic or daily session is one cohesive mystery with setup, complications, convergence, and a resolution hook. The story never has unrestricted control of question selection: it can connect and order only the bounded, learning-appropriate Qbank candidates supplied by the deterministic scheduler. This keeps the adaptive learning constraints authoritative without reducing the experience to disconnected micro-cases.

At session creation, the validated sequence planner generates:

- An arc title, premise, and objective
- A planned climax and resolution hook
- A distinct story role for every selected evidence file
- A canonical 3–5 character scene cast and renderable location matched to that question's broad domain and logical task
- A setup hook that is safe to show before the user answers
- A payoff hook that advances the investigation after grading and works for either answer outcome

The complete plan and question order are persisted with the session. The player UI shows stable arc metadata and only the current per-question beat; future per-question beats remain hidden. The same arc, episode position, setup, and payoff return after pause, refresh, sign-out, or resume.

The persistent story connects sessions through detective characters, recurring antagonists, side characters, and a cohesive detective world. Within each planned beat, the cinematic director can generate:

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

The planner and cinematic director must not receive answer choices or the answer key before grading. Their setup text cannot solve, paraphrase, fictionalize, eliminate answers for, or hint at the result of the canonical question. Strict schema, length, safety, answer-language, and question-copy validation applies before generated narrative reaches the student. If live generation fails, a connected deterministic Bureau plan and per-question fallback scene preserve the full learning flow.

The session planner and cinematic director use TrueFoundry with `gpt-5.6-luna` at `xhigh` reasoning effort. Story content must stay short. Around 90% of a student’s time should be spent reading, analyzing, and answering LSAT questions.

The MVP does not include an interactive city map, exploration, inventory, or story choices unrelated to learning. Instead, it uses polished 2D scenes, graphics, and animations to support the story. XP is the main launch progression system. Ranks, district repairs, the Trap Vault, and other game systems can be added later if they clearly support learning.

### Example scenario

**Episode 04 · Rising Complication: The Sleepless Trial**

A chain of earlier files has led the detectives to a disputed medical report. The current episode frames the report as the next evidence link without revealing how its argument works or which answer is correct.

The app then displays the corresponding LSAT question and choices without changing their wording. After deterministic grading, the episode’s answer-neutral payoff carries the investigation into the next planned file.

---

## Time and speed layer

Sherlock gets the student in the door with detective cases, real questions, and first-error diagnosis. The speed layer gives them a clear reason to come back: they can see themselves become faster without becoming less accurate.

### CAPM: the pace score

Every completed case feeds a score called CAPM: correct answers per minute. It appears in the debrief and session summary beside accuracy. CAPM is weighted by difficulty, so harder cases are worth more, and wrong answers reduce the score so students cannot improve it by guessing quickly.

Accuracy always stays visible as its own measure. CAPM measures pace; it never replaces correctness or understanding.

### Ghosts: race your past self

The app compares a student’s current session with their own past performance: last week, thirty days ago, or their personal best. It can say things such as, “You closed cases 40% faster than a month ago at the same accuracy.” A thin pace bar can compare the current session against one of these past baselines.

Early versions only compare students to themselves. There are no public leaderboards.

### Accuracy before speed

Speed training must not reward fast guessing. A student is not pace-scored for a skill until they are already accurate at it. New skills use a generous timer and no pace pressure. Once accuracy is established, CAPM and past-performance comparisons turn on for that skill.

This gives each skill a simple path: learn the reasoning, solve it accurately, then solve it accurately and faster.

### Difficulty and scoring rules

The long-term goal is to keep cases near the student’s learning edge: hard enough to require focus but not so hard that they repeatedly fail. New students should begin with easier cases so their first session builds confidence.

For the MVP, the scheduler uses the core adaptive signals listed above. Flow difficulty, full mastery gates, and more detailed retention rules are later improvements. CAPM, ghosts, and accuracy-before-speed rules live in the learning layer and use deterministic attempt data, so they never change question content or delay answer submission.

---

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
- I am a student who understands questions when practicing slowly, and I want to develop timed accuracy.
- I am a student who has plateaued on accuracy, and I want proof that I am getting faster without getting sloppier.
- I am a student who needs a reason to return, and I want to race my own past performance instead of strangers on a leaderboard.
- I am a student who forgets concepts after learning them, and I want to revisit them through automatically scheduled practice.
- I am a high-scoring student trying to break through a plateau, and I want to diagnose subtle reasoning, pacing, and confidence errors.
- I am an anxious student, and I want to make mistakes without losing access to learning.
- I am a student preparing for the full modern LSAT, and I want to progress from individual skills to mixed timed sections.
- I am a student who answers correctly by guessing, and I want the app to verify that I understand the reasoning.
- I am a student who wants affordable LSAT preparation, and I want personalized tutoring without paying for a private tutor.

## Tech stack

- **Frontend — React, TypeScript, and Vite, deployed on Vercel:** React supports the diagnostic, guided reasoning steps, timed practice, debriefs, daily plans, and progress screens. TypeScript keeps question, attempt, skill, and feedback data consistent across the UI and API. Official question content and core controls remain accessible HTML rather than being drawn in a canvas.

- **2D graphics — PixiJS with `@pixi/react`:** PixiJS renders detective scenes, characters, animations, and effects. It supports the story without turning the MVP into an interactive game world. Question answering and reasoning remain in the DOM for readability, accessibility, and text selection.

- **Backend — Flask (Python) with SQLAlchemy and Alembic, deployed on AWS**

- **Database — PostgreSQL on AWS:**

- **Authentication — Google sign-in:** Google authentication is required for the MVP so users can save and return to their progress.

- **AI runtime — TrueFoundry:** The validated session planner, per-question cinematic director, written-reasoning grader, controlled hints, and wrong-answer explanations use `gpt-5.6-luna` at `xhigh` reasoning effort. The deterministic learning layer owns eligibility and scoring; generated narrative and coaching remain separately validated, labeled, and recoverable through saved fallbacks.

- **Architecture principle:** The Vercel-hosted React/PixiJS client communicates only with the Railway-hosted Flask API. Flask owns application and learning logic, and Railway PostgreSQL is the auditable source of truth. Canonical question content, answer keys, and validated explanations remain separate from generated narrative and coaching output.

## MVP boundaries

- The MVP launches as a web app. A React Native and Expo mobile app is a later decision, not a required launch deliverable.
- The question-bank source and licensing plan must be decided before production launch.
- The MVP focuses on timed adaptive practice, connected session arcs with short animated story scenes, XP, pace tracking, and saved progress. It does not require an interactive game world.
- Public leaderboards, interactive maps, ranks, district repairs, the Trap Vault, and full mastery or retention systems do not block the MVP.

## Weekly checkpoints (to August 10)

Each week ends with something that runs and can be shown. If a week slips, cut scope from the game layer before cutting the learning core.

- **Week 1 (July 17–25) — the core loop works:** Set up the React app, Flask API, and Postgres schema for users, questions, answer choices, explanations, attempts, skills, and Google sign-in. Load a small seed set of questions with correct answers and validated explanations. A student can sign in, open a question, answer it, and receive deterministic scoring. Checkpoint: a bare answer-and-score loop deployed to a preview URL.

- **Week 2 (July 26–August 1) — diagnosis and connected detective framing:** Add the 30–40 question diagnostic, initial readiness score, weak-area breakdown, validated session-sequence planner, and question-matched cinematic framing. Add first-error feedback that uses the answer key and validated explanation rather than deciding correctness. Checkpoint: a student completes the diagnostic and plays three or four connected story beats with a real debrief.

- **Week 3 (August 2–8) — speed and adaptive selection:** Add CAPM, per-session pace, and the first past-performance comparison. Add the first scheduler version using accuracy, explanation accuracy, time spent, recent mistakes, and interleaving, then constrain the story planner to that bounded eligible pool. Checkpoint: a returning student sees their pace against a past session and receives a stable connected sequence based on their history.

- **Week 4 (August 9–10) — polish and test:** Tighten the session summary, debrief, and XP progress. Fix the largest issues found in play-throughs. Test with a few pre-law students and watch where they get confused or stop. Checkpoint: a deployed build that a new user can use from sign-in through a saved study session, plus a short list of fixes based on observed use.
