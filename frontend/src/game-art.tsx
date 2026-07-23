import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { CharacterGender, GameAsset, GameState } from './types'
import { Bust, Person, type Accessory, type Direction, type Mood } from './art/people'
import { SiteArt } from './art/structures'
import { OfficeRoom } from './art/office'
import { TerrainArt } from './art/terrains'

type OfficeSceneProps = {
  game?: GameState | null
  gender?: CharacterGender
  previewTier?: number
  className?: string
}

type Position = { x: number; y: number }

export type CharacterMood = Mood

/* ------------------------------------------------------------- cast */

const cutsceneCast: Record<string, { gender: CharacterGender; variant: number; accessory: Accessory }> = {
  rainy_shack: { gender: 'female', variant: 5, accessory: 'briefcase' },
  market_showdown: { gender: 'female', variant: 1, accessory: 'folio' },
  city_hall_night: { gender: 'female', variant: 6, accessory: 'phone' },
  sterling_tower: { gender: 'male', variant: 6, accessory: 'portfolio' },
  midnight_exchange: { gender: 'female', variant: 6, accessory: 'phone' },
  continental_forum: { gender: 'female', variant: 5, accessory: 'briefcase' },
  orbital_hearing: { gender: 'female', variant: 2, accessory: 'tablet' },
  planetary_nexus: { gender: 'female', variant: 1, accessory: 'folio' },
}

const staffPortraits: Record<string, { gender: CharacterGender; tier: number; variant: number; prop: Accessory; role: string; x: number; y: number }> = {
  paralegal: { gender: 'female', tier: 1, variant: 1, prop: 'files', role: 'MAYA · PARALEGAL', x: 25, y: 50 },
  junior_associate: { gender: 'male', tier: 2, variant: 2, prop: 'brief', role: 'THEO · ASSOCIATE', x: 59, y: 43 },
  office_manager: { gender: 'female', tier: 2, variant: 3, prop: 'clipboard', role: 'NINA · MANAGER', x: 34, y: 76 },
  senior_associate: { gender: 'female', tier: 3, variant: 4, prop: 'folio', role: 'AVERY · SENIOR', x: 65, y: 76 },
  partner: { gender: 'male', tier: 4, variant: 5, prop: 'coffee', role: 'JORDAN · PARTNER', x: 75, y: 51 },
  rainmaker: { gender: 'female', tier: 6, variant: 6, prop: 'phone', role: 'MORGAN · RAINMAKER', x: 51, y: 63 },
}

const staffProps: Accessory[] = ['files', 'brief', 'clipboard', 'folio', 'coffee', 'phone', 'tablet', 'portfolio', 'briefcase']

function keyHash(key: string) {
  return [...key].reduce((total, character) => total + character.charCodeAt(0), 0)
}

function staffProfileFor(asset: GameAsset) {
  if (staffPortraits[asset.key]) return staffPortraits[asset.key]
  const hash = keyHash(asset.key)
  return {
    gender: (hash % 2 ? 'female' : 'male') as CharacterGender,
    tier: Math.min(6, asset.tier),
    variant: (hash % 6) + 1,
    prop: staffProps[hash % staffProps.length],
    role: asset.name.toUpperCase(),
    x: 16 + (hash % 6) * 11,
    y: 44 + (hash % 3) * 15,
  }
}

const clientPortraits: Record<string, { gender: CharacterGender; tier: number; variant: number; accessory: Accessory; title: string; bg: string }> = {
  briefcase: { gender: 'female', tier: 0, variant: 7, accessory: 'briefcase', title: 'WALK-IN', bg: '#3c4a58' },
  home: { gender: 'male', tier: 1, variant: 1, accessory: 'portfolio', title: 'LOCAL REFERRAL', bg: '#2e5a52' },
  store: { gender: 'female', tier: 2, variant: 2, accessory: 'shopping-bag', title: 'FOUNDER', bg: '#7c5b3c' },
  gem: { gender: 'male', tier: 3, variant: 3, accessory: 'phone', title: 'PRIVATE CLIENT', bg: '#54406b' },
  building: { gender: 'female', tier: 4, variant: 4, accessory: 'tablet', title: 'GENERAL COUNSEL', bg: '#31435e' },
  landmark: { gender: 'male', tier: 5, variant: 5, accessory: 'folio', title: 'NATIONAL BOARD', bg: '#1c3a4a' },
  globe: { gender: 'female', tier: 6, variant: 6, accessory: 'portfolio', title: 'GLOBAL CHAIR', bg: '#25415c' },
  civic: { gender: 'female', tier: 3, variant: 2, accessory: 'files', title: 'CIVIC DIRECTOR', bg: '#4f6b62' },
  hospitality: { gender: 'male', tier: 2, variant: 5, accessory: 'clipboard', title: 'HOSPITALITY GROUP', bg: '#8a4f3a' },
  property: { gender: 'female', tier: 4, variant: 3, accessory: 'tablet', title: 'CITY BUILDER', bg: '#6d6152' },
  health: { gender: 'male', tier: 4, variant: 1, accessory: 'files', title: 'HEALTH EXECUTIVE', bg: '#2d5049' },
  media: { gender: 'female', tier: 5, variant: 4, accessory: 'phone', title: 'STUDIO CHAIR', bg: '#5e2b50' },
  tech: { gender: 'male', tier: 6, variant: 2, accessory: 'tablet', title: 'TECH FOUNDER', bg: '#1f4247' },
  sports: { gender: 'female', tier: 5, variant: 5, accessory: 'briefcase', title: 'LEAGUE COMMISSIONER', bg: '#7c4460' },
  energy: { gender: 'male', tier: 6, variant: 3, accessory: 'portfolio', title: 'GRID OPERATOR', bg: '#75513a' },
  sovereign: { gender: 'female', tier: 6, variant: 6, accessory: 'folio', title: 'SOVEREIGN DIRECTOR', bg: '#3c2f57' },
  bank: { gender: 'male', tier: 6, variant: 4, accessory: 'briefcase', title: 'CENTRAL BANKER', bg: '#123c50' },
  quantum: { gender: 'female', tier: 6, variant: 2, accessory: 'tablet', title: 'QUANTUM CHAIR', bg: '#2a3160' },
  ocean: { gender: 'male', tier: 6, variant: 5, accessory: 'portfolio', title: 'OCEANIC COUNCIL', bg: '#0e3a58' },
  orbit: { gender: 'female', tier: 6, variant: 3, accessory: 'tablet', title: 'ORBITAL DIRECTOR', bg: '#1c2438' },
  lunar: { gender: 'male', tier: 6, variant: 1, accessory: 'folio', title: 'LUNAR ENVOY', bg: '#3a3350' },
  nexus: { gender: 'female', tier: 6, variant: 6, accessory: 'portfolio', title: 'ASSEMBLY SPEAKER', bg: '#151d3d' },
}

