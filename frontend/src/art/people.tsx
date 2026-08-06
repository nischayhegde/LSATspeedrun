/* Shared cast API. Every human role resolves to the same procedural,
   animated 3D counsel rig; identity only varies the cast styling. */

import { lazy, Suspense } from 'react'

import type { CharacterGender } from '../types'
import { loadStylizedCharacter } from './scene-loaders'
import type { StylizedCharacterActivity } from './stylized-character'
const StylizedCharacter = lazy(() => loadStylizedCharacter().then((module) => ({ default: module.StylizedCharacter })))

const castGenders: Record<string, CharacterGender> = {
  paralegal: 'female',
  junior_associate: 'male',
  office_manager: 'female',
  senior_associate: 'female',
  partner: 'male',
  rainmaker: 'female',
  neighborhood_practice: 'female',
  downtown_boutique: 'male',
  regional_firm: 'female',
  national_competitor: 'male',
  appellate_chambers: 'female',
  transatlantic_firm: 'male',
  sovereign_rival: 'female',
  continental_rival: 'male',
  orbital_rival: 'female',
  // Without an entry here a bust falls back to `seed % 2`, which is fine for an
  // anonymous walk-in but not for a rival: these owners are named in the card
  // beside their own portrait, so the two have to agree.
  media_law_collective: 'female',
  global_crisis_firm: 'female',
  oceanic_rival: 'male',
  lunar_rival: 'female',
  planetary_rival: 'male',
}

function castHash(value: string) {
  let hash = 2166136261
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return hash >>> 0
}

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
  activity?: StylizedCharacterActivity
  /** Stable cast identity used to vary appearance without loading a 2D sprite. */
  identity?: string
}

export function Person({
  gender,
  tier = 0,
  variant = 0,
  direction = 'down',
  walking = false,
  mood = 'neutral',
  className = '',
  label,
  identity,
  activity = 'idle',
}: PersonProps) {
  const seed = castHash(identity ?? `cast-${variant}`)
  const identityGender = identity ? castGenders[identity] : undefined
  const resolvedGender = gender ?? identityGender ?? (seed % 2 ? 'female' : 'male')
  return (
    <span className={`av-person av-person-three facing-${direction} mood-${mood} ${walking ? 'is-walking' : ''} ${className}`}>
      <Suspense fallback={null}>
        <StylizedCharacter
          gender={resolvedGender}
          tier={tier}
          walking={walking}
          direction={direction === 'left' ? 'left' : direction === 'right' ? 'right' : 'front'}
          mood={mood}
          activity={activity}
          paletteSeed={seed}
          role={identity ? 'visitor' : 'counsel'}
          label={label}
          // `Person` renders in card grids (staff roster, catalog, rosters)
          // where many instances mount at once. The default 'full' mode gives
          // each its own dedicated WebGLRenderer/context, which silently blows
          // past the browser's simultaneous-context limit (commonly ~8-16) and
          // gets the oldest cards' contexts evicted — they go permanently
          // blank. 'scene' has nearly identical framing but shares one pooled
          // renderer across every instance, the same pattern RivalPortrait
          // already uses for its own many-at-once grid below.
          mode="scene"
        />
      </Suspense>
    </span>
  )
}

export type BustProps = {
  gender?: CharacterGender
  variant?: number
  tier?: number
  mood?: Mood
  judge?: boolean
  backdrop?: string
  className?: string
  label?: string
  /** Stable cast identity used to vary the shared 3D portrait. */
  identity?: string
}

export function Bust({
  gender,
  variant = 0,
  tier = 2,
  mood = 'neutral',
  judge = false,
  backdrop,
  className = '',
  label,
  identity,
}: BustProps) {
  const seed = castHash(identity ?? `portrait-${variant}`)
  const identityGender = identity ? castGenders[identity] : undefined
  const resolvedGender = gender ?? identityGender ?? (seed % 2 ? 'female' : 'male')
  const style = backdrop && backdrop !== 'none'
    ? { ['--bust-bg' as string]: backdrop }
    : undefined
  return (
    <span
      className={`av-bust mood-${mood} ${backdrop === 'none' ? 'bust-bare' : ''} ${className}`}
      style={style}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <Suspense fallback={null}>
        <StylizedCharacter
          gender={resolvedGender}
          tier={tier}
          role={judge ? 'judge' : 'visitor'}
          mode="portrait"
          mood={mood}
          paletteSeed={seed}
        />
      </Suspense>
      <i className="av-bust-sheen" aria-hidden="true" />
    </span>
  )
}
