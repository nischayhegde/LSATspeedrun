Lawyer Tycoon

From a wooden shack to a legal empire—one LSAT case at a time

Product thesis: The question bank is the work; the tycoon world is the reward. Every answer should produce an immediate courtroom outcome, every short case should move a client matter forward, and every session should visibly transform the player’s firm.

Document: Product Requirements DocumentVersion: 1.0Date: July 2026Status: Build-ready concept PRD

1. Executive summary

Lawyer Tycoon is an LSAT practice game in which the player begins as a broke, unknown solo lawyer working from a wooden shack in tattered clothes. Solving authentic Logical Reasoning and Reading Comprehension questions wins cases, earns cash, builds reputation, attracts clients, and turns the shack into a global law firm.

The game succeeds only if the tycoon layer makes the next question more desirable without obscuring the LSAT task. Questions remain intact, correctness comes only from the verified answer key, and progression changes rewards and presentation—not which answer is correct.

CORE PRODUCT DECISION Do not make the experience ‘a question bank with coins.’ Build three nested loops: a 60–120 second answer loop, a 5–12 minute case loop, and a multi-week firm-building loop.

1.1 Product promise

A user should be able to open the app for ten minutes, win a client matter, hire or upgrade something meaningful, see the office change, and leave already anticipating the next milestone.

1.2 Working assumptions

Primary audience: prospective LSAT takers who want more entertaining repetition than a conventional question bank.

Primary platform: responsive web app, optimized first for desktop and tablet; mobile is supported for quick cases.

Game mode: single-player at launch, with asynchronous competition and study groups later.

Content: LSAT LR and RC items supplied through normalized datasets with verified keys and confirmed redistribution rights.

Business model: free core practice for MVP; monetization is a later product decision and must not sell answer power.

2. Vision, goals, and non-goals

2.1 Vision

Make LSAT practice feel like building something. The player should remember the office they earned, the associate they hired, the rival firm they beat, and the landmark matter that unlocked the next district—while still completing a serious volume of real LSAT questions.

2.2 Product goals

Increase voluntary practice frequency and question volume by making progress visible and emotionally rewarding.

Deliver trustworthy answer checking, written-reasoning feedback, and explanations for every choice.

Create a firm progression that resembles the arc from struggling solo practice to a major multi-office firm.

Support satisfying sessions from 3 minutes to 30 minutes without an energy gate.

Create enough long-term collection, customization, and strategic choice to retain users for months.

Keep game rewards subordinate to practice so users cannot meaningfully progress by idling alone.

2.3 Explicit non-goals for MVP

No performance-adaptive or mastery-based question sequencing.

No model-selected answer key, rewritten LSAT prompt, or generative replacement for source questions.

No real-time multiplayer courtroom battles, open-world movement, or 3D office simulation.

No complex employee scheduling, salaries, loans, bankruptcy, or punitive maintenance costs.

No loot boxes, paid random rewards, energy timers, forced waiting, or purchasable correct answers.

No claim that the game is a realistic simulation of legal practice or a substitute for full LSAT instruction.

2.4 Experience pillars

Every answer feels consequential. A response produces a verdict, client reaction, reward, and useful feedback within seconds.

The office tells the story. The home screen is a living visual record of progress, not a menu with a background image.

Progress resembles a law firm. Users move through credible stages: solo practice, staff, associates, partners, practice groups, and additional offices.

Practice integrity is non-negotiable. Source content remains unchanged; the verified key outranks all model output.

The game respects the player. Retention comes from ambition, mastery, and ownership—not punishment or artificial scarcity.

3. Core experience and game loop

3.1 Moment-to-moment loop

Choose a matter. Select a Quick Consultation, Client Matter, RC Investigation, Trial, or Daily Docket from the case board.

Receive the brief. See a short client setup, stakes, expected payout, question count, and progress toward the next firm milestone.

Analyze. Read the unmodified LSAT prompt and choices; optionally record confidence and written reasoning.