const rivalProfiles: Record<string, { owner: string; title: string; gender: CharacterGender; tier: number; variant: number; mark: string; architecture: string }> = {
  neighborhood_practice: { owner: 'Eleanor Harrow', title: 'Founding partner', gender: 'female', tier: 2, variant: 1, mark: 'H&F', architecture: 'brick-house' },
  downtown_boutique: { owner: 'Lucien Vale', title: 'Trial strategist', gender: 'male', tier: 4, variant: 2, mark: 'V', architecture: 'art-deco' },
  regional_firm: { owner: 'Priya Nayar', title: 'Managing partner', gender: 'female', tier: 5, variant: 4, mark: '★', architecture: 'northstar' },
  national_competitor: { owner: 'Sebastian Sterling', title: 'Global chair', gender: 'male', tier: 6, variant: 6, mark: 'SG', architecture: 'mega-tower' },
  appellate_chambers: { owner: 'Inez Blackstone', title: 'Head of chambers', gender: 'female', tier: 3, variant: 3, mark: 'BC', architecture: 'gothic' },
  media_law_collective: { owner: 'Juno Gold', title: 'Creative partner', gender: 'female', tier: 4, variant: 5, mark: 'N+G', architecture: 'neon' },
  transatlantic_firm: { owner: 'Arthur Meridian', title: 'Atlantic chair', gender: 'male', tier: 6, variant: 2, mark: 'MA', architecture: 'glass-arc' },
  global_crisis_firm: { owner: 'Cass Redline', title: 'Crisis commander', gender: 'female', tier: 6, variant: 4, mark: 'R!', architecture: 'command' },
  sovereign_rival: { owner: 'Mina Crown', title: 'Sovereign counsel', gender: 'female', tier: 6, variant: 6, mark: 'CM', architecture: 'citadel' },
  continental_rival: { owner: 'Atlas Okafor', title: 'Continental chair', gender: 'male', tier: 6, variant: 3, mark: 'AJ', architecture: 'campus' },
  oceanic_rival: { owner: 'Kai Pelagic', title: 'Oceanic founder', gender: 'male', tier: 6, variant: 5, mark: 'PP', architecture: 'ocean' },
  orbital_rival: { owner: 'Yara Zenith', title: 'Orbital managing partner', gender: 'female', tier: 6, variant: 2, mark: 'ZO', architecture: 'orbital' },
  lunar_rival: { owner: 'Remy Selene', title: 'Lunar accord keeper', gender: 'male', tier: 6, variant: 4, mark: 'SA', architecture: 'lunar' },
  planetary_rival: { owner: 'Apex Council', title: 'Network stewards', gender: 'female', tier: 6, variant: 6, mark: 'AX', architecture: 'nexus' },
}

/* -------------------------------------------------------- cutscenes */

type CutsceneConfig = {
  sky: [string, string]
  ground: string
  weather?: 'rain' | 'stars'
  backdrop: React.ReactNode
}

