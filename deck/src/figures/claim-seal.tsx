import type { ClaimSealFigure } from './types'
import type { FigureBody } from './kit'

/**
 * `pov-graded-question` — a gold foil seal behind the centred claim.
 *
 * Rings sit inside the viewBox so a 16:9 sheet clip cannot take the
 * outer stroke. The type stack (headline, rule, deck line) is a
 * separate DOM layer, optically centred in the inner opening — not
 * on the foil ring. Geometry is at rest from the first paint.
 */

const TICKS = 96
const MAJOR_EVERY = 8
const GUILLOCHE = [0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5] as const

export function ClaimSeal(_props: FigureBody<ClaimSealFigure>) {
  return (
    <div className="fig-seal" aria-hidden="true">
      <svg className="fig-seal-mark" viewBox="0 0 100 100">
        <defs>
          <linearGradient
            id="fig-seal-foil"
            x1="16"
            y1="6"
            x2="88"
            y2="94"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="currentColor" stopOpacity=".52" />
            <stop offset=".36" stopColor="currentColor" stopOpacity="1" />
            <stop offset=".68" stopColor="currentColor" stopOpacity=".7" />
            <stop offset="1" stopColor="currentColor" stopOpacity=".94" />
          </linearGradient>
          <mask id="fig-seal-band" maskUnits="userSpaceOnUse">
            <circle cx="50" cy="50" r="47.55" fill="#fff" />
            <circle cx="50" cy="50" r="44.9" fill="#000" />
          </mask>
        </defs>

        <g mask="url(#fig-seal-band)" className="fig-seal-engine">
          {GUILLOCHE.map((deg) => (
            <ellipse
              key={deg}
              cx="50"
              cy="50"
              rx="46.8"
              ry="15.1"
              transform={`rotate(${deg} 50 50)`}
            />
          ))}
        </g>

        {Array.from({ length: TICKS }, (_, i) => {
          const major = i % MAJOR_EVERY === 0
          return (
            <line
              key={i}
              x1="50"
              y1={major ? 2.55 : 3.05}
              x2="50"
              y2={major ? 4.85 : 4.15}
              transform={`rotate(${(i / TICKS) * 360} 50 50)`}
              stroke="currentColor"
              strokeWidth={major ? 0.26 : 0.1}
              opacity={major ? 0.88 : 0.4}
            />
          )
        })}

        <circle
          className="fig-seal-ring"
          cx="50"
          cy="50"
          r="47.2"
          fill="none"
          stroke="url(#fig-seal-foil)"
          strokeWidth="0.7"
        />
        <circle
          className="fig-seal-ring"
          cx="50"
          cy="50"
          r="45.45"
          fill="none"
          stroke="url(#fig-seal-foil)"
          strokeWidth="0.32"
        />
      </svg>
    </div>
  )
}
