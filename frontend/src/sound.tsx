import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Music2, Volume2, VolumeX } from 'lucide-react'


export type SoundCue =
  | 'navigate'
  | 'tab'
  | 'select'
  | 'paper'
  | 'file-open'
  | 'submit'
  | 'verdict-correct'
  | 'verdict-repair'
  | 'reasoning-validated'
  | 'ledger'
  | 'bonus'
  | 'purchase'
  | 'promotion'
  | 'client'
  | 'map'
  | 'story'
  | 'event'
  | 'collect'
  | 'cat'
  | 'coffee'
  | 'pause'
  | 'resume'
  | 'error'
  | 'toggle'

export type StoryAlignment = 'Principled' | 'Pragmatic' | 'Ruthless'

export type SoundProfile = {
  /** A stable, non-secret identifier such as the game id. */
  seed: string
  officeTier: number
  alignment: StoryAlignment
}

export type SoundPreferences = {
  muted: boolean
  /** Normalized effects volume. The engine applies an additional safe ceiling. */
  volume: number
  /** Uses one short layer per action and removes decorative tails. */
  reducedAudio: boolean
  /** A quiet, original procedural score for the Office and World scenes. */
  ambientEnabled: boolean
  /** Intentionally capped well below the effects mix. */
  ambientVolume: number
}

export type AmbientScene = 'office' | 'city' | 'nation' | 'ocean' | 'continent' | 'orbit'

export type SoundPlayOptions = {
  /** Prevents React StrictMode effects or remounts from replaying an event. */
  id?: string
  /** Overrides the stable variation seed for this event. */
  seed?: string
  /** Per-event multiplier, clamped to a conservative range. */
  intensity?: number
  /** Selects a restrained environmental motif for scene transitions. */
  scene?: 'city' | 'nation' | 'ocean' | 'continent' | 'orbit'
  profile?: Partial<SoundProfile>
}

export type TrustedInteraction = Event | { nativeEvent: Event }

export type SoundApi = SoundPreferences & {
  supported: boolean
  unlocked: boolean
  play: (cue: SoundCue, options?: SoundPlayOptions) => Promise<boolean>
  unlock: (interaction?: TrustedInteraction) => Promise<boolean>
  setMuted: (muted: boolean) => void
  toggleMuted: () => void
  setVolume: (volume: number) => void
  setReducedAudio: (reduced: boolean) => void
  setAmbientEnabled: (enabled: boolean) => void
  setAmbientVolume: (volume: number) => void
  startAmbient: (scene: AmbientScene) => boolean
  stopAmbient: () => void
}

export type SoundProfileApi = {
  profile: SoundProfile
  setProfile: (profile: Partial<SoundProfile> | ((current: SoundProfile) => Partial<SoundProfile>)) => void
}

export type SoundProviderProps = {
  children: ReactNode
  profile?: Partial<SoundProfile>
}

export type SoundControlsProps = {
  className?: string
  compact?: boolean
  showReducedAudio?: boolean
}


export const SOUND_STORAGE_KEY = 'lawyer-tycoon:sound:v1'

const DEFAULT_PREFERENCES: SoundPreferences = {
  muted: false,
  volume: 0.24,
  reducedAudio: false,
  ambientEnabled: true,
  ambientVolume: 0.22,
}

const DEFAULT_PROFILE: SoundProfile = {
  seed: 'lawyer-tycoon',
  officeTier: 0,
  alignment: 'Pragmatic',
}

const SoundContext = createContext<(SoundApi & SoundProfileApi) | null>(null)


function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum))
}


function normalizeProfile(profile?: Partial<SoundProfile>, base = DEFAULT_PROFILE): SoundProfile {
  const alignment = profile?.alignment
  return {
    seed: profile?.seed?.trim() || base.seed,
    officeTier: Math.round(clamp(profile?.officeTier ?? base.officeTier, 0, 14)),
    alignment: alignment === 'Principled' || alignment === 'Ruthless' || alignment === 'Pragmatic'
      ? alignment
      : base.alignment,
  }
}


