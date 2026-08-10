import type { SlideSpec } from './types'

/**
 * THE SLIDE REGISTRY — ordered, data-driven, and holding the FINAL COPY.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHERE THE WORDS COME FROM
 * ══════════════════════════════════════════════════════════════════════════
 *  Every headline, deck, point, pull, credit and speaker note below is the
 *  approved copy from `deck/NARRATIVE.md` (Revision 4), which is the source of
 *  truth. If the two ever disagree, the narrative is right and this file is
 *  stale. `deck/CITATIONS.md` is the fact-check behind the numbers, and it
 *  still refers to two slides by their pre-revision ids — `turn-610-reader` is
 *  now `turn-nothing-to-teach`, and `problem-200-hours` is now
 *  `problem-hours-and-price`.
 *
 *  Revision 4 changed exactly one slide: `pov-reasoning-is-the-work` gained a
 *  fourth fragment and one sentence of notes, which together are the deck's
 *  whole on-stage competitive positioning. The rest of it is off the clock, in
 *  the narrative's §G and in `CITATIONS.md` §4 — and in `notes/qa.ts`, which is
 *  where the presenter actually reads it from. `budgetSeconds` did not move.
 *
 *  A writer owns exactly these fields per slide:
 *      eyebrow      the small line above the headline
 *      headline     the slide's one claim
 *      deck         one or two sentences under it
 *      points[]     the ledger rows
 *      pull         the single quotable line, where the layout uses one
 *      attribution  the citation for `pull`
 *      credit       the hairline source line in the corner of the slide
 *      notes        speaker notes (never shown to the audience)
 *      speaker      who says them — Alan or Nischay
 *
 *  A writer must NOT change: `id` (it is the deep link — `#/pov-real-clock` is
 *  a bookmark the presenter may already have), `section`, `kind`, `scene`,
 *  `demo`, or `transition`. Those are staging, and changing one silently
 *  re-choreographs the deck. The one time that rule was suspended was the
 *  Revision 3 reconciliation, when the slide set itself changed; it is back in
 *  force now.
 *
 *  Length matters and is not enforced by the layout. Aim for headlines of six
 *  to nine words, decks of under thirty, and at most five points. A headline of
 *  fifteen words will render — it will simply be small, and the `type`
 *  transition will take noticeably longer because it animates one glyph at a
 *  time. `dashboard-everything` is the one deliberate exception: the founders
 *  asked for all twelve dashboard signals on a single slide, and the `metrics`
 *  layout sets them as an index rather than as body copy.
 *
 *  The rule that keeps the deck lean: the founders carry the room by speaking.
 *  If a piece of narrative detail will not fit inside the length guidance, it
 *  belongs in `notes`, not on the slide.
 *
 *  `budgetSeconds` is taken from the narrative's timing table (§C) and sums to
 *  9:40. The seven demo slides also carry a hard budget inside `demo`, which is
 *  the number the presenter is held to — demo overrun is the founders' single
 *  biggest complaint about the previous deck, so every demo here has a written
 *  click path with per-beat seconds and an explicit skip list.
 * ══════════════════════════════════════════════════════════════════════════
 */
