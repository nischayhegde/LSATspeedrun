import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

import type { BarPairFigure } from './types'
import { ExtrudedNumeral } from './extruded-numeral'
import { pct, usePhase, type FigureBody } from './kit'

/**
 * SLIDE 2 — `bar-pair`. Coaching's 0.22 against real LSATs' 2.77.
 *
 * The ratio is the argument, so the ratio is the drawing: the bars are scaled
 * against the larger value with no compression, no broken axis and no minimum
 * length on the stub. At 0.22 against 2.77 the short bar is 7.9% of the long one,
 * which looks like a mistake — and looking like a mistake is the point, because
 * it is the number the industry sells.
 *
 * Two things the layout has to protect. First, the numerals sit *past* the end of
 * their bars, which means the plotting width is the frame minus a gutter wide
 * enough for `+2.77`; if the long bar ran to the frame edge its numeral would
 * have to sit inside it and the two bars would be labelled differently. Second,
 * the empty span between the two bar ends is a mark in its own right — it gets a
 * dimension line and `gapNote` — so nothing decorative may fill it.
 *
 * The share tags carry the inversion (nearly half bought the course; barely a
 * third had finished a real test), which is why the percentages are set at
 * display scale rather than as captions: a room reads two big numbers crossing
 * over, and does not read two footnotes.
 */

/**
 * The entrance, in cumulative milliseconds. The stub is fast and the tall bar is
 * slow, which is a CSS duration rather than a mark — what these control is the
 * order the *type* lands in, so the audience reads the bar, then its number, then
 * the behaviour that contradicts it.
 *
 * The last two marks are the swap: the share tags land in the arrangement the
 * room expects, hold just long enough to be read that way, and then exchange
 * places. See `SWAP` below.
 */
const MARKS = [40, 620, 1700, 2050, 2500, 3050] as const

/**
 * THE SWAP, which `NARRATIVE.md` asks for in one clause — "two small
 * percentages fade in and swap position with a tick" — and which is the whole
 * reason this slide has share tags at all.
 *
 * The tags arrive on the bar each one *ought* to belong to: the larger share
 * against the larger effect. That is the arrangement the audience is already
 * holding, and for four hundred milliseconds the chart agrees with them. Then
 * the two tags travel, vertically, in one column, and trade bars. Nearly half
 * bought the course; barely a third had finished a real test — and the course
 * is the stub.
 *
 * Two constraints shaped the implementation. A tag travels *whole*, its number
 * and its sentence together, because "45.5%" and "bought the course" are one
 * claim and a version of this that swapped only the numerals would put a false
 * sentence on screen, which this deck does not do even for four hundred
 * milliseconds. And the distance is measured rather than assumed: the two rows
 * are different heights — only one of them carries the gap note — so there is
 * no constant that means "the other bar's tag" at every frame size.
 */
const SWAP = { enter: 4, settle: 5 } as const