function readPreferences(): SoundPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES
  try {
    const raw = window.localStorage.getItem(SOUND_STORAGE_KEY)
    if (!raw) return DEFAULT_PREFERENCES
    const value = JSON.parse(raw) as Partial<SoundPreferences>
    return {
      muted: typeof value.muted === 'boolean' ? value.muted : DEFAULT_PREFERENCES.muted,
      volume: clamp(typeof value.volume === 'number' ? value.volume : DEFAULT_PREFERENCES.volume, 0, 1),
      reducedAudio: typeof value.reducedAudio === 'boolean' ? value.reducedAudio : DEFAULT_PREFERENCES.reducedAudio,
      ambientEnabled: typeof value.ambientEnabled === 'boolean' ? value.ambientEnabled : DEFAULT_PREFERENCES.ambientEnabled,
      ambientVolume: clamp(typeof value.ambientVolume === 'number' ? value.ambientVolume : DEFAULT_PREFERENCES.ambientVolume, 0, 1),
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}


function writePreferences(preferences: SoundPreferences) {
  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Storage may be unavailable in private modes. Sound remains session-local.
  }
}


function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}


function pitch(frequency: number, semitones: number) {
  return frequency * 2 ** (semitones / 12)
}


type AudioContextConstructor = new () => AudioContext
type AudioWindow = Window & typeof globalThis & { webkitAudioContext?: AudioContextConstructor }

function audioConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null
  const audioWindow = window as AudioWindow
  return audioWindow.AudioContext ?? audioWindow.webkitAudioContext ?? null
}


const RATE_LIMIT_MS: Record<SoundCue, number> = {
  navigate: 120,
  tab: 70,
  select: 70,
  paper: 100,
  'file-open': 180,
  submit: 350,
  'verdict-correct': 650,
  'verdict-repair': 650,
  'reasoning-validated': 650,
  ledger: 280,
  bonus: 400,
  purchase: 450,
  promotion: 1200,
  client: 450,
  map: 180,
  story: 450,
  event: 500,
  collect: 300,
  cat: 500,
  coffee: 500,
  pause: 350,
  resume: 350,
  error: 450,
  toggle: 180,
}


class ProceduralSoundEngine {
  readonly context: AudioContext
  private readonly master: GainNode
  private readonly ambientMaster: GainNode
  private readonly compressor: DynamicsCompressorNode
  private readonly noiseBuffer: AudioBuffer
  private readonly lastCueAt = new Map<SoundCue, number>()
  private readonly playedIds = new Map<string, number>()
  private ambientBus: GainNode | null = null
  private ambientTimer: number | null = null
  private ambientScene: AmbientScene | null = null
  private ambientPhrase = 0

  constructor(Context: AudioContextConstructor) {
    this.context = new Context()
    this.master = this.context.createGain()
    this.ambientMaster = this.context.createGain()
    this.compressor = this.context.createDynamicsCompressor()
    this.compressor.threshold.value = -20
    this.compressor.knee.value = 18
    this.compressor.ratio.value = 5
    this.compressor.attack.value = 0.006
    this.compressor.release.value = 0.18
    this.master.gain.value = 0
    this.ambientMaster.gain.value = 0
    this.master.connect(this.compressor)
    this.ambientMaster.connect(this.compressor)
    this.compressor.connect(this.context.destination)

    const frames = Math.max(1, Math.floor(this.context.sampleRate * 0.75))
    this.noiseBuffer = this.context.createBuffer(1, frames, this.context.sampleRate)
    const data = this.noiseBuffer.getChannelData(0)
    let previous = 0
    for (let index = 0; index < frames; index += 1) {
      const white = Math.random() * 2 - 1
      previous = previous * 0.72 + white * 0.28
      data[index] = previous
    }
  }

  setVolume(volume: number) {
    const safeGain = clamp(volume, 0, 1) * 0.32
    const now = this.context.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setTargetAtTime(safeGain, now, 0.018)
  }

  setAmbientVolume(volume: number) {
    const safeGain = clamp(volume, 0, 1) * 0.14
    const now = this.context.currentTime
    this.ambientMaster.gain.cancelScheduledValues(now)
    this.ambientMaster.gain.setTargetAtTime(safeGain, now, 0.12)
  }

  startAmbient(scene: AmbientScene, profile: SoundProfile, preferences: SoundPreferences) {
    if (this.context.state !== 'running' || preferences.muted || !preferences.ambientEnabled || preferences.ambientVolume <= 0) {
      this.stopAmbient()
      return false
    }
    this.setAmbientVolume(preferences.ambientVolume)
    if (this.ambientScene === scene && this.ambientBus) return true

    this.stopAmbient()
    const now = this.context.currentTime
    const bus = this.context.createGain()
    bus.gain.setValueAtTime(0.0001, now)
    bus.gain.exponentialRampToValueAtTime(1, now + 0.45)
    bus.connect(this.ambientMaster)
    this.ambientBus = bus
    this.ambientScene = scene
    this.ambientPhrase = 0
    this.renderAmbientPhrase(scene, profile, bus)
    this.ambientTimer = window.setInterval(() => {
      if (!this.ambientBus || this.ambientScene !== scene || this.context.state !== 'running') return
      this.renderAmbientPhrase(scene, profile, this.ambientBus)
    }, 4_800)
    return true
  }

