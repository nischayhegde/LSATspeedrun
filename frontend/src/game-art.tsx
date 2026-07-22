import type { CharacterGender, GameState } from './types'

type OfficeSceneProps = {
  game?: GameState | null
  gender?: CharacterGender
  previewTier?: number
  className?: string
}

function LawyerFigure({ gender, tier, x = 560, y = 310 }: { gender: CharacterGender; tier: number; x?: number; y?: number }) {
  const jacket = tier === 0 ? '#35404d' : tier < 3 ? '#25364a' : tier < 5 ? '#15243a' : tier === 5 ? '#171c30' : '#071927'
  const shirt = tier === 0 ? '#d9d1c1' : tier === 6 ? '#fff4d9' : '#fffaf1'
  const accent = tier < 4 ? '#b65c49' : tier === 6 ? '#e0bd68' : '#c89b4a'
  return (
    <g className="lawyer-sprite" transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy="222" rx="72" ry="18" fill="rgba(15,20,29,.20)" />
      <path d="M-42 89 Q0 66 42 89 L55 198 Q18 218 -55 198Z" fill={jacket} />
      {tier >= 5 && <path d="M-38 91 L-12 133 0 112 12 133 38 91" fill="none" stroke={tier === 6 ? '#d7b35f' : '#55627a'} strokeWidth="3" opacity=".85" />}
      {tier === 6 && <circle cx="31" cy="119" r="5" fill="#e0bd68" stroke="#fff1c8" strokeWidth="2" />}
      <path d="M-22 82 L0 124 22 82 16 72 -16 72Z" fill={shirt} />
      <path d="M-4 101 L4 101 11 150 0 160 -11 150Z" fill={accent} />
      <path d="M-42 92 Q-70 128 -68 173 L-48 175 -22 116Z" fill={jacket} />
      <path d="M42 92 Q70 128 68 173 L48 175 22 116Z" fill={jacket} />
      <circle cx="-58" cy="179" r="12" fill="#b97855" />
      <circle cx="58" cy="179" r="12" fill="#b97855" />
      <path d="M-36 198 L-18 198 -17 268 -43 268Z" fill="#202b38" />
      <path d="M18 198 L36 198 43 268 17 268Z" fill="#202b38" />
      <path d="M-46 263 L-15 263 -12 278 -51 278Z" fill="#151a21" />
      <path d="M15 263 L46 263 51 278 12 278Z" fill="#151a21" />
      {gender === 'female' && (
        <path d="M-40 44 Q-53-18 -7-31 Q43-35 43 28 L36 80 -34 80 -43 46Z" fill="#3a2927" />
      )}
      <rect x="-15" y="58" width="30" height="28" rx="10" fill="#b97855" />
      <ellipse cx="0" cy="30" rx="39" ry="48" fill="#c98b67" />
      <path d="M-16 40 Q0 49 16 40" fill="none" stroke="#7d463b" strokeWidth="3" strokeLinecap="round" />
      <circle cx="-14" cy="25" r="3.2" fill="#25303b" />
      <circle cx="14" cy="25" r="3.2" fill="#25303b" />
      {gender === 'female' ? (
        <>
          <path d="M-31 5 Q-5-24 33-1 Q20-39-15-26 Q-39-17-31 5Z" fill="#4b332e" />
          <path d="M-40 19 Q-51 49-34 78" fill="none" stroke="#3a2927" strokeWidth="14" strokeLinecap="round" />
          <path d="M40 15 Q50 51 33 79" fill="none" stroke="#3a2927" strokeWidth="14" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M-36 7 Q-30-31 8-28 Q39-25 38 11 Q18-4-5-5 Q-22 7-36 7Z" fill="#352724" />
          <path d="M-31-3 Q-5-38 30-10" fill="none" stroke="#4b332e" strokeWidth="13" strokeLinecap="round" />
        </>
      )}
      {tier === 0 && (
        <>
          <path d="M-51 139 l20-9 8 18-23 10Z" fill="#7f6a54" opacity=".95" />
          <path d="M17 214 l17-8 4 20-18 6Z" fill="#655a50" />
        </>
      )}
    </g>
  )
}

