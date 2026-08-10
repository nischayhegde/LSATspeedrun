# Lawyer Tycoon — Pitch Narrative & Speaker Notes

**Revision 4** — competitive positioning added. The deck previously named only 7Sage and LSAT Lab; LSAT Demon, Kaplan, PowerScore and Khan Academy appeared nowhere, and there was no prepared answer to the Demon question. Revision 4 adds one fragment on `pov-reasoning-is-the-work`, a four-answer competitive block at the top of §G, warning item 12, a placement rationale in §D, and a fully sourced seven-product reference as §4 of `deck/CITATIONS.md`. **No slide was added, no slide was cut, and the runtime is unchanged at 9:40.**

**Revision 3** — rebuilt against the complete 68-page brainlift (23 articles, 8 DOK 3s, 8 DOK 4s) and reconciled against the fact-check in `deck/CITATIONS.md`.

**Deck:** 23 slides · **Runtime:** 9:40 target (trim list in §C gets you to 8:32) · **Live demo budget:** 3:14 total
**Speakers:** Nischay Hegde (framing, problem, close) · Alan Abraham (product, demos)
**Pacing assumption:** roughly 170 spoken words per minute. Every slide's seconds figure is derived from its note length, so if a speaker runs slower, the whole table scales.
**Theme:** royal blue and beige. Tokens for the builder — `--blue: #1B2F6B`, `--blue-lit: #2A4BB8`, `--beige: #EFE6D6`, `--beige-dim: #D8CBB4`, `--ink: #0E1524`, `--stamp: #A8321F` (verdict red, used exactly twice in the deck).

**Two slide IDs changed in this revision.** `CITATIONS.md` refers to them by their old names:

| Old ID | New ID | Why |
| --- | --- | --- |
| `turn-610-reader` | `turn-nothing-to-teach` | The 610 figure is gone; the slide is now built on LSAC's and the ABA's own words |
| `problem-200-hours` | `problem-hours-and-price` | The hours are now attributed rather than asserted, and the slide's hero fact is the real price |

---

## ⚠ Evidence integrity — read before rehearsing

Every item below is either a correction already applied to this file or a caveat the presenter needs in their head. Nothing here is an open question.

**1. Resolved by replacement: the 610 SAT figure is out of the deck.** No published source links individual SAT records to individual LSAT records. LSAC does not collect SAT scores, College Board does not report by graduate or professional intent, and the only academic work joining the two is an aggregate correlation of SAT means by intended undergraduate major against LSAT means by major — 16 data points, no individual linkage. The SAT-to-LSAT conversion tables on prep blogs are percentile-matching with no paired dataset behind them. Separately, "610 on SAT reading" does not name a real scale: a standalone 200–800 reading section has not existed since January 2016, and the current analogue includes writing. Saying it to a room of recent graduates advertises that it was never checked. The turn now runs on LSAC's own description of the exam and the ABA's degree requirement, and it is stronger for it, because it closes a loop the audience accepted ninety seconds earlier instead of introducing a fact they have to take on faith.

**2. Corrected: competitor pricing was wrong and was the most dangerous line in the deck.** The deck said competitors charge "hundreds of dollars a month." **7Sage Core is $69/month and LSAT Lab Premium is $65/month.** Only the coaching tiers reach $299 and $425. The real ladder, verified 2026-08-10, is 7Sage Core $69 / Live $129 / Coach $299, and LSAT Lab Free $0 / Premium $65 / Classroom $125 / Tutor $425. On top of any of them, every competitor makes you buy LSAC's **LawHub Advantage at $124/year**, because that is the only route to official questions. The deck now says "$65–$425 a month, plus $124 a year to LSAC," which is true, more specific, and harder to dismiss. **Re-check both pricing pages the morning of the pitch**; 7Sage was running a $79 first-month promotion on the Live tier as of 2026-08-10. Sources: https://7sage.com/self-study/pricing and https://www.lsatlab.com/pricing. **One sub-correction, from the §4 sweep:** the annual-billing claim holds for LSAT Lab only. Their pricing page carries a monthly/yearly toggle reading "Save 30% when you pay for 1 year"; 7Sage's page offers monthly billing only, and the annual figures floating around third-party review sites contradict each other. Do not say "both discount for annual."

**3. Corrected: the study-hours number is now attributed, not asserted.** No independent research measures how long students actually study for the LSAT. Every figure in circulation comes from the prep companies themselves: Princeton Review says 250–300 hours, Blueprint says 200–300, Kaplan says 150–300, and LSAC declines to give a number at all. That is a rhetorical gift, because these are the competitors' own recommendations and they cannot dispute them. The presenter now says where the number comes from. Be ready to volunteer the obvious objection first: these are marketing recommendations from companies that bill monthly.

**4. Corrected: "80+ hours of instruction" is gone.** Neither competitor publishes a total instruction-hours figure, so the claim could not be sourced to them, and on 7Sage's cheapest tier the honest number is probably closer to 50. Quoting their published curricula is more damning and completely safe: 7Sage advertises **900+ bite-sized video lessons**, LSAT Lab advertises **90-minute live classes five days a week** inside three-month courses. Every word of that is a direct quote from their own marketing.

**5. Removed: "a 5 to 10 point increase from their initial diagnostic."** No published source measures diagnostic-to-final gains. Prep companies claim 10–20 points, which is what they are selling. LSAC's only hard number is for retakes: +2.8 points on a second sitting and +2.2 on a third (TR 14-01), which measures the gap between administrations rather than progress from a diagnostic. The slide now says "a few points," which is qualitative and safe. The retake figures are in §G if a questioner pushes for a number.

**6. Corrected citation: there is no Journal of IT Education study.** The founders' notes cited "a large study in the Journal of IT Education" for virtual-currency gamification. No such source exists anywhere in the brainlift, and "massively improved participation and focus" is not supportable by anything that does. It has been replaced with **Meng et al.**, where points correlated with all four measured engagement dimensions (skills ρ = .146, emotional ρ = .274, participation ρ = .248, performance ρ = .293) while badges correlated with only one, and **Sailer & Homner's meta-analysis** at g = 0.49 cognitive, g = 0.36 motivational, g = 0.25 behavioral. Those are small-to-moderate numbers. Do not say "massively." Meng is correlational with voluntary respondents, and the slide says so on screen.

**7. "Watching videos and learning concepts is ineffective" is too strong.** Wightman found coaching-course users scored +0.22 points over nonusers, from a self-reported, non-randomized survey. That shows instruction barely moves the aggregate. It does not prove instruction is useless, and a hostile questioner will say so. The deck now says instruction "can't be the core," matching DOK 4 #6.

**8. "14 strategies" needs one word of care.** The catalog holds 14 methods, but `comparative_matrix` is currently unreachable because the dataset never marks comparative passages. Say "fourteen in the catalog, thirteen currently in rotation" if anyone presses, and never claim all fourteen are being trialed.

**9. The old `pov-no-menu` slide is gone as a slide.** Taking question-type choice away is the one POV with no brainlift source, and it sits in tension with Ryan & Deci. The argument survives, reframed as *structure rather than control*, inside the concept slide and the close, with Focus Mode as the autonomy valve. See §D.

**10. The logic-games jab moved off the stage and into Q&A.** LSAC removing Analytical Reasoning as of August 2024 is accurate and worth knowing, but both 7Sage and LSAT Lab have publicly updated their curricula for the new format. Aiming the jab at named competitors is now falsifiable. It lives in §G, pointed at the general back catalog.

**11. Cite Wightman precisely if you put a source line on screen.** The report is Wightman, L. F. (1990), *Self-Reported Methods of Test Preparation Used by LSAT Takers*, LSAC Research Report Series **RR 90-01**, covering June and September **1989** test takers. The on-screen hairline now reads "LSAC, Wightman, RR 90-01 (1989 test takers), self-reported."

**12. Know where you are genuinely exposed competitively.** Four things, and none of them is fatal if you say it first. **One, the thesis is not ours alone.** LSAT Demon has argued publicly for years that drilling beats lecturing, and their product is adaptive, question-first and explicitly aimed at the watch-videos model. Acts I and II are true and well sourced, but they are not a spiky POV to anyone who has used Demon. Claim the rep, not the diagnosis. **Two, adaptive selection is table stakes.** Demon's Smart Drilling, 7Sage's smart drills and LSAT Lab's Adaptive Drill Engine all weight toward weaknesses. What is actually distinctive on `concept-lawyer-tycoon` is not that the app picks — it is that there is no manual override, where LSAT Lab explicitly ships a "Filtered setting to create custom drills with your exact specifications." Say *we removed the override*, not *we pick for you*. **Three, confidence capture will get called blind review.** 7Sage's whole review culture is built on blind review, which is a confidence signal by another name. The honest distinction is that we take a 1-to-5 value on every question, before the key, as a data field that drives scheduling, rather than as a weekly ritual. **Four, the clock.** Demon tells students to hide it; we time everything from day one. That is a real disagreement with a competitor who argues their side well, and §G has the answer. Full field reference, sourced, in §4 of `CITATIONS.md`.

