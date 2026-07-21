import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react'

import './story-game.css'

export type StoryMode = 'diagnostic' | 'daily'
export type StoryOutcome = 'unresolved' | 'correct' | 'incorrect'
export type StoryEmotion =
  | 'neutral'
  | 'focused'
  | 'curious'
  | 'concerned'
  | 'suspicious'
  | 'surprised'
  | 'amused'
  | 'determined'
  | 'triumphant'
  | 'disappointed'

export type StoryLocation =
  | 'lantern-bureau'
  | 'rainy-alley'
  | 'grand-library'
  | 'midnight-train'
  | 'museum-gallery'
  | 'moonlit-harbor'
  | 'old-courthouse'
  | 'rooftop-observatory'

export type StoryWeather = 'clear' | 'rain' | 'storm' | 'snow' | 'fog' | 'embers'
export type StoryTimeOfDay = 'dawn' | 'day' | 'dusk' | 'night'
export type CharacterEntrance = 'left' | 'right' | 'rise' | 'fade'

type CharacterProfile = {
  name: string
  shortName: string
  role: string
  initials: string
  skin: string
  hair: string
  coat: string
  shirt: string
  accent: string
  entrance: CharacterEntrance
}

/**
 * The Lantern Bureau ensemble. Every portrait is assembled from HTML/CSS layers;
 * these values only provide palette and identity data—there are no image assets.
 */
