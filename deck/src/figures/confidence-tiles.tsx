import type { ConfidenceTilesFigure } from './types'
import { pct, usePhase, vars, type FigureBody } from './kit'

/**
 * `pov-confidence-signal` — Four results a score report cannot tell apart,
 * re-sorting into four different problems.
 *
 * The sort *is* the argument, so the tiles keep their DOM order and move by
 * transform. Re-rendering them in the new order would produce the same final
 * picture and prove nothing: what the room has to see is that the same four
 * objects changed places once a signal was added, which is the difference between
 * a claim about measurement and a diagram of four categories.
 *
 * The ordering rule is the flagged tile first, then descending confidence, which
 * puts the confident miss at the front (Metcalfe's most correctable error, and the
 * app's most valuable event) and guarantees a visible reshuffle rather than an
 * accidental identity permutation.
 */

/** Cumulative milliseconds: tiles, confidence, the sort, the warning outline. */
const MARKS = [40, 600, 1050, 1450] as const

/** Gap between tiles, as a percentage of the row. Drives the slot pitch the sort animates across. */
const TILE_GAP_PCT = 3

/** Four distinguishable weights for four categories. Any more and they stop being distinguishable. */
const SHADES = [1, 0.74, 0.5, 0.3]

export function ConfidenceTiles({ spec, active, reduced }: FigureBody<ConfidenceTilesFigure>) {
  const phase = usePhase(active, reduced, MARKS)
  const tiles = spec.tiles
  const count = Math.max(tiles.length, 1)
  const width = (100 - (count - 1) * TILE_GAP_PCT) / count
  const pitch = width + TILE_GAP_PCT

  // Rank once, then invert it: `rank[source] = target slot`.
  const order = tiles
    .map((tile, index) => ({ tile, index }))
    .sort((a, b) => {
      const flagged = Number(b.tile.flagged ?? false) - Number(a.tile.flagged ?? false)
      if (flagged !== 0) return flagged
      const confidence = b.tile.confidence - a.tile.confidence
      return confidence !== 0 ? confidence : a.index - b.index
    })
  const target = new Array<number>(tiles.length)
  order.forEach((entry, slot) => {
    target[entry.index] = slot
  })

  return (
    <div className="fig-ct">
      <div className="fig-ct-row">
        {tiles.map((tile, index) => {
          const slot = target[index] ?? index
          const sorted = phase >= 3
          // Percent of the tile's own width, so the pitch and the tile size stay
          // in one place and the sort survives any tile count.
          const shift = sorted ? ((slot - index) * pitch * 100) / width : 0
          return (
            <div
              className="fig-ct-tile"
              key={tile.category}
              data-flagged={tile.flagged && phase >= 4 ? 'true' : 'false'}
              data-mark={tile.mark}
              style={vars({
                left: pct((index * pitch) / 100),
                width: pct(width / 100),
                opacity: phase >= 1 ? 1 : 0,
                transform: `translateX(${shift.toFixed(2)}%)`,
                zIndex: sorted ? tiles.length - slot : 1,
                '--fig-shade': sorted ? (SHADES[slot] ?? 0.3) : SHADES[0],
                '--fig-delay': sorted ? `${slot * 40}ms` : '0ms',
              })}
            >
              <span className="fig-ct-fill" />
              {/* The rank the sort put it in, as a band across the head of the
                  card. This is where the four shades of royal blue the
                  narrative asks for now live.

                  They used to be the tile's whole background, at up to 44%
                  ink, which is how four cards carrying three glyphs each came
                  to read as four loaded grey slabs — the founder's "figures
                  that look like loading skeletons", and the fair reading of
                  them. A card cannot be mistaken for a placeholder while its
                  own field is nearly empty and one solid band is carrying the
                  colour; and concentrating the ramp into a band makes the four
                  steps further apart than they ever were spread over a whole
                  tile, which was the reason the ramp had been pushed so dark
                  in the first place. */}
              <span className="fig-ct-rank" style={{ opacity: sorted ? 1 : 0 }} />
              <svg className="fig-ct-mark" viewBox="0 0 24 24" aria-hidden="true">
                {tile.mark === 'correct' ? (
                  <path d="M 4 13 L 10 19 L 20 5" vectorEffect="non-scaling-stroke" />
                ) : (
                  <path d="M 5 5 L 19 19 M 19 5 L 5 19" vectorEffect="non-scaling-stroke" />
                )}
              </svg>
              <span
                className="fig-ct-confidence"
                style={{
                  opacity: phase >= 2 ? 1 : 0,
                  transform: phase >= 2 ? 'translateY(0)' : 'translateY(.2em)',
                }}
              >
                {tile.confidence}
              </span>
              <span className="fig-ct-category" style={{ opacity: sorted ? 1 : 0 }}>
                {tile.category}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
