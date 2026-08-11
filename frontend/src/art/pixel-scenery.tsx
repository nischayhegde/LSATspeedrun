type PixelStudySceneryProps = {
  variant: 'training' | 'docket' | 'ledger'
  className?: string
}

/**
 * Small, code-native set pieces for the non-world screens. They give the
 * dashboards a shared drawn language without placing decorative imagery over
 * the reading surface of a question.
 *
 * These were pixel art, and they were the last pixel art left in the
 * interface: axis-aligned rectangles only, `shape-rendering: crispEdges`,
 * `image-rendering: pixelated`, staircase skylines, square coins and stepped
 * animation. Sitting a few hundred pixels from a cel-shaded 3D room, they read
 * as a different game. They are redrawn here in the hand the rest of the app
 * uses: shapes with curves in them, one warm ink contour around every solid,
 * flat cel fills inside it, and motion that eases.
 *
 * The file, the export and the `pixel-study-scenery` class keep their names.
 * Three pages import this and one stylesheet keys off that class; renaming
 * them is churn in files other branches are in, and the same argument the
 * `--font-pixel` alias is kept for.
 *
 * `.ps-flat` opts a shape out of the contour — glows, cast shadows, ruled
 * lines and lit windows are marks on a surface, not objects with an edge.
 */
export function PixelStudyScenery({ variant, className = '' }: PixelStudySceneryProps) {
  return (
    <svg
      className={`pixel-study-scenery pixel-study-scenery-${variant} ${className}`}
      viewBox="0 0 320 220"
      aria-hidden="true"
      focusable="false"
    >
      <ellipse className="ps-shadow ps-flat" cx="162" cy="198" rx="126" ry="12" />
      {variant === 'training' && <TrainingStation />}
      {variant === 'docket' && <DocketStation />}
      {variant === 'ledger' && <LedgerStation />}
    </svg>
  )
}

/* The balance, drawn as an object rather than as a bar chart of it: the pans
   are shallow bowls hung on cords, the column has a turned collar, and the
   plinth is a block with a chamfer. */
function TrainingStation() {
  return <>
    <g className="ps-training-orbit">
      <path className="ps-orbit ps-flat" d="M164 27c63 0 113 30 113 67s-50 67-113 67S51 131 51 94 101 27 164 27Z" />
      <path className="ps-orbit ps-orbit-two ps-flat" d="M164 33c35 0 63 29 63 65s-28 65-63 65-63-29-63-65 28-65 63-65Z" />
      <circle className="ps-signal ps-signal-one ps-flat" cx="265" cy="83" r="5" />
      <circle className="ps-signal ps-signal-two ps-flat" cx="68" cy="129" r="4.5" />
    </g>
    <g className="ps-balance">
      <path className="ps-gold" d="M134 156h54a4 4 0 0 1 4 4v4h-62v-4a4 4 0 0 1 4-4Z" />
      <path className="ps-ink" d="M145 140h32l4 16h-40Z" />
      <path className="ps-gold" d="M156 60h10a3 3 0 0 1 3 3v78h-16V63a3 3 0 0 1 3-3Z" />
      <path className="ps-cream" d="M152 76h18a3 3 0 0 1 0 6h-18a3 3 0 0 1 0-6Z" />
      <path className="ps-ink" d="M110 82h102a4.5 4.5 0 0 1 0 9H110a4.5 4.5 0 0 1 0-9Z" />
      <path className="ps-flat ps-cord" d="M100 88v14M144 88v14M178 88v14M222 88v14" />
      <path className="ps-gold" d="M76 102h68c0 15-13 26-34 26s-34-11-34-26Z" />
      <path className="ps-gold" d="M178 102h68c0 15-13 26-34 26s-34-11-34-26Z" />
      <path className="ps-cream" d="M88 108h20a2.5 2.5 0 0 1 0 5H88a2.5 2.5 0 0 1 0-5Z" />
      <path className="ps-cream" d="M190 108h20a2.5 2.5 0 0 1 0 5h-20a2.5 2.5 0 0 1 0-5Z" />
    </g>
    <g className="ps-data-cards">
      <rect className="ps-panel" x="27" y="146" width="80" height="44" rx="7" />
      <path className="ps-mint ps-flat" d="M38 180c8 0 9-9 15-9s7 6 12 6 8-13 14-13" />
      <rect className="ps-panel" x="216" y="142" width="76" height="48" rx="7" />
      <rect className="ps-gold ps-flat" x="228" y="168" width="9" height="12" rx="3" />
      <rect className="ps-mint ps-flat" x="243" y="159" width="9" height="21" rx="3" />
      <rect className="ps-gold ps-flat" x="258" y="152" width="9" height="28" rx="3" />
      <rect className="ps-mint ps-flat" x="273" y="156" width="9" height="24" rx="3" />
    </g>
  </>
}