  stopAmbient() {
    if (this.ambientTimer !== null) {
      window.clearInterval(this.ambientTimer)
      this.ambientTimer = null
    }
    const bus = this.ambientBus
    this.ambientBus = null
    this.ambientScene = null
    if (!bus) return
    const now = this.context.currentTime
    bus.gain.cancelScheduledValues(now)
    bus.gain.setTargetAtTime(0.0001, now, 0.18)
    window.setTimeout(() => bus.disconnect(), 900)
  }

  async suspend() {
    this.stopAmbient()
    if (this.context.state === 'running') await this.context.suspend()
  }

  private renderAmbientPhrase(scene: AmbientScene, profile: SoundProfile, bus: GainNode) {
    const motifs: Record<AmbientScene, { root: number; chord: number[]; notes: number[]; color: number }> = {
      office: { root: 146.83, chord: [0, 3, 7, 10], notes: [0, 7, 3, 10, 7], color: 980 },
      city: { root: 164.81, chord: [0, 3, 7, 10], notes: [0, 7, 10, 3, 7], color: 1420 },
      nation: { root: 174.61, chord: [0, 4, 7, 11], notes: [0, 7, 4, 11, 7], color: 1180 },
      ocean: { root: 130.81, chord: [0, 5, 7, 10], notes: [0, 7, 5, 10, 5], color: 620 },
      continent: { root: 146.83, chord: [0, 4, 7, 9], notes: [0, 4, 9, 7, 4], color: 900 },
      orbit: { root: 110, chord: [0, 4, 7, 11], notes: [0, 11, 7, 4, 11], color: 520 },
    }
    const motif = motifs[scene]
    const at = this.context.currentTime + 0.06
    const variation = hashString(`${profile.seed}:${scene}:${this.ambientPhrase}`)
    const shift = [-2, 0, 2, 0][variation % 4]
    const root = pitch(motif.root * (1 + Math.min(4, Math.floor(profile.officeTier / 3)) * .012), shift)

    motif.chord.slice(0, 3).forEach((interval, index) => {
      this.tone(bus, at + index * .035, pitch(root, interval), 3.8, .032 - index * .004, scene === 'ocean' || scene === 'orbit' ? 'sine' : 'triangle')
    })
    motif.notes.forEach((interval, index) => {
      const offset = index * .74 + (scene === 'ocean' ? Math.sin(index + this.ambientPhrase) * .08 : 0)
      this.tone(bus, at + offset, pitch(root * 2, interval), .82, .037, scene === 'orbit' ? 'sine' : 'triangle', pitch(root * 2, interval + (index % 2 ? -1 : 0)))
    })
    if (scene === 'office' || scene === 'city' || scene === 'ocean') {
      this.noise(bus, at + .2, 1.7, .009, motif.color)
      this.noise(bus, at + 2.35, 1.1, .006, motif.color * 1.15)
    }
    this.ambientPhrase += 1
  }

  play(cue: SoundCue, profile: SoundProfile, preferences: SoundPreferences, options: SoundPlayOptions) {
    if (this.context.state !== 'running' || preferences.muted || preferences.volume <= 0) return false
    const nowMs = performance.now()
    const eventId = options.id ? `${cue}:${options.id}` : null
    if (eventId && this.playedIds.has(eventId)) return false
    const lastAt = this.lastCueAt.get(cue) ?? -Infinity
    if (nowMs - lastAt < RATE_LIMIT_MS[cue]) return false

    this.setVolume(preferences.volume)
    const bus = this.context.createGain()
    const intensity = clamp(options.intensity ?? 1, 0.25, 1.15)
    bus.gain.value = intensity
    bus.connect(this.master)

    const variation = hashString(`${profile.seed}:${options.seed ?? 'default'}:${cue}`)
    this.renderCue(cue, bus, profile, preferences.reducedAudio, variation, options.scene)
    this.lastCueAt.set(cue, nowMs)
    if (eventId) {
      this.playedIds.set(eventId, nowMs)
      if (this.playedIds.size > 512) {
        const oldest = this.playedIds.keys().next().value as string | undefined
        if (oldest) this.playedIds.delete(oldest)
      }
    }
    window.setTimeout(() => bus.disconnect(), preferences.reducedAudio ? 900 : 3000)
    return true
  }