Commit. Submit an answer. The verified key determines the result.

See the verdict. Get a fast courtroom animation, client response, cash, reputation, and case progress.

Review. Read the correct rationale, why each distractor fails, and an LLM critique of the user’s reasoning.

Invest. Spend earnings on the office, clothes, staff, technology, brand, or connections.

Continue. Return to the docket with the next reward and milestone already visible.

3.2 Nested reward cadence

Loop

Target cadence

Player payoff

Answer

60–120 seconds

Verdict, explanation, cash, reputation, satisfying feedback

Case

5–12 minutes

Client resolution, completion chest with fixed contents, office progress

Session

10–25 minutes

At least one meaningful purchase, hire, or visible renovation

Chapter

2–7 days

New district, client tier, office shell, and recurring rival story

Career

Several months

National/global firm, collections, prestige track, seasonal chapters

3.3 The home-office scene

The default home screen is the player’s office. Staff walk through it, rooms animate, clients wait, awards appear on walls, and upgrade hotspots are embedded in the scene. The docket, shop, roster, and career map remain one click away, but the firm—not a dashboard—is the emotional center of the product.

A glowing phone or client at the door opens the next case.

Construction markers preview the next office upgrade and its cost.

Staff speech bubbles surface daily missions, passive revenue, and narrative events.

A skyline or neighborhood view changes as the player moves to new firm tiers.

4. Opening and onboarding

4.1 Starting fantasy

The game opens on a rain-soaked wooden shack labeled ‘Law Office.’ Inside are a damaged desk, one flickering lamp, a stack of overdue notices, and the player in a patched, ill-fitting suit. The tone is playful and hopeful rather than humiliating. A nervous first client arrives because every other lawyer refused the matter.

4.2 First five minutes

Name the lawyer and firm; choose a simple avatar base. No questionnaire or diagnostic.

Accept a three-question tutorial matter using a curated, accessible LR tutorial set.

Learn question answering, confidence selection, written reasoning, verdict feedback, and explanation review.

Earn enough guaranteed tutorial cash to repair the desk and replace one piece of tattered clothing.

See the shack change immediately, unlock the city docket, and preview the first major goal: hire a paralegal.

ONBOARDING RULE The user must make a visible choice and improve the office before minute five. The first purchase is guaranteed even if every tutorial answer is wrong; correctness affects the bonus, not onboarding completion.

4.3 Activation definition

A new user is activated when they complete one case, review at least one explanation, and purchase one visible upgrade. Account creation alone is not activation.

5. Case system

5.1 Case formats

Format

Content

Use

Quick Consultation

1 LR question

A 2–3 minute session or daily warm-up

Client Matter

3–5 LR questions

Default short session and early-game case

RC Investigation

1 passage plus its linked questions

Preserves passage context and rewards completion

Trial

7–10 LR/RC questions

Higher-value session with a visible argument meter

Landmark Case

12–20 questions over multiple stages

Chapter finale, rival encounter, major firm unlock

Daily Docket

3 fixed-size objectives

Reliable return hook with no artificial urgency

5.2 Question presentation rules

Display the source passage, stem, and choices verbatim except for strictly non-substantive formatting normalization.

Keep the narrative wrapper outside the question card. Never alter names, facts, or wording to force the item into the fictional case.

For RC, retain the passage-to-question relationship and complete the passage set before sampling another passage.

Show source attribution and item identifiers when required by the content license or internal auditing policy.

The server-side verified key is authoritative. The LLM may explain or critique but cannot change correctness.

5.3 Answer-and-review flow

The user selects an answer, a confidence level, and optionally types or records reasoning.

The answer locks; the verified key returns the verdict immediately.

A short animation advances or damages the case argument meter. This meter is presentation only and does not override item-level accuracy.

If wrong, the user may take one ‘appeal’ using a targeted hint before seeing the full rationale. An appeal can recover part of the cash but does not erase the initial miss in analytics.

The app explains the correct answer and each distractor, then grades the submitted reasoning against a narrow rubric.

