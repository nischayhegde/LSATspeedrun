import type { SlideSpec } from './types'

/**
 * THE SLIDE REGISTRY
 *
 * This cut follows `deck/Lawyer Tycoon .pptx`, including its embedded speaker
 * notes. The original pitch is the content authority: this file keeps the web
 * deck's visual system, transitions, and live-product framing, but does not add
 * claims, positioning, or evidence that were absent from that presentation.
 *
 * The twelve beats correspond directly to the twelve original slides:
 * title, spiky POV, goal, six product/game beats, differentiation, and Q&A.
 */
export const SLIDES: readonly SlideSpec[] = [
  {
    id: 'title-lawyer-tycoon',
    section: 'title',
    kind: 'title',
    headline: 'Lawyer Tycoon',
    deck: 'The LSAT speedrun app.',
    pull: 'Alan Abraham · Nischay Hegde · UT Austin',
    notes:
      'We are Nischay and Alan, students at UT Austin, and this is Lawyer Tycoon — an LSAT speedrun app. The average student spends about four months studying for the LSAT. Our goal is to cut that timeline in half. ⟢ Open with the problem and the goal. Do not explain the product yet.',
    speaker: 'Nischay',
    budgetSeconds: 20,
    scene: { id: 'hero', framing: 'assemble' },
  },
  {
    id: 'spiky-point-of-view',
    section: 'thesis',
    kind: 'figure',
    field: 'beige',
    eyebrow: 'Spiky POV',
    headline: 'Practice and feedback are the efficient path.',
    deck: 'Repeatedly answer real questions. Get immediate feedback. Repeat.',
    points: ['Watching videos or studying concepts is inefficient.'],
    figure: { kind: 'claim-seal' },
    notes:
      'Our spiky point of view is that watching videos and learning concepts is inefficient. Practicing test-taking strategies on real questions, then receiving feedback, is the efficient way to improve. The average LSAT test taker scored 610 on SAT Reading; our view is that these students already have the general knowledge they need. What they need is practice. ⟢ Land the contrast: passive instruction versus repeated questions and feedback.',
    speaker: 'Nischay',
    budgetSeconds: 25,
    scene: { id: 'none', framing: 'still' },
    transition: 'letterbox',
  },
  {
    id: 'goal-faster-improvement',
    section: 'thesis',
    kind: 'statement',
    eyebrow: 'The goal',
    headline: 'Faster LSAT improvement. Same study time.',
    deck: 'A tighter learning loop makes every session count.',
    points: [
      'Targeted practice questions',
      'Immediate feedback on reasoning',
      'Strategies inside each question',
      'Adaptive question selection',
      'Mock exams when time allows',
      'An optional tycoon loop',
    ],
    notes:
      'Popular LSAT apps such as 7Sage and LSAT Lab can put more than forty percent of study time into live or video instruction on concepts. We redirect that time into targeted practice and immediate feedback on the student\'s reasoning. We suggest a specific strategy during each question and provide the interface to apply it. The next questions and strategies adapt to past accuracy. Mock exams are available when a student can set aside the time, and the game loop is optional for students who want an extra motivation boost. ⟢ This is the product overview. Keep each feature to one sentence; the next slides show the details.',
    speaker: 'Nischay',
    budgetSeconds: 35,
    scene: { id: 'counsel-stage', framing: 'spot' },
    transition: 'cut',
  },
  {
    id: 'demo-mcq-and-justification',
    section: 'product',
    kind: 'demo',
    eyebrow: 'Product walkthrough · 01',
    headline: 'MCQ and justification.',
    notes:
      'Here is the multiple-choice flow. First, we suggest a relevant test-taking strategy. Each strategy has a custom interface that asks the student to use it. Then the student answers the multiple-choice question and writes an explanation for the choice. ⟢ Let the strategy card, answer choice, and written explanation do the visual work. Do not read the question aloud.',
    speaker: 'Alan',
    budgetSeconds: 22,
    scene: { id: 'none', framing: 'still' },
    transition: 'letterbox',
    demo: {
      route: '{autoplay}',
      still: 'demo-case-answered.webp',
      width: 1440,
      zoom: 0.96,
      budgetSeconds: 22,
      context: 'Context A',
      clickPath: [
        { start: 0, end: 5, action: 'HANDS OFF. Let the suggested strategy arrive and the choices remain locked.' },
        { start: 5, end: 12, action: 'Watch the strategy gate: prediction first, then the question.' },
        { start: 12, end: 18, action: 'Let the written justification appear.' },
        { start: 18, end: 22, action: 'The answer is selected and submitted with the explanation.' },
      ],
      skip: ['reading the question or answer choices aloud', 'the client and fee line', 'touching the keyboard or mouse'],
      staging: 'The staged case drives itself. The presenter narrates the strategy, answer, and written justification without touching the app.',
    },
  },
  {
    id: 'demo-feedback-every-question',
    section: 'product',
    kind: 'demo',
    eyebrow: 'Product walkthrough · 02',
    headline: 'Feedback on every question.',
    notes:
      'After every question, an LLM follows a grading rubric and explains what was correct or incorrect in the student\'s reasoning. It also shows the proper reasoning for the problem. Students can return to feedback from past questions in the dashboard. ⟢ Pause on the coaching panel. Let the audience read it before advancing.',
    speaker: 'Alan',
    budgetSeconds: 20,
    scene: { id: 'none', framing: 'still' },
    transition: 'cut',
    demo: {
      route: '{autoplay}',
      still: 'demo-case-answered.webp',
      width: 1440,
      zoom: 0.96,
      budgetSeconds: 20,
      context: 'Context A, continuing',
      continuesFrom: 'demo-mcq-and-justification',
      clickPath: [
        { start: 0, end: 8, action: 'Hold on the verdict and the grading-rubric feedback.' },
        { start: 8, end: 20, action: 'Let the audience read the reasoning feedback. Advance when the panel has landed.' },
      ],
      skip: ['replaying the answer sequence', 'opening another question', 'touching the keyboard or mouse'],
      staging: 'This slide continues the same driven case and holds on its stored feedback.',
    },
  },
  {
    id: 'demo-adaptive-selection',
    section: 'product',
    kind: 'demo',
    eyebrow: 'Product walkthrough · 03',
    headline: 'Adaptive questions and strategies.',
    notes:
      'Questions and strategies are personalized using spacing and interleaving. Question types a student misses appear more often, and strategies the student performs better with are prompted more often. The system covers more than ten question-type buckets and fourteen high-yield strategies. That is how we move beyond a basic question bank or recommendation list. ⟢ Point to the weak areas and the strategy record; do not enumerate every type or strategy.',
    speaker: 'Alan',
    budgetSeconds: 25,
    scene: { id: 'none', framing: 'drift' },
    transition: 'cut',
    demo: {
      route: '/progress',
      still: 'demo-progress.webp',
      width: 1440,
      zoom: 0.94,
      budgetSeconds: 18,
      context: 'Context A',
      clickPath: [
        { start: 0, end: 8, action: 'Show the performance breakdown and the question types that need work.' },
        { start: 8, end: 18, action: 'Show how the record informs the next questions and strategy prompts.' },
      ],
      skip: ['reading every dashboard metric', 'changing filters', 'opening the answer log'],
      staging: 'Use the seeded dashboard. The slide is a short explanation of adaptive selection, not a dashboard tour.',
    },
  },
  {
    id: 'demo-office-treasury',
    section: 'game',
    kind: 'demo',
    eyebrow: 'Product walkthrough · 04',
    headline: 'Upgrade your firm with virtual currency.',
    notes:
      'The game is optional; the adaptive practice system works without it. In the game, the student starts as a new attorney and uses virtual currency to expand the firm and increase its income. Practice is what earns visible progress: the game never gates the questions; the questions gate the game. ⟢ Let the purchase and the office update happen before explaining the inversion.',
    speaker: 'Alan',
    budgetSeconds: 20,
    scene: { id: 'none', framing: 'still' },
    transition: 'cut',
    demo: {
      route: '/firm?tab=decor&deckDemo=treasury',
      still: 'demo-firm.png',
      width: 1440,
      zoom: 1,
      budgetSeconds: 12,
      context: 'Context A',
      clickPath: [
        { start: 0, end: 4, action: 'The cursor purchases an office upgrade with virtual currency.' },
        { start: 4, end: 12, action: 'Cash drops and the purchased object appears in the office. Hold.' },
      ],
      skip: ['the rest of the catalog', 'staff hiring', 'opening the dashboard', 'changing tabs by hand'],
      staging: 'The seeded treasury loop purchases an affordable upgrade, then returns to the office to show the result.',
    },
  },
  {
    id: 'game-research-backed',
    section: 'game',
    kind: 'figure',
    field: 'beige',
    eyebrow: 'The evidence',
    headline: 'Our game is research-backed.',
    deck: 'Virtual currency raised out-of-class practice 1.3× to 3.7× per student across three semester-long university studies.',
    credit: 'Dicheva et al. (2023), Trends in Higher Education 2(3) · 171 students · three universities · quasi-experimental',
    figure: { kind: 'numeral', value: '1.3×–3.7×', spin: 5 },
    notes:
      'A study across three semester-long university courses isolated virtual currency from the other game elements. Out-of-class practice rose from 1.3 times to 3.7 times per student. That is why our optional game loop uses currency: its job is to encourage the student to complete more practice. ⟢ Say “practice,” not “scores.” The study supports participation in out-of-class practice.',
    speaker: 'Alan',
    budgetSeconds: 25,
    scene: { id: 'none', framing: 'still' },
    transition: 'ink-bleed',
  },
  {
    id: 'demo-your-law-firm',
    section: 'game',
    kind: 'demo',
    eyebrow: 'Product walkthrough · 05',
    headline: 'Your law firm.',
    notes:
      'Upgrades change the look and feel of the law firm. As the student progresses, the office becomes more robust. The room is a visible record of how many LSAT questions the student has answered while using a proper strategy. ⟢ Hold on the office. Do not open menus; the environment is the point.',
    speaker: 'Alan',
    budgetSeconds: 15,
    scene: { id: 'none', framing: 'still' },
    transition: 'cut',
    demo: {
      route: '/office',
      still: 'demo-office.webp',
      width: 1440,
      zoom: 0.9,
      budgetSeconds: 12,
      context: 'Context A',
      clickPath: [
        { start: 0, end: 12, action: 'Hold on the live 3D office and let the visible upgrades carry the point.' },
      ],
      skip: ['client interactions', 'contracts and dockets', 'quests', 'story chapters', 'reputation'],
      staging: 'Open the seeded office and hold. This is an environment beat, not an interaction demo.',
    },
  },
  {
    id: 'demo-office-transformation',
    section: 'game',
    kind: 'demo',
    eyebrow: 'Product walkthrough · 06',
    headline: 'Progress to higher-tier law firms and earn more.',
    notes:
      'The goal is to earn enough virtual currency to progress to the most expensive law firm. The game is paced to be completed in about two months if a student answers twenty questions correctly each day. ⟢ Say the first sentence over the starting office. Then stop talking and let the room transform.',
    speaker: 'Alan',
    budgetSeconds: 18,
    scene: { id: 'none', framing: 'still' },
    transition: 'camera',
    demo: {
      route: '/office?officeTier=0',
      still: 'demo-office-tier0.webp',
      stillOnly: true,
      toggle: {
        route: '/office?officeTier=14&officeAll=1',
        still: 'demo-office-tier14.webp',
        key: 'o',
        label: 'tier 14 — the built firm',
      },
      width: 1440,
      zoom: 1.06,
      budgetSeconds: 12,
      context: 'Context A, two pre-staged save states',
      clickPath: [
        { start: 0, end: 3, action: 'Tier 0 office. Establish the starting point.' },
        { start: 3, end: 9, action: 'The deck automatically transforms the room to tier 14. Say nothing.' },
        { start: 9, end: 12, action: 'Hold on the completed firm.' },
      ],
      skip: ['naming individual upgrades', 'staff hiring', 'the intermediate tiers'],
      staging: 'The slide uses the captured tier-0 and tier-14 offices so the before/after remains reliable without the app stack.',
    },
  },
  {
    id: 'why-lawyer-tycoon',
    section: 'close',
    kind: 'statement',
    field: 'blue',
    eyebrow: 'Why Lawyer Tycoon',
    headline: 'Why Lawyer Tycoon is better than the rest.',
    deck: 'We cut down the bloat and keep the student moving through the work that matters.',
    points: [
      'Only the practice that matters',
      'One singular focus',
      'Question choices made for the student',
      'Motivation to keep practicing',
    ],
    notes:
      'Lawyer Tycoon focuses on the work that matters most: practice problems. Removing a large video and live-instruction layer also reduces our overhead. Instead of asking students to choose comfortable question types, the system targets the areas where they struggle. Finally, the optional game loop gives students another reason to keep answering questions. Our bet is simple: more of the same study time should go into targeted practice, because that is what can drive faster improvement. ⟢ This is the synthesis. Name the four differences once and do not introduce a new claim in the close.',
    speaker: 'Nischay',
    budgetSeconds: 30,
    scene: { id: 'none', framing: 'still' },
    transition: 'letterbox',
  },
  {
    id: 'thanks-and-questions',
    section: 'close',
    kind: 'statement',
    eyebrow: 'Lawyer Tycoon',
    headline: 'Thanks for listening.',
    deck: 'LSAT prep, reimagined.',
    pull: 'Questions?',
    notes:
      'Thank you for listening. We are happy to take your questions. ⟢ Hold this slide for the full Q&A.',
    speaker: 'Nischay',
    budgetSeconds: 10,
    scene: { id: 'close-room', framing: 'wide' },
    transition: 'foil-seal',
  },
]

export const SECTION_LABELS: Record<SlideSpec['section'], string> = {
  title: 'Lawyer Tycoon',
  problem: 'The Problem',
  thesis: 'The Goal',
  product: 'Product Walkthrough',
  game: 'The Game',
  close: 'Why Lawyer Tycoon',
}

export const TOTAL_BUDGET_SECONDS = SLIDES.reduce(
  (sum, slide) => sum + (slide.budgetSeconds ?? 45),
  0,
)

export const DEMO_BUDGET_SECONDS = SLIDES.reduce(
  (sum, slide) => sum + (slide.demo && !slide.demo.stillOnly ? slide.demo.budgetSeconds ?? 0 : 0),
  0,
)