**13. Corrected: the deck no longer calls our questions "official."** The bank is a pinned, checksum-manifested snapshot of **6,886 questions — 4,520 Logical Reasoning from `tasksource/lsat-lr` and 2,366 Reading Comprehension from `tasksource/lsat-rc`**, both publicly released LSAT material, and **neither upstream dataset card declares a license**. In this market "official" means LSAC-licensed content delivered through LawHub Advantage at $124/year, so the old wording asserted a license the founders do not hold and invited "then what are you paying LSAC?" on the very slides where that fee is the attack. `concept-lawyer-tycoon` now reads "6,886 LSAT questions" and `demo-case-answer` says "real LSAT questions from publicly released exams," which is more specific on stage rather than weaker. **The LawHub line is untouched** — it remains true that every competitor passes $124/year through to students, and only the description of our own bank changed. The provenance answer is in §G. **If the founders do in fact hold a content license, or conclude the dataset terms permit commercial use, the stronger wording can come back — verify before reverting it.** See §4.9 item 10 of `CITATIONS.md`.

---

## A. Narrative spine

The deck opens as an indictment and ends as an invitation.

We start with LSAC's own data. When the test maker surveyed 46,301 of its own test takers about how they prepared, the people who took a coaching course scored 0.22 points higher than people who took nothing. The people who worked through actual published LSATs scored 2.77 points. Nearly half the field bought the course. Barely a third had ever finished a real test. That is the entire prep industry, priced and graded by the organization that writes the exam. Then we put the bill next to it, using the competitors' own published numbers: 150 to 300 hours by their own recommendation, 900 video lessons at one company and 90-minute classes five days a week at the other, $65 to $425 a month for as long as you study, plus $124 a year to LSAC because that is the only way to buy real questions.

Then comes **the turn**, and it is still a single slide, but it no longer asks the room to accept a new fact. It closes the loop they accepted ninety seconds ago. Why was coaching worth a fifth of a point? *Because there is nothing to teach.* LSAC describes its own exam as a test of skills in reading and reasoning rather than a body of knowledge, and the ABA requires a bachelor's degree to enroll in law school, so everyone sitting for the LSAT has already spent four years reading and arguing at college level. Up to that moment the room holds the industry's premise, that the student is under-taught. After it, the student is under-practiced, and every instruction hour is revealed as aimed at a deficit that was never there. The number that had been an accusation on slide 2 becomes an explanation on slide 4.

Everything after the turn is a consequence rather than a feature list. Skip to the questions, because Dunlosky's team rated practice testing and spaced practice highest of ten common techniques and rereading lowest. Make the student explain themselves, because VanLehn's 87 comparisons show answer-level feedback is worth d = 0.31 while step-level feedback is worth 0.76, within a rounding error of a human tutor at 0.79. Capture confidence, because Metcalfe shows a confident mistake is the most correctable error a student can make and a score report cannot see one. Never let the AI hand over an answer, because Bastani's thousand students who used unguarded ChatGPT posted better practice grades and then scored about 17% worse than students who never touched AI. Run the real clock. And only then, once the room has agreed that practice volume is the whole game, introduce a tycoon loop as the retention mechanism for the one behavior that matters.

**Why this ordering beats the founders' current deck.** The existing version opens with a spiky POV before anyone has a reason to care, states the goal as a three-column abstraction, spends eight untitled slides on a walkthrough with no argument attached, and closes on another three-column grid restating the middle. Nothing in it turns, and nothing in it is sourced. This version withholds the product for seven slides, spends its credibility on numbers the audience can verify from primary sources during the talk, and only then lets Alan show software, so every demo click is evidence for a claim the room already accepted. The demo is capped at 3:14 with written click-paths, because the founders' own diagnosis is that it sprawled while trying to prove too many ideas at once. Each demo now proves exactly one.

---

## B. Slide-by-slide specification

### ACT I — THE BILL (slides 1–3)

---

#### 1 · `title-lawyer-tycoon` — Act I, cold open · 16s

**On-screen copy**
> # Lawyer Tycoon
> The LSAT speedrun app.
>
> Alan Abraham · Nischay Hegde · UT Austin

**Visual direction.** Full-bleed royal blue, almost black at the edges. Centered, one stylized lawyer character from the real Three.js rig in hero framing, lit by a single warm practical that reads as a desk lamp just out of shot. The character is in idle motion, breathing, doing nothing heroic. Title in a beige serif at large scale, letter-spaced, sitting behind the character's shoulder so the figure occludes two letters. Background is tier-0 office geometry pushed far out of focus. No logo lockup, no gradient mesh, no particles.

**Speaker notes (Nischay, 45 words).** Hi, we're Alan and Nischay from UT Austin, and we built Lawyer Tycoon. It's an LSAT prep app. Before we show you anything, we want to show you a number published by the people who write the LSAT.

**Transition out.** The desk lamp brightens to a wash and blows the frame out to beige for a quarter second; the two bars on slide 2 are already drawn when the exposure recovers.

---

#### 2 · `problem-coaching-tax` — Act I · 27s

**On-screen copy**
> # Coaching moved scores 0.22 points.
> LSAC asked 46,301 of its own test takers how they prepared.
>
> **+0.22** took a coaching course · **+2.77** worked through real LSATs

**Visual direction.** Two bars, nothing else. The coaching bar draws first, fast, and stops almost immediately at a stub. Then the real-LSAT bar draws slowly past it, more than ten times taller, and the gap between them is left empty and obvious. Beige on royal blue. Underneath, two small percentages fade in and swap position with a tick: *45.5% bought the course* on the short bar, *34.9% had ever finished a real test* on the tall one, so the audience sees the inversion. A hairline of small type in the corner reads **LSAC, Wightman, RR 90-01 (1989 test takers), self-reported** — volunteering the caveat in the design is worth more than hiding it, and it lets a researcher in the room find the report.

**Speaker notes (Nischay, 76 words).** In 1989, LSAC surveyed its own test takers, 46,301 of them, and asked what they actually did to prepare. People who took a coaching course scored 0.22 points higher than people who took nothing. People who worked through actual published LSATs scored 2.77 points higher. More than ten times the return. Now look at the behavior. Nearly half of them bought a course. Barely a third had ever finished a real test. It's a survey, not an experiment, so that's an association. It's also the test maker's own data.

**Transition out.** The tall real-LSAT bar rotates flat and becomes the horizontal hours bar that slide 3 fills in.

---

#### 3 · `problem-hours-and-price` — Act I · 32s

**On-screen copy**
> # 250 hours. A few points. Every month.
> The hours are their number. The bill is monthly for as long as you study.
>
> 900+ video lessons (7Sage) · 90-minute classes, 5 days a week (LSAT Lab) · $65–$425/mo, plus $124/yr to LSAC

**Visual direction.** One long horizontal bar, full width, labeled *150–300 hours, by their own recommendation*, with four small tick marks along it credited to Princeton Review, Blueprint, Kaplan and LSAC, and LSAC's tick left conspicuously blank because the test maker declines to give a number. At the far right, a sliver labeled *a few points* draws last and slowly, at true relative proportion, so it is almost invisible. Then the bar fills with a film-grain video texture as the two curriculum fragments appear, so the audience sees the hours *become* lecture. A thin royal blue price ribbon slides across the bottom carrying the range, and the `+$124/yr to LSAC` clause arrives late, on its own, like a line item nobody mentioned. Keep it monochrome.

**Speaker notes (Nischay, 89 words).** And here's what that costs. The two-fifty figure isn't ours, it's theirs. Princeton Review, Blueprint and Kaplan all tell you to plan for somewhere between one-fifty and three hundred hours. Then look at what fills them. Nine hundred video lessons at 7Sage. Ninety-minute classes, five days a week, for three months at LSAT Lab. The product is instruction. And it's a subscription the whole time, sixty-five to four hundred and twenty-five a month, plus a hundred and twenty-four a year to LSAC for LawHub, because that's the only way to get real questions.

**Transition out.** The price ribbon whips left off-frame and drags the entire royal blue background with it like a curtain, revealing beige underneath. Hard inversion, and the only one in the first half of the deck. It should feel like a light coming on.

---

### ACT II — THE TURN (slides 4–8)

---

#### 4 · `turn-nothing-to-teach` — Act II · **the turn** · 30s

**On-screen copy**
> # Because there's nothing to teach.
> LSAC calls the LSAT "a test of skills," not a body of knowledge. The ABA requires a bachelor's degree.
>
> **0.22**

