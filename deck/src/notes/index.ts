/**
 * The presenter's data, separate from the deck's.
 *
 * Nothing in here is ever shown to an audience. It is the material the presenter
 * needs *around* the slides: the answers to the questions the deck invites, the
 * evidence corrections behind every number on screen, and the order in which to
 * start dropping slides when the clock says so.
 *
 * It is deliberately not part of `slides/`. A slide is a thing with a headline
 * and a scene; these are three ordered lists with no staging, and folding them
 * into the registry would mean the copy contract in `slides/index.ts` covered two
 * different kinds of thing.
 *
 * `QaPanel` is exported but not mounted — see `README.md` for the four lines that
 * put it behind `Q`.
 */

export { QA, QA_TOPICS } from './qa'
export type { QaEntry, QaTopic } from './qa'

export { WARNINGS, OPEN_ACTIONS } from './warnings'
export type { WarningItem, WarningStatus } from './warnings'

export { CUT_ORDER, DO_NOT_CUT, DO_NOT_TRIM, FULL_CUT_SECONDS } from './cuts'
export type { CutAction, CutItem } from './cuts'

export { QaPanel } from './qa-panel'
