/* Image-based character system. Sprites are AI-painted full-body figures and
   busts with transparent backgrounds (see /public/art). The exported API is
   unchanged from the old vector system so scene code keeps working; `src`
   lets call sites pin a specific cast member. */

import type { CharacterGender } from '../types'
import { castArt, clientArt, judgeArt, keyHash, playerArt, CLIENT_KINDS } from './assets'

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
  /** Explicit sprite URL; overrides the gender/tier/variant lookup. */
  src?: string
}

export function Person({
  gender = 'female',
  tier = 0,
  variant = 0,
  direction = 'down',
  walking = false,
  mood = 'neutral',
  className = '',
  label,
  src,
}: PersonProps) {
  const sprite = src ?? (variant === 0 ? playerArt(gender, tier) : castArt(gender, variant))
  return (
    <span
      className={`av-person facing-${direction} mood-${mood} ${walking ? 'is-walking' : ''} ${className}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <i className="av-person-shadow" aria-hidden="true" />
      <img className="av-person-img" src={sprite} alt="" draggable={false} loading="lazy" />
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
  /** Explicit bust URL; overrides the generic ensemble lookup. */
  src?: string
}

export function Bust({
  gender = 'female',
  variant = 0,
  mood = 'neutral',
  judge = false,
  backdrop,
  className = '',
  label,
  src,
}: BustProps) {
  const sprite = src
    ?? (judge
      ? judgeArt(mood === 'happy')
      : clientArt(CLIENT_KINDS[(keyHash(gender) + variant * 5) % CLIENT_KINDS.length]))
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
      <img className="av-bust-img" src={sprite} alt="" draggable={false} loading="lazy" />
      <i className="av-bust-sheen" aria-hidden="true" />
    </span>
  )
}
