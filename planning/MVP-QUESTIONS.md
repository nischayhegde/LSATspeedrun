# LSAT Sherlock MVP Questions

Write your answers below each question. Short answers are fine.

## Scope

1. Is the “30–40” diagnostic 30–40 questions or 30–40 minutes?

Answer:
30-40 questions

2. Which LSAT sections are in the first MVP: Logical Reasoning only, or also Reading Comprehension and Logic Games-style content?

Answer:
All Modern LSAT sections

3. What is the smallest question bank we need to launch? The timeline says 5,000, but that is probably too large for a first MVP.

Answer:
We can probably find a question bank that large. Atleast a couple thousand for sure.

4. Do we already have licensed questions, or should the MVP use original / licensed practice questions? Scraping real LSAT questions may create legal and content-rights issues.

Answer:
We will decide that later.

## User flow

5. What must happen immediately after the diagnostic? For example: show a readiness score, show weak areas, create a daily plan, and start the first case.

Answer:
Calculate initial readiness score, weak points, and allow the user to start the daily case sessions.

6. What does a normal study session look like in the MVP? How many questions, how much time, and can users choose untimed vs timed practice?

Answer:
20m-1h a day depending on the user's daily size preference. Practice is always timed, we identify weak points partially by if they took too long.

7. Must users explain their reasoning for every practice question, or only during the diagnostic and when they get a question wrong?


Answer:
They will have to answer reasoning for some questions, for others it can be quick and expidited.

8. How structured should the reasoning input be? Free text only, or simple fields such as conclusion, evidence, answer choice, and confidence?

Answer:
Free text, but we have to guard against prompt injection.

9. Should the AI give feedback right after every question, or should some modes wait until the end of a set?

Answer:
Depends on the generated storyline

## Learning system

10. What is the first version of the adaptive system allowed to use? I suggest: accuracy by question type, recent mistakes, confidence, and time spent. Prerequisites and detailed retention models can come later.

Answer:
accuracy by question type, explanation accuracy by question type, time spent, recent mistakes, interleaving.

11. What should the readiness score mean? An estimated LSAT score range, a percentage, or skill-level ratings? How cautious should we be about showing a predicted score early?

Answer:
Estimated LSAT score with confidence level for that score.

## Game features

12. Which game features are required at launch: XP, rank, Trap Vault, city map, district repairs, detective characters? Pick the few that make the MVP feel special.

Answer:
XP, Detective characters, cohesively generated detective storyline with interesting narrative world-building, recurring antagonists, side characters.

13. Does the 2D detective world need to be interactive in the MVP, or can it be a simple progress screen with light animations?

Answer:
There is no interactive world, it is a story mode with different scenes with great 2d graphics/animations.

## Platform and launch

14. Is mobile web enough for MVP, or is the React Native app truly required in week two?

Answer:
We will decide about the react native app later.

15. Do users need accounts, saved progress, and a daily plan from day one? If yes, what sign-in methods should be supported?

Answer:
Google auth, accounts and saved progress are necessary from day 1.

16. What is the launch goal that tells us the MVP worked? For example: “a new user can complete a diagnostic, receive a plan, finish a detective case, and return for a scheduled review.”

Answer:
New user can do auth, complete diagnostic, recieve initial readiness score and see their weak areas. Then they can progress through the AI generated storyline study and their progress is always stored.
