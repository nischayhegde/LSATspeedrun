// Vector cast: full-body figures and portrait busts with human proportions.
// Person viewBox: 0 0 72 132 (figure ≈ 7.5 heads tall). Bust viewBox: 0 0 96 96.

import type { CharacterGender } from '../types'
import { eyeFor, hairFor, outfitFor, skinFor, type HairTone, type Outfit, type SkinTone } from './palette'

export type Direction = 'up' | 'down' | 'left' | 'right'
export type Mood = 'happy' | 'unhappy' | 'neutral'
export type Accessory =
  | 'none' | 'files' | 'brief' | 'clipboard' | 'folio' | 'coffee' | 'phone'
  | 'briefcase' | 'shopping-bag' | 'tablet' | 'portfolio'

export type PersonProps = {
  gender?: CharacterGender
  tier?: number
  variant?: number
  direction?: Direction
  walking?: boolean
  accessory?: Accessory
  mood?: Mood
  className?: string
  label?: string
}

const CHEST_PROPS: Accessory[] = ['files', 'brief', 'clipboard', 'folio', 'coffee', 'phone', 'tablet', 'portfolio']
const HAND_PROPS: Accessory[] = ['briefcase', 'shopping-bag']

const SHIRT_SHADE = '#d9d2bf'
const SHOE = '#221a14'
const SHOE_SHINE = '#4a3b30'
const HEEL = '#2b1d24'
const SCLERA = '#fdfcf7'
const PUPIL = '#151517'
const LIP_M = '#9c5b4c'
const BRASS = '#c89b4b'

function femaleWearsSkirt(variant: number) {
  return variant % 2 === 0
}

/* ---------------------------------------------------------------- face */

function FrontFace({ skin, hair, eye, gender, mood, variant }: {
  skin: SkinTone; hair: HairTone; eye: string; gender: CharacterGender; mood: Mood; variant: number
}) {
  const browL = mood === 'unhappy' ? 'M31 8.9 C32 8.9 33.3 9 34.3 9.5' : 'M31 9.4 C32 8.7 33.3 8.6 34.3 9'
  const browR = mood === 'unhappy' ? 'M37.7 9.5 C38.7 9 40 8.9 41 8.9' : 'M37.7 9 C38.7 8.6 40 8.7 41 9.4'
  const mouth = gender === 'female'
    ? mood === 'happy'
      ? 'M33.7 17 C34.5 16.6 35.3 16.7 36 17 C36.7 16.7 37.5 16.6 38.3 17 C37.8 18.7 36.9 19.4 36 19.4 C35.1 19.4 34.2 18.7 33.7 17 Z'
      : mood === 'unhappy'
        ? 'M34.1 18.4 C34.7 17.8 35.4 17.6 36 17.6 C36.6 17.6 37.3 17.8 37.9 18.4 C37.4 18.8 36.7 19 36 19 C35.3 19 34.6 18.8 34.1 18.4 Z'
        : 'M33.9 17.2 C34.7 16.7 35.5 16.8 36 17.15 C36.5 16.8 37.3 16.7 38.1 17.2 C37.7 18.5 36.9 19 36 19 C35.1 19 34.3 18.5 33.9 17.2 Z'
    : null
  const mouthStroke = mood === 'happy'
    ? 'M33.8 17.2 C35 18.9 37 18.9 38.2 17.2'
    : mood === 'unhappy'
      ? 'M34 18.4 C35.3 17.5 36.7 17.5 38 18.4'
      : 'M34 17.7 C35.3 18.4 36.7 18.4 38 17.7'
  const glasses = (gender === 'male' && variant === 2) || (gender === 'female' && variant === 6)
  return (
    <g className="av-face">
      <path d={browL} fill="none" stroke={hair.shade} strokeWidth="1.05" strokeLinecap="round" />
      <path d={browR} fill="none" stroke={hair.shade} strokeWidth="1.05" strokeLinecap="round" />
      <path d="M31.1 11.5 C31.7 10.6 33.3 10.5 34 11.4 C33.4 12.4 31.8 12.5 31.1 11.5 Z" fill={SCLERA} />
      <path d="M37.9 11.4 C38.6 10.5 40.2 10.6 40.8 11.5 C40.1 12.5 38.5 12.4 37.9 11.4 Z" fill={SCLERA} />
      <circle cx="32.6" cy="11.5" r="0.95" fill={eye} />
      <circle cx="39.35" cy="11.5" r="0.95" fill={eye} />
      <circle cx="32.6" cy="11.5" r="0.45" fill={PUPIL} />
      <circle cx="39.35" cy="11.5" r="0.45" fill={PUPIL} />
      <circle cx="32.3" cy="11.1" r="0.26" fill="white" />
      <circle cx="39.05" cy="11.1" r="0.26" fill="white" />
      <path d="M31 11.2 C31.8 10.3 33.4 10.2 34.1 11.1" fill="none" stroke="#2a2019" strokeWidth="0.65" strokeLinecap="round" />
      <path d="M37.85 11.1 C38.55 10.2 40.15 10.3 40.95 11.2" fill="none" stroke="#2a2019" strokeWidth="0.65" strokeLinecap="round" />
      <path d="M36.1 12.6 C36.35 13.7 36.5 14.6 36.15 15.3 C35.9 15.75 35.3 15.7 35.1 15.35" fill="none" stroke={skin.shade} strokeWidth="0.65" strokeLinecap="round" />
      {mouth
        ? <path d={mouth} fill="#b8574f" />
        : <path d={mouthStroke} fill="none" stroke={LIP_M} strokeWidth="0.95" strokeLinecap="round" />}
      <ellipse cx="31.4" cy="14.7" rx="1.5" ry="0.85" fill={skin.blush} opacity={gender === 'female' ? 0.3 : 0.14} />
      <ellipse cx="40.6" cy="14.7" rx="1.5" ry="0.85" fill={skin.blush} opacity={gender === 'female' ? 0.3 : 0.14} />
      {glasses && (
        <g stroke="#22303c" strokeWidth="0.7" fill="rgba(255,255,255,.14)">
          <rect x="29.9" y="10" width="4.5" height="3" rx="1.4" />
          <rect x="37.6" y="10" width="4.5" height="3" rx="1.4" />
          <path d="M34.4 11.2 L37.6 11.2" fill="none" />
        </g>
      )}
    </g>
  )
}

/* ---------------------------------------------------------------- hair */

type HairArt = { back?: string; front: string; shine?: string; bun?: [number, number, number] }

const MALE_HAIR: HairArt[] = [
  { front: 'M27.2 11.2 C26.6 5 30.4 1.6 36 1.6 C41.6 1.6 45.4 5.2 44.8 11.6 C44.2 9.2 43.4 7.8 42.2 7 C40.4 8 37.6 8.3 34.6 7.6 C32 7 30.4 7.6 29.4 8.6 C28.4 9.5 27.7 10.2 27.2 11.2 Z', shine: 'M30.6 4.4 C32.6 3.2 34.8 2.8 37 3' },
  { front: 'M27.3 10.6 C26.8 4.8 30.6 1.8 36 1.8 C41.4 1.8 45.2 4.8 44.7 10.6 C44 8.2 43 7.1 41.6 6.7 L30.4 6.7 C29 7.1 28 8.2 27.3 10.6 Z', shine: 'M31.4 4 C33.2 3.2 35.4 3 37.4 3.3' },
  { front: 'M27.2 10.4 C26.6 4.4 30.2 1.4 36 1.4 C41.8 1.4 45.4 4.4 44.8 10.4 C44.4 7.6 43.6 6.4 42.6 5.8 C40.6 4.9 38.4 4.6 36 4.6 C33.6 4.6 31.4 4.9 29.4 5.8 C28.4 6.4 27.6 7.6 27.2 10.4 Z', shine: 'M30.2 3.8 C32.2 2.7 34.6 2.4 36.8 2.6' },
  { front: 'M27.4 10.8 C25.6 6.4 28 3 30.6 3 C31 1.6 33 0.8 34.6 1.6 C35.6 0.4 38.4 0.4 39.4 1.6 C41 0.8 43 1.6 43.4 3 C46 3 48.4 6.4 44.6 10.8 C43.8 8.6 42.8 7.6 41.4 7.2 C37.8 8.4 34.2 8.4 30.6 7.2 C29.2 7.6 28.2 8.6 27.4 10.8 Z' },
  { front: 'M27.3 10.6 C26.8 5 30 2 34.6 1.2 C38.2 0.6 41.8 1.4 43.6 3.4 C45.4 5.2 45.4 8 44.7 10.8 C44 8.4 43.2 7.2 42 6.6 C40 8.2 36.4 8.6 33.2 7.4 C30.8 6.6 29 7.6 27.3 10.6 Z', shine: 'M31.8 3.4 C33.8 2.4 36.4 2.2 38.6 2.8' },
  { front: 'M27.5 9.6 C27.2 4.6 30.8 2.2 36 2.2 C41.2 2.2 44.8 4.6 44.5 9.6 C43.9 7 42.6 5.8 41 5.4 L31 5.4 C29.4 5.8 28.1 7 27.5 9.6 Z' },
  { front: 'M27.2 11.2 C26.6 5 30.4 1.6 36 1.6 C41.6 1.6 45.4 5.2 44.8 11.6 C44.2 9.2 43.4 7.8 42.2 7 C40.4 8 37.6 8.3 34.6 7.6 C32 7 30.4 7.6 29.4 8.6 C28.4 9.5 27.7 10.2 27.2 11.2 Z', shine: 'M30.6 4.4 C32.6 3.2 34.8 2.8 37 3' },
]

