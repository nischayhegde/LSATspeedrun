// The office interior: one 1280×720 vector room that transforms with the firm tier.

const BOOK_COLORS = ['#7c4a3a', '#3d5c54', '#2c4a68', '#8d6f45', '#5b4675', '#33586c', '#75513a', '#402c4e', '#267557', '#a84645']

type WallTheme = {
  wall: string
  wallLow: string
  trim: string
  floorA: string
  floorB: string
  skirting: string
}

function themeFor(tier: number): WallTheme {
  if (tier === 0) return { wall: '#6b5138', wallLow: '#59422c', trim: '#41301e', floorA: '#8a6a45', floorB: '#7b5c3a', skirting: '#4a3724' }
  if (tier === 1) return { wall: '#a5967b', wallLow: '#8f8066', trim: '#6b5c44', floorA: '#96714a', floorB: '#87633e', skirting: '#5d4a30' }
  if (tier === 2) return { wall: '#a5967b', wallLow: '#8a5340', trim: '#6b5c44', floorA: '#96714a', floorB: '#87633e', skirting: '#5d4a30' }
  if (tier <= 4) return { wall: '#7d8578', wallLow: '#6a7266', trim: '#4f574b', floorA: '#8a6142', floorB: '#7b5437', skirting: '#3f4a3e' }
  if (tier <= 6) return { wall: '#31435e', wallLow: '#28374d', trim: '#c89b4b', floorA: '#4c3b2c', floorB: '#423325', skirting: '#1e2c40' }
  if (tier <= 8) return { wall: '#43384a', wallLow: '#372e3d', trim: '#c89b4b', floorA: '#b9b2a4', floorB: '#aaa294', skirting: '#2c2431' }
  if (tier <= 11) return { wall: '#8f887a', wallLow: '#7c7567', trim: '#c89b4b', floorA: '#c2bbac', floorB: '#b3ab9b', skirting: '#5d574b' }
  return { wall: '#1c2438', wallLow: '#151b2c', trim: '#6fe3ff', floorA: '#2a3350', floorB: '#232b45', skirting: '#101625' }
}

function WindowSky({ tier }: { tier: number }) {
  if (tier >= 12) {
    return (
      <g>
        <rect x="430" y="80" width="430" height="260" fill="#060a18" />
        <g className="av-stars" fill="#dfe9ff">
          {Array.from({ length: 26 }, (_, i) => (
            <circle key={i} cx={445 + ((i * 67) % 400)} cy={92 + ((i * 41) % 200)} r={(i % 3) * 0.5 + 0.6} className={`tw-${i % 3}`} />
          ))}
        </g>
        {tier >= 13 && <circle cx="790" cy="140" r="26" fill="#c9ced9" />}
        {tier >= 13 && <g fill="#a9aeb9"><circle cx="782" cy="132" r="5" /><circle cx="800" cy="148" r="4" /><circle cx="788" cy="152" r="2.6" /></g>}
        <path d="M430 340 C560 296 730 296 860 340 Z" fill="#2f6ea8" />
        <path d="M430 340 C560 302 730 302 860 340 Z" fill="none" stroke="#79c3f0" strokeWidth="4" opacity="0.7" />
        <path d="M480 322 L512 322 M540 313 L600 313 M660 309 L740 309" stroke="#ffd98a" strokeWidth="2" opacity="0.8" />
      </g>
    )
  }
  const sky = tier === 0
    ? { top: '#232c3c', bottom: '#3a4256' }
    : tier <= 2
      ? { top: '#8fbede', bottom: '#e8d8ae' }
      : tier <= 4
        ? { top: '#7fb2d8', bottom: '#cfe3ec' }
        : tier === 5
          ? { top: '#7a5f8e', bottom: '#e8a06a' }
          : tier <= 8
            ? { top: '#27436b', bottom: '#7590b4' }
            : { top: '#c98d4e', bottom: '#f2d9a0' }
  const dusk = tier >= 5
  return (
    <g>
      <rect x="430" y="80" width="430" height="260" fill={sky.bottom} />
      <rect x="430" y="80" width="430" height="150" fill={sky.top} />
      <rect x="430" y="200" width="430" height="60" fill={sky.top} opacity="0.45" />
      {tier !== 0 && <circle cx={tier >= 5 ? 800 : 500} cy={tier >= 5 ? 150 : 128} r="24" fill={dusk ? '#f5c26b' : '#fff3c9'} opacity="0.95" />}
      {tier === 0 && <circle cx="800" cy="120" r="18" fill="#e8ecf2" opacity="0.85" />}
      <g className="av-clouds" fill="rgba(255,255,255,.55)">
        <ellipse className="c1" cx="520" cy="130" rx="46" ry="12" />
        <ellipse className="c2" cx="720" cy="105" rx="60" ry="14" />
      </g>
      {/* skyline */}
      <g fill={tier === 0 ? '#141a26' : dusk ? '#2c3350' : '#5a7186'}>
        {[
          [440, 250, 46, 90], [494, 270, 34, 70], [536, 232, 44, 108], [588, 262, 38, 78],
          [634, 218, 50, 122], [692, 252, 40, 88], [740, 236, 46, 104], [794, 266, 34, 74], [832, 246, 26, 94],
        ].map(([x, y, w, h], i) => <rect key={i} x={x} y={y} width={w} height={h} />)}
      </g>
      <g fill="#ffd98a" opacity="0.8">
        {Array.from({ length: 22 }, (_, i) => (
          <rect key={i} x={452 + ((i * 53) % 390)} y={240 + ((i * 29) % 86)} width="4" height="5" />
        ))}
      </g>
      {tier === 0 && (
        <g className="av-rain" stroke="#9fb4c8" strokeWidth="1.6" opacity="0.7">
          {Array.from({ length: 14 }, (_, i) => (
            <line key={i} x1={445 + i * 30} y1={90} x2={438 + i * 30} y2={112} className={`r-${i % 3}`} />
          ))}
        </g>
      )}
    </g>
  )
}