export const STORY_CAST = {
  rowan: {
    name: 'Rowan Vale', shortName: 'Rowan', role: 'Field Detective', initials: 'RV',
    skin: '#b97756', hair: '#1e1718', coat: '#355164', shirt: '#d6c2a0', accent: '#e8b34f', entrance: 'left',
  },
  mira: {
    name: 'Chief Mira Voss', shortName: 'Mira', role: 'Bureau Chief', initials: 'MV',
    skin: '#8f513d', hair: '#17161d', coat: '#5c3049', shirt: '#ead7c2', accent: '#db6a62', entrance: 'right',
  },
  mori: {
    name: 'Mori Quill', shortName: 'Mori', role: 'Master of Misdirection', initials: 'MQ',
    skin: '#d19a77', hair: '#e4e0dc', coat: '#312946', shirt: '#a9a0c1', accent: '#a77bea', entrance: 'rise',
  },
  juniper: {
    name: 'Juniper Wren', shortName: 'June', role: 'Forensic Linguist', initials: 'JW',
    skin: '#7b4938', hair: '#2b1715', coat: '#365b4d', shirt: '#c8d7bf', accent: '#74c69d', entrance: 'fade',
  },
  theo: {
    name: 'Theo Flint', shortName: 'Theo', role: 'Street Informant', initials: 'TF',
    skin: '#d9a17d', hair: '#a94c32', coat: '#594934', shirt: '#e6c881', accent: '#ff9f43', entrance: 'left',
  },
  ada: {
    name: 'Ada Lumen', shortName: 'Ada', role: 'Cipher Engineer', initials: 'AL',
    skin: '#e4b99e', hair: '#ca9b43', coat: '#294d58', shirt: '#a9d7d9', accent: '#52d7d9', entrance: 'right',
  },
  felix: {
    name: 'Felix March', shortName: 'Felix', role: 'Archive Keeper', initials: 'FM',
    skin: '#7e503c', hair: '#453126', coat: '#674c36', shirt: '#d9c49f', accent: '#dbb66f', entrance: 'rise',
  },
  ines: {
    name: 'Ines Rook', shortName: 'Ines', role: 'Night Courier', initials: 'IR',
    skin: '#bd7457', hair: '#151a24', coat: '#27375c', shirt: '#b9c4de', accent: '#6e9ef5', entrance: 'right',
  },
  cass: {
    name: 'Cass Ember', shortName: 'Cass', role: 'Fire Investigator', initials: 'CE',
    skin: '#5f392f', hair: '#201b21', coat: '#602f2c', shirt: '#dab7a0', accent: '#ef6b48', entrance: 'left',
  },
  orion: {
    name: 'Orion Bell', shortName: 'Orion', role: 'Celestial Cartographer', initials: 'OB',
    skin: '#d4a07e', hair: '#3b2d48', coat: '#303967', shirt: '#c7c6e8', accent: '#9b8cff', entrance: 'fade',
  },
  sol: {
    name: 'Sol Mercado', shortName: 'Sol', role: 'Courtroom Advocate', initials: 'SM',
    skin: '#9b5f44', hair: '#181720', coat: '#3c4252', shirt: '#e1cfb4', accent: '#f1c45b', entrance: 'rise',
  },
  nia: {
    name: 'Nia North', shortName: 'Nia', role: 'Rookie Detective', initials: 'NN',
    skin: '#56352d', hair: '#15181d', coat: '#2f5960', shirt: '#bcd9d0', accent: '#63d2bd', entrance: 'left',
  },
  rowan_vale: {
    name: 'Rowan Vale', shortName: 'Rowan', role: 'Consulting Detective', initials: 'RV',
    skin: '#b97756', hair: '#1e1718', coat: '#8b6237', shirt: '#d6c2a0', accent: '#e9b44c', entrance: 'left',
  },
  mira_voss: {
    name: 'Chief Mira Voss', shortName: 'Mira', role: 'Bureau Director', initials: 'MV',
    skin: '#8f513d', hair: '#28232c', coat: '#6f2f48', shirt: '#ead7c2', accent: '#d95d78', entrance: 'right',
  },
  mori_quill: {
    name: 'Professor Mori Quill', shortName: 'Quill', role: 'Architect of False Conclusions', initials: 'MQ',
    skin: '#d19a77', hair: '#e4e0dc', coat: '#312946', shirt: '#a9a0c1', accent: '#9368b7', entrance: 'rise',
  },
  aria_lux: {
    name: 'Aria Lux', shortName: 'Aria', role: 'Rain Archive Keeper', initials: 'AX',
    skin: '#bc7958', hair: '#2a2238', coat: '#28536b', shirt: '#b9e4f3', accent: '#66c7f2', entrance: 'fade',
  },
  theo_brass: {
    name: 'Theo Brass', shortName: 'Theo', role: 'Inference Engineer', initials: 'TB',
    skin: '#d9a17d', hair: '#6c3526', coat: '#6d4931', shirt: '#e6c881', accent: '#e07a3f', entrance: 'left',
  },
  juniper_wren: {
    name: 'Juniper Wren', shortName: 'Juniper', role: 'Field Naturalist', initials: 'JW',
    skin: '#7b4938', hair: '#2b1715', coat: '#365b4d', shirt: '#c8d7bf', accent: '#67b26f', entrance: 'fade',
  },
  cassian_noir: {
    name: 'Cassian Noir', shortName: 'Cassian', role: 'Crown Inspector', initials: 'CN',
    skin: '#b87355', hair: '#111820', coat: '#29384f', shirt: '#c5ccd7', accent: '#7a8ca5', entrance: 'right',
  },
  zoya_ember: {
    name: 'Dr. Zoya Ember', shortName: 'Zoya', role: 'Forensic Linguist', initials: 'ZE',
    skin: '#8a503d', hair: '#191720', coat: '#743e34', shirt: '#f0c1a9', accent: '#ff7f6a', entrance: 'rise',
  },
  finn_locke: {
    name: 'Finn Locke', shortName: 'Finn', role: 'Bureau Courier', initials: 'FL',
    skin: '#d29a74', hair: '#5b3927', coat: '#22645f', shirt: '#b8e2db', accent: '#2ec4b6', entrance: 'right',
  },
  elias_clock: {
    name: 'Elias Clock', shortName: 'Elias', role: 'Chronologist', initials: 'EC',
    skin: '#a9674d', hair: '#e0d8c8', coat: '#624a35', shirt: '#d8c59f', accent: '#c6a15b', entrance: 'rise',
  },
  nyx_marble: {
    name: 'Nyx Marble', shortName: 'Nyx', role: 'Midnight Informant', initials: 'NM',
    skin: '#7e4a43', hair: '#c9c7d2', coat: '#474258', shirt: '#c5bdd8', accent: '#a58ae8', entrance: 'fade',
  },
  solenne_rain: {
    name: 'Advocate Solenne Rain', shortName: 'Solenne', role: 'Glass Court Counsel', initials: 'SR',
    skin: '#9e6048', hair: '#171b26', coat: '#275782', shirt: '#c3def0', accent: '#5aa9e6', entrance: 'right',
  },
  otto_morrow: {
    name: 'Otto Morrow', shortName: 'Otto', role: 'Master Watchmaker', initials: 'OM',
    skin: '#d0a17d', hair: '#f0e8dc', coat: '#624c3c', shirt: '#d8bc8f', accent: '#b58b5d', entrance: 'rise',
  },
  imani_cross: {
    name: 'Imani Cross', shortName: 'Imani', role: 'Behavioral Profiler', initials: 'IC',
    skin: '#60372f', hair: '#15151c', coat: '#34343d', shirt: '#dca969', accent: '#f2a65a', entrance: 'left',
  },
  vesper_ash: {
    name: 'Vesper Ash', shortName: 'Vesper', role: 'Stage Illusionist', initials: 'VA',
    skin: '#c78062', hair: '#2a1932', coat: '#622d68', shirt: '#d6addc', accent: '#cf6bdd', entrance: 'fade',
  },
  piper_glass: {
    name: 'Piper Glass', shortName: 'Piper', role: 'Junior Lantern', initials: 'PG',
    skin: '#8c543f', hair: '#30221b', coat: '#5d5730', shirt: '#f2da77', accent: '#f4d35e', entrance: 'left',
  },
  sable_reed: {
    name: 'Captain Sable Reed', shortName: 'Sable', role: 'River Patrol Commander', initials: 'SR',
    skin: '#4e302c', hair: '#131a1f', coat: '#294e5b', shirt: '#acc9d0', accent: '#40798c', entrance: 'right',
  },
} as const satisfies Record<string, CharacterProfile>

