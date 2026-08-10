/**
 * The cut list, in priority order — §C of `deck/NARRATIVE.md`.
 *
 * This exists to be read *during* the talk, which is why it is ordered rather
 * than categorised: the presenter running two minutes long does not want a menu,
 * they want to know which slide goes first and how many seconds it buys. Cut in
 * this sequence and stop when you fit.
 *
 * `secondsSaved` is the net figure. Two of the cuts hand a sentence back to a
 * neighbouring slide, so the gross saving and the net saving differ, and the net
 * one is the only one worth quoting to yourself on stage.
 */

export type CutAction = 'drop' | 'trim'

export type CutItem = {
  /** Cut order, 1 first. */
  order: number
  slideId: string
  action: CutAction
  /** Net seconds saved, after any time handed back to another slide. */
  secondsSaved: number
  /** For a trim, the budget the slide is reduced to. */
  trimToSeconds?: number
  /** What the presenter actually does, and what covers the gap. */
  how: string
}

export const CUT_ORDER: readonly CutItem[] = [
  {
    order: 1,
    slideId: 'pov-real-clock',
    action: 'drop',
    secondsSaved: 21,
    how:
      'Fold it into the mega-litigation demo, which already shows the clock. Alan adds "timed to real pacing from day '
      + 'one, and full forms are optional" over the click path.',
  },
  {
    order: 2,
    slideId: 'pov-confidence-signal',
    action: 'drop',
    secondsSaved: 17,
    how:
      'Fold the confidence claim into `pov-reasoning-is-the-work` as one sentence. Gross −20, three seconds handed back, '
      + 'net −17.',
  },
  {
    order: 3,
    slideId: 'game-by-design',
    action: 'drop',
    secondsSaved: 14,
    how:
      'Alan names two of the four Clark splits over the office transformation instead. Gross −17, three seconds handed '
      + 'back, net −14.',
  },
  {
    order: 4,
    slideId: 'demo-map-and-firm',
    action: 'trim',
    secondsSaved: 8,
    trimToSeconds: 10,
    how: 'Map pull-back only; describe the firm tab without clicking.',
  },
  {
    order: 5,
    slideId: 'dashboard-everything',
    action: 'trim',
    secondsSaved: 4,
    trimToSeconds: 26,
    how: 'Let the ring assemble and name six of the twelve.',
  },
  {
    order: 6,
    slideId: 'title-lawyer-tycoon',
    action: 'trim',
    secondsSaved: 4,
    trimToSeconds: 12,
    how: 'Names and product category only; `problem-coaching-tax` carries the opening.',
  },
]

/** All six cuts taken. 9:40 becomes 8:32. */
export const FULL_CUT_SECONDS = CUT_ORDER.reduce((sum, cut) => sum + cut.secondsSaved, 0)

/**
 * Never cut, under any circumstances.
 *
 * These are the slides the argument does not survive without: the turn, the
 * specification the product is built against, the controversial claim that primes
 * the demo, the demo that proves it, the money shot, the design principle, and
 * the close.
 */
export const DO_NOT_CUT: readonly string[] = [
  'turn-nothing-to-teach',
  'pov-reasoning-is-the-work',
  'pov-ai-never-answers',
  'demo-case-answer',
  'demo-office-transformation',
  'game-never-gates',
  'close-one-stop-shop',
]

/**
 * Not on the cut list and not on the do-not-cut list, but do not trim it either.
 *
 * Every corrected number in the problem act lives on this slide. Cutting it for
 * time is how a wrong figure gets improvised back in.
 */
export const DO_NOT_TRIM: { slideId: string; why: string } = {
  slideId: 'problem-hours-and-price',
  why:
    'Every corrected number in the problem act lives here — the attributed hours, the competitors\' own curricula, and '
    + 'the real price ladder. Cutting it for time is how a wrong figure gets improvised back in.',
}