**Visual direction.** Full inversion: beige field, royal blue type. The hero object is `0.22`, extruded 3D geometry, and it must be recognizably *the same object* the room saw on slide 2 — same material, same rotation rig, same shadow behavior, as though it had been dollied in from ninety seconds earlier. It arrives small and grows, rotating maybe eight degrees off-axis, the only thing in frame with weight. The character from slide 1 is small, bottom-left, in *full* framing, head tilted up toward it. No chart, no annotation. Hold silent for a beat; no motion for the first 700ms. A hairline credit sits under the sub-line: *LSAC, "LSAT Prep" · ABA Standard 502(a)*. If the founders would rather not repeat a numeral, the word **SKILLS** at the same extruded scale carries identical weight and the same transition out.

**Speaker notes (Nischay, 85 words).** So why was coaching worth a fifth of a point? Because there's nothing to teach. That's not our opinion, it's LSAC's: they describe their own exam as a test of skills, critical thinking applied to reading and reasoning. There is no syllabus. And the ABA requires a bachelor's degree to enroll in law school, so everyone sitting for this test has already done four years of college-level reading. Techniques, yes. Content, no. They're not missing concepts. They're missing reps, and feedback on how they think.

**Transition out.** The extruded `0.22` rotates edge-on until it is a single vertical line, and that line becomes the progress track of the speedrun timer on slide 5.

---

#### 5 · `thesis-speedrun` — Act II · the speedrun thesis · 21s

**On-screen copy**
> # So skip to the questions.
> Minute one is question one. There is nothing to get through first.
>
> Practice testing: rated highest · Rereading: rated lowest · No curriculum path

**Visual direction.** Speedrun aesthetic played straight. A thin beige timer HUD pinned top-left counting real time, and a route line running left to right across the beige with four nodes: *intro course*, *concept videos*, *drill unlock*, *first real question*. The route ignores the first three, cutting a hard diagonal to the fourth, and the skipped nodes gray out and collapse with a small tick each. Under two seconds, no loop.

**Speaker notes (Nischay, 60 words).** That's what we mean by speedrun. We're not making studying faster by shortening videos, we're deleting the middle. Dunlosky and colleagues rated ten common study techniques and put practice testing and spaced practice at the top and rereading and highlighting at the bottom. So we build the whole product out of the top of that list. A student is on a real question inside a minute.

**Transition out.** The route line's endpoint expands into the outline of a question card, which is the frame slide 6 fills in.

---

#### 6 · `pov-reasoning-is-the-work` — Act II · **Spiky POV 01** (required before the concept) · 28s

**On-screen copy**
> # Answering isn't studying. Explaining is.
> Answer-level feedback is worth d = 0.31. Step-level is 0.76. A human tutor is 0.79.
>
> Name the error · Why yours was wrong · Why the right one works · They explain the question. We grade your explanation.

**Visual direction.** One question card centered in real app typography on beige. Watch the emphasis move: the five answer choices shrink and desaturate toward the card's edge while the reasoning textarea grows to occupy most of the card and picks up a royal blue focus ring, caret blinking. Then a coaching panel rises from the bottom third and underlines one clause of the written reasoning in verdict red, the first of only two uses of that color. Beside the card, three small horizontal bars for 0.31, 0.76 and 0.79 draw in sequence, so the audience sees the last two land at nearly the same length. That near-equality is the whole slide.

**The fourth fragment is the deck's entire on-stage competitive positioning, and it lands late.** The first three fragments arrive with the coaching panel; the fourth holds back and appears alone, after the panel has finished underlining, in the same weight as the others with no emphasis and no logos. It is the only sentence in the deck that compares us to anybody, it names nobody, and it is deliberately the kind of claim that cannot be argued with line by line. Rationale in §D.

**Speaker notes (Nischay, 82 words).** If reps are what's missing, the question is what a rep should be. VanLehn compared 87 tutoring studies. Feedback on your answer is worth a third of a standard deviation; feedback on your steps is worth 0.76, and a human tutor is 0.79. Step-level feedback gets you a tutor's result without a tutor's price. Zhang and Fiorella showed the prompt has to be structured, which beat a vague "explain this" by 0.62. Everyone else explains the question. We grade your explanation.

**Transition out.** The coaching panel slides down and a 1-to-5 confidence strip rises in its place.

---

#### 7 · `pov-confidence-signal` — Act II · **Spiky POV 02** · 20s

**On-screen copy**
> # Accuracy and time can't see understanding.
> A lucky guess and a confident miss look identical on a score report.
>
> Rate 1–5, before the key.

**Visual direction.** Beige field. Four small question tiles in a row, all four marked with the same plain checkmark or cross, so they look interchangeable. Then a confidence value drops onto each and the tiles re-sort into four visibly different categories in different shades of royal blue: mastered, lucky guess, time-pressure miss, confident misconception. The confident-misconception tile pushes to the front and takes a subtle warning outline. The sort animation is the argument; keep it under 1.5 seconds.

**Speaker notes (Nischay, 58 words).** And you can't tell whether someone understands something from whether they got it right and how long they took. Those four questions look the same on a score report and they are four different problems. So we take a confidence rating before the answer is revealed. Metcalfe found that high-confidence mistakes get corrected more successfully than low-confidence ones, because the surprise grabs your attention. A confident miss is our most valuable event.

**Transition out.** The confident-misconception tile expands and the camera pulls straight back off it; it turns out to be a monitor on a desk in the 3D office, and the pull-back keeps going.

---

#### 8 · `concept-lawyer-tycoon` — Act II · the concept · 26s

**On-screen copy**
> # An LSAT engine inside a tycoon game.
> Adaptive practice on 6,886 LSAT questions, wrapped in an idle game that only moves when you do.
>
> Answer, explain, get corrected · You don't pick the questions · The game is always optional

**Visual direction.** The payoff shot of the first half. The camera keeps dollying back until the full tier-6 office interior is in frame in real Three.js, staff actors walking their routes, a client seated in the waiting area, the monitor with the question still glowing on the desk. Then the frame splits: left half stays live app UI, right half stays live 3D office, with a thin beige line between them and the loop label traveling along it as a moving dot. Royal blue walls, beige light. Let the office breathe two full seconds before any text lands.

**Speaker notes (Nischay, 76 words).** So that's Lawyer Tycoon. Underneath, an adaptive engine on 6,886 LSAT questions that demands your reasoning and coaches it. On top, entirely optional, an interactive game loop where you run a law firm, with an office you can actually see. We chose the most addictive genre on purpose, so a student losing motivation keeps answering questions. Two rules. You don't choose which question types you get, because everybody drifts toward what they're already good at. And the game never gets to move your practice. Practice moves the game.

**Transition out.** Hand-off to Alan. The office lights dim to a single spotlight on the desk monitor and the deck rotates back to royal blue for the POV block.

---

### ACT III — HOW WE PROTECT IT (slides 9–11)

---

#### 9 · `pov-ai-never-answers` — Act III · **Spiky POV 03** · 27s

**On-screen copy**
> # An AI that gives answers makes you worse.
> With unguarded ChatGPT, practice grades rose 48%. On the real exam, those students dropped 17%.
>
> Attempt first · Hints, never solutions · One step at a time

**Visual direction.** Royal blue. A single line chart with two traces on the same axes: *with the tool*, which spikes upward and looks fantastic, and *without the tool*, which drops below a dashed baseline labeled *students who never used AI*. Let the good trace draw first and hold for a beat so the audience starts nodding, then draw the second. Then a third trace, the guardrailed tutor, draws up and lands exactly on the baseline. Beige lines, dashed baseline in beige-dim. This is the only slide in the deck permitted a moment of misdirection.

**Speaker notes (Alan, 78 words).** I'll take it from here, and I want to start with the thing everyone else is shipping. Bastani and colleagues gave about a thousand students access to plain ChatGPT while they practiced. Practice grades went up 48 percent. Then they took it away for the real exam and those students scored about 17 percent worse than students who never used AI at all. The version that gave hints instead of answers left them level with the control. So our coach cannot show you anything until you have committed to an answer and written why.

**Transition out.** The guardrailed trace detaches from the chart and becomes the docked strategy card on slide 10.

---

#### 10 · `pov-strategy-inside-the-question` — Act III · **Spiky POV 04** · 22s

**On-screen copy**
> # Strategies get taught. They should get tested.
> One method, handed to you at the moment you need it, kept only if your own data says it works.
>
> 14 in the catalog · One per question · A/B tested against your own control