function cutsceneConfig(scene: string): CutsceneConfig {
  switch (scene) {
    case 'market_showdown':
      return {
        sky: ['#c98d4e', '#f2d9a0'], ground: '#6d5138',
        backdrop: (
          <g>
            <g fill="#7c5335">
              <rect x="60" y="270" width="240" height="230" /><rect x="360" y="240" width="200" height="260" />
              <rect x="880" y="255" width="230" height="245" /><rect x="1160" y="285" width="180" height="215" />
            </g>
            {[80, 400, 900, 1180].map((x, i) => (
              <g key={i}>{[0, 1, 2].map((s) => <path key={s} d={`M${x + s * 62} 380 L${x + 52 + s * 62} 380 L${x + 46 + s * 62} 420 L${x + 6 + s * 62} 420 Z`} fill={s % 2 ? '#e8d8ae' : '#8a4f3a'} />)}</g>
            ))}
            <circle cx="1080" cy="150" r="52" fill="#f5c26b" opacity="0.95" />
          </g>
        ),
      }
    case 'city_hall_night':
      return {
        sky: ['#0d1526', '#25415c'], ground: '#141b28', weather: 'stars',
        backdrop: (
          <g>
            <rect x="440" y="300" width="400" height="200" fill="#26303f" />
            <path d="M520 300 C520 232 760 232 760 300 Z" fill="#31435e" />
            <path d="M632 208 L648 208 L644 240 L636 240 Z" fill="#3f5169" />
            <path d="M460 340 L460 500 M520 340 L520 500 M580 340 L580 500 M700 340 L700 500 M760 340 L760 500 M820 340 L820 500" stroke="#141b28" strokeWidth="18" />
            <path d="M320 500 L440 340 L440 500 Z M960 500 L840 340 L840 500 Z" fill="#ffe9b6" opacity="0.12" />
            <rect x="612" y="420" width="56" height="80" fill="#ffd98a" opacity="0.85" />
          </g>
        ),
      }
    case 'sterling_tower':
      return {
        sky: ['#1b1430', '#40365c'], ground: '#191524', weather: 'stars',
        backdrop: (
          <g>
            <g fill="#241f36">
              <rect x="120" y="280" width="150" height="220" /><rect x="1020" y="300" width="150" height="200" /><rect x="290" y="330" width="120" height="170" />
            </g>
            <path d="M560 500 L580 120 L700 120 L720 500 Z" fill="#0c0f16" />
            <path d="M580 120 L700 120 L698 148 L582 148 Z" fill="#c2d3e4" opacity="0.4" />
            <g fill="#9fb6cf" opacity="0.6">
              {Array.from({ length: 18 }, (_, i) => <rect key={i} x={596 + (i % 3) * 32} y={170 + Math.floor(i / 3) * 52} width="18" height="26" />)}
            </g>
            <text x="640" y="106" textAnchor="middle" fontSize="30" fontWeight={800} fill="#c2d3e4" fontFamily="Georgia, serif" letterSpacing="6">STERLING</text>
          </g>
        ),
      }
    case 'midnight_exchange':
      return {
        sky: ['#0a1420', '#173447'], ground: '#0e1a24', weather: 'stars',
        backdrop: (
          <g>
            <circle cx="1050" cy="140" r="44" fill="#e8ecf2" opacity="0.9" />
            <g fill="#b56a3c" opacity="0.9">
              <path d="M200 500 L216 500 L216 300 L330 260 L330 276 L232 310 L232 500 Z" />
              <path d="M420 500 L436 500 L436 330 L540 296 L540 312 L452 342 L452 500 Z" />
            </g>
            <g>
              {[[700, 440], [790, 440], [880, 440], [745, 384], [835, 384]].map(([x, y], i) => (
                <rect key={i} x={x} y={y} width="84" height="52" rx="3" fill={i % 2 ? '#31435e' : '#5e3838'} stroke="#0e1a24" strokeWidth="3" />
              ))}
            </g>
            <path d="M0 500 L1280 500 L1280 520 L0 520 Z" fill="#0a141c" />
          </g>
        ),
      }
    case 'continental_forum':
      return {
        sky: ['#7a5f8e', '#e8a06a'], ground: '#6d6152',
        backdrop: (
          <g>
            <path d="M340 500 L360 300 C480 240 800 240 920 300 L940 500 Z" fill="#c9c2ae" />
            <path d="M420 500 L420 330 M520 500 L520 316 M640 500 L640 310 M760 500 L760 316 M860 500 L860 330" stroke="#a89a7f" strokeWidth="26" />
            <path d="M330 300 C480 232 800 232 950 300 L950 282 C800 214 480 214 330 282 Z" fill="#8d8779" />
            {[430, 640, 850].map((x) => <path key={x} d={`M${x} 320 L${x} 400`} stroke="#8a4f3a" strokeWidth="16" />)}
            <circle cx="640" cy="196" r="12" fill="#e8c87c" />
          </g>
        ),
      }
    case 'orbital_hearing':
      return {
        sky: ['#060a18', '#101a33'], ground: '#0a1020', weather: 'stars',
        backdrop: (
          <g>
            <circle cx="640" cy="960" r="560" fill="#17456b" />
            <circle cx="640" cy="960" r="560" fill="none" stroke="#79c3f0" strokeWidth="9" opacity="0.6" />
            <ellipse cx="640" cy="220" rx="300" ry="90" fill="none" stroke="#8ea6c4" strokeWidth="16" opacity="0.9" />
            <ellipse cx="640" cy="220" rx="300" ry="90" fill="none" stroke="#ffd98a" strokeWidth="4" strokeDasharray="6 40" />
            <circle cx="640" cy="220" r="46" fill="#c9d4e4" />
            <circle cx="640" cy="220" r="20" fill="#22334e" />
          </g>
        ),
      }
    case 'planetary_nexus':
      return {
        sky: ['#060a18', '#1c1440'], ground: '#0c0a1c', weather: 'stars',
        backdrop: (
          <g>
            <path d="M640 60 L710 240 L900 280 L710 320 L640 500 L570 320 L380 280 L570 240 Z" fill="#3d4c8a" opacity="0.9" />
            <path d="M640 110 L695 250 L840 280 L695 310 L640 450 L585 310 L440 280 L585 250 Z" fill="#5d6fb4" />
            <circle cx="640" cy="280" r="30" fill="#f2ecd2" />
            <path d="M400 270 L200 220 M880 270 L1080 210 M600 460 L500 560 M680 460 L790 560" stroke="#8fa4de" strokeWidth="4" strokeDasharray="6 14" />
          </g>
        ),
      }
    default:
      return {
        sky: ['#232c3c', '#3a4256'], ground: '#20242c', weather: 'rain',
        backdrop: (
          <g>
            <g fill="#1a2232">
              <rect x="80" y="300" width="180" height="200" /><rect x="300" y="330" width="140" height="170" />
              <rect x="900" y="320" width="160" height="180" /><rect x="1100" y="290" width="140" height="210" />
            </g>
            <g fill="#ffd98a" opacity="0.5">
              <rect x="110" y="330" width="14" height="18" /><rect x="196" y="380" width="14" height="18" />
              <rect x="330" y="360" width="12" height="16" /><rect x="940" y="350" width="14" height="18" />
              <rect x="1010" y="410" width="14" height="18" /><rect x="1150" y="330" width="12" height="16" />
            </g>
            <path d="M520 500 L560 380 L700 340 L740 500 Z" fill="#3c2e1e" />
            <path d="M500 392 L710 330 L716 348 L506 410 Z" fill="#2c2013" />
            <rect x="600" y="420" width="48" height="80" fill="#ffd98a" opacity="0.8" />
            <g>
              <rect x="856" y="330" width="8" height="170" fill="#2c333f" />
              <path d="M840 330 C840 310 880 310 880 330 Z" fill="#3c4550" />
              <ellipse cx="860" cy="345" rx="58" ry="26" fill="#ffe9b6" opacity="0.2" />
            </g>
          </g>
        ),
      }
  }
}