  private renderCue(
    cue: SoundCue,
    bus: GainNode,
    profile: SoundProfile,
    reduced: boolean,
    variation: number,
    scene?: SoundPlayOptions['scene'],
  ) {
    const at = this.context.currentTime + 0.008
    const stage = Math.min(4, Math.floor(profile.officeTier / 3))
    const detune = [-8, -3, 0, 4, 7][variation % 5]
    const root = pitch(196 * (1 + stage * 0.015), detune / 100)
    const toneType: OscillatorType = stage < 2 ? 'triangle' : stage < 4 ? 'sine' : 'sine'
    const brightType: OscillatorType = stage < 3 ? 'triangle' : 'sine'
    const paperCutoff = 850 + stage * 320

    const tone = (
      start: number,
      frequency: number,
      duration: number,
      gain: number,
      type: OscillatorType = toneType,
      endFrequency?: number,
    ) => this.tone(bus, start, frequency, duration, gain, type, endFrequency)
    const paper = (start: number, duration: number, gain: number, cutoff = paperCutoff) =>
      this.noise(bus, start, duration, gain, cutoff)

    if (reduced) {
      if (cue === 'map') {
        const interval = scene === 'city' ? -7 : scene === 'nation' ? -5 : scene === 'ocean' ? -12 : scene === 'continent' ? -9 : 2
        const destination = scene === 'ocean' ? -5 : scene === 'orbit' ? 7 : interval + 4
        tone(at, pitch(root, interval), 0.2, 0.115, 'sine', pitch(root, destination))
        return
      }
      if (cue === 'paper' || cue === 'story' || cue === 'coffee') {
        paper(at, cue === 'coffee' ? 0.14 : 0.11, cue === 'coffee' ? 0.055 : 0.09, cue === 'coffee' ? 2400 : 1250)
        return
      }
      const reducedTone: Record<Exclude<SoundCue, 'paper' | 'map' | 'story' | 'coffee'>, [number, number, number, OscillatorType?]> = {
        navigate: [-5, -3, 0.08],
        tab: [7, 5, 0.055],
        select: [2, 2, 0.06],
        'file-open': [-12, -7, 0.12],
        submit: [-17, -19, 0.13, 'triangle'],
        'verdict-correct': [4, 5, 0.24],
        'verdict-repair': [-3, -4, 0.24],
        'reasoning-validated': [4, 7, 0.2],
        ledger: [12, 11, 0.13],
        bonus: [7, 12, 0.15],
        purchase: [-7, 5, 0.17],
        promotion: [-5, 7, 0.3],
        client: [-2, 5, 0.15],
        event: [-12, -12, 0.075, 'triangle'],
        collect: [7, 12, 0.12],
        cat: [7, 10, 0.13, 'sine'],
        pause: [-2, -7, 0.14],
        resume: [-7, -2, 0.14],
        error: [-7, -9, 0.13],
        toggle: [5, 7, 0.08],
      }
      const [from, to, duration, type = toneType] = reducedTone[cue]
      tone(at, pitch(root, from), duration, 0.09, type, pitch(root, to))
      return
    }

    switch (cue) {
      case 'navigate':
        paper(at, 0.075, 0.12)
        tone(at + 0.018, pitch(root, -5), 0.11, 0.12)
        break
      case 'tab':
        tone(at, pitch(root, 7), 0.055, 0.11, 'triangle', pitch(root, 5))
        break
      case 'select':
        paper(at, 0.045, 0.09, 1300 + stage * 250)
        tone(at, pitch(root, 2), 0.07, 0.1, 'triangle')
        break
      case 'paper':
        paper(at, 0.18, 0.13, 1200 + stage * 180)
        if (!reduced) paper(at + 0.075, 0.12, 0.065, 2200)
        break
      case 'file-open':
        tone(at, pitch(root, -12), 0.09, 0.13, 'triangle', pitch(root, -7))
        paper(at + 0.045, 0.2, 0.14)
        if (!reduced) tone(at + 0.17, pitch(root, 2), 0.13, 0.07, brightType)
        break
      case 'submit':
        paper(at, 0.095, 0.18, 720)
        tone(at + 0.025, pitch(root, -17), 0.15, 0.18, 'triangle', pitch(root, -19))
        break
      case 'verdict-correct':
      case 'verdict-repair': { // Equal layers, duration, and gain; only the interval direction differs.
        const correct = cue === 'verdict-correct'
        paper(at, 0.085, 0.2, 650)
        tone(at + 0.018, pitch(root, -12), 0.31, 0.18, 'triangle', pitch(root, -12))
        tone(at + 0.11, pitch(root, correct ? 4 : -3), 0.24, 0.13, brightType, pitch(root, correct ? 5 : -4))
        break
      }
      case 'reasoning-validated':
        tone(at, root, 0.32, 0.105, toneType)
        if (!reduced) {
          tone(at + 0.055, pitch(root, 4), 0.34, 0.085, brightType)
          tone(at + 0.11, pitch(root, 7), 0.38, 0.07, 'sine')
        }
        break
      case 'ledger':
        paper(at, 0.065, 0.085, 1150)
        tone(at + 0.035, pitch(root, 12), 0.16, 0.105, brightType, pitch(root, 11))
        break
      case 'bonus':
        tone(at, pitch(root, 7), 0.16, 0.1, brightType)
        if (!reduced) tone(at + 0.085, pitch(root, 12), 0.2, 0.085, 'sine')
        break
      case 'purchase':
        tone(at, pitch(root, -7), 0.12, 0.14, 'triangle')
        paper(at + 0.045, 0.075, 0.11, 950)
        if (!reduced) tone(at + 0.12, pitch(root, 5), 0.24, 0.1, brightType)
        break
      case 'promotion':
        tone(at, pitch(root, -5), 0.32, 0.11, toneType)
        if (!reduced) {
          tone(at + 0.15, root, 0.42, 0.095, brightType)
          tone(at + 0.31, pitch(root, 7), 0.6, 0.085, 'sine')
          tone(at + 0.47, pitch(root, 12), 0.75, 0.06, 'sine')
        }
        break
      case 'client':
        paper(at, 0.12, 0.105, 1050)
        tone(at + 0.055, pitch(root, -2), 0.16, 0.12, 'triangle')
        if (!reduced) tone(at + 0.14, pitch(root, 5), 0.2, 0.075, brightType)
        break
      case 'map':
        if (scene === 'city') {
          paper(at, 0.11, 0.075, 1500)
          tone(at + 0.025, pitch(root, -7), 0.19, 0.075, 'triangle', pitch(root, -3))
          tone(at + 0.12, pitch(root, 7), 0.08, 0.035, 'sine')
        } else if (scene === 'nation') {
          tone(at, pitch(root, -5), 0.22, 0.07, 'triangle', pitch(root, -2))
          tone(at + 0.09, pitch(root, 2), 0.2, 0.048, 'sine', pitch(root, 4))
        } else if (scene === 'ocean') {
          paper(at, 0.28, 0.052, 720)
          tone(at + 0.02, pitch(root, -12), 0.31, 0.065, 'sine', pitch(root, -5))
        } else if (scene === 'continent') {
          tone(at, pitch(root, -9), 0.27, 0.072, 'triangle', pitch(root, -7))
          tone(at + 0.1, pitch(root, -2), 0.22, 0.045, 'sine')
        } else if (scene === 'orbit') {
          tone(at, pitch(root, -7), 0.3, 0.048, 'sine', pitch(root, -3))
          tone(at + 0.04, pitch(root, 7), 0.34, 0.06, 'sine', pitch(root, 12))
        } else {
          paper(at, 0.16, 0.075, 1450)
          tone(at + 0.03, pitch(root, -7), 0.22, 0.07, 'sine', pitch(root, -3))
        }
        break
      case 'story': { // Alignment is deliberately confined to this decorative tail.
        paper(at, 0.11, 0.1, 980)
        tone(at + 0.025, pitch(root, -5), 0.22, 0.105, toneType)
        if (!reduced) {
          const tail = profile.alignment === 'Principled' ? 7 : profile.alignment === 'Ruthless' ? -2 : 4
          tone(at + 0.16, pitch(root, tail), 0.42, 0.065, 'sine')
        }
        break
      }
      case 'event':
        tone(at, pitch(root, -12), 0.075, 0.13, 'triangle')
        tone(at + 0.115, pitch(root, -12), 0.075, 0.105, 'triangle')
        break
      case 'collect':
        tone(at, pitch(root, 7), 0.11, 0.105, brightType)
        if (!reduced) tone(at + 0.08, pitch(root, 12), 0.18, 0.085, 'sine')
        break
      case 'cat':
        tone(at, pitch(root, 7), 0.16, 0.075, 'sine', pitch(root, 10))
        if (!reduced) tone(at + 0.13, pitch(root, 5), 0.2, 0.06, 'sine', pitch(root, 8))
        break
      case 'coffee':
        tone(at, pitch(root, 12), 0.055, 0.09, 'sine', pitch(root, 10))
        if (!reduced) paper(at + 0.035, 0.28, 0.055, 2600)
        break
      case 'pause':
        paper(at, 0.1, 0.1, 900)
        tone(at + 0.02, pitch(root, -2), 0.18, 0.1, 'triangle', pitch(root, -7))
        break
      case 'resume':
        paper(at, 0.09, 0.095, 1050)
        tone(at + 0.02, pitch(root, -7), 0.18, 0.1, 'triangle', pitch(root, -2))
        break
      case 'error':
        tone(at, pitch(root, -7), 0.13, 0.09, 'triangle')
        if (!reduced) tone(at + 0.11, pitch(root, -9), 0.16, 0.075, 'triangle')
        break
      case 'toggle':
        tone(at, pitch(root, 5), 0.09, 0.095, 'triangle', pitch(root, 7))
        break
    }
  }