**Visual direction.** Fourteen small royal blue method cards fan out across the beige, each with just a name. A filter sweeps the arc, thirteen dim and fall away, and one slides in and docks along the left edge of a question card. The stimulus then takes a live highlight drag in beige marker, as if the presenter did it. Finish with a tiny inline bar beside the docked card showing that method's accuracy for *this* student against their own unprompted baseline. Keep the dataviz small and unlabeled.

**Speaker notes (Alan, 63 words).** Every prep company sells a set of test-taking strategies and then leaves you alone with them. We think a strategy has to be practiced inside the question. So we suggest one relevant method per question out of fourteen, the whole screen is a scratchpad so you can run it on the text, and you have to tell us whether you used it. Then we compare your prompted attempts against your own unprompted ones.

**Transition out.** The docked method card slides under the question card and a clock ring draws around the card, clockwise, which is slide 11's hero element.

---

#### 11 · `pov-real-clock` — Act III · **Spiky POV 05** · 21s

**On-screen copy**
> # Every question is timed. Every exam is optional.
> The LSAT is a stamina test, but a busy student cannot sit a full form on a Tuesday.
>
> Real pacing from day one · Full form when you can · Never required

**Visual direction.** A large clock ring in royal blue on beige, depleting around an empty question card, with a ghosted second ring behind it showing target pace so the audience can see the student running ahead or behind. When the ring completes, the slide holds absolutely still for a beat, then a much larger, slower ring draws around the whole frame and is deliberately left unfinished. The two rings are the tension, stated visually.

**Speaker notes (Alan, 64 words).** The LSAT mostly applies time pressure and tests stamina, so untimed practice teaches you to solve questions in a way you'll never be allowed to solve them. Everything here runs against real per-question pacing from day one. Full-length exams are the only way to train the stamina, and they're the thing our users have the least time for. So they're always available and never required. The single question loop is the daily driver.

**Transition out.** The unfinished outer ring snaps closed and becomes the border of the live app iframe. Deck chrome retracts to a hairline beige frame. Demo mode begins.

---

### ACT IV — PROOF (slides 12–15)

> **Demo staging, read this first.** All demo slides run one embedded live app iframe with deck chrome reduced to a hairline beige frame and a slim budget bar across the top. Two browser contexts are pre-staged before the talk. **Context A** — signed in at office tier 6, an active cases run already open on a Logical Reasoning question with a strategy brief attached, the reasoning field **pre-filled** with a strong paragraph, no answer selected and no confidence set. **Context B** — the same account with a completed mega-litigation and its finished audit already on screen. Never create a session live. Never log in live. Before the pitch, verify that no cash or fee counter animates while a question is on screen; the game's rewards are supposed to land before the question starts and after it is answered, never inside it, and that claim is made out loud on slide 22.

---

#### 12 · `demo-case-answer` — Act IV · live demo · **56 seconds**

**On-screen copy**
> # One case, start to finish.
> *(hairline frame, live app fills the slide, 56s budget bar top-right)*

**Visual direction.** The app iframe occupies about 88% of the frame, floated on royal blue with a soft long shadow so it reads as a physical object rather than a screenshot. A slim beige budget bar depletes across the top. No callout arrows, no zoom effects; the presenter's cursor is the pointer. One permitted flourish: the tier-6 office parallaxing very slowly behind the floating window, heavily blurred and darkened.

**Click path (Context A).**
1. **0:00–0:07** — Point at the strategy brief at the top of the question. Say its name. **Do not read the three steps aloud.**
2. **0:07–0:13** — Click **Use this brief**.
3. **0:13–0:24** — Drag-highlight exactly one clause in the stimulus with the scratchpad markup. One drag only.
4. **0:24–0:31** — Select answer choice **(B)**.
5. **0:31–0:41** — Scroll the pre-filled reasoning into view. Read only its first sentence aloud. **Do not type.**
6. **0:41–0:47** — Click confidence **4**.
7. **0:47–0:56** — Submit. Stop talking while the verdict stamp animates.

**Skip entirely:** the passage tab switcher, the per-question timer explanation, the client and fee line, reading any other answer choice, and the settlement numbers. Those belong to slides 11, 18 and 22.

**Speaker notes (Alan, 95 words).** This is where students actually work, and these are real LSAT questions from publicly released exams. Top of the screen is the one method we picked for this question, and I have to tell it whether I'm using it. The whole screen is a scratchpad, so I mark up the stimulus while I run the method. I pick my answer. Then this box, which is the part nobody else makes you do: I write why, in my own words, before I'm allowed to see anything. Then confidence, one to five, because a confident miss and a lucky guess are different problems. Submit.

**Transition out.** No slide change. The verdict stamp lands in verdict red and the title bar quietly relabels to slide 13. Treat 12 and 13 as one continuous shot.

---

#### 13 · `demo-case-verdict-review` — Act IV · live demo · **38 seconds**

**On-screen copy**
> # Then it tells you where you broke.
> *(live app continues, 38s budget bar)*

**Visual direction.** Identical frame, continuous. One addition: when the presenter navigates to the dashboard, the background parallax swaps from the office to a slow field of faint royal blue data lines, foreshadowing slide 15. Verdict red appears here for the second and final time in the deck.

**Click path (Context A, continuing).**
1. **0:00–0:10** — Read the verdict line and the score breakdown in one sentence. **Do not itemize** answer, explanation and time points.
2. **0:10–0:22** — Open the coaching panel. Point at the line identifying where the reasoning first went wrong. Read one clause of it.
3. **0:22–0:30** — Click **Dashboard** in the nav.
4. **0:30–0:38** — Open the entry for the question just answered. Show the same reasoning and the same coaching preserved there.

**Skip entirely:** scrolling the rest of the dashboard, the cash and reputation change, the next question, the review queue mechanics.

**Speaker notes (Alan, 84 words).** The model grades my reasoning, not my letter. Correctness comes from the verified answer key, never from the model, and the model's job is to find the first place my logic broke and then walk the correct reasoning. That's the step-level feedback from the VanLehn slide, running on every question. And it isn't a popup that disappears. Every question I have ever answered is sitting in the dashboard with my reasoning and its feedback attached, so review means reviewing how I thought, not which letter I picked.

**Transition out.** The dashboard entry lifts off the page and the app window flips like a page turn to reveal the mega-litigation card of slide 14.

---

#### 14 · `demo-mega-litigation` — Act IV · live demo · **38 seconds**

**On-screen copy**
> # The full test, and the blind review after it.
> *(live app, 38s budget bar)*

**Visual direction.** Same floating window. Behind it, a still, wide, empty courtroom-scale space in royal blue, no characters and no motion, so this section feels like a held breath after the busy office. When the presenter reaches the completed audit, the deck draws one clean chart over the background: two vertical bars in beige, timed score and untimed blind-review score, with the gap between them labeled *time pressure* and the shared shortfall below both labeled *reasoning*. That labeled gap is the Blueprint diagnostic made visible and it is the only chart in the demo act.

**Click path (start in Context A, jump to Context B).**
1. **0:00–0:07** — On the dashboard, point at the mega-litigation card. One sentence on what it is. **Do not start one.**
2. **0:07–0:17** — Switch to **Context B**, on the blind review interstitial. Answer one question untimed while explaining blind review.
3. **0:17–0:29** — Jump to the completed audit. Timed score beside untimed score, plus the per-section breakdown.
4. **0:29–0:38** — Back to the dashboard. Point at the new point on the accuracy line and the panel naming the weak question types this form found.

**Skip entirely:** starting a real form, reading any question aloud, accommodation settings, the section clock rules, and the firm tier promotion, which lands on slide 22.

**Speaker notes (Alan, 90 words).** Whenever a student wants, they can sit a full-length practice test. One clock, one sitting, no pausing. When the clock stops we don't hand back the answers. First they redo every question they missed, untimed, with no key. That's blind review, and Blueprint's framing is exactly what it computes: right when untimed means time pressure, wrong both times means a reasoning gap, and confidently wrong means a misconception you didn't know you had. Three problems, three fixes. Then the question types this form exposed are what the app feeds you tomorrow.

**Transition out.** The two bars multiply outward into a field of small metric tiles that settle into the ring of slide 15. The live app window shrinks into the top-left tile.

---

#### 15 · `dashboard-everything` — Act IV · 30s

**On-screen copy**
> # Everything it watches, and why the numbers hold.
> First attempts only. Every figure carries how much evidence is behind it.

*(The twelve items below are rendered as a labeled diagram, not as body copy. This is the one slide that deliberately exceeds the three-fragment rule, because the founders asked for a complete list on a single slide. Small, uniform weight, no bullets.)*

> Accuracy by question type · Pace against target time · Reasoning quality grade · Speedrun Index · Trend vs. your previous window · Confidence calibration · Review recovery · Weakest link and next focus · Per-method lift · Evidence confidence · Comparison readiness · Full-test section breakdown

