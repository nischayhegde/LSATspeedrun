// Map-site artwork: tier headquarters, rival firms, ships and space stations.
// All art lives in a 200×150 viewBox with the ground line near y=132.

const GLOW = '#ffd98a'
const GLOW_DIM = '#ce9d4e'
const BRASS = '#c89b4b'

function Windows({ x, y, cols, rows, w = 6, h = 7, gx = 4, gy = 5, lit = 0.6, color = GLOW, dark = '#20304a' }: {
  x: number; y: number; cols: number; rows: number; w?: number; h?: number; gx?: number; gy?: number; lit?: number; color?: string; dark?: string
}) {
  const cells = []
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c
      const isLit = ((i * 7 + 3) % 10) / 10 < lit
      cells.push(<rect key={i} x={x + c * (w + gx)} y={y + r * (h + gy)} width={w} height={h} rx={1} fill={isLit ? color : dark} opacity={isLit ? 0.95 : 0.85} />)
    }
  }
  return <g className="av-windows">{cells}</g>
}

function ScalesFlag({ x, y, color = '#f3e2b3', pole = 28 }: { x: number; y: number; color?: string; pole?: number }) {
  return (
    <g className="av-flag">
      <rect x={x} y={y} width={1.8} height={pole} fill="#3a3f4a" />
      <path className="av-flag-cloth" d={`M${x + 1.8} ${y + 1} L${x + 20} ${y + 4.5} L${x + 1.8} ${y + 9} Z`} fill={color} />
      <circle cx={x + 8} cy={y + 5} r={1.6} fill="#1d2a3a" opacity="0.7" />
    </g>
  )
}

function Smoke({ x, y }: { x: number; y: number }) {
  return (
    <g className="av-smoke" fill="#cfd4d8" opacity="0.75">
      <circle className="s1" cx={x} cy={y} r="3" />
      <circle className="s2" cx={x + 3} cy={y - 7} r="4" />
      <circle className="s3" cx={x - 2} cy={y - 15} r="5" />
    </g>
  )
}

function GroundShadow({ w = 120 }: { w?: number }) {
  return <ellipse cx="100" cy="133" rx={w / 2} ry="6" fill="rgba(10,16,24,.25)" />
}

/* --------------------------------------------------------------- ships */

function ShipHull({ hull = '#1b2b3f', stripe = BRASS }: { hull?: string; stripe?: string }) {
  return (
    <>
      <path className="av-wake" d="M18 124 C40 120 160 120 184 124 C160 131 40 131 18 124 Z" fill="#e8f4f6" opacity="0.5" />
      <path d="M22 102 L182 102 C178 114 168 122 152 124 L54 124 C40 122 28 113 22 102 Z" fill={hull} />
      <path d="M22 102 L182 102 L180 107 L25 107 Z" fill="rgba(255,255,255,.14)" />
      <path d="M30 110 L172 110 L170 114 L34 114 Z" fill={stripe} opacity="0.9" />
      <circle cx="52" cy="118" r="1.7" fill="#0d1622" />
      <circle cx="72" cy="119.5" r="1.7" fill="#0d1622" />
      <circle cx="132" cy="119.5" r="1.7" fill="#0d1622" />
      <circle cx="152" cy="118" r="1.7" fill="#0d1622" />
    </>
  )
}

export function FlagshipMeridian() {
  return (
    <g className="av-ship">
      <ShipHull hull="#1e3247" />
      <path d="M50 102 L50 78 C50 73 54 70 60 70 L124 70 C132 70 138 74 142 80 L156 102 Z" fill="#f0ede2" />
      <path d="M60 102 L60 84 L96 84 L96 102" fill="#8fd4e6" opacity="0.9" />
      <path d="M62 86 L94 86 M62 90 L94 90 M62 94 L94 94 M62 98 L94 98" stroke="#5aa9bd" strokeWidth="1" />
      <Windows x={104} y={74} cols={4} rows={2} w={7} h={4.5} gx={3.5} gy={3.5} lit={0.8} dark="#3d5666" />
      <path d="M52 66 L118 66 L114 70 L56 70 Z" fill="#d9d2bd" />
      <rect x="80" y="52" width="3" height="15" fill="#3a4550" />
      <path d="M81.5 47 L81.5 54" stroke="#3a4550" strokeWidth="1.4" />
      <circle cx="81.5" cy="49" r="3.4" fill="none" stroke="#3a4550" strokeWidth="1.3" />
      <ScalesFlag x={128} y={44} pole={24} />
      <path d="M60 76 L96 76" stroke="#c2bba6" strokeWidth="1.2" />
    </g>
  )
}

