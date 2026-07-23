// Empire-map biome panoramas. 1440×810, drawn to sit behind HTML site nodes.

function Tree({ x, y, r = 12 }: { x: number; y: number; r?: number }) {
  return (
    <g>
      <rect x={x - 1.6} y={y} width="3.2" height={r * 0.7} fill="#4a3a26" />
      <circle cx={x} cy={y - r * 0.4} r={r} fill="#4d6a45" />
      <circle cx={x - r * 0.5} cy={y - r * 0.1} r={r * 0.62} fill="#5d7a52" />
    </g>
  )
}

function CityTerrain() {
  return (
    <g>
      <rect width="1440" height="810" fill="#9aa373" />
      <rect width="1440" height="810" fill="url(#av-city-light)" opacity="0.55" />
      {/* blocks */}
      <g fill="#b3a98c" opacity="0.75">
        {[
          [60, 90, 300, 170], [420, 60, 340, 150], [820, 80, 280, 160], [1160, 90, 220, 150],
          [80, 330, 260, 180], [900, 300, 300, 170], [1240, 320, 160, 180],
          [100, 590, 280, 150], [440, 610, 320, 140], [820, 600, 280, 150], [1160, 590, 220, 160],
        ].map(([x, y, w, h], i) => <rect key={i} x={x} y={y} width={w} height={h} rx="14" />)}
      </g>
      {/* roads */}
      <g stroke="#d9cba8" strokeWidth="34">
        <path d="M0 275 L1440 262" fill="none" />
        <path d="M0 552 L1440 545" fill="none" />
        <path d="M400 0 L410 810" fill="none" />
        <path d="M1120 0 L1130 810" fill="none" />
        <path d="M790 0 L800 810" fill="none" strokeWidth="26" />
      </g>
      <g stroke="#f2e9cf" strokeWidth="3" strokeDasharray="18 22" opacity="0.8">
        <path d="M0 275 L1440 262" fill="none" />
        <path d="M0 552 L1440 545" fill="none" />
        <path d="M400 0 L410 810" fill="none" />
        <path d="M1120 0 L1130 810" fill="none" />
      </g>
      <circle className="av-car c1" r="6" fill="#a84645" />
      <circle className="av-car c2" r="6" fill="#31435e" />
      {/* park */}
      <g>
        <rect x="480" y="330" width="330" height="180" rx="26" fill="#7d9862" />
        <path d="M520 420 C580 380 700 380 770 430" fill="none" stroke="#cfc19b" strokeWidth="10" />
        <Tree x={540} y={380} /><Tree x={620} y={358} r={14} /><Tree x={720} y={372} /><Tree x={760} y={470} r={10} />
        <circle cx="650" cy="452" r="26" fill="#7fb2c8" />
        <circle cx="650" cy="452" r="26" fill="none" stroke="#d9cba8" strokeWidth="5" />
        <circle className="av-fountain" cx="650" cy="452" r="7" fill="#cfe8f0" />
      </g>
      {/* courthouse */}
      <g transform="translate(560 120)">
        <rect x="0" y="34" width="180" height="86" rx="6" fill="#cfc6ae" />
        <path d="M-10 38 L90 -8 L190 38 Z" fill="#a89a7f" />
        <path d="M22 54 L22 112 M58 54 L58 112 M94 54 L94 112 M130 54 L130 112 M158 54 L158 112" stroke="#a89a7f" strokeWidth="10" />
        <rect x="74" y="84" width="34" height="36" fill="#5d4a30" />
        <text x="90" y="140" textAnchor="middle" fontSize="17" fontWeight={800} fill="#4a4438" fontFamily="Georgia, serif" letterSpacing="3">CIVIC COURT</text>
      </g>
      <defs>
        <radialGradient id="av-city-light" cx="35%" cy="20%" r="90%">
          <stop offset="0%" stopColor="#f5e6b8" stopOpacity="0.7" />
          <stop offset="60%" stopColor="#f5e6b8" stopOpacity="0" />
        </radialGradient>
      </defs>
    </g>
  )
}

