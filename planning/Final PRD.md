**LSAT SHERLOCK**
MVP:

LSAT SHERLOCK will use a bank of real LSAT questions, answer choices, correct answers, and validated explanations. Before each study session, the adaptive system will select questions based on the student's weak skills, prerequisite mastery, retention schedule, speed, and target difficulty. The LLM will then transform the selected questions into short detective cases by generating a case title, setting, character, case brief, narrative transition, and post-question outcome based on the subject matter of the original question.

The original LSAT stimulus, question stem, and answer choices should remain unchanged. Rewriting or paraphrasing them could unintentionally alter the logic or make a different answer defensible. Instead, the LLM will frame the stimulus as testimony, a report, an advertisement, an expert opinion, or another piece of evidence. For example, an LSAT question about a researcher's causal conclusion could become a case in which the player investigates the researcher's report. The official question would appear verbatim as the document being examined.

Each question will become a short micro-case rather than forcing unrelated LSAT questions into one complicated mystery. The persistent detective office, city map, characters, ranks, and larger narrative will connect the experience, while each question receives its own brief scenario. This allows the adaptive scheduler to prioritize learning instead of selecting inferior questions merely because their topics fit the current story.

For every question, the LLM can dynamically generate:

- A case name
- A two- or three-sentence case brief
- The character presenting the argument
- A reason the detective must evaluate it
- Short dialogue before the question
- Controlled hints
- A response to the student's reasoning
- A correct and incorrect narrative outcome
- A transition to the next case
- A concise case debrief

**This story-mode procedural generation will come after a quick 30-40 holistic diagnostic which will comprehensively test the user's LSAT readiness to jumpstart the algorithm. This diagnostic won't just ask the user to answer mcq questions, it will ask them to provide reasoning/explanations which will also be graded.**


*A example scenario:*

**Case 184: The Sleepless Trial**
A medical researcher claims that a new supplement caused participants to sleep longer. The department is preparing to approve the treatment, but the chief detective suspects that the study overlooked another explanation. Examine the researcher's report before the department makes its decision.

The app would then display the corresponding real LSAT question without changing its wording.

The LLM detective partner will evaluate how the student approaches the question, including their identification of the conclusion, evidence, assumption, prediction, eliminated choices, final answer, and confidence. Because the correct answer already exists in the question bank, the LLM will not decide correctness. It will use the answer key and validated explanation to identify the student's first reasoning error, classify the wrong-answer trap, provide a hint, and produce a personalized debrief.

The question bank should contain more than questions and correct answers. Each question should eventually have a structured record containing its question type, tested skills, prerequisites, difficulty, canonical reasoning, logical structure, explanation for the correct answer, explanation for every wrong answer, and applicable trap suspects. The LLM can generate initial metadata offline, but it should be reviewed before being used for grading or instruction.

The detective gamification remains centered on mastery. Correctly solving and explaining questions earns XP, repairs districts, advances detective rank, and helps capture recurring trap suspects. Missed questions enter the Trap Vault and later return as appeals. Worked examples introduce new reasoning tools, guidance fades during subsequent cases, and timed trials remove all assistance. Speed is also tracked as its own axis of mastery (see the time and speed layer below): each closed case earns a pace score, and students race their own past performance instead of a static clock. The system will use retrieval practice, spacing, interleaving, prerequisite sequencing, step-level feedback, transfer, and mastery learning to determine when questions reappear. We will have an LSAT "readiness" calculation which will translate into an estimated score.


---

## Time and speed layer

Sherlock gets the student in the door with detective cases, real questions, and first-error diagnosis. This layer is what brings them back the next day: speed becomes something you train and watch improve, not a test you take at the end.

**Why speed needs its own layer.** The real LSAT is a race. Most people who take it never finish a section, and the thing that separates a 155 from a 170 is often not who understands the questions but who can recognize them fast enough to answer all of them. That skill, fast pattern recognition under a clock, is also the most trainable part of the whole test. Right now the plan treats time as a final exam ("timed trials remove all assistance"). That is timing as a checkpoint you eventually reach. The problem is that a bored, time-crunched pre-law student needs a reason to open the app on a Tuesday night, and "you'll be timed later" is not that reason. So make speed the thing they chase. Every case has a pace. Every session has a pace. The number that climbs on the screen is how fast they can correctly close a case, and beating it is the whole game.

**CAPM, the pace score.** Every case a student closes feeds a score called CAPM, correct answers per minute. Sherlock already scores whether you got the case right and whether your reasoning held up. CAPM adds the other axis: how fast you can do that, reliably, for a given type of case. It shows up on the debrief and the session summary, next to accuracy, and it is what records, ranks, and ghosts are built on. Two rules keep the number honest. It is weighted by difficulty, so a harder case is worth more per solve and a student's score keeps climbing even as the adaptive system feeds them tougher material. And wrong answers subtract, so you cannot juice your CAPM by machine-gunning guesses. Accuracy stays visible as its own stat and never gets buried inside the pace number.

