/**
 * FIGURES — the bespoke slide graphics the narrative calls for.
 *
 * `NARRATIVE.md` specifies a visual per slide, and most of them are a small piece
 * of information design rather than a 3D scene: two bars whose ratio is the
 * argument, four tiles that re-sort, three effect sizes where the last two land at
 * nearly the same length. Those are SVG, not WebGL — they are typographic objects,
 * they have to be pixel-crisp on a projector, and they must not compete for frame
 * time with the scene behind them or with a live app iframe beside them.
 *
 * Each variant below is one slide's figure. The data is in the slide registry, so
 * a founder correcting a number edits `slides/index.ts` and nothing else — which
 * matters here more than usual, because several of these numbers are the ones
 * `CITATIONS.md` had to correct.
 *
 * **Every header below names its slide by id rather than by position, and no new
 * one may use a position.** They used to read "Slide 9 — the AI misdirection
 * chart", and by the time anyone looked, seven of them were wrong: inserting one
 * slide in Act II shifts every number after it and nothing in the toolchain
 * notices. An id is a deep link (`#/pov-ai-never-answers`), it is what the
 * registry is keyed on, and it survives the deck being reordered.
 *
 * Every figure animates itself in when `active` becomes true and holds. None of
 * them loops: a figure that keeps moving under a speaker is a figure that keeps
 * pulling the eye back to itself.
 */

/** `problem-coaching-tax` — coaching 0.22 against real LSATs 2.77, behaviour inverted. */
export type BarPairFigure = {
  kind: 'bar-pair'
  bars: Array<{
    /** The effect size, in LSAT points. Sets the bar length. */
    value: number
    label: string
    /** The share of the field that did this, shown as a small tag on the bar. */
    share: string
    shareLabel: string
    /** `true` draws fast and stops short; `false` draws slowly and passes it. */
    stub?: boolean
  }>
  /** Printed in the gap between the bars. */
  gapNote?: string
}

/** `problem-hours-and-price` — the hours bar, its four attributions, the price ribbon. */
export type HoursBarFigure = {
  kind: 'hours-bar'
  /** e.g. '150–300 hours, by their own recommendation' */
  barLabel: string
  ticks: Array<{
    /** Position along the bar, 0..1. */
    at: number
    source: string
    /** Their published range. Omit for LSAC, whose tick is deliberately blank. */
    range?: string
  }>
  /** The sliver at the far right, drawn last and at true relative proportion. */
  outcome: string
  /** The two curriculum quotes that appear as the bar fills with video texture. */
  curriculum: string[]
  /** The price ribbon, and the LSAC line item that arrives late and alone. */
  price: string
  lateLineItem: string
}

/**
 * `thesis-speedrun` — where the first question sits on a clock, on two paths.
 *
 * Rebuilt, because the old drawing argued the opposite of the slide. It ran a
 * route left to right past three struck-out waypoints and landed `first real
 * question` at the far right of the frame — so the one object the headline is
 * about was drawn at the *end* of the picture, on a line whose horizontal axis
 * was never named. "So skip to the questions" over a diagram whose question is
 * furthest away is not a subtle failure, and the founder's note on it was that
 * the whole slide is too abstract to read.
 *
 * What replaced it is the same claim with the geometry the claim implies: one
 * horizontal axis, named out loud as time to the first question, and two lanes
 * on it. The course path spends the axis and arrives at its question at the far
 * right; ours is a single node at the origin. The distance between the two
 * question markers is the argument, and it is drawn as a dimension line so that
 * it is a measured distance rather than a slope.
 */
export type RouteFigure = {
  kind: 'route'
  /** Printed under the shared axis. Names what the horizontal distance is. */
  axisLabel: string
  lanes: {
    /**
     * The dim lane. `stages` are what a curriculum puts in front of a student
     * before the first question; `arrival` is the question at the end of them.
     * Deliberately unattributed — see the note on the slide in the registry.
     */
    course: { label: string; stages: string[]; arrival: string }
    /**
     * The bright lane, whose one *named* node sits at the origin. The run of
     * unlabelled marks that follows it is drawn from a constant in `route.tsx`
     * and is deliberately not a field here: it is a texture, and a number in
     * the registry would be read by the next person as a claim about how many
     * questions a student gets through, which is not something the deck knows.
     */
    ours: { label: string; arrival: string }
  }
  /** The chip on our node. Counts real time, because the clock is the point. */
  timerLabel: string
}