export function FlagshipCommand() {
  return (
    <g className="av-ship">
      <ShipHull hull="#101b2c" stripe="#e0bd68" />
      <path d="M40 102 L44 80 L100 80 L100 102 Z" fill="#e9e5d8" />
      <path d="M100 102 L100 74 C118 74 134 78 146 88 L156 102 Z" fill="#dcd6c6" />
      <Windows x={50} y={85} cols={5} rows={2} w={6.5} h={4.5} gx={3.4} gy={4} lit={0.75} dark="#3c4a5c" />
      <path d="M104 80 L136 84 L140 90 L104 90 Z" fill="#8fd4e6" opacity="0.9" />
      <circle cx="66" cy="72" r="8" fill="#1c2a3d" />
      <path d="M60 72 L72 72 M66 66 L66 78" stroke="#e0bd68" strokeWidth="1.4" />
      <rect x="118" y="58" width="2.6" height="18" fill="#3a4550" />
      <path d="M112 60 L128 60 M114 55 L126 55" stroke="#3a4550" strokeWidth="1.4" />
      <ScalesFlag x={44} y={58} pole={22} color="#e6c26a" />
    </g>
  )
}

export function FlagshipSovereign() {
  return (
    <g className="av-ship">
      <ShipHull hull="#241b31" stripe="#e6c67a" />
      <path d="M44 102 L48 82 L156 82 L160 102 Z" fill="#efe9dc" />
      <Windows x={56} y={87} cols={9} rows={2} w={6} h={4.2} gx={4.2} gy={3.6} lit={0.7} dark="#4a4258" />
      <path d="M84 82 L86 66 L118 66 L120 82 Z" fill="#e3dccb" />
      <path d="M88 70 L116 70 M88 75 L116 75" stroke="#c5bca6" strokeWidth="1.1" />
      <path d="M92 66 C92 56 112 56 112 66 Z" fill="#e6c26a" />
      <circle cx="102" cy="55.5" r="2.6" fill="#f5e0a2" />
      <path d="M102 51.5 L102 47" stroke="#e6c26a" strokeWidth="1.4" />
      <ScalesFlag x={140} y={56} pole={26} color="#e6c67a" />
      <path d="M52 90 L48 90 M156 90 L152 90" stroke="#c5bca6" strokeWidth="1.2" />
    </g>
  )
}

/* ------------------------------------------------------------ stations */

export function OrbitalRing() {
  return (
    <g className="av-station">
      <ellipse className="av-ring-spin" cx="100" cy="76" rx="72" ry="26" fill="none" stroke="#8ea6c4" strokeWidth="7" opacity="0.9" />
      <ellipse cx="100" cy="76" rx="72" ry="26" fill="none" stroke="#3c4f6d" strokeWidth="2" />
      <ellipse className="av-ring-lights" cx="100" cy="76" rx="72" ry="26" fill="none" stroke={GLOW} strokeWidth="2.4" strokeDasharray="3 14" />
      <path d="M42 68 L84 72 M158 68 L116 72 M100 50 L100 62 M100 102 L100 90" stroke="#5b6e8c" strokeWidth="3" />
      <circle cx="100" cy="76" r="17" fill="#c9d4e4" />
      <circle cx="100" cy="76" r="17" fill="none" stroke="#5b6e8c" strokeWidth="2" />
      <circle cx="100" cy="76" r="8.5" fill="#22334e" />
      <circle cx="100" cy="76" r="4" fill={GLOW} className="av-core-pulse" />
      <rect x="58" y="38" width="26" height="10" rx="2" fill="#2c4468" stroke="#6fa8d8" strokeWidth="1.2" />
      <rect x="116" y="38" width="26" height="10" rx="2" fill="#2c4468" stroke="#6fa8d8" strokeWidth="1.2" />
      <path d="M84 43 L100 60 M116 43 L100 60" stroke="#5b6e8c" strokeWidth="2" />
      <g className="av-shuttle"><path d="M164 104 L172 106 L164 108 Z" fill="#e8eef6" /><circle cx="162" cy="106" r="1.2" fill={GLOW} /></g>
    </g>
  )
}

export function LunarEmbassy() {
  return (
    <g className="av-station">
      <path d="M22 132 C40 118 72 112 100 112 C128 112 160 118 178 132 Z" fill="#9aa0ad" />
      <path d="M22 132 C40 118 72 112 100 112 C128 112 160 118 178 132 L178 134 L22 134 Z" fill="#7d8390" />
      <ellipse cx="58" cy="124" rx="8" ry="2.6" fill="#6d7380" />
      <ellipse cx="146" cy="126" rx="6" ry="2" fill="#6d7380" />
      <path d="M60 112 C60 84 140 84 140 112 Z" fill="#cfe3ec" opacity="0.92" />
      <path d="M60 112 C60 84 140 84 140 112" fill="none" stroke="#8fb4c4" strokeWidth="2" />
      <path d="M74 91 L74 112 M100 85.5 L100 112 M126 91 L126 112 M63 102 L137 102" stroke="#8fb4c4" strokeWidth="1.4" opacity="0.8" />
      <path d="M88 112 L88 100 C88 93 112 93 112 100 L112 112 Z" fill="#2b4258" />
      <Windows x={92} y={98} cols={2} rows={1} w={6} h={7} gx={4} lit={1} />
      <path d="M46 112 L54 92 L60 92 L68 112 Z" fill="#8b93a2" />
      <path d="M132 112 L140 96 L146 96 L154 112 Z" fill="#8b93a2" />
      <ScalesFlag x={150} y={70} pole={26} color="#dfe9f4" />
      <circle cx="36" cy="52" r="10" fill="#5f86b8" opacity="0.9" />
      <path d="M29 50 C33 46 40 46 43 51 C40 48 33 48 29 50 Z" fill="#8fb6dd" />
    </g>
  )
}