  private tone(
    destination: AudioNode,
    start: number,
    frequency: number,
    duration: number,
    peak: number,
    type: OscillatorType,
    endFrequency = frequency,
  ) {
    const oscillator = this.context.createOscillator()
    const envelope = this.context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, start)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration)
    envelope.gain.setValueAtTime(0.0001, start)
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + Math.min(0.018, duration * 0.25))
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    oscillator.connect(envelope)
    envelope.connect(destination)
    oscillator.start(start)
    oscillator.stop(start + duration + 0.02)
  }

  private noise(destination: AudioNode, start: number, duration: number, peak: number, cutoff: number) {
    const source = this.context.createBufferSource()
    const filter = this.context.createBiquadFilter()
    const envelope = this.context.createGain()
    source.buffer = this.noiseBuffer
    filter.type = 'bandpass'
    filter.frequency.value = cutoff
    filter.Q.value = 0.7
    envelope.gain.setValueAtTime(0.0001, start)
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + Math.min(0.012, duration * 0.3))
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    source.connect(filter)
    filter.connect(envelope)
    envelope.connect(destination)
    source.start(start, (start * 0.371) % 0.4, duration)
    source.stop(start + duration + 0.01)
  }
}


let sharedEngine: ProceduralSoundEngine | null = null
let resumePromise: Promise<boolean> | null = null