/** `pov-reasoning-is-the-work` — a question card whose emphasis moves onto the reasoning box. */
export type ReasoningCardFigure = {
  kind: 'reasoning-card'
  /** Shown small at the top of the mock card. */
  stem: string
  /** Five answer choices, which shrink and desaturate. */
  choices: string[]
  /** The text that appears in the growing reasoning box. */
  reasoning: string
  /** The clause the coaching panel underlines in verdict red. Must appear in `reasoning`. */
  underline: string
  /** The three effect sizes. The last two must land at nearly equal length. */
  effects: Array<{ value: number; label: string; emphasis?: boolean }>
}

/** `pov-confidence-signal` — four identical-looking results that re-sort into four problems. */
export type ConfidenceTilesFigure = {
  kind: 'confidence-tiles'
  tiles: Array<{
    /** What the score report sees. */
    mark: 'correct' | 'wrong'
    /** 1..5, dropped onto the tile in the second beat. */
    confidence: number
    /** What it actually is, once confidence is known. */
    category: string
    /** The one that takes the warning outline and pushes to the front. */
    flagged?: boolean
  }>
}

/**
 * `pov-volume-is-the-constraint` — the cohort that had the method, and the half that never used it.
 *
 * One bar drawn at full width and then pulled back to `keptShare`, leaving its
 * own hatched footprint where the rest of the cohort was, and under it the two
 * usage variables the same study looked at against a real LSAT score.
 *
 * Neither ledger row is a bar growing out of zero, and that is the whole point
 * of the two shapes below. LSAC's own report says, in the paragraph that
 * carries the 4.3, that its figures are "not gains... but rather increments for
 * independent groups of students" — so a bar running from an origin, or an
 * arrow between two doses, would draw one student climbing a dose-response
 * curve, which is precisely the reading the source disclaims. A `contrast` row
 * draws the two groups as two marks with an unarrowed span between them, which
 * is the ordinary idiom for a difference between group means. A `null` row
 * draws a bare origin tick, because LSAC's finding on video is that it was not
 * correlated at all, and a short bar would report a small effect instead.
 */
export type CohortSplitFigure = {
  kind: 'cohort-split'
  /** Small line above the bar, naming who is in it and on what n. */
  cohortLabel: string
  /** The share that completed at least one exam, 0..1. Drawn solid. */
  keptShare: number
  keptLabel: string
  /** Printed against the hatch, and the number the slide is about. */
  lostLabel: string
  inputs: Array<CohortSplitInput>
}

/** One end of a `contrast` row: where the group sits, and what dose it is. */
export type CohortSplitGroup = {
  /** Position on the track, 0..1. Ordinal, not to scale — see `contrast`. */
  at: number
  /** The dose this group had, printed under its mark. */
  label: string
}

export type CohortSplitInput = {
  label: string
  verdict: string
  /** The qualifying line, set small under the verdict. */
  note?: string
  /** The input that moved the score keeps full weight; the other steps back. */
  emphasis?: boolean
} & (
  | {
      /**
       * Two independent groups, drawn as two marks joined by a span with no
       * arrowhead. The track is ordinal and deliberately not to scale: the two
       * doses LSAC reports are 26 minutes and 47 hours, a ratio of about 108,
       * and plotting that linearly would put both groups on the same pixel.
       */
      shape: 'contrast'
      low: CohortSplitGroup
      high: CohortSplitGroup
    }
  | {
      /** The study found no correlation. One origin tick, and nothing else. */
      shape: 'null'
    }
)

/** `pov-ai-never-answers` — the AI misdirection chart. */
export type TracesFigure = {
  kind: 'traces'
  /** Drawn in order. The first should look fantastic; the second is the reveal. */
  traces: Array<{
    label: string
    /** 0..1 values across the x axis. */
    points: number[]
    style: 'good' | 'bad' | 'guarded'
  }>
  /** The dashed reference line, 0..1. */
  baseline: number
  baselineLabel: string
}

/**
 * `pov-strategy-inside-the-question` — the card the app hands you inside a question, and the record that
 * decides whether it stays.
 *
 * Rebuilt twice. The first version was a fan of fourteen cards over a greeked
 * question; the second laid the whole catalogue, the method and the verdict out
 * as three columns, and the founder's note on that one was *"way too much text
 * and clutter, not aesthetic, no dynamic animations"*. He was right about the
 * count: it carried seven blocks — headline, deck sentence, fourteen names,
 * five triggers, a named method, three steps, two numbers, a qualifier and two
 * footer claims — for one idea.
 *
 * The idea is a mechanism with two ends, so the figure now draws exactly two
 * objects and they are both the product's: the `strategy-tip` card from
 * `frontend/src/case-flow.tsx` as it appears mid-question, and the WITH IT /
 * WITHOUT IT tiles from the dashboard's Approaches panel in
 * `frontend/src/strategy-sections.tsx`. The catalogue is a count in a chip. See
 * `method-lab.tsx` for what each field has to match.
 */
