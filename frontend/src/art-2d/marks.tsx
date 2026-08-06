/**
 * Hand-drawn marks for the 2D web UI.
 *
 * Deliberately separate from `src/art/`, which is the three.js layer. Nothing
 * here imports a renderer, a texture, or a font: every mark is a handful of
 * filled paths on a 24-unit grid, inlined into the markup so it costs a few
 * hundred bytes of the chunk that already had to load and never a request.
 *
 * They are drawn to whole and half units so the pixel theme's
 * `shape-rendering: crispEdges` lands the edges on device pixels instead of
 * blurring them, and they fill rather than stroke, because a 1px hairline
 * scaled to a 17px nav icon is the thing that made the generic icon set look
 * thin next to the cel-shaded 3D scenes.
 */

/* One drawing, two jobs. The stand and the beam are separate paths only so the
   loading screen can tip the beam; the brand mark renders the identical
   geometry at rest. Sharing them means the thing the reader watches while the
   firm opens is the firm's own mark, not a spinner borrowed from elsewhere. */
const SCALES_STAND = 'M7 20h10v2H7z M10 18h4v2h-4z M11 7h2v11h-2z M10 3h4v3h-4z'
const SCALES_BEAM = 'M3 6h18v2H3z M4 8h1v3H4z M19 8h1v3h-1z M1 11h7l-1.75 3.25h-3.5z M16 11h7l-1.75 3.25h-3.5z'

/**
 * Scales of justice, struck rather than outlined: the whole glyph is drawn
 * twice, once offset into the plate in a warm shadow and once in ink, which is
 * what makes it read as stamped into the brass plaque behind it instead of
 * printed on top of it.
 */
export function ScalesMark({ tipping = false, className = '' }: { tipping?: boolean; className?: string }) {
  return (
    <svg
      className={`mark mark-scales${tipping ? ' is-tipping' : ''} ${className}`.trim()}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
    >
      <g className="mark-relief" transform="translate(.9 .9)">
        <path d={SCALES_STAND} />
        <path d={SCALES_BEAM} />
      </g>
      <g fill="currentColor">
        <path d={SCALES_STAND} />
        <path className="mark-scales-beam" d={SCALES_BEAM} />
      </g>
    </svg>
  )
}

/**
 * Focus Mode's mark: a viewfinder closing on a single case file.
 *
 * It replaces a generic crosshair, which said "aim" when the feature means
 * "crop everything that is not the work". The brackets are their own group so
 * the on state can pull them in on the file rather than swapping to a second
 * icon — the state change is the metaphor, which is the only reason the
 * animation is here at all. `prefers-reduced-motion` keeps the closed
 * position and drops the transition.
 */
export function FocusMark({ on = false, className = '' }: { on?: boolean; className?: string }) {
  return (
    <svg
      className={`mark mark-focus${on ? ' is-on' : ''} ${className}`.trim()}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <g className="mark-focus-brackets">
        <path d="M2 8V2h6v2H4v4z" />
        <path d="M16 2h6v6h-2V4h-4z" />
        <path d="M2 16v6h6v-2H4v-4z" />
        <path d="M20 16h2v6h-6v-2h4z" />
      </g>
      <path d="M8.5 7h4.6l2.4 2.4V17H8.5z" />
      <path className="mark-focus-fold" d="M13.1 7l2.4 2.4h-2.4z" />
    </svg>
  )
}

/**
 * A returned filing, stamped. The error banner carried its message with no
 * mark at all, which made an interruption look like body copy; a seal gives
 * the alert something to scan to without adding a second line of text.
 */
export function AlertSealMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`mark mark-alert-seal ${className}`.trim()}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M12 1.5 14.6 3l3-.2 1.1 2.8 2.5 1.7-.7 2.9.7 2.9-2.5 1.7-1.1 2.8-3-.2L12 18.5 9.4 17l-3 .2-1.1-2.8-2.5-1.7.7-2.9-.7-2.9 2.5-1.7L6.4 2.8l3 .2zm0 2.9-1.7 1-2 .2-.7 1.8-1.7 1.2.5 2-.5 2 1.7 1.2.7 1.8 2-.2 1.7 1 1.7-1 2 .2.7-1.8 1.7-1.2-.5-2 .5-2-1.7-1.2-.7-1.8-2-.2z" />
      <path d="M11 6.5h2V12h-2z" />
      <path d="M11 13.5h2v2h-2z" />
      <path d="M6 19.5h12v2.5l-6-1.4-6 1.4z" opacity=".55" />
    </svg>
  )
}