export type StoryCharacterId = keyof typeof STORY_CAST

export type StoryDialogue = {
  id?: string
  speaker: StoryCharacterId
  text: string
  emotion?: StoryEmotion
  /** A short action shown above the spoken line, such as "unfolds the map". */
  stageDirection?: string
  /** Optional brief emphasis displayed as a dossier tag. */
  emphasis?: string
  /** Time to linger on the completed line before autoplay advances. */
  holdMs?: number
  /** LLM-directed actor motion such as point, pace, write, nod, or whisper. */
  animation?: string
}

export type StoryCastMember = {
  character: StoryCharacterId
  entrance?: CharacterEntrance
  emotion?: StoryEmotion
  /** Optional position hint. Automatic placement is used when omitted. */
  position?: 'far-left' | 'left' | 'center' | 'right' | 'far-right'
}

export type StoryBeat = {
  /** Stable id; changing it restarts entrances and dialogue. */
  id: string
  title: string
  eyebrow?: string
  chapter?: string | number
  location: StoryLocation | string
  locationLabel?: string
  timeOfDay?: StoryTimeOfDay
  weather?: StoryWeather
  lighting?: 'warm' | 'cool' | 'moonlit' | 'neon' | 'golden'
  mood?: 'mysterious' | 'urgent' | 'hopeful' | 'ominous' | 'playful'
  narration?: string
  objective?: string
  stakes?: string
  clue?: { label?: string; text: string }
  sequence?: { current: number; total: number; label?: string }
  cast?: StoryCastMember[]
  dialogue: StoryDialogue[]
  outcomes?: {
    correct?: { title?: string; text: string }
    incorrect?: { title?: string; text: string }
  }
}

export type AnimatedStoryStageProps = {
  beat: StoryBeat
  mode: StoryMode
  outcome?: StoryOutcome
  loading?: boolean
  compact?: boolean
  autoPlay?: boolean
  className?: string
  /** Fires after the establishing shot has entered and is safe to reveal beside the question. */
  onStoryReady?: (beatId: string) => void
  onDialogueComplete?: (beatId: string) => void
}

type StoryCssProperties = CSSProperties & {
  '--skin': string
  '--hair': string
  '--coat': string
  '--shirt': string
  '--accent': string
  '--actor-index': number
  '--actor-count': number
}

