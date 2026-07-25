type PixelStudySceneryProps = {
  variant: 'training' | 'docket' | 'ledger'
  className?: string
}

/**
 * Small, code-native set pieces for the non-world screens. They give the
 * dashboards a shared pixel-art language without placing decorative imagery
 * over the reading surface of a question.
 */
export function PixelStudyScenery({ variant, className = '' }: PixelStudySceneryProps) {
  return (
    <svg
      className={`pixel-study-scenery pixel-study-scenery-${variant} ${className}`}
      viewBox="0 0 320 220"
      aria-hidden="true"
      focusable="false"
      shapeRendering="crispEdges"
    >
      <ellipse className="ps-shadow" cx="162" cy="198" rx="126" ry="12" />
      {variant === 'training' && <TrainingStation />}
      {variant === 'docket' && <DocketStation />}
      {variant === 'ledger' && <LedgerStation />}
    </svg>
  )
}

function TrainingStation() {
  return <>
    <g className="ps-training-orbit">
      <path className="ps-orbit" d="M164 27c63 0 113 30 113 67s-50 67-113 67S51 131 51 94 101 27 164 27Z" />
      <path className="ps-orbit ps-orbit-two" d="M164 33c35 0 63 29 63 65s-28 65-63 65-63-29-63-65 28-65 63-65Z" />
      <rect className="ps-signal ps-signal-one" x="260" y="78" width="9" height="9" />
      <rect className="ps-signal ps-signal-two" x="64" y="125" width="8" height="8" />
    </g>
    <g className="ps-balance">
      <rect className="ps-gold" x="155" y="57" width="12" height="87" />
      <rect className="ps-ink" x="143" y="139" width="36" height="9" />
      <rect className="ps-gold" x="134" y="147" width="54" height="9" />
      <rect className="ps-ink" x="108" y="81" width="104" height="8" />
      <path className="ps-gold" d="M121 89h7l-14 37H88l-14-37h7l20 28zM195 89h7l-14 37h-26l-14-37h7l20 28z" />
      <rect className="ps-cream" x="87" y="121" width="29" height="8" />
      <rect className="ps-cream" x="161" y="121" width="29" height="8" />
    </g>
    <g className="ps-data-cards">
      <rect className="ps-ink" x="29" y="147" width="79" height="42" />
      <rect className="ps-panel" x="34" y="152" width="69" height="32" />
      <path className="ps-mint" d="M41 177h12v-10h10v5h11v-15h10v8h12v12H41z" />
      <rect className="ps-ink" x="218" y="143" width="73" height="46" />
      <rect className="ps-panel" x="223" y="148" width="63" height="36" />
      <rect className="ps-gold" x="231" y="169" width="8" height="8" />
      <rect className="ps-mint" x="245" y="162" width="8" height="15" />
      <rect className="ps-gold" x="259" y="154" width="8" height="23" />
      <rect className="ps-mint" x="273" y="158" width="7" height="19" />
    </g>
  </>
}

function DocketStation() {
  return <>
    <g className="ps-window">
      <rect className="ps-ink" x="184" y="23" width="102" height="92" />
      <rect className="ps-sky" x="190" y="29" width="90" height="80" />
      <path className="ps-city" d="M190 109V82h12V68h13v21h12V54h17v33h13V70h13v39z" />
      <rect className="ps-cream" x="213" y="74" width="5" height="6" />
      <rect className="ps-cream" x="234" y="63" width="5" height="7" />
      <rect className="ps-cream" x="262" y="78" width="5" height="6" />
    </g>
    <g className="ps-lamp">
      <rect className="ps-ink" x="69" y="77" width="11" height="87" />
      <path className="ps-gold" d="M47 82h57l-11-29H58z" />
      <rect className="ps-gold" x="43" y="164" width="64" height="9" />
      <path className="ps-lamp-glow" d="M57 90h37l27 79H30z" />
    </g>
    <g className="ps-brief-stack">
      <rect className="ps-ink" x="92" y="142" width="114" height="49" />
      <rect className="ps-paper" x="98" y="136" width="101" height="48" transform="rotate(-4 148 160)" />
      <rect className="ps-paper" x="103" y="142" width="104" height="44" transform="rotate(3 155 164)" />
      <rect className="ps-red" x="113" y="150" width="42" height="7" />
      <rect className="ps-ink-light" x="113" y="164" width="78" height="4" />
      <rect className="ps-ink-light" x="113" y="174" width="62" height="4" />
      <rect className="ps-gold" x="181" y="146" width="12" height="12" />
    </g>
    <g className="ps-coffee">
      <rect className="ps-ink" x="236" y="153" width="32" height="30" />
      <rect className="ps-red" x="241" y="157" width="22" height="22" />
      <rect className="ps-ink" x="268" y="161" width="12" height="14" />
      <path className="ps-steam" d="M244 145h5v-11h-5zM257 149h5v-16h-5z" />
    </g>
  </>
}

function LedgerStation() {
  return <>
    <g className="ps-ledger-book">
      <rect className="ps-ink" x="53" y="55" width="204" height="134" />
      <path className="ps-cover" d="M61 62h91v119H61zM158 62h91v119h-91z" />
      <rect className="ps-gold" x="151" y="62" width="7" height="119" />
      <rect className="ps-paper" x="70" y="75" width="71" height="10" />
      <rect className="ps-paper" x="70" y="94" width="62" height="5" />
      <rect className="ps-paper" x="70" y="108" width="66" height="5" />
      <rect className="ps-paper" x="70" y="122" width="53" height="5" />
      <rect className="ps-red" x="70" y="144" width="68" height="18" />
      <rect className="ps-paper" x="170" y="75" width="66" height="5" />
      <rect className="ps-paper" x="170" y="89" width="57" height="5" />
      <rect className="ps-paper" x="170" y="103" width="63" height="5" />
      <rect className="ps-paper" x="170" y="117" width="49" height="5" />
      <path className="ps-mint" d="M172 158h13v-17h12v9h12v-24h13v32h14v8h-64z" />
    </g>
    <g className="ps-coin-stack">
      <rect className="ps-ink" x="262" y="142" width="30" height="40" />
      <rect className="ps-gold" x="267" y="148" width="20" height="7" />
      <rect className="ps-gold" x="267" y="160" width="20" height="7" />
      <rect className="ps-gold" x="267" y="172" width="20" height="7" />
    </g>
    <g className="ps-seal">
      <rect className="ps-red" x="28" y="149" width="27" height="27" />
      <rect className="ps-gold" x="34" y="155" width="15" height="15" />
      <rect className="ps-red" x="39" y="158" width="5" height="9" />
    </g>
  </>
}