function trustedEvent(interaction?: TrustedInteraction) {
  const event = interaction && 'nativeEvent' in interaction ? interaction.nativeEvent : interaction
  if (event?.isTrusted) return true
  return typeof navigator !== 'undefined' && navigator.userActivation?.isActive === true
}


async function unlockSharedEngine(interaction?: TrustedInteraction) {
  if (!trustedEvent(interaction) || (typeof document !== 'undefined' && document.hidden)) return false
  const Context = audioConstructor()
  if (!Context) return false
  if (!sharedEngine) sharedEngine = new ProceduralSoundEngine(Context)
  if (sharedEngine.context.state === 'running') return true
  if (sharedEngine.context.state === 'closed') return false
  if (resumePromise) return resumePromise
  resumePromise = sharedEngine.context.resume()
    .then(() => sharedEngine?.context.state === 'running')
    .catch(() => false)
    .finally(() => { resumePromise = null })
  return resumePromise
}


async function playShared(
  cue: SoundCue,
  profile: SoundProfile,
  preferences: SoundPreferences,
  options: SoundPlayOptions,
) {
  if (!sharedEngine || preferences.muted || preferences.volume <= 0 || document.hidden) return false
  if (resumePromise && !await resumePromise) return false
  if (document.hidden || sharedEngine.context.state !== 'running') return false
  return sharedEngine.play(cue, profile, preferences, options)
}