function Bookcase({ x, y, w, h, trim }: { x: number; y: number; w: number; h: number; trim: string }) {
  const shelves = 4
  const shelfH = (h - 24) / shelves
  return (
    <g className="av-bookcase">
      <rect x={x} y={y} width={w} height={h} rx="6" fill="#4a3524" />
      <rect x={x + 8} y={y + 8} width={w - 16} height={h - 16} rx="3" fill="#33241610" />
      <rect x={x + 8} y={y + 8} width={w - 16} height={h - 16} rx="3" fill="#2c2013" />
      {Array.from({ length: shelves }, (_, s) => {
        const sy = y + 12 + s * shelfH
        const books = Math.floor((w - 28) / 15)
        return (
          <g key={s}>
            {Array.from({ length: books }, (_, b) => {
              const bh = shelfH - 14 - ((b * 7 + s * 3) % 3) * 4
              return (
                <rect
                  key={b}
                  x={x + 12 + b * 15}
                  y={sy + (shelfH - 12 - bh)}
                  width="12"
                  height={bh}
                  rx="1.5"
                  fill={BOOK_COLORS[(b + s * 3) % BOOK_COLORS.length]}
                />
              )
            })}
            <rect x={x + 6} y={sy + shelfH - 12} width={w - 12} height="6" fill="#5d4430" />
          </g>
        )
      })}
      <rect x={x} y={y - 10} width={w} height="14" rx="4" fill={trim === '#c89b4b' ? '#5d4430' : '#5d4430'} />
    </g>
  )
}

function HeroDesk({ battered }: { battered: boolean }) {
  const top = battered ? '#7b5c3a' : '#5d4430'
  const front = battered ? '#6a4e30' : '#4a3524'
  return (
    <g className="av-desk">
      <path d="M468 522 L812 522 L800 508 L480 508 Z" fill={top} />
      <rect x="480" y="522" width="320" height="86" rx="4" fill={front} />
      <path d="M480 522 L800 522 L800 530 L480 530 Z" fill="rgba(0,0,0,.18)" />
      <rect x="502" y="540" width="70" height="52" rx="3" fill="#3a2a1a" />
      <rect x="708" y="540" width="70" height="52" rx="3" fill="#3a2a1a" />
      <circle cx="537" cy="566" r="3" fill="#c89b4b" />
      <circle cx="743" cy="566" r="3" fill="#c89b4b" />
      {battered && <path d="M560 522 L588 522 L574 534 Z" fill="#41301e" />}
      {battered && <path d="M690 608 L716 608 L702 596 Z" fill="#41301e" />}
      {/* banker's lamp */}
      <g className="av-lamp">
        <rect x="520" y="472" width="5" height="34" fill="#2c3a2e" />
        <path d="M500 472 C500 458 546 458 546 472 Z" fill="#2e6547" />
        <ellipse className="av-lamp-glow" cx="523" cy="478" rx="34" ry="14" fill="#ffe9a6" opacity="0.28" />
        <rect x="512" y="504" width="22" height="5" rx="2" fill="#213426" />
      </g>
      {/* papers, phone, mug */}
      <path d="M580 498 L622 498 L626 508 L582 508 Z" fill="#f2ecd8" />
      <path d="M586 501 L618 501 M585 504 L620 504" stroke="#b9ad8d" strokeWidth="1.4" />
      <rect x="640" y="492" width="52" height="16" rx="3" fill="#1b2330" />
      <rect x="646" y="480" width="40" height="14" rx="2" fill="#8fd8ef" opacity="0.9" />
      <path d="M712 494 C712 488 728 488 728 494 L730 506 L710 506 Z" fill="#a84645" />
      <path className="av-steam-line" d="M719 482 C722 478 717 474 720 470" stroke="#dcd5c4" strokeWidth="2" fill="none" strokeLinecap="round" />
      <rect x="744" y="496" width="34" height="12" rx="2" fill="#2c2013" />
      <path d="M748 496 L758 486 L776 486 L772 496" fill="#3d2c1a" />
    </g>
  )
}