function NationTerrain() {
  return (
    <g>
      <rect width="1440" height="810" fill="#87996a" />
      <path d="M980 0 C920 220 960 480 880 810 L1440 810 L1440 0 Z" fill="#2e5e74" />
      <path d="M980 0 C920 220 960 480 880 810" fill="none" stroke="#d9cba8" strokeWidth="12" opacity="0.8" />
      <g className="av-waves" stroke="#7fb2c8" strokeWidth="3" opacity="0.6" fill="none">
        <path d="M1060 160 C1090 150 1120 150 1150 160" />
        <path d="M1180 340 C1210 330 1240 330 1270 340" />
        <path d="M1020 560 C1050 550 1080 550 1110 560" />
        <path d="M1240 660 C1270 650 1300 650 1330 660" />
      </g>
      {/* hills */}
      <g fill="#7d9862" opacity="0.8">
        <ellipse cx="220" cy="160" rx="180" ry="60" />
        <ellipse cx="520" cy="120" rx="160" ry="50" />
        <ellipse cx="260" cy="700" rx="200" ry="70" />
      </g>
      <Tree x={150} y={230} r={14} /><Tree x={230} y={190} /><Tree x={620} y={640} r={13} /><Tree x={90} y={520} />
      {/* rail */}
      <path d="M0 470 C300 430 620 470 900 420" fill="none" stroke="#5d5748" strokeWidth="9" />
      <path d="M0 470 C300 430 620 470 900 420" fill="none" stroke="#d9cba8" strokeWidth="3" strokeDasharray="4 14" />
      <g className="av-train"><rect x="-46" y="-8" width="46" height="14" rx="4" fill="#31435e" /><rect x="-42" y="-5" width="10" height="7" rx="1.5" fill="#ffd98a" /><rect x="-26" y="-5" width="10" height="7" rx="1.5" fill="#ffd98a" /></g>
      {/* bridge */}
      <path d="M880 300 L1180 270" stroke="#6d6152" strokeWidth="14" fill="none" />
      <path d="M910 300 L910 268 M1000 292 L1000 250 M1090 282 L1090 246 M950 296 C1000 240 1050 240 1140 274" stroke="#4f4638" strokeWidth="4" fill="none" />
      {/* harbor cranes */}
      <g transform="translate(830 430)" fill="#b56a3c">
        <path d="M0 90 L14 90 L14 20 L54 4 L54 12 L20 26 L20 90" />
        <path d="M70 96 L84 96 L84 34 L120 20 L120 28 L90 40 L90 96" />
      </g>
      <g transform="translate(150 580)">
        <rect width="130" height="60" rx="8" fill="#d9cba8" opacity="0.9" />
        <path d="M14 30 L116 30" stroke="#8a7c5e" strokeWidth="6" strokeDasharray="10 8" />
        <text x="65" y="52" textAnchor="middle" fontSize="13" fontWeight={800} fill="#5d4a30" fontFamily="Georgia, serif" letterSpacing="2">LEGAL AIR</text>
      </g>
      <g className="av-boat"><path d="M1240 210 L1290 210 L1280 226 L1250 226 Z" fill="#37302a" /><path d="M1262 190 L1262 210 M1262 190 L1284 204 L1262 204" fill="#e6ddc6" stroke="#e6ddc6" strokeWidth="2" /></g>
    </g>
  )
}