export function JusticeNexus() {
  return (
    <g className="av-station av-nexus">
      <g className="av-nexus-orbit">
        <path d="M40 70 L56 62 L52 80 Z" fill="#9fb4e8" opacity="0.85" />
        <path d="M158 58 L172 66 L160 76 Z" fill="#9fb4e8" opacity="0.85" />
        <path d="M60 116 L74 110 L70 124 Z" fill="#7d92c6" opacity="0.8" />
        <path d="M138 112 L152 108 L148 122 Z" fill="#7d92c6" opacity="0.8" />
      </g>
      <path d="M100 22 L118 64 L160 74 L118 84 L100 126 L82 84 L40 74 L82 64 Z" fill="#3d4c8a" />
      <path d="M100 30 L114 66 L150 74 L114 82 L100 118 L86 82 L50 74 L86 66 Z" fill="#5d6fb4" />
      <path d="M100 42 L109 68 L134 74 L109 80 L100 106 L91 80 L66 74 L91 68 Z" fill="#93a7e6" />
      <circle cx="100" cy="74" r="9" fill="#f2ecd2" className="av-core-pulse" />
      <circle cx="100" cy="74" r="13" fill="none" stroke={GLOW} strokeWidth="1.2" opacity="0.7" />
      <path className="av-nexus-links" d="M48 70 L20 56 M152 70 L180 54 M96 122 L78 140 M104 122 L124 140" stroke="#8fa4de" strokeWidth="1.2" strokeDasharray="2 5" />
    </g>
  )
}

/* ------------------------------------------------------- tier buildings */

function Shack() {
  return (
    <g>
      <GroundShadow w={104} />
      <path d="M56 92 L100 66 L144 92 L144 132 L56 132 Z" fill="#7c5a3c" />
      <path d="M56 92 L100 66 L144 92 L138 92 L100 71 L62 92 Z" fill="#584027" />
      <path d="M50 94 L100 63 L150 94 L146 99 L100 71 L54 99 Z" fill="#4a3520" />
      <path d="M60 100 L140 100 M60 110 L140 110 M60 120 L140 120" stroke="#5d4229" strokeWidth="1.6" />
      <rect x="90" y="102" width="20" height="30" fill="#3c2a18" />
      <rect x="92" y="104" width="16" height="26" fill="#2b1d0f" />
      <circle cx="105" cy="118" r="1.4" fill={BRASS} />
      <rect x="64" y="104" width="16" height="14" fill={GLOW_DIM} />
      <path d="M64 111 L80 111 M72 104 L72 118" stroke="#4a3520" strokeWidth="1.5" />
      <rect x="122" y="70" width="9" height="20" fill="#4f4a45" />
      <Smoke x={126} y={62} />
      <g className="av-sign-swing">
        <path d="M118 100 L118 106" stroke="#3c2a18" strokeWidth="1.4" />
        <rect x="110" y="106" width="24" height="10" rx="1.5" fill="#e9dcb8" stroke="#6b5335" strokeWidth="1.2" />
        <text x="122" y="113.4" textAnchor="middle" fontSize="6.4" fontWeight="800" fill="#4a3520" fontFamily="Georgia, serif">LAW</text>
      </g>
    </g>
  )
}

function Rowhouse() {
  return (
    <g>
      <GroundShadow w={96} />
      <rect x="62" y="58" width="76" height="74" fill="#8a4f3a" />
      <rect x="62" y="58" width="76" height="5" fill="#6d3c2b" />
      <path d="M58 54 L142 54 L142 60 L58 60 Z" fill="#5f3526" />
      <Windows x={70} y={68} cols={3} rows={2} w={14} h={12} gx={9} gy={8} lit={0.7} dark="#38251d" />
      <rect x="70" y="108" width="18" height="24" fill="#3c2a20" />
      <rect x="72" y="110" width="14" height="22" fill="#291b13" />
      <path d="M96 112 L134 112 L134 132 L96 132 Z" fill={GLOW_DIM} opacity="0.9" />
      <path d="M96 112 L134 112 L134 116 L96 116 Z" fill="rgba(255,255,255,.25)" />
      <path d="M115 112 L115 132 M96 122 L134 122" stroke="#5f3526" strokeWidth="1.6" />
      <path d="M92 104 L138 104 L134 112 L96 112 Z" fill="#2e5a52" />
      <text x="115" y="109.6" textAnchor="middle" fontSize="5.6" fontWeight="800" fill="#e9dcb8" fontFamily="Georgia, serif">ATTORNEY · ESQ.</text>
    </g>
  )
}