function Reception({ tier }: { tier: number }) {
  return (
    <g className="av-reception">
      <path d="M948 470 L1218 470 L1206 452 L960 452 Z" fill="#5d4430" />
      <rect x="960" y="470" width="234" height="74" rx="4" fill="#4a3524" />
      <rect x="972" y="482" width="210" height="8" rx="3" fill="#c89b4b" opacity="0.55" />
      <circle cx="1176" cy="462" r="6" fill="#c89b4b" />
      <rect x="1174" y="466" width="4" height="4" fill="#8d6f45" />
      <path d="M988 452 L1010 452 L1008 440 L990 440 Z" fill="#f2ecd8" />
      {tier >= 1 && <rect x="1040" y="432" width="90" height="16" rx="3" fill="#2c2013" />}
      {tier >= 1 && <text x="1085" y="444" textAnchor="middle" fontSize="11" fontWeight={700} fill="#e8c87c" fontFamily="Georgia, serif" letterSpacing="2">RECEPTION</text>}
    </g>
  )
}

function OfficePlant({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} className="av-plant">
      <path d="M-16 0 L16 0 L11 34 L-11 34 Z" fill="#8a4f3a" />
      <path d="M-16 0 L16 0 L15 7 L-15 7 Z" fill="#6d3c2b" />
      <path d="M0 -4 C-4 -20 -20 -26 -26 -40 C-10 -36 -4 -26 0 -14 C4 -28 12 -38 26 -44 C20 -28 8 -20 2 -6 Z" fill="#3d6b4f" />
      <path d="M0 -6 C-2 -22 -8 -34 -2 -50 C4 -38 4 -22 2 -8 Z" fill="#4f8563" />
    </g>
  )
}

function GrandClock() {
  return (
    <g className="av-clock" transform="translate(530 0)">
      <rect x="368" y="150" width="44" height="150" rx="8" fill="#4a3524" />
      <rect x="374" y="158" width="32" height="60" rx="6" fill="#2c2013" />
      <circle cx="390" cy="182" r="14" fill="#f2ecd8" />
      <path d="M390 182 L390 172 M390 182 L397 185" stroke="#33241e" strokeWidth="2" strokeLinecap="round" />
      <g className="av-pendulum-swing">
        <line x1="390" y1="222" x2="390" y2="262" stroke="#c89b4b" strokeWidth="3" />
        <circle cx="390" cy="266" r="7" fill="#c89b4b" />
      </g>
    </g>
  )
}

function DocketBoard() {
  return (
    <g className="av-docket">
      <rect x="346" y="88" width="70" height="250" rx="6" fill="#5d4430" />
      <rect x="352" y="94" width="58" height="238" rx="4" fill="#8a6a45" />
      <text x="381" y="110" textAnchor="middle" fontSize="11" fontWeight={800} fill="#f0e6c8" fontFamily="Georgia, serif" letterSpacing="2">DOCKET</text>
      {[[358, 120, '#f2ecd8'], [384, 132, '#e8d8ae'], [360, 168, '#f2ecd8'], [386, 182, '#dcc9a0'], [362, 222, '#f2ecd8'], [384, 244, '#e8d8ae'], [360, 282, '#dcc9a0']].map(([x, y, c], i) => (
        <g key={i}>
          <rect x={x as number} y={y as number} width="22" height="26" rx="1.5" fill={c as string} transform={`rotate(${i % 2 ? 3 : -3} ${(x as number) + 11} ${(y as number) + 13})`} />
          <circle cx={(x as number) + 11} cy={(y as number) + 2} r="1.8" fill="#a84645" />
        </g>
      ))}
      <path d="M369 122 L395 184 L371 224 L395 246 L371 284" fill="none" stroke="#a84645" strokeWidth="1.4" opacity="0.85" />
    </g>
  )
}