**Ghosts, race the person you were last month.** This is the part that actually creates the habit. Every session quietly measures the student against their past self: last week, thirty days ago, personal best. Then it tells them. "You closed cases 40% faster than you were a month ago, at the same accuracy." During a run, a thin pace bar can race their current pace against one of those old baselines. It is the same thing that hooks people on speedrunning, chess ratings, and running apps. You are not competing with strangers. You are competing with the version of you that was slower, and watching that person fall behind is weirdly addictive. For a student whose main problem is motivation, concrete proof that they got faster does more than any streak counter. One deliberate choice: ghosts only race you against yourself in the early product. No public leaderboards. A leaderboard motivates the person already winning and quietly crushes the beginner who needs the app most.

**Speed as a rung on the detective ladder.** In Sherlock, you climb rank and repair districts by mastering cases. The time layer adds a second axis to that same climb. A case type is not finished when you can solve it correctly. It is finished when you can solve it correctly and fast. That fits the fading-guidance progression cleanly: worked example, then guided, then a timed trial as the top rung for every skill. Rank reflects both being right and being fluent.

**Flow difficulty, keep every case barely winnable.** Difficulty adjusts per skill to keep the student on the edge, hard enough that they have to focus, easy enough that they usually win, with a target somewhere around 75 to 85 percent accuracy. String together wins and the cases get harder. Miss a few and they get easier. The student stays parked right at the limit of what they can do, which is where attention and enjoyment both live. New students get protected from a bad first impression: their opening cases are deliberately easy, so the first session builds a little confidence before difficulty creeps up toward their real level. Three losses in the first thirty seconds is how you lose someone for good. The first session's job is to make them feel sharp, not to measure them.

**The one rule that keeps speed from backfiring.** Here is the trap with any speed trainer: push someone to go faster before they are accurate, and you train them to be confidently wrong at high speed. So the rule is simple. A student is never scored on speed for a skill until they are already accurate at it. New skills show up untimed, or on a generous clock, with no pace pressure. The CAPM layer for that skill only switches on once accuracy is there. Build the accuracy first, then compress the time. Speed is the reward for getting it right, and it never stands in for getting it right.

**How it sits in the architecture.** The time layer adds no new content and never touches a single word of a real LSAT question. It runs entirely on data the system already captures: whether the answer was correct, pulled from the answer key, and how long it took. CAPM, ghosts, flow difficulty, and the accuracy rule all live in the scoring and learning layer, in Flask and Postgres, kept separate from the generated story and from the canonical question bank, consistent with the architecture principle below. Scoring is deterministic and instant, so none of it slows down answering a case.

**One honest caveat for the team.** CAPM and ghosts only start working once there is enough history to measure. Real LSAT questions run 60 to 90 seconds each, so a session is a handful of long cases, not a rapid burst of tiny drills. That means the pace score moves slowly and the ghost needs a few sessions of history before it has anything motivating to say. Fine, but it changes the sequencing: the first session or two lean on the narrative hook to keep people around, and the time layer takes over as the reason to come back once a student has a past self worth beating. Worth building in that order on purpose.

---

To prevent distraction, the generated story content should be limited to a few sentences before and after each question. There should be no lengthy conversations, exploration requirements, inventory management, or story choices unrelated to learning. The LLM makes every session feel fresh and personalized, but approximately 90% of the student's time remains focused on analyzing and answering real LSAT questions.


**USER PERSONA:**
We are targeting pre-law students who feel unmotivated/bored by the typical LSAT study resources out there but need to prepare for it under a time crunch.

**USER STORIES:**
- "I am a student who has never studied for the LSAT, and I want to be able to learn the foundational reasoning skills without feeling overwhelmed."
- "I am a student who does not know what to study next, and I want to be able to receive a personalized daily study plan."
- "I am a student who frequently gets questions wrong without understanding why, and I want to be able to see the first step where my reasoning failed."
- "I am a student who watches LSAT lessons but struggles to apply them, and I want to be able to practice each concept with fading guidance."
- "I am a student who loses motivation with conventional question banks, and I want to be able to see my progress through cases, ranks, and a developing 2D world."
- "I am a student with limited study time, and I want to be able to spend each session on the activities most likely to improve my score."
- "I am a student who repeatedly falls for the same wrong-answer patterns, and I want to be able to identify and eliminate my recurring trap suspects."
- "I am a student who understands questions when practicing untimed, and I want to be able to gradually develop timed accuracy."
- "I am a student who has plateaued on accuracy, and I want to see concrete proof that I am getting faster without getting sloppier."
- "I am a student who needs a reason to keep coming back, and I want to race my own past performance instead of a leaderboard full of strangers."
- "I am a student who forgets concepts after learning them, and I want to be able to revisit them through automatically scheduled appeals."
- "I am a high-scoring student trying to break through a plateau, and I want to be able to diagnose subtle reasoning, pacing, and confidence errors."
- "I am an anxious student, and I want to be able to make mistakes without losing lives, ranks, or access to learning."
- "I am a student preparing for a full LSAT, and I want to be able to progress from individual skills to mixed timed sections."
- "I am a student who answers correctly by guessing, and I want the app to verify that I actually understand the reasoning."
- "I am a student who wants affordable LSAT preparation, and I want to be able to receive personalized tutoring without paying for a private tutor."