export const SLIDES: readonly SlideSpec[] = [
  // ═════════════════════════════ ACT I — THE BILL ════════════════════════════
  {
    id: 'title-lawyer-tycoon',
    section: 'title',
    kind: 'title',
    headline: 'Lawyer Tycoon',
    deck: 'The LSAT speedrun app.',
    pull: 'Alan Abraham · Nischay Hegde · UT Austin',
    notes:
      "Hi, we're Alan and Nischay from UT Austin, and we built Lawyer Tycoon. It's an LSAT prep app. "
      + 'Before we show you anything, we want to show you a number published by the people who write the LSAT.',
    speaker: 'Nischay',
    budgetSeconds: 16,
    scene: { id: 'hero', framing: 'assemble' },
  },
  {
    id: 'problem-coaching-tax',
    section: 'problem',
    kind: 'figure',
    field: 'blue',
    eyebrow: 'Act I — the bill',
    headline: 'Coaching moved scores 0.22 points.',
    deck: 'LSAC asked 46,301 of its own test takers how they prepared.',
    points: [
      '+0.22 took a coaching course',
      '+2.77 worked through real LSATs',
    ],
    // Two bars, nothing else. The coaching bar draws first and stops at a stub;
    // the real-LSAT bar draws slowly past it, and the gap is left empty. The two
    // shares then land on the bars in the opposite order, which is the argument:
    // nearly half bought the thing that did nothing.
    figure: {
      kind: 'bar-pair',
      bars: [
        {
          value: 0.22,
          label: 'took a coaching course',
          share: '45.5%',
          shareLabel: 'bought the course',
          stub: true,
        },
        {
          value: 2.77,
          label: 'worked through real LSATs',
          share: '34.9%',
          shareLabel: 'had ever finished a real test',
        },
      ],
      gapNote: 'more than ten times the return',
    },
    credit: 'LSAC, Wightman, RR 90-01 (1989 test takers), self-reported',
    notes:
      'In 1989, LSAC surveyed its own test takers, 46,301 of them, and asked what they actually did to prepare. '
      + 'People who took a coaching course scored 0.22 points higher than people who took nothing. '
      + 'People who worked through actual published LSATs scored 2.77 points higher. More than ten times the return. '
      + 'Now look at the behavior. Nearly half of them bought a course. Barely a third had ever finished a real test. '
      + "It's a survey, not an experiment, so that's an association. It's also the test maker's own data.",
    speaker: 'Nischay',
    budgetSeconds: 27,
    scene: { id: 'none', framing: 'still' },
    // The desk lamp on slide 1 brightens to a wash and blows the frame out to
    // beige; the two bars are already drawn when the exposure recovers.
    transition: 'ink-bleed',
  },
  {
    id: 'problem-hours-and-price',
    section: 'problem',
    kind: 'figure',
    field: 'blue',
    eyebrow: 'Act I — the bill',
    headline: '250 hours. A few points. Every month.',
    deck: 'The hours are their number. The bill is monthly for as long as you study.',
    points: [
      '900+ video lessons (7Sage)',
      '90-minute classes, five days a week (LSAT Lab)',
      '$65–$425 a month, plus $124 a year to LSAC',
    ],
    // LSAC's tick is deliberately left without a range: the test maker declines
    // to give a number, and the blank is more damning than a figure would be.
    // The outcome sliver at the far right is drawn at true relative proportion
    // against the hours, which is why it is almost invisible.
    figure: {
      kind: 'hours-bar',
      barLabel: '150–300 hours, by their own recommendation',
      ticks: [
        { at: 0.16, source: 'Kaplan', range: '150–300' },
        { at: 0.4, source: 'Blueprint', range: '200–300' },
        { at: 0.66, source: 'Princeton Review', range: '250–300' },
        { at: 0.88, source: 'LSAC' },
      ],
      outcome: 'a few points',
      curriculum: [
        '900+ video lessons — 7Sage',
        '90-minute classes, 5 days a week — LSAT Lab',
      ],
      price: '$65–$425 / month, for as long as you study',
      lateLineItem: '+ $124 / year to LSAC',
    },
    credit: 'Hours: Princeton Review · Blueprint · Kaplan — LSAC declines. Prices: 7Sage and LSAT Lab, verified 2026-08-10',
    notes:
      "And here's what that costs. The two-fifty figure isn't ours, it's theirs. "
      + 'Princeton Review, Blueprint and Kaplan all tell you to plan for somewhere between one-fifty and three hundred hours. '
      + 'Then look at what fills them. Nine hundred video lessons at 7Sage. '
      + 'Ninety-minute classes, five days a week, for three months at LSAT Lab. The product is instruction. '
      + "And it's a subscription the whole time, sixty-five to four hundred and twenty-five a month, "
      + "plus a hundred and twenty-four a year to LSAC for LawHub, because that's the only way to get real questions.",
    speaker: 'Nischay',
    budgetSeconds: 32,
    // The tall real-LSAT bar rotates flat and becomes this slide's horizontal
    // hours bar: one backdrop, two framings, so the stage tweens rather than cuts.
    scene: { id: 'none', framing: 'drift' },
    transition: 'camera',
  },

  // ═════════════════════════════ ACT II — THE TURN ═══════════════════════════
  {
    id: 'turn-nothing-to-teach',
    section: 'thesis',
    kind: 'figure',
    // Full inversion — royal blue to beige — and the only one in the first half
    // of the deck. Up to this moment the room holds the industry's premise, that
    // the student is under-taught. After it, the student is under-practiced.
    field: 'beige',
    eyebrow: 'Act II — the turn',
    headline: "Because there's nothing to teach.",
    deck: 'LSAC calls the LSAT "a test of skills," not a body of knowledge. The ABA requires a bachelor\'s degree.',
    // The hero object. It must read as the same extruded `0.22` the room saw
    // ninety seconds ago on `problem-coaching-tax` — same material, same rotation
    // rig — as though it had been dollied in. It is the only thing in frame with
    // weight: no chart, no annotation, and nothing moves for the first 700ms.
    //
    // `SKILLS` is the narrative's sanctioned alternative and is a one-word edit
    // here; it carries the same weight at the same scale and takes the same
    // transition out.
    figure: { kind: 'numeral', value: '0.22', spin: 8 },
    credit: 'LSAC, "LSAT Prep" · ABA Standard 502(a)',
    notes:
      'So why was coaching worth a fifth of a point? Because there\'s nothing to teach. '
      + "That's not our opinion, it's LSAC's: they describe their own exam as a test of skills, "
      + 'critical thinking applied to reading and reasoning. There is no syllabus. '
      + "And the ABA requires a bachelor's degree to enroll in law school, so everyone sitting for this test "
      + 'has already done four years of college-level reading. Techniques, yes. Content, no. '
      + "They're not missing concepts. They're missing reps, and feedback on how they think.",
    speaker: 'Nischay',
    budgetSeconds: 30,
    scene: { id: 'hero', framing: 'beam' },
    // The full inversion — royal blue to beige — and the only one in the first
    // half of the deck. It is an act break and it should feel like a light
    // coming on, so it gets the shutter.
    transition: 'letterbox',
  },
  {
    id: 'thesis-speedrun',
    section: 'thesis',
    kind: 'figure',
    field: 'beige',
    eyebrow: 'Act II — the thesis',
    headline: 'So skip to the questions.',
    deck: 'Minute one is question one. There is nothing to get through first.',
    points: [
      'Practice testing: rated highest',
      'Rereading: rated lowest',
      'No curriculum path',
    ],
    credit: 'Dunlosky et al. (2013), ten techniques rated',
    // The route ignores the first three nodes and cuts a hard diagonal to the
    // fourth. Under two seconds, and it does not loop.
    figure: {
      kind: 'route',
      nodes: [
        { label: 'intro course', skipped: true },
        { label: 'concept videos', skipped: true },
        { label: 'drill unlock', skipped: true },
        { label: 'first real question', skipped: false },
      ],
      timerLabel: 'speedrun',
    },
    notes:
      "That's what we mean by speedrun. We're not making studying faster by shortening videos, we're deleting the middle. "
      + 'Dunlosky and colleagues rated ten common study techniques and put practice testing and spaced practice at the top '
      + 'and rereading and highlighting at the bottom. So we build the whole product out of the top of that list. '
      + 'A student is on a real question inside a minute.',
    speaker: 'Nischay',
    budgetSeconds: 21,
    scene: { id: 'none', framing: 'low' },
    // The `0.22` rotates edge-on into a single vertical line, which becomes the
    // speedrun timer's progress track. The scene changes, so the deck-level move
    // stays quiet and lets the choreography carry it.
    transition: 'cut',
  },
  {
    id: 'pov-reasoning-is-the-work',
    section: 'thesis',
    kind: 'figure',
    field: 'beige',
    eyebrow: 'Act II — Spiky POV 01',
    headline: "Answering isn't studying. Explaining is.",
    deck: 'Answer-level feedback is worth d = 0.31. Step-level is 0.76. A human tutor is 0.79.',
    // The fourth fragment is the only sentence in the deck that compares us to
    // anybody, and it names nobody. It arrives alone, after the coaching panel
    // has finished underlining, in the same weight as the other three — the
    // whole point of putting the competitive claim here rather than on a
    // comparison slide is that by this moment the room has already accepted
    // VanLehn, so it reads as an inference rather than a boast. See §D of the
    // narrative for why there is no comparison table, and `CITATIONS.md` §4 for
    // the seven-product reference that backs it.
    points: [
      'Name the error',
      'Why yours was wrong',
      'Why the right one works',
      'They explain the question. We grade your explanation.',
    ],
    credit: 'VanLehn (2011), 87 comparisons · Zhang & Fiorella (2023)',
    // The emphasis moves: the five choices shrink and desaturate while the
    // reasoning box grows and takes the focus ring. The three effect bars draw
    // in sequence so the room sees the last two land at nearly the same length —
    // that near-equality is the whole slide, and it is also the pricing argument.
    figure: {
      kind: 'reasoning-card',
      stem: 'Which one of the following, if true, most weakens the argument above?',
      choices: [
        'The survey was conducted by an independent firm.',
        'Respondents chose for themselves whether to reply.',
        'The sample included students from every region.',
        'The results were published in a peer-reviewed journal.',
        'A similar survey reached the same conclusion.',
      ],
      reasoning:
        'I picked (B) because the argument assumes the respondents represent every test taker, '
        + 'and if people chose for themselves whether to reply, the ones who replied are not a random sample.',
      underline: 'the argument assumes the respondents represent every test taker',
      effects: [
        { value: 0.31, label: 'answer-level feedback' },
        { value: 0.76, label: 'step-level feedback', emphasis: true },
        { value: 0.79, label: 'a human tutor' },
      ],
    },
    notes:
      "If reps are what's missing, the question is what a rep should be. VanLehn compared 87 tutoring studies. "
      + 'Feedback on your answer is worth a third of a standard deviation; feedback on your steps is worth 0.76, '
      + 'and a human tutor is 0.79. '
      + "Step-level feedback gets you a tutor's result without a tutor's price. "
      + 'Zhang and Fiorella showed the prompt has to be structured, which beat a vague "explain this" by 0.62. '
      + 'Everyone else explains the question. We grade your explanation.',
    speaker: 'Nischay',
    budgetSeconds: 28,
    // The route line's endpoint expands into the outline of a question card: same
    // backdrop, new framing, continuous camera.
    scene: { id: 'none', framing: 'still' },
    transition: 'camera',
  },
  {
    id: 'pov-confidence-signal',
    section: 'thesis',
    kind: 'figure',
    field: 'beige',
    eyebrow: 'Act II — Spiky POV 02',
    headline: "Accuracy and time can't see understanding.",
    deck: 'A lucky guess and a confident miss look identical on a score report.',
    points: ['Rate 1–5, before the key.'],
    credit: 'Metcalfe (2017), the hypercorrection effect',
    // All four tiles carry the same plain mark, so they look interchangeable.
    // Then confidence drops onto each and they re-sort into four different
    // problems. The sort is the argument; it is over in under 1.5 seconds.
    figure: {
      kind: 'confidence-tiles',
      tiles: [
        { mark: 'correct', confidence: 5, category: 'mastered' },
        { mark: 'correct', confidence: 1, category: 'lucky guess' },
        { mark: 'wrong', confidence: 2, category: 'time-pressure miss' },
        { mark: 'wrong', confidence: 5, category: 'confident misconception', flagged: true },
      ],
    },
    notes:
      'And you can\'t tell whether someone understands something from whether they got it right and how long they took. '
      + 'Those four questions look the same on a score report and they are four different problems. '
      + 'So we take a confidence rating before the answer is revealed. '
      + 'Metcalfe found that high-confidence mistakes get corrected more successfully than low-confidence ones, '
      + 'because the surprise grabs your attention. A confident miss is our most valuable event.',
    speaker: 'Nischay',
    budgetSeconds: 20,
    scene: { id: 'none', framing: 'drift' },
    transition: 'cut',
  },
  {
    id: 'concept-lawyer-tycoon',
    section: 'thesis',
    kind: 'scene',
    eyebrow: 'Act II — the concept',
    headline: 'An LSAT engine inside a tycoon game.',
    deck: 'Adaptive practice on 6,886 LSAT questions, wrapped in an idle game that only moves when you do.',
    points: [
      'Answer, explain, get corrected',
      "You don't pick the questions",
      'The game is always optional',
    ],
    notes:
      "So that's Lawyer Tycoon. Underneath, an adaptive engine on 6,886 LSAT questions that demands your reasoning "
      + 'and coaches it. On top, entirely optional, an interactive game loop where you run a law firm, '
      + 'with an office you can actually see. We chose the most addictive genre on purpose, '
      + 'so a student losing motivation keeps answering questions. Two rules. '
      + "You don't choose which question types you get, because everybody drifts toward what they're already good at. "
      + 'And the game never gets to move your practice. Practice moves the game.',
    speaker: 'Nischay',
    budgetSeconds: 26,
    // The confident-misconception tile turns out to be a monitor on a desk in the
    // tier-6 office, and the camera keeps pulling back until the whole room is in
    // frame. Let it breathe two full seconds before any text lands.
    scene: { id: 'office', params: { tier: 6, full: true, floor: 'practice' } },
    transition: 'camera',
  },

  // ══════════════════ ACT III — HOW WE PROTECT IT (Alan takes over) ══════════
  {
    id: 'pov-ai-never-answers',
    section: 'product',
    kind: 'figure',
    field: 'blue',
    eyebrow: 'Act III — Spiky POV 03',
    headline: 'An AI that gives answers makes you worse.',
    deck: 'With unguarded ChatGPT, practice grades rose 48%. On the real exam, those students dropped 17%.',
    points: [
      'Attempt first',
      'Hints, never solutions',
      'One step at a time',
    ],
    credit: 'Bastani et al. (2024), ~1,000 students, field experiment',
    // The only slide in the deck permitted a moment of misdirection: the good
    // trace draws first and holds long enough for the room to start nodding.
    figure: {
      kind: 'traces',
      traces: [
        { label: 'practice, with unguarded ChatGPT', points: [0.5, 0.62, 0.74, 0.85, 0.93, 0.98], style: 'good' },
        { label: 'the real exam, once it was taken away', points: [0.5, 0.45, 0.4, 0.35, 0.31, 0.29], style: 'bad' },
        { label: 'a coach that gives hints, never answers', points: [0.5, 0.5, 0.49, 0.5, 0.5, 0.5], style: 'guarded' },
      ],
      baseline: 0.5,
      baselineLabel: 'students who never used AI',
    },
    notes:
      "I'll take it from here, and I want to start with the thing everyone else is shipping. "
      + 'Bastani and colleagues gave about a thousand students access to plain ChatGPT while they practiced. '
      + 'Practice grades went up 48 percent. Then they took it away for the real exam and those students scored '
      + 'about 17 percent worse than students who never used AI at all. '
      + 'The version that gave hints instead of answers left them level with the control. '
      + 'So our coach cannot show you anything until you have committed to an answer and written why.',
    speaker: 'Alan',
    budgetSeconds: 27,
    scene: { id: 'none', framing: 'still' },
    // Hand-off to Alan: the office dims to a single spotlight on the desk monitor
    // and the deck rotates back to royal blue. Act break.
    transition: 'letterbox',
  },
  {
    id: 'pov-strategy-inside-the-question',
    section: 'product',
    kind: 'figure',
    field: 'beige',
    eyebrow: 'Act III — Spiky POV 04',
    headline: 'Strategies get taught. They should get tested.',
    deck: 'One method, handed to you at the moment you need it, kept only if your own data says it works.',
    points: [
      '14 in the catalog',
      'One per question',
      'A/B tested against your own control',
    ],
    // The fourteen are the app's real catalog keys, in the app's own order.
    // `comparative_matrix` is in the catalog but unreachable today because the
    // dataset never marks comparative passages — say "fourteen in the catalog,
    // thirteen currently in rotation" if anyone presses, and never claim all
    // fourteen are being trialed. The one that survives the filter is
    // `prephrase`, which is also the method staged on the live demo case.
    figure: {
      kind: 'method-fan',
      methods: [
        'Argument core',
        'Prephrase',
        'Negation test',
        'Causal audit',
        'Conditional chain',
        'Flaw abstraction',
        'Scope precision',
        'Role map',
        'Passage map',
        'Viewpoint ledger',
        'Paragraph function',
        'Textual proof',
        'Comparative matrix',
        'Main point synthesis',
      ],
      keep: 1,
      lift: { prompted: 0.71, baseline: 0.58, note: 'this student, prompted vs. their own unprompted attempts' },
    },
    notes:
      'Every prep company sells a set of test-taking strategies and then leaves you alone with them. '
      + 'We think a strategy has to be practiced inside the question. '
      + 'So we suggest one relevant method per question out of fourteen, the whole screen is a scratchpad '
      + 'so you can run it on the text, and you have to tell us whether you used it. '
      + 'Then we compare your prompted attempts against your own unprompted ones.',
    speaker: 'Alan',
    budgetSeconds: 22,
    scene: { id: 'none', framing: 'drift' },
    transition: 'cut',
  },
  {
    id: 'pov-real-clock',
    section: 'product',
    kind: 'figure',
    field: 'beige',
    eyebrow: 'Act III — Spiky POV 05',
    headline: 'Every question is timed. Every exam is optional.',
    deck: 'The LSAT is a stamina test, but a busy student cannot sit a full form on a Tuesday.',
    points: [
      'Real pacing from day one',
      'Full form when you can',
      'Never required',
    ],
    // Two rings are the tension, stated visually: the per-question ring completes
    // and the frame holds still for a beat, then the full-form ring draws around
    // the whole frame and is deliberately left unfinished.
    figure: {
      kind: 'clock-rings',
      used: 0.82,
      target: 0.7,
      innerLabel: 'this question',
      outer: 0.38,
      outerLabel: 'a full form — always available, never required',
    },
    notes:
      'The LSAT mostly applies time pressure and tests stamina, so untimed practice teaches you to solve questions '
      + "in a way you'll never be allowed to solve them. "
      + 'Everything here runs against real per-question pacing from day one. '
      + "Full-length exams are the only way to train the stamina, and they're the thing our users have the least time for. "
      + "So they're always available and never required. The single question loop is the daily driver.",
    speaker: 'Alan',
    budgetSeconds: 21,
    scene: { id: 'none', framing: 'low' },
    transition: 'cut',
  },

  // ════════════════════════════ ACT IV — PROOF ═══════════════════════════════
  //
  // All four demo slides run one embedded live app iframe with deck chrome cut to
  // a hairline frame and the budget bar across the top. Two browser contexts are
  // pre-staged before the talk and neither is created live:
  //
  //   Context A — signed in at office tier 6, an active cases run already open on
  //     a Logical Reasoning question with a strategy brief attached, the reasoning
  //     field PRE-FILLED with a strong paragraph, no answer selected, no
  //     confidence set.
  //   Context B — the same account with a completed mega-litigation and its
  //     finished audit already on screen.
  //
  // Before the pitch, verify that no cash or fee counter animates while a
  // question is on screen. The game's rewards land before the question starts and
  // after it is answered, never inside it, and that claim is made out loud on
  // `game-never-gates`.
  {
    id: 'demo-case-answer',
    section: 'product',
    kind: 'demo',
    eyebrow: 'Act IV — proof',
    headline: 'One case, start to finish.',
    notes:
      'This is where students actually work, and these are real LSAT questions from publicly released exams. '
      + "Top of the screen is the one method we picked for this question, and I have to tell it whether I'm using it. "
      + 'The whole screen is a scratchpad, so I mark up the stimulus while I run the method. I pick my answer. '
      + 'Then this box, which is the part nobody else makes you do: I write why, in my own words, '
      + "before I'm allowed to see anything. "
      + 'Then confidence, one to five, because a confident miss and a lucky guess are different problems. Submit.',
    speaker: 'Alan',
    budgetSeconds: 56,
    scene: { id: 'none', framing: 'still' },
    // The unfinished outer ring of `pov-real-clock` snaps closed and becomes the
    // border of the live app frame. Demo mode begins.
    transition: 'letterbox',
    demo: {
      route: '/cases/{session}',
      still: 'demo-case.png',
      width: 1440,
      zoom: 1.12,
      budgetSeconds: 56,
      context: 'Context A',
      clickPath: [
        { start: 0, end: 7, action: 'Point at the strategy brief at the top of the question. Say its name. Do not read the three steps aloud.' },
        { start: 7, end: 13, action: 'Click **Use this brief**.' },
        { start: 13, end: 24, action: 'Drag-highlight exactly one clause in the stimulus with the scratchpad markup. One drag only.' },
        { start: 24, end: 31, action: 'Select answer choice (B).' },
        { start: 31, end: 41, action: 'Scroll the pre-filled reasoning into view. Read only its first sentence aloud. Do not type.' },
        { start: 41, end: 47, action: 'Click confidence 4.' },
        { start: 47, end: 56, action: 'Submit. Stop talking while the verdict stamp animates.' },
      ],
      skip: [
        'the passage tab switcher',
        'the per-question timer explanation',
        'the client and fee line',
        'reading any other answer choice',
        'the settlement numbers',
      ],
      staging:
        'No callout arrows and no zoom effects — the presenter\'s cursor is the pointer. '
        + 'The reasoning field is pre-filled by the seeder; typing it live costs about forty seconds the deck does not have.',
    },
  },
  {
    id: 'demo-case-verdict-review',
    section: 'product',
    kind: 'demo',
    eyebrow: 'Act IV — proof',
    headline: 'Then it tells you where you broke.',
    notes:
      'The model grades my reasoning, not my letter. Correctness comes from the verified answer key, never from the model, '
      + "and the model's job is to find the first place my logic broke and then walk the correct reasoning. "
      + "That's the step-level feedback from the VanLehn slide, running on every question. "
      + "And it isn't a popup that disappears. Every question I have ever answered is sitting in the dashboard "
      + 'with my reasoning and its feedback attached, so review means reviewing how I thought, not which letter I picked.',
    speaker: 'Alan',
    budgetSeconds: 38,
    scene: { id: 'none', framing: 'still' },
    // No slide change as far as the audience is concerned: the verdict stamp
    // lands and the title bar quietly relabels. 12 and 13 are one shot.
    transition: 'cut',
    demo: {
      route: '/progress',
      still: 'demo-progress.png',
      width: 1440,
      zoom: 1.06,
      budgetSeconds: 38,
      context: 'Context A, continuing',
      continuesFrom: 'demo-case-answer',
      clickPath: [
        { start: 0, end: 10, action: 'Read the verdict line and the score breakdown in one sentence. Do not itemize answer, explanation and time points.' },
        { start: 10, end: 22, action: 'Open the coaching panel. Point at the line identifying where the reasoning first went wrong. Read one clause of it.' },
        { start: 22, end: 30, action: 'Click **Dashboard** in the nav.' },
        { start: 30, end: 38, action: 'Open the entry for the question just answered. Show the same reasoning and the same coaching preserved there.' },
      ],
      skip: [
        'scrolling the rest of the dashboard',
        'the cash and reputation change',
        'the next question',
        'the review queue mechanics',
      ],
      staging:
        'Beats 1 to 3 happen inside the PREVIOUS slide\'s frame — stay on `demo-case-answer` through the verdict, the '
        + 'coaching panel and the click on Dashboard, then advance. Advancing reloads the iframe, so a slide change before '
        + 'beat 3 loses the answered question. This slide opens on `/progress`, which is where beat 3 left the app.',
    },
  },
  {
    id: 'demo-mega-litigation',
    section: 'product',
    kind: 'demo',
    eyebrow: 'Act IV — proof',
    headline: 'The full test, and the blind review after it.',
    notes:
      'Whenever a student wants, they can sit a full-length practice test. One clock, one sitting, no pausing. '
      + "When the clock stops we don't hand back the answers. First they redo every question they missed, untimed, with no key. "
      + "That's blind review, and Blueprint's framing is exactly what it computes: right when untimed means time pressure, "
      + "wrong both times means a reasoning gap, and confidently wrong means a misconception you didn't know you had. "
      + 'Three problems, three fixes. Then the question types this form exposed are what the app feeds you tomorrow.',
    speaker: 'Alan',
    budgetSeconds: 38,
    scene: { id: 'none', framing: 'drift' },
    transition: 'cut',
    demo: {
      route: '/progress',
      still: 'demo-progress.png',
      width: 1440,
      zoom: 1.06,
      budgetSeconds: 38,
      context: 'Start in Context A, jump to Context B',
      clickPath: [
        { start: 0, end: 7, action: 'On the dashboard, point at the mega-litigation card. One sentence on what it is. Do not start one.' },
        { start: 7, end: 17, action: 'Switch to Context B, on the blind review interstitial. Answer one question untimed while explaining blind review.' },
        { start: 17, end: 29, action: 'Jump to the completed audit. Timed score beside untimed score, plus the per-section breakdown.' },
        { start: 29, end: 38, action: 'Back to the dashboard. Point at the new point on the accuracy line and the panel naming the weak question types this form found.' },
      ],
      skip: [
        'starting a real form',
        'reading any question aloud',
        'accommodation settings',
        'the section clock rules',
        'the firm tier promotion, which lands on `game-never-gates`',
      ],
      staging:
        'Context B must already be on the blind review interstitial before the talk starts. '
        + 'This is the only slide in the demo act that carries a chart: timed score beside untimed score, '
        + 'the gap labelled *time pressure* and the shared shortfall below both labelled *reasoning*.',
    },
  },
  {
    id: 'dashboard-everything',
    section: 'product',
    kind: 'figure',
    field: 'blue',
    eyebrow: 'Act IV — proof',
    headline: 'Everything it watches, and why the numbers hold.',
    deck: 'First attempts only. Every figure carries how much evidence is behind it.',
    // Twelve signals, deliberately — the founders asked for the complete list on
    // one slide, and this is the one slide that knowingly exceeds the
    // three-fragment rule. They are the radial's nodes rather than body copy, so
    // `points` is empty here on purpose: printing them twice would be the whole
    // list at half the size next to itself.
    //
    // The Speedrun Index sits at the centre because it is the only derived
    // figure; `weight` is how much each signal feeds it, and it sets hairline
    // thickness. `forming` marks the ones whose sample is still too small to
    // compare, which is the honesty claim the notes make out loud.
    figure: {
      kind: 'radial',
      centre: { label: 'Speedrun Index', value: '61' },
      nodes: [
        { label: 'Accuracy by question type', weight: 1, ring: 1 },
        { label: 'Pace against target time', weight: 0.9, ring: 1 },
        { label: 'Reasoning quality grade', weight: 0.85, ring: 1 },
        { label: 'Confidence calibration', weight: 0.7, ring: 1 },
        { label: 'Weakest link and next focus', weight: 0.65, ring: 1, highlight: true },
        { label: 'Review recovery', weight: 0.5, ring: 2 },
        { label: 'Trend vs. your previous window', weight: 0.45, ring: 2 },
        { label: 'Per-method lift', weight: 0.4, ring: 2, forming: true },
        { label: 'Evidence confidence', weight: 0.35, ring: 2 },
        { label: 'Comparison readiness', weight: 0.3, ring: 2, forming: true },
        { label: 'Full-test section breakdown', weight: 0.55, ring: 2 },
      ],
    },
    notes:
      'This is the measurement surface on one slide. What makes it honest is what we refuse to do with it. '
      + "Only your first attempt at a question counts, so re-answering something you've memorized inflates nothing. "
      + "Every figure carries how much evidence is behind it, and comparisons stay suppressed until there's enough history. "
      + "Confident misses go to the front of the repair queue, on Metcalfe's finding. "
      + 'Scheduling is a trained model rather than fixed boxes, which cut recall error more than 45 percent '
      + 'over a Leitner system at Duolingo scale. And correctness always comes from the answer key.',
    speaker: 'Alan',
    budgetSeconds: 30,
    // 2D over the blue field, no WebGL: this lands directly after a live demo and
    // the frame rate is worth protecting.
    scene: { id: 'metrics', framing: 'panel' },
    transition: 'ink-bleed',
  },

  // ═══════════════════════════ ACT V — THE GAME ══════════════════════════════
  {
    id: 'pov-virtual-currency',
    section: 'game',
    kind: 'figure',
    field: 'beige',
    eyebrow: 'Act V — Spiky POV 06',
    headline: "Points beat badges. That's the whole mechanic.",
    deck: "Points tracked all four dimensions of engagement in Meng's study. Badges tracked one.",
    points: [
      'Cognitive g = 0.49',
      'Correlational, not causal',
      'We test it against a control',
    ],
    credit: 'Meng et al., correlational, voluntary respondents · Sailer & Homner, meta-analysis',
    // Points light all four spokes; badges light one. A fast, direct comparison —
    // the slide says "correlational, not causal" on screen, which buys more
    // credibility than the overstatement this replaced.
    figure: {
      kind: 'spokes',
      spokes: ['skills ρ = .146', 'emotional ρ = .274', 'participation ρ = .248', 'performance ρ = .293'],
      series: [
        { label: 'points', lit: [true, true, true, true], emphasis: true },
        { label: 'badges', lit: [false, false, false, true] },
      ],
    },
    notes:
      "The game runs on virtual currency, and that's a deliberate bet. "
      + 'Meng and colleagues found points correlated with all four dimensions of engagement they measured '
      + 'while badges correlated with only one. '
      + "Sailer and Homner's meta-analysis puts gamification's cognitive effect at about 0.49, "
      + 'and that one held up under the more rigorous studies. '
      + 'Those are honest, small-to-moderate numbers from correlational and mixed evidence, '
      + 'which is why the currency layer gets tested against a control rather than assumed.',
    speaker: 'Alan',
    budgetSeconds: 21,
    // A coin becomes a desk, then a room, then a floor plan. The tier ladder is
    // the deck's own architecture of that idea, seen from the bottom.
    scene: { id: 'tiers', framing: 'shack' },
    transition: 'letterbox',
  },
  {
    id: 'game-by-design',
    section: 'game',
    kind: 'figure',
    field: 'blue',
    eyebrow: 'Act V',
    headline: 'The meta-analysis designed our game.',
    deck: 'Clark and colleagues, 69 samples, 6,868 participants. Every split went the way we built it.',
    credit: 'Clark et al. — average participant age ~12–13; RCT subset smaller',
    // Four paired bars, ours in beige and the alternative in dim royal blue,
    // with three of the four alternatives at or below zero. The pairs animate in
    // as the presenter names them, roughly one every three seconds. The four
    // splits are the whole argument, so they are the figure, not a point list.
    figure: {
      kind: 'paired-bars',
      pairs: [
        { label: 'who plays', ours: { label: 'single-player', value: 0.45 }, theirs: { label: 'competitive', value: -0.06 } },
        { label: 'how it looks', ours: { label: 'schematic', value: 0.48 }, theirs: { label: 'photoreal', value: -0.01 } },
        { label: 'how much story', ours: { label: 'thin or none', value: 0.47 }, theirs: { label: 'medium depth', value: -0.03 } },
        { label: 'how often', ours: { label: 'many sessions', value: 0.44 }, theirs: { label: 'one session', value: 0.08 } },
      ],
      // Deliberately empty: the caveat is already the slide's hairline credit,
      // and printing it twice, six lines apart, read as a mistake rather than as
      // candour.
      footnote: '',
    },
    notes:
      "We didn't guess at the game design. Clark's meta-analysis, 69 samples and nearly 7,000 participants, "
      + 'found single-player beat competitive, stylized beat photoreal, thin story beat medium story, '
      + 'and many short sessions beat one long one. Our game is all four of those. '
      + 'Fair warning, the average participant was about thirteen, so we treat it as design guidance, not proof.',
    speaker: 'Alan',
    budgetSeconds: 17,
    scene: { id: 'tiers', framing: 'climb' },
    transition: 'camera',
  },
  {
    id: 'demo-clients-walk-in',
    section: 'game',
    kind: 'demo',
    eyebrow: 'Act V — live',
    headline: 'Clients walk in. Cases are questions.',
    notes:
      'A client walks into your office and sits down. '
      + 'Taking their case is the same act as starting a practice run, and the fee is visible before you begin, '
      + "so the stake of the next question is on screen before it starts and settled after it ends, "
      + "never while you're reading it. Better reasoning pays more. A well-argued wrong answer still pays something.",
    speaker: 'Alan',
    budgetSeconds: 16,
    scene: { id: 'none', framing: 'still' },
    // The four beige bars rotate into the vertical and become the columns of the
    // office as the live app opens.
    transition: 'cut',
    demo: {
      route: '/office',
      still: 'demo-office.png',
      width: 1440,
      zoom: 1.06,
      budgetSeconds: 16,
      context: 'Context A',
      clickPath: [
        { start: 0, end: 6, action: 'On /office, point at the client character seated in the waiting area. Say who they are.' },
        { start: 6, end: 12, action: "Click through to the practice lobby. Point at the client's name and fee line." },
        { start: 12, end: 16, action: 'One sentence: the case *is* the questions.' },
      ],
      skip: ['contracts and dockets', 'quests', 'story chapters', 'the client catalog', 'reputation'],
      staging:
        'Full bleed rather than floating, so the game section feels more immersive than the study section did. '
        + 'Budget bar only, no other chrome. Visit /office once in the presenting browser before going on stage — '
        + 'the first office build of the day takes about nine seconds.',
    },
  },
  {
    id: 'demo-office-transformation',
    section: 'game',
    kind: 'demo',
    eyebrow: 'Act V — live',
    // The slide's only line, and it fades in bottom-left AFTER the room finishes
    // rebuilding. Nothing is on screen during the transformation itself.
    headline: 'Every object in this room was bought with LSAT questions.',
    notes:
      'You start here. A shack, a broken desk, one light. And this is where it ends up. '
      + 'There are fifteen headquarters and the last one is an interplanetary justice organization, '
      + 'which is exactly as ridiculous as it sounds and exactly as motivating. '
      + 'There is one path between those two rooms and it runs through thousands of LSAT questions. '
      + 'Nothing else unlocks it.',
    speaker: 'Alan',
    budgetSeconds: 18,
    scene: { id: 'none', framing: 'still' },
    // "Cut straight to slide 19. No animation. The cut is the effect."
    transition: 'cut',
    demo: {
      route: '/office?officeTier=0',
      still: 'demo-office-tier0.png',
      width: 1440,
      zoom: 1.06,
      budgetSeconds: 18,
      context: 'Context A, two pre-staged save states',
      clickPath: [
        { start: 0, end: 5, action: 'Tier 0 office. One line about where you start.' },
        { start: 5, end: 13, action: 'Toggle to tier 14. Say nothing while the room rebuilds and the camera orbits.' },
        { start: 13, end: 18, action: 'One line: everything here was bought with questions.' },
      ],
      skip: [
        'naming individual upgrades',
        'staff hiring',
        'cosmetics',
        'the intermediate tiers',
        'the office cat, however tempting',
      ],
      staging:
        'The money shot, and it earns its length by being short. Do not crossfade — let the real scene rebuild with the '
        + 'camera locked in the same position so the room grows around a fixed viewpoint, then release the camera into one '
        + 'slow 20-degree orbit. Hold the final frame two full seconds in silence before speaking. Rehearse this one.',
    },
  },
  {
    id: 'demo-map-and-firm',
    section: 'game',
    kind: 'demo',
    eyebrow: 'Act V — live',
    headline: 'The world, and the ledger.',
    notes:
      'Zoom out and your firm sits on a career map across five regions, '
      + 'so you can see where you are and what\'s next. And this is where you spend. '
      + 'Upgrades, staff, the requirements for your next headquarters, '
      + "each with a line telling you exactly what you're missing. "
      + "It's a shop, and the only currency in it is work you have already done on the test.",
    speaker: 'Alan',
    budgetSeconds: 18,
    scene: { id: 'none', framing: 'drift' },
    // The camera dollies out through the tier-14 window and keeps going until the
    // city resolves into the career map: the deck's matched two-canvas dolly.
    transition: 'camera',
    demo: {
      route: '/map',
      still: 'demo-map.png',
      width: 1440,
      zoom: 1.06,
      budgetSeconds: 18,
      context: 'Context A',
      clickPath: [
        { start: 0, end: 5, action: 'Open /map. One camera pull-back to show the region.' },
        { start: 5, end: 9, action: 'Point at the current headquarters node and the locked one after it.' },
        { start: 9, end: 15, action: "Open /firm. Scroll once. Point at a single requirement line saying exactly what's missing." },
        { start: 15, end: 18, action: 'One sentence: everything here is priced in cases.' },
      ],
      skip: [
        'the rivals board',
        'the story campaign',
        'cosmetics',
        'staff detail',
        'the three map view modes',
        'every other region',
      ],
      staging:
        "Let the map's own lighting and region fog carry it; no deck chrome beyond the budget bar. "
        + 'If the talk is running long this is trim number four: map pull-back only, describe the firm tab without '
        + 'clicking, which brings it to 10 seconds.',
    },
  },
  {
    id: 'demo-focus-mode',
    section: 'game',
    kind: 'demo',
    eyebrow: 'Act V — live',
    headline: 'Or delete all of it.',
    notes:
      "And if a student wants none of it, there's one switch. "
      + 'Focus Mode removes the office, the firm and the map from the app '
      + 'and leaves the two screens that raise a score. '
      + "It's a preference, never a lock, and it's the cleanest proof of the thing I want to say next.",
    speaker: 'Alan',
    budgetSeconds: 10,
    scene: { id: 'none', framing: 'still' },
    transition: 'cut',
    demo: {
      route: '/progress',
      still: 'demo-progress.png',
      width: 1440,
      // Cropped tight and scaled up: this slide is a navigation bar read from the
      // back of the room.
      zoom: 1.35,
      budgetSeconds: 10,
      context: 'Context A',
      clickPath: [
        { start: 0, end: 4, action: 'Open the account menu, top right. Toggle **Focus Mode**.' },
        { start: 4, end: 10, action: 'The nav collapses to Dashboard and Practice. Say the line. Do not toggle it back on stage.' },
      ],
      skip: ['everything — one click, one sentence'],
      staging: 'Leave Focus Mode ON. Toggling it back on stage costs four seconds and un-makes the point.',
    },
  },
  {
    id: 'game-never-gates',
    section: 'game',
    kind: 'figure',
    field: 'blue',
    eyebrow: 'Act V',
    headline: 'The game never gates the practice.',
    deck: 'The practice gates the game. It only runs in that direction.',
    // The struck-through reverse arrow is the slide. The three couplings label
    // the direction that does exist; the denied one is drawn and then crossed
    // out, hard, once.
    figure: {
      kind: 'gate',
      left: 'Practice',
      right: 'Firm',
      couplings: [
        'Cases → cash and story',
        'Full test → a whole tier',
        'Focus Mode → the game disappears',
      ],
      denied: 'the firm never unlocks a question',
    },
    notes:
      'This is the most important slide in the game half. '
      + "Every gamification source we read says the same thing: it's a complement to good practice, never a replacement. "
      + 'So the coupling only runs one way. Cases in sequence earn money and move the story. '
      + 'Clearing a full-length test above our accuracy bar promotes your firm an entire tier. '
      + 'A student who never opens the office loses nothing except the office.',
    speaker: 'Alan',
    budgetSeconds: 20,
    scene: { id: 'tiers', framing: 'nexus' },
    transition: 'camera',
  },

  // ═══════════════════════════ ACT VI — THE CLOSE ════════════════════════════
  {
    id: 'close-one-stop-shop',
    section: 'close',
    kind: 'statement',
    eyebrow: 'Act VI — the close',
    headline: 'One place. Two doors.',
    deck: 'Walk in and answer questions. Or build a firm that only grows on thousands of them.',
    points: ['Cheaper', 'Narrower', 'Harder to quit'],
    notes:
      "Three reasons we win. Cheaper, because we don't run a video studio or pay live instructors, "
      + "and that's most of what sixty-five to four twenty-five a month is buying you. "
      + "Narrower, because we point you at what you're losing points on instead of handing you a menu you'll misuse. "
      + 'And harder to quit, because the game only moves when you answer questions. One place instead of five. '
      + 'Walk in and you\'re on a real question in under a minute, or take the door with a game behind it. Thank you.',
    speaker: 'Nischay',
    budgetSeconds: 28,
    // Two doorways, both open, the character between them facing the audience.
    // Composed, not animated — and held for the entire Q&A.
    scene: { id: 'hero', framing: 'wide' },
    transition: 'foil-seal',
  },
]

/**
 * Act labels, shown in the letterbox during an act break.
 *
 * The narrative runs six acts and the deck has six sections, but they do not
 * line up one-to-one: the narrative's Act III (Alan's three POVs) and Act IV
 * (the case demos) are one `product` section here, because a section boundary is
 * what fires the letterbox and the hand-off to Alan is the act break the
 * audience should feel, not the move into the iframe.
 */
export const SECTION_LABELS: Record<SlideSpec['section'], string> = {
  title: 'Lawyer Tycoon',
  problem: 'Act I — The Bill',
  thesis: 'Act II — The Turn',
  product: 'Acts III–IV — Proof',
  game: 'Act V — The Game',
  close: 'Act VI — The Close',
}

/** Total budgeted runtime, for the presenter overlay's pacing figure. 9:40. */
export const TOTAL_BUDGET_SECONDS = SLIDES.reduce((sum, slide) => sum + (slide.budgetSeconds ?? 45), 0)

/**
 * Total seconds spent inside a live app frame. 3:14 across seven slides, and the
 * number the founders asked to be held to.
 */
export const DEMO_BUDGET_SECONDS = SLIDES.reduce((sum, slide) => sum + (slide.demo?.budgetSeconds ?? 0), 0)