function EmpireWallMap({ tier }: { tier: number }) {
  if (tier >= 6) return null
  return (
    <g className="av-wallmap">
      <rect x="1058" y="266" width="164" height="112" rx="8" fill="#4a3524" />
      <rect x="1066" y="274" width="148" height="96" rx="5" fill="#22374a" />
      <path d="M1080 320 C1096 300 1118 296 1132 312 C1148 300 1170 302 1184 318 C1196 308 1206 310 1208 320 C1196 336 1174 342 1156 334 C1140 346 1114 344 1100 332 C1090 336 1082 330 1080 320 Z" fill="#3f6b58" opacity="0.9" />
      <circle cx="1108" cy="316" r="4" fill="#ffd98a" className="av-core-pulse" />
      <circle cx="1160" cy="322" r="3" fill="#e06a55" />
      <circle cx="1186" cy="312" r="3" fill="#e06a55" />
      <path d="M1108 316 L1160 322 M1160 322 L1186 312" stroke="#ffd98a" strokeWidth="1" strokeDasharray="2 4" opacity="0.8" />
      <text x="1140" y="362" textAnchor="middle" fontSize="10" fontWeight={800} fill="#c9a860" fontFamily="Georgia, serif" letterSpacing="2.5">THE EMPIRE</text>
    </g>
  )
}

function Cat() {
  return (
    <g className="av-cat">
      <path className="av-cat-tail" d="M418 668 C430 664 434 654 428 644" fill="none" stroke="#3a3f4a" strokeWidth="7" strokeLinecap="round" />
      <ellipse cx="398" cy="668" rx="24" ry="14" fill="#454b58" />
      <circle cx="378" cy="650" r="13" fill="#454b58" />
      <path d="M368 642 L365 630 L376 637 Z M388 642 L391 630 L380 637 Z" fill="#454b58" />
      <path d="M370 649 L374 649 M382 649 L386 649" stroke="#ffd98a" strokeWidth="2.4" strokeLinecap="round" className="av-cat-eyes" />
      <path d="M362 656 L354 654 M362 659 L354 660" stroke="#8b93a2" strokeWidth="1.2" />
    </g>
  )
}

