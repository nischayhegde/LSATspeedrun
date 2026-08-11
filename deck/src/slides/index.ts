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
 *  stale — with **one exception, and it runs the other way**: the `notes` below
 *  were rewritten for the Revision 7 cut and the narrative's per-slide sections
 *  in §B were not, so §B still prints the pre-cut speaker notes at roughly twice
 *  the words. For what is spoken on stage, this file is current and §B is not.
 *  The narrative's §C table and its on-screen copy are current either way, and
 *  §B is banner-warned. `deck/CITATIONS.md` is the fact-check behind the numbers, and it
 *  still refers to two slides by their pre-revision ids — `turn-610-reader` is
 *  now `turn-nothing-to-teach`, and `problem-200-hours` is now
 *  `problem-hours-and-price`.
 *
 *  Revision 4 changed exactly one slide: `pov-reasoning-is-the-work` gained a
 *  fourth fragment and one sentence of notes, which together were the deck's
 *  whole on-stage competitive positioning. The rest of it is off the clock, in
 *  the narrative's §G and in `CITATIONS.md` §4 — and in `notes/qa.ts`, which is
 *  where the presenter actually reads it from. `budgetSeconds` did not move.
 *
 *  Revision 5 answered two questions the founders asked of the deck directly:
 *  *why gamification* and *why us rather than them*. It changed four slides and
 *  added no slide, so `budgetSeconds` did not move and the deck is still 9:40.
 *
 *      `pov-virtual-currency`   rebuilt. It argued points against badges, which
 *                               is a choice between game elements; it now argues
 *                               the mechanism, on the one study that isolated
 *                               virtual currency. New `currency-lift` figure.
 *      `concept-lawyer-tycoon`  two fragments rewritten — one because warning 12
 *                               says the old wording was falsifiable, one to land
 *                               the practice-gates-the-game inversion at 3:20
 *                               instead of at 8:52.
 *      `pov-strategy-inside…`   a fourth fragment, the deck's second competitive
 *                               line, on the one claim `CITATIONS.md` §4 supports
 *                               against all seven products.
 *      `close-one-stop-shop`    cheaper / narrower / harder to quit each gained
 *                               the mechanism that makes it true.
 *
 *  Rationale for all four is in §D of the narrative; the evidence is
 *  `CITATIONS.md` §6 (gamification) and §8 (what may be claimed on stage).
 *
 *  Revision 6 answered the same two questions again, harder, after the founders
 *  named the argument they actually wanted made: the game is not a motivational
 *  add-on, it is the delivery vehicle for a method whose binding constraint is
 *  compliance rather than knowledge. That is a claim the deck could not make
 *  because the compliance step was nowhere in it, so this revision adds ONE
 *  slide and rewires three.
 *
 *      + `pov-volume-is-the-constraint`  NEW, slide 8, between the confidence POV
 *                               and the concept. LSAC's own study of a free prep
 *                               platform: practice moved the score, video did
 *                               not, and 51% never completed one exam. New
 *                               `cohort-split` figure. 26s.
 *      `concept-lawyer-tycoon`  sub-line was "wrapped in an idle game", which is
 *                               severable framing; it now names the coupling.
 *                               Notes carry the punchline.
 *      `pov-virtual-currency`   21s → 19s, and its notes now open by pointing
 *                               back at the 51% rather than re-arguing that a
 *                               motivation layer is worth having.
 *      `game-never-gates`       one sentence of notes: the one-way coupling is a
 *                               consequence of the design, not a promise.
 *
 *  It was the first revision to move the runtime, taking the deck to 10:04. It
 *  was not the last: the cut that followed took the talk to a 4-5 minute target
 *  and the deck now runs **4:50** across 24 slides. §C of the narrative carries
 *  the current table. Evidence for the new slide is `CITATIONS.md` §7.
 *
 *  Revision 9 is a subtractive pass and nothing else. The founders' longest
 *  standing complaint is additive text — *"slides should be succinct and
 *  straightforward to read, all the while being aesthetic"* — and the defect it
 *  names, measured against what is actually drawn beside it, is one thing:
 *  **copy that repeats what the slide already shows.** A fragment restating a
 *  figure's own label, a standfirst reading numbers the chart draws at ten times
 *  the size, a headline and a deck line making one point twice. None of that is
 *  argument, so removing it costs the deck nothing and is what "one slide, one
 *  reading" already asks for — the rule the stylesheet enforces for
 *  `problem-coaching-tax` and `problem-hours-and-price`, whose fragment lines it
 *  suppresses outright.
 *
 *      `thesis-speedrun`        deck's second sentence and `No curriculum path`
 *                               were the headline and the route's three struck
 *                               nodes, a third and fourth time.
 *      `pov-reasoning-is-the…`  standfirst stopped reading d = 0.31 / 0.76 /
 *                               0.79 aloud, since the figure draws all three as
 *                               labelled bars; the competitive sentence was
 *                               promoted off the fragment line into the space.
 *      `pov-volume-is-the-c…`   the worst of them. Three of four fragments were
 *                               the figure read back out; the standfirst's last
 *                               two sentences were the headline. One fragment
 *                               left, one standfirst line left.
 *      `pov-real-clock`         two of three fragments were the second half of
 *                               the headline.
 *      `pov-virtual-currency`   the multiples are the figure's largest type.
 *                               The two nulls stay: they are why the room
 *                               believes the rest of the slide.
 *      `game-never-gates`       `It only runs in that direction` was the fourth
 *                               statement of one proposition on one slide.
 *      `dashboard-everything`   the only cut to anything spoken. The script
 *                               opened by reading the headline and then the
 *                               standfirst. 12s → 8s, and it is the whole of
 *                               the 4:54 → 4:50 move.
 *
 *  NOT CUT, and the reasons are worth holding, because each looks like the same
 *  defect and is not. Every `credit` and every source line, without exception —
 *  they are the deck's defence in a hostile Q&A and space is never a reason to
 *  drop one. `problem-coaching-tax` and `problem-hours-and-price` keep their
 *  fragments in the document because the stylesheet has already taken them out
 *  of the picture and they are the figures' accessible text. On
 *  `pov-strategy-inside-the-question`, `Tested against your own control` does
 *  restate the figure's note, and it was left alone on instruction.
 *  `pov-ai-never-answers` was cut and restored: `Hints, never solutions` reads
 *  like the guarded trace's own label, but that trace is flat at the baseline
 *  and its label never paints, so the fragment is the only place the guardrail
 *  appears on screen. See the note on the slide.
 *
 *  `close-one-stop-shop` was reserved during this pass and is untouched. Note
 *  that Revision 8 is the autoplay demo revision, recorded in §C of the
 *  narrative rather than in its header — this is 9.
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
 *  **4:50** across 24 slides. Seven slides carry a `demo` block with its own hard
 *  budget, which is the number the presenter is held to; six of those mount a
 *  live frame and come to **1:22** between them, and the seventh —
 *  `demo-focus-mode` — is `stillOnly` and paints a single frame. Demo overrun is
 *  the founders' single biggest complaint about the previous deck, so every demo
 *  here has a written click path with per-beat seconds and an explicit skip list.
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
      "We're Alan and Nischay, from UT Austin. We built Lawyer Tycoon, an LSAT prep app. One number first.",
    speaker: 'Nischay',
    budgetSeconds: 7,
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
      'LSAC asked forty-six thousand of its own test takers what they did. '
      + 'A coaching course was worth two tenths of a point. Working real LSATs, two point seven seven. '
      + 'Half bought the course.'
      + ' ⟢ IF CHALLENGED — LSAC\'s own Wightman, Research Report 90-01, 46,301 test takers. '
      + "It's a self-report survey, so it's an association and not an experiment. That's the concession, "
      + "and it costs nothing: it is still the test maker's own data on the test maker's own candidates.",
    speaker: 'Nischay',
    budgetSeconds: 12,
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
    // ACTIVE-VS-PASSIVE, BEAT 1. The room has told the founders it already
    // believes lecture hours are passive and produce bad outcomes. So this slide
    // stops proving that and asserts it in half a sentence. The enumeration that
    // used to do the proving — 900 videos, 90-minute classes five days a week —
    // stays on screen as fragments and comes out of the mouth, which is the
    // cheapest second in the deck: the figure argues it, the presenter banks it.
    notes:
      'A hundred hours of lecture is passive, and you already know how that ends. '
      + 'The bill for it: two hundred and fifty hours, sixty-five to four-twenty-five a month, plus LawHub.'
      + ' ⟢ IF CHALLENGED — every figure is off their own public pages and re-verified this month; '
      + 'the LawHub fee is $124 a year and Blueprint says in writing that it is required no matter whose course you buy. '
      + 'The hours are Princeton Review, Blueprint and Kaplan; LSAC declines to give a number, which is the blank tick.',
    speaker: 'Nischay',
    budgetSeconds: 11,
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
      "Coaching was worth a fifth of a point because there's nothing to teach. "
      + 'LSAC calls its own exam a test of skills — no syllabus. '
      + "They're not missing concepts. They're missing reps."
      + " ⟢ THE ABA LINE COMES OUT OF THE MOUTH AND STAYS ON THE SCREEN. Standard 502(a) is in the deck line and "
      + 'the credit, so the room reads it while you say the sentence that matters. '
      + "⟢ IF CHALLENGED — LSAC's own \"LSAT Prep\" page and ABA Standard 502(a). Neither is a study; both are "
      + 'the governing bodies describing their own rules, which is why this one is not arguable.',
    speaker: 'Nischay',
    budgetSeconds: 12,
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
    // "There is nothing to get through first" was a second statement of the
    // headline, and the route figure below it is a third: three nodes greyed
    // out and struck through is that sentence drawn.
    deck: 'Minute one is question one.',
    // "No curriculum path" went with it, for the same reason and one worse —
    // it was the headline, the deck's cut sentence and the figure's three
    // skipped nodes, all on one screen. What is left is the pair of Dunlosky
    // rankings, which is the only thing on the slide the figure cannot draw.
    points: [
      'Practice testing: rated highest',
      'Rereading: rated lowest',
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
    // ACTIVE-VS-PASSIVE, BEAT 2, and where "strip away the fluff" enters. This
    // is the founders' own phrase for the speedrun thesis and it belongs early —
    // it is the line the room should still be hearing when the demo starts.
    // Dunlosky is the deck's active-versus-passive citation and always was:
    // practice testing at the top of ten techniques and rereading at the bottom
    // is exactly the room's own premise, from their own reading, so nothing new
    // had to be reached for.
    notes:
      'So we strip away the fluff. No intro course, no videos — minute one is question one. '
      + "Dunlosky's ten techniques: practice testing top, rereading bottom."
      + ' ⟢ IF CHALLENGED — Dunlosky and colleagues, 2013, the standard review in the field, and the one '
      + 'the room is already agreeing with when it says lectures are passive. Their two highest-utility '
      + 'techniques are practice testing and distributed practice; the lowest are rereading and highlighting. '
      + 'We are not claiming novelty. We are claiming nobody builds the whole product out of the top of that list.',
    speaker: 'Nischay',
    budgetSeconds: 10,
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
    // PROMOTED, NOT CUT. The standfirst used to read the three effect sizes
    // aloud — d = 0.31, 0.76, 0.79 — while the figure draws them as three
    // labelled bars a few inches to the right, at display scale, with the same
    // three labels. The bars carry the numbers now.
    //
    // What takes the line is the sentence that was the fourth fragment: the
    // only one in the deck that compares us to anybody, and it names nobody.
    // It was also a full sentence in a list of three noun phrases and the
    // longest item on that line. It is the deck's whole on-stage competitive
    // positioning (Revision 4) and could not be dropped, so it moved up rather
    // than out — which costs it the late, level-weighted arrival it had among
    // the fragments and buys it legibility and a line of its own. See §D of the
    // narrative for why there is no comparison table, and `CITATIONS.md` §4 for
    // the seven-product reference that backs it.
    deck: 'They explain the question. We grade your explanation.',
    points: [
      'Name the error',
      'Why yours was wrong',
      'Why the right one works',
    ],
    credit: 'VanLehn (2011), 87 comparisons · Zhang & Fiorella (2024)',
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
      // (B) IS CORRECT HERE AND MUST NOT BE "FIXED" TO (C). This is an
      // illustrative Weaken question invented for the figure, not the pinned
      // demo question — the demo is an Assumption item whose credited answer is
      // (C), and the two are unrelated. (B) is "Respondents chose for themselves
      // whether to reply", which is the self-selection flaw the reasoning below
      // actually names, so the card is internally consistent as written.
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
    // ACTIVE-VS-PASSIVE, BEAT 3, and the load-bearing one. The room grants that
    // passive is bad; what it has not been given is what active concretely means
    // here. This is where the deck answers that, in the only terms that
    // distinguish it from every competitor: the student PRODUCES the reasoning
    // rather than recognising an answer. Generation, on every single rep,
    // against a lecture hall's reception.
    notes:
      "Here's what active means. You produce your reasoning — you don't recognise an answer. "
      + "VanLehn's eighty-seven comparisons: feedback on your answer, point three one. "
      + 'On your steps, point seven six. A human tutor, point seven nine.'
      + ' ⟢ IF CHALLENGED — VanLehn 2011, a synthesis of 87 COMPARISONS rather than 87 studies; say it that way. '
      + "The near-equality of the last two is the pricing argument: step-level feedback gets a tutor's effect "
      + "without a tutor's cost. Zhang and Fiorella 2024 is why the prompt is structured rather than "
      + '"explain this" — a structured prompt beat a vague one by 0.62.',
    speaker: 'Nischay',
    budgetSeconds: 14,
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
      'A lucky guess and a confident miss look identical. So we take confidence before the key. '
      + 'A confident miss is the most correctable error there is, and our most valuable event.'
      + ' ⟢ IF CHALLENGED — Metcalfe 2017, the hypercorrection effect: high-confidence errors are corrected '
      + 'more reliably than low-confidence ones, because the surprise captures attention. '
      + 'It is a robust and replicated finding, and it is why confident misses go to the front of our repair queue.',
    speaker: 'Nischay',
    budgetSeconds: 11,
    scene: { id: 'none', framing: 'drift' },
    transition: 'cut',
  },
  {
    id: 'pov-volume-is-the-constraint',
    section: 'thesis',
    kind: 'figure',
    field: 'beige',
    // Not numbered into the Spiky POV series, though it is spikier than most of
    // them. The series is referenced by number in `CITATIONS.md` §4.2 and in the
    // narrative's §D, and renumbering four eyebrows to gain a badge is churn for
    // nothing. Act II already carries three unnumbered beats — the turn, the
    // thesis, the concept — and this is the fourth.
    eyebrow: 'Act II — the constraint',
    headline: 'Everyone knows this. Doing it is the product.',
    // "its own free platform" was a shade wrong and free to fix: the platform was
    // Khan Academy's, hosting LSAC's Official LSAT Prep under a partnership.
    //
    // The standfirst used to run to three lines, and two of them were the
    // headline again: "The method is not in dispute. Finishing it is." is
    // "Everyone knows this. Doing it is the product." with different nouns.
    // What is left is the one thing the headline cannot say, which is where the
    // data comes from and what it was matched against.
    deck: 'LSAC matched the usage logs of the free platform it ran with Khan Academy to real LSAT scores.',
    // THE FRAGMENT LINE IS DOWN TO ONE, and the three that went were the figure
    // directly above them read back out loud. This is the `problem-coaching-tax`
    // collision — the one the stylesheet suppresses under "one slide, one
    // reading" — except that `cohort-split` is not covered by that rule, so the
    // fix has to be made here in the copy.
    //
    //   `+4.3 points, top decile vs bottom`  the practice row's own verdict is
    //       `+4.3 points`, noted `10th vs 90th pct · different students`.
    //   `Video minutes: not correlated`      the video row's verdict, verbatim,
    //       noted `LSAC's words, not ours`.
    //   `51% never finished one exam`        the bar's own `lostLabel`, which
    //       reads `51% never completed a single practice exam`.
    //
    // Both of the corrections those fragments were carrying — that the +4.3 is
    // an increment between independent groups rather than a gain, and that
    // "not correlated" is LSAC's own verb rather than a paraphrase — are on
    // screen in the figure's two `note` fields and are not lost with the text.
    points: [
      // The deck's third and last competitive line, and it uses the same device
      // as the two before it: a bare parallel sentence, arriving last, naming
      // nobody. It is the active-against-passive axis rather than the price
      // axis, which matters because price is the one axis LSAT Demon can meet.
      // "Hours" is the field's own unit — every product in `CITATIONS.md` §4 is
      // described by its instruction hours, lesson counts or class schedule —
      // and the room already has the referent from slide 3's 250. It is also
      // the only one of the four fragments that added anything, which is why it
      // is the only one still here.
      'They sell hours. We sell reps.',
    ],
    // The bar fills, then retreats to 49% and leaves its own hatched footprint,
    // and the two usage variables land underneath it. `shape: 'null'` on the
    // video row is deliberate and is the row's whole content: LSAC's sentence is
    // "video minutes... were not correlated with LSAT scores", which is a null
    // and not a small effect, so the row gets an origin tick and no bar.
    //
    // The practice row is `shape: 'contrast'` and used to be a bar annotated
    // `26 min → 47 h`. Both were wrong in the same way. LSAC writes, two
    // paragraphs under the table the 4.3 comes from, that its figures are "not
    // gains for students who took the LSAT twice but rather increments for
    // independent groups of students" — so an origin bar and an arrow both drew
    // a single student climbing a dose curve that the source says is not there.
    // The two positions are ordinal and not to scale, and could not be: 26
    // minutes against 47 hours is a ratio of about 108, which on a linear track
    // puts both groups inside the same mark.
    figure: {
      kind: 'cohort-split',
      // The n belongs to the bar, not to the slide. 12,471 is the matched
      // descriptive cohort the 51% is computed on; 6,938 is the regression
      // sample the +4.3 comes from, and it is named separately in the credit.
      // Carrying one n under four claims invited a sceptic to compute 51% of
      // 6,938 — and the report's own Table 7 puts the zero-exam rate inside
      // that sample at 29.8%, so the slide was inviting a contradiction.
      cohortLabel: 'Khan Academy LSAT users, matched to the score they actually got · n = 12,471',
      keptShare: 0.49,
      // The unit is named because the neighbouring ledger is denominated in
      // score points and a bare `4.5` under an exam-completion bar invites
      // exactly the wrong reading. It is the finishers' subgroup and the report
      // says so: "students who took at least one practice exam took an average
      // of 4.5 practice exams". See `CITATIONS.md` §7, finding 3.
      keptLabel: 'finished at least one — 4.5 exams on average',
      lostLabel: '51% never completed a single practice exam',
      inputs: [
        {
          label: 'practice minutes',
          shape: 'contrast',
          low: { at: 0.06, label: '26 min' },
          high: { at: 0.62, label: '47 h' },
          verdict: '+4.3 points',
          // Two words carrying the whole of LSAC's "independent groups"
          // sentence, and the reason the row is not a bar.
          note: '10th vs 90th pct · different students',
          emphasis: true,
        },
        {
          label: 'video minutes',
          shape: 'null',
          verdict: 'not correlated',
          note: "LSAC's words, not ours",
        },
      ],
    },
    // Author order corrected — the report's cover page and SSRN both read
    // Dustman, Camilli, Gallagher. Both n's are named, attached to what each
    // one actually supports.
    credit: 'LSAC RR 21-01 (Dustman, Camilli & Gallagher, 2021) · Khan usage matched to real LSAT scores · n = 12,471; 6,938 modelled',
    // The one slide in the deck that is deliberately over-budget relative to its
    // neighbours. At a 4:50 runtime everything else is compressed toward ten
    // seconds; this holds twenty-one, because it is the only place the causal
    // chain — method, volume, compliance, mechanism — is actually argued, and
    // every later slide is a reference back to it.
    // The video row is CORROBORATION now, not proof, and the single word "even"
    // is what does it. The room already believes passive hours produce nothing —
    // they said so about their own institution — so the null no longer has to
    // carry that proposition, it just has to agree with it. That also retires
    // the slide's softest inference: the median student in LSAC's cohort watched
    // 42 minutes of video, which is a fair hit against a null used to indict a
    // hundred-hour lecture course and no hit at all against a null offered as
    // the test maker happening to agree with the room.
    notes:
      "Everyone knows practice matters. This is LSAC's own data, matched to real scores. "
      + 'Top decile of practice time sat four point three points above the bottom. '
      + "Even their video minutes weren't correlated at all. "
      + 'And fifty-one percent never completed a single practice exam. '
      + 'Everyone sells the method. Nobody sells the reps.'
      + ' ⟢ IF CHALLENGED — LSAC Research Report 21-01, Dustman, Camilli and Gallagher, 2021; SSRN abstract 3845015. '
      + '12,471 matched records, 6,938 modelled. Three prepared answers, in the order they get asked. '
      + '(1) THE BASELINE. Yes — add the student\'s first practice-exam score and R-squared goes from .21 to .64 and '
      + 'the practice row collapses. That model is estimated only on students who completed at least one practice '
      + 'exam, because a first-exam score cannot exist for anyone else. It is a fact about the 49%. This slide is '
      + 'about the 51%. (2) THE VIDEO DOSE. The median student in that study watched 42 minutes of video, so this is '
      + 'not a verdict on a hundred-hour lecture course — and note that it no longer has to be. You already believe '
      + 'passive hours produce bad outcomes; this is the test maker\'s own data agreeing with you. The "they sell '
      + 'hours" line rests on competitors\' published curricula, not on this null. What the null is: same students, '
      + 'same platform, same window, and the practice tracked the score while the watching did not. They never print '
      + 'a coefficient for video; that is their sentence and the reason they dropped it from the models. '
      + 'Do not invent a number, and do not widen the claim. '
      + '(3) CAUSATION. Concede it immediately — association, LSAC says so, confounded with motivation. '
      + 'The 51% needs no identification at all: it is a description, and every one of those students went on to '
      + 'sit the real LSAT.',
    speaker: 'Nischay',
    budgetSeconds: 21,
    // Deliberately motionless. The figure is the only thing moving on the slide,
    // which is what a slide whose punch is one number needs, and it means the
    // cut in from the confidence tiles has something to land on.
    scene: { id: 'none', framing: 'still' },
    transition: 'cut',
  },
  {
    id: 'concept-lawyer-tycoon',
    section: 'thesis',
    kind: 'scene',
    eyebrow: 'Act II — the concept',
    headline: 'An LSAT engine inside a tycoon game.',
    // Was "wrapped in an idle game that only moves when you do". *Wrapped in* is
    // the severable framing: it invites a listener to mentally delete the game
    // and still have the product, which is the opposite of the claim the
    // previous slide just set up. The game is the compliance mechanism for a
    // method whose binding constraint is compliance, so the sub-line now names
    // the coupling instead of the packaging.
    deck: 'An adaptive engine on 6,886 LSAT questions, inside a game whose only input is questions answered.',
    // Fragment 2 was "You don't pick the questions", which is the version the
    // narrative's warning 12 says not to say: adaptive selection weighted to
    // weaknesses is table stakes — Demon's Smart Drilling, 7Sage's smart drills
    // and LSAT Lab's Adaptive Drill Engine all do it. What is actually ours is
    // the *absence of the override*, where LSAT Lab ships a Filtered setting to
    // build drills "with your exact specifications". So the fragment now claims
    // the removal, which is true, differentiating, and not falsifiable by anyone
    // in the room with a phone.
    //
    // Fragment 3 was "The game is always optional". Optional answers "I don't
    // want a game"; it does not answer "a game is a distraction from studying",
    // which is the objection this room actually has and the one the founders
    // most want closed. The inversion answers it, and putting it here lands it
    // at 3:20 instead of leaving it to `game-never-gates` at 8:52. Optional is
    // not lost: it is the sub-line's "only moves when you do", the whole of
    // `demo-focus-mode`, and the third coupling on `game-never-gates`.
    points: [
      'Answer, explain, get corrected',
      'No way to drill only what you are good at',
      'Practice moves the game, never the reverse',
    ],
    notes:
      "That's Lawyer Tycoon — our answer to that fifty-one percent. "
      + 'An adaptive engine on sixty-eight hundred real LSAT questions, inside an idle game '
      + 'whose only input is questions answered. We did not add a game to a study app.',
    speaker: 'Nischay',
    budgetSeconds: 14,
    // The hatched footprint of the missing half is the last thing lit on the
    // previous slide, and the camera pulls back off it until the whole tier-6
    // office is in frame. Let it breathe two full seconds before any text lands.
    // (Before the constraint slide was inserted, the thing pulled back from was
    // the confident-misconception tile, which now expands into the cohort bar
    // one slide earlier — same move, one station further up the line.)
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
    // REVISION 9 CUT `Hints, never solutions` AND PUT IT BACK. On the data it
    // looks like the third trace's own label repeated four inches lower — the
    // guarded trace below is named "a coach that gives hints, never answers".
    // It is not. That trace is flat at the baseline, so it draws underneath the
    // control's dashed line and its label is never painted; a 4K still of the
    // settled frame has bare background where the other two traces carry their
    // right-edge labels. Cut the fragment and the deck's own guardrail — the
    // one thing on this slide that is a product commitment rather than somebody
    // else's finding — is spoken once and shown nowhere.
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
      "I'll take it from here. Bastani gave a thousand students plain ChatGPT. "
      + 'Practice grades up forty-eight percent. Take it away for the real exam: seventeen percent worse. '
      + 'Ours never gives the answer.'
      + ' ⟢ IF CHALLENGED — Bastani and colleagues, 2024, a field experiment with about a thousand high-school '
      + 'students in Turkey. The detail that matters and is on the slide: the arm that gave hints instead of '
      + 'answers left students level with the control, so the harm is the answer, not the AI.',
    speaker: 'Alan',
    budgetSeconds: 13,
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
    // The fourth fragment is the deck's second competitive line, and it uses the
    // same device as the one on `pov-reasoning-is-the-work`: a bare sentence,
    // arriving last, naming nobody. It is deliberately a claim about
    // *measurement* rather than about method vocabulary, because `CITATIONS.md`
    // §4.2 establishes that Demon's Prediction Mode already prompts a technique
    // inside a question — so "nobody prompts a method" would be false, while
    // "nobody measures whether it worked for this student" is the finding §4
    // actually supports across all seven products.
    points: [
      '14 in the catalog',
      'One per question',
      'Tested against your own control',
      'Nobody else measures whether it worked',
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
      'Everyone sells strategies and leaves you with them. We prompt one method inside the question '
      + 'and test it against your own unprompted attempts. Nobody else measures whether it worked.',
    speaker: 'Alan',
    budgetSeconds: 11,
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
    // "Full form when you can · Never required" was the second half of the
    // headline set again in a smaller face: *Every exam is optional* already
    // says both, and the outer ring is drawn unfinished to say it a third time.
    // "Real pacing from day one" survives because "from day one" is the one
    // claim here that is not already somewhere else on the slide — the headline
    // says every question is timed, not that there is no untimed ramp into it.
    points: [
      'Real pacing from day one',
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
    // NO CREDIT LINE, and that is deliberate rather than an omission. This POV
    // has no source anywhere in the founders' research — "stamina" appears once
    // in 68 pages of the brainlift, inside this thesis itself — and it is the
    // one claim in the numbered series where a named competitor publicly argues
    // the opposite. Every sibling POV carries a research credit, so adding a
    // hairline here would invite exactly the search that finds nothing. It is a
    // design position, it is a good one, and it is spoken as ours.
    notes:
      'We think the LSAT is mostly a pacing test, so every question is timed. '
      + 'Nobody sits a full form on a Tuesday — those stay optional.'
      + ' ⟢ SAY "WE THINK" AND MEAN IT. This is our position, not a finding, and there is no citation behind it. '
      + 'Demon publicly tells students to hide the clock, so somebody in the room may hold the opposite view and '
      + 'hold it sincerely. The prepared answer is in the Q&A notes under `demon-ignore-the-clock`: they are talking '
      + 'about the learning phase and we do not disagree — our full forms are optional and blind review is untimed. '
      + 'What we time is the single question, and we report pace beside accuracy rather than blended into it.',
    speaker: 'Alan',
    budgetSeconds: 10,
    scene: { id: 'none', framing: 'low' },
    transition: 'cut',
  },

  // ════════════════════════════ ACT IV — PROOF ═══════════════════════════════
  //
  // All four demo slides run one embedded live app iframe with deck chrome cut to
  // a hairline frame and the budget bar across the top. Two browser contexts are
  // pre-staged before the talk and neither is created live:
  //
  //   Context A — signed in at office tier 6. The case demo is now AUTOMATED: a
  //     driver inside the app plays the whole sequence — approach taken up,
  //     question read, case theory shown, answer chosen and submitted — off a
  //     session staged by `stage_demo.py`, whose attempt is answered and graded
  //     before the talk. The presenter narrates and never touches the keyboard.
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
    // ACTIVE-VS-PASSIVE, BEAT 4 — the proof, and now the app performs it rather
    // than the presenter demonstrating it. The room has been told twice that
    // this product is active; this is where they watch it. Every beat is the
    // student producing something — a prediction, a marked stimulus, a written
    // case theory, a choice — and not one of them is reception.
    //
    // The script is written to be spoken OVER a sequence that plays itself, so
    // it narrates what the room is watching instead of announcing what the
    // presenter is about to click. "I'm not touching anything" is worth its two
    // seconds: it tells the audience the pace they are seeing is the product's,
    // not a rehearsed operator's, which is the difference between a demo and a
    // performance.
    //
    // The dimmed choices got words because they are the strongest version of
    // the strategy POV available and the deck was underclaiming them. Slide 11
    // says the method arrives inside the question; this shows the app REFUSING
    // to show the choices until the method is taken up. Enforced, not suggested.
    notes:
      "Watch this — I'm not touching anything. "
      + 'It opens with the approach: guess before you look. '
      + "And see the choices greyed out — it won't let you read them yet. "
      + "That's the method enforced, not suggested. "
      + 'Now the question. Now the case theory, written out. '
      + 'Choices unlock, C, submitted — and the ruling comes back on the reasoning, not the letter.'
      + ' ⟢ HANDS OFF THE KEYBOARD. The app drives this. Measured at 21 to 26 seconds to rest across four runs, '
      + 'and the slide holds 30 — so a slow run still has room, and a fast one leaves you four seconds to say '
      + 'nothing in. If you finish narrating early, stop talking and let the coach\'s line be read. '
      + 'Do not tap anything to "help" — there is nothing to help, and the variance is the machine, not a fault. '
      + '⟢ THE ANSWER IS (C). Say the letter once as it lights and move on. If you lose your place: the stimulus '
      + 'says discoveries shape how societies develop, so predictions about high-discovery societies are '
      + 'untrustworthy, and (C) is the assumption that the discoveries themselves cannot be reliably forecast. '
      + '(A) is the trap — it is about discoveries doing harm, and the argument is about whether predictions can '
      + 'be trusted, not whether they hurt. '
      + '⟢ IF ASKED WHETHER THE GRADE IS LIVE — the submit is real: real endpoint, real session, the stored '
      + 'attempt for exactly that reasoning. The grading ran at staging rather than in that second, because a '
      + 'frontier call takes twenty to forty seconds and we were not going to spend a quarter of this talk on a '
      + 'spinner. Offer to run one cold in Q&A. Never say the model is thinking live, and never imply it.',
    speaker: 'Alan',
    // 30, and the number moved because the measurement did. Four live runs to
    // rest: 20.8, 21.0, 22.9 and 25.6 seconds. The single figure this used to
    // quote — "21 seconds" — was the fastest of them, and against the 25 that
    // was budgeted here the slowest run OVERRAN: the budget bar would have
    // bottomed out while the app was still performing, which tells the presenter
    // they are late at the exact moment the product is making its case.
    //
    // Time to rest is also a floor rather than a duration. The last thing to
    // arrive is the coach's reading, which the room then has to actually read,
    // and the slide can be held past any of these numbers indefinitely — once
    // the page is at rest nothing moves again. So 30 is worst-measured plus
    // enough headroom to survive a stage machine driving a projector, and it is
    // headroom rather than a countdown to beat.
    budgetSeconds: 30,
    scene: { id: 'none', framing: 'still' },
    // The unfinished outer ring of `pov-real-clock` snaps closed and becomes the
    // border of the live app frame. Demo mode begins.
    transition: 'letterbox',
    demo: {
      // `{autoplay}` expands to the WHOLE route including its query string —
      // `/cases/<soloSessionId>?autoplay=C` — so it replaces the path rather
      // than sitting inside one. Writing `/cases/{autoplay}` would nest a route
      // inside a route. The single letter is the credited answer, pinned in
      // `demo.config.ts` beside the session id because the API deliberately
      // omits `correct_answer` from what the client is sent, so a driver reading
      // only the client's own data could not answer anything.
      route: '{autoplay}',
      // The END state of the driven run, not the opening frame.
      //
      // This was `demo-case.png` — the partner tip with the choices still dimmed
      // — which is the first three seconds of a thirty second beat. On the stills
      // path the slide therefore stopped before the only thing it is for: the room
      // saw the question it had just been told the app was about to answer, and
      // never saw it answered. `demo-case-answered.png` is the same driven session
      // at rest, with (C) credited, the stamp down and the coach's reading in
      // shot, so the fallback makes the slide's point instead of setting it up.
      still: 'demo-case-answered.png',
      width: 1440,
      zoom: 1.12,
      budgetSeconds: 30,
      context: 'Context A',
      // NOT A CLICK PATH ANY MORE — a watch list. The app drives itself, so
      // these are the beats the presenter narrates over, in the order they
      // appear. Nothing here is an instruction to touch anything.
      //
      // The boundaries are taken from the fastest of four measured runs, which
      // reached rest at 20.8s; the slowest took 25.6s. So they are an ORDER with
      // approximate lengths rather than a stopwatch, and every beat can slip by
      // a second or two on a loaded machine. Narrate what is on screen, not what
      // the clock says should be.
      clickPath: [
        { start: 0, end: 3, action: 'HANDS OFF. The partner tip appears — *"Guess before you look"* — with the answer choices **dimmed** beneath it. Say that the choices are locked. This is the strongest two seconds in the demo.' },
        { start: 3, end: 4, action: 'The tip is taken up and the card records it. Nothing to do.' },
        { start: 4, end: 8, action: 'Stimulus and stem paint. Do not read them aloud — the room can read.' },
        { start: 8, end: 13, action: 'The written case theory appears, 827 characters of it. This is the beat that matters: let its length be seen.' },
        { start: 13, end: 15, action: 'The choices unlock and render.' },
        { start: 15, end: 17, action: '**(C)** lights up. Say the letter once.' },
        { start: 17, end: 30, action: 'Submitted. The verdict stamp and the coach\'s reading land in the same frame. Stop talking and let them read it. This beat absorbs the slack on a slow run.' },
      ],
      skip: [
        'the passage tab switcher',
        'the per-question timer explanation',
        'the client and fee line',
        'reading any other answer choice',
        'the settlement numbers',
        'touching the keyboard or mouse at any point',
      ],
      staging:
        'AUTOMATED. A driver inside the app plays this sequence itself and the presenter never touches the '
        + 'keyboard. Four live runs reached rest at 20.8, 21.0, 22.9 and 25.6 seconds — reproducible in shape, '
        + 'not to the second, and the spread is machine load rather than anything the deck controls. '
        + 'The slide is budgeted 30 for that reason: the old 25 was set against the fastest run and the slowest '
        + 'one went past it. '
        + 'The slide submits, which reverses the old instruction: submission is now a database read, because the '
        + "attempt is answered and graded during staging, so the stamp and the coach's reading arrive together "
        + 'instead of behind a 20-40 second model call. The submit replays through an idempotency key, so playing '
        + 'this slide writes no new attempt — which is also what keeps the next slide\'s first tile correct. '
        + 'At 30 seconds this is the longest slide in the talk and it should be: it is the only place the audience '
        + 'sees the product do the thing the previous six slides argued for. It can be held past 30 indefinitely — '
        + 'once the page is at rest nothing moves again, so there is no cliff and no reason to rush.',
    },
  },
  {
    id: 'demo-case-verdict-review',
    section: 'product',
    kind: 'demo',
    eyebrow: 'Act IV — proof',
    headline: 'And that question is waiting in review.',
    // REPURPOSED, AND THIS IS THE WIN. This slide used to re-display a verdict
    // the previous slide was forbidden to earn — a whole slide, a second staged
    // session and an iframe reload spent showing a ruling that should have
    // landed thirty seconds earlier. The autoplay demo now earns the verdict in
    // its own frame, which frees this slide entirely.
    //
    // What it does instead is the beat the founders asked for at the very start
    // of this project and that has been missing from every revision since:
    // *seeing a snapshot of that specific question in review within the
    // dashboard*. It closes the loop. The room watches a question get answered,
    // then watches it turn into a durable record with the reasoning and the
    // coaching still attached to it — which is the argument that this is a
    // system rather than a quiz, and it is the setup for the dashboard slide.
    //
    // The old headline, "Then it tells you where you broke", moved to the
    // previous slide's job when the verdict moved there. This one names what is
    // actually on screen.
    notes:
      "And it doesn't vanish. Here's that same question in review — "
      + 'my reasoning, the ruling on it, and where it sits against everything else I have argued. '
      + 'Every rep is kept.'
      + ' ⟢ THE TILE YOU WANT IS THE FIRST ONE, and staging puts it there — the log is newest-first and the '
      + 'driven attempt is stamped to sort above everything else on the account. Verified on three live runs. '
      + 'If the top tile is somehow the wrong question, do not hunt: say "here is one from earlier" and open '
      + 'any tile, because every one shows the same anatomy. '
      + '⟢ WHAT TO POINT AT, IN ORDER — "WHAT YOU WROTE", then "COACH". Those two headings side by side are '
      + 'the entire argument: the record keeps the student\'s own words and the grading of them, not a score. '
      + 'Do not read either aloud in full. '
      + '⟢ IF ASKED WHETHER THAT WAS LIVE — same answer as the previous slide. Real submit, real stored attempt, '
      + 'grading computed at staging. Offer to run one cold in Q&A.',
    speaker: 'Alan',
    budgetSeconds: 13,
    scene: { id: 'none', framing: 'still' },
    // A cut, and now it is an honest one. This used to be "no slide change as
    // far as the audience is concerned" — the verdict stamp landing while the
    // title bar quietly relabelled — which was a fiction covering a reload
    // between two staged case sessions that the room could see perfectly well.
    // There is still exactly one warm reload here, because the deck and the app
    // are on different origins and a route change means reassigning `src`. What
    // changed is that it is now a navigation the audience is *meant* to watch:
    // the beat is the question travelling off the case screen and into a
    // permanent record, so the app moving is the point rather than the cost.
    transition: 'cut',
    demo: {
      // The answer wall, which is where review lives. `?tab=` names the panel:
      // the Answer Log is behind a dashboard tab rather than below the fold, so
      // a bare `/progress` opens on the skills matrix and leaves the presenter
      // two clicks from the entire subject of the slide. The app selects the
      // named panel and scrolls the tab strip to the top of the frame, so this
      // lands on the tile wall rather than on the summary header above it.
      //
      // This is as deep as a URL goes. The router has no per-attempt route, so
      // the drawer is still opened by clicking the first tile — that is the
      // slide's second beat rather than a shortcoming of the link.
      route: '/progress?tab=answers',
      // Captured for this slide and nothing else: the Answer Log with the first
      // tile open and both "WHAT YOU WROTE" and "COACH" in frame. It replaces
      // `demo-progress.png`, which belongs to `demo-mega-litigation` and shows
      // the top of the dashboard — a fallback that rendered perfectly while
      // making none of this slide's point, which is the worst of the three
      // states a still can be in. `recapture-stills.mjs` now checks both
      // headings are actually in the frame before it keeps the bytes.
      still: 'demo-answer-log.png',
      width: 1440,
      zoom: 1.06,
      budgetSeconds: 12,
      context: 'Context A, continuing',
      clickPath: [
        { start: 0, end: 4, action: 'Land on the dashboard and go straight to the **Answer Log** — the tile wall, "every question you have answered". Do not tour the rest of the page.' },
        { start: 4, end: 7, action: 'Click the **first tile**. It is the question the room just watched, because the log is newest-first.' },
        { start: 7, end: 12, action: 'The drawer opens. Point at **WHAT YOU WROTE**, then **COACH**. Do not read either in full, and do not scroll past them.' },
      ],
      skip: [
        'the projection chart and the rest of the dashboard',
        'the cash and reputation change',
        'the filter and outcome controls above the tile wall',
        'the review queue mechanics',
        'closing the drawer — advance with it open',
      ],
      staging:
        'THE FIRST TILE IS THE ATTEMPT THE ROOM JUST WATCHED — confirmed on three consecutive live runs, and '
        + 'guaranteed at the source rather than hoped for. The log is newest-first by the attempt\'s creation '
        + 'time, and the pre-graded twin of the same question used to outrank it, so `stage_demo.py` now stamps '
        + "the driven attempt's `created_at` as it stages. Both tiles are that question and both are correct, "
        + 'so the wrong one is not detectable by looking at it — only by reading the reasoning and noticing it is '
        + 'not the text that was on screen thirty seconds earlier. '
        + 'THE ONE WAY TO BREAK IT: any new attempt on this account after staging takes the top tile, and playing '
        + 'the previous slide does NOT count, because the driven submit replays through an idempotency key and '
        + 'writes no row. So rehearse freely, but if anyone works a case by HAND on this account, re-run '
        + '`npm run stage-demo:fast` before the talk. If the top tile is somehow not the right question, the '
        + 'fallback is in the notes: open any tile, since every one has the same anatomy. '
        + 'The route carries `?tab=answers` because the Answer Log is behind a dashboard tab, not below the fold. '
        + 'Advancing here reassigns the frame from the case to the dashboard: one warm reload of an app that is '
        + 'already signed in, which `verify-demo-continuity.mjs` holds to exactly one. '
        + 'The coaching is already stored on the attempt, so the drawer paints without a spinner. '
        + 'IN STILLS MODE the frame is frozen at the third beat — the open drawer, with both headings in view and '
        + 'the tile wall scrolled off above it. That is the right frame to keep, since it is the payoff, but it '
        + 'means the first two beats are described rather than shown: say "every question I have answered is on '
        + 'this wall" instead of pointing at it.',
    },
  },
  {
    id: 'demo-mega-litigation',
    section: 'product',
    kind: 'demo',
    eyebrow: 'Act IV — proof',
    headline: 'The full test, and the blind review after it.',
    notes:
      'Full-length test, one sitting. Afterwards you redo every miss untimed, with no key — '
      + 'right when untimed means time pressure, wrong twice means a reasoning gap. '
      + 'Those types are what you get fed tomorrow.',
    speaker: 'Alan',
    budgetSeconds: 14,
    scene: { id: 'none', framing: 'drift' },
    transition: 'cut',
    demo: {
      route: '/progress',
      still: 'demo-progress.png',
      width: 1440,
      zoom: 1.06,
      budgetSeconds: 14,
      context: 'Start in Context A, jump to Context B',
      // The answer-one-question-untimed beat is gone. It cost ten seconds to
      // re-show an interaction the room watched in full two slides ago, and
      // blind review is a concept the sentence carries on its own — what needs
      // to be *seen* is the two scores side by side, which is the audit.
      clickPath: [
        { start: 0, end: 4, action: 'On the dashboard, point at the mega-litigation card. One sentence on what it is. Do not start one.' },
        { start: 4, end: 9, action: 'Switch to Context B, already on the completed audit. Timed score beside untimed score. Say nothing extra.' },
        { start: 9, end: 14, action: 'Back to the dashboard. Point at the panel naming the weak question types this form found.' },
      ],
      skip: [
        'starting a real form',
        'the blind review interstitial itself — describe it, do not drive it',
        'reading any question aloud',
        'accommodation settings',
        'the section clock rules',
        'the per-section breakdown',
        'the firm tier promotion, which lands on `game-never-gates`',
      ],
      staging:
        'Context B must already be on the COMPLETED AUDIT before the talk starts — not on the blind review '
        + 'interstitial, which is no longer visited. This is the only slide in the demo act that carries a chart: '
        + 'timed score beside untimed score, the gap labelled *time pressure* and the shared shortfall below both '
        + 'labelled *reasoning*. Four seconds of the fourteen are a context switch; rehearse the window swap.',
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
    // THE ONE SPOKEN CUT IN THIS PASS, and it is the same defect as the fragment
    // lines: the script opened by reading the headline out loud and then read
    // the standfirst out loud after it. Both are on screen, in the two largest
    // faces the layout has. What is left is the pair of clauses that are not
    // printed anywhere — why first-attempts-only matters, and what happens to a
    // comparison before its sample is big enough. 29 words to 17, so the budget
    // comes off 12 to 8.
    notes:
      'First attempts only, so re-answering inflates nothing. '
      + "And comparisons stay suppressed until there's enough evidence behind them."
      + ' ⟢ IF CHALLENGED — the scheduler is a trained model rather than fixed boxes: Settles and Meeder cut recall '
      + 'error more than 45% over a Leitner system at Duolingo scale. Do not let that drift into "improved learning" — '
      + 'their live experiment measured practice activity, not learning gains. Confident misses head the repair queue, '
      + 'on Metcalfe. Correctness always comes from the verified answer key, never from the model.',
    speaker: 'Alan',
    budgetSeconds: 8,
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
    headline: "Currency doesn't teach. It makes you practice.",
    deck: 'Three courses, three universities, currency isolated from every other game element. One thing moved.',
    // The multiples came off the fragment line. They are the largest type in
    // the figure — 1.3×, 2.5×, 3.7× set at display scale down the right-hand
    // edge, under a measure label that already says "per student" — so
    // "1.3× to 3.7× the practice" was the chart's own numerals repeated at a
    // tenth of the size, and it repeated them as a range, which is a fourth
    // number the study does not report.
    //
    // The two nulls stay, and stay as fragments rather than being left to the
    // figure's `did not move` rule, which is set at hairline weight. They are
    // the reason a room that distrusts gamification believes the rest of the
    // slide, so they are the one thing here that has to be legible from the
    // back. See `CITATIONS.md` §6.
    points: [
      'Intrinsic motivation: unchanged',
      'Course grades: not significant',
    ],
    // "Higher Education 2(3)" was wrong and was the exact failure this deck's
    // checkable-numbers strategy exists to prevent: it is a different, very
    // well-known Springer journal, and anyone searching the citation as printed
    // would not have found the paper. It is MDPI's *Trends in Higher Education*.
    credit: 'Dicheva et al. (2023), Trends in Higher Education 2(3) — 171 students, three universities, quasi-experimental',
    // The mechanism, not the mechanic. This slide used to compare points against
    // badges (Meng), which is a choice between two game elements and does not
    // say why a currency makes anyone answer another question. It now carries
    // the only study in the literature that isolated virtual currency from every
    // other element and ran it in three courses at three universities: practice
    // volume went up between 1.3× and 3.7× per student, and neither intrinsic motivation nor
    // final grades moved. That pair is the whole argument. The currency buys
    // reps — which slide 2 already priced at 2.77 against 0.22 — and buys
    // nothing else, which is exactly why it has to sit on top of the engine
    // rather than replace any part of it, and why `game-never-gates` is true by
    // construction rather than by promise.
    //
    // The two nulls stay on the slide. They are the reason a room that distrusts
    // gamification believes the rest of it. See `CITATIONS.md` §6.
    // The multiples are PER STUDENT, from Table 3's "average # unique warm-ups
    // taken", and they were group totals until the primary paper was read
    // against them. The totals are the more flattering pair of numbers — 1.4×,
    // 3.7×, 2.7× — and they are also the paper's own headline, but the three
    // experimental groups are not the same size as their comparison groups
    // (Study B ran 49 against 33), so part of a group total is just headcount.
    // Anyone who opens Table 3 can see that, and a pitch cannot afford a number
    // that dissolves when the source is opened. Per student it is 1.3×, 2.5×,
    // 3.7×, which is published in the same table, survives the objection, and
    // still lands a near-quadrupling in the strongest case. See `CITATIONS.md`
    // §6.1.
    figure: {
      kind: 'currency-lift',
      measureLabel: 'unique practice sets per student, each course against its own comparison group',
      controlLabel: 'no currency',
      rows: [
        { course: 'Discrete Mathematics', venue: 'public university, NC', multiple: 1.3 },
        { course: 'Discrete Structures', venue: 'private research university, PA', multiple: 2.5 },
        { course: 'Computer Networking', venue: 'private university, MO', multiple: 3.7 },
      ],
      unmovedLabel: 'did not move',
      unmoved: ['intrinsic motivation', 'final course grades'],
    },
    notes:
      'Back to the fifty-one percent. Dicheva isolated virtual currency in three courses. '
      + 'Practice went up thirty percent to nearly four times per student. '
      + "Motivation and grades didn't move. It buys reps. That's the job."
      + ' ⟢ IF CHALLENGED — Dicheva and colleagues, 2023, Trends in Higher Education, 171 students across three '
      + 'universities, currency isolated as the single gamification element. Lead with the two nulls; they are why '
      + 'the rest is believed. The multiples on screen are PER STUDENT from Table 3 — the paper\'s own headline uses '
      + 'group totals, which are flattering and partly headcount, and we deliberately do not use them.',
    speaker: 'Alan',
    // 21 before the constraint slide existed. Two seconds come off the front:
    // the opening sentence used to have to establish that a motivation layer was
    // worth having at all, and Act II now does that with LSAC's own data, so this
    // slide only has to say which mechanism and what it does not buy.
    budgetSeconds: 13,
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
      "We didn't guess the design. Clark's meta-analysis: single-player, stylized, thin story, many short sessions. "
      + 'Our game is all four.'
      + ' ⟢ IF CHALLENGED — Clark, Tanner-Smith and Killingsworth, 69 samples, 6,868 participants. '
      + 'The age caveat is already printed on the slide and should be volunteered: the average participant was about '
      + 'thirteen, so we treat it as design guidance rather than proof. A fifth split not on the slide favours us too — '
      + 'an irrelevant story scored about 0.63 against 0.17 for a story woven into the content, which is exactly the '
      + 'law-firm-outside-the-question separation. The adult-learner literature is in the Q&A notes.',
    speaker: 'Alan',
    budgetSeconds: 8,
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
      'A client sits down. Taking their case is starting a practice run. '
      + 'The fee is the stake, visible before you begin.'
      + ' ⟢ IF CHALLENGED — the fee is settled before the question starts and after it ends, never while it is on '
      + 'screen. That is a Kienitz constraint, not a taste: decorative material lowers recall when a learner thinks '
      + 'it matters. Full answer in the Q&A notes under "the game competes with the studying".',
    speaker: 'Alan',
    budgetSeconds: 9,
    scene: { id: 'none', framing: 'still' },
    // The four beige bars rotate into the vertical and become the columns of the
    // office as the live app opens.
    transition: 'cut',
    demo: {
      route: '/office',
      still: 'demo-office.png',
      width: 1440,
      zoom: 1.06,
      budgetSeconds: 9,
      context: 'Context A',
      clickPath: [
        { start: 0, end: 4, action: 'On /office, point at the client character seated in the waiting area. Say who they are.' },
        { start: 4, end: 9, action: "Click through to the practice lobby. Point at the fee line. Do not read the client's name." },
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
      'You start here. And this is where it ends up. '
      + 'One path between those two rooms — thousands of LSAT questions.'
      + ' ⟢ PRESS **O** ONCE, after "you start here", and then say nothing for five seconds. O is the only key on '
      + 'this slide. It works the same way whether the app is live or you are on stills, so if the stack has died '
      + 'this beat still happens — do not skip the slide. '
      + '⟢ IF YOU PRESS IT EARLY OR TWICE — press it again. It toggles both ways, and the room reads a second '
      + 'rebuild as part of the effect. Do not reach for the mouse. '
      + '⟢ THE ORBIT IS THE APP\'S, NOT YOURS. Let it run. The rebuild plus the orbit is the five seconds; if you '
      + 'talk over it you have spent the slide and shown nothing.',
    speaker: 'Alan',
    budgetSeconds: 9,
    scene: { id: 'none', framing: 'still' },
    // "Cut straight to slide 19. No animation. The cut is the effect."
    transition: 'cut',
    demo: {
      route: '/office?officeTier=0',
      still: 'demo-office-tier0.png',
      // THE MECHANISM THE SLIDE WAS MISSING. This slide is scripted as a toggle
      // and had nothing that toggled: one route, pinned at tier 0, and `L`
      // merely reloaded it. The before/after — the entire point — could not
      // happen, live or on the fallback.
      //
      // `demo-office-tier14.png` already existed and was referenced by nothing,
      // which is why the stills path costs no new capture: press the key with
      // `?stills=1` on and the two pictures swap, so the beat survives the whole
      // stack being dead. That is the state in which this slide most needs to
      // work, since it is the one demo the cut list marks as never to be cut.
      //
      // `officeAll=1` alongside the tier is not optional — without it the scene
      // renders the tier's shell but not the staff and furniture that make the
      // room read as built, and the line being spoken is about the objects.
      toggle: {
        route: '/office?officeTier=14&officeAll=1',
        still: 'demo-office-tier14.png',
        // `O` for office. It is the only key on this slide, so there is nothing
        // to confuse it with while the five silent seconds run, and its
        // neighbours are all harmless: `L` reloads this same route, `P` opens
        // the presenter overlay, `I` and `K` do nothing.
        //
        // NOT `T`, which is the obvious mnemonic and is already taken. `T`
        // brings the start card back over the running deck, and it is bound in
        // `start/use-start-gate.ts` as a *capture-phase* window listener that
        // calls `stopPropagation()` — so it wins silently and no handler further
        // down ever sees the key. That file's own comment predicted this: "the
        // deck has no `t` case today, but a deck that grew one would silently do
        // both things." It was tried, and what actually happened on stage would
        // have been the title card dropping over the money shot.
        // `scripts/verify-office-toggle.mjs` caught it on its first run, which
        // is the reason that script exists rather than a bare eyeball pass.
        key: 'o',
        label: 'tier 14 — the built firm',
      },
      width: 1440,
      zoom: 1.06,
      budgetSeconds: 9,
      context: 'Context A, two pre-staged save states',
      // The only demo whose second-count was NOT cut proportionally. Nine of the
      // original eighteen would have meant cutting the rebuild, and the rebuild
      // is the slide — so the two talking beats lost eight seconds between them
      // and the silent one kept five of its eight.
      clickPath: [
        { start: 0, end: 2, action: 'Tier 0 office. "You start here." Nothing else.' },
        { start: 2, end: 7, action: 'Press **O** to toggle to tier 14. SAY NOTHING while the room rebuilds and the camera orbits.' },
        { start: 7, end: 9, action: 'One line: one path between those rooms, and it is questions.' },
      ],
      skip: [
        'naming individual upgrades',
        'staff hiring',
        'cosmetics',
        'the intermediate tiers',
        'the office cat, however tempting',
      ],
      staging:
        'ONE KEY: **O** (for office), and it is the only thing to press on this slide. It swaps the embed between the app\'s two '
        + 'real tier overrides — `?officeTier=0` and `?officeTier=14&officeAll=1` — in the same iframe element, so the '
        + 'app is never reloaded from cold. Press it again to go back; a mis-press is one more press rather than a '
        + 'stranded slide. Leaving the slide resets it to tier 0, so a second run-through starts on the shack again '
        + 'instead of playing the transformation backwards. '
        + 'IT WORKS ON STILLS TOO — with `?stills=1` or after `S`, O swaps `demo-office-tier0.png` for '
        + '`demo-office-tier14.png`. The before/after is the whole slide, so it had to survive the stack being dead; '
        + 'this is the one demo the cut list says never to cut. '
        + 'The tier overrides are DEV query parameters and only exist under `npm run dev` — never against a '
        + 'production build. '
        + 'The money shot, and it earns its length by being short. Do not crossfade — let the real scene rebuild with the '
        + 'camera locked in the same position so the room grows around a fixed viewpoint, then release the camera into one '
        + 'slow 20-degree orbit. Hold the final frame a full second in silence before speaking. Rehearse this one — '
        + 'at nine seconds it is the least forgiving slide in the talk, and the five silent seconds are not optional. '
        + 'The tier-14 scene is the heaviest thing in the deck: the start card warms the office route in a hidden frame, '
        + 'but if O is pressed within a second or two of the slide arriving the rebuild can still be visibly slow. '
        + 'That is what the five silent seconds are for.',
    },
  },
  {
    id: 'demo-map-and-firm',
    section: 'game',
    kind: 'demo',
    eyebrow: 'Act V — live',
    headline: 'The world, and the ledger.',
    notes:
      'Your firm sits on a career map. This is where you spend — upgrades, staff, the next headquarters. '
      + 'All priced in cases.',
    speaker: 'Alan',
    budgetSeconds: 8,
    scene: { id: 'none', framing: 'drift' },
    // The camera dollies out through the tier-14 window and keeps going until the
    // city resolves into the career map: the deck's matched two-canvas dolly.
    transition: 'camera',
    demo: {
      route: '/map',
      still: 'demo-map.png',
      width: 1440,
      zoom: 1.06,
      budgetSeconds: 8,
      context: 'Context A',
      clickPath: [
        { start: 0, end: 4, action: 'Open /map. One camera pull-back. Point at the current headquarters node and the locked one after it.' },
        { start: 4, end: 8, action: "Open /firm. Do not scroll. Point at one requirement line saying exactly what's missing." },
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
        + 'Already trimmed to the bone at 8 seconds — the scroll and the closing sentence are gone. '
        + 'If the talk is still running long, this is the first demo to cut entirely.',
    },
  },
  {
    id: 'demo-focus-mode',
    section: 'game',
    kind: 'demo',
    // NOT "Act V — live" like its six siblings, because it is not. The frame no
    // longer announces `STILLS` to the room — that lamp is presenter-only now —
    // so this eyebrow is the audience's only cue not to expect an interaction,
    // and claiming "live" over a frozen frame would be the deck contradicting
    // itself in two places a metre apart.
    eyebrow: 'Act V — the switch',
    headline: 'Or delete all of it.',
    // STILL, NOT LIVE — founders' call, and the reasoning is worth keeping.
    // This was the third visit to `/progress` in the talk and the click was a
    // menu toggle: the audience learns nothing from watching a nav bar shorten
    // that they do not learn from seeing it already short. What they must leave
    // with is the *fact* — focus mode exists, and the game is a preference
    // rather than a lock — and a frozen frame carries a fact as well as a live
    // embed does. So the frame stays and the seven seconds of embed goes.
    //
    // The sentence had to keep BOTH founder asks, not just the switch: that the
    // toggle exists, and that practice drives the game rather than the reverse.
    // The second half of the note is that inversion said out loud, because it
    // is the last thing before `game-never-gates` argues it.
    notes:
      'One switch deletes the game — no firm, no map. '
      + 'It only ever ran one way: practice moved the game, never the reverse.'
      + ' ⟢ SHOWN AS A STILL, DELIBERATELY. Do not apologise for it and do not reach for the mouse. '
      + 'If someone asks to see it toggle, it is one click in Q&A. '
      + '⟢ IF CHALLENGED — this is also the autonomy answer. Self-determination theory separates STRUCTURE from '
      + 'CONTROL, and Focus Mode is the valve that keeps us on the structure side. '
      + 'Full version in the Q&A notes under `no-question-choice-is-controlling`.',
    speaker: 'Alan',
    budgetSeconds: 8,
    scene: { id: 'none', framing: 'still' },
    transition: 'cut',
    demo: {
      // `/office`, not `/progress`, and the route is not decoration here — it is
      // the caption printed in the frame's title bar, directly above the
      // picture. The still is captured at `/office` because that is the route
      // where the point is visible: with Focus Mode on, the nav collapses to
      // Dashboard and Practice, so the room can see that what was taken away is
      // the game and not the practice, while the score and case count stay in
      // the header. A `/progress` caption over an `/office` frame is the deck
      // contradicting itself in two adjacent elements.
      route: '/office',
      // `demo-progress.png` was wrong here — it is the plain progress route, and
      // this slide's entire content is what is MISSING from the navigation bar,
      // which a plain capture cannot show.
      still: 'demo-focus-mode.png',
      stillOnly: true,
      width: 1440,
      // Cropped tight and scaled up: this slide is a navigation bar read from the
      // back of the room, and that matters more now that it is frozen — a still
      // gets exactly one chance to be legible.
      zoom: 1.35,
      budgetSeconds: 6,
      context: 'Context A',
      clickPath: [
        { start: 0, end: 6, action: 'Nothing to click — this is a still. Point once at the shortened nav: Dashboard and Practice, and nothing else. Say the two lines.' },
      ],
      skip: ['everything — one still, two sentences'],
      staging:
        'Frozen frame, by decision rather than by fallback: `stillOnly` keeps it a still even with the app running '
        + 'and the origin healthy, so a working backend cannot accidentally turn this back into a live embed. '
        + 'The title-bar lamp will read "stills" on this slide only, which is correct and not a fault. '
        + 'The image must show the nav ALREADY collapsed to Dashboard and Practice — a plain /progress capture does '
        + 'not make the point, because the whole content of the slide is what is missing from the bar.',
    },
  },
  {
    id: 'game-never-gates',
    section: 'game',
    kind: 'figure',
    field: 'blue',
    eyebrow: 'Act V',
    headline: 'The game never gates the practice.',
    // The headline states the coupling negatively and the standfirst states it
    // positively, which is the slide. "It only runs in that direction" was a
    // third statement of the same proposition, in a frame where the figure's
    // struck-out reverse arrow is already a fourth.
    deck: 'The practice gates the game.',
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
      'This is structural, not a disclaimer. The game exists to get the reps done, '
      + 'so the only path through it is the reps. The firm never unlocks a question.'
      + ' ⟢ IF CHALLENGED — every gamification source we read says the same thing: a complement to good practice, '
      + 'never a replacement. A student who never opens the office loses nothing except the office.',
    speaker: 'Alan',
    budgetSeconds: 11,
    scene: { id: 'tiers', framing: 'nexus' },
    transition: 'camera',
  },

  // ═══════════════════════════ ACT VI — THE CLOSE ════════════════════════════
  {
    id: 'close-one-stop-shop',
    section: 'close',
    kind: 'statement',
    eyebrow: 'Act VI — the close',
    // "Two doors" named a visual that is no longer on screen — the close used
    // to be a wall with two openings cut into it, and the founders replaced
    // that with one figure in a bare room. A headline pointing at scenery the
    // audience cannot see is worse than no headline. The count stays because
    // the argument is the count; only the noun moves off the scenery.
    //
    // "Ways in" rather than "doors" also stops the headline fighting the deck
    // line below it. Doors are things you pick between, and the line under it
    // says you do both.
    headline: 'One place. Two ways in.',
    // `And`, not `Or`. The two ways in are not alternatives: the firm only
    // grows on questions answered, so the second clause is a consequence of the
    // first and never a substitute for it. `Or` offered the room a choice
    // between them and in doing so conceded that the game is severable — the
    // exact framing `concept-lawyer-tycoon` was rewritten to stop making. The
    // second half is also shorter now, because the mechanism it used to spell
    // out is what the room has just watched the office do for four slides.
    deck: 'Walk in and answer questions. And build the firm they pay for.',
    // The Q&A prompt. This slide is held on screen for the entire question
    // period, so the last line of the deck is an invitation rather than a
    // sign-off. With the ledger gone it is the only thing under the rule, which
    // is the right amount of weight for it: it is what the founders stop
    // talking on, not a fourth claim.
    pull: 'Questions?',
    // THE THREE-CLAUSE LEDGER IS GONE. It was the slide's third register of text
    // — under an eyebrow, a headline and a two-line deck — on the one frame that
    // is held for the whole question period, and it was the only one of the four
    // that argued rather than concluded: cheaper, narrower and harder to quit
    // re-litigate the pricing and coverage the deck already made its own acts
    // about. The founders asked for less on this slide, and then asked for a
    // much cleaner ending on top of that, so it does not come back with the new
    // room.
    //
    // Nothing is lost from the talk. All three are still spoken in `notes`, and
    // all three are still claims a questioner can check — the cost structure,
    // the removed override from `concept-lawyer-tycoon`, and `game-never-gates`
    // restated. They are answers to hold, not a list to project behind them.
    //
    // The `.ledger` rules this slide used to need are gone from `deck.css` with
    // it, so nothing is left clipping a list that no longer exists.
    notes:
      'Three reasons we win. Cheaper — no video studio, no instructors. '
      + "Narrower — you can't drill only what you're good at. "
      + 'Harder to quit — the game runs on questions. One place instead of five. Thank you.',
    speaker: 'Nischay',
    budgetSeconds: 13,
    // A bare royal-blue room, the counsel stage right, lit from the right and
    // throwing a real shadow across the floor. She folds her arms on arrival
    // and holds that pose for the entire Q&A.
    //
    // NOT the built office, which this replaced. Sixteen people at work is a
    // *place*, and a place is not a thing an audience looks at for twenty
    // minutes; the founders' word for it was "generic". Nor
    // `office-transform`, which is a loop that never settles behind copy that
    // is held for the entire Q&A.
    scene: { id: 'close-room', framing: 'wide' },
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

/** Total budgeted runtime, for the presenter overlay's pacing figure. 4:50. */
export const TOTAL_BUDGET_SECONDS = SLIDES.reduce((sum, slide) => sum + (slide.budgetSeconds ?? 45), 0)

/**
 * Total seconds spent inside a live app frame. 1:22 across six slides, and the
 * number the founders asked to be held to.
 *
 * `stillOnly` slides are excluded, which they were not before: `demo-focus-mode`
 * carries a `demo` block for its route and caption but never mounts a frame, so
 * counting its 6 seconds made this 1:28 and made the one number the founders
 * watch disagree with every table in the docs. Nothing reads this — the presenter
 * overlay paces against `TOTAL_BUDGET_SECONDS` — so it is here to be quoted, and
 * a figure that exists only to be quoted has to be the figure it claims to be.
 */
export const DEMO_BUDGET_SECONDS = SLIDES.reduce(
  (sum, slide) => sum + (slide.demo && !slide.demo.stillOnly ? slide.demo.budgetSeconds ?? 0 : 0),
  0,
)