function WorldTerrain() {
  return (
    <g>
      <rect width="1440" height="810" fill="url(#av-ocean)" />
      {/* distant continents */}
      <path d="M0 0 L340 0 C300 60 220 90 120 96 C60 100 20 80 0 60 Z" fill="#6d8a5e" opacity="0.85" />
      <path d="M1440 0 L1080 0 C1120 50 1200 84 1300 90 C1360 94 1410 76 1440 56 Z" fill="#6d8a5e" opacity="0.85" />
      <path d="M0 810 L260 810 C240 760 170 730 80 726 C40 724 10 736 0 748 Z" fill="#6d8a5e" opacity="0.7" />
      {/* sun glint */}
      <ellipse cx="720" cy="420" rx="420" ry="260" fill="#ffe9b6" opacity="0.05" />
      {/* shipping lanes */}
      <g stroke="#bfe3ea" strokeWidth="3.4" strokeDasharray="4 16" fill="none" opacity="0.65" className="av-lanes">
        <path d="M180 120 C420 260 520 380 700 380 C900 380 1050 300 1260 300" />
        <path d="M300 700 C520 640 780 660 980 560 C1100 500 1180 420 1240 330" />
        <path d="M200 160 C280 380 340 560 420 660" />
      </g>
      {/* waves */}
      <g className="av-waves" stroke="#9fd6de" strokeWidth="3.2" opacity="0.5" fill="none">
        {[[160, 260], [420, 180], [880, 160], [1180, 200], [240, 480], [620, 520], [1020, 470], [1300, 560], [420, 720], [900, 700], [1240, 730], [120, 640]].map(([x, y], i) => (
          <path key={i} className={`w-${i % 3}`} d={`M${x} ${y} C${x + 22} ${y - 8} ${x + 44} ${y - 8} ${x + 66} ${y}`} />
        ))}
      </g>
      {/* gulls */}
      <g className="av-gulls" stroke="#f2f4ef" strokeWidth="3" fill="none" strokeLinecap="round">
        <path className="g1" d="M420 120 C428 112 436 112 444 120 M444 120 C452 112 460 112 468 120" />
        <path className="g2" d="M1080 640 C1086 634 1092 634 1098 640 M1098 640 C1104 634 1110 634 1116 640" />
      </g>
      {/* compass rose */}
      <g transform="translate(1330 700)" opacity="0.6">
        <circle r="44" fill="none" stroke="#bfe3ea" strokeWidth="2" />
        <path d="M0 -40 L8 0 L0 40 L-8 0 Z" fill="#e8f4f6" />
        <path d="M-40 0 L0 -8 L40 0 L0 8 Z" fill="#9fc4cf" />
        <text y="-50" textAnchor="middle" fontSize="15" fontWeight={800} fill="#e8f4f6" fontFamily="Georgia, serif">N</text>
      </g>
      <defs>
        <linearGradient id="av-ocean" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#1e6284" />
          <stop offset="55%" stopColor="#17557d" />
          <stop offset="100%" stopColor="#0e3a58" />
        </linearGradient>
      </defs>
    </g>
  )
}

function ContinentTerrain() {
  return (
    <g>
      <rect width="1440" height="810" fill="#97a06e" />
      <path d="M1440 810 L1440 300 C1240 320 1060 400 940 520 C860 610 780 700 640 810 Z" fill="#1e5d75" />
      <path d="M1440 300 C1240 320 1060 400 940 520 C860 610 780 700 640 810" fill="none" stroke="#e8d8ae" strokeWidth="16" opacity="0.9" />
      <g className="av-waves" stroke="#7fc2ce" strokeWidth="3" opacity="0.6" fill="none">
        <path d="M1180 430 C1206 420 1232 420 1258 430" />
        <path d="M1010 600 C1036 590 1062 590 1088 600" />
        <path d="M1250 660 C1276 650 1302 650 1328 660" />
        <path d="M880 740 C906 730 932 730 958 740" />
      </g>
      {/* innovation grid */}
      <g>
        <rect x="120" y="120" width="420" height="250" rx="24" fill="#b3b18c" />
        <path d="M160 160 L500 160 M160 220 L500 220 M160 280 L500 280 M240 130 L240 350 M340 130 L340 350 M440 130 L440 350" stroke="#d9d0ac" strokeWidth="9" />
        {[[178, 172], [268, 176], [368, 230], [456, 172], [178, 292], [456, 296], [268, 296]].map(([x, y], i) => (
          <g key={i}>
            <rect x={x} y={y} width={38 + (i % 2) * 10} height={30} rx="3" fill={i % 3 ? '#8a8468' : '#7c8a74'} />
            <rect x={x + 5} y={y + 6} width={9} height={7} fill="#ffe9b6" opacity="0.85" />
            <rect x={x + 19} y={y + 6} width={9} height={7} fill="#f4e6b4" opacity="0.6" />
          </g>
        ))}
        <circle cx="330" cy="245" r="40" fill="#c9c2a4" />
        <circle cx="330" cy="245" r="40" fill="none" stroke="#8a8468" strokeWidth="4" strokeDasharray="8 8" className="av-holo-spin" />
        <circle cx="330" cy="245" r="8" fill="#7c8a74" />
      </g>
      {/* campus arc */}
      <path d="M180 560 C320 480 560 470 700 540" fill="none" stroke="#cfc19b" strokeWidth="14" opacity="0.85" />
      <Tree x={220} y={520} r={14} /><Tree x={370} y={478} /><Tree x={540} y={480} r={13} /><Tree x={660} y={520} />
      {/* wind farm */}
      <g>
        {[[840, 220], [940, 170], [1030, 260]].map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <line x1="0" y1="0" x2="0" y2="56" stroke="#e8e2cc" strokeWidth="5" strokeLinecap="round" />
            <g className="av-turbine" stroke="#f4efdd" strokeWidth="6" strokeLinecap="round">
              <line x1="0" y1="0" x2="0" y2="-30" />
              <line x1="0" y1="0" x2="26" y2="15" />
              <line x1="0" y1="0" x2="-26" y2="15" />
            </g>
            <circle r="4.5" fill="#c9c2a4" stroke="#8a8468" strokeWidth="1.5" />
          </g>
        ))}
      </g>
      <g className="av-boat"><path d="M1200 480 L1248 480 L1238 496 L1210 496 Z" fill="#37302a" /><rect x="1216" y="464" width="14" height="16" fill="#e6ddc6" /></g>
    </g>
  )
}