function TierDecor({ tier, theme }: { tier: number; theme: WallTheme }) {
  return (
    <g>
      {tier === 0 && (
        <g>
          <path d="M0 44 L1280 8 L1280 26 L0 62 Z" fill="#41301e" />
          <path d="M120 30 L134 470 M420 22 L430 80 M980 12 L1000 470 M1260 6 L1266 60" stroke="#41301e" strokeWidth="14" opacity="0.7" />
          <g className="av-leak">
            <path d="M905 60 L925 60 L919 74 L911 74 Z" fill="#3a4256" opacity="0.6" />
            <circle className="av-drip" cx="915" cy="86" r="4" fill="#9fc4d8" opacity="0.85" />
            <ellipse cx="915" cy="700" rx="26" ry="6" fill="#57708a" opacity="0.4" />
            <rect x="893" y="640" width="44" height="52" rx="5" fill="#6d7380" />
            <rect x="893" y="640" width="44" height="8" rx="3" fill="#8b93a2" />
          </g>
          <g>
            <rect x="1120" y="560" width="86" height="60" rx="4" fill="#8a6b47" />
            <rect x="1132" y="524" width="86" height="60" rx="4" fill="#96754e" />
            <text x="1174" y="560" textAnchor="middle" fontSize="15" fontWeight={800} fill="#5d4430" fontFamily="Georgia, serif">FILES</text>
          </g>
          <g>
            <rect x="52" y="560" width="120" height="66" rx="8" fill="#7d8590" />
            <path d="M64 560 L64 626 M88 560 L88 626 M112 560 L112 626 M136 560 L136 626 M160 560 L160 626" stroke="#5d6570" strokeWidth="7" />
          </g>
        </g>
      )}
      {tier === 1 && (
        <g>
          <rect x="1216" y="330" width="10" height="150" fill="#4a3524" />
          <circle cx="1221" cy="336" r="7" fill="#5d4430" />
          <path d="M1198 352 C1204 344 1214 342 1221 348 L1221 372 C1212 366 1203 362 1198 352 Z" fill="#31435e" />
          <rect x="80" y="86" width="216" height="34" rx="5" fill="#2c2013" />
          <text x="188" y="109" textAnchor="middle" fontSize="17" fontWeight={700} fill="#e8c87c" fontFamily="Georgia, serif" letterSpacing="3">YOUR NAME, ESQ.</text>
        </g>
      )}
      {tier === 2 && (
        <g>
          <rect x="0" y="330" width="1280" height="140" fill={theme.wallLow} />
          <path d="M0 330 L1280 330 L1280 338 L0 338 Z" fill="rgba(0,0,0,.2)" />
          {Array.from({ length: 16 }, (_, i) => (
            <rect key={i} x={12 + i * 82} y={i % 2 ? 352 : 396} width="66" height="30" rx="2" fill="rgba(255,255,255,.05)" stroke="rgba(0,0,0,.12)" />
          ))}
          <rect x="76" y="90" width="230" height="44" rx="6" fill="#2e5a52" />
          <text x="191" y="118" textAnchor="middle" fontSize="18" fontWeight={800} fill="#f0e6c8" fontFamily="Georgia, serif" letterSpacing="4">COMMUNITY LAW</text>
        </g>
      )}
      {tier === 3 && (
        <g>
          <rect x="386" y="80" width="26" height="390" rx="4" fill="#8d8779" />
          <rect x="380" y="70" width="38" height="16" rx="3" fill="#a8a294" />
          <rect x="380" y="454" width="38" height="16" rx="3" fill="#a8a294" />
          <rect x="872" y="80" width="26" height="390" rx="4" fill="#8d8779" />
          <rect x="866" y="70" width="38" height="16" rx="3" fill="#a8a294" />
          <rect x="866" y="454" width="38" height="16" rx="3" fill="#a8a294" />
        </g>
      )}
      {tier === 4 && (
        <g>
          <g className="av-statue">
            <rect x="118" y="332" width="96" height="30" rx="4" fill="#8d8779" />
            <rect x="136" y="230" width="60" height="104" rx="8" fill="#b9b2a4" />
            <circle cx="166" cy="212" r="22" fill="#c9c2b4" />
            <path d="M166 232 L166 268 M142 246 L190 246" stroke="#8d8779" strokeWidth="5" />
            <path d="M142 246 L134 262 L150 262 Z M190 246 L182 262 L198 262 Z" fill="#c9c2b4" />
          </g>
          <g>
            <rect x="1080" y="120" width="150" height="94" rx="6" fill="#2c2013" />
            <text x="1155" y="146" textAnchor="middle" fontSize="14" fontWeight={800} fill="#e8c87c" fontFamily="Georgia, serif" letterSpacing="3">VERDICTS</text>
            <text x="1155" y="176" textAnchor="middle" fontSize="20" fill="#e8c87c">★ ★ ★</text>
            <text x="1155" y="200" textAnchor="middle" fontSize="12" fill="#a89a7f" fontFamily="Georgia, serif">CITY POWER FIRM</text>
          </g>
        </g>
      )}
      {tier === 5 && (
        <g>
          <rect x="80" y="100" width="250" height="150" rx="8" fill="#1c2c3f" />
          <path d="M110 160 C140 130 170 190 210 150 C240 120 280 170 300 140" fill="none" stroke="#3f5975" strokeWidth="16" strokeLinecap="round" opacity="0.8" />
          {[[130, 150], [180, 168], [222, 142], [268, 158], [292, 136]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="5" fill="#ffd98a" className="av-core-pulse" />
          ))}
          <text x="205" y="128" textAnchor="middle" fontSize="13" fontWeight={800} fill="#e8c87c" fontFamily="Georgia, serif" letterSpacing="4">REGIONAL OFFICES</text>
          <text x="205" y="236" textAnchor="middle" fontSize="11" fill="#7590b4" fontFamily="Georgia, serif" letterSpacing="2">NYC · LA · CHI · DC · SEA</text>
        </g>
      )}
      {tier >= 6 && tier < 12 && (
        <g>
          <g className="av-worldclocks">
            {['NEW YORK', 'LONDON', 'TOKYO'].map((city, i) => (
              <g key={city} transform={`translate(${104 + i * 78} 108)`}>
                <circle r="22" fill="#f2ecd8" stroke={theme.trim} strokeWidth="3" />
                <path d={`M0 0 L0 -13 M0 0 L${8 - i * 3} ${5 + i * 2}`} stroke="#33241e" strokeWidth="2.4" strokeLinecap="round" />
                <text y="38" textAnchor="middle" fontSize="10" fontWeight={800} fill={tier <= 8 ? '#d9d2bd' : '#4a4438'} fontFamily="Georgia, serif" letterSpacing="1.5">{city}</text>
              </g>
            ))}
          </g>
          <g className="av-holo">
            <ellipse cx="1150" cy="330" rx="60" ry="12" fill="#2a4a66" opacity="0.55" />
            <circle className="av-holo-spin" cx="1150" cy="270" r="44" fill="none" stroke="#6fd8ef" strokeWidth="2.4" opacity="0.85" strokeDasharray="8 6" />
            <ellipse cx="1150" cy="270" rx="44" ry="16" fill="none" stroke="#6fd8ef" strokeWidth="1.6" opacity="0.6" />
            <path d="M1128 258 C1136 248 1150 246 1158 254 C1168 250 1174 258 1170 266 C1160 272 1140 272 1130 268 Z" fill="#6fd8ef" opacity="0.5" />
            <path d="M1118 330 L1150 292 L1182 330" stroke="#2a4a66" strokeWidth="4" fill="none" />
          </g>
        </g>
      )}
      {tier >= 9 && tier < 12 && (
        <g className="av-treaty">
          <circle cx="238" cy="250" r="40" fill="none" stroke={theme.trim} strokeWidth="2" opacity="0.7" strokeDasharray="5 7" className="av-holo-spin" />
          <circle cx="238" cy="250" r="10" fill={theme.trim} opacity="0.9" />
          <text x="238" y="316" textAnchor="middle" fontSize="11" fontWeight={800} fill="#4a4438" fontFamily="Georgia, serif" letterSpacing="3">ACCORD NETWORK</text>
        </g>
      )}
      {tier >= 12 && (
        <g>
          <path d="M0 70 L1280 70" stroke="#6fe3ff" strokeWidth="2" opacity="0.5" />
          <path d="M0 460 L1280 460" stroke="#6fe3ff" strokeWidth="2" opacity="0.35" />
          <g className="av-console">
            <rect x="80" y="180" width="240" height="130" rx="10" fill="#101830" stroke="#31436b" strokeWidth="3" />
            <path d="M100 260 L130 236 L158 252 L190 214 L222 238 L252 206 L290 228" fill="none" stroke="#6fe3ff" strokeWidth="3" strokeLinecap="round" className="av-chart-draw" />
            <text x="200" y="205" textAnchor="middle" fontSize="12" fontWeight={800} fill="#79c3f0" fontFamily="Georgia, serif" letterSpacing="3">ORBITAL DOCKET</text>
          </g>
          {tier >= 14 && (
            <g className="av-constellation">
              {[[1020, 130], [1080, 100], [1150, 126], [1210, 96], [1120, 170], [1190, 160]].map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r="3.4" fill="#ffe9a6" className={`tw-${i % 3}`} />
              ))}
              <path d="M1020 130 L1080 100 L1150 126 L1210 96 M1080 100 L1120 170 L1190 160 L1150 126" stroke="#8ea6c4" strokeWidth="1.4" opacity="0.6" fill="none" />
            </g>
          )}
        </g>
      )}
    </g>
  )
}

