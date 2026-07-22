Lawyer Tycoon — Game Mechanics PRD
1. Product summary
Lawyer Tycoon is an LSAT practice game built around one simple activity: the player enters Do Cases, answers a randomly selected LSAT multiple-choice question, and submits a written explanation of their reasoning.
The verified answer key determines whether the answer is correct. An LLM grades the explanation and immediately teaches the player how the question should be solved, especially when the answer or reasoning is wrong.
Each question is treated as one “case.” The player earns money based on:
Whether the selected answer is correct
The quality of the written explanation
How quickly the player completes the question and explanation
The value of the player’s current clients
Firm upgrades and temporary power-ups
A small correct-answer streak bonus
Money is used to improve the firm, hire staff, attract better clients, build professional connections, open new offices, and eventually acquire rival law firms. A separate Reputation score reflects recent accuracy and gates prestigious progression that cannot be purchased with money alone.
---
2. The only question flow
There is one practice flow throughout the entire game:
The player opens Do Cases.
The app displays one randomly selected LSAT MCQ.
The player selects an answer and writes a required explanation.
The player submits both together.
The verified key determines correctness.
The LLM grades the explanation.
The system calculates a question score from 1–20.
The result screen immediately shows:
Correct or incorrect
Total question score
Answer, explanation, and time point breakdown
What the player understood correctly
The flaw in the player’s reasoning
How to solve the question correctly
Why the correct option works
Why the player’s selected option fails, if incorrect
Money earned
Reputation change
The player presses Next Case and receives another question.
There are no separate trials, boss cases, appeals, game boards, or alternate question modes. Every game system exists around this one loop.
Explanation grading
The LLM grades the reasoning on a four-level rubric:
Grade	Meaning
Invalid	Blank, irrelevant, copied, generic, reused, or contains no question-specific reasoning
Weak	Shows an attempt but misses the central logical issue
Good	Mostly correct and question-specific reasoning with a gap or imprecision
Excellent	Clearly identifies and explains the decisive reasoning
The grade is based on substance, not length. Writing more text does not automatically produce a higher score.
The grader checks whether the explanation refers to the actual stimulus, conclusion, evidence, logical relationship, or answer choices in the current question. Reusing the same generic explanation across questions receives an Invalid grade.
The LLM never decides whether the answer itself is correct and cannot override the verified answer key.
---
3. Question scoring and case payouts
Every completed question receives a score from 1–20. Scoring is gated rather than simply additive so that rapid guessing, lucky answers, and generic explanations are not profitable.
The explanation acts as evidence that the player actually reasoned through the answer. Time points are available only after both the correctness and explanation gates are satisfied.
Base score
Answer result	Explanation grade	Base score	Time bonus allowed?
Incorrect	Invalid	1	No
Incorrect	Weak	2	No
Incorrect	Good or Excellent	3	No
Correct	Invalid	4	No
Correct	Weak	8	No
Correct	Good	14	Yes
Correct	Excellent	16	Yes
This means:
A lucky correct guess with no valid reasoning receives only 4 points.
An extremely fast incorrect answer receives no time bonus.
A correct answer must include at least a Good explanation before speed matters.
Only a correct answer with an Excellent explanation can reach 20.
Time points: 0–4
The timer begins when the fully loaded question becomes visible and ends when the answer and explanation are submitted. The player can always see the elapsed time and the target time.
Each question has a target time based on its type:
Question context	Default target time
Logical Reasoning	150 seconds
First question for a new RC passage	330 seconds
Additional question from the same RC passage	135 seconds
These targets include time to write a concise explanation. They can later be calibrated using real completion data.
Completion time	Time points
Below 25% of target	0 and total score capped at 8
25–70% of target	4
71–100% of target	3
101–125% of target	2
126–150% of target	1
More than 150% of target	0
Time is deliberately limited to four points and is ignored unless the answer is correct and the explanation is Good or Excellent. A submission below 25% of the target receives no time points and cannot score above 8, preventing instant answers or pasted reasoning from being treated as exceptional performance.
Score examples
Performance	Calculation	Score
Correct, excellent explanation, strong time	16 + 4	20
Correct, good explanation, on target	14 + 3	17
Correct, weak explanation, very fast	Time bonus locked	8
Correct, invalid explanation by chance	Time bonus locked	4
Correct, excellent explanation, implausibly fast	Anti-spam cap	8
Incorrect, good explanation, on target	Time bonus locked	3
Incorrect, invalid explanation	Minimum score	1
Score-based payout
Every question has a visible base fee determined by the active client.
Case payout = Base client fee × score multiplier × firm multiplier + streak bonus
Question score	Score multiplier
1–3	0.02×
4–7	0.05×
8–10	0.20×
11–13	0.50×
14–16	0.90×
17–18	1.15×
19	1.30×
20	1.50×
A weak or incorrect performance still records progress, but it produces negligible money. Assuming five answer choices, repeatedly guessing immediately with an Invalid explanation has an expected payout of only about 2.6% of the client’s base fee per question. Thoughtful, validated performance is therefore dramatically more profitable than spam.
Anti-gaming rules
Scoring and payouts are calculated server-side.
Repeated, generic, copied, or semantically duplicated explanations receive an Invalid grade.
A correct choice with an Invalid explanation is treated as an unverified guess and cannot earn a meaningful payout, streak credit, or Reputation gain.
Implausibly fast submissions are capped at 8 even when the answer is correct.
Repeated low-effort submissions may remain available for practice and feedback while receiving no economy rewards.
These rules make random-answer farming irrational, although no scoring system can completely prevent a player from using outside answer tools.
Correct-answer streak
Each consecutive validated answer—correct choice plus a Good or Excellent explanation—adds a 2% payout bonus, capped at 20%. A correct answer with Weak or Invalid reasoning does not advance the streak. An incorrect answer resets it. Some power-ups can protect the cash streak once, but they never protect Reputation.
Money is not deducted for wrong answers during normal practice.
---
4. Reputation
Reputation is a score from 0 to 100 based on recent validated first-attempt accuracy.
It uses the player’s last 30 questions.
The newest 10 questions count twice so improvement is reflected quickly.
New players begin at 50 with a provisional score for their first 10 questions.
A correct answer with a Good or Excellent explanation counts as a validated correct answer and raises Reputation.
A correct answer with a Weak explanation receives only partial Reputation credit.
A correct answer with an Invalid explanation receives no Reputation gain, preventing lucky guesses from building status.
Incorrect answers lower Reputation regardless of speed.
Explanation quality validates whether a correct choice receives full, partial, or zero Reputation credit; it can never create Reputation from an incorrect answer.
Time never affects Reputation.
Reputation cannot be purchased or directly increased by upgrades.
Reputation bands
Reputation	Status	What it permits
0–39	Unreliable	Basic clients and upgrades only
40–59	Local	Small-business clients and early connections
60–74	Established	Corporate clients, better staff, first acquisitions
75–89	Prestigious	Major clients, partners, high-end offices, regional acquisitions

