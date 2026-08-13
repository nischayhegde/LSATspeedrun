# Lawyer Tycoon — Citations & Evidence Check

> **Historical appendix.** The current 12-slide pitch follows
> `Lawyer Tycoon .pptx` and uses only that presentation's facts and main points.
> This file documents the superseded research-heavy deck and is not a source of
> additional on-stage claims. See [`NARRATIVE.md`](./NARRATIVE.md) for the
> current content boundary and speaker script.

**Prepared 2026-08-10.** Read this before rehearsing. It covers the 610 SAT claim on `turn-610-reader`, ranked replacements for it, the competitor and study-hour claims on `problem-hours-and-price`, and a full competitor reference for the seven products a questioner may name (§4), including LSAT Demon, Kaplan, PowerScore and Khan Academy.

**§6, §7 and §8 were added when the founders asked whether the deck actually answers two questions: *why gamification* and *why us rather than them*.** §6 is the gamification evidence and, more usefully, its limits. §7 is LSAC's own study of a prep platform — the source behind the new `pov-volume-is-the-constraint` slide and the best citation in the deck. §8 is the register of every sentence the deck says about a competitor while the audience is watching.

**§4.10 was added on 2026-08-12, when the founders asked for the comparison slide this file had recommended against.** It carries `market-in-their-own-words` cell by cell — five companies, five quotations, the page each one came off and the date it was read — plus the argument for why the slide has no price column and what the presenter says instead. Blueprint's, Princeton Review's, 7Sage's and LSAT Demon's own pages were re-read that day in a real browser; Kaplan's still blocks one, and §4.9(11) says so.

Every entry gives the claim, the source, the exact numbers, a URL, and the objection a hostile audience member can raise. §4.9 lists everything in §4 that could not be verified; §7 ends with the one number in the repo's research notes that nobody has read off the primary page, and which is therefore on no slide.

---

## 0. Executive verdict

| Claim | Slide | Verdict |
| --- | --- | --- |
| "The average LSAT taker scored a 610 on SAT reading." | `turn-610-reader` | **Unsourceable. Do not present as written.** Replace. |
| "Coaching +0.22 / real LSATs +2.77, n=46,301" | `problem-coaching-tax` | **Solid.** Real LSAC report, cite it correctly. |
| "200+ hours for a 5–10 point gain" | `problem-200-hours` | **Half-sourced.** Hours are fine; the gain figure needs rewording. |
| "80+ of those hours are instruction" | `problem-200-hours` | **Not substantiated by competitor materials.** Soften. |
| "Competitors charge hundreds of dollars monthly" | `problem-200-hours` | **False for the entry tiers. This is the most dangerous line in the deck.** 7Sage starts at $69/mo, LSAT Lab at $65/mo. Fix before you present. |
| No competitive positioning anywhere in the deck | *(deck-wide)* | **Closed.** LSAT Demon, Kaplan, PowerScore and Khan Academy were absent entirely; Demon's public thesis is the closest to ours. Full reference in §4, spoken answers in §G of `NARRATIVE.md`, and three on-stage lines registered in §8. |
| No direct comparison to a named competitor | `market-in-their-own-words` | **Closed 2026-08-12, on the founders' instruction.** Five companies by name, each quoted from its own page and nowhere characterised, against the one column none of them meets. Every cell and its URL in **§4.10**; the Kaplan cell is the only one not read live and the credit line says so. |
| "Virtual currency raised practice 1.4× to 3.7×" | `pov-virtual-currency` | **Directionally right, wrong column.** Those are group totals from unequal groups. Per student it is **1.3× to 3.7×**, published in the same table. Corrected on the slide. §6.1 |
| Why gamification at all — the causal chain | *(deck-wide)* | **Was missing, now on `pov-volume-is-the-constraint`.** The deck argued the method and then produced a game, with no slide establishing that compliance is the binding constraint. LSAC's own RR 21-01 supplies it. §7 |
| "Video minutes were not correlated with LSAT scores" | `pov-volume-is-the-constraint` | **Solid, and it is a direct quote from the test maker.** LSAC RR 21-01, read from the primary PDF 2026-08-10. §7 |
| Figures that print the product's own strings and numbers | `game-never-gates`, `pov-real-clock`, `pov-strategy-inside-the-question` | **Checkable, and checked 2026-08-12.** Three diagrams were replaced by the app's own screens on the founders' abstraction note, which makes each printed string a claim about the product. Every one is listed against the file it came from in **§9**. The one to know: `71%` and `58%` on the strategy slide were never data — they are a worked example from an internal design document — and are now the demo account's real counts. |

---

# 1. The 610 SAT reading claim

## 1.1 Verdict

**There is no citable source for "the average LSAT test taker scored a 610 on SAT reading," and no closely equivalent published figure exists. Do not say this number on stage.**

This is not a "we couldn't find it in ten minutes" answer. The figure would require a dataset that links individual SAT records to individual LSAT records, and no organization publishes one:

- **LSAC does not collect SAT scores.** LSAC's registration and Post-LSAT Questionnaire capture undergraduate institution, UGPA, major, demographics, and motivation — not prior standardized test scores. Nothing in LSAC's published research library, its Technical Report series, or its Knowledge Reports reports a mean SAT score for LSAT takers. (Research library: https://www.lsac.org/data-research/research · Technical report archive: https://www.lsac.org/data-research/research/research-archive)
- **The LSAT Correlation Studies are about something else.** They correlate LSAT score and UGPA with first-year law school average. They contain no SAT data. (https://www.lsac.org/data-research/research/lsat-correlation-study-results)
- **The National Longitudinal Bar Passage Study** tracked LSAT, UGPA, law school performance, and bar outcomes. It did not collect SAT scores.
- **College Board does not report by graduate/professional intent.** Its Total Group reports break out intended *undergraduate* major for high school seniors. There is no "future LSAT taker" category and no way to construct one.
- **The academic literature that links SAT and LSAT is aggregate-level, not individual-level.** The most-cited example correlates *2003 SAT means by intended undergraduate major* against *2007 LSAT means by major* — 16 data points, r = 0.89, no individual linkage, and the author himself flags the selection problems. (https://www.ljzigerell.com/?p=1095, using LSAT data from Nieswiadomy 2009 and College Board 2003.) This cannot produce a mean SAT reading score for LSAT takers.
- The "SAT-to-LSAT conversion" tables circulating on prep-company blogs and forums are percentile-matching exercises with no underlying paired dataset. Several of the widely shared regression formulas have no traceable origin at all. **Do not cite any of them.**

**Conclusion: the founders believe a number that nobody published.** The most likely origin is a forum post, a prep-company blog, or a conflation of some other statistic.

## 1.2 Why the phrasing is independently dangerous, even if a number existed

"610 on SAT reading" does not name a real score scale. There are three different things it could mean, and they are not interchangeable:

| Scale | Section | Range | In use |
| --- | --- | --- | --- |
| Pre-2016 SAT | **Critical Reading** (a standalone section) | 200–800 | Through Jan 2016 |
| Post-2016 SAT | **Evidence-Based Reading and Writing (EBRW)** — reading *and* writing combined | 200–800 | 2016 – early 2024 |
| Digital SAT (2024–) | **Reading and Writing** | 200–800 | March 2024 onward |
| Any era | *Reading Test subscore* | 10–40 | — |

A 610 is impossible on the 10–40 subscore scale, so the number can only refer to a 200–800 section score. But "SAT reading" as a standalone 200–800 section has not existed since January 2016 — today's equivalent section explicitly includes writing. Anyone in the audience who prepped for the SAT after 2016 knows this. **Saying "610 on SAT reading" to a room of recent graduates telegraphs that the number was not checked.**

## 1.3 Sanity check, for your own understanding only

Do not put this on a slide — it is arithmetic, not a citation. But it is worth knowing where 610 would sit if it were real:

- National SAT mean, class of 2024: **ERW 519, Math 505, Total 1024** (College Board 2024 Total Group Report — https://reports.collegeboard.org/media/pdf/2024-total-group-sat-suite-of-assessments-annual-report-ADA.pdf).
- A 610 ERW is roughly 90 points — a bit under one standard deviation — above that mean, landing somewhere in the high-70s to low-80s percentile among SAT takers. **Do not state a precise percentile on stage without pulling College Board's official percentile table**, and note that College Board publishes two different percentile scales (Nationally Representative and SAT User Group) that give different answers for the same score.
- **The direction is plausible.** LSAT takers are a self-selected, college-completing subpopulation, so their mean SAT would sit well above the national mean. For reference, high school seniors who reported an intended major of "Legal Studies, General" scored ERW 582 (n = 51,069, class of 2025) and ERW 572 (n = 24,763, class of 2022). Students who reported a doctoral-or-equivalent degree goal scored ERW 572 (class of 2025).
- **But plausible is not sourced, and the intended-major numbers are not a substitute.** They describe 17-year-olds checking a box about a possible undergraduate major, not people who actually sat the LSAT years later. If you cite them as the LSAT-taker average, you are making a substitution error a hostile questioner will catch, and it will cost you more than saying nothing.

## 1.4 Recommended slide wording — `turn-610-reader`

The argument survives fully intact without an SAT number, because LSAC itself supplies the load-bearing claim. Replace the number with LSAC's own words.

**Recommended on-screen copy:**

> # You already know how to read.
> LSAC: the LSAT is "a test of skills — specifically critical thinking skills as applied in the areas of reading and reasoning."
>
> **No syllabus. No prerequisites.**

**Recommended speaker notes (replacing the "610" sentence):**

> So here's the belief this company runs on. The LSAT does not test a body of knowledge. That's not our opinion — LSAC says it in those words: it's a test of skills, in reading and reasoning. There is no syllabus. And everybody sitting for it has already finished, or nearly finished, a four-year degree, because the ABA requires one. They have every piece of general knowledge the test asks for. They are not missing concepts. They are missing reps, and they are missing feedback on how they think. Which is exactly why eighty hours of instruction buys you 0.22 points.

**On the visual.** The extruded `610` is the hero object of the slide and the transition into slide 5 depends on it. If the design team wants to keep a single large numeral, `0.22` works — it is sourced, it is already the deck's opening number, and rotating it edge-on into the slide-5 progress track requires no rework. If you prefer to keep the "you already know how to read" framing without a numeral, the word **SKILLS** set at the same extruded scale carries the same weight.

**If the founders insist on keeping a number about the student's existing ability**, the only honest version is a statement about degree completion, not test scores. See Alternative B below.

---

# 2. Ranked replacements

Three sourced arguments, all of which make the same point — *the student is under-practiced, not under-taught* — ranked by how well they carry the turn.

## Alternative A (strongest) — LSAC's own coaching data already proves the point

**Why it ranks first.** You already have this number on slide 2. Using it again on slide 4 is not repetition, it is the payoff: slide 2 shows *coaching doesn't work*, slide 4 explains *why*. It is the test maker's own data, it is about the LSAT specifically rather than a proxy test, and it needs no SAT statistic at all. It also makes the turn stronger than 610 ever did, because it closes the loop instead of introducing a new fact the audience has to accept on faith.

- **Claim:** LSAC surveyed its own test takers about preparation methods. People who took a coaching course scored 0.22 points above those who took nothing. People who worked through actual published LSATs scored 2.77 points above. About 45% took a coaching course; only about a third had ever worked through a real test.
- **Source:** Wightman, L. F. (1990). *Self-Reported Methods of Test Preparation Used by LSAT Takers: A Summary of Responses from June and September 1989 Test Takers.* LSAC Research Report Series **RR 90-01**. Law School Admission Council.
- **URLs:** https://eric.ed.gov/?id=ED468954 (ERIC record, ED468954) · https://www.lsac.org/data-research/research/research-archive (LSAC archive listing)
- **Population and n:** June and September 1989 LSAT administrations; ~75% of test takers responded to the preparation questions; **n = 46,301**.
- **Citation note:** the report is dated **April 1990** and numbered **RR 90-01**, covering **1989** test takers. The deck currently calls it "Wightman 1989." That is defensible as shorthand for the test-taker cohort, but if you put a citation line on the slide, write **"LSAC, Wightman, RR 90-01 (1989 test takers), self-reported"** so a researcher in the audience can find it.
- **Hostile objections you must pre-empt:**
  - *Self-reported and non-randomized.* It is an association, not a causal effect. The deck already says this on screen — keep that.
  - *Respondents were not representative.* LSAC's own summary says respondents "tended to be younger and more able than their nonresponding counterparts." Volunteer that before someone else does.
  - *Most people used several methods at once*, so the categories overlap.
  - *It's from 1989.* Your §G answer is good. The strongest version: the sections it covered are the sections that still exist, it is the largest study of its kind ever published, and it comes from the organization that writes the test.
- **Slide-ready phrasing:** "The organization that writes the LSAT asked 46,301 of its own test takers what they did to prepare. Instruction was worth a fifth of a point. Doing real questions was worth more than ten times that."

## Alternative B — Every LSAT taker has already done four years of college-level reading

**Why it ranks second.** It makes the "the skill is already there" argument that 610 was reaching for, using a fact that is structurally guaranteed rather than statistically estimated. It is weaker than A only because it is a qualitative claim rather than a striking number.

- **Claim:** Law school applicants are required to hold a bachelor's degree, so effectively everyone sitting for the LSAT has completed, or is three-quarters through, four years of college-level reading and argument.
- **Source:** American Bar Association, *ABA Standards and Rules of Procedure for Approval of Law Schools*, **Standard 502(a)**: "A law school shall require for admission to its J.D. degree program a bachelor's degree that has been awarded by an institution that is accredited by an accrediting agency recognized by the United States Department of Education." Standard 502(b)(1) permits admission at three-fourths of a bachelor's degree in a joint BA/JD program; 502(c) permits an "extraordinary case" exception that is used very rarely.
- **URL:** https://www.americanbar.org/content/dam/aba/administrative/legal_education_and_admissions_to_the_bar/standards/2023-2024/23-24-standards-ch5.pdf (Chapter 5, Standard 502)
- **Supporting datapoint:** LSAC's 2024 1L Profile shows 23% of the entering class were first-generation college graduates and 47% had a parent or guardian with a post-graduate degree — i.e. this is a thoroughly college-educated population. (https://www.lsac.org/sites/default/files/research/20241LProfileReportFinal.pdf)
- **Hostile objections:**
  - "Having a degree doesn't mean you read well." Correct, and do not overclaim. The argument is that they are not *missing a prerequisite body of knowledge*, not that they are already good at the LSAT. Keep the claim narrow.
  - Cite the current edition of the Standards; the ABA revises them annually and has been actively loosening the *testing* requirement under Standard 503 (14 schools held test-optional variances in 2025). Standard 502 is unaffected, but check the year before you print it.
- **Slide-ready phrasing:** "Everyone taking the LSAT has a bachelor's degree — the ABA requires one. Four years of college-level reading already happened. That's not what's missing."

## Alternative C — LSAC's own description: the LSAT tests skills, not a syllabus

**Why it ranks third.** It is a primary source from the test maker and it is unassailable, but it is a definition rather than a finding, so it lands softer than A. Best used *with* A rather than instead of it — which is exactly how the recommended wording in §1.4 uses it.

- **Claim:** The LSAT measures reading and reasoning skills. It does not test any prerequisite body of subject-matter knowledge.
- **Sources and exact quotes:**
  - LSAC, *LSAT Prep*: "The LSAT® is designed to measure the skills necessary for law school success. These skills include reading comprehension, reasoning, and writing." And: "The LSAT is a test of skills — specifically critical thinking skills as applied in the areas of reading and reasoning." — https://www.lsac.org/lsat/prep
  - LSAC, *The Law School Admission Test: Reliability and Validity in Brief*: the LSAT "measures the comprehension of complex texts with accuracy and insight, the organization and management of information and the ability to draw reasonable inferences from it, the ability to think critically, the analysis and evaluation of the reasoning and arguments of others, and the ability to compose a persuasive argument." — https://www.lsac.org/data-research/research/lsat-reliability-validity
- **Hostile objection — read this one carefully.** The same LSAC page says the LSAT is **"not a mere general skills test"** and "does not measure skills unrelated to law school success." LSAC is drawing a distinction between a *generic* aptitude test and one tailored to law school. If you paraphrase LSAC as saying "it's just a general skills test," you will be quoting them against their own sentence. Stay on the precise claim: **it measures skills, not a body of knowledge.** That is true, it is LSAC's own framing, and it fully supports your argument.
- **Slide-ready phrasing:** "LSAC's own words: the LSAT is a test of skills in reading and reasoning. There is no syllabus, so there is nothing to teach you first."

## Alternative D (backup, weaker) — score improvement ceilings

Usable in Q&A, not strong enough for the turn.

- **Claim:** Retaking the LSAT produces an average gain of 2.8 points on the second attempt and 2.2 more on the third.
- **Source:** LSAC, *The Performance of Repeat Test Takers on the Law School Admission Test: 2006–2007 Through 2012–2013 Testing Years* (**TR 14-01**). https://www.lsac.org/data-research/research/performance-repeat-test-takers-law-school-admission-test-2006-2007-through
- **Exact numbers:** +2.8 points on the second sitting, +2.2 on the third. Mean scores by attempt: second-time 151.7, first-time 151.0, third-time 149.4.
- **Corroboration from LSAC's public guidance:** "on average, test takers taking their second test in the same testing year increase their scores 2 to 3 points." https://www.lsac.org/lsat/retaking-the-lsat
- **Most recent data:** LSAC TR 26-01 reports that in 2024–2025, 49.1% of all test takers tested more than once, and first-time takers averaged about 1.5 points below repeat takers. https://www.lsac.org/sites/default/files/research/TR-26-01.pdf
- **Hostile objection:** this measures gain between *administrations*, not gain from a diagnostic, and it does not isolate any instructional method. It is descriptive, not causal. Use it to show that real-world gains are small, not to attribute the smallness to instruction.

---

# 3. Bonus findings — `problem-200-hours`

## 3.1 "200+ hours of study" — defensible, but only as an industry recommendation

**There is no independent research measuring how long students actually study for the LSAT.** Every figure in circulation comes from prep companies' own recommendations. That is still usable, and it has a nice rhetorical property: these are your competitors' numbers, so they cannot dispute them.

| Source | Figure | URL |
| --- | --- | --- |
| Princeton Review | "Aim for 250 to 300 hours of LSAT preparation"; ~20 hrs/week over ~3 months | https://www.princetonreview.com/law-school-advice/how-long-should-you-study-for-the-lsat |
| Blueprint Prep | "successful students invest a total of 200 to 300 hours of study time" | https://blog.blueprintprep.com/lsat/how-long-should-you-study-for-the-lsat-3/ |
| Kaplan | 120 hours "bare minimum"; recommends **150–300 hours** | https://www.kaptest.com/study/lsat/how-many-hours-of-lsat-prep/ |
| LSAC (the test maker) | Declines to give an hours figure; "we often recommend [a few] months as a sort of baseline" | https://www.lsac.org/lsat/prep |

**Verdict: "200-plus hours" is safe** as long as you attribute it. Say *"the prep companies themselves recommend two to three hundred hours"* rather than *"students spend 200 hours,"* which asserts measured behavior nobody has measured.

**Caveat a hostile audience member will raise:** these are marketing recommendations from companies that sell by the month, so they have an incentive to quote a large number. That objection actually helps you — it means the industry is advertising a 250-hour commitment — but be ready to say it first.

## 3.2 "5–10 point increase from their initial diagnostic" — reword this

**No published source measures diagnostic-to-final score gains.** Prep companies claim much larger numbers (10–20 points), which is what they sell; LSAC's only hard data is the retake figure of +2.8 points between sittings (§Alternative D). So the deck's 5–10 sits in the middle of a range where the optimistic end is unsourced marketing and the pessimistic end is a different measurement entirely.

**The one quasi-quantitative source found** is a prep-industry study-schedule guide claiming 100–150 hours for a 5-point gain and 200–300 hours for a 10-point gain (https://athenify.io/blog/lsat-preparation-study-schedule). It is a blog with no methodology and should **not** be cited on a slide.

**Recommended rewording for `problem-200-hours`:**

> **On-screen:** "250 hours. A few points. Every month, on a credit card."
>
> **Speaker notes:** "And here's what that costs. The prep companies themselves tell you to plan for two hundred fifty to three hundred hours. LSAC's own data on people who retake says the second attempt moves you about two and a half to three points."

This is a stronger slide than the original, because every number in it is now attributable and the gap between effort and result looks *worse*, not better.

**If the founders insist on keeping "5 to 10 points,"** phrase it as an expectation rather than a finding: *"most students are hoping for five to ten points"* — a statement about student goals, which nobody can falsify, instead of a statistic that has no source.

## 3.3 "80+ of those hours getting instruction" at 7Sage and LSAT Lab — not substantiated

Neither company publishes a total instruction-hours figure, so the deck's "80+ hours" cannot be sourced to them. What they do publish:

**7Sage** (https://7sage.com/self-study/pricing)
- Own site: **"900+ bite-sized video lessons"** covering "LSAT logic and strategy from the ground up." No total runtime published.
- Own site, Live tier: **"12+ sessions per weekday and 60+ per week"** of live Zoom instruction, plus **"3,000+ recorded classes."**
- Third-party estimate: ~50 on-demand video hours on Core, 100+ on Live (https://testpreppal.com/lsat/prep-course/7sage). **This is a reviewer's estimate, not 7Sage's own figure.**

**LSAT Lab** (https://www.lsatlab.com/features)
- Own site: **90-minute workshop-style live classes, five days a week**, in "comprehensive 3-month courses."
- Third-party: "almost 50 on-demand videos," typically ~25 minutes each — roughly 20 hours of core video (https://testpreppal.com/lsat/prep-course/lsat-lab). A third-party review describes a structured 3-month path of 38 live classes ≈ 57 hours of instructor-led time.

**Verdict.** "80+ hours" is **not directly supported**, and on 7Sage's cheapest tier the honest number is probably closer to 50. But if you count the live tiers, the true figure is *much larger* than 80 — 90-minute classes five days a week over three months is roughly 100 hours of live instruction on its own, before any video. So the claim is directionally right and specifically wrong.

**Recommended rewording:** drop the precise hour count and use the competitors' own published structure, which is more damning anyway.

> **Speaker notes:** "On the popular apps, the product *is* instruction. 7Sage ships a nine-hundred-lesson video course. LSAT Lab runs ninety-minute classes five days a week for three months. That's where your money and your calendar go."

Every number in that sentence is a direct quote from the competitor's own website.

## 3.4 Competitor pricing — **the deck is currently wrong, fix this before you present**

The deck says competitors "charge hundreds of dollars a month." **That is false for the tiers most students actually buy**, and it is the single easiest way to lose the room: anyone with a phone can pull up 7Sage's pricing page in four seconds.

**7Sage** — https://7sage.com/self-study/pricing *(verified 2026-08-10)*

| Tier | Price | Contents |
| --- | --- | --- |
| Core | **$69/month** | 900+ video lessons, all official PrepTests, drills, analytics, Sage AI |
| Live | **$129/month** (first month $79 promo) | Core + daily live Zoom sessions, weekly proctored tests, office hours, 3,000+ class recordings |
| Coach | **$299/month** | Live + dedicated coach, two 30-min sessions/month |
| Fee-waiver program | **$1/month** | Core, for students with an LSAC fee waiver |

**LSAT Lab** — https://www.lsatlab.com/pricing *(verified 2026-08-10)*

| Tier | Price | Contents |
| --- | --- | --- |
| Free | **$0** | 2 official LSATs, video lessons, analytics, AI tools, 1 trial class |
| Premium | **$65/month** | 81 official LSATs, adaptive study plan, adaptive drilling, score guarantee |
| Classroom | **$125/month** | Premium + unlimited live classes |
| Tutor | **$425/month** | Classroom + 2 hours tutoring |

Both also list **annual billing at roughly a 30% discount**, and LSAT Lab offers **50% off Premium and Classroom** with an LSAC fee waiver (https://www.lsatlab.com/lsac-fee-waiver-program).

**The hidden cost, which is the better attack.** Both companies require an LSAC **LawHub Advantage** subscription to access official questions. 7Sage's own site states this costs **$124/year and goes to LSAC, not 7Sage.** (Some third-party reviews still list $120/year; use 7Sage's own $124 figure, since it is the one you can point at on their page.) This is a genuine, verifiable, unavoidable cost that every competitor passes through — and it is a far more interesting fact than a price you got wrong.

**Recommended rewording for `problem-200-hours`:**

> **On-screen copy:** replace the price ribbon "hundreds of dollars a month" with **"$65–$425 a month, plus $124 a year to LSAC."**
>
> **Speaker notes:** "And it's a subscription. LSAT Lab starts at sixty-five a month, 7Sage at sixty-nine, and once you want live classes or a coach you're at a hundred and twenty-five, two ninety-nine, four twenty-five. Every one of them also makes you buy LawHub from LSAC on top, a hundred and twenty-four a year, because that's the only way to get the real questions. Somebody has to pay for the video studio and the live instructors, and it's you, monthly, for as long as you're studying."

**Why this is better than the original line.** "Hundreds a month" is a single number that is easy to falsify. The range plus the duration is harder to dismiss and lands the same blow: at $129/month for the five months the same companies tell you to study, you are out roughly $645 plus LawHub, and the live tiers are exactly the ones carrying the instruction hours you are arguing against.

**One more caveat.** Prices move. **Re-check both pricing pages the morning of the pitch.** 7Sage was running a "$79 first month" promotion on the Live tier as of 2026-08-10; promotional pricing changes without notice.

## 3.5 Logic games — already correct, keep it

The deck's claim that LSAC removed Analytical Reasoning is accurate and worth keeping. LSAC's own TR 26-01 confirms the timing: "All test takers in this study took the LSAT before August 2024, when the test included an Analytical Reasoning section." (https://www.lsac.org/sites/default/files/research/TR-26-01.pdf, and the same note appears in the 2021–2025 Correlation Study summary.)

**Caveat:** verify before claiming competitors *still* teach it. Both 7Sage and LSAT Lab have publicly updated their curricula for the post-August-2024 format. If you make the jab, aim it at the general back catalog, not at these two by name.

---

# 4. Competitor reference — the full field, verified 2026-08-10

**Everything in this section was checked on 2026-08-10.** Where a page could not be loaded directly, that is said so in the cell rather than papered over, and every unverifiable item is listed in §4.9.

**Updated 2026-08-12:** the deck now names five of these products on one slide — see §4.10, which carries `market-in-their-own-words` cell by cell and re-reads Blueprint's, Princeton Review's, 7Sage's and Demon's own pages on that date. Princeton Review is new to this file and is there.

When this section was written the deck named only 7Sage and LSAT Lab. It exists because the three companies most likely to come up in Q&A — **LSAT Demon**, **Kaplan** and **PowerScore** — appear nowhere in it, and because Demon's public thesis is close enough to ours that being caught unprepared on it would be the single most damaging thing that could happen in the question period. See §G of `NARRATIVE.md` for the spoken answers.

## 4.1 At a glance

| Product | Entry price | Ceiling | Adaptive selection | Grades student-written reasoning | Confidence capture | Game / motivation layer |
| --- | --- | --- | --- | --- | --- | --- |
| **LSAT Demon** | $99/mo (Essential) | $499/mo (Pro) | **Yes** — "Smart Drilling" | **No** — pre-written expert explanations + human Ask reply | No | **No** (Discord community, daily podcasts) |
| **7Sage** | $69/mo (Core) | $299/mo (Coach) | **Yes** — "smart drills" + adaptive scheduler | **No** — Sage AI answers *your* questions | No | No |
| **LSAT Lab** | $0 free / $65/mo Premium | $425/mo (Tutor) | **Yes** — "Adaptive Drill Engine" | **No** — "AI Skills Training Center," contents not published | No | No |
| **Blueprint** | $99/mo (Starter) | $4,799 (170+ tutoring) | Yes (Pro plan study plan / QBank) | **No** | No | No |
| **Kaplan** | from $899 (On Demand) | $3,999 (Bootcamp) | Personalized Study Calendar; "interactive hints" | **No** | No | No |
| **Princeton Review** | $699 (Self-Paced) | $3,549 (Immersion 170+) | None advertised | **No** | No | No |
| **PowerScore** | $99/mo (On-Demand) | $995 (Live Online) | Performance analytics only | **No** | No | No |
| **Khan Academy** | Free | Free | — | **No** | No | No |

**Every row above also pays LSAC $124/year for LawHub Advantage.** LSAC's own page is the governing price: "A LawHub account is free, but with LawHub Advantage ($124/year)…" — https://www.lsac.org/lawhub *(accessed 2026-08-10)*. Providers quote it inconsistently at $115, $120 and $124 in their own checkout flows; **use LSAC's $124 and say where it comes from.**

**No product in this field grades a student's written reasoning, captures a confidence rating, or runs a game layer.** That is the finding this section exists to establish, and §4.9 says exactly how confident you may be in it.

**The Princeton Review row is new on 2026-08-12** and its whole source is one page, https://www.princetonreview.com/law/lsat-test-prep, loaded in a real browser: Self-Paced "100+ hours of recorded video lessons" **$799 → $699**; Fundamentals "30 hours of live instruction" $1,249 → **$1,049**; LSAT 170+ "65 hours of live instruction" $2,099 → **$1,799**; Immersion 170+ "130 hours of live instruction" plus "Additional 56 hours of content workshops" $3,999 → **$3,549**; private tutoring **$167/hr**. LawHub is passed through as it is everywhere: "Access 90+ LSAT PrepTests at no additional charge." **Every price on that page is a sale price shown against a higher list price**, so quote the range or the discounted figure with the word "currently" — this is the vendor whose numbers are most likely to have moved by the pitch. Nothing on the page describes anything a student writes, and there is no separate feature index to check, which is a thinner negative than the others in this table and should be said that way if pressed.

## 4.2 LSAT Demon — read this one twice

The closest competitor by positioning and the one that must not surprise you.

- **Pricing** *(https://lsatdemon.com/plans/lsat, accessed 2026-08-10)* — Essential **$99/mo**, Live **$179/mo**, Pro **$499/mo**. Monthly only; no annual tier is offered on the plans page. All three are marked "LawHub Advantage Required."
- **Fee waiver and military** *(https://lsatdemon.com/plans, accessed 2026-08-10)* — "Get 80% off our Essential plan or 20% off Live or Pro," honored for the life of the waiver plus one year. **Note a conflict:** Demon's plans-explained FAQ says "50% off Essential or 20% off Live or Pro for 3 years" (https://lsatdemon.com/resources/frequently-asked-questions/lsat-demon-plans-explained, accessed 2026-08-10). Two of Demon's own pages disagree. Do not quote a fee-waiver number for Demon on stage. 20% off any tier for current or past U.S./Canadian military.
- **Tutoring above Pro** *(https://lsatdemon.com/resources/frequently-asked-questions/tutoring-with-lsat-demon, accessed 2026-08-10)* — Demon tutors from $200/hr; Master tier from $300/hr with a $659 Pro-Master plan; Grandmaster from $600/hr with a $1,199 Pro-Grandmaster plan; the cofounders themselves from **$1,200/hr**.
- **Core pedagogical claim, in their own words** — "The LSAT is easy. You can master it." (https://lsatdemon.com/tutoring) · "There's no complex diagramming or hours of lessons. Smart Drilling meets you at your current skill level, which is exactly why we say The LSAT Is Easy." · "We don't teach shortcuts. We teach the reasoning skills the LSAT rewards." (https://lsatdemon.com/resources/frequently-asked-questions/why-lsat-demon) · "200+ lessons teach you how to think like top scorers. **No diagrams. No jargon. No memorizing.** Just common sense, sharpened." (https://lsatdemon.com/plans/lsat) — all accessed 2026-08-10.
- **How adaptive selection works** — "The Demon knows your weak spots and serves up the exact questions you need. Just hit Drill." (plans page). Their own explanation of the mechanism: "The Demon algorithm adjusts difficulty based on your performance. If you're struggling, you'll see easier questions so you can build fundamentals. If you're excelling, it will push you harder." (https://lsatdemon.com/resources/demon-daily/the-purpose-of-drilling, accessed 2026-08-10). It is **difficulty-and-weakness targeting on accuracy history** — the same class of mechanism as 7Sage's smart drills and LSAT Lab's adaptive engine, and the same class as ours.
- **Written reasoning: not required, not graded.** Nothing on Demon's site describes a field in which a student types their reasoning, and nothing describes anything scoring such a field. What Demon ships instead is (a) **10,000+ pre-written and video explanations** authored by cofounders Ben Olson and Nathan Fox — "Ben and Nathan unpack every question. Why is the right answer right? Why are the wrong ones wrong?" — delivered through **Merged Explanations**, which places each explanation directly beneath its answer choice (https://lsatdemon.com/resources/Features/merged-explanations); and (b) the **Ask Button**, where a human teacher writes you a personal explanation within 24 hours. This is expert explanation of *the question*, not assessment of *your* argument. It is high quality and it is human. It is not the same object as step-level feedback on a student's own written reasoning.
- **Named strategies during a question: deliberately refused.** This is a real philosophical difference and it cuts both ways. Demon is actively removing technique vocabulary from its own product: their published to-do list includes "Archive old lessons that dwell unnecessarily on jargon like 'contrapositives' and 'inferences,'" "Edit written explanations to eradicate these terms," and "Replace old logical reasoning videos that rely on diagramming" (https://lsatdemon.com/resources/lsat-tips-and-strategies/lsat-the-easy-way, accessed 2026-08-10). **The one technique they do build into the tool is prediction:** "Prediction Mode is a Demon drilling tool that hides the question and answer choices to focus your attention on the passage" (https://lsatdemon.com/resources?category=Features, accessed 2026-08-10). That is functionally close to our `prephrase` method, so do not claim nobody prompts a technique inside a question. Claim what is true: nobody measures whether it worked for that student.
- **Timing: they argue the opposite of our POV 5.** "We prioritize accuracy over speed." · "On section days, simulate the real test. **Hide the clock.** Focus on solving questions correctly, even if that means you don't finish." · "You can only serve one master. If you're thinking about timing, you're not thinking about the question." (https://lsatdemon.com/resources/demon-daily/the-purpose-of-drilling, accessed 2026-08-10.) **This is the sharpest live disagreement between the two products and it is the question to be ready for**, because Demon's version is well argued and widely believed. The answer is in §G.
- **How central are the founders' videos and classes?** Very. Live classes run **seven days a week** on Zoom, taught by the cofounders and by teachers who are all former Demon students scoring 99th percentile; the homepage's own class schedule for 2026-08-10 lists six sessions in one day, including "Ben's Class — Cofounder Ben Olson guides you through LR and RC" (https://lsatdemon.com/, accessed 2026-08-10). On top of that: "We'll provide **seven podcast episodes a week** at Thinking LSAT and Demon Daily" (lsat-the-easy-way, accessed 2026-08-10), plus the Thinking LSAT Podcast at 23.3K YouTube subscribers and 5.5M views. **A large part of what a Demon subscriber is buying is Ben and Nathan's voice, daily.** Treat that as a genuine retention moat, not as filler.
- **Motivation layer:** none advertised. Retention appears to run on the live classes, the podcasts and the **Demon Discord** — "one of the most active LSAT communities out there, and it's free" (features index, accessed 2026-08-10). No points, no currency, no levels, no streak mechanic found anywhere on the site. See §4.9 on the limits of proving a negative.
- **Other shipped features worth knowing**, from the features index (accessed 2026-08-10): **Ugly Mode 2.0** (renders the Demon as the exact official LSAT interface), **Test Import** (pulls section and test data from LawHub), **Roll Call** (LSAT/GPA against last year's admits), Dark Mode, and **Downvote Feedback** on explanations, which routes student dissatisfaction with an explanation back to the team.

## 4.3 7Sage

- **Pricing** *(https://7sage.com/self-study/pricing, accessed 2026-08-10)* — Core **$69/mo**; Live **$129/mo**, currently promoted as **"1st month $129 $79 · Limited-time offer · Renews at $129/month"**; Coach **$299/mo**. Each tier's card carries "Requires LSAC LSAT LawHub Advantage subscription."
- **Correction to §3.4 of this document.** §3.4 says "Both also list annual billing at roughly a 30% discount." **That is verified for LSAT Lab and not verified for 7Sage.** 7Sage's self-paced pricing page as loaded on 2026-08-10 offers monthly billing only, with no annual toggle and no annual price. Third-party reviews list a 7Sage annual plan at $599/yr and at $559/yr, which disagree with each other and could not be confirmed on 7Sage's own site. **Say "LSAT Lab discounts about 30% for annual billing" and do not extend it to 7Sage.**
- **Fee waiver** — "subscribe for as little as **$1/month**… You also qualify for 50% off our courses, 30% off our tutoring services" (same page).
- **Core claim and instruction format** — "**900+ bite-sized video lessons** cover LSAT logic and strategy from the ground up." Live adds "**12+ sessions per weekday and 60+ per week**" on Zoom, weekly proctored tests, office hours and "**3,000+ recorded classes**." Coach adds a dedicated 99th-percentile coach and two 30-minute sessions a month.
- **Adaptivity** — "Our adaptive algorithm builds a study plan that fits your schedule… then adjusts as you make progress" and "**Smart drills** — one-click drills zero in on your weaknesses, constantly adapting to your abilities."
- **AI, and why it matters to POV 3** — "**Sage AI** — Analyze your practice performance, get personalized recommendations on what to study next, and **ask Sage AI about tricky LSAT questions**. It's like having a tutor on call 24/7." Core includes it; Live is "2x more usage"; Coach is "10x." This is an assistant a student can query about a question, which is the interaction pattern `pov-ai-never-answers` argues against. It is a fair, sourced contrast and it should be stated as a design disagreement rather than an accusation — 7Sage publishes no evidence either way about guardrails.
- **LawHub, in their own words** — "Yes. You'll need LawHub Advantage to access most real LSAT questions on any site, even LawHub. It costs $124 per year, and the fee goes to LSAC (the test makers), not 7Sage." (7Sage's own FAQ; note their checkout page bundles it at $120, so their two pages disagree — LSAC's $124 governs.)
- **Reasoning grading / confidence / gamification** — none found. 7Sage is strongly associated with the **Blind Review** method, which is the closest thing in the field to a confidence signal: the student re-does uncertain questions before seeing the key. It is a study ritual and a review workflow, not a per-question numeric rating feeding a scheduler. **Expect a knowledgeable questioner to raise it against POV 2.**

## 4.4 LSAT Lab

- **Pricing** *(https://www.lsatlab.com/pricing, accessed 2026-08-10)* — Free **$0** (2 official LSATs, video lessons, score analytics, AI Skills Training Center, AI Analytics Assistant, 1 free trial class); Premium **$65/mo** (81 official LSATs, higher score guarantee, adaptive study plan, adaptive drilling, build-your-own practice sets); Classroom **$125/mo** (adds live classes); Tutor **$425/mo** (adds 2 hours tutoring). The page carries a **Monthly / Yearly toggle reading "Save 30% when you pay for 1 year!"** — this is the verified annual discount. All paid tiers marked "LawHub Advantage Required."
- **Fee waiver** *(https://www.lsatlab.com/lsac-fee-waiver-program, accessed 2026-08-10)* — "Save 50% on our Premium (reg. $65 per month) and our Classroom plan (reg. $125 per month)."
- **Instruction format** *(https://www.lsatlab.com/features, accessed 2026-08-10)* — "Our **90-minute workshop-style classes are offered 5 days a week** and go deep on every topic. Comprehensive 3-month courses start every month." Plus an "Encyclopedic Video Library" with class recordings updated five days a week.
- **Adaptivity** — "**Adaptive Drill Engine** — Our analytics take the guess work out of drilling, automatically selecting the right questions at the right level." Note the override: "**Or, use the Filtered setting to create custom drills with your exact specifications.**" That matters to the deck's "you don't pick the questions" fragment — LSAT Lab is adaptive *and* lets the student cherry-pick.
- **Analytics claim** — "We've analyzed every official LSAT question across more than 200 parameters."
- **Score guarantee** — study 2+ months from a diagnostic taken within 14 days; fewer than 5 points of improvement on the official LSAT means a 100% refund.
- **Reasoning grading** — the "AI Skills Training Center" and "AI Analytics Assistant" are named on the pricing page and **their contents are not described anywhere on the site**. This is the single largest hole in the "nobody grades written reasoning" claim. See §4.9.

## 4.5 Blueprint

In the deck already, but only as a source for study hours. Worth carrying because it is the field's other subscription-priced course and because the deck borrows its blind-review framing on `demo-mega-litigation`.

- **Pricing — re-read on the vendor's own page 2026-08-12, and §4.9(4) is discharged.** https://blueprintprep.com/lsat/online-anytime now loads and carries: Self-Paced Starter **$99/mo**, Self-Paced Pro **$149/mo**, Pro prepaid **from $649** for 6 or 12 months (was $894), Live Course **$899** on sale from $1,299 with "30 hours of live instruction," 170+ Course **$1,599** on sale from $1,999 with "60 hours of live instruction," tutoring **from $2,699**. The two live-course figures are sale prices carrying their own strikethroughs, so quote the range rather than the number. Blueprint's own monthly checkout page separately confirms "LSAT Self-Paced Pro Plan $149/month" (https://blueprintprep.com/self-paced-pro-course-monthly, accessed 2026-08-10).
- **Instruction format** *(online-anytime, 2026-08-12)* — Starter is "**61 interactive learning modules and video lessons**" plus "Qbank with 7,000+ real LSAT exam questions" and "Access all 59 official LawHub exams." Pro adds "Unlimited live review sessions 6x/week with LSAT experts." **This is the quote on `market-in-their-own-words`** — §4.10.
- **LawHub, in their own words** — "As of August 4, 2020, all LSAT students need an active LawHub Advantage… The cost for this service is **$124/yr** and is required for any student who wants to prep for the LSAT with official LSAT content, **no matter which third-party LSAT prep service you choose**." (https://blog.blueprintprep.com/lsat/what-is-lsat-prep-plus/, page updated 2026-03-20, accessed 2026-08-10.) **This is the best single citation in the whole file for the LawHub claim, because it is a competitor stating the universality of the fee.** Note that Blueprint's own checkout page simultaneously shows $115 and $120 for the same line item, which is a good illustration of why LSAC's number governs.
- **Reasoning grading / confidence / gamification** — none found.

## 4.6 Kaplan

The brand a non-expert room recognizes, and therefore the mental anchor, even though it is the least similar product.

- **Pricing** — On Demand **from $899** (promoted at $799 with code 100FALL, and listed at $699 in some promotional compilations), Live Online **from $1,299**, In Person **from $1,699**, Tutoring packages **from $1,999** (10/20/30/40 hours), 170+ Course **$2,799**, Bootcamp **$3,999**. Source: Kaplan's own pages, https://www.kaptest.com/lsat and https://www.kaptest.com/lsat/courses/lsat-prep-diy-online. **Caveat on method:** kaptest.com served a bot-verification interstitial to direct retrieval on 2026-08-10, so these figures come from search-index copies of Kaplan's own pages rather than a page loaded in front of me. They are consistent across the two pages and across three third-party reviews, but **treat the exact number as "about $900 to about $4,000" on stage** and see §4.9.
- **Instruction format** *(https://www.kaptest.com/lsat/courses/lsat-prep-online)* — Live Online: "**24 hours of live-streamed, interactive lessons**," plus "**60 hours** of exclusive live and on demand lessons on the **LSAT Channel**," 180+ curated quizzes, "every officially released LSAT question (nearly 6,000)," 4/6/12-month access. The On Demand page describes "12 hours of optimized asynchronous lessons"; a third-party review and an older Kaplan snapshot say 24. **Kaplan's own pages disagree on their hour counts in two places — the On Demand figure (12 vs 24) and the live figure, since the course page says 24 live hours and the FAQ on kaptest.com/lsat says "32 hours of core classroom instruction plus over 150 hours" on the LSAT Channel. Do not quote a Kaplan hour count on stage.** Say "a couple of dozen hours of live class plus a channel of on-demand lessons," which every version of their own copy supports.
- **Core pedagogical claim** — a named, taught procedure. Kaplan's LSAT Channel session descriptions read "explain the purpose of each step in the **Logical Reasoning Method** and be able to apply the LR Method to Argument-Based questions," and the RC equivalent is the "RC Method." This is the "strategies get taught and then you're left alone with them" model that `pov-strategy-inside-the-question` is aimed at, and Kaplan is the fairest target for it because they name the method and sell the course around it.
- **LawHub** — "LSAT Link Integration with access to 59 official practice tests via LSAC's LawHub Advantage (**$124 subscription required**)." Kaplan's own page, and it names the same $124.
- **Adaptivity** — "Personalized Study Calendar built backward from your specific test date" and "performance assessments with personalized study recommendations using advanced analytics." There is also "**interactive hints with instant feedback** to help you master every question type" — hints during practice, which is closer to our guardrail than 7Sage's ask-anything assistant. Be fair about that if it comes up.
- **Reasoning grading / confidence / gamification** — none found.

## 4.7 PowerScore

- **Pricing** *(https://powerscore.com/lsat/courses, accessed 2026-08-10)* — On-Demand **$99/month**, auto-renewing every 30 days; Live Online **$995** per course cohort; free 7-day Starter Access trial. The BARBRI-hosted page for the same products confirms both figures (https://pages.barbri.com/PowerScore-LSAT-Prep-Learn-More.html, accessed 2026-08-10). Both state "require an LSAC LawHub Advantage subscription for access." A pre-law student discount page advertises the On-Demand course at **$50/month**, describing it as 50% off a $100 list price, which does not match the $99 on the main course page — a live inconsistency in PowerScore's own funnel.
- **Instruction format** — Live Online: "**10 live, interactive core lessons (30+ hours total) plus 4 test-specific lessons (8 additional hours)**," a 2–3 month syllabus per test administration, all instructors required to have scored 170+. On-Demand: "**50+ hours of video lessons**" on the course page and "**100+ hours of on-demand lectures**" on the BARBRI page — **PowerScore's own two pages disagree; do not quote an hour count.**
- **Core pedagogical claim** — the Bibles. "Course curriculum created and taught by **LSAT Bible authors** Dave Killoran and Jon Denning," "Complete set of strategies designed by the LSAT Bible authors." Plus a prediction claim: "PowerScore's relentless focus on test trends has enabled us to accurately predict the content that appeared on **95% of LSATs since 2018**."
- **Their score claim, and how to handle it** — "PowerScore course students see an average score increase of **15.8 points**." Their own asterisk says it: "Score increase data gathered from a survey sent to all PowerScore LSAT Course students who were planning to take the November 2025 LSAT. Score increase averages were calculated from **self-reported diagnostic practice test score to highest practice test score**." That is self-reported, self-selected, and measures practice-test-to-practice-test rather than anything on a real LSAT. **If someone in the room cites 15.8 points at you, quote PowerScore's own footnote back — do not attack the company.** This is also the best available illustration of §3.2's point that nobody publishes a real diagnostic-to-final-score gain.
- **Adaptivity** — analytics and "recommended practice content," no adaptive question selection advertised.
- **Reasoning grading / confidence / gamification** — none found.

## 4.8 Khan Academy — it no longer exists, and knowing that is worth a point

**Khan Academy's Official LSAT Prep is retired.** The LSAC partnership ran from June 2018 and ended **June 30, 2024**. LSAC's own announcement: "Khan Academy will continue to offer Official LSAT Prep through June 2024… After June 2024, Khan Academy will only host videos and articles related to LSAT prep." (https://www.lsac.org/blog/khan-academy-lsat-test-prep-resources-coming-lsacs-lawhub-june-2024, accessed 2026-08-10.)

- **Where it went** — the lessons, videos, explanatory articles and practice exercises migrated to LawHub, where they remain free: "LawHub now is the exclusive home of prep tools that previously were available as free LSAT prep resources offered by Khan Academy" (https://app.lawhub.org/article/redesigned-official-lsat-preptests-available-now, accessed 2026-08-10). LSAC's announcement quantifies it as "more than 100 lessons, videos, and nearly 100 explanatory articles."
- **Student data was destroyed**, not migrated: Khan Academy's own notice told students to download or screenshot anything they wanted to keep, because "this data will no longer be accessible after June 30, 2024."
- **Why the timing matters** — LSAC's stated reason was consolidation onto LawHub, and it coincided with the August 2024 removal of Analytical Reasoning, which made the entire Khan library partially obsolete on the same date.
- **What this means for the pitch.** The free option in this market is now LSAC's own free LawHub tier plus the migrated Khan lessons. It is instruction — videos, articles, worked examples — with no adaptive selection, no reasoning grading and no motivation layer. If someone asks "why wouldn't a student just use the free LSAC material," the honest answer is that many should start there, and that it is the purest example of the thing slide 2 measures: free instruction, no feedback on how the student thinks. **Do not say "Khan Academy offers free LSAT prep" in the present tense.** Anyone who has looked in the last two years knows it does not, and it is an easy, avoidable credibility hit.
- **Direct verification note** — khanacademy.org's LSAT path and the Khan support article both failed to load on 2026-08-10 (a client-side error and a 404 respectively), which is itself weak corroboration that the program is gone. The load-bearing citations above are LSAC's and LawHub's, which did load.

## 4.9 What could NOT be verified — read before asserting any of it

1. **That no competitor grades student-written reasoning.** This is an unverifiable negative. What is established is that none of the eight in §4.1 *advertises* such a feature anywhere on its public pages, and that several advertise the alternative explicitly (pre-written explanations, human Ask replies, ask-the-AI assistants). **LSAT Lab's "AI Skills Training Center" is the specific hole**: it is named on the pricing page and described nowhere. Phrase the claim as "nobody else makes you write your reasoning and grades it," which is a claim about the required step in the workflow, and be ready to say "if LSAT Lab's AI center does something like this, they haven't published it."
2. **That no competitor has a game or motivation layer.** Same problem, lower risk. None advertises points, currency, levels or streaks. Demon's retention mechanics are community and habit — Discord, daily classes, seven podcast episodes a week — which are not gamification but are a real motivational moat and should not be dismissed.
3. **Kaplan's exact prices.** kaptest.com served a bot-verification challenge to direct retrieval on 2026-08-10. Figures are from search-index copies of Kaplan's own pages and are mutually consistent, but nobody loaded that page today. **Re-check manually before the pitch if you intend to say a Kaplan number out loud.**
4. ~~**Blueprint's full price ladder.**~~ **Discharged 2026-08-12.** https://blueprintprep.com/lsat/online-anytime loaded in a real browser and carries the self-paced ladder and the live-course prices directly — §4.10. The tutoring floor of $2,699 is on the same page. What the 2026-08-10 pass could not load, it can now.
5. **7Sage annual pricing.** Not offered on their self-paced pricing page today. Two third-party sources give two different annual figures. **§3.4's "both discount roughly 30% for annual" is wrong as written and is corrected in §4.3.**
6. **Demon's fee-waiver discount.** Two Demon pages give two different numbers (80% vs 50% off Essential). Do not quote one.
7. **Demon's advertised score guarantee.** A third-party review describes a 165-point guarantee on the Live tier. Nothing on Demon's own site confirms it. **Do not repeat it.**
8. **PowerScore and Kaplan instruction-hour counts.** Each company's own pages contradict themselves (PowerScore 50+ vs 100+; Kaplan 12 vs 24 asynchronous hours). Quote the live-class structure instead, which is consistent.
9. **Whether third-party review sites can be cited at all.** Several of the highest-ranking LSAT review sites returned prices that do not appear on any vendor page, including a "$89/month Daily tier" and a "$109/month" figure for LSAT Demon, neither of which exists. **Nothing in this section rests on a review site except where explicitly labelled**, and the labelled ones are flagged above.
10. **Our own question bank's provenance — settled, and the word "official" is now off the slides.** Internal rather than external, but it belongs on this list because it was the claim most likely to be challenged. The verified facts, from `README.md` and `backend/data/question_bank/manifest.json`: a pinned, checksum-manifested snapshot of **6,886 questions — 4,520 Logical Reasoning from `tasksource/lsat-lr` and 2,366 Reading Comprehension from `tasksource/lsat-rc`**, both Hugging Face datasets of publicly released LSAT material. **Neither upstream dataset card declares a license, and the repo's own README says to confirm dataset terms and LSAT content rights before publication or commercial use.** In this market "official" means LSAC-licensed content delivered through LawHub Advantage at $124/year, so claiming it asserted a license we do not hold *and* invited "then what are you paying LSAC?" on the very slides where §4.1's fee is the attack. `demo-case-answer` now says "real LSAT questions from publicly released exams" and `concept-lawyer-tycoon` says "6,886 LSAT questions"; the §4.1 LawHub line is unchanged, because it remains true that every competitor passes that fee through. The Q&A panel carries the provenance answer under `question-provenance`. **If the founders do hold a content license, or conclude the dataset terms permit commercial use, the stronger wording can come back — verify first.**
11. **Kaplan's quote on the market slide.** Item 3 above is about Kaplan's prices; this is about the one sentence of theirs that is now on a projector. kaptest.com served a bot wall to a real headless browser on 2026-08-12 as well, so the phrase quoted on `market-in-their-own-words` was read from cached copies of four Kaplan pages rather than from a page loaded in front of me. **It is the only cell on that slide not read live, and the slide's credit line says so out loud.** §4.10 carries the four pages and why the smaller of Kaplan's two self-contradicting figures is the one on screen. Re-check it manually before the pitch.

## 4.10 The market slide — every cell, its page, and the date it was read

`market-in-their-own-words` is the deck's only competitor comparison and the only slide that names five companies at once. Everything on it is a quotation or a price, both of which are checkable in front of the room, and **nothing on it is a judgement of a competitor.** That is the design: see the header of `src/figures/market-ledger.tsx` for how it answers §D of `NARRATIVE.md`, which argued against a comparison slide and was not wrong about why.

**Verification method, 2026-08-12.** Every page below except Kaplan's was loaded in a real headless Chromium, scrolled to the foot and read out of the rendered DOM, because all five vendors ship their pricing and feature copy from JavaScript and a plain fetch returns a cookie banner. Kaplan's is the exception and item 11 of §4.9 says so.

### The first column — what it hands you, in the company's own words

| On screen | Verbatim from | Read |
| --- | --- | --- |
| Kaplan — *"60 hours of live and on demand instruction"* | https://www.kaptest.com/lsat — "Only Kaplan courses includes The LSAT Channel, which gives you access to 60 hours of live and on demand instruction covering every subject and question type." The same figure appears on /lsat/courses/lsat-prep-online and /lsat/courses/score-170-lsat as "60 hours of exclusive live and on demand lessons on the LSAT Channel," and on /lsat/courses/lsat-self-study as "60+ hours of expert-led live and on demand video sessions." | 2026-08-12, **cached copies** — §4.9(11) |
| Princeton Review — *"100+ hours of recorded video lessons"* | https://www.princetonreview.com/law/lsat-test-prep, the Self-Paced card. The same page's live courses read "65 hours of live instruction" (LSAT 170+), "130 hours of live instruction" (Immersion 170+) and "30 hours of live instruction" (Fundamentals). | 2026-08-12, loaded |
| Blueprint — *"61 interactive learning modules and video lessons"* | https://blueprintprep.com/lsat/online-anytime, first bullet of the Starter plan. **This page could not be loaded on 2026-08-10 and can now** — §4.9(4) is discharged for the self-paced ladder: Starter $99/mo, Pro $149/mo, Pro 6/12-month from $649, Live Course $899 (was $1,299) with "30 hours of live instruction," 170+ Course $1,599 (was $1,999) with "60 hours of live instruction," tutoring from $2,699. | 2026-08-12, loaded |
| 7Sage — *"Comprehensive video course"* | https://7sage.com/self-study/pricing, a feature line on the Core plan. Their homepage expands it: "900+ bite-sized video lessons cover LSAT logic and strategy from the ground up." **The slide quotes the short form on purpose** — slide 3 already quotes the 900 at the same company, and one company saying the same thing twice in one deck is the founders' "text clutter" complaint in miniature. | 2026-08-12, loaded |
| LSAT Demon — *"Smart Drilling"* | https://lsatdemon.com/plans/lsat, a feature of the Essential plan alongside "Complete Curriculum," "Every Explanation" and "Ask Button." | 2026-08-12, loaded |

**Why Kaplan's smaller number is the one on screen.** §4.9(8) says not to quote a Kaplan hour count, and that rule is about their *classroom* hours, where their own pages say 12 and 24 for the same asynchronous course and 24 and 32 for the same live one. The LSAT Channel figure is a different case: **four Kaplan pages say 60 and one FAQ paragraph says "over 150."** Both are quotable, they differ in the direction that is worse for Kaplan, and the slide quotes the smaller. If anyone in the room says "it's more than that," the answer is *"your own course pages say sixty; your FAQ says a hundred and fifty; we used yours."* That is a good exchange to have and a bad one to lose by having reached for the big number.

**Why LSAT Lab and PowerScore are not on the slide.** Six rows is what reads in three seconds and the founders named five competitors. LSAT Lab is on slide 3 by name and PowerScore is in §4.7 for Q&A. Neither omission changes the second column: §4.1 has both of them at **No** for reasoning grading.

### The second column — *the letter you picked*, five times

This is the load-bearing cell and it is deliberately a statement about **what the product scores**, not about what it lacks. Every one of the five scores answer choices and publishes analytics on accuracy and timing; none of them has a step in its workflow where the student writes their reasoning, so none of them has anything else to score. That framing is §4.9(1)'s instruction followed exactly: *a claim about the required step in the workflow*, not an assertion about code nobody outside the company has seen.

What each of the five ships **instead** of grading your reasoning, in their own words, is the reason the claim survives contact with someone who has used them:

- **LSAT Demon** — 10,000+ pre-written and video explanations, "Merged Explanations," and the Ask Button, where a human teacher writes you a personal explanation within 24 hours (§4.2). Expert explanation *of the question*.
- **7Sage** — "Every question explained," plus Sage AI: "ask Sage AI about tricky LSAT questions" (§4.3). An assistant that answers *your* questions.
- **Blueprint** — "Analytics that highlight where to focus," "A Qbank that gets smarter as you do" (online-anytime, 2026-08-12).
- **Kaplan** — "interactive hints with instant feedback," "performance assessments with personalized study recommendations using advanced analytics" (§4.6).
- **Princeton Review** — live instruction and "world-class test-taking strategies" (their own homepage, 2026-08-12).

**The one hole, and the sentence that covers it.** LSAT Lab's "AI Skills Training Center" is named on their pricing page and described nowhere — §4.9(1). LSAT Lab is not a row on this slide, so the hole cannot be pointed at a cell; if it is raised anyway, the answer is in the slide's own notes: *"If LSAT Lab's AI centre does something like this, they have not published it."*

### Why there is no price column, and what the presenter says instead

Three reasons, in the order they matter.

1. **Slide 3 is twenty seconds of talk away** and carries the range — $65–$425 a month, plus $124 a year to LSAC — with the hours it buys. A price column here is the same argument twice, on the slide whose whole job is a different axis.
2. **Price is the only figure in this market that moves weekly**, and §4.9 items 3 through 7 are all prices: Kaplan's could not be loaded at all, Blueprint's ladder was third-party until this month, 7Sage's annual plan does not exist on their own page, and Demon's own two pages disagree about their fee waiver. A slide that is wrong by the morning of the pitch is worse than a slide that never claimed it.
3. **There is no Lawyer Tycoon price to print** (§8), so a price column would end on a blank in the one row that is the punchline.

**The prices the presenter carries instead**, all verified 2026-08-12 unless marked: LSAT Demon $99/mo Essential, $179 Live, $499 Pro. 7Sage $69/mo Core, $129 Live (first month $79), $299 Coach. Blueprint $99/mo Starter, $149/mo Pro, $899 Live Course, $1,599 for the 170+ course. Princeton Review $699 self-paced, $1,049 Fundamentals, $1,799 for the 170+ course, $3,549 Immersion, tutoring $167/hr. Kaplan from about $900 to about $4,000 *(§4.9(3), not loaded)*. **Every one of them plus $124/year to LSAC**, which is the only number on this list that is the same for everybody, including us.

---

# 5. Summary of slide changes recommended

Rows 5–10 were the original recommendations and are applied in `NARRATIVE.md` Revision 3. Row 4 is Revision 4's. Row 3 is Revision 6's. **Rows 1 and 2 are Revision 10's.** Row 2 and row 3 are the only changes in the file's history that moved the runtime.

| Slide | Change | Severity |
| --- | --- | --- |
| `game-never-gates` · `pov-real-clock` · `pov-strategy-inside-the-question` | **Three diagrams replaced by the product's own screens**, on the founders' note that the deck was too abstract to be recognisably about the app. Each now quotes the shipped code, and **§9 lists every string and number with the file it came from** so a judge can check the lot. Nothing here is a research claim and nothing changes what a slide argues; what changes is that the argument is drawn in the product's language instead of about it. **No runtime cost.** | Applied |
| **`market-in-their-own-words`** | **New slide, inserted at position 7**, between Spiky POV 01 and the confidence POV. Five named competitors quoted from their own pages against one column none of them meets, sourced cell by cell in §4.10, with the Demon concession on screen as the standfirst. Requested by the founders after walking the deck; §D of `NARRATIVE.md` had argued against a comparison slide and its four objections are answered rather than overruled — see the header of `src/figures/market-ledger.tsx`. **Costs 10s and nothing gives way. The deck is 5:00 across 25 slides.** | Applied |
| **`pov-volume-is-the-constraint`** | **New slide, inserted at position 8**, between `pov-confidence-signal` and the concept. Carries §7: video minutes were not correlated with LSAT scores, practice time was worth +4.3 points across the engagement range, and 51% of the cohort never completed one practice exam. This is the deck's answer to *why gamification* — the game is the compliance mechanism for a method whose binding constraint is compliance — and it is stated before the game is ever named, so the game arrives as an answer rather than as an amenity. **Costs 26s; `pov-virtual-currency` gives back 2. The deck is 10:04.** | Applied |
| `pov-virtual-currency` | **Rebuilt in Revision 5, corrected in Revision 6.** Argues the mechanism (§6.1) rather than points-against-badges. The three multiples were the paper's group totals and are now its per-student averages — 1.3× / 2.5× / 3.7× — because the experimental and comparison groups are not the same size. Both nulls stay on screen. | Applied |
| `pov-reasoning-is-the-work` | **Add the competitive line on stage:** a fourth fragment reading *"They explain the question. We grade your explanation."* and one closing sentence in the speaker notes, paid for by compressing the Zhang & Fiorella sentence. No new slide, no comparison table, runtime unchanged at 9:40. Everything else about the competitive field lives in §G and in §4 above. | Applied |
| `turn-610-reader` | **Remove the 610 figure entirely.** Replace with the LSAC "test of skills" quote plus the ABA bachelor's-degree fact. Full replacement copy and speaker notes in §1.4. The extruded `610` visual should become `0.22` or the word SKILLS. | **Blocking** |
| `problem-200-hours` | **Replace "hundreds of dollars a month"** with the real range, "$65–$425 a month, plus $124 a year to LSAC." Full replacement notes in §3.4. | **Blocking** |
| `problem-200-hours` | Change "students put 200+ hours in" to "the prep companies themselves recommend 250 to 300 hours." §3.1 | High |
| `problem-200-hours` | Change "5 to 10 point gain" to LSAC's retake figure, or reframe as a student expectation. §3.2 | High |
| `problem-200-hours` | Replace "more than eighty of those hours go to receiving instruction" with the competitors' own published curriculum structure. §3.3 | Medium |
| `problem-coaching-tax` | No change to the numbers. Update the on-screen citation hairline to **"LSAC, Wightman, RR 90-01 (1989 test takers), self-reported."** §Alternative A | Low |

**The two blocking items are the only ones that can cost you the room.** Everything else is a credibility upgrade rather than a repair.

---

# 6. Gamification evidence — what the deck may claim, and what it must not

Added because the founders asked the deck a direct question — *why gamification?* — and the honest answer needed sourcing at the same standard as §1–§4. The short version: **gamification's defensible claim is that it buys practice volume. It does not buy motivation, and it does not buy grades.** Every source below agrees on that shape, and the deck now says it out loud on `pov-virtual-currency` rather than hoping nobody asks.

## 6.1 The one study that isolated virtual currency — `pov-virtual-currency`

- **Citation:** Dicheva, D., et al. (2023). *A Multi-Case Empirical Study on the Impact of Virtual Currency on Student Engagement and Motivation.* ***Trends in Higher Education*** **2(3), 462–476, article 27.** https://doi.org/10.3390/higheredu2030027 · open access at https://www.mdpi.com/2813-4346/2/3/27 *(full text read 2026-08-10)*
- **Why it is the right source.** Almost every gamification study bundles points, badges, leaderboards and currency together, which makes the individual element's effect unrecoverable. This one does not: virtual currency "was the single gamification element used," in three separate semester-long quasi-experiments, in three subjects, at three institutions with deliberately different student populations. That is the closest thing in the literature to an isolated test of the mechanic Lawyer Tycoon runs on.
- **Design:** quasi-experimental, not randomized — different class sections served as experimental and comparison groups, with the same syllabus, textbook, lectures, labs, assignments and tests. Fall 2019 – Spring 2021. **171 students total: 91 experimental, 80 comparison.** All three courses gamified on the OneUp platform.

| Case | Course | Institution | Comparison / experimental n | Unique practice sets **per student** | Multiple |
| --- | --- | --- | --- | ---: | ---: |
| A | Discrete Mathematics | public HBCU, North Carolina | 19 / 21 | 12.73 → 16.33 | **1.3×** |
| B | Discrete Structures | private research university, Pennsylvania | 33 / 49 | 29.85 → 74.98 | **2.5×** |
| C | Computer Networking | private university, Missouri | 28 / 21 | 7.07 → 25.90 | **3.7×** |

- **Use the per-student column, which is what the slide now shows.** The paper's own headline figures are *group totals* — "close to four times (373%)" for Study B and "close to 274%" for Study C, with Study A "close to 50% more" — and the deck used those until the paper was read against them. They are not wrong, but they are not normalised: Study B ran 49 experimental students against 33 comparison students, so roughly a third of that 3.7× is headcount. Both columns are printed in the paper's Table 3, so anyone who opens the source sees the discrepancy immediately. **The per-student multiples are the defensible ones and they still carry the argument.**
- **The two nulls, in the paper's own words** (abstract): the results "demonstrate a significant increase in student engagement in out-of-class practicing gamified with virtual currency" but "fail to show a significant increase in students' intrinsic motivation and students' final course grades."
  - *Motivation:* pre/post Basic Psychological Needs Satisfaction Scale, paired-samples t-test, no significant change in autonomy, competence or relatedness.
  - *Grades:* Study A +3.16 points on the final, not significant. Study B final-grade means 85.85 vs 87.73, **t-test p = 0.48**. Study C no significant improvement, though As-and-Bs went 79% → 86% and Ds-and-Fs 11% → 5%.
- **Keep both nulls on the slide.** They are the reason a room that distrusts gamification believes the rest of the act. They are also the reason the product is shaped the way it is: a currency that moves volume and nothing else *has* to sit on top of an engine that converts volume into a score, which is exactly what `game-never-gates` claims.
- **Hostile objections to have ready:**
  - *Quasi-experimental, not randomised.* Correct, and the paper says so first. Different class sections, some across different semesters — Study A's comparison group was Fall 2019 and its experimental group was Spring 2020, which is the semester COVID moved the course online. Volunteer that.
  - *Computer science undergraduates, not LSAT candidates.* Correct. The transferable claim is about the mechanic, not the subject.
  - *The currency bought course benefits — deadline extensions, dropped low scores, extra credit.* True, and it is a real disanalogy: our currency buys a fictional law firm, not grade relief. This cuts against us and should be conceded rather than argued. The counter is that the paper's own discussion attributes the volume effect to the earning side (practice quizzes), and that Clark (§6.3) is the evidence for the fiction working as a reward.
  - *Small n.* 171 across three sites, the largest cell being 49.

## 6.2 The broader gamification literature — background, not slide copy

- **Sailer, M., & Homner, L. (2020).** *The Gamification of Learning: a Meta-analysis.* Educational Psychology Review 32(1), 77–112. The field's most methodologically careful meta-analysis. **Cognitive learning outcomes g = 0.49**, and *game fiction was a significant positive moderator* — which is the evidence for a narrative tycoon frame rather than a bare points system. **Not currently cited on any slide** and it should stay that way unless a questioner asks whether gamification harms learning; then it is the answer.
- **Meng, C., Zhao, M., Pan, Z., et al. (2024).** *Investigating the impact of gamification components on online learners' engagement.* Smart Learning Environments 11, 47. https://doi.org/10.1186/s40561-024-00335-4. Was cited on `pov-virtual-currency` in an earlier revision, as the source for "points beat badges." **That citation is now removed from the slide**, because a comparison between two game elements is not a mechanism and the slide argues the mechanism instead. Keep the paper for Q&A.
- **The novelty-decay finding, which is the strongest argument against us.** `research/01-learning-science.md` §8 records a behavioural-change meta-analysis with the gradient **under one hour ES = 1.57 → 2–16 weeks ES = 0.39 → 1–2 years ES = −0.20**, i.e. gamification's behavioural effect is front-loaded and eventually *inverts*. An LSAT cycle is three to six months, which is the middle band. **Do not claim the game holds a student indefinitely.** The honest answer, and the one the product is actually built for: the game is an activation and habit-formation device for the early weeks, and the dashboard's score movement is what has to hold the student by month three.
- **The internal tension nobody outside will raise but the founders should know.** `research/01-learning-science.md` §7 concludes that the app "should not measure or reward raw questions-completed or minutes-in-app" but practice *quality*. That is not in conflict with the deck as written, because every rep the deck counts is a graded-reasoning rep with step-level feedback attached — but it is the reason the on-slide language must never be "grind" or "brute force." Volume of a *feedback-carrying* rep is the claim; volume alone is not.

## 6.3 `game-by-design` — the Clark meta-analysis

- **Citation:** Clark, D. B., Tanner-Smith, E. E., & Killingsworth, S. S. (2016). *Digital Games, Design, and Learning: A Systematic Review and Meta-Analysis.* **Review of Educational Research 86(1), 79–122.** https://doi.org/10.3102/0034654315582065
- The four design splits on the slide are its media-comparison and value-added findings: single-player over competitive, schematic over photoreal, thin narrative over medium, distributed sessions over one long one.
- **The caveat is already on the slide and must stay.** The hairline credit reads "average participant age ~12–13; RCT subset smaller." Alan says it out loud too. Design guidance, not proof.

---

# 7. Volume, and the active-versus-passive contrast — `pov-volume-is-the-constraint`

This is the evidence behind the slide added in Revision 6, and it is the best single citation in the deck, because it is **the test maker measuring a prep platform against real LSAT scores.** Every number below was read out of the primary PDF on 2026-08-10, not out of a summary.

- **Citation:** Dustman, K., Camilli, G., & Gallagher, A. (2021). *LSAT Takers and Khan Academy Preparation.* LSAC Research Report **RR 21-01**. *(Author order corrected 2026-08-10 against the report's own title page; it had been printed here and on slide 8 as Dustman, Gallagher & Camilli.)*
- **URL:** https://lsac.org/sites/default/files/research/LSAT-Test-Taker-Khan-Preparation_RR-21-01_full-report.pdf · summary: https://www.lsac.org/blog/study-shows-lsat-score-increases-candidates-who-use-free-khan-academy-prep-tools
- **Design:** quasi-experimental. Khan Academy platform usage logs matched to the actual LSAT scores those students went on to earn, June 2018 – July 2020. Descriptive sample **12,471** consenting Khan users; regression sample **n = 6,938** (6,550 with at least 2 log practice minutes). Controls: UGPA, Pell Grant status, test-taker age.

**The three findings the slide uses, each verbatim or arithmetic from the report:**

1. **Video did nothing.** *"Other usage variables were examined but were found not to correlate with actual LSAT scores. Video minutes, for example, were not correlated with LSAT scores, but they were positively associated with age (r = 0.16, p < .0001), meaning that older test takers were somewhat more likely to spend time viewing videos."* This is the sentence the slide's "no relationship — LSAC's words, not ours" points at. **Quote it exactly if challenged; do not paraphrase it as "video is useless."**
2. **Practice did.** Pearson correlation of practice minutes with LSAT score **r = 0.19** (UGPA with LSAT r = 0.33, for scale). Standardised regression slope β = 0.17–0.18 for log practice minutes. Table 5 baselines everything against the 10th percentile of practice time, **26 minutes**: *"students at the 90th percentile of practice time (47 hours) had scores that, on average, were 4.3 points higher than students at the 10th percentile."* Effect sizes in the report are computed against the LSAT SD of **10.7**, so 4.3 points is **d = 0.40**.
3. **Half never started.** *"About 51% of Khan users did not complete an LSAT practice exam."* And from the discussion: *"While students who took at least one practice exam took an average of 4.5 practice exams, 51% of students in the sample did not complete a full practice exam."* Of those who did complete at least one: 47% did 1–3, 44% did 4–9, 9% did all ten available.

**How much weight the video null is asked to carry — changed 2026-08-10, and this is now the deck's registered position.**

The null used to be *proof* that lecture hours do not work, and in that role it was the softest reasoning on the slide: **the median student in this cohort watched 42 minutes of video**, so a null across that range is not a verdict on a hundred-hour lecture course, and a well-read objector can say so in one sentence.

It is now **corroboration**, and the load moved off it entirely. The audience has independently volunteered the anti-lecture premise — they have said, of their own institution's lecture courses, that passive hours produce bad outcomes — so the deck asserts that in half a sentence and banks the agreement rather than arguing for it. The null's job is the word *even*: **"even the test maker's own data shows video minutes weren't correlated."** Same sentence from LSAC, same slide, same figure. What changed is that if the 42-minute objection lands, nothing falls over, because the proposition was already granted before the null was mentioned.

**The separate claim that competitors sell passive hours rests on their own published curricula (§4), not on this null, and must never be sourced to it.** Two different arguments; keep them apart under questioning.

**Caveats, all of which the founders should volunteer before anyone else does:**

- **It is an association, not a causal effect,** and LSAC says so: the report states plainly that this is quasi-experimental and that "the possibility of alternative explanations cannot be ruled out." Practice volume is confounded with motivation, conscientiousness and free time in ways UGPA, Pell status and age do not capture. **The slide's claim survives this**, because the slide's claim is about the *constraint*, not about a treatment effect — 51% not finishing an exam is a description, and descriptions do not need identification.
- **The dominant predictor is baseline, not practice.** Adding first-practice-exam score to the model takes R² from 0.21 to 0.64, with FPE β = .68. Practice time is a real but modest increment on top of where the student started. **Never let the +4.3 be heard as "we will move you 4.3 points."** It is the observed spread between the bottom and top deciles of engagement on one free platform.
- **The ceiling this implies.** 47 hours — the 90th percentile of engagement — was worth 4.3 points. Any claim above about five points from practice volume alone is outside what LSAC's own data supports. This is also the number that keeps `problem-hours-and-price` honest.
- **Data is 2018–2020**, before the August 2024 removal of Analytical Reasoning.
- **The platform in question is retired** — see §4.8. Do not describe Khan Academy's LSAT prep in the present tense. The correct framing on stage is past tense: *"LSAC studied their own free platform."*

**One number in the repo's research digest that could NOT be confirmed from the primary PDF.** `research/02-measurement-and-score-prediction.md` records a second dose-response ladder by *number of practice exams* — 1–2 exams +1.59; 3–4 +3.58; 5–6 +4.39; 7–8 +5.59; 9–10 +7.26 points. The report's prose confirms the bins exist and that "taking more practice exams generally resulted in increased LSAT scores," but the per-bin coefficients live in a table whose cells did not survive text extraction, so **nobody has read those five numbers off the page in this revision.** They are deliberately **not on any slide.** If the founders want the exam ladder rather than the practice-time interval, open **Table 8** of the PDF and confirm the five values first. *(This pointer said Table 6 until 2026-08-10; Table 6 is the baseline-confound regression, which is a different argument entirely — see §7 and the `lsac-baseline-confound` entry in `notes/qa.ts`.)*

---

# 8. On-stage competitive claims — the register

Three sentences in the deck compare Lawyer Tycoon to the field without naming anybody. Each one is here with the thing that makes it true.

**They are no longer the whole of the on-stage positioning.** The founders asked for a direct comparison after walking the deck, and `market-in-their-own-words` is now slide 7 — five companies by name, each quoted from its own page, sourced cell by cell in §4.10. That changes what these three sentences are for rather than what they say: the slide does the naming, and they stay as the register in which everything else is said. Read §4.10 before reading this table; the rule the slide is built on — quote, never characterise — is the rule below, applied to five rows instead of one sentence.

| Slide | On-screen | What backs it | Risk |
| --- | --- | --- | --- |
| `pov-reasoning-is-the-work` | *"They explain the question. We grade your explanation."* | §4.1 — no product in the field advertises grading student-written reasoning. Demon ships 10,000+ pre-written and video explanations plus a human Ask reply; 7Sage ships Sage AI, which answers *your* questions. Both are explanation *of the question*. | **Medium.** §4.9(1): unverifiable negative, and LSAT Lab's undescribed "AI Skills Training Center" is the hole. Phrase as the required step in the workflow, and be ready to say "if LSAT Lab's AI centre does this, they have not published it." |
| `pov-strategy-inside-the-question` | *"Nobody else measures whether it worked."* | §4.2 — a claim about **measurement**, chosen deliberately over "nobody prompts a method," which would be false: Demon's Prediction Mode already prompts a technique inside a question. No product in §4 measures a named method's effect on an individual student against their own control. | **Low.** The narrower claim is the one §4 actually supports. |
| `pov-volume-is-the-constraint` | *"They sell hours. We sell reps."* | §3.1 and §3.3 — the field sells instruction and prices it in hours: 7Sage's 900+ video lessons and 60+ live sessions a week; LSAT Lab's 90-minute classes five days a week; Kaplan's live hours plus the LSAT Channel; PowerScore's 50–100+ video hours; Blueprint's course; Demon's daily classes and seven podcast episodes a week (§4.2). Against that, §7: video minutes were not correlated with LSAT scores. | **Low, and this is the strongest of the three.** It is the one axis LSAT Demon cannot meet by being cheap or by being AI-driven — Demon's own retention runs on live classes, podcasts and Discord, all of which still require the student to show up. **Be fair about that when it comes up:** it is a genuine moat, it is not gamification, and habit-through-community is a real answer to the same problem. Ours is structural; theirs is social. |
| `market-in-their-own-words` | Five quotes, five identical verdicts, and the standfirst *"LSAT Demon will get you to a question as fast as we will."* | §4.10, cell by cell. Nothing on the slide characterises a competitor: the first column is their marketing copy inside quotation marks and the second is what the product scores. | **Low, and lower than the three above**, because a quotation cannot be argued with and the slide makes no comparative judgement for a judge to attack. The two exposures are Kaplan's cell, which was read from a cached page (§4.9(11)), and the second column, which is the §4.9(1) negative restated as the workflow claim it is allowed to be. **The standfirst is a concession and it is not optional** — it is what buys the other five rows from anyone in the room who has used Demon. |

**Three things the deck deliberately does not claim on stage.**

1. **A price.** There is no Lawyer Tycoon price to name. `close-one-stop-shop` says *"Cheaper — no video studio, no live instructors,"* which is a claim about cost structure and is true by construction. **Do not answer "how much?" with a number that has not been decided.** Say what the cost structure removes.
2. **That the thesis is ours.** §D of `NARRATIVE.md` is emphatic and it is still right: Demon has argued publicly for years that drilling beats lecturing. The differentiation is what happens inside one rep, plus the compliance mechanism — not the diagnosis.
3. **That competitors have no motivation layer.** §4.9(2). None *advertises* points, currency, levels or streaks. That is a claim about their marketing pages, and it is as far as it can honestly go.

---
# 9. Figures that quote the product — three slides, and how to check them

Revision 10 answered the founders' note that *"some of these slides are simply too abstract and don't show enough good visuals really theming itself around the app"* by putting the app's own screens on three figures in place of diagrams of them. That is a better slide and a **new kind of exposure**: a number or a phrase presented as the product's is a claim about the product, and this deck has been pulled up before for framing that outran its evidence. So every one of them is listed here with the file it came from.

None of these is a research claim and none needs an outside source. What they need is to be **true of the shipped code**, and all of them were read out of the tree on 2026-08-12. If the product changes, these slides are wrong and this section is the list of what to re-read.

## 9.1 `game-never-gates` — the unlock list

| On the slide | Where it comes from |
| --- | --- |
| The form of every row — a padlock, the thing, its requirement | `frontend/src/wardrobe.tsx` line 185: `<b className="wardrobe-item-lock"><Lock size={12} />{item.requirement}</b>` |
| *Settle 25 cases* · *Settle 100 cases* · *Hold 55 reputation* · *Reach the Downtown Firm (HQ tier 3)* | `_wardrobe_requirement` in `backend/app/game.py` composes these from three verbs. The four items are `tie_regimental`, `accessory_briefcase`, `accessory_wristwatch` and `suit_forest` in the `WARDROBE` table; the tier name and number are `FIRM_TIERS[3]` |
| *Available from your first day* | The same function's fallback, returned for any item whose unlock is `WARDROBE_UNLOCK_START` |
| “Everything here is won by practising, never bought.” | `frontend/src/wardrobe.tsx` line 113, printed under the wardrobe's own heading. Set as a quotation on the slide and credited to that screen |

**Two liberties, both small and both worth knowing before somebody notices them.** The app files its cosmetics under category headings, so "Forest green" is printed on the slide as "Forest green suit"; and the four items are four of twenty-nine, picked to span three of the game's currencies rather than at random. **No requirement string was reworded.**

**The last row is a claim about the code, not a promise, and this is how it was checked.** Nothing in `backend/app/scheduling.py` or `backend/app/services.py` — the two modules that build a session and choose its questions — reads `office_tier`, `reputation` or `total_cases`. Grep for all three returns nothing in either file. That is the whole of the evidence for *the game never gates the practice*; it is a negative, and it is the one class of negative this deck is allowed to assert, because the surface is ours.

## 9.2 `pov-real-clock` — the timer at the middle of the dial

- **`target 2:30`** is the shipped Logical Reasoning target: `_target_time_seconds` in `backend/app/services.py` returns **150** seconds for any Logical Reasoning item. (Reading Comprehension is 330, or 135 on a reused passage, which is why the slide's chip is an LR one.)
- **`2:56`** is the elapsed time the ring already draws. The used arc is at 0.82 and the pace ring at 0.70, so the overrun is 150 × 0.82 / 0.70 ≈ **176 seconds**. The four values are one reading; move any of them and move all four.
- **The gold** is the app's, not the deck's: `case-flow.tsx` puts a `case-timer` into its `over` state once elapsed passes target. Gold rather than red because the deck spends verdict red on `pov-reasoning-is-the-work` and `pov-confidence-signal` and this is not one of them.
- **This slide still carries no credit line and must not acquire one.** See §D of `NARRATIVE.md`: the POV itself has no outside source, LSAT Demon publicly argues the opposite, and a hairline here would invite the search that finds nothing. Quoting our own timer does not change that — it evidences *that we time a question*, which nobody disputes, not *that timing a question is right*, which is the claim.

## 9.3 `pov-strategy-inside-the-question` — the record, in counts

- **13 of 16 and 4 of 7** are the demo account's prompted and control attempts on `prephrase`, seeded by `backend/scripts/seed_demo.py`. They replaced **71% and 58%**, which were never measurements of anything: they are the worked example in an internal design document (`docs/superpowers/specs/2026-07-27-strategy-flow-simplification-design.md`, *"You get 71% right with it and 58% right without it"*), and somewhere between that spec and this deck they were read as data. **If either number reappears on a slide, it is a regression.**
- **The counts are printed rather than the percentages, and the product's own rule is why.** `backend/app/strategies.py` sets `PERCENTAGE_DISPLAY_MIN_SAMPLE = 30` and falls back to `13/16` below it, on the reasoning that a control sample of four can only ever read 0, 25, 50, 75 or 100 per cent. A pitch slide quoting a statistic the product itself refuses to display is the cheapest available way to lose a technical audience.
- **The bars are sized from the ratios** (0.8125 and 0.571), so the comparison still lands in one glance. The ratio is drawn; the number under it is one the room can check against the app.
- **The card is the app's `strategy-tip` section** from `frontend/src/case-flow.tsx`, down to both buttons. The refusal button is drawn on purpose: the control arm is made of the questions where a student pressed it.

---

# 10. Burnout — `pov-volume-burns`

Added 2026-08-13. This slide is the bridge after `pov-volume-is-the-constraint`: the volume that moves the score is the volume people cannot finish. **There is no LSAT-specific burnout RCT to headline.** Everything below is either already in this file, or the closest published number, labelled as such.

**On-screen credit** names the hours sources, RR 21-01's 51%, von der Embse 2018, and Putwain & Daly 2014. Spoken copy does not name papers.

| Claim the slide is allowed to support | Source | Exact finding | Caveat |
| --- | --- | --- | --- |
| Prep companies recommend 150–300 hours | Princeton Review, Blueprint, Kaplan — **§3.1 of this file** | Same numbers already on `problem-hours-and-price` | Recommendations, not measured study time |
| 51% never completed one practice exam | LSAC RR 21-01 — **§7** | *"About 51% of Khan users did not complete an LSAT practice exam."* n = 12,471 descriptive | Already on the previous slide; this slide is the *why* |
| High test anxiety is common | Putwain & Daly (2014), *Educational Studies* 40(5); Thomas et al. (2017). Huntley et al. (2022), *BMC Psychology* 10:6, cites ~25% of college students highly test-anxious | Recent reviews put high test anxiety at **15–22%** (Putwain & Daly; Thomas), ~**25%** in the college synthesis Huntley quotes | Not LSAT-specific. Do not say "LSAT students" |
| Test anxiety tracks lower scores on high-stakes tests | von der Embse, N. P., Jester, D., Roy, D., & Post, J. (2018). *Test anxiety effects, predictors, and correlates: A 30-year meta-analytic review.* **Journal of Affective Disorders 227, 483–493.** https://doi.org/10.1016/j.jad.2017.11.048 | 238 studies. Test anxiety negatively related to standardized tests, university entrance exams, and GPA. Reported range **r = −.13 to −.40** | Meta-analysis across ages and tests, not an LSAT sample |
| Cognitive test anxiety and SAT | Cassady, J. C., & Johnson, R. E. (2002). *Cognitive Test Anxiety and Academic Performance.* **Contemporary Educational Psychology 27, 270–295.** (often cited as 2004 in secondary sources; the journal issue is 2002) | n = 168 undergraduates. High CTA associated with self-reported SAT **1001** vs **1109** for low CTA | Association, self-reported SAT, small sample, not LSAT. Q&A only |
| LSAT/MCAT students were studied for exam stress | Frattaroli, J., Thomas, M., & Lyubomirsky, S. (2011). *Opening up in the classroom: Effects of expressive writing on graduate school entrance exam performance.* **Emotion 11(3), 691–706.** https://doi.org/10.1037/a0022946 | n = 104 (GRE 48, MCAT 38, **LSAT 15**). Expressive writing lowered pre-exam depressive symptoms; performance benefit in the LSAT/MCAT subgroup, not GRE | **n = 15 LSAT.** Too small to headline. Usable only as "this population was in the sample" |
| Law-student mental health | Organ, J. M., Jaffe, D. B., & Bender, K. M. (2016) and later LSAC-supported work (e.g. Flynn, Li & Sánchez) | Depression / anxiety symptoms in law school | **After admission, not LSAT prep.** Do not put on this slide. Q&A only, as the culture they are walking toward |

**What the slide must not say.** That a named study measured "LSAT burnout." That 51% dropped out of prep because of anxiety (RR 21-01 does not say why). That 150–300 hours were observed. That gamification has been shown to prevent burnout — `game-by-design` is the delivery loop, not a clinical claim.

**`pov-virtual-currency` was removed in Revision 11.** Dicheva et al. (2023) stays in §6 for Q&A. Do not put the 1.3× / 2.5× / 3.7× multiples back on a slide.

---