**Visual direction.** A radial diagram. The Speedrun Index sits at the center as one large beige numeral; the eleven other signals are nodes on two concentric rings, connected by hairlines whose thickness encodes how much each feeds the center. Nodes light in sequence about 80ms apart so the ring assembles in roughly a second. One node burns brighter as the current weakest link. When the presenter reaches calibration, the outer ring dims and thin *evidence forming* tags appear on the nodes with small samples. 2D canvas or SVG over the blue field, no WebGL, which protects the frame rate right after a live demo.

**Speaker notes (Alan, 89 words).** This is the measurement surface on one slide. What makes it honest is what we refuse to do with it. Only your first attempt at a question counts, so re-answering something you've memorized inflates nothing. Every figure carries how much evidence is behind it, and comparisons stay suppressed until there's enough history. Confident misses go to the front of the repair queue, on Metcalfe's finding. Scheduling is a trained model rather than fixed boxes, which cut recall error more than 45 percent over a Leitner system at Duolingo scale. And correctness always comes from the answer key.

**Transition out.** The hairlines all snap toward one node, which drops out of the ring and lands as a coin on the beige field of slide 16.

---

### ACT V — THE GAME (slides 16–22)

---

#### 16 · `pov-virtual-currency` — Act V · **Spiky POV 06** · 21s

**On-screen copy**
> # Points beat badges. That's the whole mechanic.
> Points tracked all four dimensions of engagement in Meng's study. Badges tracked one.
>
> Cognitive g = 0.49 · Correlational, not causal · We test it against a control

**Visual direction.** Beige field, royal blue type. A four-spoke radial where points light all four spokes and badges light one, drawn as a fast direct comparison. Then a single 3D coin in royal blue with a beige rim spins at center, and the stack beneath it grows one coin per rotation before collapsing forward into a desk, then a room, then a floor plan, in three fast beats. Currency becoming architecture. Reuse the office material palette so the coin visibly belongs to the game half of the product.

**Speaker notes (Alan, 62 words).** The game runs on virtual currency, and that's a deliberate bet. Meng and colleagues found points correlated with all four dimensions of engagement they measured while badges correlated with only one. Sailer and Homner's meta-analysis puts gamification's cognitive effect at about 0.49, and that one held up under the more rigorous studies. Those are honest, small-to-moderate numbers from correlational and mixed evidence, which is why the currency layer gets tested against a control rather than assumed.

**Transition out.** The floor plan flattens into the four paired bars of slide 17.

---

#### 17 · `game-by-design` — Act V · 17s

**On-screen copy**
> # The meta-analysis designed our game.
> Clark and colleagues, 69 samples, 6,868 participants. Every split went the way we built it.

**Visual direction.** Four paired bars, one pair per design choice, ours always in beige and the alternative in dim royal blue, with the alternatives sitting at or below zero so the contrast is unmissable: single-player 0.45 against competitive −0.06; schematic visuals 0.48 against photoreal −0.01; thin or no story 0.44 to 0.47 against medium-depth story −0.03; many sessions 0.44 against one session 0.08. Each pair animates in as the presenter names it, roughly one every three seconds. Then all four ours-bars pulse once together. A small footer reads *average participant age ~12–13; RCT subset smaller*. Put the caveat in the design.

**Speaker notes (Alan, 57 words).** We didn't guess at the game design. Clark's meta-analysis, 69 samples and nearly 7,000 participants, found single-player beat competitive, stylized beat photoreal, thin story beat medium story, and many short sessions beat one long one. Our game is all four of those. Fair warning, the average participant was about thirteen, so we treat it as design guidance, not proof.

**Transition out.** The four beige bars rotate into the vertical and become the columns of the tier-0 office as the live app opens.

---

#### 18 · `demo-clients-walk-in` — Act V · live demo · **16 seconds**

**On-screen copy**
> # Clients walk in. Cases are questions.
> *(live app, 16s budget bar)*

**Visual direction.** Live app, full bleed rather than floating, so the game section feels more immersive than the study section did. Budget bar only.

**Click path.**
1. **0:00–0:06** — On `/office`, point at the client character seated in the waiting area. Say who they are.
2. **0:06–0:12** — Click through to the practice lobby. Point at the client's name and fee line.
3. **0:12–0:16** — One sentence: the case *is* the questions.

**Skip entirely:** contracts and dockets, quests, story chapters, the client catalog, reputation.

**Speaker notes (Alan, 60 words).** A client walks into your office and sits down. Taking their case is the same act as starting a practice run, and the fee is visible before you begin, so the stake of the next question is on screen before it starts and settled after it ends, never while you're reading it. Better reasoning pays more. A well-argued wrong answer still pays something.

**Transition out.** Cut straight to slide 19. No animation. The cut is the effect.

---

#### 19 · `demo-office-transformation` — Act V · live demo · **18 seconds** · *the money shot*

**On-screen copy**
> *(nothing during the transformation. After it resolves, one line fades in, bottom-left:)*
> Every object in this room was bought with LSAT questions.

**Visual direction.** The most over-the-top moment in the deck, and it earns it by being short. Two pre-staged save states. Open on the tier-0 shack: bare bulb, one broken desk, gray light, camera at seated eye height. Toggle to tier 14. Do not crossfade. Let the real Three.js scene rebuild with the camera locked in the same position so the room grows around a fixed viewpoint, then release the camera into one slow 20-degree orbit as the light shifts to the tier-14 environment. Hold the final frame two full seconds in silence before the line fades in. Rehearse this; it is the most quotable image in the presentation.

**Click path.**
1. **0:00–0:05** — Tier 0 office. One line about where you start.
2. **0:05–0:13** — Toggle to tier 14. Say nothing while the room rebuilds and the camera orbits.
3. **0:13–0:18** — One line: everything here was bought with questions.

**Skip entirely:** naming individual upgrades, staff hiring, cosmetics, the intermediate tiers, and the office cat, however tempting.

**Speaker notes (Alan, 60 words).** You start here. A shack, a broken desk, one light. And this is where it ends up. There are fifteen headquarters and the last one is an interplanetary justice organization, which is exactly as ridiculous as it sounds and exactly as motivating. There is one path between those two rooms and it runs through thousands of LSAT questions. Nothing else unlocks it.

**Transition out.** The camera dollies through the tier-14 window and keeps going, out into the sky, until the city below resolves into the 3D career map.

---

#### 20 · `demo-map-and-firm` — Act V · live demo · **18 seconds**

**On-screen copy**
> # The world, and the ledger.
> *(live app, 18s budget bar)*

**Visual direction.** Live app. Let the map's own lighting and region fog carry it; no deck chrome beyond the budget bar. When the presenter switches to the firm tab, the background behind the app window changes from the map's sky gradient to flat royal blue, so the shift from spectacle to spreadsheet feels intentional.

**Click path.**
1. **0:00–0:05** — Open `/map`. One camera pull-back to show the region.
2. **0:05–0:09** — Point at the current headquarters node and the locked one after it.
3. **0:09–0:15** — Open `/firm`. Scroll once. Point at a single requirement line saying exactly what's missing.
4. **0:15–0:18** — One sentence: everything here is priced in cases.

**Skip entirely:** the rivals board, the story campaign, cosmetics, staff detail, the three map view modes, every other region.

**Speaker notes (Alan, 58 words).** Zoom out and your firm sits on a career map across five regions, so you can see where you are and what's next. And this is where you spend. Upgrades, staff, the requirements for your next headquarters, each with a line telling you exactly what you're missing. It's a shop, and the only currency in it is work you have already done on the test.

**Transition out.** The catalog rows slide out to the right one by one, leaving the navigation bar alone on screen. That's slide 21's subject.

---

#### 21 · `demo-focus-mode` — Act V · live demo · **10 seconds**

**On-screen copy**
> # Or delete all of it.
> *(live app, 10s budget bar)*

**Visual direction.** Tight crop on the navigation bar and account menu, scaled up so the back of the room can read it. When Focus Mode engages, the office, firm and world tabs visibly leave the strip. One touch: the removed tabs fall downward out of frame rather than fading, so the subtraction is physical.

**Click path.**
1. **0:00–0:04** — Open the account menu, top right. Toggle **Focus Mode**.
2. **0:04–0:10** — The nav collapses to Dashboard and Practice. Say the line. Do not toggle it back on stage.

**Skip entirely:** everything. One click, one sentence.

**Speaker notes (Alan, 55 words).** And if a student wants none of it, there's one switch. Focus Mode removes the office, the firm and the map from the app and leaves the two screens that raise a score. It's a preference, never a lock, and it's the cleanest proof of the thing I want to say next.

**Transition out.** The two remaining nav items slide to center and become the two halves of the diagram on slide 22. The live app closes.

---

#### 22 · `game-never-gates` — Act V · 20s