const FEMALE_HAIR: HairArt[] = [
  {
    back: 'M26.4 14 C24.6 7 29 1.2 36 1.2 C43 1.2 47.4 7 45.6 14 C45 16.6 44.2 18.4 43.2 19.6 L28.8 19.6 C27.8 18.4 27 16.6 26.4 14 Z',
    front: 'M27.1 12 C26.2 5 30.2 1.6 36 1.6 C41.8 1.6 45.8 5 44.9 12 C44.4 9 43.4 7.4 41.8 6.6 C38.6 8.6 32.6 8.8 29.8 7 C28.6 8 27.6 9.8 27.1 12 Z',
    shine: 'M30.2 4.2 C32.2 3 34.6 2.6 36.8 2.9',
    bun: [45.4, 16.6, 3.3],
  },
  {
    back: 'M26.8 12.6 C25.4 5.4 29.8 1.4 36 1.4 C42.2 1.4 46.6 5.4 45.2 12.6 C44.8 16.6 45 20 45.8 23 C42.6 24.9 40 25.1 38.2 24 L33.8 24 C32 25.1 29.4 24.9 26.2 23 C27 20 27.2 16.6 26.8 12.6 Z',
    front: 'M27.2 11.8 C26.4 5.2 30.4 1.8 36 1.8 C41.6 1.8 45.6 5.2 44.8 11.8 C44.2 8.8 43 7.2 41.4 6.6 C40.2 7.6 38.6 8 37.2 7.6 C36.6 6.6 35.4 6.6 34.8 7.6 C33.4 8 31.8 7.6 30.6 6.6 C29 7.2 27.8 8.8 27.2 11.8 Z',
    shine: 'M30 4.4 C32 3.2 34.4 2.8 36.6 3',
  },
  {
    back: 'M26.2 12.6 C24.4 5.4 29.2 1.2 36 1.2 C42.8 1.2 47.6 5.4 45.8 12.6 C46.6 17.6 47.2 22.6 46.6 27 C46.2 30.4 45.2 33 43.6 34.8 C42.4 33.6 42 32.2 42.2 30.6 C41 32 40.2 33.8 40.4 36 L31.6 36 C31.8 33.8 31 32 29.8 30.6 C30 32.2 29.6 33.6 28.4 34.8 C26.8 33 25.8 30.4 25.4 27 C24.8 22.6 25.4 17.6 26.2 12.6 Z',
    front: 'M27.1 12 C26.2 5 30.2 1.6 36 1.6 C41.8 1.6 45.8 5 44.9 12 C44.5 9.2 43.6 7.5 42.2 6.7 C39.8 8.3 36.6 8.7 33.9 7.7 C31.6 6.9 29.4 7.7 28.4 9 C27.9 9.9 27.4 10.9 27.1 12 Z',
    shine: 'M29.8 4.4 C31.8 3.1 34.2 2.7 36.4 2.9',
  },
  {
    back: 'M27 11.8 C26.6 5.4 30.4 2 36 2 C41.6 2 45.4 5.4 45 11.8 C44.8 14.8 44.2 17.2 43.2 19 L28.8 19 C27.8 17.2 27.2 14.8 27 11.8 Z',
    front: 'M27.2 11 C26.6 4.6 30.4 1.8 36 1.8 C41.6 1.8 45.4 4.6 44.8 11 C43.8 7.4 41.4 5.6 36 5.6 C30.6 5.6 28.2 7.4 27.2 11 Z',
    bun: [36, 1.6, 4],
    shine: 'M32.4 3 C34.4 2.4 36.8 2.4 38.6 3',
  },
  {
    back: 'M26.9 12 C26.4 5.6 30.3 2 36 2 C41.7 2 45.6 5.6 45.1 12 C44.9 14.9 44.3 17.3 43.3 19.1 L28.7 19.1 C27.7 17.3 27.1 14.9 26.9 12 Z M44 8 C47.6 10 48.8 14.6 47.6 19.4 C46.8 22.6 45.4 25.4 43.4 27.4 C42.4 26 42 24.4 42.4 22.6 C43.6 18 43.4 13 41.6 9.4 Z',
    front: 'M27.2 11 C26.6 4.6 30.4 1.8 36 1.8 C41.6 1.8 45.4 4.6 44.8 11 C43.8 7.4 41.4 5.8 36 5.8 C30.6 5.8 28.2 7.4 27.2 11 Z',
    shine: 'M32.2 3.2 C34.2 2.6 36.6 2.6 38.4 3.2',
  },
  {
    front: 'M27.3 10.9 C26.5 5 30 1.4 34.8 1.2 C38.6 1 42.2 2 43.8 4.2 C45.4 6.2 45.3 8.6 44.7 11 C44 8.6 43 7.4 41.6 6.9 C39.6 8.4 36.2 8.7 33.2 7.6 C30.9 6.8 28.8 8 27.3 10.9 Z',
    shine: 'M31.4 3.4 C33.4 2.5 35.8 2.3 37.8 2.9',
  },
  {
    back: 'M26.6 12.6 C25.2 5.6 29.6 1.4 36 1.4 C42.4 1.4 46.8 5.6 45.4 12.6 C45.2 17.4 45.6 21.6 46.6 25.2 C43.6 27.4 40.9 27.6 38.6 26.2 L33.4 26.2 C31.1 27.6 28.4 27.4 25.4 25.2 C26.4 21.6 26.8 17.4 26.6 12.6 Z',
    front: 'M27.2 11.8 C26.4 5.2 30.4 1.8 36 1.8 C41.6 1.8 45.6 5.2 44.8 11.8 C44.3 9 43.3 7.3 41.8 6.6 C39.4 8.2 36.3 8.6 33.6 7.6 C31.4 6.8 29.2 7.6 28.3 9 C27.8 9.9 27.4 10.8 27.2 11.8 Z',
    shine: 'M30 4.4 C32 3.2 34.4 2.8 36.6 3',
  },
]

function hairArtFor(gender: CharacterGender, variant: number): HairArt {
  const list = gender === 'female' ? FEMALE_HAIR : MALE_HAIR
  return list[((variant % list.length) + list.length) % list.length]
}

/* ------------------------------------------------------- held props */

