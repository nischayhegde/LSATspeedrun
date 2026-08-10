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
 *  This is the only revision that has moved the runtime. The deck is **10:04**;
 *  §C of the narrative carries the new table and the two cheapest ways back
 *  under ten minutes. Evidence for the new slide is `CITATIONS.md` §7.
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
    deck: 'LSAC matched the usage logs of the free platform it ran with Khan Academy to real LSAT scores. The method is not in dispute. Finishing it is.',
    points: [
      // "from practice time" asserted production. LSAC pre-empts that phrasing
      // two paragraphs under the figure it comes from: the numbers are "not
      // gains... but rather increments for independent groups of students".
      // Every correction to this slide lives on screen rather than in the notes,
      // because a compressed talk drops notes and keeps fragments.
      '+4.3 points, top decile vs bottom',
      // LSAC's literal verb. "No relationship" is broader than "not correlated",
      // which is a statement about linear association — and the slide attributes
      // the phrase to them on screen, so it has to be their phrase.
      'Video minutes: not correlated',
      '51% never finished one exam',
      // The deck's third and last competitive line, and it uses the same device
      // as the two before it: a bare parallel sentence, arriving last, naming
      // nobody. It is the active-against-passive axis rather than the price
      // axis, which matters because price is the one axis LSAT Demon can meet.
      // "Hours" is the field's own unit — every product in `CITATIONS.md` §4 is
      // described by its instruction hours, lesson counts or class schedule —
      // and the room already has the referent from slide 3's 250.
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
    // ACTIVE-VS-PASSIVE, BEAT 4 — the proof. "Nothing here is watching" is four
    // words and it is the whole through-line cashed out: the room has been told
    // twice that this product is active, and this is the twenty-five seconds
    // where they see what that means. Every beat below is the student producing
    // something — a markup, a choice, a written argument, a confidence rating —
    // and not one of them is reception.
    notes:
      'Real LSAT questions from released exams. Nothing here is watching. '
      + "This one's an Assumption question, and the method up top is Prephrase Before Choices. "
      + 'I mark the stimulus, pick (C), and then the box nobody else makes you do: '
      + "my reasoning, in my own words, before I'm allowed to see anything. Then confidence."
      + ' ⟢ THE ANSWER IS (C). Say the letter once and move — do not read the choice aloud, and do not read the '
      + 'other four. If you lose your place: the stimulus says discoveries shape how societies develop, so '
      + 'predictions about high-discovery societies are untrustworthy, and (C) is the assumption that the '
      + 'discoveries themselves cannot be reliably forecast. (A) is the trap — it is about discoveries doing harm, '
      + 'and the argument is about whether predictions can be trusted, not whether they hurt. '
      + '⟢ DO NOT SUBMIT ON THIS SLIDE, and do not say a word that implies you will. The script ends on '
      + '"then confidence" for that reason. Submitting starts a fresh attempt and a live model call; the graded '
      + 'verdict you want is already waiting on the next slide. '
      + '⟢ YOU NEVER TYPE. The reasoning is already in the box. Read its first clause; do not touch the keyboard.',
    speaker: 'Alan',
    budgetSeconds: 21,
    scene: { id: 'none', framing: 'still' },
    // The unfinished outer ring of `pov-real-clock` snaps closed and becomes the
    // border of the live app frame. Demo mode begins.
    transition: 'letterbox',
    demo: {
      route: '/cases/{session}',
      still: 'demo-case.png',
      width: 1440,
      zoom: 1.12,
      budgetSeconds: 20,
      context: 'Context A',
      // Down from 56s, and the cut is beats rather than pace: the removed time
      // was the room watching a cursor travel between things the presenter was
      // already describing. The two beats that explain the most per second — the
      // scratchpad drag and the written reasoning — kept most of their length,
      // because they are what the active-versus-passive through-line cashes out
      // on. Every beat here is the student producing something rather than
      // receiving it, and that is the point the room should leave the demo with.
      clickPath: [
        { start: 0, end: 4, action: 'Point at the strategy brief at the top of the question. Say its name — **Prephrase Before Choices**. Do not read the three steps aloud.' },
        { start: 4, end: 9, action: 'Drag-highlight exactly one clause in the stimulus. One drag only.' },
        { start: 9, end: 12, action: 'Select answer choice **(C)**. It is the credited answer; do not read the other four.' },
        { start: 12, end: 18, action: 'Scroll the pre-filled reasoning into view. Read only its first clause aloud. Do not type.' },
        { start: 18, end: 20, action: 'Click confidence 4. Do NOT submit — advance the slide instead.' },
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
        + 'The reasoning field is pre-filled by the seeder; typing it live costs about forty seconds the deck does not have. '
        + 'At 21 seconds this is still the longest slide in the talk and it should be: it is the only place the audience '
        + 'sees the product do the thing the previous six slides argued for.',
    },
  },
  {
    id: 'demo-case-verdict-review',
    section: 'product',
    kind: 'demo',
    eyebrow: 'Act IV — proof',
    headline: 'Then it tells you where you broke.',
    // THE FIRST SENTENCE IS LOAD-BEARING AND IT IS NOT ABOUT THE ARGUMENT.
    // Advancing here reassigns the iframe `src` — the two slides point at
    // different sessions — so there is a real app reload under this beat. That
    // pause reads as a bug when it is silent and as a transition when it is
    // spoken over, so "here's what came back" exists to cover it, and it is a
    // sentence the presenter would have said anyway rather than a stall.
    //
    // It is also literally true. The coaching on screen is genuine output from
    // the real model, generated ahead of time and stored, so it did come back —
    // just not in the last two seconds. Nothing in this script claims a live
    // call is happening, and nothing should be added that does.
    notes:
      "Here's what came back. It grades my reasoning, not my letter — ninety-five, "
      + 'and it names what I got right: I focused on reliability, not on whether discoveries do harm. '
      + "And it's not a popup — every question I've answered is in the dashboard."
      + ' ⟢ SAY THE FIRST SENTENCE OVER THE RELOAD. The app is reassigning the frame to the graded session and '
      + 'you will see a beat of blank. Start talking on the keypress, not after the paint. '
      + '⟢ IF ASKED WHETHER THAT WAS LIVE — answer plainly: the coaching is real output from the model we ship, '
      + 'run ahead of time and stored, because a frontier call takes twenty to forty seconds and we were not going '
      + 'to spend a third of the talk watching a spinner. Offer to run one cold in Q&A. Never claim it just '
      + 'generated on stage. '
      + '⟢ THE 95 IS DELIBERATE. A low score here would read as a strawman; a high score with a specific '
      + 'compliment is what demonstrates that the grade is about the reasoning rather than the letter.',
    speaker: 'Alan',
    budgetSeconds: 17,
    scene: { id: 'none', framing: 'still' },
    // No slide change as far as the audience is concerned: the verdict stamp
    // lands and the title bar quietly relabels. 12 and 13 are one shot.
    transition: 'cut',
    demo: {
      // The pre-graded twin, not the open case. Its attempt already carries
      // stored coaching, so the verdict and the coaching panel paint from the
      // database. Submitting live instead would put a 20-40 second frontier
      // model call on stage, which is the single largest risk in the talk.
      route: '/cases/{verdictSession}',
      still: 'demo-case.png',
      width: 1440,
      zoom: 1.06,
      budgetSeconds: 14,
      context: 'Context A, continuing',
      clickPath: [
        { start: 0, end: 4, action: 'Talk over the reload — say "here\'s what came back" on the keypress. Then read the verdict line in one sentence. Do not itemize answer, explanation and time points.' },
        { start: 4, end: 10, action: 'Open the coaching panel. Point at the **95** and read one clause of the "got right" line.' },
        { start: 10, end: 14, action: 'Click **Dashboard** in the nav — land on the history with the reasoning attached. Do not scroll.' },
      ],
      skip: [
        'scrolling the rest of the dashboard',
        'the cash and reputation change',
        'the next question',
        'the review queue mechanics',
      ],
      staging:
        'Advancing from the previous slide reassigns the iframe to the pre-graded case, which IS a real app reload — '
        + 'the two slides are different sessions. That is the deliberate trade that removes a 19-40 second live model '
        + 'call from the stage, and the script covers the pause with a spoken line rather than leaving it silent. '
        + 'The coaching is already stored on the attempt, so once it paints there is no spinner. '
        + 'Do not click Submit on the previous slide — the verdict you want is already on this screen.',
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
    notes:
      'Everything it watches, on one slide. First attempts only, so re-answering inflates nothing. '
      + "Every figure carries how much evidence is behind it, and comparisons stay suppressed until there's enough."
      + ' ⟢ IF CHALLENGED — the scheduler is a trained model rather than fixed boxes: Settles and Meeder cut recall '
      + 'error more than 45% over a Leitner system at Duolingo scale. Do not let that drift into "improved learning" — '
      + 'their live experiment measured practice activity, not learning gains. Confident misses head the repair queue, '
      + 'on Metcalfe. Correctness always comes from the verified answer key, never from the model.',
    speaker: 'Alan',
    budgetSeconds: 12,
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
    points: [
      '1.3× to 3.7× the practice',
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
      + 'One path between those two rooms — thousands of LSAT questions.',
    speaker: 'Alan',
    budgetSeconds: 9,
    scene: { id: 'none', framing: 'still' },
    // "Cut straight to slide 19. No animation. The cut is the effect."
    transition: 'cut',
    demo: {
      route: '/office?officeTier=0',
      still: 'demo-office-tier0.png',
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
        { start: 2, end: 7, action: 'Toggle to tier 14. SAY NOTHING while the room rebuilds and the camera orbits.' },
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
        'The money shot, and it earns its length by being short. Do not crossfade — let the real scene rebuild with the '
        + 'camera locked in the same position so the room grows around a fixed viewpoint, then release the camera into one '
        + 'slow 20-degree orbit. Hold the final frame a full second in silence before speaking. Rehearse this one — '
        + 'at nine seconds it is the least forgiving slide in the talk, and the five silent seconds are not optional.',
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
    headline: 'One place. Two doors.',
    deck: 'Walk in and answer questions. Or build a firm that only grows on thousands of them.',
    // The three words are the founders' and they stay, because the triad is what
    // the room repeats afterwards. What they did not have was a reason: three
    // bare adjectives with no referent, on the one slide that is held on screen
    // for the entire question period. Each now carries the mechanism that makes
    // it true, and all three are claims a questioner can check — the first is a
    // fact about our cost structure, the second is the removed override from
    // `concept-lawyer-tycoon`, the third is `game-never-gates` restated. No
    // price is named because we do not have one to name; see `CITATIONS.md` §7.
    points: [
      'Cheaper — no video studio, no live instructors',
      'Narrower — no drilling only your best types',
      'Harder to quit — the game runs on questions',
    ],
    notes:
      'Three reasons we win. Cheaper — no video studio, no instructors. '
      + "Narrower — you can't drill only what you're good at. "
      + 'Harder to quit — the game runs on questions. One place instead of five. Thank you.',
    speaker: 'Nischay',
    budgetSeconds: 13,
    // Two doorways, both open, the character between them facing the audience.
    // Composed, not animated — and held for the entire Q&A.
    scene: { id: 'doorways', framing: 'wide' },
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
