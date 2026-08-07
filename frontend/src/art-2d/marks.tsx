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
 * Dismissal. Two struck bars rather than a `×`, which is a multiplication
 * sign the reader's font happens to draw as a cross: its weight, its size
 * relative to the em box and whether it centres at all are decided by
 * whichever face the platform substituted, so the same button was a hairline
 * on one machine and a slab on another.
 */
export function CloseMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`mark mark-close ${className}`.trim()}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M5.55 3.44 20.56 18.45 18.45 20.56 3.44 5.55z" />
      <path d="M18.45 3.44 20.56 5.55 5.55 20.56 3.44 18.45z" />
    </svg>
  )
}

/**
 * Settled: owned, granted, decided in your favour. Drawn with the short arm
 * deliberately stubby so the mark still reads at the 30px badge on a catalog
 * vignette, where a evenly-armed tick turns into a smudge.
 */
export function CheckMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`mark mark-check ${className}`.trim()}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M9.6 18.2 3.1 11.7 5.6 9.2 9.6 13.2 18.4 4.4 20.9 6.9z" />
    </svg>
  )
}

/**
 * Sealed away until it is earned. The padlock is one contour with the shackle
 * interior and the keyhole punched back out under `evenodd`, so it stays a
 * single filled shape at the catalog's 44px lock badge instead of picking up
 * the thin-outline look the marks exist to avoid.
 */
export function LockMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`mark mark-lock ${className}`.trim()}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
      fillRule="evenodd"
    >
      <path d="M12 1.5A5.5 5.5 0 0 0 6.5 7v3H4v12h16V10h-2.5V7A5.5 5.5 0 0 0 12 1.5z M12 4a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3z M10.75 14.5h2.5v4.5h-2.5z" />
    </svg>
  )
}

/**
 * The bench is still thinking. Three beats rather than an ellipsis character,
 * which sits on the baseline and so hung at the bottom of the circular status
 * badge instead of centring in it.
 */
export function DeliberatingMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`mark mark-deliberating ${className}`.trim()}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M3 10h4v4H3z" />
      <path d="M10 10h4v4h-4z" />
      <path d="M17 10h4v4h-4z" />
    </svg>
  )
}

/**
 * On the record: a ruled statute page, standing in for the `§` the judge's
 * status badge used to print. Drawn as a frame plus three rules rather than a
 * solid sheet so it stays legible as a 14px silhouette in a filled circle.
 */
export function StatuteMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`mark mark-statute ${className}`.trim()}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M5 2h14v2H5z M5 20h14v2H5z M5 4h2v16H5z M17 4h2v16h-2z" />
      <path d="M8.5 6.5h7v2h-7z M8.5 10.5h7v2h-7z M8.5 14.5h4v2h-4z" />
    </svg>
  )
}

/* The world map's control surface. Every one of these replaced a typographic
   character sitting alone inside a button — `⌂`, `☰`, `◎`, `›`, `+`, `−` —
   which is the one place a substituted font is most obvious, because there is
   no surrounding text for the reader to read the glyph against. The buttons
   already carried their own `aria-label`, so these are all decorative. */

/** Back to the headquarters. */
export function HomeMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`mark mark-home ${className}`.trim()}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M12 2 22 11h-3v11h-6v-7h-2v7H5V11H2z" />
    </svg>
  )
}

/** The mobile control drawer. */
export function MenuMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`mark mark-menu ${className}`.trim()}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M3 5h18v3H3z M3 10.5h18v3H3z M3 16h18v3H3z" />
    </svg>
  )
}

/** Put the camera back on your own lawyer. */
export function TargetMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`mark mark-target ${className}`.trim()}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
      fillRule="evenodd"
    >
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14z" />
      <path d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z" />
    </svg>
  )
}

/** Onward, into the thing the button names. */
export function ChevronMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`mark mark-chevron ${className}`.trim()}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M8.5 3.4 17.1 12 8.5 20.6 5.9 18 11.9 12 5.9 6z" />
    </svg>
  )
}

/** Zoom in, and open a disclosure. */
export function PlusMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`mark mark-plus ${className}`.trim()}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M10.5 3h3v18h-3z" />
      <path d="M3 10.5h18v3H3z" />
    </svg>
  )
}

/** Zoom out, and close a disclosure. */
export function MinusMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`mark mark-minus ${className}`.trim()}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M3 10.5h18v3H3z" />
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
