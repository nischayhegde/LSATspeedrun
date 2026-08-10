/**
 * Q&A ammunition — §G of `deck/NARRATIVE.md`, as data.
 *
 * The close is held on screen for the whole question period, so the presenter is
 * looking at a static slide while being asked things. This is what they can pull
 * up behind it on `Q`.
 *
 * Every answer here is written to be *said*, not read: two or three sentences,
 * the load-bearing number first, and the concession volunteered rather than
 * conceded. Where the narrative's answer carried an extra qualification that
 * would make a spoken reply too long, it has been split into `caveat` — which is
 * material the presenter should offer before a hostile questioner reaches for it,
 * not material to hide.
 *
 * Order is not alphabetical and is not arbitrary. The five competitive entries
 * come first because they are the likeliest questions and, until Revision 4, the
 * deck had no answer to any of them — `lsat-demon` most of all. A presenter
 * scanning this panel under pressure should hit the competitor answers before
 * anything else.
 */

export type QaTopic =
  | 'pricing'
  | 'competitors'
  | 'evidence'
  | 'sourcing'
  | 'ai'
  | 'gamification'
  | 'measurement'
  | 'pedagogy'
  | 'product'
  /** Defensibility. One entry, and it is the one an investor asks. */
  | 'moat'

export type QaEntry = {
  id: string
  question: string
  /** Two to three sentences. The spoken answer. */
  answer: string
  /** The qualification to volunteer first, where the narrative supplies one. */
  caveat?: string
  topics: QaTopic[]
  /** Primary sources, for the questioner who wants to look it up themselves. */
  sources?: string[]
}