function ChestProp({ accessory }: { accessory: Accessory }) {
  switch (accessory) {
    case 'files':
      return (
        <g className="av-prop">
          <rect x="32.5" y="38.6" width="10.4" height="7.6" rx="0.7" fill="#e9ddc0" stroke="#b9a279" strokeWidth="0.5" transform="rotate(-4 37.7 42.4)" />
          <rect x="33.2" y="37.2" width="10.4" height="7.6" rx="0.7" fill="#f4ecd8" stroke="#c3b18c" strokeWidth="0.5" transform="rotate(3 38.4 41)" />
          <path d="M35.4 39.6 L41.4 39.9 M35.3 41.4 L41.3 41.7 M35.2 43.2 L40 43.4" stroke="#a89571" strokeWidth="0.55" />
        </g>
      )
    case 'brief':
      return (
        <g className="av-prop">
          <rect x="33" y="38" width="10.6" height="7.8" rx="0.8" fill="#e5c98f" stroke="#a8834e" strokeWidth="0.6" />
          <path d="M33 40 L38 40 L39 38.6 L43.6 38.6" fill="none" stroke="#a8834e" strokeWidth="0.6" />
        </g>
      )
    case 'clipboard':
      return (
        <g className="av-prop">
          <rect x="33.4" y="37.6" width="9.4" height="9.4" rx="0.9" fill="#8a6844" />
          <rect x="34.4" y="38.6" width="7.4" height="7.4" rx="0.5" fill="#f6f1e2" />
          <rect x="36.6" y="36.8" width="3" height="1.8" rx="0.7" fill="#b9c1c9" />
          <path d="M35.4 40.4 L40.6 40.4 M35.4 42 L40.6 42 M35.4 43.6 L39 43.6" stroke="#9aa4ad" strokeWidth="0.55" />
        </g>
      )
    case 'folio':
      return (
        <g className="av-prop">
          <rect x="33" y="38.2" width="10.8" height="7.6" rx="1" fill="#4a3046" stroke="#2e1c2c" strokeWidth="0.6" />
          <path d="M33 41.8 L43.8 41.8" stroke={BRASS} strokeWidth="0.55" />
          <circle cx="41.9" cy="40" r="0.7" fill={BRASS} />
        </g>
      )
    case 'coffee':
      return (
        <g className="av-prop">
          <path d="M34.4 41.2 L39.2 41.2 L38.7 46.2 L34.9 46.2 Z" fill="#f4efe4" stroke="#c9bfa9" strokeWidth="0.5" />
          <rect x="34.2" y="41" width="5.2" height="1.3" rx="0.5" fill="#7c5b3c" />
          <path className="av-steam" d="M35.8 39.6 C36.3 38.8 35.7 38.2 36.2 37.4 M37.6 39.6 C38.1 38.8 37.5 38.2 38 37.4" stroke="#dcd5c4" strokeWidth="0.6" fill="none" strokeLinecap="round" />
        </g>
      )
    case 'phone':
      return (
        <g className="av-prop">
          <rect x="35" y="39" width="3.4" height="6.2" rx="0.8" fill="#141a24" stroke="#2c3746" strokeWidth="0.5" />
          <rect x="35.5" y="39.7" width="2.4" height="4.4" rx="0.3" fill="#8fd8ef" opacity="0.9" />
        </g>
      )
    case 'tablet':
      return (
        <g className="av-prop">
          <rect x="32.6" y="38.4" width="10.6" height="7.4" rx="1" fill="#1b2330" stroke="#33404f" strokeWidth="0.6" />
          <rect x="33.5" y="39.3" width="8.8" height="5.6" rx="0.4" fill="#9adcef" opacity="0.9" />
          <path d="M34.4 40.6 L39.6 40.6 M34.4 42 L41.4 42 M34.4 43.4 L38.4 43.4" stroke="#2e6f83" strokeWidth="0.5" />
        </g>
      )
    case 'portfolio':
      return (
        <g className="av-prop">
          <rect x="32.2" y="37.6" width="11.6" height="8.6" rx="1.1" fill="#37281f" stroke="#211710" strokeWidth="0.6" />
          <rect x="36.9" y="40.6" width="2.2" height="2.4" rx="0.4" fill={BRASS} />
        </g>
      )
    default:
      return null
  }
}

function HandProp({ accessory }: { accessory: Accessory }) {
  if (accessory === 'briefcase') {
    return (
      <g className="av-prop">
        <path d="M45.3 60.4 C45.3 59.4 46.1 58.8 47.2 58.8 C48.3 58.8 49.1 59.4 49.1 60.4" fill="none" stroke="#3c2717" strokeWidth="0.9" />
        <rect x="41.6" y="60.2" width="11.2" height="8.6" rx="1.4" fill="#5a3a26" stroke="#38220f" strokeWidth="0.7" />
        <path d="M41.6 63.4 L52.8 63.4" stroke="#38220f" strokeWidth="0.6" />
        <rect x="44" y="62.5" width="1.7" height="1.7" rx="0.3" fill={BRASS} />
        <rect x="48.7" y="62.5" width="1.7" height="1.7" rx="0.3" fill={BRASS} />
      </g>
    )
  }
  if (accessory === 'shopping-bag') {
    return (
      <g className="av-prop">
        <path d="M45.6 60.6 C45.6 59.2 46.4 58.4 47.4 58.4 C48.4 58.4 49.2 59.2 49.2 60.6" fill="none" stroke="#8a4a63" strokeWidth="0.8" />
        <path d="M42.4 60.4 L52.4 60.4 L51.6 70 L43.2 70 Z" fill="#b06183" stroke="#7c3c57" strokeWidth="0.6" />
        <path d="M45.4 63.4 C46.6 64.6 48.2 64.6 49.4 63.4" fill="none" stroke="#f0d9e2" strokeWidth="0.7" />
      </g>
    )
  }
  return null
}

/* --------------------------------------------------------- figures */