function SpaceTerrain() {
  return (
    <g>
      <rect width="1440" height="810" fill="url(#av-space)" />
      <ellipse cx="380" cy="180" rx="300" ry="150" fill="#2a1f4d" opacity="0.35" />
      <ellipse cx="1150" cy="620" rx="260" ry="130" fill="#1f3a4d" opacity="0.3" />
      <g className="av-stars" fill="#dfe9ff">
        {Array.from({ length: 70 }, (_, i) => (
          <circle key={i} cx={(i * 199) % 1440} cy={(i * 131) % 780} r={((i * 7) % 3) * 0.55 + 0.5} className={`tw-${i % 3}`} />
        ))}
      </g>
      <path className="av-shooting-star" d="M200 120 L268 96" stroke="#fff6d8" strokeWidth="2.4" strokeLinecap="round" />
      {/* Earth limb */}
      <g>
        <circle cx="420" cy="1120" r="560" fill="#17456b" />
        <circle cx="420" cy="1120" r="560" fill="none" stroke="#79c3f0" strokeWidth="10" opacity="0.6" />
        <circle cx="420" cy="1120" r="578" fill="none" stroke="#79c3f0" strokeWidth="3" opacity="0.3" />
        <path d="M170 640 C260 596 330 606 400 640 C470 670 560 676 640 650 L660 700 C560 740 300 740 180 700 Z" fill="#3f7a54" opacity="0.75" />
        <path d="M560 700 C650 668 750 670 830 710 L800 760 C700 740 620 738 570 748 Z" fill="#3f7a54" opacity="0.6" />
        <g fill="#ffd98a" opacity="0.9">
          {Array.from({ length: 16 }, (_, i) => (
            <circle key={i} cx={220 + ((i * 83) % 560)} cy={630 + ((i * 37) % 90)} r="2" className={`tw-${i % 3}`} />
          ))}
        </g>
        <ellipse cx="480" cy="610" rx="240" ry="36" fill="#fff" opacity="0.1" />
      </g>
      {/* moon */}
      <g transform="translate(1240 170)">
        <circle r="74" fill="#c9ced9" />
        <circle cx="-22" cy="-14" r="14" fill="#a9aeb9" />
        <circle cx="26" cy="18" r="10" fill="#a9aeb9" />
        <circle cx="6" cy="-32" r="7" fill="#b4bac6" />
        <circle cx="-30" cy="30" r="8" fill="#b4bac6" />
      </g>
      {/* orbit lanes */}
      <g stroke="#5b6e8c" strokeWidth="2" strokeDasharray="3 12" fill="none" opacity="0.65" className="av-lanes">
        <path d="M100 520 C400 380 800 320 1160 220" />
        <path d="M260 660 C600 600 980 560 1300 480" />
      </g>
      <g className="av-orbit-shuttle"><path d="M0 0 L14 4 L0 8 Z" fill="#e8eef6" /><circle cx="-3" cy="4" r="2" fill="#ffd98a" /></g>
      <defs>
        <linearGradient id="av-space" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="#060a18" />
          <stop offset="70%" stopColor="#0d1526" />
          <stop offset="100%" stopColor="#14203a" />
        </linearGradient>
      </defs>
    </g>
  )
}

export function TerrainArt({ section }: { section: string }) {
  return (
    <svg viewBox="0 0 1440 810" preserveAspectRatio="xMidYMid slice" className="av-terrain-svg" aria-hidden="true">
      {section === 'city' && <CityTerrain />}
      {section === 'nation' && <NationTerrain />}
      {section === 'world' && <WorldTerrain />}
      {section === 'continent' && <ContinentTerrain />}
      {section === 'space' && <SpaceTerrain />}
    </svg>
  )
}
