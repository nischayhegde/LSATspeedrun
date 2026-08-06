/**
 * The tour's replay trigger, kept apart from the tour itself.
 *
 * Two menus offer "replay the guided tour", and importing that button's handler
 * from `guided-tour.tsx` pulled the whole tour — its script, its highlight
 * geometry and its 3D guide — into the entry bundle, where every screen paid to
 * parse it before anything could be drawn. A bare event dispatch is all a menu
 * needs, so that is all it imports; the tour itself is loaded on its own time.
 */
export const TOUR_REPLAY_EVENT = 'lsat-tycoon:replay-tour'

export function replayGuidedTour() {
  window.dispatchEvent(new Event(TOUR_REPLAY_EVENT))
}