/* Night, one lamp, and the day's briefs still on the desk. */
function DocketStation() {
  return <>
    <g className="ps-window">
      <rect className="ps-sky" x="184" y="23" width="102" height="92" rx="8" />
      <path className="ps-city ps-flat" d="M190 109V83q0-3 3-3h8q3 0 3 3V69q0-3 3-3h7q3 0 3 3v18h5V55q0-3 3-3h11q3 0 3 3v32h7V71q0-3 3-3h7q3 0 3 3v38Z" />
      <rect className="ps-cream ps-flat" x="212" y="74" width="6" height="7" rx="1.5" />
      <rect className="ps-cream ps-flat" x="233" y="63" width="6" height="8" rx="1.5" />
      <rect className="ps-cream ps-flat" x="261" y="78" width="6" height="7" rx="1.5" />
    </g>
    <g className="ps-lamp">
      <path className="ps-lamp-glow ps-flat" d="M57 90h37l27 79H30Z" />
      <path className="ps-ink" d="M69 79h11v86H69Z" />
      <path className="ps-gold" d="M60 52h33q3 0 4 3l10 24q1 4-3 4H49q-4 0-3-4l10-24q1-3 4-3Z" />
      <path className="ps-gold" d="M47 163h56a5 5 0 0 1 5 5v5H42v-5a5 5 0 0 1 5-5Z" />
    </g>
    <g className="ps-brief-stack">
      <rect className="ps-paper" x="96" y="136" width="104" height="48" rx="4" transform="rotate(-4 148 160)" />
      <rect className="ps-paper" x="101" y="142" width="106" height="45" rx="4" transform="rotate(3 155 164)" />
      <path className="ps-red" d="M113 150h39a4 4 0 0 1 0 8h-39a4 4 0 0 1 0-8Z" />
      <path className="ps-ink-light ps-flat" d="M114 167h76M114 176h60" />
      <rect className="ps-gold" x="180" y="146" width="14" height="14" rx="4" />
    </g>
    <g className="ps-coffee">
      {/* The handle is drawn first, in the cup's own colour, so the body laps
          over its root instead of leaving a dark tab stuck to the side. */}
      <path className="ps-red" d="M262 158h9a9 9 0 0 1 0 18h-9Z" />
      <path className="ps-red" d="M238 154h29v17q0 12-11 12h-7q-11 0-11-12Z" />
      <path className="ps-steam ps-flat" d="M247 147q-4-5 0-10t0-9M259 149q-4-6 0-11t0-8" />
    </g>
  </>
}

/* The firm's book, open on the desk, with the day's takings beside it. */
function LedgerStation() {
  return <>
    <g className="ps-ledger-book">
      <path className="ps-cover" d="M61 66q45-8 89 0v113q-44-7-89 0Z" />
      <path className="ps-cover" d="M249 66q-45-8-89 0v113q44-7 89 0Z" />
      <path className="ps-gold" d="M150 65h10v115h-10Z" />
      <path className="ps-paper ps-flat" d="M72 80h68M72 96h60M72 110h64M72 124h51" />
      <path className="ps-paper ps-flat" d="M172 80h64M172 94h55M172 108h61M172 122h47" />
      <path className="ps-red" d="M70 145h64a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H70Z" />
      <path className="ps-mint ps-flat" d="M173 158c10 0 12-15 19-15s10 9 16 9 11-19 18-19 9 14 17 14" />
    </g>
    <g className="ps-coin-stack">
      <ellipse className="ps-gold" cx="277" cy="176" rx="19" ry="7" />
      <ellipse className="ps-gold" cx="277" cy="164" rx="19" ry="7" />
      <ellipse className="ps-gold" cx="277" cy="152" rx="19" ry="7" />
    </g>
    <g className="ps-seal">
      <path className="ps-red" d="M33 170h16l5 20-13-6-13 6Z" />
      <circle className="ps-red" cx="41" cy="163" r="17" />
      <circle className="ps-gold" cx="41" cy="163" r="8" />
    </g>
  </>
}
