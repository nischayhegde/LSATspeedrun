/** Evidence guardrails for the original-pitch cut. */

export type WarningStatus = 'resolved' | 'corrected' | 'caveat'

export type WarningItem = {
  number: number
  title: string
  status: WarningStatus
  body: string
  slides?: string[]
  openAction?: { what: string; when: string }
  sources?: string[]
}

export const WARNINGS: readonly WarningItem[] = [
  {
    number: 1,
    title: 'Two months is a goal, not a result',
    status: 'caveat',
    body:
      'The opening says the average student studies for about four months and Lawyer Tycoon aims to cut that in half. '
      + 'Use “goal” or “aim.” The original PPTX does not contain outcome data proving a two-month improvement cycle.',
    slides: ['title-lawyer-tycoon'],
  },
  {
    number: 2,
    title: 'Keep the SAT figure in its original form',
    status: 'caveat',
    body:
      'The original notes say the average LSAT test taker scored 610 on SAT Reading. Do not expand that into a new '
      + 'causal or demographic claim; use it only for the original point that the audience already has general reading knowledge.',
    slides: ['spiky-point-of-view'],
  },
  {
    number: 3,
    title: 'The 40% line is about instruction time',
    status: 'caveat',
    body:
      'The original notes say popular apps such as 7Sage and LSAT Lab put more than forty percent of study time into '
      + 'live or video instruction. Do not add prices, course-hour totals, or a broader competitor scorecard.',
    slides: ['goal-faster-improvement'],
  },
  {
    number: 4,
    title: 'Currency evidence is about practice volume',
    status: 'corrected',
    body:
      'The original evidence slide supports 1.3×–3.7× more out-of-class practice per student across three semester-long '
      + 'university studies. Say “practice,” not LSAT points, grades, focus, or guaranteed retention.',
    slides: ['game-research-backed'],
    sources: ['Dicheva et al. (2023), Trends in Higher Education 2(3)'],
  },
  {
    number: 5,
    title: 'The two-month game pace is conditional',
    status: 'caveat',
    body:
      'The progression target assumes twenty correctly answered questions every day. It is a design pace, not an observed completion rate.',
    slides: ['demo-office-transformation'],
  },
]

export const OPEN_ACTIONS = WARNINGS.filter((item) => item.openAction !== undefined)