export const QA: readonly QaEntry[] = [
  // ── The competitive block ──────────────────────────────────────────────────
  //
  // First in the list because these are the questions most likely to be asked
  // and the ones the deck had no answer for until Revision 4. `lsat-demon` is
  // the single most important entry here: Demon's public thesis is the closest
  // in the market to ours, so a weak answer makes the whole spiky-POV section
  // look like a repackaging of someone else's argument. Lead with the sharpest
  // true difference, concede the overlap out loud, and do not caricature them —
  // an accurate account of a strong competitor is worth far more in the room
  // than a dismissive one. Every figure is verified 2026-08-10 and sourced cell
  // by cell in §4 of `deck/CITATIONS.md`.
  {
    id: 'lsat-demon',
    question: 'How are you different from LSAT Demon?',
    answer:
      "Demon is the closest thing to us in this market and they're right about the big thing — drill official "
      + 'questions, stop watching lectures. The difference is inside the rep: their feedback is Ben and Nathan\'s '
      + 'pre-written explanation of the question, the same one every student sees, plus a human tutor\'s reply within '
      + '24 hours if you hit Ask; ours makes you write your reasoning before anything is revealed and then grades that '
      + 'writing against a rubric, so the feedback is about your argument rather than about the question. '
      + 'The second difference is that we measure — one named method prompted inside the question, tested against a '
      + 'hidden control arm of your own unprompted attempts, where their stated position is that there are no methods '
      + 'worth teaching: no diagrams, no jargon.',
    caveat:
      'Volunteer all four concessions before anyone reaches for them. They got to the drilling thesis first. Their '
      + 'retention engine is Ben and Nathan personally — live classes seven days a week, seven podcast episodes a '
      + 'week, a free Discord — and that is a real moat we do not have. Their Smart Drilling targets weaknesses the '
      + 'same way ours does, so adaptive selection is not our differentiator. And they tell students to hide the '
      + 'clock while we time everything, which is a disagreement rather than a gap. Tiers are $99 / $179 / $499.',
    topics: ['competitors', 'product', 'pedagogy'],
    sources: [
      'https://lsatdemon.com/plans/lsat',
      'https://lsatdemon.com/resources/frequently-asked-questions/why-lsat-demon',
      'https://lsatdemon.com/resources/demon-daily/the-purpose-of-drilling',
      'deck/CITATIONS.md §4.2',
    ],
  },
  {
    id: 'demon-ignore-the-clock',
    question: 'Demon tells students to ignore the clock. You time every question. Who is right?',
    answer:
      "Both, about different objects. Their advice is about the learning phase, and we don't disagree that rushing "
      + "while you're still building accuracy teaches you to misread — that is exactly why our full-length forms are "
      + 'optional and why blind review is untimed. What we time is the individual question against its target pace, '
      + 'and we report pace adherence as its own number beside accuracy rather than as one blended verdict, '
      + 'so a student can see that they are accurate and slow. That is a diagnosis. '
      + '"Get faster" and "slow down" are both advice given without one.',
    caveat:
      'Do not win this one by mocking it. Demon argues its side well and a lot of the room may believe it. '
      + 'The concession that costs nothing: on their own terms, for a beginner, they are probably right.',
    topics: ['competitors', 'pedagogy', 'measurement'],
    sources: ['https://lsatdemon.com/resources/demon-daily/the-purpose-of-drilling', 'deck/CITATIONS.md §4.2'],
  },
  {
    id: 'why-not-kaplan-or-7sage',
    question: 'Why would a student not just use Kaplan or 7Sage?',
    answer:
      'Kaplan is a course — about $900 for on-demand up to about $4,000 for the bootcamp — and what you are buying is '
      + 'instruction hours — a couple of dozen of live class plus a whole channel of lessons on demand — '
      + "which is precisely the thing LSAC's own survey "
      + 'valued at 0.22 points. 7Sage is the harder comparison and it is genuinely good: $69 a month, 900 video '
      + 'lessons, real analytics. But its shape is still a video curriculum, and its AI is one you can ask about a '
      + 'question you are stuck on, which is the interaction Bastani measured — better practice grades, then about 17% '
      + 'worse on the real thing. Neither one asks you to write down why, and neither one grades it.',
    caveat:
      'Both are cheaper than Kaplan and both are good products; the attack is on the shape, not the quality. '
      + 'And every one of them, plus Blueprint, PowerScore and Demon, costs $124 a year to LSAC for LawHub on top — '
      + "Blueprint's own blog says it is required \"no matter which third-party LSAT prep service you choose.\"",
    topics: ['competitors', 'pricing', 'ai'],
    sources: [
      'https://www.kaptest.com/lsat',
      'https://7sage.com/self-study/pricing',
      'https://blog.blueprintprep.com/lsat/what-is-lsat-prep-plus/',
      'deck/CITATIONS.md §4.3, §4.6',
    ],
  },
  {
    id: 'free-lsac-and-khan',
    question: 'Why would a student pay you instead of using the free LSAC material, or Khan Academy?',
    answer:
      'Khan Academy is the wrong half of that question — the LSAC partnership ended on 30 June 2024 and the whole '
      + 'library moved to LawHub, so there is no Khan Academy LSAT course any more. What is left is the right half, '
      + "and it is a fair question: LSAC's free tier now carries those hundred-odd lessons and articles. "
      + 'They are instruction — videos, articles, worked examples — with nothing that picks your next question, '
      + 'nothing that reads what you wrote, and nothing that brings you back tomorrow. '
      + 'It is the purest version of the thing slide two measures.',
    caveat:
      'Never say "Khan Academy offers free LSAT prep" in the present tense; anyone who has looked in two years knows '
      + 'it does not. And concede that a disciplined student genuinely should start on the free LawHub tier — '
      + 'the argument is about what happens after their first hundred questions, not before them.',
    topics: ['competitors', 'pedagogy', 'pricing'],
    sources: [
      'https://www.lsac.org/blog/khan-academy-lsat-test-prep-resources-coming-lsacs-lawhub-june-2024',
      'https://app.lawhub.org/article/redesigned-official-lsat-preptests-available-now',
      'deck/CITATIONS.md §4.8',
    ],
  },
  {
    id: 'copy-the-game-loop',
    question: 'What if a competitor copies your game loop?',
    answer:
      'They can, and they should — the game is the most copyable thing we have. A tier ladder and a currency is a few '
      + 'months of work for anyone with a spare 3D artist. What is not copyable is what the loop is bolted to: '
      + 'the currency only pays out on a graded written explanation and a confidence-rated attempt, '
      + 'and a company whose product is a video library has no such event to attach a coin to. '
      + 'The thing we would actually defend is the method experiment — every prompted attempt runs against a hidden '
      + "control of that student's own unprompted ones, so the longer someone studies, the more we know about which "
      + 'techniques work for which kind of student. That compounds. An art style does not.',
    caveat:
      'Concede the copyability first and fast. Claiming a tycoon game is defensible is the answer that loses the room; '
      + 'claiming the data underneath it is defensible is the one that survives a follow-up.',
    topics: ['moat', 'gamification', 'product'],
  },
  // ── Everything else ────────────────────────────────────────────────────────
  //
  // `question-provenance` sits first here, immediately after the competitive
  // block, because it is the hostile question the deck itself invites: we spend
  // slide 3 on LawHub's $124/year and then put a question bank on screen. The
  // answer is calm and specific on purpose. A founder who names the source and
  // the open item sounds like they have done the work; one who is caught
  // claiming a license they do not hold loses the room.
  {
    id: 'question-provenance',
    question: 'Where do your questions come from, and are they licensed?',
    answer:
      'Straight answer: 6,886 questions — 4,520 Logical Reasoning and 2,366 Reading Comprehension — pulled from '
      + 'publicly available released LSAT material, pinned as a checksummed snapshot so every student sees the same '
      + 'verified bank rather than something a model wrote. We are not claiming an LSAC license and we do not need one '
      + 'to run what you just saw. Confirming the dataset terms and the content rights is on our list before we charge '
      + 'anyone, and we would rather resolve that now than discover it at launch.',
    caveat:
      'Never say "official questions" — in this market that word means LSAC-licensed content through LawHub, and it is '
      + 'the one claim in the deck a lawyer in the room can falsify. Say "real questions from publicly released exams." '
      + 'If pressed on the LawHub comparison: our students do not pay the $124 today, and if licensing turns out to be '
      + 'the right route we would price it in and say so.',
    topics: ['sourcing', 'product', 'pricing'],
    sources: [
      'https://huggingface.co/datasets/tasksource/lsat-lr',
      'https://huggingface.co/datasets/tasksource/lsat-rc',
      'backend/data/question_bank/manifest.json',
      'deck/CITATIONS.md §4.9 item 10',
    ],
  },
  {
    id: 'competitor-pricing',
    question: "Where do your numbers about our competitors' pricing come from?",
    answer:
      'Their own pricing pages, checked this week: 7Sage is $69 a month for Core, $129 for Live and $299 for Coach, '
      + 'and LSAT Lab runs a free tier, $65 for Premium, $125 for Classroom and $425 for Tutor. '
      + 'For the rest of the field it is LSAT Demon at $99 to $499, PowerScore at $99 a month or $995 for a live '
      + 'course, and Kaplan from about $900 to about $4,000. '
      + 'The part people miss is LawHub Advantage at $124 a year, paid to LSAC on top of any of them, '
      + 'because that is the only legitimate route to official questions.',
    caveat:
      'Say the discounts before someone accuses you of cherry-picking. LSAT Lab bills annually at about 30% off; '
      + "7Sage's page shows monthly only, so do not extend the annual claim to them. Every company here discounts on "
      + 'an LSAC fee waiver, some steeply — 7Sage to $1 a month, LSAT Lab to 50% off. '
      + '7Sage was also promoting a $79 first month on Live as of 2026-08-10.',
    topics: ['pricing', 'competitors'],
    sources: [
      'https://7sage.com/self-study/pricing',
      'https://www.lsatlab.com/pricing',
      'https://lsatdemon.com/plans/lsat',
      'https://powerscore.com/lsat/courses',
      'https://www.lsac.org/lawhub',
    ],
  },
  {
    id: 'hours-are-marketing',
    question: "Your 250-hour figure is marketing, isn't it?",
    answer:
      "Yes, and that's the point. Nobody has measured how long students actually study; every number in circulation "
      + 'is a prep company\'s own recommendation — Princeton Review says 250 to 300 hours, Blueprint 200 to 300, '
      + 'Kaplan 150 to 300, and LSAC declines to give a figure at all. '
      + 'So the industry is advertising a 250-hour commitment and billing monthly across it. We are quoting them, not estimating.',
    topics: ['competitors', 'sourcing'],
    sources: [
      'https://www.princetonreview.com/law-school-advice/how-long-should-you-study-for-the-lsat',
      'https://blog.blueprintprep.com/lsat/how-long-should-you-study-for-the-lsat-3/',
      'https://www.kaptest.com/study/lsat/how-many-hours-of-lsat-prep/',
    ],
  },
  {
    id: 'how-many-points',
    question: "How many points does a student actually gain? 'A few' is vague.",
    answer:
      'Deliberately, because no published source measures gains from a diagnostic to a final score, '
      + 'and the 10 to 20 points prep companies advertise is what they are selling. '
      + "The only hard number is LSAC's retake data: about 2.8 points on a second sitting and 2.2 more on a third, "
      + 'which measures the gap between administrations rather than the effect of any method. '
      + 'We would rather say "a few" than invent a number.',
    topics: ['evidence', 'measurement'],
    sources: ['LSAC TR 14-01', 'https://www.lsac.org/lsat/retaking-the-lsat'],
  },
  {
    id: 'does-the-game-help',
    question: 'Does the game actually help, or does it just entertain?',
    answer:
      "Honestly, the evidence for gamification is real but modest: Sailer and Homner's meta-analysis puts the cognitive "
      + 'effect around 0.49 and the behavioral effect around 0.25, and only the cognitive one stayed stable under the more '
      + 'rigorous studies. That is why the game is a layer and not the product, why it can be switched off entirely, '
      + 'and why we plan to test the currency loop against a non-gamified control rather than assume it works.',
    topics: ['gamification', 'evidence'],
    sources: ['Sailer & Homner, meta-analysis', 'Meng et al.', 'Clark et al., 69 samples / 6,868 participants'],
  },
  {
    id: 'llm-grader',
    question: 'Isn\'t your LLM grader unreliable?',
    answer:
      'Yes, and we designed around that. Lee and colleagues scored 1,650 student explanations and found even a '
      + 'well-prompted GPT-4 with a rubric and examples lands short of perfect accuracy, so the model never determines '
      + 'whether you got the question right — that comes from the verified answer key. '
      + 'It grades the reasoning as a formative signal for which feedback you see, calibrated against scored examples. '
      + 'A coach, not a judge.',
    topics: ['ai', 'measurement', 'product'],
    sources: ['Lee et al., 1,650 scored student explanations'],
  },
  {
    id: 'score-projection',
    question: 'Why should I trust your score projection?',
    answer:
      "We don't give one. The app explicitly withholds a scaled 120–180 score until the question set has a validated "
      + 'conversion, because faking that number from an unvalidated form would be the easiest and least honest thing we '
      + 'could do. What we report is accuracy, pace, reasoning quality and confidence calibration, '
      + 'each labeled with how much evidence sits behind it.',
    topics: ['measurement', 'product'],
  },
  {
    id: 'anki-with-a-skin',
    question: 'Aren\'t you just Anki with a skin?',
    answer:
      'Anki schedules recall of facts, and the LSAT has no facts to recall. '
      + 'Our repair queue is triggered by reasoning failures rather than forgetting curves: a confident miss, '
      + 'a lucky guess, a correct answer that took too long. '
      + 'And the scheduler is a trained model rather than fixed boxes, which is the difference Settles and Meeder measured '
      + 'as a 45-percent-plus reduction in recall error over a Leitner system.',
    topics: ['product', 'measurement'],
    sources: ['Settles & Meeder, half-life regression at Duolingo scale'],
  },
  {
    id: 'students-who-need-instruction',
    question: 'What about students who genuinely need conceptual instruction?',
    answer:
      "Some do, and we're not claiming instruction is worthless — what the evidence says is that it can't be the core. "
      + "LSAC's own survey found coaching-course users scored 0.22 points above nonusers while people who worked real "
      + 'LSATs scored 2.77, and LSAC describes the exam as a test of skills rather than a body of knowledge, '
      + 'so there is no syllabus to teach. Where a student needs a technique, we give them one method at the point of use '
      + 'and then measure whether it worked for them.',
    topics: ['pedagogy', 'evidence'],
    sources: ['LSAC, Wightman, RR 90-01', 'LSAC, "LSAT Prep"'],
  },
  {
    id: 'nothing-to-teach-vs-strategies',
    question: 'You said there\'s nothing to teach, then you showed fourteen strategies. Which is it?',
    answer:
      'Both. There is no content — no prerequisite body of subject-matter knowledge, which is LSAC\'s own framing of '
      + 'their exam — and there are techniques, which matter. '
      + 'The difference is that a technique takes ten seconds to state and only becomes useful when it is practiced '
      + 'inside a real question, which is why ours arrive as a one-line brief on the question screen '
      + 'rather than as a course you complete first.',
    caveat: 'For the record: fourteen are in the catalog and thirteen are currently in rotation. Never claim all fourteen are being trialed.',
    topics: ['pedagogy', 'product'],
  },
  {
    id: 'survey-from-1989',
    question: 'Why is a 1989 survey relevant in 2026?',
    answer:
      'Because it is the largest thing of its kind, it is published by the organization that writes the test, '
      + 'and the format change since then made it more relevant rather than less: the sections it covered are the '
      + 'sections that remain. It has real limits, which we say on the slide — self-reported, non-randomized, '
      + 'respondents skewed slightly younger and higher-scoring than nonrespondents, '
      + 'and most people used several methods at once. It is an association, not a causal proof.',
    topics: ['sourcing', 'evidence'],
    sources: ['LSAC Research Report RR 90-01', 'https://eric.ed.gov/?id=ED468954'],
  },
  {
    id: 'logic-games-out-of-date',
    question: "Aren't your competitors' courses out of date now that logic games are gone?",
    answer:
      "Careful, and we'd rather be precise here than land a cheap shot: 7Sage and LSAT Lab have both publicly updated "
      + 'their curricula for the post-August-2024 format. What is true is that the wider back catalog of LSAT content, '
      + 'including a great deal of what students find when they search, still teaches a section that last appeared in '
      + 'June 2024. Our question bank is Logical Reasoning and Reading Comprehension only, which is the test as it exists.',
    topics: ['competitors', 'sourcing'],
    sources: ['LSAC TR 26-01'],
  },
  {
    id: 'ai-evidence-transfers',
    question: 'Your AI evidence is Harvard physics undergraduates. Why does it transfer to the LSAT?',
    answer:
      "It's a fair limit and we'd flag it before you did: Kestin's trial was a small, non-representative Harvard sample "
      + 'in physical sciences. That is why we lean harder on Bastani, which ran with about a thousand students in '
      + 'ordinary high-school classrooms and measured the failure mode rather than the win. '
      + 'Both point at the same design rule, and it is a rule about the interaction rather than the subject: '
      + 'require an attempt, give hints not solutions, stay anchored to a verified key.',
    topics: ['ai', 'evidence'],
    sources: ['Bastani et al., ~1,000 students', 'Kestin et al.'],
  },
]

/** Every topic present in `QA`, in first-appearance order. For a filter row. */
export const QA_TOPICS: readonly QaTopic[] = Array.from(
  new Set(QA.flatMap((entry) => entry.topics)),
)