The user can bookmark, report, or add the question to a self-directed review folder. Review folders do not change automatic selection in MVP.

5.4 Written-reasoning rubric

Score

Label

Definition

0

No analysis

Blank, irrelevant, copied prompt, or answer-only response

1

Weak

Identifies a topic or conclusion but misses the decisive relationship

2

Partial

Uses relevant logic but leaves a gap, overstates, or fails to eliminate key distractors

3

Sound

States the decisive reasoning and connects it to the selected answer

Reasoning feedback must quote or point to the user’s own claim, explain one strength and one improvement, and avoid awarding a high score merely because the chosen answer was correct.

6. Firm progression

6.1 Career ladder

Tier

Firm state

Major unlock

0

Wooden Shack Practice

Basic docket, patched outfit, first client

1

Rented Room

Paralegal, wardrobe shop, daily docket

2

Neighborhood Storefront

Junior associate, waiting room, local referrals

3

Downtown Suite

Practice groups, researcher, trial matters

4

Boutique Firm

Senior associates, premium clients, rival-firm chapter

5

High-Rise Headquarters

Partners, departments, citywide reputation

6

National Firm

Regional offices, prestige track, national clients

7

Global Legal Empire

International offices, landmark docket, endgame collections

6.2 Upgrade families

Office and rooms

Upgrade the shell, desk, lobby, conference room, legal library, research room, staff bullpen, partner floor, war room, and rooftop. Each renovation changes the persistent home scene.

Wardrobe and status

Progress from patched clothes to thrifted business wear, tailored suits, courtroom attire, watches, briefcases, and prestige outfits. Most clothing is cosmetic; selected milestone outfits unlock client tiers or dialogue, never answer advantages.

Technology

Buy a working phone, computers, research subscriptions, case-management software, secure servers, and an AI research lab. Technology provides clear economy or convenience bonuses, such as a modest review reward or a longer passive-revenue cap.

Brand and client acquisition

Invest in signage, a website, community events, awards, press, and referral programs. These upgrades unlock visually distinct client classes and higher-value case contracts.

Professional connections

Collect trust-based relationships with legal-aid groups, law schools, accountants, expert witnesses, journalists, local businesses, and bar associations. Connections unlock referrals, events, and case categories; they never imply bribery or buying judicial outcomes.

6.3 Chapter structure

Each tier is a chapter with one clear visual objective, three client arcs, one recurring rival-firm encounter, and one Landmark Case. Finishing the Landmark Case unlocks the next office shell. Chapters provide narrative context without requiring long cutscenes.

7. Economy and rewards

7.1 Primary progression values

Cash is spendable. It comes from questions, case completion, daily objectives, and staff retainers. It buys upgrades, hires, clothing, renovations, technology, and brand investments.

Reputation is permanent and non-spendable. First-attempt correctness and case completion increase it. Reputation unlocks firm tiers, client classes, and staff ranks.

Connections are collectible unlocks, not a third grindable currency. They come from chapter milestones and special matters.

7.2 Reward formula

PROPOSED FORMULA Question cash = base item reward + reasoning-quality bonus + capped streak bonus. Case cash = fixed completion reward + first-attempt accuracy bonus. Do not use a speed bonus in standard practice.

Correct first attempt: full item cash and reputation.

Correct appeal: partial item cash, no first-attempt reputation.

Wrong after appeal: small preparation stipend only after the explanation is opened.

Reasoning score: a small bonus capped low enough that verbose filler is never optimal.

Streak bonus: rises gradually and caps at 25%; one mistake reduces it rather than wiping it out.

7.3 Economy pacing targets

Stage

Target purchase cadence

Design intent

First session

Every 3–5 questions

Teach that effort changes the world immediately

Early game

One meaningful purchase per 8–12 correct answers

Maintain momentum without making choices trivial

Mid game

One upgrade or hire per 1–3 sessions

Create planning and specialization

Late game

