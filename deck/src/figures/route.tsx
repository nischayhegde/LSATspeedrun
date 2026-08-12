import type { RouteFigure } from './types'
import { clockText, pct, usePhase, useStopwatch, vars, type FigureBody } from './kit'

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
const MARKS = [40, 400, 1000, 1360, 1700, 2180] as const

/** How far apart the course stages land. Three at 160ms is a walk, not a list. */
const STAGE_STAGGER_MS = 160

/**
 * How many marks follow our origin node, and how fast they land.
 *
 * A density, not a claim — see the header. 22 is the count at which the run
 * reads as continuous work at 1366 wide without the marks touching at 1920, and
 * 26ms apart it sweeps the lane in a little over half a second, which is short
 * enough to be one gesture rather than a second list to read.
 */
const REPS = 22
const REP_STAGGER_MS = 26

/** The two lanes and the dimension line, in percent down the frame. */
const COURSE_LANE = 24
const OURS_LANE = 62
const DIM_LINE = 90

/** Where the lanes start and end, in percent across. */
const ORIGIN = 6
const END = 94

/** Where the readout is held when motion is off — a plausible split, not zeroes. */
const FROZEN_MS = 12_400

export function Route({ spec, active, reduced }: FigureBody<RouteFigure>) {
  const phase = usePhase(active, reduced, MARKS)
  const elapsed = useStopwatch(active, reduced, FROZEN_MS)

  const { course, ours } = spec.lanes
  // Stages are spaced across the lane with the arrival marker holding the far
  // end, so a registry that adds or removes one re-spaces rather than collides.
  const stops = course.stages.length + 1
  const xOf = (index: number) => ORIGIN + ((END - ORIGIN) / stops) * (index + 1)

  return (
    <div className="fig-rt">
      <p className="fig-rt-lane-name" style={vars({ left: pct(ORIGIN / 100), top: pct(COURSE_LANE / 100), opacity: phase >= 1 ? 1 : 0 })}>
        {course.label}
      </p>
      <span
        className="fig-rt-rail"
        style={vars({
          left: pct(ORIGIN / 100),
          top: pct(COURSE_LANE / 100),
          width: pct((END - ORIGIN) / 100),
          transform: `scaleX(${phase >= 1 ? 1 : 0})`,
        })}
      />

      {course.stages.map((stage, index) => (
        <div
          className="fig-rt-stage"
          key={stage}
          style={vars({
            left: pct(xOf(index) / 100),
            top: pct(COURSE_LANE / 100),
            opacity: phase >= 2 ? 1 : 0,
            '--fig-delay': `${index * STAGE_STAGGER_MS}ms`,
          })}
        >
          <span className="fig-rt-stage-plate" />
          <span className="fig-rt-stage-label">{stage}</span>
        </div>
      ))}

      {/* The course path's question, hollow, at the far end of its own lane. */}
      <div
        className="fig-rt-node"
        data-lane="course"
        style={vars({ left: pct(END / 100), top: pct(COURSE_LANE / 100), opacity: phase >= 3 ? 1 : 0 })}
      >
        <span className="fig-rt-dot" />
        <span className="fig-rt-node-label">{course.arrival}</span>
      </div>

      <p
        className="fig-rt-lane-name"
        data-ours="true"
        style={vars({ left: pct(ORIGIN / 100), top: pct(OURS_LANE / 100), opacity: phase >= 4 ? 1 : 0 })}
      >
        {ours.label}
      </p>
      <span
        className="fig-rt-rail"
        data-ours="true"
        style={vars({
          left: pct(ORIGIN / 100),
          top: pct(OURS_LANE / 100),
          width: pct((END - ORIGIN) / 100),
          transform: `scaleX(${phase >= 4 ? 1 : 0})`,
        })}
      />

      {/* Ours, solid, at zero.
          `transitions.ts` selects `.fig-rt-node[data-taken="true"]
          .fig-rt-ring` and grows it into slide 6's question card. That file is
          the engine's and not this pass's to re-aim, so both names and the
          nesting between them are a contract: a marker is a `fig-rt-node`
          whatever the rebuilt figure would rather have called it. */}
      <div
        className="fig-rt-node"
        data-lane="ours"
        data-taken="true"
        data-arrived={phase >= 4 ? 'true' : 'false'}
        style={vars({ left: pct(ORIGIN / 100), top: pct(OURS_LANE / 100), opacity: phase >= 4 ? 1 : 0 })}
      >
        <span className="fig-rt-dot">
          <span className="fig-rt-ring" style={{ opacity: phase >= 4 ? 1 : 0 }} />
        </span>
        <span className="fig-rt-node-label">{ours.arrival}</span>
        {/* The clock is the marker's second label rather than a HUD in a
            corner. That is what makes the axis mean anything at this end: a
            named distance needs a zero, and a readout running on the marker at
            the origin is the most literal zero available. */}
        <span className="fig-rt-clock">
          <span className="fig-rt-clock-track" data-morph="timer-track" />
          <span className="fig-rt-clock-name">{spec.timerLabel}</span>
          <span className="fig-rt-clock-read">{clockText(elapsed)}</span>
        </span>
      </div>

      {/* The run. Same mark as the node at the origin, smaller and silent, and
          the last one lands exactly on `END` — under the course lane's first
          question and over the far dimension tick. That vertical line through
          the three is the whole sentence: by the time that lane has one, this
          lane has had the axis. */}
      {Array.from({ length: REPS }, (_, index) => (
        <span
          className="fig-rt-rep"
          key={index}
          style={vars({
            left: pct((ORIGIN + ((END - ORIGIN) / REPS) * (index + 1)) / 100),
            top: pct(OURS_LANE / 100),
            // Just off full, so the named node at the origin still reads as
            // the brightest thing on its own lane.
            opacity: phase >= 5 ? .85 : 0,
            '--fig-delay': `${index * REP_STAGGER_MS}ms`,
          })}
        />
      ))}

      {/* Two end ticks and a span, in the drafting convention. No arrowhead,
          because an arrow would make it a journey, and no fill, because a fill
          would make it a quantity. It is the distance between two markers,
          drawn the way a distance is drawn — and the ticks are short rather
          than run up to the markers they measure, because three long sides is a
          box, and a box is a container rather than a measurement. The two
          markers are directly above the two ticks, which is the only alignment
          this needs to do its job. */}
      <div className="fig-rt-dim" style={{ opacity: phase >= 6 ? 1 : 0 }}>
        <span className="fig-rt-dim-tick" style={vars({ left: pct(ORIGIN / 100), top: pct(DIM_LINE / 100) })} />
        <span className="fig-rt-dim-tick" style={vars({ left: pct(END / 100), top: pct(DIM_LINE / 100) })} />
        <span
          className="fig-rt-dim-span"
          style={vars({
            left: pct(ORIGIN / 100),
            top: pct(DIM_LINE / 100),
            width: pct((END - ORIGIN) / 100),
            transform: `scaleX(${phase >= 6 ? 1 : 0})`,
          })}
        />
        <p className="fig-rt-axis">{spec.axisLabel}</p>
      </div>
    </div>
  )
}