export type MethodLabFigure = {
  kind: 'method-lab'
  /**
   * How many approaches the app ships. Printed as a chip, not enumerated —
   * fourteen names on screen is a list nobody reads and a count the room can
   * check in one glance.
   */
  catalogSize: number
  /**
   * The card the student is actually given. Every string here is the app's own
   * copy from `backend/app/strategies.py` — this figure must not paraphrase a
   * method, because the room may go and look.
   */
  handed: {
    name: string
    /** What fired it: the question types this method is offered on. */
    trigger: string
    /** The three things it asks for, in order. */
    steps: string[]
    /** The button the student presses to take it. The app's own label. */
    take: string
    /** The one they press to refuse. Drawn unpressed, because the arm matters. */
    refuse: string
  }
  /**
   * The two arms of this student's own trial, as *counts*.
   *
   * Counts and not percentages, and this is load-bearing rather than a style
   * choice. `backend/app/strategies.py` sets `PERCENTAGE_DISPLAY_MIN_SAMPLE =
   * 30` and prints `13/16` rather than `81%` below it, on the stated grounds
   * that "a control sample of 4 can only ever read 0/25/50/75/100%, so any
   * whole-point percentage at this scale is fiction". A slide that prints a
   * percentage the product itself refuses to print is a slide that loses an
   * argument with anyone who opens the app.
   *
   * `of` is the arm's size, `hit` the number correct. The bars are drawn from
   * the ratio, so the comparison is still instant; only the printed figure is
   * the honest one.
   */
  trial: {
    with: { label: string; hit: number; of: number }
    without: { label: string; hit: number; of: number }
  }
}

/**
 * `market-in-their-own-words` — the field in its own words, and the column nobody else fills.
 *
 * NEW, and it exists over an objection recorded in `NARRATIVE.md` §D, which
 * argued that a comparison table is "the least persuasive object a founder can
 * put on a projector." Three of that objection's four reasons were good and are
 * designed around here rather than ignored; the fourth had already lapsed. See
 * the slide's own note in the registry, and `CITATIONS.md` §4.10 for the
 * sourcing of every cell.
 *
 * The shape of the answer: **it is not a scorecard.** There are no ticks, no
 * crosses and no column in which one product beats another. There are two
 * columns of plain statements, and every statement about a competitor is that
 * competitor's own marketing copy, quoted and dated. Nothing here can be argued
 * with one row at a time, because there is no judgement in a row to argue with
 * — the only judgement on the slide is the reader's, when they notice that the
 * second column says the same three words five times.
 */
export type MarketLedgerFigure = {
  kind: 'market-ledger'
  /** Head over the quotes. Names the axis: what the product puts in front of you. */
  claimHead: string
  /** Head over the second column. The one that repeats. */
  gradesHead: string
  /**
   * One row per competitor, in the order they should be read.
   *
   * `claim` MUST be the company's own words with quotation marks, or an
   * unquoted statement of fact that their own page supports. An elision is
   * marked with `…`. No paraphrase, ever: the entire persuasive weight of this
   * figure is that a room can check every line, and one invented phrase costs
   * all of them. `CITATIONS.md` §4.10 carries the full quote and the URL.
   *
   * `grades` is what the product scores about an attempt. It is the same for
   * every competitor by finding rather than by construction — see §4.10 — and
   * if that ever stops being true this figure must change, not be padded.
   */
  rows: Array<{ name: string; claim: string; grades: string }>
  /** Us, under a rule. Same two columns, and the second one is the slide. */
  ours: { name: string; claim: string; grades: string }
}

/** `pov-real-clock` — the per-question ring that completes, and the full-form ring that does not. */
export type ClockRingsFigure = {
  kind: 'clock-rings'
  /** 0..1 of the inner ring the student has used. */
  used: number
  /** 0..1 target pace, drawn as a ghost ring behind. */
  target: number
  /**
   * The app's own `case-timer`, at the middle of the dial: what the clock reads
   * and what it is running against. Both are quoted from the product —
   * `case-flow.tsx` sets the elapsed time over `target {…}` — and the two must
   * agree with `used` and `target` above, because the ring is the same reading
   * drawn round. 150 seconds is the shipped Logical Reasoning target; see
   * `_target_time_seconds` in `backend/app/services.py`.
   */
  innerTime: string
  innerTarget: string
  /** The outer ring, deliberately left unfinished at this fraction. */
  outer: number
  outerLabel: string
}