const PARTICLES = Array.from({ length: 32 }, (_, index) => index)
const STARS = Array.from({ length: 24 }, (_, index) => index)

const LOCATION_LABELS: Record<StoryLocation, string> = {
  'lantern-bureau': 'The Lantern Bureau',
  'rainy-alley': 'Blackglass Alley',
  'grand-library': 'The Aster Library',
  'midnight-train': 'The Northbound Night Train',
  'museum-gallery': 'Halcyon Museum',
  'moonlit-harbor': 'Cinderlight Harbor',
  'old-courthouse': 'Old Meridian Court',
  'rooftop-observatory': 'Bellweather Observatory',
}

function normalizeLocation(location: string): StoryLocation {
  const value = location.toLowerCase()
  if (value.includes('alley') || value.includes('street')) return 'rainy-alley'
  if (value.includes('library') || value.includes('archive')) return 'grand-library'
  if (value.includes('train') || value.includes('rail')) return 'midnight-train'
  if (value.includes('museum') || value.includes('gallery')) return 'museum-gallery'
  if (value.includes('harbor') || value.includes('dock') || value.includes('pier')) return 'moonlit-harbor'
  if (value.includes('court')) return 'old-courthouse'
  if (value.includes('roof') || value.includes('observatory')) return 'rooftop-observatory'
  return 'lantern-bureau'
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return reduced
}

