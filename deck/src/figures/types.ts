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
 * Every figure animates itself in when `active` becomes true and holds. None of
 * them loops: a figure that keeps moving under a speaker is a figure that keeps
 * pulling the eye back to itself.
 */

/** Slide 2 — coaching 0.22 against real LSATs 2.77, with the behaviour inverted. */
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

/** Slide 3 — the hours bar, its four attributions, and the price ribbon. */
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

/** Slide 5 — the speedrun route: three nodes skipped, one taken. */
export type RouteFigure = {
  kind: 'route'
  nodes: Array<{ label: string; skipped: boolean }>
  /** Shown in the timer HUD pinned top-left. Counts up in real time. */
  timerLabel: string
}

/** Slide 6 — a question card whose emphasis moves onto the reasoning box. */
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

/** Slide 7 — four identical-looking results that re-sort into four problems. */
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
 * Slide 8 — the cohort that had the method, and the half that never used it.
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

/** Slide 9 — the AI misdirection chart. */
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

/** Slide 10 — the catalogue, the one method handed over, and whether it worked. */
export type MethodLabFigure = {
  kind: 'method-lab'
  /** The whole catalogue, in the app's own order. Drawn in full; none of it leaves. */
  methods: string[]
  /** Which one this question handed over. Index into `methods`. */
  keep: number
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
  }
  /** The verdict bars: this student, prompted vs. their own unprompted attempts. */
  lift: { prompted: number; baseline: number; note: string }
}

/** Slide 11 — the per-question ring that completes, and the full-form ring that does not. */
export type ClockRingsFigure = {
  kind: 'clock-rings'
  /** 0..1 of the inner ring the student has used. */
  used: number
  /** 0..1 target pace, drawn as a ghost ring behind. */
  target: number
  innerLabel: string
  /** The outer ring, deliberately left unfinished at this fraction. */
  outer: number
  outerLabel: string
}

/** Slide 15 — every signal the product watches, converging on the one derived number. */
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
 * Slide 16 — points light all four engagement spokes; badges light one.
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
 * Slide 16 — what a virtual currency moved, and what it left alone.
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
  /** The eyebrow on the null register, e.g. `did not move`. */
  unmovedLabel: string
  /** Outcomes the study measured and found unchanged. Drawn flat, never as bars. */
  unmoved: string[]
}

/** Slide 17 — the four Clark splits, ours against the alternative. */
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

/** Slide 22 — practice gates the game, and not the other way round. */
export type GateFigure = {
  kind: 'gate'
  left: string
  right: string
  /** The three real couplings, labelled under the main arrow. */
  couplings: string[]
  /** The struck-through reverse direction. */
  denied: string
}

/**
 * Slide 4 — the hero numeral, and the turn.
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