function OwnedSetPieces({ tier, owned }: { tier: number; owned: Set<string> }) {
  return (
    <g>
      {(owned.has('legal_library') || tier >= 2) && (
        <g>
          <rect x="72" y="330" width="150" height="26" rx="4" fill="#2c2013" />
          <text x="147" y="348" textAnchor="middle" fontSize="12" fontWeight={800} fill="#e8c87c" fontFamily="Georgia, serif" letterSpacing="3">LEGAL ARCHIVE</text>
        </g>
      )}
      {(owned.has('case_management') || tier >= 2) && (
        <g className="av-printer">
          <rect x="880" y="500" width="60" height="34" rx="5" fill="#5d6570" />
          <rect x="890" y="492" width="40" height="12" rx="2" fill="#454b58" />
          <rect className="av-page-out" x="896" y="482" width="28" height="14" rx="1" fill="#f2ecd8" />
        </g>
      )}
      {(owned.has('research_floor') || tier >= 4) && (
        <g className="av-servers">
          {[0, 1, 2].map((i) => (
            <g key={i} transform={`translate(${848 + i * 34} 372)`}>
              <rect width="28" height="96" rx="4" fill="#1c2430" />
              <circle cx="8" cy="14" r="2.6" fill="#6fe3ff" className={`av-blink b-${i}`} />
              <circle cx="18" cy="14" r="2.6" fill="#ffd98a" className={`av-blink b-${(i + 1) % 3}`} />
              <path d="M5 30 L23 30 M5 42 L23 42 M5 54 L23 54 M5 66 L23 66" stroke="#31435e" strokeWidth="3" />
            </g>
          ))}
        </g>
      )}
      {(owned.has('jury_simulator') || tier >= 6) && (
        <g className="av-jury">
          <ellipse cx="520" cy="440" rx="58" ry="10" fill="#2a4a66" opacity="0.5" />
          <circle className="av-holo-spin" cx="520" cy="408" r="30" fill="none" stroke="#c5b2ff" strokeWidth="2" strokeDasharray="4 7" opacity="0.9" />
          {[0, 1, 2].map((i) => (
            <circle key={i} cx={498 + i * 22} cy={404} r="7" fill="#c5b2ff" opacity="0.75" />
          ))}
        </g>
      )}
      {(owned.has('global_crisis_center') || tier >= 9) && (
        <g className="av-crisis">
          <rect x="1052" y="392" width="160" height="70" rx="8" fill="#26161a" stroke="#8f3c34" strokeWidth="3" />
          <circle cx="1076" cy="418" r="8" fill="#e06a55" className="av-core-pulse" />
          <path d="M1096 412 L1192 412 M1096 428 L1170 428 M1096 444 L1184 444" stroke="#8f5b52" strokeWidth="4" strokeLinecap="round" />
        </g>
      )}
      {tier >= 2 && (
        <g className="av-conference">
          <ellipse cx="1084" cy="640" rx="120" ry="34" fill="#5d4430" />
          <ellipse cx="1084" cy="632" rx="120" ry="34" fill="#7b5c3a" />
          <ellipse cx="1084" cy="630" rx="92" ry="24" fill="#8a6a45" />
          {[[978, 606], [1042, 592], [1128, 592], [1190, 606]].map(([x, y], i) => (
            <g key={i}><rect x={x - 14} y={y - 8} width="28" height="30" rx="6" fill="#33241e" /></g>
          ))}
        </g>
      )}
      {tier >= 4 && (
        <g className="av-trophy">
          <rect x="242" y="356" width="112" height="114" rx="8" fill="#2c2013" />
          <rect x="250" y="364" width="96" height="98" rx="5" fill="#3d2f1d" />
          {[0, 1, 2].map((i) => (
            <path key={i} d={`M${266 + i * 32} 430 L${278 + i * 32} 430 L${276 + i * 32} 420 C${280 + i * 32} 414 ${280 + i * 32} 406 ${272 + i * 32} 404 C${264 + i * 32} 406 ${264 + i * 32} 414 ${268 + i * 32} 420 Z`} fill="#e8c87c" />
          ))}
          <text x="298" y="392" textAnchor="middle" fontSize="11" fontWeight={800} fill="#c9a860" fontFamily="Georgia, serif" letterSpacing="2">TROPHIES</text>
        </g>
      )}
    </g>
  )
}