**TECH STACK:**

- **Frontend — React, TypeScript, and Vite, deployed on Vercel:** React is a strong fit for the app's stateful learning flows: the diagnostic, guided reasoning steps, timed practice, debriefs, daily plans, and mastery dashboards can be built as reusable components without coupling them to the game layer. TypeScript will keep question, attempt, skill, and feedback data consistent across the UI and API, while Vite provides a fast, low-overhead development and build setup. Vercel is a natural fit for serving the compiled frontend through its global edge network and provides automatic preview deployments for reviewing UI and game-world changes before release. Official LSAT content and core controls should remain accessible HTML rather than being drawn into a canvas.

- **2D/pseudo-3D graphics — PixiJS with `@pixi/react`:** PixiJS provides hardware-accelerated rendering for the detective office, city map, district repairs, characters, effects, and isometric or parallax scenes while remaining substantially lighter than a general-purpose 3D engine. Its React integration lets visual scenes coexist cleanly with the rest of the interface. The graphics layer should communicate progress and motivation, while question answering and reasoning remain in the DOM for readability, accessibility, and reliable text selection.

- **Backend — Flask (Python) with SQLAlchemy and Alembic, deployed on Railway:** Flask keeps the API small and flexible while the product's adaptive scheduler, mastery model, grading workflow, and LLM orchestration evolve. Python also provides a mature ecosystem for learning analytics and model integrations. SQLAlchemy supplies a clear data-access layer, and Alembic provides controlled schema migrations. Railway keeps deployment and environment configuration simple while allowing the API and background workers to run as separate services. Slow or failure-prone work—such as generating case framing, precomputing metadata, or calling an LLM—should run in a Railway worker so it never delays answer submission or timed practice.

- **Database — PostgreSQL on Railway:** The core data is highly relational: questions have answer choices, skills, prerequisites, explanations, attempts, error classifications, and review schedules. PostgreSQL provides the transactions and constraints needed to protect canonical question wording and answer keys, while indexed relational tables support adaptive scheduling and progress analysis. Hosting it on Railway alongside Flask reduces operational overhead and lets the backend connect over Railway's private network; automated backups and connection pooling should be configured before production. `JSONB` can hold versioned generated story content and structured LLM feedback without weakening the schema for validated learning content. `pgvector` can be added later if semantic retrieval proves useful, but is not required for the MVP.

- **Architecture principle:** The Vercel-hosted React/PixiJS client communicates only with the Railway-hosted Flask API; Flask owns application and learning logic, while Railway PostgreSQL remains the auditable source of truth. Canonical LSAT content, validated explanations, and correctness logic must remain separate from generated narrative and coaching output. This boundary prevents an LLM or visual feature from altering test content and makes the system easier to test, review, and improve independently.


---

**WEEKLY CHECKPOINTS (to Aug 10):**

Four weeks, four checkpoints. Each week ends with something that runs and can be shown, not a pile of half-finished parts. The order is deliberate: prove the core loop with real questions first, layer the detective framing and the time component on top, then polish and put it in front of actual students. If a week slips, cut scope from the game layer before cutting from the learning core.

- **Week 1 (Jul 17 to Jul 25) — the spine works end to end.** Stand up the repo, the Flask API, and the Postgres schema for questions, answer choices, explanations, attempts, and skills. Load a small seed set of questions with correct answers and validated explanations. A student can open a question in the browser, answer it, and get scored against the answer key. No story, no graphics yet. Checkpoint: a bare but real answer-and-score loop deployed to a preview URL.

- **Week 2 (Jul 26 to Aug 1) — diagnosis and the detective framing.** Add the LLM case framing around a question (title, brief, character, debrief) with the 90/10 rule enforced, and the first-error diagnosis that reads the answer key and validated explanation instead of deciding correctness itself. Wire up the Trap Vault so missed questions get recorded as suspects. Checkpoint: a student plays three or four framed cases in a row and gets a real debrief that names where their reasoning first went wrong.

- **Week 3 (Aug 2 to Aug 8) — the time component and adaptive selection.** Add CAPM scoring, per-session pace, and the first version of ghosts racing a past session. Add flow difficulty and the accuracy-gates-speed rule so a skill only gets timed once the student is accurate at it. Hook the scheduler up to pick the next case by weak skill and retention rather than at random. Checkpoint: a returning student sees their pace measured against last session, and the app chooses what to serve based on their history.

- **Week 4 (Aug 9 to Aug 10) — polish and put it in front of people.** Tighten the session summary, the debrief, and the rank or district progress so a first-timer understands what is happening without instructions. Fix the worst rough edges from your own play-throughs. Run it past a few real pre-law students and watch where they get confused or stop. Checkpoint: a deployed build that a stranger can use start to finish, plus a short list of what to fix next based on watching them use it.

Definition of done for the stretch: a student can open the app cold, get diagnosed, play framed cases against real questions, see their reasoning errors named, and watch their pace improve across sessions. Everything past that (the full PixiJS city, the licensed question bank, the full skill graph) waits until this core has been in front of real users.