export function BarPair({ spec, active, reduced }: FigureBody<BarPairFigure>) {
  const phase = usePhase(active, reduced, MARKS)
  const bars = spec.bars
  const peak = Math.max(...bars.map((bar) => Math.abs(bar.value)), Number.EPSILON)
  const [trackRefs, travel] = useSwapTravel(bars.length)

  // Where the two bars end, as fractions of the plotting width. The gap note is
  // drawn between the two extremes rather than between "bar 0" and "bar 1", so a
  // registry that lists the tall bar first still annotates the right span.
  const ends = bars.map((bar) => Math.abs(bar.value) / peak)
  const gapFrom = Math.min(...ends)
  const gapTo = Math.max(...ends)

  const rows = bars.map((bar, index) => {
    const end = ends[index] ?? 0
    // Each bar's numeral waits for its own bar rather than for a shared beat: the
    // stub's number is on screen and unimpressive while the tall bar is still
    // growing, which is the rhetorical shape of the slide.
    const numeralPhase = bar.stub ? 2 : 3
    return (
      <div className="fig-bp-row" key={bar.label} data-stub={bar.stub ? 'true' : 'false'}>
        <p className="fig-bp-name">{bar.label}</p>
        <div className="fig-bp-track" ref={trackRefs[index]}>
          <div className="fig-bp-run" style={{ width: phase >= 1 ? pct(end) : '0%' }} />
          {/* The numeral is the extruded object, not flat type.
              Slide 4's hero is the same component, and the narrative's whole
              requirement for that slide is that the room recognises it. An
              object cannot be recognised if it was never shown: set flat here
              and extruded there, the callback would be to a number rather than
              to a thing. At this size the extrusion reads as weight rather
              than as a effect, which is what it should do while the bars are
              still the subject. */}
          <div
            className="fig-bp-value"
            style={{
              left: pct(end),
              opacity: phase >= numeralPhase ? 1 : 0,
              transform: phase >= numeralPhase ? 'translate(0, -50%)' : 'translate(-.4em, -50%)',
            }}
          >
            <ExtrudedNumeral
              value={formatEffect(bar.value)}
              spin={8}
              morph={bar.stub ? 'numeral' : 'bar-numeral'}
            />
          </div>
          {/* The share tag sits under the *start* of its bar rather than at its
              end. Chased to the end, the tall bar's tag would run off the frame
              into the numeral gutter, and left-aligning both of them stacks
              45.5% directly above 34.9% in one column — which is what makes the
              swap below a clean vertical exchange rather than a diagonal
              scramble. */}
          <div
            className="fig-bp-share"
            data-swapped={phase >= SWAP.settle ? 'true' : 'false'}
            style={{
              opacity: phase >= SWAP.enter ? 1 : 0,
              // Before the swap each tag is displaced onto the *other* bar, so
              // the pair lands in the expected arrangement and then trades.
              transform: phase >= SWAP.settle
                ? 'translateY(0)'
                : `translateY(${index === 0 ? travel : -travel}px)`,
            }}
          >
            <b>{bar.share}</b>
            <span>{bar.shareLabel}</span>
          </div>
        </div>
      </div>
    )
  })

  // The dimension line lives *between* the two rows, so it is spliced into the
  // row list rather than appended after it.
  const gapStrip = spec.gapNote ? (
    <div className="fig-bp-gapstrip" key="gap">
      <div
        className="fig-bp-gap"
        style={{ left: pct(gapFrom), width: pct(gapTo - gapFrom), opacity: phase >= 6 ? 1 : 0 }}
      >
        <span className="fig-bp-gap-rule" />
        <span className="fig-bp-gap-note">{spec.gapNote}</span>
        <span className="fig-bp-gap-rule" />
      </div>
    </div>
  ) : null

  return (
    <div className="fig-bp-scale">
      {rows[0]}
      {gapStrip}
      {rows.slice(1)}
    </div>
  )
}

/**
 * How far a share tag has to travel to land on the other bar.
 *
 * Measured, once per layout, from the tags' own boxes. The two rows are not the
 * same height — only the upper one is followed by the gap note — so there is no
 * constant, and a guess would put the tags a few pixels off their bars at
 * exactly the moment the audience is looking at where they landed.
 *
 * Returns zero until the first measurement, which is the correct degenerate
 * case: the tags simply fade in on their true bars with no exchange, which is
 * also what a viewer who asked for reduced motion gets.
 */
function useSwapTravel(count: number): [Array<RefObject<HTMLDivElement | null>>, number] {
  const refs = useRef<Array<RefObject<HTMLDivElement | null>>>([])
  if (refs.current.length !== count) {
    refs.current = Array.from({ length: count }, (_, index) => refs.current[index] ?? { current: null })
  }
  const [travel, setTravel] = useState(0)

  useLayoutEffect(() => {
    const [first, second] = refs.current.map((ref) => ref.current)
    if (!first || !second) return

    // The *tracks* are measured, not the tags. A tag is displaced by its own
    // transform for most of this slide's life, so measuring one would fold the
    // displacement back into the distance and compound it on the next resize.
    // The tracks never move, and the tags are pinned to them at a constant
    // offset, so the gap between the tracks is exactly the gap between the tags.
    const measure = () => {
      setTravel(Math.max(0, second.getBoundingClientRect().top - first.getBoundingClientRect().top))
    }
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(first)
    observer.observe(second)
    const scale = first.closest('.fig-bp-scale')
    if (scale) observer.observe(scale)
    return () => observer.disconnect()
  }, [count])

  return [refs.current, travel]
}

/**
 * Effect sizes are signed quantities, and the deck's own copy sets them as `+0.22`
 * and `+2.77`, so the sign is part of the number rather than punctuation.
 */
function formatEffect(value: number): string {
  const text = Math.abs(value) < 10 ? value.toFixed(2) : value.toFixed(1)
  return value > 0 ? `+${text}` : text
}