Multi-session projects with visible partial construction

Support ambition without dead progress

7.4 Economy sinks

Office shell renovations and room construction

Furniture and technology tiers

Hiring and promoting staff

Wardrobe, office themes, trophies, and cosmetic collections

Practice-group expansions and regional offices

Optional prestige projects after the main career ladder

7.5 Economy guardrails

Practice is never blocked by cash, energy, staff, or office tier.

No normal-mode answer permanently removes earned upgrades or causes bankruptcy.

Cash purchased with real money is out of scope; premium cosmetics must not affect correctness or leaderboard power.

Server-configured reward and cost tables must support balancing without a client release.

8. Staff, practice groups, and passive income

8.1 Staff roles

Role

Fantasy

Mechanical benefit

Paralegal

Organizes files and clients

Adds a small explanation-review stipend

Junior Associate

Handles routine matters

Generates base retainer revenue

Legal Researcher

Builds arguments and precedent

Boosts written-reasoning bonus within a cap

Office Manager

Keeps the practice running

Extends offline-revenue storage

Rainmaker

Builds trusted referral networks

Increases high-tier client frequency

Senior Partner

Leads a practice group

Provides a modest team-wide multiplier

8.2 Passive-income model

Hired lawyers work a Routine Docket and generate retainer revenue while the user is away. Passive income should make the firm feel alive, but it must remain a supplement to active practice.

Offline earnings are capped initially at 8 hours and stored visibly on the office desk.

Collecting the full amount requires completing one ‘morning briefing’ question; skipping it collects only a reduced amount.

At steady state, passive income should contribute roughly 20–30% of an engaged player’s total cash—not a majority.

Staff never answer or remove real LSAT questions on the player’s behalf.

No salaries or negative offline cash in MVP. Hiring is an upfront purchase to avoid return anxiety.

8.3 Practice groups

At Downtown Suite, the player assigns staff to Litigation, Appellate, Corporate, Public Interest, or Investigations. Practice groups shape passive rewards, client visuals, and office decor. They do not alter the LSAT answer key or create performance-based question selection.

9. Retention and live systems

9.1 Daily Docket

Each day offers three compact objectives, such as complete one Client Matter, submit written reasoning twice, or review three explanations. Rewards are useful but not mandatory for core progression. A missed day does not create debt or permanently destroy a streak.

9.2 Streaks with forgiveness

Track ‘active days this week’ rather than a brittle endless daily chain.

Award a weekly briefcase after 3, 5, and 7 active days.

Grant automatic grace days through ordinary play; do not sell streak repair.

9.3 Landmark Cases

A Landmark Case is the chapter finale. It unfolds across an opening statement, evidence phase, cross-examination, and verdict. The user may pause between stages. Completion awards a signature trophy, client cinematic, major reputation gain, and the next firm tier.

9.4 Collections and achievements

Courtroom trophies for chapter finales and accuracy feats

Client thank-you letters displayed in the office

Outfit sets and office themes earned through progression

Books, case files, and landmark precedents that fill a visual library

Career achievements based on meaningful practice, not raw time in app

9.5 Random office events

Short, non-punitive events make the office feel alive: a nervous intern asks for advice, a reporter requests a comment, a client refers a friend, or the rival firm sends a taunt. Choices change flavor, small rewards, or cosmetics; they never conceal a test answer.

9.6 Post-MVP social systems

Asynchronous city leaderboards based on case points, separated by weekly cohorts

Bar Associations: small study groups contributing solved questions toward shared office decor

Weekly mock-trial events with identical question sets and delayed results

Friend visits that show office design without revealing private performance

10. Narrative, world, and tone

10.1 Tone

The world is a stylized legal dramedy: ambitious, witty, and slightly exaggerated. The player’s rise should feel earned and aspirational. The opening poverty is a temporary visual contrast, not the target of jokes. Clients and firms are fictional.

10.2 Recurring cast

The mentor: a retired attorney who teaches systems and comments on milestones.