export function OfficeRoom({ tier, owned }: { tier: number; owned: Set<string> }) {
  const theme = themeFor(tier)
  const deskRestored = owned.has('repaired_desk') || tier >= 1
  return (
    <svg viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice" className="av-office-svg" aria-hidden="true">
      {/* wall */}
      <rect x="0" y="0" width="1280" height="470" fill={theme.wall} />
      <rect x="0" y="380" width="1280" height="90" fill={theme.wallLow} />
      <rect x="0" y="0" width="1280" height="26" fill="rgba(0,0,0,.22)" />
      <rect x="0" y="26" width="1280" height="6" fill="rgba(255,255,255,.08)" />
      {tier >= 3 && tier < 12 && (
        <g opacity="0.35" stroke="rgba(0,0,0,.28)" strokeWidth="2">
          {[160, 320, 480, 800, 960, 1120].map((x) => <line key={x} x1={x} y1={40} x2={x} y2={380} />)}
        </g>
      )}
      {/* skirting */}
      <rect x="0" y="452" width="1280" height="18" fill={theme.skirting} />
      {/* floor */}
      <rect x="0" y="470" width="1280" height="250" fill={theme.floorA} />
      {tier >= 6 ? (
        <g opacity="0.5">
          {Array.from({ length: 7 }, (_, i) => <path key={i} d={`M${-140 + i * 240} 720 L${60 + i * 200} 470 L${64 + i * 200} 470 L${-132 + i * 240} 720 Z`} fill={theme.floorB} />)}
          <rect x="0" y="470" width="1280" height="6" fill="rgba(255,255,255,.12)" />
        </g>
      ) : (
        <g>
          {Array.from({ length: 6 }, (_, i) => <rect key={i} x="0" y={470 + i * 42 + 20} width="1280" height="3" fill={theme.floorB} />)}
          <rect x="0" y="470" width="1280" height="6" fill="rgba(255,255,255,.1)" />
        </g>
      )}
      {/* rug */}
      <ellipse cx="640" cy="628" rx="330" ry="84" fill={tier >= 12 ? '#1b2036' : '#7c4a3a'} opacity="0.85" />
      <ellipse cx="640" cy="628" rx="286" ry="68" fill="none" stroke={tier >= 12 ? '#6fe3ff' : '#c89b4b'} strokeWidth="3" opacity="0.6" />
      <ellipse cx="640" cy="628" rx="240" ry="54" fill="none" stroke={tier >= 12 ? '#31436b' : '#a3703c'} strokeWidth="2" opacity="0.5" />
      {/* window */}
      <g className="av-window">
        <rect x="418" y="66" width="454" height="288" rx={tier >= 3 ? 20 : 6} fill="#2c2013" />
        <WindowSky tier={tier} />
        <path d="M645 80 L645 340 M430 210 L860 210" stroke="#2c2013" strokeWidth="10" />
        <rect x="418" y="66" width="454" height="288" rx={tier >= 3 ? 20 : 6} fill="none" stroke={tier >= 12 ? '#31436b' : '#4a3524'} strokeWidth="14" />
        <rect x="404" y="348" width="482" height="14" rx="4" fill={tier >= 12 ? '#31436b' : '#4a3524'} />
        <path d="M430 90 L560 80 L520 130 L448 142 Z" fill="rgba(255,255,255,.12)" />
      </g>
      {/* light shafts */}
      <g className="av-shafts" opacity={tier === 0 ? 0.12 : 0.2}>
        <path d="M470 90 L390 720 L560 720 L590 90 Z" fill="#ffe9b6" />
        <path d="M700 90 L680 720 L840 720 L790 90 Z" fill="#ffe9b6" opacity="0.7" />
      </g>
      {/* diplomas */}
      <g className="av-diplomas">
        {[['JD', 96], ['BAR', 168], ['★', 240]].map(([label, x]) => (
          <g key={label as string} transform={`translate(${x} 74)`}>
            <rect width="52" height="42" rx="4" fill="#2c2013" />
            <rect x="5" y="5" width="42" height="32" rx="2" fill="#f2ecd8" />
            <text x="26" y="27" textAnchor="middle" fontSize="13" fontWeight={800} fill="#8d6f45" fontFamily="Georgia, serif">{label}</text>
          </g>
        ))}
      </g>
      <Bookcase x={60} y={150} w={280} h={320} trim={theme.trim} />
      <TierDecor tier={tier} theme={theme} />
      <OwnedSetPieces tier={tier} owned={owned} />
      <DocketBoard />
      <EmpireWallMap tier={tier} />
      <GrandClock />
      <HeroDesk battered={!deskRestored} />
      <Reception tier={tier} />
      <OfficePlant x={392} y={620} />
      <OfficePlant x={1246} y={600} scale={0.85} />
      {/* safe */}
      <g className="av-safe">
        <rect x="264" y="586" width="74" height="80" rx="8" fill="#3a4550" />
        <rect x="272" y="594" width="58" height="64" rx="5" fill="#2c3640" />
        <circle cx="301" cy="626" r="13" fill="#1e262e" stroke="#c89b4b" strokeWidth="3" />
        <path d="M301 618 L301 626 L308 630" stroke="#c89b4b" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <text x="301" y="682" textAnchor="middle" fontSize="12" fontWeight={800} fill="#c89b4b" fontFamily="Georgia, serif">$</text>
      </g>
      {/* ceiling lights */}
      <g className="av-pendants">
        {[320, 640, 960].map((x) => (
          <g key={x}>
            <line x1={x} y1={0} x2={x} y2={44} stroke="#2c2013" strokeWidth="4" />
            <path d={`M${x - 26} 62 C${x - 26} 44 ${x + 26} 44 ${x + 26} 62 Z`} fill={tier >= 12 ? '#31436b' : '#4a3524'} />
            <ellipse className="av-bulb" cx={x} cy={64} rx="14" ry="6" fill="#ffe9a6" opacity="0.9" />
          </g>
        ))}
      </g>
      <Cat />
      {/* dust motes */}
      <g className="av-motes" fill="#ffe9b6">
        {Array.from({ length: 14 }, (_, i) => (
          <circle key={i} cx={430 + ((i * 61) % 420)} cy={140 + ((i * 47) % 300)} r={i % 3 ? 2 : 2.8} className={`m-${i % 4}`} opacity="0.5" />
        ))}
      </g>
    </svg>
  )
}