/** `dashboard-everything` — every signal the product watches, converging on one derived number. */
export type SignalIndexFigure = {
  kind: 'signal-index'
  /** The large numeral the signals are read into. */
  centre: { label: string; value: string }
  nodes: Array<{
    label: string
    /** How much this signal feeds the index, 0..1. Sets the row order, the
     *  weight bar and the hairline's thickness. */
    weight: number
    /** The current weakest link burns brighter. */
    highlight?: boolean
    /** Carries an `evidence forming` tag: the sample is not big enough to compare yet. */
    forming?: boolean
  }>
}

/**
 * `pov-virtual-currency`, superseded — points light all four engagement spokes; badges light one.
 *
 * Not currently bound to a slide: `pov-virtual-currency` now argues the
 * mechanism rather than the mechanic and uses `currency-lift` instead. Kept
 * because the points-against-badges comparison is still true, still sourced in
 * `CITATIONS.md` §6.2, and is the drop-in if the founders want that slide back.
 */
export type SpokesFigure = {
  kind: 'spokes'
  spokes: string[]
  series: Array<{ label: string; lit: boolean[]; emphasis?: boolean }>
}

/**
 * `pov-virtual-currency` — what a virtual currency moved, and what it left alone.
 *
 * One control line with a bar per course running past it, then the outcomes the
 * same intervention did not shift. `multiple` is the experimental group as a
 * factor of its own comparison group, so the rows are comparable to each other
 * even though the courses' absolute volumes are not.
 */
export type CurrencyLiftFigure = {
  kind: 'currency-lift'
  /** What is being counted, set small above the plot. */
  measureLabel: string
  /** Sits on the shared dashed gate, printed once on the first row. */
  controlLabel: string
  rows: Array<{ course: string; venue: string; multiple: number }>
}

/** `game-by-design` — the four Clark splits, ours against the alternative. */
export type PairedBarsFigure = {
  kind: 'paired-bars'
  pairs: Array<{
    label: string
    ours: { label: string; value: number }
    theirs: { label: string; value: number }
  }>
  /** The caveat, set small in a footer. */
  footnote: string
}

/**
 * `game-never-gates` — the app's own unlock list, and the one row with no lock.
 *
 * Every `requires` string on this figure is quoted from the product, not
 * written for the deck: `_wardrobe_requirement` in `backend/app/game.py`
 * composes exactly these sentences, and `wardrobe.tsx` prints them beside a
 * padlock. Keep them verbatim. A requirement invented to read better on a
 * projector is a competitor's favourite kind of slide.
 */
export type GateFigure = {
  kind: 'gate'
  /** Over the requirement column. The app's lock chip has no label; this is ours. */
  head: string
  /** What the game keeps behind reps, each with the requirement the app prints. */
  locked: Array<{ name: string; requires: string }>
  /** The one row that carries no padlock: the practice itself. */
  open: { name: string; requires: string }
  /** The wardrobe screen's own sentence about which way the coupling runs. */
  quote: string
  /** Where that sentence is printed in the app. */
  quoteCredit: string
}

/**
 * `turn-nothing-to-teach` — the hero numeral, and the turn.
 *
 * The narrative is specific that this must read as the same extruded object the
 * room saw on slide 2, dollied in. It also offers a drop-in alternative: the word
 * `SKILLS` at the same extruded scale carries identical weight and takes the same
 * transition out. Switching is a one-word edit to `value` — nothing here or in
 * the stylesheet assumes the content is a number.
 */
export type NumeralFigure = {
  kind: 'numeral'
  /** `0.22` as built. `SKILLS` is the sanctioned alternative. */
  value: string
  /** Degrees off-axis. The narrative asks for "maybe eight". */
  spin?: number
}

export type FigureSpec =
  | NumeralFigure
  | BarPairFigure
  | HoursBarFigure
  | MarketLedgerFigure
  | RouteFigure
  | ReasoningCardFigure
  | ConfidenceTilesFigure
  | CohortSplitFigure
  | TracesFigure
  | MethodLabFigure
  | ClockRingsFigure
  | SignalIndexFigure
  | SpokesFigure
  | CurrencyLiftFigure
  | PairedBarsFigure
  | GateFigure

export type FigureProps = {
  spec: FigureSpec
  /** True when the slide is the live one. Drives the entrance; never loops. */
  active: boolean
  /** `prefers-reduced-motion`: draw the final state with no entrance at all. */
  reduced: boolean
}