**On-screen copy**
> # The game never gates the practice.
> The practice gates the game. It only runs in that direction.
>
> Cases → cash and story · Full test → a whole tier · Focus Mode → the game disappears

**Visual direction.** Two columns on royal blue, *Practice* in beige on the left, *Firm* in beige on the right. A single thick arrow runs left to right and pulses. Then an arrow attempts to draw right to left and is struck through, hard, once. Beneath, three thin arrows label the actual couplings. To the right, a small tier-14 office idles at low opacity, and when the struck-through arrow appears it dims almost to nothing, showing the game can be removed without touching anything on the left.

**Speaker notes (Alan, 62 words).** This is the most important slide in the game half. Every gamification source we read says the same thing: it's a complement to good practice, never a replacement. So the coupling only runs one way. Cases in sequence earn money and move the story. Clearing a full-length test above our accuracy bar promotes your firm an entire tier. A student who never opens the office loses nothing except the office.

**Transition out.** The diagram retracts into a single beige line down the center of the frame and the deck inverts to beige for the close.

---

### ACT VI — THE CLOSE (slide 23)

---

#### 23 · `close-one-stop-shop` — Act VI · closing image · 28s

**On-screen copy**
> # One place. Two doors.
> Walk in and answer questions. Or build a firm that only grows on thousands of them.
>
> Cheaper · Narrower · Harder to quit

**Visual direction.** Composed, not animated. Beige field. Two doorways in real Three.js geometry, side by side, both royal blue, both open, warm light through each. Through the left doorway a question card, alone, lit plainly. Through the right, the tier-14 office, deep and glowing. The character from slide 1 stands centered between them in *full* framing, facing the audience rather than either door, doing the rig's professional wave once and returning to idle. Symmetry is the argument: neither door is bigger, neither is brighter. The three closing words set small along the bottom edge. Hold this frame for the entire Q&A.

**Speaker notes (Nischay, 80 words).** Three reasons we win. Cheaper, because we don't run a video studio or pay live instructors, and that's most of what sixty-five to four twenty-five a month is buying you. Narrower, because we point you at what you're losing points on instead of handing you a menu you'll misuse. And harder to quit, because the game only moves when you answer questions. One place instead of five. Walk in and you're on a real question in under a minute, or take the door with a game behind it. Thank you.

**Transition out.** None. Hold.

---

## C. Timing table

| # | Slide ID | Speaker | Seconds | Cumulative |
| --- | --- | --- | ---: | ---: |
| 1 | `title-lawyer-tycoon` | Nischay | 16 | 0:16 |
| 2 | `problem-coaching-tax` | Nischay | 27 | 0:43 |
| 3 | `problem-hours-and-price` | Nischay | 32 | 1:15 |
| 4 | `turn-nothing-to-teach` | Nischay | 30 | 1:45 |
| 5 | `thesis-speedrun` | Nischay | 21 | 2:06 |
| 6 | `pov-reasoning-is-the-work` | Nischay | 28 | 2:34 |
| 7 | `pov-confidence-signal` | Nischay | 20 | 2:54 |
| 8 | `concept-lawyer-tycoon` | Nischay | 26 | 3:20 |
| 9 | `pov-ai-never-answers` | Alan | 27 | 3:47 |
| 10 | `pov-strategy-inside-the-question` | Alan | 22 | 4:09 |
| 11 | `pov-real-clock` | Alan | 21 | 4:30 |
| 12 | `demo-case-answer` | Alan | **56** | 5:26 |
| 13 | `demo-case-verdict-review` | Alan | **38** | 6:04 |
| 14 | `demo-mega-litigation` | Alan | **38** | 6:42 |
| 15 | `dashboard-everything` | Alan | 30 | 7:12 |
| 16 | `pov-virtual-currency` | Alan | 21 | 7:33 |
| 17 | `game-by-design` | Alan | 17 | 7:50 |
| 18 | `demo-clients-walk-in` | Alan | **16** | 8:06 |
| 19 | `demo-office-transformation` | Alan | **18** | 8:24 |
| 20 | `demo-map-and-firm` | Alan | **18** | 8:42 |
| 21 | `demo-focus-mode` | Alan | **10** | 8:52 |
| 22 | `game-never-gates` | Alan | 20 | 9:12 |
| 23 | `close-one-stop-shop` | Nischay | 28 | 9:40 |

**Total 9:40. Live demo total 3:14** across the seven bolded slides.

**Unchanged by Revision 4.** The competitive positioning added in Revision 4 costs no stage time. `pov-reasoning-is-the-work` gains a fourth fragment, which is free, and one closing sentence of notes, which is paid for by compressing the Zhang & Fiorella sentence — that sentence was reading the slide's own three fragments aloud, so the trade loses nothing. The slide stays at 28 seconds and every cumulative figure above is as it was. Everything else competitive is in §G and in `CITATIONS.md` §4, neither of which is on the clock.

**Cut order if running long.** Cut in this sequence and stop when you fit.

1. `pov-real-clock` (−21). Fold it into the mega-litigation demo, which already shows the clock; Alan adds "timed to real pacing from day one, and full forms are optional" over the click path.
2. `pov-confidence-signal` (−20, +3 back). Fold the confidence claim into `pov-reasoning-is-the-work` as one sentence. Net −17.
3. `game-by-design` (−17, +3 back). Alan names two of the four Clark splits over the office transformation instead. Net −14.
4. Trim `demo-map-and-firm` to 10 (−8). Map pull-back only; describe the firm tab without clicking.
5. Trim `dashboard-everything` to 26 (−4). Let the ring assemble and name six of the twelve.
6. Trim `title-lawyer-tycoon` to 12 (−4). Names and product category only; slide 2 carries the opening.

All six land you at **8:32**. Never cut, under any circumstances: `turn-nothing-to-teach`, `pov-reasoning-is-the-work`, `pov-ai-never-answers`, `demo-case-answer`, `demo-office-transformation`, `game-never-gates`, `close-one-stop-shop`. **Do not trim `problem-hours-and-price`** either; every corrected number in the problem act lives there, and cutting it for time is how a wrong figure gets improvised back in.

---

## D. Spiky POV placement rationale

**The turn** (`turn-nothing-to-teach`, slide 4). Not a POV slide, but its placement governs all of them, and this revision changed what it stands on. It used to introduce a new statistic the audience had to accept on faith. It now closes a loop they accepted ninety seconds earlier: slide 2 shows that coaching bought a fifth of a point, and slide 4 explains why, using LSAC's own description of the exam and the ABA's degree requirement. That is a better rhetorical move than the old version even setting the sourcing problem aside, because an explanation of a number the room already believes is far harder to resist than a second number. It remains the moment the model flips from under-taught to under-practiced, it remains the last slide before the product, and it remains do-not-cut.

**Spiky POV 01 — Explaining your reasoning, with step-level feedback, is the rep** (`pov-reasoning-is-the-work`, slide 6, before the concept, as required). This is the specification the app is built against, so it has to precede the app. If it came after, "you must write your reasoning" sounds like a product decision; before, it sounds like the only thing that follows from the turn. It carries the deck's strongest single piece of evidence, VanLehn's 0.31 against 0.76 against 0.79, which does double duty: it justifies the design and it prices it, because step-level feedback reaching a human tutor's effect is the entire argument for why we can charge less than a company paying instructors.

**Where the competitive positioning goes, and why it is one line rather than a slide.** The deck was carrying no visible competitive positioning at all, which reads as naivety to anyone who knows the space, and it named neither LSAT Demon, Kaplan, PowerScore nor Khan Academy anywhere — see §4 of `CITATIONS.md` for the full field. The obvious fix is a comparison slide, and it is the wrong one. A comparison table is the least persuasive object a founder can put on a projector: it is visually dull in a deck that has spent nine slides earning the opposite reputation, it invites a judge to argue one row at a time on a clock that does not allow it, and it puts four competitors' names in front of a room that currently knows only ours. It would also be the slide most likely to be wrong by the morning of the pitch, because every figure in it moves. So the positioning goes in three places instead. **On stage** it is one fragment on this slide — *they explain the question, we grade your explanation* — placed at the exact moment the room has just accepted VanLehn, which is the only moment in the deck where a competitive claim is an inference the audience has already made rather than a boast. **In the room** it is §G, which now opens with Demon, Kaplan and 7Sage, and where a real question gets a real thirty-second answer instead of four seconds of table. **On paper** it is `CITATIONS.md` §4, sourced cell by cell, for the judge who follows up by email. This costs nothing in runtime: the fragment is free and the one added sentence of notes is paid for by compressing the Zhang & Fiorella line, which was reading the three fragments aloud anyway. **The deck stays at 9:40 and the timing table in §C is unchanged.**

