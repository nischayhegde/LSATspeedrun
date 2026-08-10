/**
 * The founders' warning block — "⚠ Evidence integrity", read before rehearsing.
 *
 * Thirteen items. Twelve of them are closed: a correction already applied to the
 * narrative, or a caveat the presenter needs in their head. Exactly one carries
 * an open action, and it is open on purpose because it cannot be closed until the
 * morning of the pitch — competitor prices move, and the pricing line is the one
 * the room can falsify from a phone in four seconds.
 *
 * `status` is what the presenter needs to know about the item's history:
 *
 *   resolved   the claim was removed or replaced; nothing is left to say
 *   corrected  the claim is still in the deck, with different numbers or framing
 *   caveat     the claim is fine as written but has a limit to keep in mind
 */

export type WarningStatus = 'resolved' | 'corrected' | 'caveat'

export type WarningItem = {
  /** Position in the narrative's numbered list, 1-based. */
  number: number
  title: string
  status: WarningStatus
  body: string
  /** Slides the item bears on, by registry id. */
  slides?: string[]
  /**
   * Something still to be done, and when. Present on exactly one item; if a
   * second ever appears, the deck has an unresolved evidence problem.
   */
  openAction?: { what: string; when: string }
  sources?: string[]
}

export const WARNINGS: readonly WarningItem[] = [
  {
    number: 1,
    title: 'The 610 SAT figure is out of the deck',
    status: 'resolved',
    body:
      'No published source links individual SAT records to individual LSAT records: LSAC does not collect SAT scores, '
      + 'College Board does not report by graduate or professional intent, and the only academic work joining the two is '
      + 'an aggregate correlation of means by intended undergraduate major — 16 data points, no individual linkage. '
      + 'Separately, "610 on SAT reading" does not name a real scale; a standalone 200–800 reading section has not existed '
      + 'since January 2016. The turn now runs on LSAC\'s own description of the exam and the ABA\'s degree requirement, '
      + 'and it is stronger for it, because it closes a loop the audience accepted ninety seconds earlier.',
    slides: ['turn-nothing-to-teach'],
  },
  {
    number: 2,
    title: 'Competitor pricing was wrong and was the most dangerous line in the deck',
    status: 'corrected',
    body:
      'The deck said competitors charge "hundreds of dollars a month." 7Sage Core is $69/month and LSAT Lab Premium is '
      + '$65/month; only the coaching tiers reach $299 and $425. The verified ladder is 7Sage Core $69 / Live $129 / '
      + 'Coach $299 and LSAT Lab Free $0 / Premium $65 / Classroom $125 / Tutor $425, and on top of any of them every '
      + 'competitor makes you buy LSAC\'s LawHub Advantage at $124/year. The deck now says "$65–$425 a month, plus $124 a '
      + 'year to LSAC," which is true, more specific, and harder to dismiss.',
    slides: ['problem-hours-and-price'],
    openAction: {
      what:
        'Re-check both competitor pricing pages and update the price ribbon and the Q&A answer if anything moved. '
        + '7Sage was running a $79 first-month promotion on the Live tier as of 2026-08-10 and promotional pricing '
        + 'changes without notice.',
      when: 'The morning of the pitch, before rehearsal.',
    },
    sources: ['https://7sage.com/self-study/pricing', 'https://www.lsatlab.com/pricing'],
  },
  {
    number: 3,
    title: 'The study-hours number is now attributed, not asserted',
    status: 'corrected',
    body:
      'No independent research measures how long students actually study for the LSAT. Every figure in circulation comes '
      + 'from the prep companies themselves: Princeton Review 250–300 hours, Blueprint 200–300, Kaplan 150–300, and LSAC '
      + 'declines to give a number at all. That is a rhetorical gift, because they are the competitors\' own '
      + 'recommendations and they cannot dispute them. Volunteer the obvious objection first: these are marketing '
      + 'recommendations from companies that bill monthly.',
    slides: ['problem-hours-and-price'],
  },
  {
    number: 4,
    title: '"80+ hours of instruction" is gone',
    status: 'corrected',
    body:
      'Neither competitor publishes a total instruction-hours figure, so the claim could not be sourced to them, and on '
      + "7Sage's cheapest tier the honest number is probably closer to 50. Quoting their published curricula is more "
      + 'damning and completely safe: 7Sage advertises 900+ bite-sized video lessons, LSAT Lab advertises 90-minute live '
      + 'classes five days a week inside three-month courses. Every word of that is a direct quote from their own marketing.',
    slides: ['problem-hours-and-price'],
  },
  {
    number: 5,
    title: 'Removed: "a 5 to 10 point increase from their initial diagnostic"',
    status: 'resolved',
    body:
      'No published source measures diagnostic-to-final gains. Prep companies claim 10–20 points, which is what they are '
      + "selling. LSAC's only hard number is for retakes — +2.8 points on a second sitting and +2.2 on a third (TR 14-01) "
      + '— which measures the gap between administrations rather than progress from a diagnostic. '
      + 'The slide now says "a few points," which is qualitative and safe. The retake figures are in the Q&A panel if a '
      + 'questioner pushes for a number.',
    slides: ['problem-hours-and-price'],
  },
  {
    number: 6,
    title: 'There is no Journal of IT Education study',
    status: 'corrected',
    body:
      'The founders\' notes cited "a large study in the Journal of IT Education" for virtual-currency gamification. '
      + 'No such source exists, and "massively improved participation and focus" is not supportable by anything that does. '
      + 'It has been replaced with Meng et al., where points correlated with all four measured engagement dimensions '
      + '(skills ρ = .146, emotional ρ = .274, participation ρ = .248, performance ρ = .293) while badges correlated with '
      + "only one, and Sailer & Homner's meta-analysis at g = 0.49 cognitive, g = 0.36 motivational, g = 0.25 behavioral. "
      + 'Those are small-to-moderate numbers. Do not say "massively."',
    slides: ['pov-virtual-currency'],
  },
  {
    number: 7,
    title: '"Watching videos and learning concepts is ineffective" is too strong',
    status: 'caveat',
    body:
      'Wightman found coaching-course users scored +0.22 points over nonusers, from a self-reported, non-randomized '
      + 'survey. That shows instruction barely moves the aggregate. It does not prove instruction is useless, and a '
      + 'hostile questioner will say so. The deck now says instruction "can\'t be the core."',
    slides: ['problem-coaching-tax', 'turn-nothing-to-teach'],
  },
  {
    number: 8,
    title: '"14 strategies" needs one word of care',
    status: 'caveat',
    body:
      'The catalog holds 14 methods, but comparative_matrix is currently unreachable because the dataset never marks '
      + 'comparative passages. Say "fourteen in the catalog, thirteen currently in rotation" if anyone presses, '
      + 'and never claim all fourteen are being trialed.',
    slides: ['pov-strategy-inside-the-question'],
  },
  {
    number: 9,
    title: 'The old `pov-no-menu` slide is gone as a slide',
    status: 'resolved',
    body:
      'Taking question-type choice away is the one POV with no brainlift source, and it sits in tension with Ryan & Deci. '
      + 'The argument survives, reframed as structure rather than control, inside the concept slide and the close, '
      + 'with Focus Mode as the autonomy valve.',
    slides: ['concept-lawyer-tycoon', 'demo-focus-mode', 'close-one-stop-shop'],
  },
  {
    number: 10,
    title: 'The logic-games jab moved off the stage and into Q&A',
    status: 'resolved',
    body:
      'LSAC removing Analytical Reasoning as of August 2024 is accurate and worth knowing, but both 7Sage and LSAT Lab '
      + 'have publicly updated their curricula for the new format, so aiming the jab at named competitors is now '
      + 'falsifiable. It lives in the Q&A panel, pointed at the general back catalog.',
  },
  {
    number: 11,
    title: 'Cite Wightman precisely if you put a source line on screen',
    status: 'caveat',
    body:
      'The report is Wightman, L. F. (1990), Self-Reported Methods of Test Preparation Used by LSAT Takers, '
      + 'LSAC Research Report Series RR 90-01, covering June and September 1989 test takers. '
      + 'The on-screen hairline reads "LSAC, Wightman, RR 90-01 (1989 test takers), self-reported."',
    slides: ['problem-coaching-tax'],
  },
  {
    number: 12,
    title: 'Know where you are genuinely exposed competitively',
    status: 'caveat',
    body:
      'Four things, none fatal if you say it first. ONE, the thesis is not ours alone: LSAT Demon has argued publicly '
      + 'for years that drilling beats lecturing, and their product is adaptive, question-first and aimed at exactly '
      + 'the watch-videos model Acts I and II attack. Claim the rep, not the diagnosis. '
      + "TWO, adaptive selection is table stakes — Demon's Smart Drilling, 7Sage's smart drills and LSAT Lab's "
      + 'Adaptive Drill Engine all weight toward weaknesses. What is distinctive is that we removed the manual '
      + 'override, where LSAT Lab ships a Filtered setting for custom drills to your exact specifications; '
      + 'say "we removed the override," not "we pick for you." '
      + "THREE, confidence capture will get called blind review, because 7Sage's whole review culture is built on it; "
      + 'the honest distinction is a 1-to-5 value on every question, before the key, as a data field that drives '
      + 'scheduling rather than a weekly ritual. '
      + 'FOUR, the clock: Demon tells students to hide it and we time everything from day one, which is a real '
      + 'disagreement with a competitor who argues their side well. The answers are in the Q&A panel; '
      + 'the sourced seven-product reference is CITATIONS.md §4.',
    slides: ['concept-lawyer-tycoon', 'pov-confidence-signal', 'pov-real-clock', 'pov-reasoning-is-the-work'],
    sources: [
      'https://lsatdemon.com/plans/lsat',
      'https://lsatdemon.com/resources/demon-daily/the-purpose-of-drilling',
      'https://www.lsatlab.com/features',
      'deck/CITATIONS.md §4',
    ],
  },
  {
    number: 13,
    title: 'The deck no longer calls our questions "official"',
    status: 'corrected',
    body:
      'The bank is a pinned, checksum-manifested snapshot of 6,886 questions — 4,520 Logical Reasoning from '
      + 'tasksource/lsat-lr and 2,366 Reading Comprehension from tasksource/lsat-rc, both publicly released LSAT '
      + 'material — and neither upstream dataset card declares a license. In this market "official" means '
      + 'LSAC-licensed content through LawHub Advantage at $124/year, so the old wording asserted a license we do not '
      + 'hold and invited "then what are you paying LSAC?" on the very slides where that fee is the attack. '
      + 'concept-lawyer-tycoon now reads "6,886 LSAT questions" and demo-case-answer says "real LSAT questions from '
      + 'publicly released exams," which is stronger on stage, not weaker. The LawHub line is untouched: it is still '
      + 'true that every competitor passes $124/year through to students. The provenance answer is in the Q&A panel. '
      + 'If the founders do hold a content license, or conclude the dataset terms permit commercial use, '
      + 'the stronger wording can come back — verify before reverting it.',
    slides: ['concept-lawyer-tycoon', 'demo-case-answer'],
    sources: [
      'https://huggingface.co/datasets/tasksource/lsat-lr',
      'https://huggingface.co/datasets/tasksource/lsat-rc',
      'backend/data/question_bank/manifest.json',
      'deck/CITATIONS.md §4.9 item 10',
    ],
  },
]

/** The items that still need someone to do something. Expected length: 1. */
export const OPEN_ACTIONS = WARNINGS.filter((item) => item.openAction)