The rival: a polished partner from an elite firm who underestimates the player.

The first client: returns throughout the career and makes the rise feel personal.

The reporter: turns reputation milestones into public moments and new referrals.

The office manager: introduces staff, passive income, and chapter operations.

10.3 Narrative delivery

Use scenes under 20 seconds, short client messages, animated office moments, and chapter cards. Never make users sit through dialogue before each question. Narrative should frame practice, reward progress, and then get out of the way.

10.4 Realism boundaries

Progression borrows recognizable firm stages but is not a legal-career simulator.

Professional connections represent trust and referrals, not corrupt influence.

Avoid using real judges, law firms, active cases, or protected brands without permission.

State clearly that LSAT questions test reasoning and do not represent everyday legal work.

11. User experience requirements

11.1 Primary surfaces

Surface

Required elements

Office

Living firm scene, next case entry, upgrade hotspots, passive revenue, staff activity

Docket

Case cards, length, section, reward, progress, new-content marker

Case workspace

Readable passage/question, choices, confidence, notes, reasoning, accessibility controls

Verdict

Correctness, rationale, distractor analysis, reasoning critique, rewards, report action

Upgrade shop

Before/after preview, exact cost, exact benefit, prerequisites

Roster

Staff role, rank, assignment, benefit, next promotion

Career map

Current firm tier, next requirements, chapters, landmark cases

Session summary

Questions, first-attempt accuracy, reasoning use, cash, reputation, next milestone

11.2 Game feel

Verdict feedback begins within 300 ms of receiving the server response.

Reward counting completes in under two seconds and is skippable.

Office upgrades show a before/after animation and persist on the next home visit.

Audio, particles, and haptics have separate controls and respect reduced-motion settings.

Wrong answers feel informative, not shameful; avoid red-screen failure theatrics.

11.3 Accessibility

Full keyboard navigation, visible focus, screen-reader labels, and scalable text.

High-contrast question mode with decorations removed from the reading surface.

No information conveyed by color alone; captions for audio and animation cues.

Reduced motion disables camera moves, particles, and repeated counting animations.

Passage highlighting and notes work without a mouse.

12. Question selection and session logic

12.1 Selection policy

Within a normal session, eligible questions are sampled uniformly at random without replacement. RC questions are sampled at the passage-set level. Question performance never affects automatic selection in MVP.

Exclude invalid, reported-and-disabled, unlicensed, or structurally incomplete items before sampling.

Avoid questions seen in the previous 30 days when enough unseen content exists; this is anti-repeat logic, not performance adaptation.

Use a server-generated session seed so the selection is auditable and resumable.

Landmark Cases may specify a fixed mix of LR and RC, but selection inside each pool remains random.

Tutorial items come from a manually approved tutorial subset and are the only fixed-order exception.

12.2 Session behavior

A session declares its question count before the first item.

Closing the browser preserves the current case and item state.

Refreshing never generates a new question or rerolls a wrong answer.

Rewards are server-authoritative and idempotent; repeated requests cannot duplicate cash.

A session summary distinguishes initial answers, appeals, skipped items, and completed explanations.

13. AI and content integrity

13.1 Responsibility split

Function

Authority

Correctness

Verified dataset key only

Question text

Normalized source record only

Choice explanations

Pre-generated and quality-checked model output, with fallback copy

Written-reasoning grade

LLM constrained by rubric and verified key

Narrative wrapper

LLM or templates; cannot alter or preview the underlying question

Question order

Deterministic sampling service; never the LLM

13.2 Explanation requirements

State the credited answer and the decisive reasoning in plain language.

Explain why every other choice fails, referencing its specific flaw.

Never invent facts outside the prompt or claim that the source key is wrong.

If the explanation pipeline lacks confidence or fails validation, show a limited fallback rather than a fabricated rationale.

Provide a one-click report action for wrong key, bad explanation, broken formatting, or content-rights concern.

13.3 Content pipeline

Ingest and normalize dataset records into a canonical schema.