function SceneArchitecture({ location }: { location: StoryLocation }) {
  return (
    <div className="asg-architecture" aria-hidden="true">
      <div className="asg-skyline asg-skyline--far">
        {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
      </div>
      <div className="asg-skyline asg-skyline--near">
        {Array.from({ length: 7 }, (_, index) => <i key={index} />)}
      </div>
      <div className="asg-bureau-set">
        <div className="asg-bureau-window"><i /><i /><i /><i /></div>
        <div className="asg-desk"><span /></div>
        <div className="asg-caseboard"><i /><i /><i /><b /><b /></div>
      </div>
      <div className="asg-library-set">
        <div className="asg-shelf asg-shelf--one">{Array.from({ length: 14 }, (_, index) => <i key={index} />)}</div>
        <div className="asg-shelf asg-shelf--two">{Array.from({ length: 14 }, (_, index) => <i key={index} />)}</div>
        <div className="asg-library-ladder" />
      </div>
      <div className="asg-train-set">
        <div className="asg-train-window"><i /><i /><span /></div>
        <div className="asg-luggage-rack">{Array.from({ length: 4 }, (_, index) => <i key={index} />)}</div>
      </div>
      <div className="asg-museum-set">
        <div className="asg-column asg-column--one" />
        <div className="asg-column asg-column--two" />
        <div className="asg-display-case"><i /></div>
        <div className="asg-frame"><span /></div>
      </div>
      <div className="asg-harbor-set">
        <div className="asg-lighthouse"><i /></div>
        <div className="asg-boat"><i /><span /></div>
        <div className="asg-water-lines"><i /><i /><i /></div>
      </div>
      <div className="asg-court-set">
        <div className="asg-court-columns">{Array.from({ length: 5 }, (_, index) => <i key={index} />)}</div>
        <div className="asg-scales"><i /><b /><span /></div>
      </div>
      <div className="asg-rooftop-set">
        <div className="asg-telescope"><i /><b /><span /></div>
        <div className="asg-roof-rail" />
      </div>
      <div className="asg-alley-set">
        <div className="asg-fire-escape"><i /><i /><i /><span /></div>
        <div className="asg-neon-sign">LANTERN</div>
      </div>
      <div className="asg-location-floor" data-floor={location} />
    </div>
  )
}

function WeatherLayer({ weather }: { weather: StoryWeather }) {
  return (
    <div className={`asg-weather asg-weather--${weather}`} aria-hidden="true">
      {PARTICLES.map((particle) => <i key={particle} style={{ '--particle': particle } as CSSProperties} />)}
    </div>
  )
}

function CharacterSprite({
  member,
  index,
  count,
  speaking,
  emotion,
  outcome,
  beatId,
  animation,
}: {
  member: StoryCastMember
  index: number
  count: number
  speaking: boolean
  emotion: StoryEmotion
  outcome: StoryOutcome
  beatId: string
  animation?: string
}) {
  const profile = STORY_CAST[member.character]
  const entrance = member.entrance ?? profile.entrance
  const style: StoryCssProperties = {
    '--skin': profile.skin,
    '--hair': profile.hair,
    '--coat': profile.coat,
    '--shirt': profile.shirt,
    '--accent': profile.accent,
    '--actor-index': index,
    '--actor-count': count,
  }

  return (
    <div
      key={`${beatId}-${member.character}`}
      className={`asg-actor asg-character--${member.character} asg-entrance--${entrance}${speaking ? ' is-speaking' : ''}`}
      data-emotion={emotion}
      data-position={member.position ?? 'auto'}
      data-outcome={outcome}
      data-animation={animation || 'breathe'}
      style={style}
      aria-label={`${profile.name}, ${profile.role}${speaking ? ', speaking' : ''}`}
    >
      <div className="asg-actor-glow" aria-hidden="true" />
      <div className="asg-actor-shadow" aria-hidden="true" />
      <div className="asg-character" aria-hidden="true">
        <div className="asg-hair-back" />
        <div className="asg-character-body">
          <div className="asg-arm asg-arm--left"><i /></div>
          <div className="asg-arm asg-arm--right"><i /></div>
          <div className="asg-torso"><i className="asg-lapel asg-lapel--left" /><i className="asg-lapel asg-lapel--right" /><b /></div>
          <div className="asg-neck" />
        </div>
        <div className="asg-head">
          <i className="asg-ear asg-ear--left" />
          <i className="asg-ear asg-ear--right" />
          <div className="asg-brows"><i /><i /></div>
          <div className="asg-eyes">
            <i><b /></i><i><b /></i>
          </div>
          <div className="asg-nose" />
          <div className="asg-mouth"><i /></div>
          <div className="asg-face-detail" />
        </div>
        <div className="asg-hair-front"><i /></div>
        <div className="asg-accessory"><i /><b /><span /></div>
      </div>
      <div className="asg-actor-label">
        <span>{profile.shortName}</span>
        <small>{profile.role}</small>
      </div>
    </div>
  )
}

function resolveCast(beat: StoryBeat, mode: StoryMode): StoryCastMember[] {
  if (beat.cast?.length) {
    const seen = new Set<StoryCharacterId>()
    return beat.cast.filter((member) => {
      if (seen.has(member.character)) return false
      seen.add(member.character)
      return true
    }).slice(0, 5)
  }

  const speakerIds = beat.dialogue.map((line) => line.speaker)
  const unique = [...new Set(speakerIds)]
  if (!unique.length) unique.push(mode === 'diagnostic' ? 'nia' : 'rowan')
  return unique.slice(0, 5).map((character) => ({ character }))
}

function outcomeCopy(beat: StoryBeat, outcome: StoryOutcome) {
  if (outcome === 'correct') {
    return {
      title: beat.outcomes?.correct?.title ?? 'The evidence holds.',
      text: beat.outcomes?.correct?.text ?? 'A clean deduction. The case opens another inch.',
    }
  }
  if (outcome === 'incorrect') {
    return {
      title: beat.outcomes?.incorrect?.title ?? 'A false lead flickers.',
      text: beat.outcomes?.incorrect?.text ?? 'No case is lost here—mark the trap, repair the inference, and continue.',
    }
  }
  return null
}

/**
 * A code-native cinematic vignette for diagnostic and daily story beats.
 * It deliberately accepts no question/stimulus fields so assessment content
 * remains readable, selectable HTML in the neighboring evidence panel.
 */
export function AnimatedStoryStage({
  beat,
  mode,
  outcome = 'unresolved',
  loading = false,
  compact = false,
  autoPlay = true,
  className = '',
  onStoryReady,
  onDialogueComplete,
}: AnimatedStoryStageProps) {
  const reducedMotion = useReducedMotion()
  const [lineIndex, setLineIndex] = useState(0)
  const [visibleCharacters, setVisibleCharacters] = useState(0)
  const [dialogueComplete, setDialogueComplete] = useState(false)
  const [playing, setPlaying] = useState(autoPlay && !reducedMotion)
  const [motionPaused, setMotionPaused] = useState(reducedMotion)
  const readyCallback = useRef(onStoryReady)
  const completeCallback = useRef(onDialogueComplete)

  readyCallback.current = onStoryReady
  completeCallback.current = onDialogueComplete

  const location = normalizeLocation(beat.location)
  const weather = beat.weather ?? (location === 'rainy-alley' ? 'rain' : location === 'moonlit-harbor' ? 'fog' : 'clear')
  const timeOfDay = beat.timeOfDay ?? 'night'
  const cast = useMemo(() => resolveCast(beat, mode), [beat, mode])
  const currentLine = beat.dialogue[lineIndex]
  const fullText = currentLine?.text ?? ''
  const isTyping = visibleCharacters < fullText.length
  const currentOutcome = outcomeCopy(beat, outcome)

  useEffect(() => {
    setLineIndex(0)
    setVisibleCharacters(0)
    setDialogueComplete(beat.dialogue.length === 0)
    setPlaying(autoPlay && !reducedMotion)
    setMotionPaused(reducedMotion)
  }, [beat.id, beat.dialogue.length, autoPlay, reducedMotion])

  useEffect(() => {
    if (loading) return undefined
    const timer = window.setTimeout(
      () => readyCallback.current?.(beat.id),
      reducedMotion ? 0 : 760,
    )
    return () => window.clearTimeout(timer)
  }, [beat.id, loading, reducedMotion])

  useEffect(() => {
    if (!currentLine || loading) return undefined
    if (reducedMotion) {
      setVisibleCharacters(currentLine.text.length)
      return undefined
    }
    if (motionPaused) return undefined
    if (visibleCharacters >= currentLine.text.length) return undefined

    const punctuation = currentLine.text[Math.max(0, visibleCharacters - 1)]
    const pause = /[.!?]/.test(punctuation) ? 105 : /[,;:—]/.test(punctuation) ? 58 : 22
    const timer = window.setTimeout(() => {
      setVisibleCharacters((value) => Math.min(currentLine.text.length, value + 1))
    }, pause)
    return () => window.clearTimeout(timer)
  }, [currentLine, loading, reducedMotion, visibleCharacters, motionPaused])

  useEffect(() => {
    if (!playing || loading || !currentLine || isTyping || dialogueComplete) return undefined
    if (lineIndex >= beat.dialogue.length - 1) {
      setDialogueComplete(true)
      completeCallback.current?.(beat.id)
      return undefined
    }
    const timer = window.setTimeout(() => {
      setLineIndex((value) => value + 1)
      setVisibleCharacters(0)
    }, reducedMotion ? 2600 : currentLine.holdMs ?? 2400)
    return () => window.clearTimeout(timer)
  }, [playing, beat.dialogue.length, beat.id, currentLine, dialogueComplete, isTyping, lineIndex, loading, reducedMotion])

  const advanceDialogue = () => {
    if (!currentLine) return
    if (isTyping) {
      setVisibleCharacters(currentLine.text.length)
      return
    }
    if (lineIndex < beat.dialogue.length - 1) {
      setLineIndex((value) => value + 1)
      setVisibleCharacters(0)
      return
    }
    if (!dialogueComplete) {
      setDialogueComplete(true)
      completeCallback.current?.(beat.id)
    }
  }

  const skipStory = () => {
    const finalIndex = Math.max(0, beat.dialogue.length - 1)
    const finalLine = beat.dialogue[finalIndex]
    setLineIndex(finalIndex)
    setVisibleCharacters(finalLine?.text.length ?? 0)
    if (!dialogueComplete) completeCallback.current?.(beat.id)
    setDialogueComplete(true)
  }

  const replayStory = () => {
    setLineIndex(0)
    setVisibleCharacters(reducedMotion ? beat.dialogue[0]?.text.length ?? 0 : 0)
    setDialogueComplete(false)
  }

  const handleDialogueClick = (event: MouseEvent<HTMLButtonElement>) => {
    if ((event.target as HTMLElement).closest('.asg-dialogue-control')) return
    advanceDialogue()
  }

  const modeLabel = mode === 'diagnostic' ? 'Prologue · Field Evaluation' : 'Lantern Bureau · Active Case'
  const suppliedLocation = beat.location.trim()
  const isCanonicalLocation = Object.prototype.hasOwnProperty.call(LOCATION_LABELS, suppliedLocation)
  const locationLabel = beat.locationLabel
    ?? ((isCanonicalLocation ? LOCATION_LABELS[suppliedLocation as StoryLocation] : suppliedLocation)
      || LOCATION_LABELS[location])
  const progress = beat.sequence
    ? Math.max(0, Math.min(100, (beat.sequence.current / Math.max(1, beat.sequence.total)) * 100))
    : undefined

  return (
    <section
      className={`asg-stage ${compact ? 'asg-stage--compact' : ''} ${className}`.trim()}
      data-location={location}
      data-weather={weather}
      data-time={timeOfDay}
      data-lighting={beat.lighting ?? 'moonlit'}
      data-mood={beat.mood ?? 'mysterious'}
      data-outcome={outcome}
      data-motion={motionPaused ? 'paused' : 'playing'}
      aria-label={`${beat.title}, story scene at ${locationLabel}`}
    >
      <div className="asg-cinema" aria-hidden="true">
        <div className="asg-sky" />
        <div className="asg-aurora" />
        <div className="asg-stars">
          {STARS.map((star) => <i key={star} style={{ '--star': star } as CSSProperties} />)}
        </div>
        <div className="asg-celestial"><i /></div>
        <SceneArchitecture location={location} />
        <div className="asg-depth-fog asg-depth-fog--back" />
        <div className="asg-light-beam asg-light-beam--left" />
        <div className="asg-light-beam asg-light-beam--right" />
        <div className="asg-ambient-crowd">
          {Array.from({ length: 7 }, (_, index) => <i key={index} />)}
        </div>
        <div className="asg-cast">
          {cast.map((member, index) => {
            const activeLine = currentLine?.speaker === member.character
            return (
              <CharacterSprite
                key={`${beat.id}-${member.character}`}
                beatId={beat.id}
                member={member}
                index={index}
                count={cast.length}
                speaking={Boolean(activeLine && !loading)}
                emotion={activeLine ? currentLine.emotion ?? 'focused' : member.emotion ?? 'neutral'}
                outcome={outcome}
                animation={activeLine ? currentLine.animation : undefined}
              />
            )
          })}
        </div>
        <WeatherLayer weather={weather} />
        <div className="asg-depth-fog asg-depth-fog--front" />
        <div className="asg-vignette" />
        <div className="asg-film-grain" />
        <div className="asg-outcome-burst">
          {Array.from({ length: 16 }, (_, index) => <i key={index} style={{ '--burst': index } as CSSProperties} />)}
        </div>
      </div>

      <header className="asg-scene-header">
        <div className="asg-mode-badge"><i />{modeLabel}</div>
        <div className="asg-location-badge"><span aria-hidden="true">⌖</span>{locationLabel}</div>
      </header>

      <div className="asg-briefing">
        <div className="asg-briefing-copy">
          <div className="asg-title-card">
            {beat.eyebrow && <span>{beat.eyebrow}</span>}
            <h2>{beat.title}</h2>
            {beat.chapter != null && <small>{typeof beat.chapter === 'number' ? `Chapter ${beat.chapter}` : beat.chapter}</small>}
          </div>

          {beat.narration && (
            <div className="asg-narration"><i />{beat.narration}</div>
          )}
        </div>

        <div className="asg-briefing-intel">
          {(beat.objective || beat.stakes) && (
            <aside className="asg-mission-card">
              {beat.objective && <div><small>OBJECTIVE</small><strong>{beat.objective}</strong></div>}
              {beat.stakes && <p>{beat.stakes}</p>}
            </aside>
          )}

          {beat.clue && (
            <aside className="asg-clue-card">
              <span aria-hidden="true">✦</span>
              <div><small>{beat.clue.label ?? 'STORY CLUE'}</small><p>{beat.clue.text}</p></div>
            </aside>
          )}
        </div>
      </div>

      {currentOutcome && (
        <div className="asg-outcome-card" role="status">
          <span>{outcome === 'correct' ? '✓' : '↺'}</span>
          <div><strong>{currentOutcome.title}</strong><p>{currentOutcome.text}</p></div>
        </div>
      )}

      <div className="asg-dialogue-shell">
        {currentLine && <span className="asg-sr-only" role="status" aria-live="polite">{STORY_CAST[currentLine.speaker].name}: {currentLine.text}</span>}
        {currentLine ? (
          <button className="asg-dialogue" type="button" onClick={handleDialogueClick} aria-label={isTyping ? 'Reveal the complete dialogue line' : 'Advance to the next dialogue line'}>
            <span className={`asg-speaker-seal asg-speaker-seal--${currentLine.speaker}`} aria-hidden="true">
              {STORY_CAST[currentLine.speaker].initials}
            </span>
            <span className="asg-dialogue-copy">
              <span className="asg-dialogue-meta">
                <strong>{STORY_CAST[currentLine.speaker].name}</strong>
                <em>{STORY_CAST[currentLine.speaker].role}</em>
                {currentLine.emphasis && <b>{currentLine.emphasis}</b>}
              </span>
              {currentLine.stageDirection && <small>* {currentLine.stageDirection} *</small>}
              <span className="asg-spoken-line" aria-hidden="true">
                “{currentLine.text.slice(0, visibleCharacters)}<i className={isTyping ? 'is-visible' : ''} />{!isTyping && '”'}
              </span>
            </span>
            <span className="asg-advance" aria-hidden="true">{isTyping ? '•••' : lineIndex < beat.dialogue.length - 1 ? '›' : '✓'}</span>
          </button>
        ) : (
          <div className="asg-dialogue asg-dialogue--empty"><span>The scene is set. Examine the evidence when you are ready.</span></div>
        )}

        <div className="asg-playback">
          <div className="asg-line-dots" aria-label={`Dialogue line ${Math.min(lineIndex + 1, beat.dialogue.length)} of ${beat.dialogue.length}`}>
            {beat.dialogue.map((line, index) => (
              <button
                type="button"
                key={line.id ?? `${line.speaker}-${index}`}
                className={index === lineIndex ? 'is-active' : index < lineIndex ? 'is-seen' : ''}
                onClick={() => {
                  setLineIndex(index)
                  setVisibleCharacters(reducedMotion ? line.text.length : 0)
                  setDialogueComplete(false)
                }}
                aria-label={`Show dialogue line ${index + 1}`}
              />
            ))}
          </div>
          <div className="asg-dialogue-controls">
            <button type="button" className="asg-dialogue-control" onClick={() => setPlaying((value) => !value)} disabled={dialogueComplete || !beat.dialogue.length}>{playing ? 'Pause autoplay' : 'Resume autoplay'}</button>
            <button type="button" className="asg-dialogue-control" onClick={() => setMotionPaused((value) => !value)} disabled={reducedMotion}>{reducedMotion ? 'Motion reduced' : motionPaused ? 'Resume animation' : 'Pause animation'}</button>
            <button type="button" className="asg-dialogue-control" onClick={skipStory} disabled={dialogueComplete || !beat.dialogue.length}>Skip</button>
            <button type="button" className="asg-dialogue-control" onClick={replayStory} disabled={!beat.dialogue.length}><span aria-hidden="true">↺</span> Replay</button>
          </div>
        </div>
      </div>

      {beat.sequence && (
        <div className="asg-sequence">
          <div><span>{beat.sequence.label ?? (mode === 'diagnostic' ? 'Diagnostic story' : 'Case progress')}</span><strong>{beat.sequence.current}/{beat.sequence.total}</strong></div>
          <i><b style={{ width: `${progress}%` }} /></i>
        </div>
      )}

      {loading && (
        <div className="asg-loading" role="status" aria-live="polite">
          <div className="asg-loading-orbit"><i /><i /><i /></div>
          <strong>Writing the next scene…</strong>
          <span>The Bureau is matching this story beat to the evidence file.</span>
        </div>
      )}
    </section>
  )
}

export default AnimatedStoryStage