export function SoundProvider({ children, profile: suppliedProfile }: SoundProviderProps) {
  const [preferences, setPreferencesState] = useState<SoundPreferences>(readPreferences)
  const [profile, setProfileState] = useState<SoundProfile>(() => normalizeProfile(suppliedProfile))
  const [unlocked, setUnlocked] = useState(false)
  const preferencesRef = useRef(preferences)
  const profileRef = useRef(profile)

  const commitPreferences = useCallback((next: SoundPreferences) => {
    preferencesRef.current = next
    setPreferencesState(next)
  }, [])

  const unlock = useCallback(async (interaction?: TrustedInteraction) => {
    const didUnlock = await unlockSharedEngine(interaction)
    if (didUnlock) {
      sharedEngine?.setVolume(preferencesRef.current.volume)
      sharedEngine?.setAmbientVolume(preferencesRef.current.muted || !preferencesRef.current.ambientEnabled ? 0 : preferencesRef.current.ambientVolume)
      setUnlocked(true)
    }
    return didUnlock
  }, [])

  useEffect(() => {
    const unlockOnInteraction = (event: Event) => { void unlock(event) }
    const suspendWhenHidden = () => {
      if (!document.hidden) return
      setUnlocked(false)
      resumePromise = null
      void sharedEngine?.suspend()
    }
    window.addEventListener('pointerdown', unlockOnInteraction, { capture: true, passive: true })
    window.addEventListener('keydown', unlockOnInteraction, { capture: true })
    document.addEventListener('visibilitychange', suspendWhenHidden)
    return () => {
      window.removeEventListener('pointerdown', unlockOnInteraction, { capture: true })
      window.removeEventListener('keydown', unlockOnInteraction, { capture: true })
      document.removeEventListener('visibilitychange', suspendWhenHidden)
    }
  }, [unlock])

  useEffect(() => {
    writePreferences(preferences)
  }, [preferences])

  useEffect(() => {
    if (!suppliedProfile) return
    setProfileState((current) => normalizeProfile(suppliedProfile, current))
  }, [suppliedProfile?.alignment, suppliedProfile?.officeTier, suppliedProfile?.seed])

  useEffect(() => {
    preferencesRef.current = preferences
    sharedEngine?.setVolume(preferences.volume)
    sharedEngine?.setAmbientVolume(preferences.muted || !preferences.ambientEnabled ? 0 : preferences.ambientVolume)
    if (preferences.muted || !preferences.ambientEnabled) sharedEngine?.stopAmbient()
  }, [preferences])

  useEffect(() => {
    profileRef.current = profile
  }, [profile])

  const play = useCallback(async (cue: SoundCue, options: SoundPlayOptions = {}) => {
    const currentPreferences = preferencesRef.current
    if (currentPreferences.muted || currentPreferences.volume <= 0) return false
    if (!sharedEngine || sharedEngine.context.state !== 'running') {
      const didUnlock = await unlockSharedEngine()
      if (!didUnlock) return false
      sharedEngine?.setVolume(currentPreferences.volume)
      setUnlocked(true)
    }
    const currentProfile = normalizeProfile(options.profile, profileRef.current)
    return playShared(cue, currentProfile, currentPreferences, options)
  }, [])

  const setMuted = useCallback((muted: boolean) => {
    commitPreferences({ ...preferencesRef.current, muted })
  }, [commitPreferences])

  const toggleMuted = useCallback(() => {
    commitPreferences({ ...preferencesRef.current, muted: !preferencesRef.current.muted })
  }, [commitPreferences])

  const setVolume = useCallback((volume: number) => {
    commitPreferences({ ...preferencesRef.current, volume: clamp(volume, 0, 1) })
  }, [commitPreferences])

  const setReducedAudio = useCallback((reducedAudio: boolean) => {
    commitPreferences({ ...preferencesRef.current, reducedAudio })
  }, [commitPreferences])

  const setAmbientEnabled = useCallback((ambientEnabled: boolean) => {
    commitPreferences({ ...preferencesRef.current, ambientEnabled })
  }, [commitPreferences])

  const setAmbientVolume = useCallback((ambientVolume: number) => {
    commitPreferences({ ...preferencesRef.current, ambientVolume: clamp(ambientVolume, 0, 1) })
  }, [commitPreferences])

  const startAmbient = useCallback((scene: AmbientScene) => {
    const currentPreferences = preferencesRef.current
    if (!sharedEngine || sharedEngine.context.state !== 'running' || currentPreferences.muted || !currentPreferences.ambientEnabled) return false
    return sharedEngine.startAmbient(scene, profileRef.current, currentPreferences)
  }, [])

  const stopAmbient = useCallback(() => {
    sharedEngine?.stopAmbient()
  }, [])

  const setProfile = useCallback<SoundProfileApi['setProfile']>((next) => {
    setProfileState((current) => {
      const patch = typeof next === 'function' ? next(current) : next
      const normalized = normalizeProfile(patch, current)
      profileRef.current = normalized
      return normalized
    })
  }, [])

  const value = useMemo<SoundApi & SoundProfileApi>(() => ({
    ...preferences,
    supported: audioConstructor() !== null,
    unlocked,
    play,
    unlock,
    setMuted,
    toggleMuted,
    setVolume,
    setReducedAudio,
    setAmbientEnabled,
    setAmbientVolume,
    startAmbient,
    stopAmbient,
    profile,
    setProfile,
  }), [preferences, profile, play, setAmbientEnabled, setAmbientVolume, setMuted, setProfile, setReducedAudio, setVolume, startAmbient, stopAmbient, toggleMuted, unlock, unlocked])

  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>
}