Validate choice count, credited key, required text, passage relationships, encoding, and duplicates.

Confirm source provenance and redistribution rights before any item is enabled in production.

Generate explanations offline; run key-consistency and contradiction checks.

Human-review a risk-based sample and all user-reported items.

Version every item and explanation so outcomes can be audited after updates.

LAUNCH BLOCKER A dataset appearing on Hugging Face does not by itself establish permission to redistribute its questions. Licensing and provenance must be resolved before public launch.

14. Data model and system requirements

14.1 Core entities

User: identity, settings, accessibility, notification consent.

Question: source text, choices, verified key, section, passage link, license, status, version.

Case: format, seeded item list, stage, rewards, narrative template, completion state.

Attempt: initial answer, appeal answer, correctness, confidence, reasoning, timing, explanation viewed.

Firm: cash, reputation, tier, office layout, owned upgrades, cosmetics.

Staff: role, rank, practice group, passive rate, cosmetic state.

Economy ledger: every grant and spend with idempotency key and balance after transaction.

Content report: item version, category, user note, status, resolution.

14.2 Non-functional requirements

Autosave every answer, reasoning draft, purchase, and office change.

Question and answer submission p95 latency below 800 ms, excluding optional model feedback.

Correctness and base explanation remain available if the live LLM is degraded.

Economy transactions are server-authoritative, atomic, auditable, and reversible by support.

The system supports remote configuration for rewards, costs, unlock thresholds, and daily objectives.

Personally identifiable data and free-text reasoning follow a defined retention and deletion policy.

15. Metrics and experimentation

15.1 North-star metric

NORTH STAR Weekly completed, reviewed question decisions per active user: an initial answer plus exposure to the explanation or reasoning feedback. This rewards genuine practice, not idle time or menu interaction.

15.2 Product metrics

Area

Measures

Activation

First case complete; first explanation viewed; first upgrade purchased; time to activation

Engagement

Questions/session; cases/week; reasoning submission rate; explanation completion rate

Retention

D1, D7, D30; active days/week; return after first office-tier unlock

Progression

Time to upgrade; cash earned/spent; upgrade diversity; chapter completion

Learning quality

First-attempt accuracy, confidence calibration, appeal recovery, report rate

AI quality

Fallback rate, user disagreement, explanation reports, reasoning-grade appeals

Economy health

Passive share of income, balance inflation, unspent cash, purchase abandonment

15.3 Guardrail metrics

Do not ship an experiment that increases questions attempted while materially reducing explanation review.

Track whether users rush randomly for cash through abnormally low accuracy and very short response times.

Track frustration after wrong answers, especially case abandonment and immediate churn.

Monitor whether passive earnings exceed the target share and weaken active practice.

15.4 First experiments

Visible office scene versus menu-first home screen: measure activation and next-day return.

Three-question versus five-question first case: measure completion and first upgrade.

Appeal with a targeted hint versus immediate explanation: measure review depth and frustration.

Upgrade every 5 versus 10 correct early answers: measure practice volume and perceived grind.

16. MVP scope

16.1 Required for launch

Account creation, sign-in, cloud save, and basic settings

One customizable avatar with five outfit tiers

Persistent office scene with Shack, Rented Room, and Storefront shells

LR Quick Consultations and Client Matters

RC Investigations that preserve passage sets

Verified answer checking, confidence, optional written reasoning, appeals, and choice-by-choice explanations

Cash, reputation, economy ledger, shop, and at least 20 visible upgrades

Paralegal, Junior Associate, Researcher, and Office Manager hires

Capped passive retainer income with morning-briefing collection

Daily Docket, weekly activity milestones, one rival, and one Landmark Case

Career map, session summary, content reporting, analytics, and remote economy configuration

16.2 Deferred

National and global office tiers

Bar Associations, friend visits, and leaderboards

Seasonal chapters and live events

Voice reasoning, courtroom multiplayer, and user-generated firm designs