function Storefront() {
  return (
    <g>
      <GroundShadow w={112} />
      <rect x="52" y="62" width="96" height="70" fill="#4f6b62" />
      <rect x="52" y="62" width="96" height="6" fill="#3d564e" />
      <Windows x={60} y={74} cols={4} rows={1} w={16} h={13} gx={6} lit={0.75} dark="#2c423c" />
      <g className="av-awning">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <path key={i} d={`M${54 + i * 16} 96 L${70 + i * 16} 96 L${68 + i * 16} 106 L${56 + i * 16} 106 Z`} fill={i % 2 ? '#ede4cc' : '#8a4f3a'} />
        ))}
        <path d="M54 96 L150 96 L150 93 L54 93 Z" fill="#33463f" />
      </g>
      <rect x="60" y="108" width="52" height="24" fill="#213730" />
      <rect x="63" y="111" width="46" height="21" fill={GLOW_DIM} opacity="0.85" />
      <circle cx="86" cy="120" r="6.5" fill="none" stroke="#213730" strokeWidth="1.6" />
      <path d="M86 114 L86 126 M81 117.5 L91 117.5" stroke="#213730" strokeWidth="1.4" />
      <rect x="118" y="108" width="20" height="24" fill="#3c2a20" />
      <rect x="120" y="110" width="16" height="22" fill="#2b1e15" />
      <circle cx="133" cy="121" r="1.3" fill={BRASS} />
    </g>
  )
}

function DowntownTower() {
  return (
    <g>
      <GroundShadow w={100} />
      <rect x="66" y="34" width="68" height="98" fill="#7a7469" />
      <rect x="66" y="34" width="68" height="4" fill="#5d574d" />
      <path d="M62 30 L138 30 L138 36 L62 36 Z" fill="#8d8779" />
      <Windows x={73} y={42} cols={4} rows={5} w={11} h={9} gx={5.6} gy={5.6} lit={0.6} dark="#3f3b33" />
      <path d="M88 112 C88 102 112 102 112 112 L112 132 L88 132 Z" fill="#2e2a24" />
      <path d="M90 112 C90 104 110 104 110 112 L110 132 L90 132 Z" fill={GLOW_DIM} opacity="0.8" />
      <path d="M100 104.5 L100 132" stroke="#2e2a24" strokeWidth="1.6" />
      <rect x="74" y="118" width="10" height="14" fill="#555046" opacity="0.5" />
      <ScalesFlag x={126} y={12} pole={20} />
    </g>
  )
}

function DecoTower() {
  return (
    <g>
      <GroundShadow w={104} />
      <rect x="82" y="16" width="36" height="26" fill="#8d6f4a" />
      <rect x="72" y="38" width="56" height="34" fill="#9d7f56" />
      <rect x="62" y="70" width="76" height="62" fill="#ac8d62" />
      <path d="M96 4 L104 4 L102 18 L98 18 Z" fill="#c8a76a" />
      <path d="M88 16 L112 16 L110 20 L90 20 Z" fill="#c8a76a" />
      <Windows x={86} y={20} cols={2} rows={1} w={11} h={16} gx={7} lit={0.9} dark="#4a3a26" />
      <Windows x={77} y={42} cols={3} rows={2} w={12} h={11} gx={5.5} gy={5} lit={0.7} dark="#4a3a26" />
      <Windows x={68} y={76} cols={5} rows={3} w={10} h={9} gx={4.6} gy={5} lit={0.6} dark="#4a3a26" />
      <path d="M84 42 L84 72 M116 42 L116 72 M74 70 L74 132 M126 70 L126 132" stroke="#8d6f45" strokeWidth="2.4" />
      <path d="M92 118 L108 118 L108 132 L92 132 Z" fill="#332818" />
      <path d="M94 120 L106 120 L106 132 L94 132 Z" fill={GLOW} opacity="0.75" />
      <path d="M92 112 C96 108 104 108 108 112 L108 118 L92 118 Z" fill={BRASS} />
    </g>
  )
}

function HarborHQ() {
  return (
    <g>
      <path d="M30 126 L200 126 L200 140 L30 140 Z" fill="#2e5e74" opacity="0.85" />
      <path d="M20 122 L146 122 L146 132 L20 132 Z" fill="#6d6152" />
      <path d="M28 132 L28 140 M52 132 L52 140 M76 132 L76 140 M100 132 L100 140 M124 132 L124 140" stroke="#4f4638" strokeWidth="3" />
      <rect x="52" y="44" width="76" height="78" fill="#39586e" />
      <path d="M52 44 L128 44 L128 50 L52 50 Z" fill="#274357" />
      <Windows x={57} y={54} cols={5} rows={5} w={11} h={8} gx={2.6} gy={4.6} lit={0.68} color="#bfe3ec" dark="#1c3243" />
      <rect x="128" y="74" width="34" height="48" fill="#2c4a5e" />
      <Windows x={132} y={80} cols={2} rows={3} w={11} h={8} gx={4} gy={5} lit={0.7} color="#bfe3ec" dark="#1c3243" />
      <path d="M52 116 L80 116 L80 122 L52 122 Z" fill={GLOW_DIM} opacity="0.7" />
      <g className="av-boat">
        <path d="M156 126 L186 126 L182 132 L160 132 Z" fill="#37302a" />
        <rect x="166" y="118" width="10" height="8" fill="#e6ddc6" />
      </g>
      <ScalesFlag x={56} y={26} pole={18} />
    </g>
  )
}

