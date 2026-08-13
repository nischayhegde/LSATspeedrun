import type { RouteFigure } from './types'
import { usePhase, type FigureBody } from './kit'

/**
 * `thesis-speedrun` — Where the first question sits on a named clock.
 *
 * ## What was wrong with the drawing this replaces
 *
 * It ran a route left to right, greyed three waypoints out as it passed them,
 * and put `first real question` at the far right of the frame. Every part of
 * that is defensible in isolation and the composition says the wrong thing: the
 * horizontal axis was never named, so the diagonal read as a generic decline
 * rather than as distance; and the slide's own subject — the question — was
 * drawn at the end of the longest journey on screen, under a headline that says
 * to skip to it. The struck-out labels finished the job, because grey text with
 * a rule through it reads as an error state before it reads as a refusal.
 *
 * ## What this draws instead
 *
 * One axis, named out loud. Two lanes on it. The course path spends the whole
 * axis on three stages and arrives at a hollow question marker at the far
 * right; ours is one solid marker at the origin with a clock running on it. The
 * two markers are the same object at the same size on purpose, so the only
 * difference between them is where they sit, and a dimension line under both
 * makes that a measured distance rather than a slope.
 *
 * ## Why our lane does not stay empty
 *
 * It did, in the first cut of this rebuild, and an empty lane argues the
 * opposite of the slide: a rail with one mark on it and clear air to the right
 * reads as *nothing happens over here*, when what the deck claims is that the
 * span the course path spends getting to its first question is a span we spend
 * answering them. So the origin marker is followed by a run of the same mark,
 * smaller and unlabelled, all the way to the far tick — the picture of "they
 * sell hours, we sell reps" that the deck makes in words two slides earlier.
 *
 * `REPS` is a density and not a count, which is why it lives here rather than
 * in the registry: the deck does not know how many questions a given student
 * gets through in the time a course spends on its intro, and a number in the
 * content file is a number somebody will eventually defend in a Q&A. Nothing is
 * printed beside the run and nothing is totalled. It is texture, and the only
 * thing it has to say is *more of the object at the origin*.
 *
 * ## The order is the argument
 *
 * The eye is walked right along the course lane, stage by stage, until it
 * reaches that lane's question at the far edge — and then the frame cuts back
 * to zero and our marker lands there. Travel, then snap, then the run fills in
 * behind it left to right. That contrast is the beat, and it is why the stages
 * arrive before our node does rather than both lanes drawing at once.
 *
 * Everything is DOM rather than SVG, which is unusual for this folder and is
 * the right call for one reason: the course rail has to be *dashed* and has to
 * *draw on*, and an SVG stroke cannot do both — the reveal is a dash pattern,
 * so the pattern is spent. A rule with a `scaleX` from its left edge draws on
 * just as well and keeps its dashes.
 *
 * Under two seconds end to end, and it never repeats. The one thing that keeps
 * moving afterwards is the clock, which is what a clock is for.
 */

/**
 * Cumulative milliseconds. Course stages and our run of reps each stagger
 * inside their own beat, so neither count changes the runtime.
 */
const MARKS = [40, 720, 1320] as const

export function Route({ spec, active, reduced }: FigureBody<RouteFigure>) {
  const phase = usePhase(active, reduced, MARKS)
  const { course, ours } = spec.lanes

  return (
    <div className="fig-rt fig-rt-compare">
      <section className="fig-rt-endpoint is-delay" style={{ opacity: phase >= 1 ? 1 : 0 }}>
        <small>{course.label}</small>
        <b>{course.arrival}</b>
        <span>after the curriculum</span>
      </section>
      <i className="fig-rt-divider" style={{ transform: `scaleX(${phase >= 2 ? 1 : 0})` }} />
      <section className="fig-rt-endpoint is-now" style={{ opacity: phase >= 3 ? 1 : 0 }}>
        <small>{ours.label}</small>
        <b>{ours.arrival}</b>
        <span><em data-morph="timer-track" />0:06</span>
      </section>
    </div>
  )
}