function useSoundContext() {
  const context = useContext(SoundContext)
  if (!context) throw new Error('Sound hooks must be used within a SoundProvider.')
  return context
}


export function useSound(): SoundApi {
  const {
    profile: _profile,
    setProfile: _setProfile,
    ...sound
  } = useSoundContext()
  return sound
}


export function useAmbientMusic(scene: AmbientScene | null) {
  const { ambientEnabled, muted, startAmbient, stopAmbient, unlocked } = useSound()
  useEffect(() => {
    if (!scene || !unlocked || muted || !ambientEnabled) {
      stopAmbient()
      return
    }
    startAmbient(scene)
    return () => stopAmbient()
  }, [ambientEnabled, muted, scene, startAmbient, stopAmbient, unlocked])
}


export function useSoundProfile(syncProfile?: Partial<SoundProfile>): SoundProfileApi {
  const { profile, setProfile } = useSoundContext()
  useEffect(() => {
    if (syncProfile) setProfile(syncProfile)
  }, [setProfile, syncProfile?.alignment, syncProfile?.officeTier, syncProfile?.seed])
  return { profile, setProfile }
}


export function SoundControls({ className, compact = true, showReducedAudio = true }: SoundControlsProps) {
  const {
    supported,
    unlocked,
    muted,
    volume,
    reducedAudio,
    ambientEnabled,
    play,
    unlock,
    setMuted,
    setVolume,
    setReducedAudio,
    setAmbientEnabled,
  } = useSound()

  const quiet = muted || volume === 0

  const toggle = async (event: React.MouseEvent<HTMLButtonElement>) => {
    if (quiet) {
      await unlock(event.nativeEvent)
      if (volume === 0) setVolume(DEFAULT_PREFERENCES.volume)
      setMuted(false)
      void play('toggle', { id: `sound-enabled-${performance.now()}` })
    } else {
      setMuted(true)
    }
  }

  const toggleReduced = (event: React.MouseEvent<HTMLButtonElement>) => {
    void unlock(event.nativeEvent)
    const next = !reducedAudio
    setReducedAudio(next)
    void play('toggle', { intensity: 0.7 })
  }

  const toggleAmbient = (event: React.MouseEvent<HTMLButtonElement>) => {
    void unlock(event.nativeEvent)
    setAmbientEnabled(!ambientEnabled)
    void play('toggle', { intensity: .48 })
  }

  if (!supported) return null

  return (
    <div
      className={`sound-controls ${unlocked ? 'sound-unlocked' : 'sound-locked'} ${compact ? 'sound-controls-compact' : ''} ${className ?? ''}`.trim()}
      data-audio-state={unlocked ? 'ready' : 'locked'}
      role="group"
      aria-label="Sound effects"
    >
      <button
        type="button"
        className="sound-control-button sound-mute-button"
        data-sound-control="mute"
        aria-label="Sound effects"
        aria-pressed={!quiet}
        title={quiet ? 'Turn sound effects on' : 'Mute sound effects'}
        onClick={(event) => { void toggle(event) }}
      >
        {quiet ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
      </button>
      <label className="sound-volume-control">
        <span className="sr-only">Effects volume</span>
        <input
          type="range"
          data-sound-control="volume"
          aria-label="Effects volume"
          min="0"
          max="100"
          step="5"
          value={Math.round(volume * 100)}
          disabled={muted}
          onChange={(event) => setVolume(Number(event.target.value) / 100)}
        />
      </label>
      {showReducedAudio && (
        <button
          type="button"
          className={`sound-control-button sound-reduced-button ${reducedAudio ? 'active' : ''}`}
          data-sound-control="reduced-audio"
          aria-label={`${reducedAudio ? 'Disable' : 'Enable'} short sound cues`}
          aria-pressed={reducedAudio}
          title="Short sound uses one brief cue per action"
          onClick={toggleReduced}
        >
          <span aria-hidden="true">MIN</span>
        </button>
      )}
      {!compact && (
        <button
          type="button"
          className={`sound-control-button sound-ambient-button ${ambientEnabled ? 'active' : ''}`}
          data-sound-control="ambient"
          aria-label={`${ambientEnabled ? 'Disable' : 'Enable'} Office and World music`}
          aria-pressed={ambientEnabled}
          title={ambientEnabled ? 'Mute Office and World music' : 'Play Office and World music'}
          onClick={toggleAmbient}
        >
          <Music2 aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