function NationalTower() {
  return (
    <g>
      <GroundShadow w={110} />
      <rect x="90" y="10" width="20" height="26" fill="#31435e" />
      <rect x="78" y="32" width="44" height="34" fill="#3a4f6e" />
      <rect x="66" y="64" width="68" height="68" fill="#43597a" />
      <path d="M98 0 L102 0 L101 12 L99 12 Z" fill="#c8a76a" />
      <Windows x={93} y={14} cols={2} rows={1} w={6} h={18} gx={2} lit={0.9} dark="#1e2c42" />
      <Windows x={82} y={36} cols={4} rows={2} w={8} h={11} gx={2.6} gy={4.5} lit={0.7} dark="#1e2c42" />
      <Windows x={71} y={68} cols={6} rows={4} w={8} h={9} gx={2.4} gy={4.4} lit={0.62} dark="#1e2c42" />
      <path d="M66 64 L134 64 L134 68 L66 68 Z" fill="#31435e" />
      <path d="M84 120 L116 120 L116 132 L84 132 Z" fill="#20293c" />
      <path d="M87 122 L113 122 L113 132 L87 132 Z" fill={GLOW} opacity="0.8" />
      <path d="M90 108 C90 100 110 100 110 108 L110 112 L90 112 Z" fill={BRASS} opacity="0.95" />
      <circle cx="100" cy="106" r="3" fill="#10192a" />
      <path d="M100 103.4 L100 108.6 M97.6 105 L102.4 105" stroke="#e6c26a" strokeWidth="0.9" />
    </g>
  )
}

function CampusRotunda() {
  return (
    <g>
      <GroundShadow w={140} />
      <path d="M34 132 C34 110 62 104 100 104 C138 104 166 110 166 132 Z" fill="#5d7457" />
      <rect x="44" y="94" width="42" height="38" rx="3" fill="#7d8a70" />
      <rect x="114" y="94" width="42" height="38" rx="3" fill="#7d8a70" />
      <Windows x={48} y={100} cols={3} rows={2} w={9} h={8} gx={3.6} gy={4.5} lit={0.65} dark="#41503c" />
      <Windows x={118} y={100} cols={3} rows={2} w={9} h={8} gx={3.6} gy={4.5} lit={0.65} dark="#41503c" />
      <path d="M76 132 L76 84 C76 66 124 66 124 84 L124 132 Z" fill="#c9c2ae" />
      <path d="M80 74 C86 60 114 60 120 74 Z" fill="#8aa27e" />
      <path d="M84 62 C90 52 110 52 116 62 C110 58 90 58 84 62 Z" fill="#a3b895" />
      <path d="M86 90 L86 126 M100 86 L100 126 M114 90 L114 126" stroke="#a49b85" strokeWidth="3.4" />
      <path d="M92 126 L108 126 L108 132 L92 132 Z" fill="#3f3a2c" />
      <circle cx="100" cy="56" r="3" fill={BRASS} />
      <g className="av-trees">
        <circle cx="38" cy="120" r="8" fill="#4d6a45" /><rect x="36.6" y="124" width="2.8" height="8" fill="#3c3222" />
        <circle cx="164" cy="122" r="7" fill="#4d6a45" /><rect x="162.8" y="126" width="2.6" height="7" fill="#3c3222" />
      </g>
    </g>
  )
}

function OceanCitadel() {
  return (
    <g>
      <path className="av-sea-swell" d="M18 126 C46 120 154 120 182 126 C154 134 46 134 18 126 Z" fill="#9fd6de" opacity="0.5" />
      <path d="M40 118 C40 108 160 108 160 118 L154 128 L46 128 Z" fill="#1e5d75" />
      <path d="M46 108 C60 100 140 100 154 108 L154 114 C130 108 70 108 46 114 Z" fill="#2a7691" />
      <path d="M62 104 L62 76 C62 58 138 58 138 76 L138 104 C112 98 88 98 62 104 Z" fill="#bfe3ea" opacity="0.94" />
      <path d="M62 76 C62 58 138 58 138 76" fill="none" stroke="#7db4c2" strokeWidth="2.2" />
      <path d="M78 66 L78 100 M100 61 L100 99 M122 66 L122 100 M64 82 L136 82" stroke="#7db4c2" strokeWidth="1.4" opacity="0.85" />
      <path d="M90 99 L90 84 C90 77 110 77 110 84 L110 99 Z" fill="#174a5e" />
      <Windows x={94} y={83} cols={2} rows={2} w={5.5} h={5} gx={4} gy={3} lit={1} color="#ffe9a6" />
      <path d="M100 52 L100 44 M96 48 L104 48" stroke="#e6c26a" strokeWidth="1.6" />
      <circle cx="100" cy="54" r="2.6" fill={BRASS} />
      <path d="M30 122 L44 122 M156 122 L170 122" stroke="#9fd6de" strokeWidth="2" opacity="0.8" />
    </g>
  )
}

export function TierSiteArt({ tier }: { tier: number }) {
  switch (tier) {
    case 0: return <Shack />
    case 1: return <Rowhouse />
    case 2: return <Storefront />
    case 3: return <DowntownTower />
    case 4: return <DecoTower />
    case 5: return <HarborHQ />
    case 6: return <NationalTower />
    case 7: return <FlagshipMeridian />
    case 8: return <FlagshipCommand />
    case 9: return <FlagshipSovereign />
    case 10: return <CampusRotunda />
    case 11: return <OceanCitadel />
    case 12: return <OrbitalRing />
    case 13: return <LunarEmbassy />
    default: return <JusticeNexus />
  }
}