function FrontFigure({ gender, skin, hair, eye, outfit, tier, variant, accessory, mood, back }: {
  gender: CharacterGender; skin: SkinTone; hair: HairTone; eye: string; outfit: Outfit
  tier: number; variant: number; accessory: Accessory; mood: Mood; back: boolean
}) {
  const hairArt = hairArtFor(gender, variant)
  const skirt = gender === 'female' && femaleWearsSkirt(variant)
  const hero = variant === 0
  const chestProp = !back && CHEST_PROPS.includes(accessory)
  const handProp = !back && HAND_PROPS.includes(accessory)

  const legs = skirt ? (
    <>
      <g className="av-leg av-leg-l">
        <path d="M30.2 82.6 L34.6 82.6 C34.8 92 34.8 101 34.6 110 C34.5 114 34.4 117.4 34.4 120.2 L31 120.2 C30.7 117.4 30.5 114 30.4 110 C30.2 101 30 92 30.2 82.6 Z" fill={skin.base} />
        <path d="M30.6 119.8 L34.4 119.8 C34.9 121.2 35 122.6 34.8 124 C34.7 125.2 33.9 125.8 32.7 125.8 L29.9 125.8 C29.1 124.4 29 122.9 29.4 121.6 Z" fill={HEEL} />
        <path d="M33.5 125.8 L34.5 125.8 L34.4 128 L33.7 128 Z" fill={HEEL} />
      </g>
      <g className="av-leg av-leg-r">
        <path d="M37.4 82.6 L41.8 82.6 C42 92 41.8 101 41.6 110 C41.5 114 41.4 117.4 41.4 120.2 L37.6 120.2 C37.6 117.4 37.5 114 37.4 110 C37.2 101 37.2 92 37.4 82.6 Z" fill={skin.base} />
        <path d="M37.6 119.8 L41.4 119.8 C41.9 121.2 42 122.6 41.8 124 C41.7 125.2 40.9 125.8 39.7 125.8 L36.9 125.8 C36.1 124.4 36 122.9 36.4 121.6 Z" fill={HEEL} />
        <path d="M40.5 125.8 L41.5 125.8 L41.4 128 L40.7 128 Z" fill={HEEL} />
      </g>
    </>
  ) : (
    <>
      <g className="av-leg av-leg-l">
        <path d="M27.6 64 C27.5 76 27.9 87 28.5 97.5 C29 106 29.4 114 29.6 120.6 L34.4 120.6 C34.7 114 34.9 106 34.9 97.5 C34.9 87 34.7 76 34.6 64 Z" fill={outfit.trouser} />
        <path d="M31.4 70 C31.5 86 31.6 103 31.7 118" fill="none" stroke="rgba(0,0,0,.18)" strokeWidth="0.7" />
        <path d="M28.9 120.3 L34.6 120.3 C35.1 121.8 35.2 123.2 35 124.6 C34.9 125.8 34.1 126.4 32.8 126.4 L27.3 126.4 C25.9 126.4 25.3 125.5 25.6 124.2 C25.9 122.7 27 121.4 28.9 120.3 Z" fill={SHOE} />
        <path d="M27.2 124.8 C29.4 124.2 32 124 34.9 124.2" fill="none" stroke={SHOE_SHINE} strokeWidth="0.5" />
      </g>
      <g className="av-leg av-leg-r">
        <path d="M37.4 64 C37.3 76 37.1 87 37.1 97.5 C37.1 106 37.3 114 37.6 120.6 L42.4 120.6 C42.6 114 43 106 43.5 97.5 C44.1 87 44.5 76 44.4 64 Z" fill={outfit.trouser} />
        <path d="M40.6 70 C40.5 86 40.4 103 40.3 118" fill="none" stroke="rgba(0,0,0,.18)" strokeWidth="0.7" />
        <path d="M37.4 120.3 L43.1 120.3 C45 121.4 46.1 122.7 46.4 124.2 C46.7 125.5 46.1 126.4 44.7 126.4 L39.2 126.4 C37.9 126.4 37.1 125.8 37 124.6 C36.8 123.2 36.9 121.8 37.4 120.3 Z" fill={SHOE} />
        <path d="M44.8 124.8 C42.6 124.2 40 124 37.1 124.2" fill="none" stroke={SHOE_SHINE} strokeWidth="0.5" />
      </g>
    </>
  )

  const maleTorso = 'M28.7 26.2 L33.5 25.3 C34.4 27.1 37.6 27.1 38.5 25.3 L43.3 26.2 C46.9 26.9 49.3 29.2 49.5 32.6 C49.8 38.2 48.7 43.2 47.9 48 C47.3 52.6 47.5 58 48 62 C44.9 64.7 27.1 64.7 24 62 C24.5 58 24.7 52.6 24.1 48 C23.3 43.2 22.2 38.2 22.5 32.6 C22.7 29.2 25.1 26.9 28.7 26.2 Z'
  const femaleTorso = 'M29.1 26.1 L33.7 25.2 C34.5 27 37.5 27 38.3 25.2 L42.9 26.1 C46.2 26.8 48.3 29 48.5 32.1 C48.7 37.5 47.4 42.6 46.3 46.4 C45.6 50.8 45.9 55.2 46.7 58.8 C43.7 61.5 28.3 61.5 25.3 58.8 C26.1 55.2 26.4 50.8 25.7 46.4 C24.6 42.6 23.3 37.5 23.5 32.1 C23.7 29 25.8 26.8 29.1 26.1 Z'

  return (
    <g className={`av-fig av-fig-front ${skirt ? 'has-skirt' : ''}`}>
      {hairArt.back && <path d={hairArt.back} fill={hair.base} />}
      {hairArt.bun && !back && <circle cx={hairArt.bun[0]} cy={hairArt.bun[1]} r={hairArt.bun[2]} fill={hair.base} stroke={hair.shade} strokeWidth="0.5" />}
      {legs}
      {/* hips */}
      {skirt
        ? <path d="M26 58.2 C26.8 66.4 28 75.5 29.8 84.6 L42.2 84.6 C44 75.5 45.2 66.4 46 58.2 C41 60.9 31 60.9 26 58.2 Z" fill={outfit.trouser} />
        : <path d="M25.6 57 L46.4 57 C46.7 60.8 46.7 64.4 46.4 67.8 L38.9 67.8 L36 62.9 L33.1 67.8 L25.6 67.8 C25.3 64.4 25.3 60.8 25.6 57 Z" fill={outfit.trouser} />}
      {skirt && <path d="M36 84.4 L36 78.6" stroke="rgba(0,0,0,.22)" strokeWidth="0.7" />}
      {/* torso */}
      <path d={gender === 'female' ? femaleTorso : maleTorso} fill={outfit.suit} />
      {!back && (
        <>
          <path d={gender === 'female'
            ? 'M33.4 25.8 C34.2 28.8 35.1 31 36 32.6 C36.9 31 37.8 28.8 38.6 25.8 C36.9 24.9 35.1 24.9 33.4 25.8 Z'
            : 'M33.2 25.9 C34 28.6 35 30.7 36 32.2 C37 30.7 38 28.6 38.8 25.9 C37 25 35 25 33.2 25.9 Z'} fill={outfit.shirt} />
          {outfit.vest && hero && tier >= 3 && gender === 'male' && (
            <path d="M33.4 29 L36 32.4 L38.6 29 L39.6 44.4 C37.2 46.8 34.8 46.8 32.4 44.4 Z" fill={outfit.vest} />
          )}
          {gender === 'male' ? (
            <>
              <path d="M34.9 26.8 L37.1 26.8 L36.7 29.2 L35.3 29.2 Z" fill={outfit.tie} />
              <path d="M35.3 29.2 L36.7 29.2 L37.7 40.2 L36 43.6 L34.3 40.2 Z" fill={outfit.tie} />
              <path d="M35.3 29.2 L36.7 29.2 L36.9 31 L35.2 31 Z" fill="rgba(0,0,0,.18)" />
            </>
          ) : (
            <>
              <path d="M34.1 30.2 C35.4 30.9 36.6 30.9 37.9 30.2" fill="none" stroke={SHIRT_SHADE} strokeWidth="0.6" />
              {(hero ? tier >= 1 : variant % 3 === 0) && (
                <>
                  <path d="M33.9 26.4 C34.6 28.2 35.3 29.4 36 30.1 C36.7 29.4 37.4 28.2 38.1 26.4" fill="none" stroke={BRASS} strokeWidth="0.5" opacity="0.9" />
                  <circle cx="36" cy="30" r="0.75" fill={BRASS} />
                </>
              )}
            </>
          )}
          {/* lapels */}
          <path d={gender === 'female'
            ? 'M33.7 25.2 C34.1 27.2 35.2 29.9 36 31.4 C34 34.5 31.8 36.6 29.3 38 C28.6 34.6 28.5 31 28.9 28.1 C30.3 26.7 31.9 25.8 33.7 25.2 Z'
            : 'M33.5 25.3 C34 27.4 35.2 30.2 36 31.9 C33.8 35.4 31.4 37.8 28.6 39.4 C27.8 35.6 27.6 31.6 28 28.4 C29.6 26.9 31.4 25.9 33.5 25.3 Z'} fill={outfit.shade} />
          <path d={gender === 'female'
            ? 'M38.3 25.2 C37.9 27.2 36.8 29.9 36 31.4 C38 34.5 40.2 36.6 42.7 38 C43.4 34.6 43.5 31 43.1 28.1 C41.7 26.7 40.1 25.8 38.3 25.2 Z'
            : 'M38.5 25.3 C38 27.4 36.8 30.2 36 31.9 C38.2 35.4 40.6 37.8 43.4 39.4 C44.2 35.6 44.4 31.6 44 28.4 C42.4 26.9 40.6 25.9 38.5 25.3 Z'} fill={outfit.shade} />
          {outfit.accent && hero && (
            <path d="M33.5 25.6 C34.4 29.2 35.2 31.4 36 32.6 C36.8 31.4 37.6 29.2 38.5 25.6" fill="none" stroke={outfit.accent} strokeWidth="0.55" opacity="0.9" />
          )}
          <path d="M36 33 C36.2 42.6 36.3 52.4 36.4 60.8" fill="none" stroke="rgba(0,0,0,.16)" strokeWidth="0.7" />
          <circle cx="37.6" cy="47.5" r="0.7" fill="rgba(0,0,0,.35)" />
          <circle cx="37.6" cy="52.8" r="0.7" fill="rgba(0,0,0,.35)" />
          {hero && tier >= 2 && <path d="M41.6 32.8 L44.2 32.8 L42.9 34.8 Z" fill={outfit.accent ?? '#f2ead6'} />}
          {hero && tier >= 5 && <circle cx="31.3" cy="31.8" r="0.9" fill="#e6c26a" />}
          {!skirt && <path d="M29.5 57.8 L42.5 57.8 L42.5 60.2 L29.5 60.2 Z M34.9 58.3 L37.1 58.3 L37.1 59.7 L34.9 59.7 Z" fill="#241b12" fillRule="evenodd" />}
          {!skirt && <rect x="34.9" y="58.3" width="2.2" height="1.4" rx="0.3" fill={BRASS} />}
        </>
      )}
      {back && (
        <>
          <path d="M36 27.5 L36 62" stroke="rgba(0,0,0,.2)" strokeWidth="0.8" />
          <path d="M31.5 62 L32.5 64.4 M40.5 62 L39.5 64.4" stroke="rgba(0,0,0,.2)" strokeWidth="0.7" />
        </>
      )}
      {/* arms */}
      <g className="av-arm av-arm-l">
        {chestProp ? (
          <path d="M23.1 28.2 C25.3 27 27.6 27.4 28.5 29.2 C29.2 32 29.1 36.4 28.5 40.4 C28.2 42.6 28.9 44.2 30.8 44.6 C32.6 45 34.4 45.2 36 45.2 L36 48.6 C33.8 48.6 31.4 48.4 29.2 48 C25.9 47.4 24.1 45.2 24 42 C23.9 37.4 22.7 32.6 23.1 28.2 Z" fill={outfit.shade} />
        ) : (
          <>
            <path d="M23.1 28.2 C25.3 27 27.6 27.4 28.5 29.2 C29.3 32.8 29 39.2 28.3 45.2 C27.8 49.6 27.2 53.8 26.5 57 L22.8 56.6 C22.4 53.2 22.4 49 22.6 45 C22.8 39 22.5 32.8 23.1 28.2 Z" fill={outfit.shade} />
            <path d="M22.8 55.1 L26.7 55.5 L26.5 57 L22.8 56.6 Z" fill={outfit.shirt} />
            <ellipse cx="24.6" cy="59.6" rx="2.3" ry="2.9" fill={skin.base} />
            {hero && tier >= 3 && !back && (
              <>
                <rect x="22.9" y="55.9" width="3.6" height="1.7" rx="0.5" fill="#3a3f4c" />
                <circle cx="24.7" cy="56.75" r="1" fill="#dfe6ee" />
              </>
            )}
          </>
        )}
        {chestProp && <ellipse cx="34.8" cy="46.8" rx="2.1" ry="2.3" fill={skin.base} />}
      </g>
      <g className="av-arm av-arm-r">
        <path d="M48.9 28.2 C46.7 27 44.4 27.4 43.5 29.2 C42.7 32.8 43 39.2 43.7 45.2 C44.2 49.6 44.8 53.8 45.5 57 L49.2 56.6 C49.6 53.2 49.6 49 49.4 45 C49.2 39 49.5 32.8 48.9 28.2 Z" fill={outfit.shade} />
        <path d="M49.2 55.1 L45.3 55.5 L45.5 57 L49.2 56.6 Z" fill={outfit.shirt} />
        <ellipse cx="47.4" cy="59.6" rx="2.3" ry="2.9" fill={skin.base} />
        {handProp && <HandProp accessory={accessory} />}
      </g>
      {chestProp && <ChestProp accessory={accessory} />}
      {/* neck + head */}
      <path d="M33.1 19.2 L38.9 19.2 L39.2 26 C37.3 27.2 34.7 27.2 32.8 26 Z" fill={skin.base} />
      <path d="M33.1 19.2 L38.9 19.2 L38.95 21.7 C37 22.8 35 22.8 33.05 21.7 Z" fill={skin.shade} />
      <ellipse cx="27.4" cy="12.2" rx="1.7" ry="2.5" fill={skin.base} />
      <ellipse cx="44.6" cy="12.2" rx="1.7" ry="2.5" fill={skin.base} />
      {gender === 'female' && !back && (
        <>
          <circle cx="27.4" cy="15.2" r="0.65" fill={BRASS} />
          <circle cx="44.6" cy="15.2" r="0.65" fill={BRASS} />
        </>
      )}
      <path d="M36 2.8 C30.6 2.8 27.2 6.6 27.1 11.4 C27 15.4 29.2 18.9 32.1 20.8 C33.4 21.7 34.7 22.1 36 22.1 C37.3 22.1 38.6 21.7 39.9 20.8 C42.8 18.9 45 15.4 44.9 11.4 C44.8 6.6 41.4 2.8 36 2.8 Z" fill={skin.base} />
      {back ? (
        <path d="M27.1 11.4 C27 6.6 30.6 2.8 36 2.8 C41.4 2.8 44.8 6.6 44.9 11.4 C45 15.8 42.6 19.5 39.6 21.2 L32.4 21.2 C29.4 19.5 27 15.8 27.1 11.4 Z" fill={hair.base} />
      ) : (
        <>
          <FrontFace skin={skin} hair={hair} eye={eye} gender={gender} mood={mood} variant={variant} />
          <path d={hairArt.front} fill={hair.base} />
          {hairArt.shine && <path d={hairArt.shine} fill="none" stroke={hair.shine} strokeWidth="1.05" strokeLinecap="round" opacity="0.85" />}
        </>
      )}
      {gender === 'male' && variant === 5 && !back && (
        <path d="M29.6 15 C31 19.4 34 21.6 36 21.6 C38 21.6 41 19.4 42.4 15 C41.4 18.4 38.8 20.4 36 20.4 C33.2 20.4 30.6 18.4 29.6 15 Z" fill={hair.base} opacity="0.4" />
      )}
    </g>
  )
}

