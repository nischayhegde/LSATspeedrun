import type { SlideSpec } from './types'

/**
 * THE SLIDE REGISTRY — ordered, data-driven, and holding the FINAL COPY.
 *
 *  Revision 11 is a structural rewrite. Learning science runs first and
 *  complete; live demos run consecutive with the zoomed-out map last; the
 *  strategies slide sits at the end of pedagogy, immediately before the
 *  game. `pov-virtual-currency` is gone. Two slides are new: `pov-volume-burns`
 *  (WebGL) after volume, and `pov-graded-question` as the counsel-pull target
 *  off `concept-lawyer-tycoon`. Speaker notes were rewritten in full.
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
 *      + `pov-volume-is-the-constraint`  NEW, then slide 8 and now 9, between the POV
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
 *  Revision 10 is the founders' walkthrough pass. Four complaints, one of them
 *  a slide that did not exist.
 *
 *      + `market-in-their-own-words`  NEW, slide 7, immediately after Spiky POV
 *                               01. Five named competitors, each in its own
 *                               quoted words, against the one column none of
 *                               them meets. §D of the narrative argued against
 *                               a comparison slide; this is built to answer its
 *                               four objections rather than to overrule them,
 *                               and §4.10 of `CITATIONS.md` sources every cell.
 *                               **10s, and the only change that moves the
 *                               runtime: the deck is 5:00 across 25 slides.**
 *      `thesis-speedrun`        the route figure was a falling line past three
 *                               struck-out labels on an axis nothing named.
 *                               Rebuilt on a named axis with two lanes.
 *      `pov-strategy-inside…`   seven blocks of text cut to two objects, both
 *                               of them screens the product actually draws.
 *      `pov-volume-is-the-c…`   the clipped credit line. Fixed in the figure
 *                               layer rather than here — see `useFitScale` in
 *                               `figures/kit.tsx` — and no copy changed.
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
 *  `budgetSeconds` is taken from the spoken cut. Twenty-three slides: five live
 *  demos (case, mega, treasury, clients, map), then the retention-loop figure,
 *  then the one-stop-shop close held for Q&A.
 *  Demo overrun is the founders' single biggest complaint about the previous
 *  deck, so every demo here has a written click path with per-beat seconds and
 *  an explicit skip list.
 * ══════════════════════════════════════════════════════════════════════════
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
      'I\'m Nischay, that\'s Alan — we built Lawyer Tycoon at UT Austin. It is an LSAT speedrun: you walk into a law firm, you take a case, and the case is a real question. Before I show you the product, I want to tell you why this industry is spending hundreds of hours on the wrong problem. ⟢ Names and product category only. Do not preview the game loop here; the later acts have to earn it.',
    speaker: 'Nischay',
    budgetSeconds: 23,
    scene: { id: 'hero', framing: 'assemble' },
  },
{
    id: 'problem-coaching-tax',
    section: 'problem',
    kind: 'figure',
    field: 'blue',
    eyebrow: 'Act I — the bill',
    headline: 'The expensive choice barely moved the score.',
    deck: '46,301 LSAT takers, in the test maker’s own data.',
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
      'The organization that writes the test asked forty-six thousand of its own people what they did to prepare. Nearly half bought a coaching course and moved two-tenths of a point. The third who actually worked through real LSATs sat almost three points higher — more than ten times the return. The expensive choice barely moved the score. That is the test maker\'s own data on the test maker\'s own candidates. ⟢ IF CHALLENGED — LSAC\'s own Wightman, Research Report 90-01, 46,301 test takers. Self-report survey, so it is an association and not an experiment. Volunteer that. It still costs nothing: it is the test maker\'s own data. Respondents tended to be younger and more able than nonrespondents; most people used several methods at once. The sections it covered are the sections that still exist.',
    speaker: 'Nischay',
    budgetSeconds: 28,
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
    headline: 'The course is finite. The bill recurs.',
    deck: 'Recommended study time against monthly cost.',
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
        { at: 0.62, source: 'Princeton Review', range: '250–300' },
        // Pulled in from 0.88. The tick positions carry no quantity — all three
        // published ranges top out at 300 — so they are spacing, and at 0.88 the
        // blank one sat close enough to the outcome sliver at the bar's right
        // end that "a few points" read as a label on LSAC's tick rather than on
        // the sliver its leader line points at. The blank tick is drawn at full
        // strength precisely so it is not mistaken for anything else; it should
        // not then be crowded by the one mark on the slide it could be confused
        // with.
        { at: 0.79, source: 'LSAC' },
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
      'And that is still the bill. Two to three hundred hours, by their own recommendation. Nine hundred videos. Classes five days a week. Sixty-five to four twenty-five a month, plus a hundred twenty-four a year to LSAC, for as long as you study. Somebody has to pay for the studio and the instructors, and it is the student, monthly, until they sit. ⟢ IF CHALLENGED — every figure is off their own public pages and re-verified this month; the LawHub fee is $124 a year and Blueprint says in writing that it is required no matter whose course you buy. Hours: Princeton Review, Blueprint, Kaplan. LSAC declines. Re-check pricing the morning of the pitch.',
    speaker: 'Nischay',
    budgetSeconds: 25,
    // The tall real-LSAT bar rotates flat and becomes this slide's horizontal
    // hours bar: one backdrop, two framings, so the stage tweens rather than cuts.
    scene: { id: 'none', framing: 'drift' },
    transition: 'camera',
  },
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
    figure: { kind: 'numeral', value: '+0.22 points', spin: 8 },
    credit: 'LSAC, "LSAT Prep" · ABA Standard 502(a)',
    notes:
      'That fifth of a point is not a mystery. There is nothing to teach. The LSAT is a skills test — reading and reasoning — not a syllabus. The ABA already requires a bachelor\'s degree, so four years of college reading already happened. These students are not missing content. They are missing reps. Instruction cannot be the core of a product whose test does not have a body of knowledge to deliver. ⟢ THE ABA LINE COMES OUT OF THE MOUTH AND STAYS ON THE SCREEN. Standard 502(a) is in the deck line and the credit. IF CHALLENGED — LSAC\'s own "LSAT Prep" page and ABA Standard 502(a). Neither is a study; both are the governing bodies describing their own rules. Do not paraphrase LSAC as "just a general skills test" — they say it is not a mere general skills test. Stay on: skills, not a body of knowledge.',
    speaker: 'Nischay',
    budgetSeconds: 28,
    // No stage scene. This used to name the hero city at its `beam` framing,
    // which is a night exterior, under a slide that paints an opaque beige
    // field — so it was never once on screen. What it did instead was build and
    // cache a second copy of the deck's heaviest scene for a slide that cannot
    // show it, and flash a dark cityscape through the crossfade into slide 5,
    // where the two beige layers are briefly part-transparent at the same time.
    // The `0.22` is this slide's object and the comment above says so.
    scene: { id: 'none', framing: 'still' },
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
    // REBUILT. The old figure ran a route left to right past three struck-out
    // waypoints and landed `first real question` at the FAR RIGHT of the
    // frame — the slide's own subject drawn at the end of the longest journey
    // on screen, under a headline that says to skip to it, on a horizontal
    // axis nothing named. The founder's note was that the slide is too
    // abstract to understand, and the geometry is why.
    //
    // Same four objects, same claim, and the axis is now stated: `time to your
    // first real question` runs under both lanes, the course path spends the
    // whole of it, and ours is one marker at zero with a clock on it. The two
    // question markers are drawn identically so the only difference between
    // them is position, and a dimension line makes that a measured distance.
    //
    // Our lane then fills with a silent run of the same marker to the far end
    // of the axis — the deck's own "they sell hours, we sell reps", drawn. The
    // run is a texture and its count lives in `route.tsx`, not here: a number
    // in this file is a number somebody will be asked to defend, and the deck
    // does not know how many questions a student gets through in the time a
    // course spends on its intro. Nothing beside the run is labelled or
    // totalled, which is also what keeps it from being more copy.
    //
    // THE THREE STAGES NAME NO PRODUCT, AND MUST NOT. `CITATIONS.md` §4.2 is
    // explicit that LSAT Demon is question-first — "no complex diagramming or
    // hours of lessons... just hit Drill" — so "everyone makes you watch first"
    // is false and would be caught by anyone in the room who has used it. What
    // is on the lane is the *course* model, which is a real product category
    // the deck has already sourced on slide 3 out of the vendors' own pages:
    // 7Sage's 900 lessons "from the ground up", LSAT Lab's "comprehensive
    // 3-month courses", PowerScore's 2–3 month syllabus. The honest
    // comparison, with Demon credited for being question-first, is
    // `market-in-their-own-words` two slides later.
    figure: {
      kind: 'route',
      axisLabel: 'time to your first real question',
      lanes: {
        course: {
          label: 'the course path',
          stages: ['intro course', 'concept videos', 'drill unlock'],
          arrival: 'first question',
        },
        ours: { label: 'ours', arrival: 'question one' },
      },
      timerLabel: 'question one',
    },
    // ACTIVE-VS-PASSIVE, BEAT 2, and where "strip away the fluff" enters. This
    // is the founders' own phrase for the speedrun thesis and it belongs early —
    // it is the line the room should still be hearing when the demo starts.
    // Dunlosky is the deck's active-versus-passive citation and always was:
    // practice testing at the top of ten techniques and rereading at the bottom
    // is exactly the room's own premise, from their own reading, so nothing new
    // had to be reached for.
    notes:
      'So we skip the course. Intro videos, concept lessons, drill unlocks — that path burns the clock before a single question. Ours starts at zero. Minute one is question one. Of ten study techniques, practice testing ranked highest and rereading ranked lowest. They sell hours. We sell the first question, immediately, and then another one. ⟢ IF CHALLENGED — Dunlosky and colleagues, 2013, the standard review in the field. Highest-utility: practice testing and distributed practice. Lowest: rereading and highlighting. We are not claiming novelty. We are claiming nobody builds the whole product out of the top of that list. Do not say everyone makes you watch first — LSAT Demon is question-first. The lane is the course model, sourced on slide 3 from 7Sage, LSAT Lab, PowerScore.',
    speaker: 'Nischay',
    budgetSeconds: 22,
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
    eyebrow: 'Act II — the work',
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
    deck: 'Fixed criteria reveal the first broken step.',
    // "87 comparisons" was in this line for three revisions and is not a number
    // VanLehn reports. His counts against no tutoring are 165 effects for
    // answer-based, 28 for step-based, 26 for substep and 10 for human, and no
    // combination of them is 87. The three effect sizes the figure plots â
    // 0.31, 0.76, 0.79 â are his, exactly, so the finding is sound and only the
    // provenance was invented. The journal is checkable and the count was not.
    credit: 'VanLehn (2011), Educational Psychologist — against no tutoring · Zhang & Fiorella (2024)',
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
        { value: 0.76, label: 'reasoning-level feedback', emphasis: true },
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
      'Because picking a letter is recognition. Learning happens when you generate the argument. Feedback on the letter is a small lift. Feedback on your steps is almost a human tutor. We do not ask a vague explain-this. We grade a rubric. That is the difference that has a price on it: only one of those last two requires a person in the room. ⟢ IF CHALLENGED — VanLehn 2011, Educational Psychologist, tutoring systems against no tutoring. Effect sizes 0.31 / 0.76 / 0.79 are his. Do not attach an unsupported count of 87 comparisons. The near-equality of the last two is the pricing argument. Zhang and Fiorella 2024: a structured prompt beat a vague one by 0.62. The competitive sentence is the workflow claim: they explain the question, we grade your explanation. If LSAT Lab\'s AI centre does this, they have not published it.',
    speaker: 'Nischay',
    budgetSeconds: 25,
    // The route line's endpoint expands into the outline of a question card: same
    // backdrop, new framing, continuous camera.
    scene: { id: 'none', framing: 'still' },
    transition: 'camera',
  },
{
    // NEW, and the deck's only competitor comparison. §D of the narrative argued
    // against a comparison slide and gave four reasons; the founders asked for
    // one anyway. The four reasons were not wrong, so the slide is built to
    // answer them rather than to overrule them — see the header of
    // `figures/market-ledger.tsx`, which takes them one at a time, and §4.10 of
    // `CITATIONS.md`, which carries every quote below with its URL and the date
    // it was read.
    //
    // WHY IT IS HERE AND NOT IN ACT I. The obvious slot is beside the price
    // slide, and it is wrong twice over. The room cannot be told "why us" before
    // it has been told what we are, and the deck deliberately withholds the
    // product until slide 10 — so in Act I our own row would either be missing,
    // which is not a comparison, or be the first thing the room ever hears about
    // us, which spends the turn early. Here, it is the second half of the slide
    // before it. Slide 6 has just priced the difference between feedback on your
    // answer and feedback on your steps — 0.31 against 0.76 — and this slide
    // reads that same axis across five named products. Every competitor sits in
    // VanLehn's cheap column. That is an inference the room has already made,
    // which §D says is the only kind of competitive claim worth putting on a
    // projector.
    //
    // WHAT IS NOT ON IT, AND WHY. Price. Slide 3 carries the range and it is
    // twenty seconds of talk away, so a price column here would be the same
    // argument twice; per-vendor prices are also the one class of fact in
    // `CITATIONS.md` §4 that moves weekly and that §4.9 could least often load
    // directly; and the deck has no price of its own to print (§8), so the
    // column would end on a blank in the one row that is the punchline. The
    // presenter carries the numbers in the notes instead and answers in a
    // sentence if asked.
    id: 'market-in-their-own-words',
    section: 'thesis',
    kind: 'figure',
    field: 'beige',
    eyebrow: 'Act II — the field',
    headline: 'They grade the answer. We grade the reasoning.',
    // A concession, and it is the whole standfirst. It is the only sentence on
    // the slide that is not in the figure, the only one that costs us something,
    // and the reason the room believes the rest: anyone who has used LSAT Demon
    // knows they are question-first and would spend the next four slides
    // discounting us if we pretended otherwise. `CITATIONS.md` §4.2.
    // No fragment line. The figure is eleven lines of type already and the
    // second column is the argument; anything on the ledger line would be read
    // instead of it.
    //
    // EVERY QUOTE IS VERBATIM AND CARRIES ITS QUOTATION MARKS. That is the whole
    // mechanism of the slide: there is no judgement of a competitor anywhere on
    // it, so there is nothing for a judge to argue with one row at a time. If a
    // line here is ever reworded into a paraphrase, the slide stops working and
    // becomes the scorecard §D was right to refuse. Our own row is unquoted,
    // which is the marks doing their job — it is the one row that is a claim.
    //
    // The order is not a ranking. It runs from the most instruction to the
    // least, so the first column visibly converges on our own thesis by the
    // fifth row and the second column has not moved at all. Demon last is the
    // concession the standfirst just made, drawn.
    figure: {
      kind: 'market-ledger',
      claimHead: 'what it hands you · their words',
      gradesHead: 'what it grades',
      rows: [
        // Four of Kaplan's own pages say 60; one FAQ paragraph says over 150.
        // The smaller number is quoted on purpose — see §4.10 — and it is the
        // one cell on the slide that was read from a cached copy rather than
        // from the live page, because kaptest.com serves a bot wall.
        { name: 'Kaplan', claim: '“60 hours of live and on demand instruction”', grades: 'the letter you picked' },
        { name: 'Princeton Review', claim: '“100+ hours of recorded video lessons”', grades: 'the letter you picked' },
        { name: 'Blueprint', claim: '“61 interactive learning modules and video lessons”', grades: 'the letter you picked' },
        // Their pricing page's own feature name for the Core plan. Slide 3
        // already quotes their "900+ video lessons" at the same company, so
        // this is the other phrase off the same page rather than that one
        // twice.
        { name: '7Sage', claim: '“Comprehensive video course”', grades: 'the letter you picked' },
        { name: 'LSAT Demon', claim: '“Smart Drilling”', grades: 'the letter you picked' },
      ],
      // Not a slogan. It is the case screen the room watches Alan use in four
      // slides' time, described in the fewest words that survive being checked
      // against it.
      ours: {
        name: 'Lawyer Tycoon',
        claim: 'A question, and a box to explain it in',
        grades: 'your reasoning',
      },
    },
    notes:
      'Here is the field, quoting themselves. Hours of instruction, and Demon, which drills. Every one of them grades the letter you picked. We grade the reasoning you wrote. Demon will get you to a question as fast as we will — that concession is on purpose. What they still do not do is make you write how you thought, and then score that writing. ⟢ IF CHALLENGED ON A QUOTE — all five are off the company\'s own page and were read this month; URLs in CITATIONS.md §4.10. Kaplan blocks scrapers; theirs came from a cached copy; their course pages say sixty hours where one FAQ says over a hundred and fifty — we quoted the smaller. IF PRESSED ON THE SECOND COLUMN — a claim about the workflow, not their code: none of them asks you to write your reasoning. IF ASKED THE PRICE — Demon ninety-nine a month, 7Sage sixty-nine, Blueprint ninety-nine, Princeton Review six ninety-nine self-paced, Kaplan from about nine hundred, every one plus a hundred twenty-four a year to LSAC. Deliberately not a column here.',
    speaker: 'Nischay',
    budgetSeconds: 25,
    // Nothing behind it and nothing carried into it. The slide is a page of
    // type that has to be read, and it is the one place in the deck where the
    // audience is being invited to check something rather than watch it.
    scene: { id: 'none', framing: 'still' },
    transition: 'cut',
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
    credit: 'Metcalfe (2017), Annual Review of Psychology 68 — the hypercorrection effect',
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
      'And a letter is not understanding. A lucky guess and a mastered question both look green on a score report. A time-pressure miss and a confident misconception both look red. So before the key we ask how sure you were. A confident miss is the most correctable error there is, and it goes to the front of review. Accuracy and time cannot see understanding. Confidence can. ⟢ IF CHALLENGED — Metcalfe 2017, Annual Review of Psychology, the hypercorrection effect: high-confidence errors are corrected more reliably than low-confidence ones. Robust and replicated. Expect someone to raise 7Sage blind review: that is a ritual of redoing uncertain questions, not a per-question rating feeding a scheduler.',
    speaker: 'Nischay',
    budgetSeconds: 27,
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
    headline: 'Practice volume is the constraint.',
    // "its own free platform" was a shade wrong and free to fix: the platform was
    // Khan Academy's, hosting LSAC's Official LSAT Prep under a partnership.
    //
    // The standfirst used to run to three lines, and two of them were the
    // headline again: "The method is not in dispute. Finishing it is." is
    // "Everyone knows this. Doing it is the product." with different nouns.
    // What is left is the one thing the headline cannot say, which is where the
    // data comes from and what it was matched against.
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
      cohortLabel: '12,471 LSAT learners matched to real scores',
      keptShare: 0.49,
      // The unit is named because the neighbouring ledger is denominated in
      // score points and a bare `4.5` under an exam-completion bar invites
      // exactly the wrong reading. It is the finishers' subgroup and the report
      // says so: "students who took at least one practice exam took an average
      // of 4.5 practice exams". See `CITATIONS.md` §7, finding 3.
      keptLabel: '49% completed at least one',
      lostLabel: '51% completed none',
      inputs: [
        {
          label: 'practice minutes',
          shape: 'contrast',
          low: { at: 0.06, label: '26 min' },
          high: { at: 0.62, label: '47 h' },
          verdict: '+4.3 points',
          // Two words carrying the whole of LSAC's "independent groups"
          // sentence, and the reason the row is not a bar.
          note: 'top vs bottom practice decile',
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
      'Everyone already knows practice works. The test maker matched their own free platform to real scores. Heavy practicers sat four points above the light ones. Video minutes were not correlated at all. Then the punch: fifty-one percent never finished a single practice exam. The method is not the constraint. Finishing it is. That is the number this product is an answer to. ⟢ IF CHALLENGED — LSAC Research Report 21-01, Dustman, Camilli and Gallagher, 2021; SSRN 3845015. 12,471 matched records, 6,938 modelled. (1) BASELINE. Add first practice-exam score and R-squared goes from .21 to .64 and the practice row collapses — that model is only on students who completed at least one exam. This slide is about the 51%. (2) VIDEO DOSE. Median student watched 42 minutes of video, so this is not a verdict on a hundred-hour lecture course. Same students, same platform, same window: practice tracked the score, watching did not. They never print a coefficient for video. (3) CAUSATION. Association, LSAC says so, confounded with motivation. The 51% needs no identification: it is a description, and every one of those students went on to sit the real LSAT.',
    speaker: 'Nischay',
    budgetSeconds: 25,
    // Deliberately motionless. The figure is the only thing moving on the slide,
    // which is what a slide whose punch is one number needs, and it means the
    // cut in from the confidence tiles has something to land on.
    scene: { id: 'none', framing: 'still' },
    transition: 'cut',
  },
{
    id: 'pov-volume-burns',
    section: 'thesis',
    kind: 'scene',
    eyebrow: 'Act II — the cost',
    headline: 'The work that raises the score is the work people stop.',
    points: ['1 in 5|high test anxiety / anxious students score worse when it counts'],
    credit: 'Putwain & Daly (2014) · Thomas et al. (2017) · von der Embse et al. (2018)',
    notes:
      'And people stop for a reason that is not laziness. About one in five already walk into a high-stakes exam carrying high test anxiety. Across thirty years of studies that anxiety tracks lower scores on the tests that decide. The work that raises the score is the work people stop, and this is why they stop. ⟢ Putwain & Daly (2014); Thomas et al. (2017): high test anxiety 15–22%. Huntley et al. (2022) cite ~25% of college students. von der Embse, Jester, Roy & Post (2018), Journal of Affective Disorders 227: 238 studies; test anxiety negatively related to standardized tests, university entrance exams, and GPA; r = −.13 to −.40. Not LSAT-specific. Do not say LSAT students. Do not headline Cassady n=168 or Frattaroli n=15 LSAT. Do not repeat 51% or 150–300 hours. Do not invent an LSAT burnout RCT.',
    speaker: 'Nischay',
    budgetSeconds: 22,
    scene: { id: 'burnout', framing: 'still' },
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
    deck: 'The LSAT engine records the work; completed practice advances the world.',
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
    notes:
      'That is why this exists. Sixty-eight hundred real LSAT questions, an engine that records how you think, inside a tycoon firm that only grows when you practice. The game never picks the question, never answers it, and never locks it. Practice gates the world. The world does not gate practice. ⟢ Identity beat. The next click hauls `pov-graded-question` on by hand. Do not preview the live app. Fragment care: say we removed the override, not that we pick for you — adaptive selection is table stakes. 6,886 questions, not "official."',
    speaker: 'Nischay',
    budgetSeconds: 20,
    // Identity beat, not a room. One counsel on an empty spotlighted stage;
    // the next click is him walking off and pulling Act III on with him.
    scene: { id: 'counsel-stage', framing: 'spot' },
    transition: 'cut',
  },
{
    id: 'pov-graded-question',
    section: 'thesis',
    kind: 'figure',
    field: 'beige',
    eyebrow: 'Act II — Spiky POV 01',
    // One centred claim, no chart. The old lockup argued the same idea as a
    // two-lane diagram plus a Dunlosky ranking; the room is meant to feel the
    // rule, not study a figure. "Graded" is the load-bearing word: answering
    // without feedback is still a stall, and a lecture is not a rep.
    headline: "If it isn't a graded question, it isn't studying.",
    deck: 'The firm only moves when a question is graded.',
    credit: 'Dunlosky et al. (2013), practice testing first of ten · LSAC RR 21-01, video minutes not correlated',
    figure: { kind: 'claim-seal' },
    notes:
      'And the rule underneath is simple. If it isn\'t a graded question, it isn\'t studying. You answer, you get the feedback, you do it again. Concept videos, intro lessons, unlocking the drill — those hours feel like work and they are a stall. The score is a retrieval problem. ⟢ Dunlosky et al. 2013 in the credit: practice testing first of ten, rereading last. LSAC RR 21-01 video-null already argued on the volume slide; do not re-try that case. Do not name papers unless asked. This is the sheet the counsel just hauled on. Let it land before you talk. Do not point at the screen.',
    speaker: 'Nischay',
    budgetSeconds: 19,
    scene: { id: 'none', framing: 'still' },
    transition: 'letterbox',
  },
{
    id: 'pov-ai-never-answers',
    section: 'product',
    kind: 'figure',
    field: 'blue',
    eyebrow: 'Act III — Spiky POV 03',
    headline: 'An AI that gives answers makes you worse.',
    deck: 'The practice gain reversed when the tool disappeared.',
    // `Hints, never solutions` is CUT, and the reason it was restored no longer
    // holds. Revision 9 cut it as a repeat of the guarded trace's own label —
    // "a coach that gives hints, never answers" — and then put it back on the
    // finding that the trace is flat at the baseline, draws underneath the
    // control's dashed line, and never paints its label at all.
    //
    // It paints. `spreadLabels` in `traces.tsx` pushes coincident right-edge
    // labels apart precisely so that this one is legible, and a 1920x1080
    // capture of the settled frame shows all three tags. So the restored
    // fragment is what it looked like in the first place: the sentence
    // immediately above it, set again in a smaller face. Two fragments left,
    // and they are the two halves of the guardrail the trace does not draw.
    points: [
      'Attempt first',
      'One step at a time',
    ],
    // 2025, not 2024, and PNAS. The year was wrong on the slide and the paper is
    // the single most-cited AI-in-education RCT there is, so it is the credit in
    // the deck most likely to be looked up from the room. The population is
    // named too: these were high-school mathematics students in Turkey, which
    // is the caveat a hostile questioner reaches for first, and a credit that
    // hides the caveat is worse than one that does not fit on the line.
    credit: 'Bastani et al. (2025), PNAS 122 — ~1,000 high-school students, three-arm field experiment',
    // The only slide in the deck permitted a moment of misdirection: the good
    // trace draws first and holds long enough for the room to start nodding.
    figure: {
      kind: 'traces',
      traces: [
        { label: '+48% practice · unguarded ChatGPT', points: [0.5, 0.62, 0.74, 0.85, 0.93, 0.98], style: 'good' },
        { label: '−17% real exam · tool removed', points: [0.5, 0.45, 0.4, 0.35, 0.31, 0.29], style: 'bad' },
        { label: 'a coach that gives hints, never answers', points: [0.5, 0.5, 0.49, 0.5, 0.5, 0.5], style: 'guarded' },
      ],
      baseline: 0.5,
      baselineLabel: '1.0× baseline · no AI',
    },
    notes:
      'I\'ll take it from here. Unguarded ChatGPT put practice grades up almost fifty percent. Take the tool away for the real exam: seventeen percent worse than students who never used it. An AI that gives answers makes you worse. So our coach waits for an attempt, then hints. Never the answer. Help without solving left students level with the control. The harm is the answer, not the model. ⟢ IF CHALLENGED — Bastani and colleagues, PNAS 2025, field experiment, about a thousand high-school mathematics students in Turkey. Volunteer the population. The guarded arm left students level with control. 7Sage Sage AI is an assistant you query about a question — state that as a design disagreement, not an accusation; they publish no guardrail evidence.',
    speaker: 'Alan',
    budgetSeconds: 27,
    // No stage scene. `scene: none` loaded the unused library/skyline backdrop
    // under this field, which flashed as a 3D interstitial on the way in from
    // slide 10. The arrival is the real DOM layer sliding to identity.
    // Hand-off to Alan. Arrival from slide 10 is the counsel walk-pull
    // (override in `transitions.ts`); this kind is the fallback from anywhere
    // else, including walking backward out of the POV block.
    transition: 'letterbox',
  },
{
    id: 'pov-real-clock',
    section: 'product',
    kind: 'figure',
    field: 'beige',
    eyebrow: 'Act III — Spiky POV 04',
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
      // The app's own clock, over target. 150s is the shipped Logical Reasoning
      // target (`_target_time_seconds`, `backend/app/services.py`) and 2:56 is
      // the elapsed time that puts the used arc where `used` and `target` put
      // it: 150 × 0.82 / 0.7 = 176s. Move one of the four and move all four.
      innerTime: '2:56',
      innerTarget: '2:30',
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
      'And every attempt is timed, because the LSAT is timed. You cannot learn pacing in an untimed ramp and then discover the clock on Saturday. A full form is always there, never required — nobody sits a four-section exam on a Tuesday night. Real pacing from day one. Full exams when you can. ⟢ DELIVERY — state the product behavior exactly as written. No outside credit, and that is deliberate: LSAT Demon publicly argues the opposite. Prepared answer under demon-ignore-the-clock: they are talking about the learning phase and we do not disagree — full forms are optional and blind review is untimed. What we time is the single question, and we report pace beside accuracy rather than blended into it.',
    speaker: 'Alan',
    budgetSeconds: 21,
    scene: { id: 'none', framing: 'low' },
    transition: 'cut',
  },
{
    id: 'dashboard-everything',
    section: 'product',
    kind: 'figure',
    field: 'blue',
    eyebrow: 'Act III — the record',
    headline: 'The record shapes what comes next.',
    deck: 'Weak-type focus · spaced review · within-learner strategy trials',
    // Eleven signals, deliberately — the founders asked for the complete list on
    // one slide, and this is the one slide that knowingly exceeds the
    // three-fragment rule. They are the figure's rows rather than body copy, so
    // `points` is empty here on purpose: printing them twice would be the whole
    // list at half the size next to itself.
    //
    // The Speedrun Index is the only derived figure, so it is what the eleven
    // converge on; `weight` orders the column and sets both the weight bar and
    // the hairline. `forming` marks the ones whose sample is still too small to
    // compare, which is the honesty claim the notes make out loud.
    figure: {
      kind: 'signal-index',
      centre: { label: 'Speedrun Index', value: '61' },
      nodes: [
        { label: 'Accuracy by question type', weight: 1 },
        { label: 'Pace against target time', weight: 0.9 },
        { label: 'Reasoning quality grade', weight: 0.85 },
        { label: 'Confidence calibration', weight: 0.7 },
        { label: 'Weak-type next focus', weight: 0.65, highlight: true },
        { label: 'Full-test section breakdown', weight: 0.55 },
        { label: 'Review retrievability and recovery', weight: 0.5 },
        { label: 'Trend vs. your previous window', weight: 0.45 },
        { label: 'Per-method lift', weight: 0.4, forming: true },
        { label: 'Evidence confidence', weight: 0.35 },
        { label: 'Comparison readiness', weight: 0.3, forming: true },
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
      'All of that decides the next question. Weak types get sixty percent of fresh practice. Reviews return when you are about to forget them. Similar types get mixed so you have to tell them apart. The record is not a report card you read later. It is what shapes what comes next, from the first session, on first attempts only. ⟢ IF CHALLENGED — scheduler ranks reviews by retrievability (FSRS-6), not a calendar. FOCUS_FILL_RATIO 0.6; FOCUS_COVERAGE_TRIALS 5 on a weak type vs BASE 3. Stem taxonomy: 11 LR labels and 6 RC. Settles and Meeder cut recall error more than 45% over Leitner at Duolingo scale — practice activity, not learning gains. Do not say "improved learning." Confident misses head the repair queue, on Metcalfe. Correctness always comes from the verified answer key, never from the model.',
    speaker: 'Alan',
    budgetSeconds: 24,
    // 2D over the blue field, no WebGL: this lands directly after a live demo and
    // the frame rate is worth protecting.
    //
    // That is what the line above has always said and it is right; what was
    // written underneath it was `{ id: 'metrics', framing: 'panel' }`, which is
    // a WebGL scene, built and rendered and post-processed every frame behind
    // an opaque royal blue rectangle for the whole of the slide. Nobody saw it,
    // including whoever wrote the comment. Now the declaration agrees with the
    // intent.
    scene: { id: 'none', framing: 'still' },
    transition: 'ink-bleed',
  },
{
    id: 'pov-strategy-inside-the-question',
    section: 'product',
    kind: 'figure',
    field: 'beige',
    eyebrow: 'Act III — Spiky POV 05',
    headline: 'Strategies get taught. They should get tested.',
    // Was: "One method, handed to you at the moment you need it, kept only if
    // your own data says it works." Eighteen words over two lines, and the
    // rebuilt figure now draws both halves of it — the card arriving on the
    // question is the handing over, and the two arms beside it are the own
    // data. What is left is the bridge between the headline and the picture,
    // in one line.
    deck: 'A suggestion must change the work, not decorate the question.',
    // Two of the four fragments went when the figure was rebuilt, because the
    // rebuilt figure draws them. `14 in the catalog` is now the catalogue's own
    // heading, set against the fourteen names it counts, which is a better
    // place for it than a fragment eight lines below the list. `Tested against
    // your own control` was always the figure's note word for word — the
    // narrative flags it as the one line here available for cutting, and this
    // is the pass that spends it.
    //
    // The fourth fragment is the deck's second competitive line, and it uses
    // the same device as the one on `pov-reasoning-is-the-work`: a bare
    // sentence, arriving last, naming nobody. It is deliberately a claim about
    // *measurement* rather than about method vocabulary, because `CITATIONS.md`
    // §4.2 establishes that Demon's Prediction Mode already prompts a technique
    // inside a question — so "nobody prompts a method" would be false, while
    // "nobody measures whether it worked for this student" is the finding §4
    // actually supports across all seven products.
    // `One per question` went into the deck line above. What is left is the
    // deck's second competitive line, which uses the same device as the one on
    // `pov-reasoning-is-the-work`: a bare sentence, arriving last, naming
    // nobody.
    points: [
      'Use it → custom gate → measured arm',
    ],
    // REBUILT, on the founder's note that this slide was "way too much text and
    // clutter, not aesthetic, no dynamic animations." It carried nine blocks for
    // one idea. It now carries the two ends of the mechanism and nothing else,
    // both lifted from real product surfaces — see `method-lab.tsx`.
    //
    // WHAT CAME OFF THE SCREEN. The fourteen catalogue names are a chip reading
    // `1 of 14 approaches`: nobody reads a list of method names off a
    // projector, and the only fact in that list is its length.
    // `comparative_matrix` used to be unreachable because the upstream dataset
    // did not label comparative passages. The ingest now detects the Passage A /
    // Passage B format and persists it on the passage, so all fourteen catalog
    // approaches have a reachable assignment path. Keep the claim at the
    // catalog level: which approaches any one learner sees still depends on the
    // questions served and on thin-evidence exploration.
    //
    // `handed` is `prephrase` as the app defines it in
    // `backend/app/strategies.py`: `name` is that entry's `title`, `trigger` is
    // its `best_for`, the three steps are its `steps`, and `take` / `refuse`
    // are the two button labels in `frontend/src/case-flow.tsx`. All verbatim,
    // because the figure sets them as the card the student is handed and a
    // paraphrase of a real product string on a pitch slide is a thing somebody
    // can walk into the app and catch.
    //
    // `trial` REPLACES A PAIR OF NUMBERS THAT WERE NOT MEASUREMENTS. This slide
    // used to show `71%` with the method against `58%` without it. Neither
    // figure exists anywhere in this repository as data. They are the worked
    // example in an internal design document —
    // `docs/superpowers/specs/2026-07-27-strategy-flow-simplification-design.md`
    // illustrates the copy format with "You get 71% right with it and 58% right
    // without it" — and they were read into the deck as findings.
    //
    // These are the demo account's real record for `prephrase`, straight off
    // `STRATEGY_PLAN` in `backend/scripts/seed_demo.py`: 16 prompted attempts,
    // 13 correct; 7 control attempts, 4 correct. They are counts and not
    // percentages because the product refuses to print percentages here —
    // `strategies.py` sets `PERCENTAGE_DISPLAY_MIN_SAMPLE = 30` and falls back
    // to `13/16` on the grounds that a whole-point percentage at this sample is
    // fiction. Do not "improve" these into 81% and 57%.
    figure: {
      kind: 'method-lab',
      catalogSize: 14,
      handed: {
        name: 'Prephrase Before Choices',
        trigger: 'fires on assumption · inference · strengthen · weaken · point-at-issue',
        steps: [
          'Name the question task',
          'Predict the needed effect',
          'Use choices to verify, not invent',
        ],
        take: 'Use it',
        refuse: 'Skip this one',
      },
      trial: {
        with: { label: 'with the method', hit: 13, of: 16 },
        without: { label: 'their own attempts without it', hit: 4, of: 7 },
      },
    },
    // The credit carries what the small print under the old bars carried, and
    // says the quiet part: these are running counts on one account, not a
    // result. That is the app's own position — `strategies.py` never writes the
    // word "confirmed" about a per-student contrast — and stating it is what
    // makes the slide's competitive claim survive a hostile room.
    credit: 'One student’s live strategy comparison · raw attempt counts',
    notes:
      'Everyone teaches a method and then leaves you alone with it. We drop one inside the question — guess before you look — and a custom gate makes you do the steps. Then we keep those attempts next to your own unprompted ones. Fourteen strategies, measured on you. A suggestion has to change the work, not decorate the question. Thirteen of sixteen with it, four of seven without, on this account. Those are counts on purpose. ⟢ THE NUMBERS ARE COUNTS ON PURPOSE. If anyone asks why not a percentage: the product will not print one under thirty attempts an arm, because at that size a percentage is noise with a decimal point. That refusal is the pitch. IF PRESSED ON SAMPLE — every prompted question is randomised against a control arm of their own unprompted ones, so the estimate is thin on day one and gets better every session. This account alone is twelve approaches over 166 measured questions. Do not claim nobody prompts a method — Demon\'s Prediction Mode already does. Claim nobody measures whether it worked for this student. comparative_matrix is now reachable; keep the claim at catalog level.',
    speaker: 'Alan',
    budgetSeconds: 30,
    scene: { id: 'none', framing: 'drift' },
    transition: 'cut',
  },
{
    id: 'demo-case-answer',
    section: 'game',
    kind: 'demo',
    eyebrow: 'Act IV — live',
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
    // the strategy POV available and the deck was underclaiming them.
    // `pov-strategy-inside-the-question` says the method arrives inside the question; this shows the app REFUSING
    // to show the choices until the method is taken up. Enforced, not suggested.
    notes:
      'Now the product, live — and I am not touching anything. Strategy first, choices locked until you take it up. Then a real question: you write why, you pick C, you submit both. The key rules on the letter. The coach grades the reasoning. That is the unit: a question you answer, feedback you cannot skip, a method enforced inside the work. ⟢ HANDS OFF THE KEYBOARD. The app drives this. Measured at 21 to 26 seconds to rest across four runs; the slide holds 30. If you finish narrating early, stop talking and let the coach\'s line be read. THE ANSWER IS (C). Say the letter once as it lights. IF ASKED WHETHER THE GRADE IS LIVE — the submit is real: real endpoint, real session. The grading ran at staging rather than in that second, because a frontier call takes twenty to forty seconds. Offer to run one cold in Q&A. Never say the model is thinking live.',
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
      // never saw it answered. `demo-case-answered.webp` is the same driven session
      // at rest, with (C) credited, the stamp down and the coach's reading in
      // shot, so the fallback makes the slide's point instead of setting it up.
      still: 'demo-case-answered.webp',
      width: 1440,
      zoom: 0.96,
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
        { start: 0, end: 4, action: 'HANDS OFF. Partner tip lands; choices stay dimmed. Pause on the locked strategy.' },
        { start: 4, end: 11, action: 'Use it. Work the method in the real gate: write the prediction, highlight the stimulus.' },
        { start: 11, end: 15, action: 'The written case theory appears. Let the box sit.' },
        { start: 15, end: 19, action: '**(C)** lights. Say the letter once. Submit after the pause.' },
        { start: 19, end: 26, action: 'Stamp and coach land. Stop talking and let them read. Hold this frame.' },
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
    id: 'demo-mega-litigation',
    section: 'game',
    kind: 'demo',
    eyebrow: 'Act IV — live',
    headline: 'The full test, and the blind review after it.',
    notes:
      'Same engine, a real sitting. Thirty-five minutes a section, and the clock is the server\'s. A live item, then the section ends — blanks stay blank, you cannot go back. This is not a drill with a timer sticker on it. This is the exam, on the same questions, with the same enforcement Saturday will have. ⟢ AUTOMATED. Disposable sitting; confirm the real test-conditions gate; section one; answer one item; end the section. Skip remaining sections, intermission, reading aloud, accommodations. Re-run stage-demo:fast if stale.',
    speaker: 'Alan',
    budgetSeconds: 22,
    scene: { id: 'none', framing: 'drift' },
    transition: 'cut',
    demo: {
      route: '/cases?tab=mega&deckDemo=mega',
      still: 'demo-progress.webp',
      width: 1440,
      zoom: 0.94,
      budgetSeconds: 18,
      context: 'Start in Context A, jump to Context B',
      // The answer-one-question-untimed beat is gone. It cost ten seconds to
      // re-show an interaction the room watched in full two slides ago, and
      // blind review is a concept the sentence carries on its own — what needs
      // to be *seen* is the two scores side by side, which is the audit.
      clickPath: [
        { start: 0, end: 4, action: 'Practice · Mega-litigation. Hover the 35-minute section clock, then Sit.' },
        { start: 4, end: 12, action: 'Confirm the gate. A real section opens: server clock running, a live item, pick and next.' },
        { start: 12, end: 18, action: 'End the section. The clock stops. Next-section gate. Hold.' },
      ],
      skip: [
        'sitting the remaining sections',
        'the 10-minute intermission',
        'reading any question aloud',
        'accommodation settings',
      ],
      staging:
        'AUTOMATED. The driver starts a disposable sitting (abandoning any leftover form first), confirms the real '
        + 'test-conditions gate, and opens section one. The 35-minute clock on screen is the server\'s. It answers one '
        + 'item, advances, then ends the section so time stops the way the product enforces LSAT timing — blanks stay '
        + 'blank, and the next section waits behind a gate. Re-run `npm run stage-demo:fast` if the demo account is stale.',
    },
  },
{
    id: 'demo-office-treasury',
    section: 'game',
    kind: 'demo',
    eyebrow: 'Act IV — live',
    headline: 'The fee hits the treasury. The office changes.',
    notes:
      'That answer paid a fee. The firm buys the trophy shelf, and the office itself updates. Practice is what grows the room. The world is not wallpaper. It is the ledger of the work. ⟢ HANDS OFF. The app buys trophy_shelf, then jumps to the office and focuses that shelf. If already owned from a rehearsal, re-run npm run stage-demo:fast. Do not open the dashboard. This beat is the loop the room has to feel.',
    speaker: 'Alan',
    budgetSeconds: 14,
    scene: { id: 'none', framing: 'still' },
    transition: 'cut',
    demo: {
      route: '/firm?tab=decor&deckDemo=treasury',
      still: 'demo-firm.png',
      width: 1440,
      zoom: 1,
      budgetSeconds: 12,
      context: 'Context A, continuing',
      clickPath: [
        { start: 0, end: 3, action: 'Decor catalog on screen. Cursor hovers Purchase and buys.' },
        { start: 3, end: 4, action: 'Cash drops. Jump to the office.' },
        { start: 4, end: 12, action: 'Shelf in the room. Hold.' },
      ],
      skip: [
        'the rest of the catalog',
        'staff hiring',
        'opening the dashboard or answer log',
        'changing tabs by hand',
      ],
      staging:
        'AUTOMATED TREASURY LOOP. Seed leaves `trophy_shelf` unowned and affordable. The driver purchases it for real, '
        + 'so the firm treasury rolls down and the office then focuses that decor in the 3D room. '
        + '`stage_demo` restores the shelf if a rehearsal already bought it — re-run `npm run stage-demo:fast` before the talk. '
        + 'If the shelf is still owned, the driver buys the next affordable decor card instead of silently no-opping. '
        + 'This replaced the dashboard review beat: the room already watched the question get answered; '
        + 'the missing proof is that those reps fund the firm.',
    },
  },
{
    id: 'demo-clients-walk-in',
    section: 'game',
    kind: 'demo',
    eyebrow: 'Act IV — live',
    headline: 'A client arrives. Accepting the case starts practice.',
    notes:
      'Here is the loop from the other end. A client walks in. Accepting the case starts the question. The fee is paid after — never while you think. You do not open a menu of question types. You take the next case, and the next case is practice. ⟢ IF CHALLENGED — the fee is settled before the question starts and after it ends, never while it is on screen. Kienitz: decorative material lowers recall when a learner thinks it matters. Full answer in Q&A under the game competes with the studying.',
    speaker: 'Alan',
    budgetSeconds: 19,
    scene: { id: 'none', framing: 'still' },
    // The four beige bars rotate into the vertical and become the columns of the
    // office as the live app opens.
    transition: 'cut',
    demo: {
      route: '/office?deckDemo=client',
      still: 'demo-office.webp',
      width: 1440,
      zoom: 0.9,
      budgetSeconds: 12,
      context: 'Context A',
      clickPath: [
        { start: 0, end: 3, action: 'Hold on the live 3D office. Cursor moves to the walk-in client.' },
        { start: 3, end: 7, action: 'Hover, then click. The hotspot card opens. Pause on the client.' },
        { start: 7, end: 12, action: 'Second click accepts and starts the live question. Hold as practice opens.' },
      ],
      skip: ['contracts and dockets', 'quests', 'story chapters', 'the client catalog', 'reputation'],
      staging:
        'AUTOMATED. Do not click: the cursor operates the real office hotspot twice—first to reveal the walk-in client, '
        + 'then to resume that client’s live question. The hotspot dispatches the same actions as a human click.',
    },
  },
{
    id: 'demo-map-and-firm',
    section: 'game',
    kind: 'demo',
    eyebrow: 'Act IV — live',
    headline: 'The map of the work.',
    notes:
      'The office sits on a city. Settled cases unlock districts. That is the practice history, laid out as space, and the last of it is still unearned. Every district is a pile of questions somebody actually finished. ⟢ ZOOMED OUT. Do not dolly to HQ. deckDemo=final-map on survey/home. Let the map\'s own lighting and region fog carry it. If the talk is running long, this is the first demo to cut entirely.',
    speaker: 'Alan',
    budgetSeconds: 15,
    scene: { id: 'none', framing: 'drift' },
    // Hold the live map. No HQ dolly — the beat is the zoomed-out city.
    transition: 'camera',
    demo: {
      route: '/map?deckDemo=final-map',
      still: 'demo-map.webp',
      width: 1440,
      zoom: 1.06,
      budgetSeconds: 8,
      context: 'Context A',
      clickPath: [
        { start: 0, end: 8, action: 'Hold the zoomed-out map. Do not dolly to HQ. Let the districts and fog carry it.' },
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
    id: 'game-by-design',
    section: 'game',
    kind: 'figure',
    field: 'beige',
    eyebrow: 'Act V — the vehicle',
    headline: 'The game is the delivery mechanism.',
    deck: 'Without retention, the pedagogy does not run.',
    figure: {
      kind: 'retention-loop',
      steps: [
        { kicker: '01 · practice', label: 'Real LSAT question', role: 'practice' },
        { kicker: '02 · effort', label: 'Active reasoning', role: 'practice' },
        { kicker: '03 · game', label: 'Case outcome + currency', role: 'game' },
        { kicker: '04 · progress', label: 'Firm + world progress', role: 'game' },
        { kicker: '05 · return', label: 'Next case', role: 'game' },
      ],
      risk: {
        label: 'Burnout / drop-off risk',
        note: 'effort compounds across thousands of reps',
      },
      returnLabel: 'Visible progress creates a pull toward the next case',
    },
    notes:
      'You already know why the method dies without a delivery vehicle. Here is the vehicle. A real question, active reasoning, a case outcome, the firm grows, the next client walks in. Visible progress is what pulls you into the next rep. The game is not a skin on the pedagogy. It is how the pedagogy actually runs, one case at a time. ⟢ Do not re-lecture burnout. The previous act already made that case. This slide is the loop, drawn. Clark 2016 is Q&A only if asked about game design splits — average participant age ~12–13; design guidance, not proof.',
    speaker: 'Alan',
    budgetSeconds: 20,
    scene: { id: 'none', framing: 'still' },
    transition: 'cut',
  },
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
    // exact framing `concept-lawyer-tycoon` was rewritten to stop making.
    deck: 'Walk in and answer questions. And build the firm they pay for.',
    // The Q&A prompt. This slide is held on screen for the entire question
    // period, so the last line of the deck is an invitation rather than a
    // sign-off. With the ledger gone it is the only thing under the rule, which
    // is the right amount of weight for it: it is what the founders stop
    // talking on, not a fourth claim.
    pull: 'Questions?',
    notes:
      'So that is Lawyer Tycoon. Walk in, argue a real question, get coached on how you thought, and the next one is chosen from that evidence. The firm is what makes you come back. One place. Two ways in — and they are not alternatives. You answer questions, and you build the firm those questions pay for. Questions? ⟢ Held for the entire Q&A. Cheaper / narrower / harder to quit are spoken answers, not on-screen claims. No price to name. Q panel for competitors.',
    speaker: 'Nischay',
    budgetSeconds: 14,
    // A bare royal-blue room, the counsel stage right, lit from the right and
    // throwing a real shadow across the floor. She folds her arms on arrival
    // and holds that pose for the entire Q&A.
    scene: { id: 'close-room', framing: 'wide' },
    transition: 'foil-seal',
  }
]

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
 * Total seconds spent inside a live app frame.
 *
 * `stillOnly` slides are excluded. Nothing reads this — the presenter overlay
 * paces against `TOTAL_BUDGET_SECONDS` — so it is here to be quoted.
 */
export const DEMO_BUDGET_SECONDS = SLIDES.reduce(
  (sum, slide) => sum + (slide.demo && !slide.demo.stillOnly ? slide.demo.budgetSeconds ?? 0 : 0),
  0,
)