function StaffFigure({ role, x, y, color }: { role: string; x: number; y: number; color: string }) {
  return (
    <g className="staff-sprite" transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy="128" rx="37" ry="9" fill="rgba(15,20,29,.18)" />
      <path d="M-25 48 Q0 34 25 48 L31 112 -31 112Z" fill={color} />
      <path d="M-18 111 H-2 L-5 137 H-23Z" fill="#27313c" />
      <path d="M2 111 H18 L23 137 H5Z" fill="#27313c" />
      <ellipse cx="0" cy="22" rx="25" ry="29" fill="#d19a74" />
      <path d="M-24 17 Q-20-16 7-13 Q29-9 24 20 Q7 5-24 17Z" fill="#44302c" />
      <circle cx="-8" cy="22" r="2" fill="#28333c" />
      <circle cx="8" cy="22" r="2" fill="#28333c" />
      <rect x="-34" y="46" width="68" height="18" rx="9" fill="rgba(255,255,255,.94)" />
      <text x="0" y="59" textAnchor="middle" fontSize="10" fontWeight="800" fill="#293444">{role}</text>
    </g>
  )
}

export function OfficeScene({ game, gender = 'female', previewTier, className = '' }: OfficeSceneProps) {
  const tier = previewTier ?? game?.office_tier ?? 0
  const owned = new Set(game?.owned_assets ?? [])
  const wall = tier === 0 ? '#594a3a' : tier < 3 ? '#e6dfd0' : tier < 5 ? '#dce4e5' : tier === 5 ? '#cad8df' : '#e2e8e9'
  const sky = tier < 2 ? '#344b62' : tier < 4 ? '#d88968' : tier < 6 ? '#6a8ba7' : '#315d78'
  return (
    <div className={`office-scene ${className}`} data-tier={tier}>
      <svg viewBox="0 0 1200 650" role="img" aria-labelledby="office-title office-desc" preserveAspectRatio="xMidYMid slice">
        <title id="office-title">{game?.firm_name ?? 'Your future law firm'}</title>
        <desc id="office-desc">A living two-dimensional office scene that improves as the firm grows.</desc>
        <defs>
          <linearGradient id="scene-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={sky} />
            <stop offset="1" stopColor={tier === 0 ? '#1a2837' : '#f2bb86'} />
          </linearGradient>
          <linearGradient id="scene-floor" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor={tier === 0 ? '#6c5037' : tier < 4 ? '#9d7554' : tier < 6 ? '#6c7b82' : '#66757d'} />
            <stop offset="1" stopColor={tier === 0 ? '#3a2a21' : tier < 4 ? '#5e4435' : tier < 6 ? '#35444d' : '#172b37'} />
          </linearGradient>
          <radialGradient id="lamp-glow">
            <stop stopColor="#ffd98a" stopOpacity=".78" />
            <stop offset="1" stopColor="#ffd98a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="desk-wood" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor={tier === 0 ? '#825b36' : '#a66b3f'} />
            <stop offset="1" stopColor={tier === 0 ? '#4f3524' : '#664029'} />
          </linearGradient>
          <pattern id="wood-lines" width="90" height="24" patternUnits="userSpaceOnUse">
            <rect width="90" height="24" fill={wall} />
            <path d="M0 23 H90 M18 0 V23 M68 0 V23" stroke="rgba(31,23,18,.18)" strokeWidth="2" />
          </pattern>
          <filter id="soft-shadow" x="-30%" y="-30%" width="160%" height="180%">
            <feDropShadow dx="0" dy="12" stdDeviation="12" floodColor="#101820" floodOpacity=".3" />
          </filter>
          <filter id="scene-blur"><feGaussianBlur stdDeviation="16" /></filter>
        </defs>

        <rect width="1200" height="650" fill={tier === 0 ? 'url(#wood-lines)' : wall} />
        {tier > 0 && <path d="M0 0 H1200 V68 H0Z" fill={tier > 3 ? '#263b4b' : '#c7bca7'} />}

        <g className="window-view">
          <rect x={tier === 0 ? 765 : 690} y="76" width={tier === 0 ? 300 : 430} height="265" rx={tier === 0 ? 4 : 10} fill="#24303b" />
          <rect x={tier === 0 ? 779 : 705} y="91" width={tier === 0 ? 270 : 400} height="235" fill="url(#scene-sky)" />
          <circle cx="1009" cy="139" r="32" fill="#f7d69b" opacity=".75" />
          <g fill={tier < 3 ? '#283a48' : '#405867'}>
            <path d="M704 326 V233 H755 V326ZM761 326V194H824V326ZM831 326V249H886V326ZM894 326V167H966V326ZM974 326V221H1036V326ZM1044 326V180H1105V326Z" />
          </g>
          <g fill="#efc568" opacity=".72">
            {[735, 788, 918, 1001, 1072].map((x) => <rect key={x} x={x} y="252" width="7" height="10" rx="1" />)}
          </g>
          <path d={`M${tier === 0 ? 914 : 904} 91 V326`} stroke="#26313a" strokeWidth="14" />
          <path d="M705 209 H1105" stroke="#26313a" strokeWidth="12" />
          {tier === 0 && (
            <g className="rain-lines" stroke="#bdd6e9" strokeWidth="3" opacity=".7">
              <path d="M810 98 l-25 67 M864 113 l-24 65 M1002 99 l-28 72 M1065 128 l-24 61" />
            </g>
          )}
        </g>

        {tier === 0 ? (
          <>
            <path d="M0 48 H760" stroke="#34291f" strokeWidth="18" />
            <path d="M126 0 V373 M498 0 V373" stroke="#3a2c22" strokeWidth="20" opacity=".84" />
            <path d="M0 368 H1200" stroke="#35281e" strokeWidth="17" />
            <path d="M57 72 l92 36-18 54-99-29Z" fill="#40576b" opacity=".75" />
            <text x="91" y="121" textAnchor="middle" fontFamily="Georgia,serif" fontSize="22" fill="#f0e4c9" transform="rotate(12 91 121)">LAW OFFICE</text>
          </>
        ) : (
          <>
            <path d="M0 350 H1200" stroke={tier > 3 ? '#8a9aa2' : '#b3a58f'} strokeWidth="14" />
            <rect x="52" y="90" width="330" height="190" rx="6" fill={tier > 3 ? '#263b4b' : '#f5efe2'} stroke="#c59c56" strokeWidth="8" />
            <text x="217" y="165" textAnchor="middle" fontFamily="Georgia,serif" fontSize="34" fill={tier > 3 ? '#f4e9d2' : '#26323a'}>{game?.firm_name ?? 'COUNSEL'}</text>
            <path d="M121 194 H313" stroke="#c59c56" strokeWidth="3" />
            <text x="217" y="229" textAnchor="middle" fontSize="15" fontWeight="800" letterSpacing="4" fill={tier > 3 ? '#b9c8cf' : '#76634c'}>ATTORNEYS AT LAW</text>
          </>
        )}

        <path d="M0 366 L1200 366 1200 650 0 650Z" fill="url(#scene-floor)" />
        <g opacity=".22" stroke="#f4d7a6" strokeWidth="3">
          <path d="M0 433 H1200 M0 522 H1200 M0 615 H1200" />
          <path d="M200 366 L75 650 M470 366 L410 650 M740 366 L805 650 M1010 366 L1144 650" />
        </g>
        {tier >= 2 && <ellipse cx="600" cy="535" rx="330" ry="83" fill={tier > 4 ? '#183c55' : '#7a2f35'} opacity=".82" />}

        {tier >= 5 && (
          <g className="scene-prop" transform="translate(431 101)" filter="url(#soft-shadow)">
            <rect width="211" height="151" rx="8" fill={tier === 6 ? '#102d3d' : '#f4f0e6'} stroke="#c69a4c" strokeWidth="5" />
            {tier === 5 ? (
              <>
                <path d="M35 91 Q63 39 91 77 T145 55 T180 88" fill="none" stroke="#426d83" strokeWidth="5" />
                <circle cx="35" cy="91" r="7" fill="#c69a4c" /><circle cx="91" cy="77" r="7" fill="#c69a4c" /><circle cx="145" cy="55" r="7" fill="#c69a4c" /><circle cx="180" cy="88" r="7" fill="#c69a4c" />
                <text x="106" y="126" textAnchor="middle" fontSize="11" fontWeight="800" letterSpacing="2" fill="#365263">NATIONAL NETWORK</text>
              </>
            ) : (
              <>
                <circle cx="106" cy="66" r="42" fill="#315d78" stroke="#e2c06f" strokeWidth="3" />
                <path d="M64 66 H148 M106 24 Q78 65 106 108 M106 24 Q134 65 106 108 M72 43 Q106 57 140 43 M72 89 Q106 75 140 89" fill="none" stroke="#d4e3e8" strokeWidth="2" opacity=".9" />
                <text x="106" y="132" textAnchor="middle" fontSize="11" fontWeight="900" letterSpacing="2" fill="#f0cf7c">GLOBAL COUNSEL</text>
              </>
            )}
          </g>
        )}

        {(owned.has('legal_library') || tier >= 3) && (
          <g className="scene-prop" filter="url(#soft-shadow)">
            <rect x="45" y="181" width="265" height="245" rx="5" fill="#493121" />
            {[220, 282, 344].map((y) => <rect key={y} x="59" y={y} width="237" height="9" fill="#2e2119" />)}
            {Array.from({ length: 18 }).map((_, index) => (
              <rect key={index} x={67 + (index % 6) * 37} y={194 + Math.floor(index / 6) * 62} width={24 + (index % 2) * 4} height="27" rx="2" fill={['#9d493d', '#355d65', '#b78542', '#49527b'][index % 4]} />
            ))}
          </g>
        )}

        <g className="desk-group" filter="url(#soft-shadow)">
          <ellipse cx="605" cy="567" rx="250" ry="36" fill="rgba(20,21,24,.25)" />
          <path d="M352 444 Q600 410 851 444 L821 508 Q602 535 382 508Z" fill="url(#desk-wood)" />
          <path d="M384 503 H450 L432 604 H381Z M756 503 H822 L826 604 H769Z" fill="#4b3021" />
          {tier === 0 && !owned.has('repaired_desk') && <path d="M543 432 l56 72 39-82" fill="none" stroke="#342116" strokeWidth="8" />}
          {(owned.has('case_management') || tier >= 2) && (
            <g>
              <rect x="679" y="369" width="126" height="84" rx="7" fill="#202a32" />
              <rect x="689" y="378" width="106" height="63" rx="3" fill="#8ec8d1" />
              <path d="M727 454 H755 L766 473 H716Z" fill="#28343c" />
              <circle cx="743" cy="411" r="15" fill="#f2d28a" opacity=".55" />
            </g>
          )}
          <g transform="translate(451 392)">
            <rect x="-4" y="36" width="52" height="12" rx="4" fill="#26333b" />
            <path d="M8 37 V-10 Q10-29 29-29 Q48-29 48-10" fill="none" stroke="#594531" strokeWidth="8" />
            <path d="M24-31 h38 l-8 28H31Z" fill="#d49c44" />
            <ellipse className="lamp-halo" cx="43" cy="-2" rx="91" ry="80" fill="url(#lamp-glow)" />
          </g>
          <g transform="translate(545 414)">
            <rect width="79" height="14" rx="2" fill="#efe6d2" transform="rotate(-4)" />
            <rect x="7" y="15" width="86" height="13" rx="2" fill="#d7c8a8" transform="rotate(3)" />
            <rect x="-10" y="30" width="73" height="12" rx="2" fill="#f5eddc" transform="rotate(-2)" />
          </g>
        </g>

        <LawyerFigure gender={game?.character_gender ?? gender} tier={tier} x={600} y={256} />

        {owned.has('paralegal') && <StaffFigure role="PARALEGAL" x={260} y={390} color="#7d4c67" />}
        {owned.has('junior_associate') && <StaffFigure role="ASSOCIATE" x={885} y={385} color="#375a70" />}
        {owned.has('senior_associate') && <StaffFigure role="SENIOR" x={1015} y={404} color="#563f67" />}
        {owned.has('partner') && <StaffFigure role="PARTNER" x={120} y={405} color="#273d57" />}

        <g className="client-sprite" transform="translate(1140 380)">
          <ellipse cx="0" cy="177" rx="49" ry="12" fill="rgba(18,24,30,.18)" />
          <path d="M-31 74 Q0 51 31 74 L38 158 -38 158Z" fill="#8d5845" />
          <ellipse cx="0" cy="43" rx="30" ry="35" fill="#ddb08b" />
          <path d="M-30 36 Q-22 1 11 8 Q37 14 27 45 Q9 26-30 36Z" fill="#6b5547" />
          <rect x="-23" y="153" width="18" height="34" fill="#363b42" />
          <rect x="5" y="153" width="18" height="34" fill="#363b42" />
          <g className="case-ready-bubble">
            <circle cx="-4" cy="-18" r="31" fill="#f6c85a" />
            <path d="M-10 7 l10 22 8-25" fill="#f6c85a" />
            <path d="M-16-20 h24 v17h-24Z M-9-27 h10 v7h-10Z" fill="none" stroke="#47361d" strokeWidth="4" strokeLinejoin="round" />
          </g>
        </g>

        {tier >= 4 && (
          <g className="scene-prop" transform="translate(350 322)">
            <path d="M0 58 Q29 5 58 58" fill="#2d7658" />
            <path d="M30 61 Q3 10-8 45 M31 60 Q61 7 72 43 M27 58 Q26 8 38-3" fill="none" stroke="#3f936e" strokeWidth="12" strokeLinecap="round" />
            <path d="M5 58 H62 L52 111 H15Z" fill="#b07c52" />
          </g>
        )}
      </svg>
      <div className="scene-vignette" />
      {game && (
        <div className="scene-caption">
          <span>FIRM TIER {game.office_tier}</span>
          <strong>{game.office.name}</strong>
        </div>
      )}
    </div>
  )
}

export function MiniAvatar({ gender, tier = 0 }: { gender: CharacterGender; tier?: number }) {
  return (
    <svg className="mini-avatar" viewBox="-72 -40 144 330" aria-hidden="true">
      <LawyerFigure gender={gender} tier={tier} x={0} y={0} />
    </svg>
  )
}