function ProfileFigure({ gender, skin, hair, eye, outfit, variant, accessory }: {
  gender: CharacterGender; skin: SkinTone; hair: HairTone; eye: string; outfit: Outfit
  variant: number; accessory: Accessory
}) {
  const skirt = gender === 'female' && femaleWearsSkirt(variant)
  const longHair = gender === 'female' && [0, 2, 4, 6].includes(((variant % 7) + 7) % 7)
  const handProp = HAND_PROPS.includes(accessory)
  return (
    <g className={`av-fig av-fig-profile ${skirt ? 'has-skirt' : ''}`}>
      {/* far leg */}
      <g className="av-leg av-leg-r">
        {skirt ? (
          <>
            <path d="M33.4 82.6 L37.6 82.6 C37.8 95 37.7 108 37.5 120.2 L34.2 120.2 C33.7 108 33.4 95 33.4 82.6 Z" fill={skin.shade} />
            <path d="M33.8 119.8 L37.6 119.8 C38 122 37.8 124 37 125.4 C36.6 126.1 35.8 126.3 34.8 126.3 L31.4 126.3 C30.6 126.3 30.3 125.6 30.6 124.7 C31.1 123.1 32.2 121.5 33.8 119.8 Z" fill={HEEL} />
          </>
        ) : (
          <>
            <path d="M34.6 64 C34.5 76 34.9 87 35.5 97.5 C36 106 36.4 114 36.6 120.6 L41.4 120.6 C41.7 114 41.9 106 41.9 97.5 C41.9 87 41.7 76 41.6 64 Z" fill={outfit.trouser} opacity="0.82" />
            <path d="M35 120.3 L41 120.3 C41.4 122.3 41.2 124.2 40.4 125.6 C39.9 126.4 39 126.6 37.8 126.6 L30.9 126.6 C29.7 126.6 29.2 125.7 29.6 124.5 C30.2 122.8 32 121.2 35 120.3 Z" fill={SHOE} opacity="0.85" />
          </>
        )}
      </g>
      {/* near leg */}
      <g className="av-leg av-leg-l">
        {skirt ? (
          <>
            <path d="M35 82.6 L39.4 82.6 C39.6 95 39.5 108 39.3 120.2 L35.9 120.2 C35.4 108 35.1 95 35 82.6 Z" fill={skin.base} />
            <path d="M35.5 119.8 L39.3 119.8 C39.7 122 39.5 124 38.7 125.4 C38.3 126.1 37.5 126.3 36.5 126.3 L33.1 126.3 C32.3 126.3 32 125.6 32.3 124.7 C32.8 123.1 33.9 121.5 35.5 119.8 Z" fill={HEEL} />
            <path d="M38.3 125.9 L39.3 125.9 L39.2 128.2 L38.4 128.2 Z" fill={HEEL} />
          </>
        ) : (
          <>
            <path d="M33 64 C32.9 76 33.3 87 33.9 97.5 C34.4 106 34.8 114 35 120.6 L39.8 120.6 C40.1 114 40.3 106 40.3 97.5 C40.3 87 40.1 76 40 64 Z" fill={outfit.trouser} />
            <path d="M33.4 120.3 L39.4 120.3 C39.8 122.3 39.6 124.2 38.8 125.6 C38.3 126.4 37.4 126.6 36.2 126.6 L28.9 126.6 C27.7 126.6 27.2 125.7 27.6 124.5 C28.2 122.8 30.2 121.2 33.4 120.3 Z" fill={SHOE} />
            <path d="M27.6 124.9 C30.4 124.2 33.6 124 37.4 124.3" fill="none" stroke={SHOE_SHINE} strokeWidth="0.5" />
          </>
        )}
      </g>
      {/* hips */}
      {skirt
        ? <path d="M30.8 57.8 C30.9 66.4 31.9 75.6 33.7 84.6 L42.3 84.6 C43.4 75.6 43.8 66.4 43.6 57.8 C39.4 60.4 35 60.4 30.8 57.8 Z" fill={outfit.trouser} />
        : <path d="M30.4 57 L43.8 57 C44.1 60.8 44.1 64.4 43.8 67.8 L38.4 67.8 L37 63.4 L35.6 67.8 L30.4 67.8 C30.1 64.4 30.1 60.8 30.4 57 Z" fill={outfit.trouser} />}
      {/* long hair behind torso */}
      {longHair && (
        <path d="M37.6 8 C41.8 9.6 44.4 13.4 44.6 18.6 C44.8 23.4 44.2 28.6 43 33.4 C42 32.2 41.4 30.6 41.4 28.8 C40.4 30.4 39.8 32.4 39.8 34.6 L37.4 34.6 C36.8 25.6 36.6 16.4 37.6 8 Z" fill={hair.base} />
      )}
      {/* torso */}
      <path d="M31 26.2 L34.6 25.2 C36.4 26.6 38.2 26.6 39.6 25.6 L41.2 26.2 C43.6 27 44.9 29 45 31.8 C45.2 37 44.6 42.6 43.9 48 C43.4 52.6 43.5 58 43.9 62 C41.5 64.6 32.5 64.6 30.1 62 C30.5 58 30.6 52.6 30.1 48 C29.4 42.6 28.8 37 29 31.8 C29.1 29 30 27 31 26.2 Z" fill={outfit.suit} />
      <path d="M31.6 26.2 C32.4 28.8 33.2 30.8 34 32.4 L34.9 30 C34.3 28.4 33.7 27 33.1 25.8 Z" fill={outfit.shirt} />
      <path d="M33.4 25.6 C34.2 28.4 35 30.4 35.8 31.8 C34.2 34.6 32.6 36.6 30.8 38 C30.3 34.4 30.3 30.6 30.8 27.8 C31.5 26.8 32.4 26 33.4 25.6 Z" fill={outfit.shade} />
      <path d="M30.6 33 C30.4 42 30.5 52 30.9 60.4" fill="none" stroke="rgba(0,0,0,.16)" strokeWidth="0.7" />
      {/* arm */}
      <g className="av-arm av-arm-l">
        <path d="M34.5 28.4 C36.7 27.2 39 27.6 39.9 29.4 C40.7 33 40.4 39.4 39.7 45.4 C39.2 49.8 38.6 54 37.9 57.2 L34.2 56.8 C33.8 53.4 33.8 49.2 34 45.2 C34.2 39.2 33.9 33 34.5 28.4 Z" fill={outfit.shade} />
        <path d="M34.2 55.3 L38.1 55.7 L37.9 57.2 L34.2 56.8 Z" fill={outfit.shirt} />
        <ellipse cx="36" cy="59.8" rx="2.3" ry="2.9" fill={skin.base} />
        {handProp && <g transform="translate(-11 0)"><HandProp accessory={accessory} /></g>}
      </g>
      {/* neck + head */}
      <path d="M31.4 19.6 L37.6 19.4 L38 26 C35.7 27.1 33.5 27.1 31.8 26 Z" fill={skin.base} />
      <path d="M31.4 19.6 L37.6 19.4 L37.7 21.8 C35.5 22.8 33.5 22.8 31.5 21.9 Z" fill={skin.shade} />
      <path d="M34.6 2.9 C29.8 3.4 26.6 7 26.5 11.2 C26.45 12.4 26 13.2 25.4 14 C24.9 14.7 25 15.4 25.7 15.7 C26.2 15.9 26.5 16.2 26.5 16.8 C26.5 17.3 26.3 17.8 26.6 18.3 C27 18.9 28 19 29.2 18.9 C30.2 18.8 31 19.1 31.6 20.2 C32.4 21.6 34 22.2 35.8 22.1 C39.8 21.9 43.2 18.6 43.6 13.6 C44.1 7.4 40.4 2.6 34.6 2.9 Z" fill={skin.base} />
      <ellipse cx="38.6" cy="12.8" rx="1.9" ry="2.7" fill={skin.base} stroke={skin.shade} strokeWidth="0.5" />
      {gender === 'female' && <circle cx="38.6" cy="15.8" r="0.65" fill={BRASS} />}
      <path d="M27.8 9.2 C28.8 8.6 30.2 8.6 31.2 9" fill="none" stroke={hair.shade} strokeWidth="1" strokeLinecap="round" />
      <path d="M28.2 11.2 C28.8 10.4 30.2 10.4 30.8 11.2 C30.2 12 28.8 12 28.2 11.2 Z" fill={SCLERA} />
      <circle cx="29.4" cy="11.2" r="0.8" fill={eye} />
      <circle cx="29.4" cy="11.2" r="0.4" fill={PUPIL} />
      <path d="M26.6 16.9 C27.2 17.2 27.9 17.3 28.6 17.1" fill="none" stroke={LIP_M} strokeWidth="0.8" strokeLinecap="round" />
      <ellipse cx="30.2" cy="14.3" rx="1.3" ry="0.8" fill={skin.blush} opacity={gender === 'female' ? 0.3 : 0.14} />
      {/* profile hair */}
      <path d="M34.6 2.9 C29.8 3.4 26.9 6.4 26.8 9.8 C28.4 7.4 30.1 6.4 32.2 6.2 C35 5.9 37.7 6.5 40 8.2 C41.7 9.5 42.6 11.4 42.8 13.6 L43.6 13.6 C44.1 7.4 40.4 2.6 34.6 2.9 Z" fill={hair.base} />
      <path d={longHair
        ? 'M40 8.2 C42.4 9.9 43.5 12.6 43.2 15.8 C43 19.2 41.7 22.4 39.6 24.6 C40.2 20.6 40 16.4 38.9 12.6 Z'
        : 'M40 8.2 C42 9.7 43 12 42.9 14.6 C42.8 17 41.9 19.3 40.3 20.8 C40.8 17.9 40.6 15 39.6 12.4 Z'} fill={hair.base} />
      <path d="M30.4 5.2 C32.2 4.4 34.2 4.1 36.2 4.4" fill="none" stroke={hair.shine} strokeWidth="0.95" strokeLinecap="round" opacity="0.85" />
      {gender === 'female' && hairArtFor(gender, variant).bun && (
        <circle cx="43.4" cy="7.4" r="3" fill={hair.base} stroke={hair.shade} strokeWidth="0.5" />
      )}
    </g>
  )
}