export function CutsceneArtwork({ scene, game }: { scene: string; game: GameState }) {
  const speaker = cutsceneCast[scene] ?? cutsceneCast.rainy_shack
  const config = cutsceneConfig(scene)
  return (
    <div className={`cutscene-art av-cutscene cutscene-${scene}`} role="img" aria-label={`Illustrated campaign scene: ${scene.replaceAll('_', ' ')}`}>
      <svg viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice" className="av-cutscene-svg" aria-hidden="true">
        <defs>
          <linearGradient id={`av-cs-${scene}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={config.sky[0]} />
            <stop offset="100%" stopColor={config.sky[1]} />
          </linearGradient>
        </defs>
        <rect width="1280" height="720" fill={`url(#av-cs-${scene})`} />
        {config.weather === 'stars' && (
          <g fill="#dfe9ff">
            {Array.from({ length: 40 }, (_, i) => (
              <circle key={i} cx={(i * 167) % 1280} cy={(i * 89) % 400} r={((i * 7) % 3) * 0.5 + 0.6} className={`tw-${i % 3}`} />
            ))}
          </g>
        )}
        {config.backdrop}
        <rect x="0" y="500" width="1280" height="220" fill={config.ground} />
        <ellipse cx="640" cy="520" rx="520" ry="26" fill="rgba(255,255,255,.06)" />
        {config.weather === 'rain' && (
          <g className="av-rain" stroke="#9fb4c8" strokeWidth="2.2" opacity="0.5">
            {Array.from({ length: 60 }, (_, i) => {
              const x = 30 + (i % 20) * 64
              const y = -20 + Math.floor(i / 20) * 250 + (i % 5) * 30
              return <line key={i} x1={x} y1={y} x2={x - 14} y2={y + 46} className={`r-${i % 3}`} />
            })}
          </g>
        )}
        <rect width="1280" height="720" fill="url(#av-cs-vignette)" opacity="0.5" />
        <defs>
          <radialGradient id="av-cs-vignette" cx="50%" cy="42%" r="75%">
            <stop offset="55%" stopColor="#000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.55" />
          </radialGradient>
        </defs>
      </svg>
      <div className="av-cutscene-cast av-cutscene-speaker">
        <Person gender={speaker.gender} tier={Math.min(14, game.office_tier + 1)} variant={speaker.variant} accessory={speaker.accessory} direction="right" label="Campaign character" />
      </div>
      <div className="av-cutscene-cast av-cutscene-player">
        <Person gender={game.character_gender} tier={game.office_tier} variant={0} accessory="brief" direction="left" label={game.lawyer_name} />
      </div>
      <div className="av-cutscene-grade" />
    </div>
  )
}

/* --------------------------------------------------- asset vignettes */

function UpgradeVignette({ asset }: { asset: GameAsset }) {
  const key = asset.key
  if (key === 'repaired_desk') return (
    <g>
      <rect x="84" y="28" width="54" height="42" rx="4" fill="#2c2013" /><rect x="89" y="33" width="44" height="32" rx="2" fill="#8fbede" opacity="0.7" />
      <path d="M89 49 L133 49 M111 33 L111 65" stroke="#2c2013" strokeWidth="3" />
      <path d="M56 106 L164 106 L158 96 L62 96 Z" fill="#7b5c3a" /><rect x="62" y="106" width="96" height="26" rx="3" fill="#5d4430" />
      <path d="M150 74 L168 60 L176 68 L158 82 Z" fill="#8a5c3d" /><rect x="170" y="52" width="16" height="12" rx="2" fill="#5d6570" transform="rotate(40 178 58)" />
      <circle cx="70" cy="126" r="2.4" fill="#c9a860" /><circle cx="86" cy="130" r="2" fill="#c9a860" /><circle cx="150" cy="128" r="2.2" fill="#c9a860" />
    </g>
  )
  if (key === 'proper_lighting') return (
    <g>
      <path d="M120 30 L96 130 L188 130 L150 30 Z" fill="#ffe9a6" opacity="0.22" />
      <rect x="128" y="46" width="5" height="76" fill="#33241e" /><path d="M112 46 C112 30 150 30 150 46 Z" fill="#2e6547" />
      <ellipse className="av-lamp-glow" cx="130" cy="52" rx="30" ry="12" fill="#ffe9a6" opacity="0.45" />
      <rect x="114" y="122" width="34" height="8" rx="3" fill="#213426" />
      <path d="M42 96 C42 82 74 82 74 96 L74 122 L42 122 Z" fill="#7c4a3a" /><rect x="38" y="118" width="44" height="12" rx="4" fill="#5e3527" />
    </g>
  )
  if (key === 'case_management') return (
    <g>
      <rect x="58" y="42" width="104" height="62" rx="6" fill="#1b2330" stroke="#33404f" strokeWidth="3" />
      <path d="M70 92 L86 74 L102 84 L124 58 L146 72" fill="none" stroke="#6fe3ff" strokeWidth="4" strokeLinecap="round" className="av-chart-draw" />
      <rect x="92" y="104" width="36" height="8" rx="3" fill="#33404f" /><rect x="70" y="116" width="80" height="10" rx="4" fill="#2c3646" />
      <rect x="164" y="88" width="26" height="38" rx="3" fill="#e5c98f" /><path d="M168 96 L186 96 M168 104 L186 104 M168 112 L182 112" stroke="#a8834e" strokeWidth="2.4" />
    </g>
  )
  if (key === 'legal_library') return (
    <g>
      <rect x="42" y="26" width="136" height="104" rx="6" fill="#4a3524" />
      {[0, 1, 2].map((s) => (
        <g key={s}>{[0, 1, 2, 3, 4, 5, 6].map((b) => (
          <rect key={b} x={52 + b * 17} y={38 + s * 30 - ((b + s) % 3) * 3} width="13" height={22 + ((b + s) % 3) * 3} rx="1.5" fill={['#7c4a3a', '#3d5c54', '#2c4a68', '#8d6f45', '#5b4675'][(b + s) % 5]} />
        ))}<rect x={46} y={60 + s * 30} width="128" height="5" fill="#5d4430" /></g>
      ))}
      <path d="M186 130 L176 36 L182 36 L192 130 Z" fill="#8a6a45" /><path d="M178 52 L188 52 M176 76 L189 76 M175 100 L190 100" stroke="#5d4430" strokeWidth="3" />
    </g>
  )
  if (key === 'conference_room') return (
    <g>
      <rect x="36" y="30" width="66" height="46" rx="4" fill="#8fbede" opacity="0.8" /><path d="M36 53 L102 53 M69 30 L69 76" stroke="#2c2013" strokeWidth="4" />
      <ellipse cx="110" cy="106" rx="72" ry="20" fill="#5d4430" /><ellipse cx="110" cy="100" rx="72" ry="20" fill="#7b5c3a" />
      {[[48, 84], [88, 76], [132, 76], [172, 84]].map(([x, y], i) => <rect key={i} x={x} y={y} width="18" height="22" rx="5" fill="#33241e" />)}
      <path className="av-steam-line" d="M110 88 C113 83 108 79 111 74" stroke="#dcd5c4" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </g>
  )
  if (key === 'research_floor') return (
    <g>
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${44 + i * 34} 40)`}>
          <rect width="26" height="88" rx="4" fill="#1c2430" />
          <circle cx="8" cy="12" r="2.6" fill="#6fe3ff" className={`av-blink b-${i}`} /><circle cx="18" cy="12" r="2.6" fill="#ffd98a" className={`av-blink b-${(i + 1) % 3}`} />
          <path d="M5 26 L21 26 M5 38 L21 38 M5 50 L21 50 M5 62 L21 62" stroke="#31435e" strokeWidth="3" />
        </g>
      ))}
      <rect x="148" y="52" width="44" height="32" rx="4" fill="#101830" stroke="#31436b" strokeWidth="2.4" />
      <path d="M154 74 L164 62 L172 68 L184 56" fill="none" stroke="#6fe3ff" strokeWidth="3" strokeLinecap="round" />
    </g>
  )
  if (key === 'executive_suite') return (
    <g>
      <g fill="#2c3350">
        <rect x="34" y="38" width="24" height="52" /><rect x="66" y="24" width="30" height="66" /><rect x="104" y="44" width="22" height="46" /><rect x="134" y="30" width="28" height="60" /><rect x="170" y="48" width="20" height="42" />
      </g>
      <g fill="#ffd98a" opacity="0.8">{Array.from({ length: 14 }, (_, i) => <rect key={i} x={40 + ((i * 37) % 148)} y={36 + ((i * 23) % 48)} width="4" height="5" />)}</g>
      <path d="M52 118 L168 118 L160 106 L60 106 Z" fill="#5d4430" />
      <circle cx="164" cy="88" r="14" fill="none" stroke="#c89b4b" strokeWidth="3" /><ellipse cx="164" cy="88" rx="14" ry="5.5" fill="none" stroke="#c89b4b" strokeWidth="2" />
    </g>
  )
  return (
    <g>
      <ellipse cx="110" cy="118" rx="64" ry="10" fill="#101830" />
      <path d="M70 118 L80 92 L140 92 L150 118 Z" fill="#22304e" stroke="#31436b" strokeWidth="2" />
      <circle cx="110" cy="66" r="22" fill="#101830" stroke="#6fe3ff" strokeWidth="2.4" className="av-core-pulse" />
      <text x="110" y="73" textAnchor="middle" fontSize="18" fill="#9adcef" fontFamily="Georgia, serif">{asset.tier >= 12 ? '✦' : asset.tier >= 8 ? '◇' : '§'}</text>
      <circle className="av-holo-spin" cx="110" cy="66" r="30" fill="none" stroke="#6fe3ff" strokeWidth="1.4" strokeDasharray="4 9" opacity="0.7" />
      <text x="110" y="140" textAnchor="middle" fontSize="10.5" fontWeight={800} fill="#79c3f0" fontFamily="Georgia, serif" letterSpacing="2">{(asset.art ?? 'future system').replace('-', ' ').toUpperCase()}</text>
    </g>
  )
}

function ConnectionVignette({ asset }: { asset: GameAsset }) {
  const nodes = Math.min(8, 3 + Math.floor(asset.tier / 2))
  return (
    <g>
      <circle cx="110" cy="76" r="52" fill="none" stroke="#3f5975" strokeWidth="2" strokeDasharray="4 8" className="av-holo-spin" />
      <circle cx="110" cy="76" r="30" fill="none" stroke="#3f5975" strokeWidth="1.6" opacity="0.7" />
      {Array.from({ length: nodes }, (_, i) => {
        const angle = (i / nodes) * Math.PI * 2 - Math.PI / 2
        const r = i % 2 ? 52 : 30
        const x = 110 + Math.cos(angle) * r
        const y = 76 + Math.sin(angle) * r * 0.9
        return (
          <g key={i}>
            <line x1="110" y1="76" x2={x} y2={y} stroke="#31435e" strokeWidth="1.6" opacity="0.8" />
            <circle cx={x} cy={y} r="7" fill="#22374a" stroke="#7fb4c9" strokeWidth="1.8" />
            <circle cx={x} cy={y} r="2.4" fill="#ffd98a" className={`av-blink b-${i % 3}`} />
          </g>
        )
      })}
      <circle cx="110" cy="76" r="14" fill="#c89b4b" />
      <text x="110" y="82" textAnchor="middle" fontSize="15" fontWeight={800} fill="#2c2013" fontFamily="Georgia, serif">{asset.tier >= 12 ? '☾' : asset.tier >= 7 ? '✦' : '⚖'}</text>
    </g>
  )
}

export function PixelAssetArtwork({ asset }: { asset: GameAsset }) {
  const state = asset.owned ? 'owned' : asset.available ? 'available' : 'locked'
  const profile = asset.type === 'rival' ? (rivalProfiles[asset.key] ?? rivalProfiles.neighborhood_practice) : null
  const staff = asset.type === 'staff' ? staffProfileFor(asset) : null
  return (
    <div className={`pixel-asset-art av-vignette asset-${asset.type} asset-${state}`} role="img" aria-label={`${asset.name} illustration`}>
      {asset.type === 'staff' && staff ? (
        <div className="av-vignette-stage">
          <div className="av-vignette-backwall" />
          <Person gender={staff.gender} tier={staff.tier} variant={staff.variant} accessory={staff.prop} label={asset.name} className="av-vignette-person" />
        </div>
      ) : asset.type === 'rival' && profile ? (
        <>
          <SiteArt kind="rival" tier={asset.tier} architecture={profile.architecture} mark={profile.mark} owned={asset.owned} />
          <div className="av-vignette-owner">
            <Bust gender={profile.gender} variant={profile.variant} tier={profile.tier} backdrop="none" />
            <span><strong>{profile.owner}</strong><small>{profile.title}</small></span>
          </div>
        </>
      ) : (
        <svg viewBox="0 0 220 150" className="av-vignette-svg" aria-hidden="true">
          {asset.type === 'upgrade' ? <UpgradeVignette asset={asset} /> : <ConnectionVignette asset={asset} />}
        </svg>
      )}
      {state === 'locked' && <div className="av-vignette-lock"><span>?</span></div>}
      {state === 'owned' && <div className="av-vignette-owned">✓</div>}
      <span className="asset-art-label av-vignette-label">
        {asset.type === 'upgrade' ? 'OFFICE UPGRADE' : asset.type === 'staff' ? 'TEAM MEMBER' : asset.type === 'connection' ? 'NEW CONTACTS' : 'ACQUISITION'}
      </span>
    </div>
  )
}

/* -------------------------------------------------------- portraits */

export function ClientPortrait({
  kind = 'briefcase',
  name,
  mood = 'neutral',
  className = '',
}: {
  kind?: string
  name: string
  mood?: CharacterMood
  className?: string
}) {
  const profile = clientPortraits[kind] ?? clientPortraits.briefcase
  return (
    <div className={`client-portrait av-portrait client-${kind} mood-${mood} ${className}`} aria-label={`${name}, ${profile.title.toLowerCase()}, ${mood}`} role="img">
      <Bust gender={profile.gender} variant={profile.variant} tier={profile.tier} mood={mood} backdrop={profile.bg} />
      <b>{['globe', 'orbit', 'lunar', 'nexus', 'quantum'].includes(kind) ? '✦' : name.slice(0, 1)}</b>
      <small>{profile.title}</small>
    </div>
  )
}

export function JudgePortrait({ thinking = false, pleased = false }: { thinking?: boolean; pleased?: boolean }) {
  return (
    <div className={`judge-portrait av-judge ${thinking ? 'is-thinking' : ''} ${pleased ? 'is-pleased' : ''}`} aria-hidden="true">
      <Bust gender="female" variant={3} judge mood={pleased ? 'happy' : 'neutral'} backdrop="#2c2438" />
      <span className="av-judge-gavel">⚖</span>
      <span className="av-judge-state">{pleased ? '✓' : thinking ? '…' : '§'}</span>
    </div>
  )
}

export function MiniAvatar({ gender, tier = 0 }: { gender: CharacterGender; tier?: number }) {
  return <div className="mini-avatar av-mini-avatar"><Person gender={gender} tier={tier} variant={0} /></div>
}

/* ----------------------------------------------------------- walker */

function useWalker(initial: Position, bounds: { left: number; right: number; top: number; bottom: number }) {
  const [position, setPosition] = useState(initial)
  const [direction, setDirection] = useState<Direction>('down')
  const [walking, setWalking] = useState(false)
  const stopTimer = useRef<number | null>(null)

  const nudge = useCallback((nextDirection: Direction) => {
    const amount = 2.8
    setDirection(nextDirection)
    setWalking(true)
    setPosition((current) => ({
      x: Math.max(bounds.left, Math.min(bounds.right, current.x + (nextDirection === 'left' ? -amount : nextDirection === 'right' ? amount : 0))),
      y: Math.max(bounds.top, Math.min(bounds.bottom, current.y + (nextDirection === 'up' ? -amount : nextDirection === 'down' ? amount : 0))),
    }))
    if (stopTimer.current) window.clearTimeout(stopTimer.current)
    stopTimer.current = window.setTimeout(() => setWalking(false), 220)
  }, [bounds.bottom, bounds.left, bounds.right, bounds.top])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
      const keyMap: Record<string, Direction> = {
        ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down',
        ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right',
      }
      const nextDirection = keyMap[event.key]
      if (!nextDirection) return
      event.preventDefault()
      nudge(nextDirection)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [nudge])

  useEffect(() => () => {
    if (stopTimer.current) window.clearTimeout(stopTimer.current)
  }, [])

  return { position, setPosition, direction, walking, nudge }
}

/* ------------------------------------------------------- the office */

function OfficeBackdrop({ game, gender = 'female', previewTier, children }: OfficeSceneProps & { children?: React.ReactNode }) {
  const tier = previewTier ?? game?.office_tier ?? 0
  const owned = useMemo(() => new Set(game?.owned_assets ?? []), [game?.owned_assets])
  const staff = (game?.catalog.assets ?? [])
    .filter((asset) => asset.type === 'staff' && owned.has(asset.key))
    .slice(-10)
    .map((asset) => ({ key: asset.key, ...staffProfileFor(asset) }))
  const activeClient = game?.catalog.clients.find((client) => client.key === game.active_client.effective_key)
  const clientProfile = clientPortraits[activeClient?.icon ?? 'briefcase'] ?? clientPortraits.briefcase

  return (
    <div className={`av-office office-tier-${tier}`} data-tier={tier}>
      <OfficeRoom tier={tier} owned={owned} />
      <div className="av-firm-sign"><strong>{game?.firm_name ?? 'COUNSEL & CO.'}</strong><span>ATTORNEYS AT LAW</span></div>
      {staff.map((member) => (
        <div className={`world-person npc-person npc-${member.key}`} key={member.key} style={{ left: `${member.x}%`, top: `${member.y}%` }}>
          <Person gender={member.gender} tier={member.tier} variant={member.variant} accessory={member.prop} label={member.role} />
          <span className="wp-label">{member.role}</span>
        </div>
      ))}
      <div className={`world-person client-person world-client-${activeClient?.icon ?? 'briefcase'}`} style={{ left: '74%', top: '82%' }}>
        <div className="quest-bubble">!</div>
        <Person gender={clientProfile.gender} tier={clientProfile.tier} variant={clientProfile.variant} accessory={clientProfile.accessory} label={activeClient?.name ?? 'Waiting client'} />
        <span className="wp-label">{clientProfile.title}</span>
      </div>
      {!children && (
        <div className="world-person preview-lawyer" style={{ left: '51%', top: '74%' }}>
          <Person gender={game?.character_gender ?? gender} tier={tier} variant={0} label="Your lawyer" />
        </div>
      )}
      {children}
      <div className="av-office-vignette" />
      <div className="scene-caption av-scene-caption"><span>FIRM TIER {tier}</span><strong>{game?.office.name ?? (tier === 0 ? 'Wooden Shack' : 'Future Headquarters')}</strong></div>
    </div>
  )
}

export function OfficeScene(props: OfficeSceneProps) {
  return <div className={`office-scene av-scene ${props.className ?? ''}`}><OfficeBackdrop {...props} /></div>
}

export function ExplorableOffice({
  game,
  activeCase,
  onCase,
  onFirm,
  onEmpire,
  onStory,
  onCollect,
}: {
  game: GameState
  activeCase: boolean
  onCase: () => void
  onFirm: () => void
  onEmpire: () => void
  onStory: () => void
  onCollect: () => void
}) {
  const walker = useWalker({ x: 51, y: 79 }, { left: 5, right: 94, top: 31, bottom: 87 })
  const zones = useMemo(() => [
    { key: 'case', x: 74, y: 76, label: activeCase ? 'Resume the active case' : 'Meet your waiting client', detail: `${game.active_client.name} · ${game.active_client.base_fee.toLocaleString()} base fee`, action: onCase },
    { key: 'firm', x: 15, y: 51, label: 'Manage the firm', detail: 'Upgrades · staff · clients', action: onFirm },
    { key: 'empire', x: 89, y: 48, label: 'Enter the empire map', detail: 'Explore offices and rivals', action: onEmpire },
    { key: 'story', x: 29, y: 34, label: 'Open the caseboard', detail: game.story.active_quest ? game.story.active_quest.title : 'Campaign · quests · rival intelligence', action: onStory },
    { key: 'retainers', x: 23, y: 82, label: 'Open the retainer safe', detail: `${game.passive_income.available.toLocaleString()} ready`, action: onCollect },
  ], [activeCase, game.active_client.base_fee, game.active_client.name, game.passive_income.available, game.story.active_quest, onCase, onCollect, onEmpire, onFirm, onStory])
  const activeZone = zones.find((zone) => Math.hypot((walker.position.x - zone.x) * 1.2, walker.position.y - zone.y) < 12)

  useEffect(() => {
    const interact = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'e' || !activeZone) return
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      activeZone.action()
    }
    window.addEventListener('keydown', interact)
    return () => window.removeEventListener('keydown', interact)
  }, [activeZone])

  return (
    <div className="office-explorer game-viewport av-viewport" aria-label="Explorable law office">
      <OfficeBackdrop game={game}>
        {zones.map((zone) => (
          <button
            key={zone.key}
            className={`world-zone zone-${zone.key} ${activeZone?.key === zone.key ? 'is-near' : ''}`}
            style={{ left: `${zone.x}%`, top: `${zone.y}%` }}
            onClick={zone.action}
            aria-label={`${zone.label}. ${zone.detail}`}
          >
            <i />
            <span><b>{zone.label}</b><small>{zone.detail}</small></span>
          </button>
        ))}
        <div className="world-person player-person" style={{ left: `${walker.position.x}%`, top: `${walker.position.y}%` }}>
          <Person gender={game.character_gender} tier={game.office_tier} direction={walker.direction} walking={walker.walking} label={`${game.lawyer_name}, player character`} />
          <span className="wp-label">{game.lawyer_name.split(' ')[0]}</span>
        </div>
      </OfficeBackdrop>
      <div className="world-objective">
        <span>ACTIVE QUEST</span>
        <strong>{activeCase ? 'Finish your argument' : 'A client is waiting'}</strong>
        <small>Walk to the <b>!</b> or click it to begin.</small>
      </div>
      <div className={`interaction-toast ${activeZone ? 'visible' : ''}`}>
        <kbd>E</kbd><span><strong>{activeZone?.label ?? 'Explore the office'}</strong><small>{activeZone?.detail ?? 'Move near a glowing marker'}</small></span>
      </div>
      <WorldControls nudge={walker.nudge} />
    </div>
  )
}

function WorldControls({ nudge }: { nudge: (direction: Direction) => void }) {
  return (
    <div className="world-controls" aria-label="Movement controls">
      <span>MOVE</span>
      <button onClick={() => nudge('up')} aria-label="Move up">▲</button>
      <button onClick={() => nudge('left')} aria-label="Move left">◀</button>
      <button onClick={() => nudge('down')} aria-label="Move down">▼</button>
      <button onClick={() => nudge('right')} aria-label="Move right">▶</button>
      <small>WASD / ARROWS</small>
    </div>
  )
}

/* ------------------------------------------------------- empire map */

const mapSections = [
  { key: 'city', scale: 'CITY MAP', name: 'THE CITY', districts: 'OLD QUARTER → FINANCIAL DISTRICT', detail: 'Street courts, civic halls and downtown towers', minTier: 0, maxTier: 4 },
  { key: 'nation', scale: 'NATIONAL MAP', name: 'THE NATION', districts: 'HARBOR EXCHANGE → MIDTOWN CROWN', detail: 'Regional branches and national headquarters', minTier: 5, maxTier: 6 },
  { key: 'world', scale: 'WORLD MAP', name: 'THE OPEN SEA', districts: 'EMBASSY ROW → SOVEREIGN ENCLAVE', detail: 'Global counsel sails aboard flagship firms', minTier: 7, maxTier: 9 },
  { key: 'continent', scale: 'CONTINENTAL MAP', name: 'THE CONTINENT', districts: 'INNOVATION ARC → AZURE COAST', detail: 'Continental campuses and oceanic citadels', minTier: 10, maxTier: 11 },
  { key: 'space', scale: 'PLANETARY MAP', name: 'BEYOND EARTH', districts: 'EARTH ORBIT → LUNAR GATE → JUSTICE NEXUS', detail: 'Stations, embassies and the justice constellation', minTier: 12, maxTier: 14 },
] as const

type MapSection = (typeof mapSections)[number]

function mapSectionForTier(tier: number): MapSection {
  return mapSections.find((section) => tier >= section.minTier && tier <= section.maxTier) ?? mapSections[0]
}

const siteLayouts: Record<MapSection['key'], { tier: Position[]; rival: Position[] }> = {
  city: {
    tier: [{ x: 14, y: 72 }, { x: 31, y: 55 }, { x: 48, y: 74 }, { x: 66, y: 54 }, { x: 84, y: 71 }],
    rival: [{ x: 22, y: 30 }, { x: 43, y: 23 }, { x: 63, y: 31 }, { x: 84, y: 24 }],
  },
  nation: {
    tier: [{ x: 56, y: 68 }, { x: 30, y: 38 }],
    rival: [{ x: 22, y: 72 }, { x: 46, y: 22 }],
  },
  world: {
    tier: [{ x: 24, y: 54 }, { x: 52, y: 38 }, { x: 78, y: 62 }],
    rival: [{ x: 36, y: 72 }, { x: 64, y: 22 }, { x: 88, y: 40 }],
  },
  continent: {
    tier: [{ x: 30, y: 40 }, { x: 67, y: 70 }],
    rival: [{ x: 16, y: 70 }, { x: 78, y: 50 }],
  },
  space: {
    tier: [{ x: 26, y: 38 }, { x: 84, y: 26 }, { x: 55, y: 60 }],
    rival: [{ x: 13, y: 64 }, { x: 68, y: 14 }, { x: 40, y: 80 }],
  },
}

function sectionPosition(sectionKey: MapSection['key'], kind: 'tier' | 'rival', index: number): Position {
  const layout = siteLayouts[sectionKey]
  const list = kind === 'tier' ? layout.tier : layout.rival
  return list[index % list.length] ?? { x: 20 + index * 20, y: kind === 'tier' ? 60 : 26 }
}

export function EmpireWorldMap({ game, onManage }: { game: GameState; onManage: (tab: 'upgrades' | 'rivals') => void }) {
  const rivals = game.catalog.assets.filter((asset) => asset.type === 'rival')
  const tierPoints = mapSections.flatMap((section) => {
    const tiers = game.catalog.tiers.filter((tier) => tier.tier >= section.minTier && tier.tier <= section.maxTier)
    return tiers.map((tier, index) => ({ key: `tier-${tier.tier}`, kind: 'tier' as const, sectionKey: section.key, position: sectionPosition(section.key, 'tier', index), data: tier }))
  })
  const rivalPoints = mapSections.flatMap((section) => {
    const sectionRivals = rivals.filter((rival) => rival.tier >= section.minTier && rival.tier <= section.maxTier)
    return sectionRivals.map((rival, index) => ({ key: `rival-${rival.key}`, kind: 'rival' as const, sectionKey: section.key, position: sectionPosition(section.key, 'rival', index), data: rival }))
  })
  const points = [...tierPoints, ...rivalPoints]
  const initialSection = mapSectionForTier(game.office_tier)
  const initialPoint = tierPoints.find((point) => point.key === `tier-${game.office_tier}`) ?? tierPoints[0]
  const initial = initialPoint.position
  const walker = useWalker({ x: initial.x, y: Math.min(86, initial.y + 10) }, { left: 4, right: 96, top: 12, bottom: 89 })
  const [selected, setSelected] = useState(`tier-${game.office_tier}`)
  const [activeSectionKey, setActiveSectionKey] = useState<MapSection['key']>(initialSection.key)
  const activePoints = points.filter((point) => point.sectionKey === activeSectionKey)
  const nearby = activePoints.find((point) => Math.hypot((walker.position.x - point.position.x) * 1.15, walker.position.y - point.position.y) < 11)
  const selectedPoint = points.find((point) => point.key === selected) ?? points[0]
  const selectedRivalProfile = selectedPoint.kind === 'rival' ? (rivalProfiles[selectedPoint.data.key] ?? rivalProfiles.neighborhood_practice) : null
  const activeSection = mapSections.find((section) => section.key === activeSectionKey) ?? mapSections[0]
  const hqSection = initialSection

  const jumpToSection = (section: MapSection) => {
    setActiveSectionKey(section.key)
    const sectionPoints = points.filter((point) => point.sectionKey === section.key)
    const currentSelection = sectionPoints.find((point) => point.key === selected)
    const currentHq = sectionPoints.find((point) => point.key === `tier-${game.office_tier}`)
    const destination = currentSelection ?? currentHq ?? sectionPoints[0]
    if (!destination) return
    setSelected(destination.key)
    walker.setPosition({ x: destination.position.x, y: Math.min(86, destination.position.y + 10) })
  }

  useEffect(() => {
    const interact = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'e' || !nearby) return
      event.preventDefault()
      setSelected(nearby.key)
    }
    window.addEventListener('keydown', interact)
    return () => window.removeEventListener('keydown', interact)
  }, [nearby])

  return (
    <div className="empire-map-shell av-map-shell">
      <nav className="map-section-nav" aria-label="Empire map sections">
        {mapSections.map((section, index) => {
          const siteCount = points.filter((point) => point.sectionKey === section.key).length
          return (
            <button
              type="button"
              className={`${activeSection.key === section.key ? 'active' : ''} ${hqSection.key === section.key ? 'contains-hq' : ''}`}
              aria-pressed={activeSection.key === section.key}
              onClick={() => jumpToSection(section)}
              key={section.key}
            >
              <small>{String(index + 1).padStart(2, '0')}</small>
              <span><strong>{section.name}</strong><em>{section.scale}</em></span>
              <b>{siteCount} SITES</b>
            </button>
          )
        })}
      </nav>
      <div className="empire-explorer game-viewport av-viewport" aria-label="Explorable legal empire map">
        <div className={`av-terrain av-terrain-${activeSection.key}`} key={activeSection.key}>
          <TerrainArt section={activeSection.key} />
          <div className="map-area-identity av-map-identity" aria-hidden="true">
            <small>{activeSection.scale}</small><strong>{activeSection.name}</strong><span>{activeSection.districts}</span><em>{activeSection.detail}</em>
          </div>
          {tierPoints.filter((point) => point.sectionKey === activeSection.key).map(({ data: tier, position }) => {
            const status = tier.tier < game.office_tier ? 'complete' : tier.tier === game.office_tier ? 'current' : 'future'
            return (
              <button
                className={`empire-node av-node tier-map-node ${status} ${selected === `tier-${tier.tier}` ? 'is-selected' : ''} ${nearby?.key === `tier-${tier.tier}` ? 'is-near' : ''}`}
                key={tier.tier}
                style={{ left: `${position.x}%`, top: `${position.y}%` }}
                onClick={() => setSelected(`tier-${tier.tier}`)}
                aria-label={`${tier.name}, tier ${tier.tier}, ${status}`}
              >
                <SiteArt kind="tier" tier={tier.tier} />
                <span><b>{tier.name}</b><small>TIER {tier.tier} · {status === 'complete' ? 'ESTABLISHED' : status === 'current' ? 'HEADQUARTERS' : 'FUTURE'}</small></span>
              </button>
            )
          })}
          {rivalPoints.filter((point) => point.sectionKey === activeSection.key).map(({ data: rival, position }) => {
            const profile = rivalProfiles[rival.key] ?? rivalProfiles.neighborhood_practice
            return (
              <button
                className={`empire-node av-node rival-map-node ${rival.owned ? 'owned' : ''} ${selected === `rival-${rival.key}` ? 'is-selected' : ''} ${nearby?.key === `rival-${rival.key}` ? 'is-near' : ''}`}
                key={rival.key}
                style={{ left: `${position.x}%`, top: `${position.y}%` }}
                onClick={() => setSelected(`rival-${rival.key}`)}
                aria-label={`${rival.name.replace('Acquire ', '')}, ${rival.owned ? 'acquired' : 'rival firm'}`}
              >
                <SiteArt kind="rival" tier={rival.tier} architecture={profile.architecture} mark={profile.mark} owned={rival.owned} />
                <span><b>{rival.name.replace('Acquire ', '')}</b><small>{rival.owned ? 'ACQUIRED' : 'RIVAL FIRM'}</small></span>
              </button>
            )
          })}
          <div className="world-person map-player" style={{ left: `${walker.position.x}%`, top: `${walker.position.y}%` }}>
            <Person gender={game.character_gender} tier={game.office_tier} direction={walker.direction} walking={walker.walking} label={`${game.lawyer_name}, map explorer`} />
          </div>
        </div>
        <div className="map-legend av-map-legend"><span><i className="legend-owned" />OWNED</span><span><i className="legend-current" />HQ</span><span><i className="legend-rival" />RIVAL</span></div>
        <div className="empire-inspector av-inspector">
          <span>{selectedPoint.kind === 'tier' ? 'FIRM DESTINATION' : 'ACQUISITION TARGET'}</span>
          <h2>{selectedPoint.data.name.replace('Acquire ', '')}</h2>
          <small className="inspector-region">{selectedPoint.data.region}</small>
          {selectedRivalProfile && (
            <div className="rival-owner-inspector av-owner-chip">
              <Bust gender={selectedRivalProfile.gender} variant={selectedRivalProfile.variant} tier={selectedRivalProfile.tier} backdrop="#1a2735" />
              <span><small>RIVAL OWNER</small><strong>{selectedRivalProfile.owner}</strong><i>{selectedRivalProfile.title}</i></span>
            </div>
          )}
          <p>{selectedPoint.kind === 'tier' ? selectedPoint.data.short : selectedPoint.data.description}</p>
          <div>
            <b>${selectedPoint.data.cost.toLocaleString()}</b>
            <b>★ {selectedPoint.data.reputation} REP</b>
          </div>
          <button className="pixel-action av-inspector-action" onClick={() => onManage(selectedPoint.kind === 'tier' ? 'upgrades' : 'rivals')}>
            {selectedPoint.kind === 'tier' ? 'MANAGE OFFICE' : 'VIEW ACQUISITION'} <i>›</i>
          </button>
        </div>
        <div className={`interaction-toast map-interaction ${nearby ? 'visible' : ''}`}><kbd>E</kbd><span><strong>Inspect destination</strong><small>{nearby?.data.name ?? 'Walk near a landmark'}</small></span></div>
        <WorldControls nudge={walker.nudge} />
      </div>
    </div>
  )
}