Prestige resets, additional cities, and advanced practice-group strategy

Paid cosmetics, premium analytics, or subscription packaging

16.3 Recommended build order

Question integrity: canonical schema, ingestion, verified keys, passage grouping, deterministic sessions.

Practice loop: question UI, answer, confidence, reasoning, verdict, explanation, summary.

Economy loop: ledger, rewards, shop, cash, reputation, and upgrade state.

Office fantasy: visual shack, upgrade hotspots, avatar clothing, visible transformations.

Case packaging: client intros, progress meter, case completion, tutorial, first Landmark Case.

Staff and return loop: hires, passive income, Daily Docket, weekly milestones.

Quality pass: content review, accessibility, latency, analytics, economy tuning, abuse testing.

17. Acceptance criteria

17.1 Practice integrity

For every enabled item, the rendered prompt and choices match the normalized source record.

The credited result always matches the verified server-side key, independent of LLM output.

RC passage sets cannot be separated, duplicated, or mixed across cases.

Refreshing or resubmitting cannot reroll an item or duplicate rewards.

17.2 Core-loop completion

A new user can complete onboarding, answer three questions, review feedback, and buy a visible upgrade without instructions outside the product.

A returning user can start a case from the office in two interactions or fewer.

Every answer produces correctness, explanation access, reward outcome, and saved attempt state.

Every completed case updates cash, reputation, chapter progress, and session summary exactly once.

17.3 Tycoon progression

Purchased office and clothing upgrades visibly persist across sessions and devices.

The next meaningful milestone and its requirements are visible from the office and career map.

Staff passive revenue stops at its cap and cannot exceed configured active-income targets in simulation.

No user can become unable to practice because of economy state.

17.4 Quality

The application remains usable with model feedback unavailable.

All primary flows pass keyboard-only, screen-reader, contrast, and reduced-motion checks.

Content reports include item and explanation version and can disable an item without deployment.

18. Risks and mitigations

Risk

Mitigation

The game eclipses the LSAT

Keep practice one click away; tie all major progress to completed questions and reviewed feedback.

Users spam answers for cash

Cap speed-independent bonuses, reward reviewed explanations, and flag implausibly fast low-accuracy sessions.

Passive income replaces practice

Cap storage and share of total income; require a briefing question for full collection.

Explanations hallucinate

Generate offline, validate against the key, provide fallbacks, version outputs, and review reports.

Dataset cannot be redistributed

Resolve provenance and rights before ingestion; support disabling or swapping content sources.

Progress becomes grindy

Guarantee frequent early purchases, show partial construction, and tune from real economy telemetry.

Wrappers feel repetitive

Use modular client, rival, office, and outcome templates; reserve authored scenes for milestones.

Scope balloons

Launch with three office shells, four staff roles, one rival, and one Landmark Case.

19. Open product decisions

Decision

Recommendation for MVP

Art direction

Stylized 2D isometric office with expressive character portraits; cheaper and clearer than 3D.

Difficulty labels

Do not invent them from model judgment. Use source metadata or leave unlabeled until calibrated.

Timers

No timer in standard practice. Consider optional rush events only after measuring learning quality.

Monetization

Delay. First prove practice retention and economy health; later favor cosmetics and advanced analytics.

Social competition

Delay until anti-cheat and content-rights issues are stable.

Narrative density

Short chapter scenes and reactive office moments; no dialogue before every question.

Adaptive learning

Keep out of MVP, but design attempt data so mastery-based modes can be added later.

Content source

Treat rights clearance as a launch gate, not an assumption.

19.1 Final recommendation

Build the first release around one emotionally complete arc: wooden shack → rented room → neighborhood storefront. If that arc makes users voluntarily solve dozens of questions to see the next version of their firm, the concept works. The national empire can follow; the first three rooms must already feel alive.

ONE-SENTENCE MVP Solve authentic LSAT cases, receive trustworthy feedback, and turn a rain-soaked shack into a staffed neighborhood law firm through visible, meaningful choices.