/* ------------------------------------------------------------- rivals */

function markText(mark: string, x = 100, y = 100, size = 12, fill = '#f3e2b3') {
  return <text x={x} y={y} textAnchor="middle" fontSize={size} fontWeight={800} fill={fill} fontFamily="Georgia, serif">{mark}</text>
}

export function RivalSiteArt({ architecture, mark, owned }: { architecture: string; mark: string; owned: boolean }) {
  const sign = owned ? '✓' : mark
  switch (architecture) {
    case 'brick-house':
      return (
        <g>
          <GroundShadow w={88} />
          <rect x="66" y="72" width="68" height="60" fill="#8a5340" />
          <path d="M60 74 L100 50 L140 74 L134 74 L100 56 L66 74 Z" fill="#59352a" />
          <Windows x={74} y={82} cols={2} rows={1} w={14} h={12} gx={24} lit={0.9} dark="#3a241d" />
          <rect x="92" y="104" width="16" height="28" fill="#33201a" />
          <path d="M70 108 L86 108 L86 120 L70 120 Z" fill={GLOW_DIM} opacity="0.75" />
          <rect x="112" y="106" width="22" height="14" rx="2" fill="#e9dcb8" stroke="#6b5335" strokeWidth="1.1" />
          {markText(sign, 123, 116.4, 8, '#4a3520')}
        </g>
      )
    case 'gothic':
      return (
        <g>
          <GroundShadow w={96} />
          <rect x="64" y="58" width="72" height="74" fill="#4a4652" />
          <path d="M64 58 L74 40 L84 58 Z M116 58 L126 40 L136 58 Z" fill="#3a3742" />
          <path d="M74 34 L74 44 M126 34 L126 44" stroke="#3a3742" strokeWidth="3" />
          <path d="M88 76 C88 64 112 64 112 76 L112 96 L88 96 Z" fill="#2a2732" />
          <path d="M91 76 C91 67 109 67 109 76 L109 96 L91 96 Z" fill={GLOW_DIM} opacity="0.7" />
          <path d="M100 68.5 L100 96 M91 82 L109 82" stroke="#2a2732" strokeWidth="1.6" />
          <Windows x={70} y={66} cols={1} rows={2} w={10} h={14} gy={8} lit={0.8} dark="#262330" />
          <Windows x={120} y={66} cols={1} rows={2} w={10} h={14} gy={8} lit={0.8} dark="#262330" />
          <rect x="86" y="108" width="28" height="24" fill="#211f29" />
          <rect x="89" y="111" width="22" height="21" fill="#171520" />
          {markText(sign, 100, 126, 10)}
        </g>
      )
    case 'art-deco':
      return (
        <g>
          <GroundShadow w={92} />
          <rect x="86" y="24" width="28" height="30" fill="#6e5a70" />
          <rect x="76" y="50" width="48" height="36" fill="#7d6880" />
          <rect x="68" y="84" width="64" height="48" fill="#8d7690" />
          <path d="M97 12 L103 12 L101 26 L99 26 Z" fill="#c9a3cc" />
          <Windows x={90} y={28} cols={2} rows={1} w={9} h={20} gx={3} lit={0.85} dark="#3c3040" />
          <Windows x={80} y={54} cols={3} rows={2} w={11} h={12} gx={4.5} gy={4} lit={0.7} dark="#3c3040" />
          <Windows x={73} y={88} cols={4} rows={2} w={11} h={12} gx={4.6} gy={5} lit={0.65} dark="#3c3040" />
          <rect x="88" y="118" width="24" height="14" fill="#2c2430" />
          <rect x="90" y="120" width="20" height="12" fill={GLOW_DIM} opacity="0.8" />
          {markText(sign, 100, 46, 11, '#efdff0')}
        </g>
      )
    case 'northstar':
      return (
        <g>
          <GroundShadow w={96} />
          <rect x="72" y="46" width="56" height="86" fill="#33586c" />
          <path d="M72 46 L128 46 L128 52 L72 52 Z" fill="#264353" />
          <Windows x={78} y={58} cols={4} rows={4} w={9} h={10} gx={3.8} gy={5.2} lit={0.65} color="#bfe3ec" dark="#1a3140" />
          <path d="M100 18 L104 30 L116 32 L104 36 L100 46 L96 36 L84 32 L96 30 Z" fill="#ffe9a6" className="av-core-pulse" />
          <rect x="86" y="118" width="28" height="14" fill="#152833" />
          <rect x="88" y="120" width="24" height="12" fill={GLOW_DIM} opacity="0.8" />
          {markText(sign, 100, 112, 10)}
        </g>
      )
    case 'neon':
      return (
        <g>
          <GroundShadow w={104} />
          <rect x="58" y="70" width="84" height="62" fill="#2b2438" />
          <path d="M58 70 L142 70 L142 76 L58 76 Z" fill="#1e1930" />
          <rect x="66" y="84" width="68" height="20" rx="3" fill="#170f24" />
          <text x="100" y="98.6" textAnchor="middle" fontSize="12" fontWeight={800} fill="#ff7edb" fontFamily="Georgia, serif" className="av-neon-flicker">{owned ? '✓' : 'N+G'}</text>
          <rect x="66" y="84" width="68" height="20" rx="3" fill="none" stroke="#ff7edb" strokeWidth="1.2" className="av-neon-flicker" />
          <Windows x={66} y={110} cols={5} rows={1} w={10} h={12} gx={4.4} lit={0.7} color="#8fd8ef" dark="#171226" />
          <rect x="126" y="42" width="4" height="28" fill="#1e1930" />
          <circle cx="128" cy="40" r="4" fill="#66e0e8" className="av-neon-flicker" />
        </g>
      )
    case 'mega-tower':
      return (
        <g>
          <GroundShadow w={100} />
          <path d="M78 12 L122 12 L128 132 L72 132 Z" fill="#14181f" />
          <path d="M78 12 L122 12 L123 26 L77 26 Z" fill="#0c0f14" />
          <Windows x={82} y={30} cols={4} rows={6} w={8} h={9} gx={2.6} gy={5.4} lit={0.55} color="#9fb6cf" dark="#20242c" />
          <path d="M84 118 L116 118 L116 132 L84 132 Z" fill="#05070a" />
          <path d="M87 120 L113 120 L113 132 L87 132 Z" fill="#c2d3e4" opacity="0.5" />
          <path d="M98 0 L102 0 L101 14 L99 14 Z" fill="#39414d" />
          {markText(sign, 100, 112, 12, '#c2d3e4')}
        </g>
      )
    case 'glass-arc':
      return (
        <g className="av-ship">
          <ShipHull hull="#1c3a4a" stripe="#7fd4e8" />
          <path d="M48 102 C48 76 76 62 104 62 C128 62 148 76 154 102 Z" fill="#a8dcE8" opacity="0.92" />
          <path d="M48 102 C48 76 76 62 104 62 C128 62 148 76 154 102" fill="none" stroke="#5aa9bd" strokeWidth="2" />
          <path d="M72 102 L76 70 M104 62 L104 102 M132 70 L130 102 M52 88 L150 88" stroke="#5aa9bd" strokeWidth="1.3" opacity="0.85" />
          {markText(sign, 102, 96, 11, '#0f3542')}
          <ScalesFlag x={148} y={52} pole={22} color="#a8dce8" />
        </g>
      )
    case 'command':
      return (
        <g className="av-ship">
          <ShipHull hull="#3a1518" stripe="#e06a55" />
          <path d="M46 102 L52 80 L116 80 L120 102 Z" fill="#d8d2c2" />
          <path d="M120 102 L120 76 C136 78 148 86 154 102 Z" fill="#c8c2b2" />
          <Windows x={58} y={85} cols={5} rows={2} w={7} h={4.5} gx={3.6} gy={3.6} lit={0.8} color="#ffb199" dark="#4c463c" />
          <circle cx="86" cy="70" r="9" fill="#2c1214" />
          <path d="M86 63 L86 77 M79 70 L93 70" stroke="#e06a55" strokeWidth="1.6" />
          <rect x="128" y="58" width="2.6" height="20" fill="#3a3f4a" />
          <path d="M122 60 L136 60" stroke="#3a3f4a" strokeWidth="1.4" />
          {markText(sign, 86, 73.8, 8, '#ffcdb8')}
        </g>
      )
    case 'citadel':
      return (
        <g className="av-ship">
          <ShipHull hull="#241b31" stripe="#c5b2ff" />
          <path d="M52 102 L56 84 L144 84 L148 102 Z" fill="#e8e2d4" />
          <path d="M66 84 L66 66 L82 66 L82 84 M118 84 L118 66 L134 66 L134 84" fill="#d6cfbe" />
          <path d="M64 66 L84 66 M116 66 L136 66" stroke="#a89e88" strokeWidth="2.4" />
          <path d="M92 84 L92 62 C92 54 108 54 108 62 L108 84 Z" fill="#cfc7b4" />
          <path d="M96 58 C98 52 102 52 104 58" fill="none" stroke="#e6c26a" strokeWidth="1.6" />
          <Windows x={95} y={64} cols={2} rows={2} w={4.5} h={5} gx={2.6} gy={3.4} lit={1} />
          {markText(sign, 100, 97, 9, '#463c28')}
          <ScalesFlag x={140} y={54} pole={24} color="#c5b2ff" />
        </g>
      )
    case 'campus':
      return (
        <g>
          <GroundShadow w={130} />
          <path d="M40 132 C40 114 66 108 100 108 C134 108 160 114 160 132 Z" fill="#57724f" />
          <rect x="50" y="96" width="36" height="36" rx="3" fill="#7f8b6f" />
          <rect x="114" y="96" width="36" height="36" rx="3" fill="#7f8b6f" />
          <path d="M82 132 L82 88 C82 74 118 74 118 88 L118 132 Z" fill="#c4bda6" />
          <path d="M86 80 C92 70 108 70 114 80 Z" fill="#88a07a" />
          <Windows x={54} y={102} cols={2} rows={2} w={11} h={9} gx={6} gy={5} lit={0.7} dark="#42503a" />
          <Windows x={118} y={102} cols={2} rows={2} w={11} h={9} gx={6} gy={5} lit={0.7} dark="#42503a" />
          <path d="M92 132 L92 100 L108 100 L108 132" fill="#3c3626" />
          {markText(sign, 100, 94, 9, '#f0ead4')}
        </g>
      )
    case 'ocean':
      return (
        <g>
          <path className="av-sea-swell" d="M24 126 C50 120 150 120 176 126 C150 134 50 134 24 126 Z" fill="#9fd6de" opacity="0.5" />
          <path d="M48 118 C48 110 152 110 152 118 L146 128 L54 128 Z" fill="#1c4f66" />
          <path d="M64 110 L64 78 C64 62 136 62 136 78 L136 110 C112 104 88 104 64 110 Z" fill="#a5d8e2" opacity="0.94" />
          <path d="M80 68 L80 104 M100 63 L100 103 M120 68 L120 104 M66 84 L134 84" stroke="#6da9b8" strokeWidth="1.4" opacity="0.85" />
          <path d="M100 56 L100 48 M96 52 L104 52" stroke="#7fd4e8" strokeWidth="1.6" />
          {markText(sign, 100, 96, 10, '#123c4c')}
        </g>
      )
    case 'orbital':
      return (
        <g className="av-station">
          <ellipse className="av-ring-spin" cx="100" cy="78" rx="58" ry="20" fill="none" stroke="#a08cc4" strokeWidth="6" opacity="0.9" />
          <ellipse className="av-ring-lights" cx="100" cy="78" rx="58" ry="20" fill="none" stroke="#e8c8ff" strokeWidth="2" strokeDasharray="3 12" />
          <circle cx="100" cy="78" r="14" fill="#cabce0" />
          <circle cx="100" cy="78" r="7" fill="#31254c" />
          {markText(sign, 100, 82, 9, '#e8d8ff')}
          <rect x="64" y="44" width="20" height="8" rx="2" fill="#3c2f5c" stroke="#a08cc4" strokeWidth="1" />
          <rect x="116" y="44" width="20" height="8" rx="2" fill="#3c2f5c" stroke="#a08cc4" strokeWidth="1" />
          <path d="M84 48 L100 64 M116 48 L100 64" stroke="#6d5b94" strokeWidth="1.6" />
        </g>
      )
    case 'lunar':
      return (
        <g className="av-station">
          <path d="M30 132 C48 120 76 114 100 114 C124 114 152 120 170 132 Z" fill="#8d939f" />
          <path d="M66 114 C66 90 134 90 134 114 Z" fill="#c8dce6" opacity="0.92" />
          <path d="M80 96 L80 114 M100 91 L100 114 M120 96 L120 114 M68 106 L132 106" stroke="#8fb0c0" strokeWidth="1.3" opacity="0.85" />
          <path d="M90 114 L90 103 C90 97 110 97 110 103 L110 114 Z" fill="#2b3c50" />
          {markText(sign, 100, 111.4, 8, '#dfe9f4')}
          <ellipse cx="52" cy="124" rx="7" ry="2.2" fill="#6d7380" />
          <ellipse cx="148" cy="126" rx="5" ry="1.8" fill="#6d7380" />
        </g>
      )
    case 'nexus':
      return (
        <g className="av-station av-nexus">
          <path d="M100 30 L114 62 L148 70 L114 78 L100 110 L86 78 L52 70 L86 62 Z" fill="#4a3d78" />
          <path d="M100 40 L110 64 L138 70 L110 76 L100 100 L90 76 L62 70 L90 64 Z" fill="#7a68b0" />
          <circle cx="100" cy="70" r="8" fill="#efe6f8" className="av-core-pulse" />
          {markText(sign, 100, 74, 8, '#2c2350')}
          <path className="av-nexus-links" d="M56 66 L32 54 M144 66 L168 52 M96 106 L82 122 M104 106 L120 122" stroke="#9484cc" strokeWidth="1.2" strokeDasharray="2 5" />
        </g>
      )
    default:
      return (
        <g>
          <GroundShadow w={90} />
          <rect x="70" y="60" width="60" height="72" fill="#5d5648" />
          <Windows x={76} y={68} cols={3} rows={3} w={12} h={10} gx={5} gy={6} lit={0.65} dark="#332e24" />
          {markText(sign, 100, 122, 11)}
        </g>
      )
  }
}

/* ------------------------------------------------- generic site frame */

export function SiteArt({ kind, tier, architecture, mark, owned }: {
  kind: 'tier' | 'rival'
  tier: number
  architecture?: string
  mark?: string
  owned?: boolean
}) {
  return (
    <svg viewBox="0 0 200 150" className="av-site-svg" aria-hidden="true">
      {kind === 'tier'
        ? <TierSiteArt tier={tier} />
        : <RivalSiteArt architecture={architecture ?? 'brick-house'} mark={mark ?? '?'} owned={Boolean(owned)} />}
    </svg>
  )
}