The one thing the deck must not do is claim the *thesis* as differentiation. Demon has been arguing publicly for years that drilling beats lecturing, is adaptive, pushes students to questions immediately, and markets itself against the watch-videos model — the same ground Acts I and II stand on. The differentiation is not the diagnosis, which Demon shares and got to first. It is what happens inside a single rep: required written reasoning, graded; a confidence value taken before the key; and a named method whose effect on *that student* is measured against their own hidden control. Everything else the product does — adaptive selection weighted to weaknesses, blind review, timed sections in the current test format — is matched somewhere in the field, and saying otherwise in front of someone who has used Demon or 7Sage costs more than the claim is worth.

**Spiky POV 02 — Accuracy and time cannot measure understanding; you must capture confidence** (`pov-confidence-signal`, slide 7). The founders' own DOK 4 #1, previously buried inside the dashboard slide. It earns a slide because it is a genuine methodological heresy, since every competitor's score report is built entirely from accuracy and time; because it is the only thing that makes the blind-review diagnostic legible later; and because it explains the confidence tap the audience is about to watch Alan press. Kept deliberately short and abrupt at 20 seconds.

**The concept** (`concept-lawyer-tycoon`, slide 8). Placed at the hinge, so the first act and a half is "here is what is true" and everything after is "here is what we built because of it." The interactive game loop is introduced here in one clause and then dropped for eight slides, so it cannot hijack a room that has not yet agreed the learning engine is good.

**Spiky POV 03 — An AI that gives answers makes students worse** (`pov-ai-never-answers`, slide 9). **The primary controversial DOK-4 claim, and the replacement for the old `pov-no-menu`.** It is combative in a way the old slide never was, because it does not merely say competitors are inefficient, it says the AI tutors currently shipping are measurably harmful: Bastani's students posted a 48% practice gain and then dropped about 17% below peers who never used AI. It is sourced, it is a field experiment with about a thousand students, and it converts a design constraint into an accusation. Placed first in Alan's section so the room enters the demo primed to notice that our coach withholds everything until the student commits.

**Spiky POV 04 — Strategies have to be practiced and A/B tested, not taught** (`pov-strategy-inside-the-question`, slide 10). Second in Alan's block because it extends POV 1 directly: if writing your reasoning is the rep, the method is what you are repping. It also hands Alan the natural first demo beat, since the strategy brief is literally the top of the case screen. It is also the slide that keeps the turn honest — "nothing to teach" means no syllabus, not no technique, and this slide is where the techniques show up.

**Spiky POV 05 — Real timed conditions, with full exams optional** (`pov-real-clock`, slide 11). Where DOK 4 #7 and #8 collide, stated rather than hidden. #7 says the LSAT is fundamentally a time-pressure and stamina test, so full-scale exams are imperative. #8 says university students are too busy for them, so exams are optional and the single question loop is the core. Both are true and the honest resolution is a hierarchy: per-question pacing is the daily driver and runs from day one, full forms are the ceiling-raiser and are always available and never required. The visual states it with two rings, one that completes and one deliberately left unfinished.

**Spiky POV 06 — Virtual currency is the right gamification for the LSAT** (`pov-virtual-currency`, slide 16). Still separated from the other POVs and placed at the top of the game act rather than grouped with the pedagogy claims. Where it sits, it is the door into the game: it gives the audience permission to take the tycoon loop seriously about ten seconds before they see it. Its evidence is now correct and honestly sized, and the slide says "correlational, not causal" on screen, which buys more credibility than the overstatement it replaces.

**Why `pov-no-menu` was demoted.** Taking question-type choice away is the only POV with no support anywhere in the brainlift, and it runs into Ryan & Deci, who find autonomy is one of three needs a learning environment has to satisfy. Their work also supplies the rescue: they draw a sharp line between *structure*, meaning clear expectations and useful scaffolding, and *control*, meaning pressure toward prescribed behavior, and they note a learner can act autonomously without options when they accept the activity's value. So the claim survives as one fragment on the concept slide and one clause in the close, framed as structure with a stated rationale, with Focus Mode as the genuine autonomy valve. Spending a full slide defending it against a source in our own brainlift would have been the weakest 22 seconds in the deck.

---

## E. Copy bank

**Title slide alternates** (all pair with the sub-line *The LSAT speedrun app.*)

1. Lawyer Tycoon
2. Coaching is worth 0.22 points
3. The LSAT speedrun app
4. Stop studying. Start answering.
5. Skip to the questions
6. Nobody needs another LSAT course
7. Reps, not lectures
8. Build a law firm out of LSAT questions
9. There is no syllabus
10. The prep app that never explains anything
11. The test maker already told you what works

**Closing slide alternates** (all pair with a variation on *Walk in and answer questions, or build a firm that only grows on thousands of them.*)

1. One place. Two doors.
2. One stop, whichever way you study
3. Everything a student needs, nothing they don't
4. Two ways in. One outcome.
5. Come for the game. Leave with the score.
6. The only shortcut is more questions
7. Same hours. Different result.
8. Where LSAT students stop shopping around
9. One app, from diagnostic to test day
10. The firm only grows if you do
11. 2.77, not 0.22

---

## F. Coverage checklist (re-verified against the original nine requirements)

| # | Founders' requirement | Satisfied by |
| --- | --- | --- |
| 1 | Problem statement first, where third-party apps fail | `problem-coaching-tax` and `problem-hours-and-price` (slides 2–3, complete by 1:15) |
| 2 | App concept and spiky POVs in a logical order; must mention the interactive game loop | `concept-lawyer-tycoon` (slide 8) names the interactive game loop explicitly; POV order is 6 → 7 → 9 → 10 → 11 → 16, rationale in §D |
| 3a | POV: virtual currency | `pov-virtual-currency` (slide 16), citation corrected |
| 3b | POV: reasoning + feedback is most efficient, **placed before the concept slide** | `pov-reasoning-is-the-work` (slide 6), two slides before `concept-lawyer-tycoon` (slide 8) |
| 3c | POV: practicing and actively applying test-taking strategies | `pov-strategy-inside-the-question` (slide 10) |
| 3d | POV: practicing under real timed conditions | `pov-real-clock` (slide 11), proven live in `demo-mega-litigation` (slide 14) |
| 3e | Optional extra controversial DOK-4 claim | Two, both from the brainlift: `pov-ai-never-answers` (slide 9) and `pov-confidence-signal` (slide 7). Reasoning in §D |
| 4 | Speedrun thesis, placed near the beginning | `thesis-speedrun` (slide 5, at 1:45 of a 9:40 deck), set up by `turn-nothing-to-teach` (slide 4) |
| 5 | Case demo: strategy, answer, reasoning, feedback, then that question in dashboard review | `demo-case-answer` (slide 12) and `demo-case-verdict-review` (slide 13), 1:34 combined, reasoning pre-filled per the staging note |
| 6 | Full practice test / blind review demo and the dashboard update | `demo-mega-litigation` (slide 14), 0:38, ends on the dashboard retargeting |
| 7 | Single slide listing every unique point the dashboard finds, with how the figures are calibrated | `dashboard-everything` (slide 15): twelve signals in one diagram, with first-attempts-only, evidence labels, Metcalfe-based repair ordering and trained scheduling in the notes |
| 8a | Game demo: client walk-ins and case handling | `demo-clients-walk-in` (slide 18) |
| 8b | Game demo: office transformation scene | `demo-office-transformation` (slide 19) |
| 8c | Game demo: the map | `demo-map-and-firm` (slide 20) |
| 8d | Game demo: firm tab, abstract explanation of interactions | `demo-map-and-firm` (slide 20) |
| 8e | Focus mode demo | `demo-focus-mode` (slide 21) |
| 8f | Game does not gate practice; independent; practice always grants game progress; full tests grant a tier; cases earn money and advance the story | `game-never-gates` (slide 22), set up by `demo-focus-mode` (slide 21) |
| 9 | Closing remarks landing the one-stop shop idea, both student types | `close-one-stop-shop` (slide 23), which also carries the cheaper / narrower / harder-to-quit argument |

---

## G. Q&A ammunition

*The first four answers are the competitive block, added in this revision and placed first because they are the questions most likely to be asked and were the ones the deck had no answer for. All pricing is verified 2026-08-10 and sourced cell by cell in §4 of `CITATIONS.md`.*

**"How are you different from LSAT Demon?"** — *the most important question in this section*
Demon is the closest thing to us in this market and they're right about the big thing: drill official questions, stop watching lectures. The difference is inside the rep. Demon's feedback is Ben and Nathan's pre-written explanation of the question — the same one every student sees — plus a human tutor's reply within twenty-four hours if you hit Ask. Ours makes you write your reasoning before anything is revealed, and then grades that writing against a rubric, so the feedback is about your argument rather than about the question. The second difference is that we measure: we prompt one named method inside the question and test it against a hidden control arm of your own unprompted attempts, where Demon's stated position is that there are no methods worth teaching — no diagrams, no jargon.