/* ----------------------------------------------------------- Person */

export function Person({
  gender = 'female',
  tier = 0,
  variant = 0,
  direction = 'down',
  walking = false,
  accessory = 'none',
  mood = 'neutral',
  className = '',
  label,
}: PersonProps) {
  const outfit = outfitFor(variant, tier)
  const skin = skinFor(variant)
  const hair = hairFor(variant + (gender === 'female' ? 1 : 0))
  const eye = eyeFor(variant)
  const profile = direction === 'left' || direction === 'right'
  const figure = profile
    ? <ProfileFigure gender={gender} skin={skin} hair={hair} eye={eye} outfit={outfit} variant={variant} accessory={accessory} />
    : <FrontFigure gender={gender} skin={skin} hair={hair} eye={eye} outfit={outfit} tier={tier} variant={variant} accessory={accessory} mood={mood} back={direction === 'up'} />
  return (
    <span
      className={`av-person facing-${direction} ${walking ? 'is-walking' : ''} ${className}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox="0 0 72 132" className="av-person-svg">
        <ellipse className="av-ground-shadow" cx="36" cy="128" rx="13.5" ry="3" fill="rgba(10,14,20,.3)" />
        <g className="av-figure">
          {direction === 'right' ? <g transform="translate(72 0) scale(-1 1)">{figure}</g> : figure}
        </g>
      </svg>
    </span>
  )
}

/* ------------------------------------------------------------- Bust */

type BustHair = { back?: string; front: string; shine?: string; bun?: [number, number, number] }

const MALE_BUST_HAIR: BustHair[] = [
  { front: 'M32.8 28 C31.6 16.4 38.4 10.2 48 10.2 C57.6 10.2 64.4 16.8 63.2 28.8 C62 24.2 60.6 21.6 58.4 20.2 C55.2 22 50.4 22.6 45.2 21.4 C40.8 20.4 38 21.4 36.2 23.2 C34.6 24.8 33.6 26.2 32.8 28 Z', shine: 'M38.6 15.4 C42 13.4 45.8 12.8 49.6 13.2' },
  { front: 'M33 27 C32.2 16.2 38.8 10.6 48 10.6 C57.2 10.6 63.8 16.2 63 27 C61.8 22.8 60 20.8 57.6 20.1 L38.4 20.1 C36 20.8 34.2 22.8 33 27 Z', shine: 'M40 14.6 C43.2 13.2 46.8 12.8 50.2 13.3' },
  { front: 'M32.8 26.6 C31.8 16 38 10 48 10 C58 10 64.2 16 63.2 26.6 C62.6 21.8 61.2 19.6 59.4 18.6 C56 17 52.2 16.6 48 16.6 C43.8 16.6 40 17 36.6 18.6 C34.8 19.6 33.4 21.8 32.8 26.6 Z', shine: 'M38 13.6 C41.4 11.8 45.4 11.2 49.2 11.6' },
  { front: 'M33 27.2 C29.8 19.6 33.8 13.6 38.4 13.6 C39 11 42.4 9.6 45.2 11 C46.8 8.8 51.6 8.8 53.2 11 C56 9.6 59.4 11 60 13.6 C64.6 13.6 68.6 19.6 62.2 27.2 C60.8 23.4 59 21.6 56.6 20.9 C50.4 23 44.2 23 38 20.9 C35.6 21.6 34.2 23.4 33 27.2 Z' },
  { front: 'M33 26.8 C32.2 17 37.6 11.8 45.6 10.4 C51.8 9.4 58 10.8 61.2 14.2 C64.2 17.4 64.2 22 63 26.9 C61.8 22.8 60.4 20.6 58.4 19.6 C55 22.4 48.8 23 43.2 21 C39 19.6 36 21.4 33 26.8 Z', shine: 'M40.8 14 C44.2 12.4 48.6 12 52.4 13' },
  { front: 'M33.4 25.4 C32.8 16.6 39 12.4 48 12.4 C57 12.4 63.2 16.6 62.6 25.4 C61.6 20.9 59.4 18.9 56.6 18.1 L39.4 18.1 C36.6 18.9 34.4 20.9 33.4 25.4 Z' },
  { front: 'M32.8 28 C31.6 16.4 38.4 10.2 48 10.2 C57.6 10.2 64.4 16.8 63.2 28.8 C62 24.2 60.6 21.6 58.4 20.2 C55.2 22 50.4 22.6 45.2 21.4 C40.8 20.4 38 21.4 36.2 23.2 C34.6 24.8 33.6 26.2 32.8 28 Z', shine: 'M38.6 15.4 C42 13.4 45.8 12.8 49.6 13.2' },
]

const FEMALE_BUST_HAIR: BustHair[] = [
  {
    back: 'M31.2 32 C28 20 35.6 9.6 48 9.6 C60.4 9.6 68 20 64.8 32 C63.8 36.4 62.4 39.6 60.6 41.8 L35.4 41.8 C33.6 39.6 32.2 36.4 31.2 32 Z',
    front: 'M32.4 29 C30.8 16.6 37.8 10.4 48 10.4 C58.2 10.4 65.2 16.4 63.6 29 C62.8 23.6 61 20.8 58.2 19.4 C52.6 23 42 23.3 37.1 20.1 C35 21.9 33.2 25 32.4 29 Z',
    shine: 'M37.8 15 C41.2 13 45.2 12.2 49 12.6',
    bun: [64.6, 39.2, 6],
  },
  {
    back: 'M31.6 30 C29.2 17.4 36.8 10 48 10 C59.2 10 66.8 17.4 64.4 30 C63.7 37 64 43 65.4 48.2 C59.8 51.6 55.2 51.9 52 50 L44 50 C40.8 51.9 36.2 51.6 30.6 48.2 C32 43 32.3 37 31.6 30 Z',
    front: 'M32.4 28.6 C31 16.8 38 10.6 48 10.6 C58 10.6 65 16.8 63.6 28.6 C62.6 23.4 60.4 20.4 57.6 19.4 C55.4 21.2 52.6 21.9 50.2 21.2 C49.2 19.4 46.8 19.4 45.8 21.2 C43.4 21.9 40.6 21.2 38.4 19.4 C35.6 20.4 33.4 23.4 32.4 28.6 Z',
    shine: 'M37.4 15.2 C40.8 13.2 44.8 12.4 48.6 12.8',
  },
  {
    back: 'M31 30 C27.8 17 36.4 9.4 48 9.4 C59.6 9.4 68.2 17 65 30 C66.4 38.8 67.4 47.6 66.2 55.4 C65.4 61.4 63.8 66 61 69.2 C58.8 67 58.2 64.6 58.6 61.8 C56.4 64.2 55 67.6 55.4 71.6 L40.6 71.6 C41 67.6 39.6 64.2 37.4 61.8 C37.8 64.6 37.2 67 35 69.2 C32.2 66 30.6 61.4 29.8 55.4 C28.6 47.6 29.6 38.8 31 30 Z',
    front: 'M32.4 29 C30.8 16.6 37.8 10.4 48 10.4 C58.2 10.4 65.2 16.6 63.6 29 C62.9 24 61.3 21 58.8 19.5 C54.5 22.4 48.7 23 43.9 21.2 C39.8 19.7 35.9 21.2 34.1 23.6 C33.2 25.2 32.6 27 32.4 29 Z',
    shine: 'M37 15.4 C40.4 13.2 44.6 12.4 48.4 12.8',
  },
  {
    back: 'M31.8 28.6 C31 17.2 37.8 11 48 11 C58.2 11 65 17.2 64.2 28.6 C63.8 34 62.8 38.2 61 41.4 L35 41.4 C33.2 38.2 32.2 34 31.8 28.6 Z',
    front: 'M32.2 27.4 C31.2 16 38 11 48 11 C58 11 64.8 16 63.8 27.4 C62 20.9 57.6 17.7 48 17.7 C38.4 17.7 34 20.9 32.2 27.4 Z',
    bun: [48, 9.4, 7.2],
    shine: 'M41.6 13 C45.2 12 49.4 12 52.6 13',
  },
  {
    back: 'M31.6 29 C30.8 17.6 37.6 11.2 48 11.2 C58.4 11.2 65.2 17.6 64.4 29 C64 34.2 63 38.4 61.2 41.6 L34.8 41.6 C33 38.4 32 34.2 31.6 29 Z M62 15 C68.4 18.6 70.6 27 68.4 35.6 C67 41.4 64.4 46.4 60.8 50 C59 47.4 58.2 44.6 59 41.4 C61.2 33 60.8 24 57.6 17.4 Z',
    front: 'M32.2 27.4 C31.2 16 38 11.4 48 11.4 C58 11.4 64.8 16 63.8 27.4 C62 20.9 57.6 18 48 18 C38.4 18 34 20.9 32.2 27.4 Z',
    shine: 'M41.4 13.6 C45 12.6 49.2 12.6 52.4 13.6',
  },
  {
    front: 'M32.6 27.2 C31.2 16.6 37.4 10.2 46 9.8 C52.8 9.4 59.2 11.2 62 15.2 C64.8 18.8 64.6 23 63.4 27.4 C62.2 23 60.4 20.8 57.9 19.9 C54.3 22.6 48.2 23.2 42.8 21.2 C38.7 19.8 34.9 22 32.6 27.2 Z',
    shine: 'M39.8 14 C43.4 12.4 47.6 12 51.2 13',
  },
  {
    back: 'M31.4 30 C28.9 17.4 36.8 9.8 48 9.8 C59.2 9.8 67.1 17.4 64.6 30 C64.2 38.6 64.9 46 66.7 52.4 C61.4 56.4 56.6 56.7 52.5 54.2 L43.5 54.2 C39.4 56.7 34.6 56.4 29.3 52.4 C31.1 46 31.8 38.6 31.4 30 Z',
    front: 'M32.4 28.6 C31 16.8 38 10.8 48 10.8 C58 10.8 65 16.8 63.6 28.6 C62.7 23.6 60.9 20.6 58.2 19.2 C54 22 48.5 22.7 43.8 21 C39.9 19.6 36.1 21 34.3 23.4 C33.4 25 32.7 26.7 32.4 28.6 Z',
    shine: 'M37.4 15.2 C40.8 13.2 44.8 12.4 48.6 12.8',
  },
]

export type BustProps = {
  gender?: CharacterGender
  variant?: number
  tier?: number
  mood?: Mood
  judge?: boolean
  backdrop?: string
  className?: string
  label?: string
}

export function Bust({
  gender = 'female',
  variant = 0,
  tier = 0,
  mood = 'neutral',
  judge = false,
  backdrop,
  className = '',
  label,
}: BustProps) {
  const outfit = outfitFor(variant, tier)
  const skin = skinFor(variant)
  const hair = hairFor(variant + (gender === 'female' ? 1 : 0))
  const eye = eyeFor(variant)
  const art = (gender === 'female' ? FEMALE_BUST_HAIR : MALE_BUST_HAIR)[((variant % 7) + 7) % 7]
  const suit = judge ? '#16151d' : outfit.suit
  const suitShade = judge ? '#0d0c13' : outfit.shade
  const glasses = !judge && ((gender === 'male' && variant === 2) || (gender === 'female' && variant === 6))

  const browL = mood === 'unhappy' ? 'M39.4 23.4 C41.2 23.4 43.6 23.7 45.4 24.6' : 'M39.4 24.2 C41.2 23 43.6 22.8 45.4 23.6'
  const browR = mood === 'unhappy' ? 'M50.6 24.6 C52.4 23.7 54.8 23.4 56.6 23.4' : 'M50.6 23.6 C52.4 22.8 54.8 23 56.6 24.2'
  const lips = gender === 'female' || judge
    ? mood === 'happy'
      ? 'M43 38.2 C44.6 37.4 46.3 37.6 48 38.2 C49.7 37.6 51.4 37.4 53 38.2 C52 41.6 50.1 43 48 43 C45.9 43 44 41.6 43 38.2 Z'
      : mood === 'unhappy'
        ? 'M43.8 41 C45 40 46.5 39.6 48 39.6 C49.5 39.6 51 40 52.2 41 C51.2 41.9 49.7 42.4 48 42.4 C46.3 42.4 44.8 41.9 43.8 41 Z'
        : 'M43.4 38.8 C44.9 37.9 46.5 38 48 38.7 C49.5 38 51.1 37.9 52.6 38.8 C51.8 41.4 50 42.5 48 42.5 C46 42.5 44.2 41.4 43.4 38.8 Z'
    : mood === 'happy'
      ? 'M43 38.6 C44.8 41 51.2 41 53 38.6'
      : mood === 'unhappy'
        ? 'M43.4 41 C45.2 39.4 50.8 39.4 52.6 41'
        : 'M43.6 39.6 C45.2 40.6 50.8 40.6 52.4 39.6'
  const lipsFilled = gender === 'female' || judge

  return (
    <span className={`av-bust ${className}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg viewBox="0 0 96 96" className="av-bust-svg">
        {backdrop !== 'none' && (
          <path d="M8 96 L8 44 C8 21.9 25.9 4 48 4 C70.1 4 88 21.9 88 44 L88 96 Z" fill={backdrop ?? '#22374a'} className="av-bust-arch" />
        )}
        {judge && (
          <g className="av-wig-back" fill="#e8eaf0" stroke="#c6cad6" strokeWidth="0.8">
            <ellipse cx="30" cy="26" rx="6.2" ry="5" />
            <ellipse cx="29" cy="34" rx="5.8" ry="4.8" />
            <ellipse cx="28.6" cy="42" rx="5.5" ry="4.6" />
            <ellipse cx="66" cy="26" rx="6.2" ry="5" />
            <ellipse cx="67" cy="34" rx="5.8" ry="4.8" />
            <ellipse cx="67.4" cy="42" rx="5.5" ry="4.6" />
          </g>
        )}
        {!judge && art.back && <path d={art.back} fill={hair.base} />}
        {!judge && art.bun && <circle cx={art.bun[0]} cy={art.bun[1]} r={art.bun[2]} fill={hair.base} stroke={hair.shade} strokeWidth="0.8" />}
        {/* shoulders */}
        <path d="M13 96 C15.4 81.4 24 73.2 34.6 70.6 L61.4 70.6 C72 73.2 80.6 81.4 83 96 Z" fill={suit} />
        <path d="M40 70.6 L48 83.8 L56 70.6 C53.4 68.8 42.6 68.8 40 70.6 Z" fill={judge ? '#f4f5f8' : outfit.shirt} />
        {judge ? (
          <g fill="#f4f5f8" stroke="#d3d7e0" strokeWidth="0.7">
            <rect x="44.4" y="72" width="7.2" height="9" rx="1.6" />
            <rect x="44.4" y="80" width="7.2" height="9" rx="1.6" />
          </g>
        ) : gender === 'male' ? (
          <>
            <path d="M46 71.2 L50 71.2 L49.4 75 L46.6 75 Z" fill={outfit.tie} />
            <path d="M46.6 75 L49.4 75 L50.8 88 L48 92 L45.2 88 Z" fill={outfit.tie} />
          </>
        ) : (
          <>
            <path d="M44.2 71.6 C45.4 74.6 46.6 76.8 48 78.4 C49.4 76.8 50.6 74.6 51.8 71.6" fill="none" stroke={BRASS} strokeWidth="0.9" opacity="0.9" />
            <circle cx="48" cy="78.6" r="1.3" fill={BRASS} />
          </>
        )}
        <path d="M34.6 70.6 C38 74.8 41.4 79.6 44 84.8 C40.2 82.4 36.6 79 33.6 74.6 Z" fill={suitShade} />
        <path d="M61.4 70.6 C58 74.8 54.6 79.6 52 84.8 C55.8 82.4 59.4 79 62.4 74.6 Z" fill={suitShade} />
        {/* neck */}
        <path d="M42 56 L54 56 L54.6 72.4 C50.2 75.4 45.8 75.4 41.4 72.4 Z" fill={skin.base} />
        <path d="M42 56 L54 56 L54.2 61.4 C50.2 63.6 45.8 63.6 41.8 61.4 Z" fill={skin.shade} />
        {/* ears */}
        <ellipse cx="33.4" cy="29.5" rx="3" ry="4.4" fill={skin.base} />
        <ellipse cx="62.6" cy="29.5" rx="3" ry="4.4" fill={skin.base} />
        {gender === 'female' && !judge && (
          <>
            <circle cx="33.2" cy="34.6" r="1.3" fill={BRASS} />
            <circle cx="62.8" cy="34.6" r="1.3" fill={BRASS} />
          </>
        )}
        {/* head */}
        <path d="M48 12 C38.6 12 32.8 18.6 32.6 27 C32.4 33.8 36.2 40.4 41.2 43.8 C43.4 45.3 45.7 46.1 48 46.1 C50.3 46.1 52.6 45.3 54.8 43.8 C59.8 40.4 63.6 33.8 63.4 27 C63.2 18.6 57.4 12 48 12 Z" fill={skin.base} />
        {/* face */}
        <path d={browL} fill="none" stroke={judge ? '#8b8f9c' : hair.shade} strokeWidth="1.7" strokeLinecap="round" />
        <path d={browR} fill="none" stroke={judge ? '#8b8f9c' : hair.shade} strokeWidth="1.7" strokeLinecap="round" />
        <path d="M39.2 27.8 C40.4 26.2 43.2 26 44.6 27.6 C43.4 29.6 40.4 29.7 39.2 27.8 Z" fill={SCLERA} />
        <path d="M51.4 27.6 C52.8 26 55.6 26.2 56.8 27.8 C55.6 29.7 52.6 29.6 51.4 27.6 Z" fill={SCLERA} />
        <circle cx="41.9" cy="27.9" r="1.75" fill={eye} />
        <circle cx="54.1" cy="27.9" r="1.75" fill={eye} />
        <circle cx="41.9" cy="27.9" r="0.85" fill={PUPIL} />
        <circle cx="54.1" cy="27.9" r="0.85" fill={PUPIL} />
        <circle cx="41.3" cy="27.2" r="0.5" fill="white" />
        <circle cx="53.5" cy="27.2" r="0.5" fill="white" />
        <path d="M39 27.4 C40.2 25.8 43.2 25.6 44.8 27.2" fill="none" stroke="#241c15" strokeWidth="1.05" strokeLinecap="round" />
        <path d="M51.2 27.2 C52.8 25.6 55.8 25.8 57 27.4" fill="none" stroke="#241c15" strokeWidth="1.05" strokeLinecap="round" />
        <path d="M48.3 29 C48.8 31.2 49.1 33 48.4 34.4 C47.9 35.3 46.7 35.2 46.3 34.5" fill="none" stroke={skin.shade} strokeWidth="1.1" strokeLinecap="round" />
        {lipsFilled
          ? <path d={lips} fill={judge ? '#a2626a' : '#b8574f'} />
          : <path d={lips} fill="none" stroke={LIP_M} strokeWidth="1.5" strokeLinecap="round" />}
        <ellipse cx="39" cy="33.8" rx="3" ry="1.7" fill={skin.blush} opacity={gender === 'female' ? 0.3 : 0.15} />
        <ellipse cx="57" cy="33.8" rx="3" ry="1.7" fill={skin.blush} opacity={gender === 'female' ? 0.3 : 0.15} />
        {glasses && (
          <g stroke="#22303c" strokeWidth="1.1" fill="rgba(255,255,255,.14)">
            <rect x="37.6" y="24.6" width="9" height="6.4" rx="2.8" />
            <rect x="49.4" y="24.6" width="9" height="6.4" rx="2.8" />
            <path d="M46.6 27.2 L49.4 27.2" fill="none" />
          </g>
        )}
        {/* hair */}
        {judge ? (
          <g>
            <path d="M32.8 26 C32 15.6 38.4 10 48 10 C57.6 10 64 15.6 63.2 26 C62 21 59.8 18.6 56.8 17.8 L39.2 17.8 C36.2 18.6 34 21 32.8 26 Z" fill="#eceef2" />
            <path d="M36 17 C39.2 14.6 43.4 13.6 48 13.6 C52.6 13.6 56.8 14.6 60 17" fill="none" stroke="#c6cad6" strokeWidth="1" />
          </g>
        ) : (
          <>
            <path d={art.front} fill={hair.base} />
            {art.shine && <path d={art.shine} fill="none" stroke={hair.shine} strokeWidth="1.8" strokeLinecap="round" opacity="0.85" />}
          </>
        )}
        {gender === 'male' && variant === 5 && !judge && (
          <path d="M36.4 31 C38.6 39.6 43.4 44 48 44 C52.6 44 57.4 39.6 59.6 31 C58 38 53.4 42 48 42 C42.6 42 38 38 36.4 31 Z" fill={hair.base} opacity="0.4" />
        )}
      </svg>
    </span>
  )
}
