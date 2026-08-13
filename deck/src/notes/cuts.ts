/** On-stage cut order for the 4:25 original-pitch cut. */

export type CutAction = 'drop' | 'trim'

export type CutItem = {
  order: number
  slideId: string
  action: CutAction
  secondsSaved: number
  trimToSeconds?: number
  how: string
}

export const CUT_ORDER: readonly CutItem[] = [
  {
    order: 1,
    slideId: 'demo-your-law-firm',
    action: 'drop',
    secondsSaved: 15,
    how: 'The next slide already shows the office transformation. Alan carries the visible-progress sentence into it.',
  },
  {
    order: 2,
    slideId: 'game-research-backed',
    action: 'trim',
    secondsSaved: 10,
    trimToSeconds: 15,
    how: 'Read the 1.3×–3.7× finding once and advance; save the study design for Q&A.',
  },
  {
    order: 3,
    slideId: 'demo-feedback-every-question',
    action: 'trim',
    secondsSaved: 8,
    trimToSeconds: 12,
    how: 'Name the rubric feedback and hold long enough to read one line.',
  },
]

export const FULL_CUT_SECONDS = CUT_ORDER.reduce((sum, cut) => sum + cut.secondsSaved, 0)

export const DO_NOT_CUT: readonly string[] = [
  'spiky-point-of-view',
  'goal-faster-improvement',
  'demo-mcq-and-justification',
  'demo-office-transformation',
  'why-lawyer-tycoon',
  'thanks-and-questions',
]

export const DO_NOT_TRIM: { slideId: string; why: string } = {
  slideId: 'demo-mcq-and-justification',
  why: 'It is the first complete view of the product’s core loop: strategy, answer, and written justification.',
}