> **Volunteer the concessions before anyone reaches for them.** They got to the drilling thesis first. Their retention engine is Ben and Nathan personally — live classes seven days a week, seven podcast episodes a week, an active free Discord — and that is a real moat we do not have. Their Smart Drilling targets weaknesses the same way ours does; adaptive selection is not our differentiator. And they tell students to hide the clock while we time every question from day one, which is a genuine disagreement rather than a gap. Their tiers are $99, $179 and $499 a month.

**"Demon tells students to ignore the clock. You time every question. Who's right?"**
Both, about different objects. Their advice is about the learning phase and we don't disagree that rushing while you're still building accuracy teaches you to misread — that's exactly why our full-length forms are optional and why blind review is untimed. What we time is the individual question against its target pace, and we report pace adherence as its own number beside accuracy rather than as one blended verdict, so a student can see that they are accurate and slow. That's a diagnosis. "Get faster" and "slow down" are both advice given without one.

**"Why wouldn't a student just use Kaplan or 7Sage?"**
Kaplan is a course. It runs from about $900 for on-demand to about $4,000 for the bootcamp, and what you are buying is instruction hours — a couple of dozen hours of live class plus a whole channel of lessons on demand — which is precisely the thing LSAC's own survey valued at 0.22 points. 7Sage is the harder comparison and it is genuinely good: $69 a month, nine hundred video lessons, real analytics. But its shape is still a video curriculum, and its AI is one you can ask about a question you're stuck on, which is the interaction Bastani measured — the students who had it posted better practice grades and then scored about 17% worse on the real thing. Neither one asks you to write down why, and neither one grades it.

**"What if a competitor copies your game loop?"**
They can, and they should — the game is the most copyable thing we have. A tier ladder and a currency is a few months of work for anyone with a spare 3D artist. What is not copyable is what the loop is bolted to: the currency only pays out on a graded written explanation and a confidence-rated attempt, and a company whose product is a video library has no such event to attach a coin to. The thing we would actually defend is the method experiment. Every prompted attempt runs against a hidden control of that student's own unprompted ones, so the longer someone studies, the more we know about which techniques work for which kinds of student. That compounds. An art style does not.

**"Where do your questions come from, and are they licensed?"** — *asked because slide 3 raises LawHub's $124; answer it calmly and specifically*
Straight answer: 6,886 questions — 4,520 Logical Reasoning and 2,366 Reading Comprehension — pulled from publicly available released LSAT material, pinned as a checksummed snapshot so every student sees the same verified bank rather than something a model wrote. We are not claiming an LSAC license and we do not need one to run what you just saw. Confirming the dataset terms and the content rights is on our list before we charge anyone, and we would rather resolve that now than discover it at launch.

> **Never say "official questions."** In this market that word means LSAC-licensed content through LawHub, and it is the one claim in the deck a lawyer in the room can falsify. Say "real questions from publicly released exams." If pressed on the LawHub comparison: our students do not pay the $124 today, and if licensing turns out to be the right route we would price it in and say so.

**"Where do your numbers about our competitors' pricing come from?"**
Their own pricing pages, checked this week. 7Sage runs $69 a month for Core, $129 for Live and $299 for Coach; LSAT Lab runs a free tier, $65 for Premium, $125 for Classroom and $425 for Tutor; and for the rest of the field it's LSAT Demon at $99 to $499, PowerScore at $99 a month or $995 for a live course, and Kaplan from about $900 to about $4,000. The part people miss is LawHub Advantage at $124 a year, paid to LSAC on top of any of them, because that is the only legitimate route to official questions. Blueprint says it best on their own blog: it is required "no matter which third-party LSAT prep service you choose."

> **Say the discounts before someone accuses you of cherry-picking.** LSAT Lab bills annually at about 30% off; 7Sage's pricing page shows monthly only, so do not extend the annual claim to them. Every company here discounts on an LSAC fee waiver, some steeply — 7Sage goes to $1 a month, LSAT Lab to 50% off. 7Sage was also promoting a $79 first month on Live as of 2026-08-10.

**"Your 250-hour figure is marketing, isn't it?"**
Yes, and that's the point. Nobody has measured how long students actually study; every number in circulation is a prep company's own recommendation. Princeton Review says 250 to 300 hours, Blueprint says 200 to 300, Kaplan says 150 to 300. LSAC declines to give a figure at all. So the industry is advertising a 250-hour commitment and billing monthly across it. We are quoting them, not estimating.

**"How many points does a student actually gain? 'A few' is vague."**
Deliberately, because no published source measures gains from a diagnostic to a final score. Prep companies advertise 10 to 20 points, which is what they are selling. The only hard number is LSAC's retake data: about 2.8 points on a second sitting and 2.2 more on a third. That measures the gap between administrations rather than the effect of any method, so we won't stretch it into a claim about instruction. We would rather say "a few" than invent a number.

**"Does the game actually help, or does it just entertain?"**
Honestly, the evidence for gamification is real but modest. Sailer and Homner's meta-analysis puts the cognitive effect around 0.49 and the behavioral effect around 0.25, and the cognitive one is the only one that stayed stable under the more rigorous studies. That's why the game is a layer and not the product, why it can be switched off entirely, and why we plan to test the currency loop against a non-gamified control rather than assume it works.

**"Isn't your LLM grader unreliable?"**
Yes, and we designed around that. Lee and colleagues scored 1,650 student explanations and found even a well-prompted GPT-4 with a rubric and examples lands short of perfect accuracy. So the model never determines whether you got the question right; that comes from the verified answer key. The model grades the reasoning as a formative signal to choose what feedback you see, and it is calibrated against scored examples. It is a coach, not a judge.

**"Why should I trust your score projection?"**
We don't give one. The app explicitly withholds a scaled 120–180 score until the question set has a validated conversion, because faking that number from an unvalidated form would be the easiest and least honest thing we could do. What we report is accuracy, pace, reasoning quality and confidence calibration, each labeled with how much evidence sits behind it.

**"Aren't you just Anki with a skin?"**
Anki schedules recall of facts. The LSAT has no facts to recall. Our repair queue is triggered by reasoning failures rather than forgetting curves: a confident miss, a lucky guess, a correct answer that took too long. And the scheduler is a trained model rather than fixed boxes, which is the difference Settles and Meeder measured as a 45-percent-plus reduction in recall error over a Leitner system.

**"What about students who genuinely need conceptual instruction?"**
Some do, and we're not claiming instruction is worthless. What the evidence says is that it can't be the core. LSAC's own survey found coaching-course users scored 0.22 points above nonusers while people who worked real LSATs scored 2.77. And LSAC describes the exam as a test of skills rather than a body of knowledge, so there is no syllabus to teach. Where a student needs a technique, we give them one method at the point of use and then measure whether it worked for them.

**"You said there's nothing to teach, then you showed fourteen strategies. Which is it?"**
Both. There is no content, meaning no prerequisite body of subject-matter knowledge, which is LSAC's own framing of their exam. There are techniques, and they matter. The difference is that a technique takes ten seconds to state and only becomes useful when it is practiced inside a real question, which is why ours arrive as a one-line brief on the question screen rather than as a course you complete first. For the record, fourteen are in the catalog and thirteen are currently in rotation.

**"Why is a 1989 survey relevant in 2026?"**
Because it is the largest thing of its kind, it is published by the organization that writes the test, and the format change since then made it more relevant rather than less: the sections it covered are the sections that remain. It has real limits, which we say on the slide. It is self-reported and non-randomized, respondents skewed slightly younger and higher-scoring than nonrespondents, and most people used several methods at once. It is an association, not a causal proof. The full citation is LSAC Research Report RR 90-01.

**"Aren't your competitors' courses out of date now that logic games are gone?"**
Careful, and we'd rather be precise here than land a cheap shot: 7Sage and LSAT Lab have both publicly updated their curricula for the post-August-2024 format. What is true is that the wider back catalog of LSAT content, including a great deal of what students find when they search, still teaches a section that last appeared in June 2024. Our question bank is Logical Reasoning and Reading Comprehension only, which is the test as it exists.

**"Your AI evidence is Harvard physics undergraduates. Why does it transfer to the LSAT?"**
It's a fair limit and we'd flag it before you did: Kestin's trial was a small, non-representative Harvard sample in physical sciences. That's why we lean harder on Bastani, which ran with about a thousand students in ordinary high-school classrooms and measured the failure mode rather than the win. Both point at the same design rule, and it's a rule about the interaction rather than the subject: require an attempt, give hints not solutions, stay anchored to a verified key.