90–100	Elite	Global clients, national rivals, endgame upgrades
Cash and Reputation are both required for major progression. A rich player with poor recent accuracy cannot purchase prestigious clients, connections, offices, or rival firms.
If Reputation falls below an existing client or connection requirement, the item is not deleted. Its benefits become inactive until Reputation recovers. Permanent physical upgrades remain owned.
---
5. Firm progression
The player begins in tattered clothes, working alone from a wooden shack. Each firm tier visibly changes the office, clothing, staff, client quality, and surrounding city.
The following prices are starting balance targets and can be tuned:
Tier	Firm stage	Cash requirement	Reputation requirement	Major unlocks
0	Wooden Shack	—	—	Walk-in clients, basic upgrades
1	Shared Office	$3,000	40	Paralegals, local connections, better clothing
2	Neighborhood Firm	$20,000	55	Associates, business clients, passive retainers
3	Downtown Firm	$100,000	65	Corporate clients, partners, first rival acquisition
4	City Power Firm	$500,000	75	Premium clients, luxury office, major local rivals
5	National Firm	$3,000,000	85	Regional branches, national clients and acquisitions
6	Global Legal Empire	$20,000,000	92	Global clients, international offices, endgame rivals
Every tier should provide:
A major visual office transformation
A new clothing tier
More staff capacity
Better client opportunities
New upgrades and connections
At least one rival firm to acquire
A clearly displayed next milestone
---
6. Upgrades
Upgrades are permanent purchases unless explicitly labeled as a temporary power-up. Each upgrade shows its exact benefit before purchase.
Office upgrades
Examples include a repaired desk, proper lighting, conference room, reception area, legal library, research floor, executive offices, and a skyscraper headquarters.
Office upgrades:
Increase active case payouts
Add staff or client slots
Unlock higher firm tiers
Visibly transform the home screen
Research and technology
Examples include computers, legal databases, research software, document systems, analytics tools, and premium case-management systems.
These increase money earned for high-quality explanations or add a flat amount to active case payouts. They do not reveal answers or change the LSAT questions.
Billing and operations
Examples include better billing software, an accounting department, case managers, and a finance team.
These improve the firm multiplier, client fees, and the efficiency of passive staff income.
Clothing and status
The player progresses from tattered clothes to thrifted business wear, tailored suits, premium courtroom attire, and elite partner outfits.
Clothing is primarily visual, but complete outfit tiers may be required for certain prestigious clients. Clothing never increases Reputation directly.
Marketing and brand
Examples include office signage, a website, local advertising, awards, press coverage, sponsorships, and national brand campaigns.
These unlock new client offers and professional connections. The best campaigns require both money and Reputation.
Property and branches
Later upgrades include additional offices, regional branches, national headquarters, and international locations.
Branches add passive income, staff capacity, client slots, and access to larger rival acquisitions.
---
7. Staff and passive income
Staff make the office feel increasingly alive and provide small economic bonuses.
Staff member	Main benefit
Paralegal	Adds a flat bonus to active case payouts
Junior Associate	Produces a small amount of passive income
Senior Associate	Produces more passive income and improves client capacity
Partner	Increases active client fees and unlocks premium clients
Rainmaker	Unlocks stronger connections and better client offers
Office Manager	Increases the amount of offline income that can be stored
Passive-income rules
Passive income is mainly produced by associates, retainers, and branch offices.
It accumulates for a maximum of eight hours while the player is away.
It never changes Reputation.
It never completes questions, client contracts, or acquisitions.
Even with strong upgrades, passive income should contribute no more than roughly 20% of an active player’s expected earnings.
Answering questions should always be the fastest way to become richer.
Staff are purchased once and can be promoted through multiple levels. Promotions increase their benefit and visibly improve their office appearance.
---
8. Clients
Clients determine the base fee for each question. The question flow never changes; the active client simply changes how valuable each completed case is.
Client tier	Example base fee	Typical requirement
Walk-in client	$100	None
Local individual	$175	Reputation 40
Small business	$300	Reputation 50 plus local connection
Wealthy client	$650	Reputation 60 plus upgraded office
Regional corporation	$1,500	Reputation 70 plus partner
National corporation	$5,000	Reputation 82 plus national office
Global conglomerate	$15,000	Reputation 92 plus international connection
Client contracts
The player can hold a limited number of active client contracts.
Each contract applies its base fee to a fixed number of questions.
Correct answers build client loyalty.
Completing a contract awards a renewal bonus and may unlock a better client.
Incorrect answers still use one question from the contract.
High-tier clients become inactive if Reputation falls below their requirement.
Client slots are increased through office upgrades, partners, and rival acquisitions.
---
9. Connections
Connections are permanent progression nodes that unlock clients, upgrades, discounts, and acquisition opportunities.
Examples include:
Local bar association
Accountant referral network
University alumni network
Business-owner association
Media relationships
Investment banking contacts
Corporate board network
International legal network
Each connection has:
A cash cost
A minimum Reputation requirement
Optional office or staff prerequisites
A clearly listed set of unlocks
Connections never alter LSAT questions or improve Reputation. Low Reputation can temporarily deactivate prestigious connections.
---
10. Rival law firms and acquisitions
Rival firms appear on a city and world map as long-term purchase goals. Acquiring a firm requires enough cash, Reputation, office capacity, and sometimes a specific connection.
An acquisition can provide:
A permanent active-payout multiplier
New clients
Existing staff
Passive retainer income
A new office or branch
Additional client and staff slots
Access to the next class of rival firms
Example progression:
Rival	Price	Reputation	Main reward
Neighborhood Practice	$75,000	60	Associates and 5% active payout bonus
Downtown Boutique	$750,000	75	Premium clients and passive retainers
Regional Firm	$5,000,000	85	Regional branch and 10% client-fee bonus
National Competitor	$30,000,000	92	Global clients and endgame office expansion
Acquired firms appear as part of the player’s empire and continue generating passive revenue. There is no separate acquisition question mode or combat system.
---
11. Temporary power-ups
Power-ups only affect money and convenience. They never reveal answers, change question difficulty, or prevent Reputation loss.
Examples:
Power-up	Effect
High-Profile Referral	+50% base fee for the next 3 questions
Billing Sprint	+25% total payout for the next 10 questions
Media Spotlight	Doubles the payout of the next correct answer
Streak Insurance	Protects the cash streak from one incorrect answer
Acquisition Insider	Reduces the price of the next rival firm by 10%
Power-ups are earned through firm milestones, completed client contracts, achievements, and occasional direct purchases with game money. They are never distributed through paid loot boxes or random packs.
---
12. Additional progression systems
Daily case goals
Daily rewards are based on answering 5, 10, and 20 questions. The goals use the same Do Cases flow and do not create separate modes.
Achievements
Achievements reward milestones such as:
Total questions answered
Correct-answer streaks
Excellent explanations
Reputation bands reached
Clients completed
Staff hired
Rivals acquired
Firm valuation reached
Rewards include money, cosmetics, office decorations, and power-ups.
Firm valuation
Firm Valuation is a visible summary of cash, offices, upgrades, staff, clients, and acquired rivals. It is primarily a prestige number and leaderboard measure, not another spendable currency.
Endgame
After reaching the Global Legal Empire tier, the player continues by:
Acquiring every major rival
Opening international branches
Collecting elite clients and connections
Maximizing staff and office upgrades
Completing rare cosmetic collections
Increasing Firm Valuation
---
13. Main screens
Office
The visual home screen. It displays the player, office, staff, active clients, passive-income collection, current cash, Reputation, and next major milestone.
Do Cases
The only question area. It contains the LSAT MCQ, answer choices, required explanation field, submit button, immediate feedback, payout, Reputation change, and Next Case button.
Firm
A simple management area with tabs for:
Upgrades
Staff
Clients
Connections
Rivals
Achievements
Progression map
Shows office tiers, owned branches, available rival firms, future acquisitions, and the requirements for the next stage.
---
14. Economy and simplicity rules
The next useful purchase should always be visible.
Early upgrades should be affordable after roughly 5–10 correct questions.
Major offices and acquisitions should take multiple sessions.
Every purchase must state its exact effect.
Active question answering must remain much stronger than passive income.
Reputation must prevent money alone from unlocking the entire game.
Upgrades and power-ups may improve earnings, but never answer questions for the player.
The player can always enter Do Cases regardless of money, Reputation, staff, or office tier.
Wrong answers provide useful feedback and small progress without becoming economically optimal.
No energy system, forced waiting, loot boxes, or multiple currencies are needed.
The result should feel like a deep tycoon game surrounding an extremely simple practice loop: answer a question, explain the reasoning, receive feedback, earn money, and grow the firm.