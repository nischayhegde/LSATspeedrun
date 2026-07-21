import {
  STORY_CAST,
  type CharacterEntrance,
  type StoryBeat,
  type StoryCharacterId,
  type StoryEmotion,
  type StoryWeather,
} from './AnimatedStoryStage'

export type CinematicStoryPayload = {
  source?: 'fallback' | 'truefoundry'
  case_title?: string
  chapter_title?: string
  location_id?: string
  atmosphere?: string
  continuity_beat?: string
  evidence_label?: string
  evidence_motif?: string
  brief?: string
  stakes?: string
  dialogue?: Array<{ speaker_id?: string; emotion?: string; line?: string; animation?: string }> | string
  question_transition?: string
  correct_outcome?: string
  incorrect_outcome?: string
  next_hook?: string
  cast?: Array<string | { id?: string }>
  // Legacy local frame fields.
  title?: string
  eyebrow?: string
  location?: string
  presenting_character?: string
  transition?: string
}

const LOCATION_LABELS: Record<string, string> = {
  lantern_atrium: 'The Lantern Atrium', evidence_vault: 'The Evidence Vault', rain_archive: 'The Rain Archive',
  cipher_lab: 'The Cipher Laboratory', map_room: 'The Living Map Room', clockwork_alley: 'Clockwork Alley',
  whisper_market: 'The Whisper Market', midnight_platform: 'Midnight Platform Nine', night_train: 'The Nocturne Express',
  river_docks: 'The Moonlit River Docks', glass_court: 'The Court of Glass', ember_library: 'The Ember Library',
  observatory: 'The Meridian Observatory', rookery_rooftop: 'The Rookery Rooftop', hall_of_echoes: 'The Hall of Echoes',
  storm_gallery: 'The Storm Gallery',
}

const EMOTIONS: Record<string, StoryEmotion> = {
  composed: 'neutral', curious: 'curious', urgent: 'determined', wary: 'suspicious', intrigued: 'curious',
  resolute: 'determined', amused: 'amused', concerned: 'concerned', encouraging: 'focused', mysterious: 'suspicious',
  suspicious: 'suspicious', thoughtful: 'focused', startled: 'surprised', defiant: 'determined',
  triumphant: 'triumphant', somber: 'disappointed',
}

const ENTRANCES: Record<string, CharacterEntrance> = {
  enter_left: 'left', enter_right: 'right', rise: 'rise', fade_in: 'fade', spotlight: 'fade',
}

const ACTIONS: Record<string, string> = {
  fade_in: 'steps out of the fog', enter_left: 'enters from the west gallery', enter_right: 'arrives at speed',
  rise: 'emerges into the lanternlight', breathe: 'steadies the evidence file', nod: 'nods once', think: 'studies the pattern',
  point: 'marks a detail on the board', pace: 'paces beside the case map', glance: 'checks the shadowed doorway',
  react: 'turns sharply', whisper: 'lowers their voice', spotlight: 'moves beneath the case light', project: 'casts the dossier onto the wall',
  write: 'adds a note to the ledger', celebrate: 'raises the Bureau seal', shake: 'shakes their head', exit: 'slips back into the night',
}

function isCharacter(value: string): value is StoryCharacterId {
  return Object.prototype.hasOwnProperty.call(STORY_CAST, value)
}

function characterId(value?: string): StoryCharacterId {
  if (value && isCharacter(value)) return value
  const normalized = (value || '').toLowerCase()
  if (normalized.includes('mira')) return 'mira_voss'
  if (normalized.includes('mori') || normalized.includes('quill')) return 'mori_quill'
  return 'rowan_vale'
}

function sceneWeather(location: string, atmosphere: string): StoryWeather {
  const value = `${location} ${atmosphere}`.toLowerCase()
  if (value.includes('storm') || value.includes('thunder')) return 'storm'
  if (value.includes('rain') || value.includes('water')) return 'rain'
  if (value.includes('fog') || value.includes('steam')) return 'fog'
  if (value.includes('ember') || value.includes('coal')) return 'embers'
  if (value.includes('snow')) return 'snow'
  return 'clear'
}

export function adaptStoryBeat(
  raw: CinematicStoryPayload | null | undefined,
  itemId: string,
  position: number,
  total: number,
  mode: 'diagnostic' | 'daily',
): StoryBeat {
  const payload = raw || {}
  const location = payload.location_id || payload.location || 'lantern_atrium'
  const atmosphere = payload.atmosphere || payload.brief || 'Amber case lamps wake across the Lantern Bureau.'
  const continuityBeat = payload.continuity_beat || atmosphere
  const rawDialogue = Array.isArray(payload.dialogue)
    ? payload.dialogue
    : [{ speaker_id: characterId(payload.presenting_character), emotion: 'focused', line: payload.dialogue || 'The evidence is ready. Read every word before the trail moves.', animation: 'think' }]
  const dialogue = rawDialogue.map((line, index) => ({
    id: `${itemId}-line-${index}`,
    speaker: characterId(line.speaker_id),
    text: line.line || 'The next part of the case is waiting in the evidence file.',
    emotion: EMOTIONS[line.emotion || ''] || 'focused',
    stageDirection: ACTIONS[line.animation || ''] || undefined,
    animation: line.animation || 'breathe',
    emphasis: index === rawDialogue.length - 1 ? payload.evidence_label : undefined,
  }))
  const castIds = (payload.cast || [])
    .map((member) => characterId(typeof member === 'string' ? member : member.id))
    .filter((member, index, values) => values.indexOf(member) === index)
  for (const line of dialogue) if (!castIds.includes(line.speaker)) castIds.push(line.speaker)
  if (castIds.length < 2) castIds.push(castIds[0] === 'rowan_vale' ? 'mira_voss' : 'rowan_vale')

  return {
    id: `${itemId}:${payload.source || 'legacy'}:${payload.case_title || payload.title || position}`,
    title: payload.case_title || payload.title || 'The Unmarked Evidence File',
    eyebrow: payload.evidence_label || payload.eyebrow || `Evidence file ${position + 1}`,
    chapter: payload.chapter_title || (mode === 'diagnostic' ? 'Prologue: The Lantern Trials' : 'The Lantern Bureau'),
    location,
    locationLabel: LOCATION_LABELS[location] || payload.location || 'The Lantern Bureau',
    timeOfDay: 'night',
    weather: sceneWeather(location, atmosphere),
    lighting: location.includes('cipher') ? 'neon' : location.includes('ember') ? 'golden' : 'moonlit',
    mood: payload.source === 'truefoundry' ? 'urgent' : 'mysterious',
    narration: `${continuityBeat} ${payload.brief || ''}`.trim(),
    objective: payload.question_transition || 'Inspect the untouched evidence and identify its exact logical task.',
    stakes: payload.stakes,
    clue: { label: payload.evidence_label || 'SEALED EVIDENCE', text: payload.evidence_motif || payload.question_transition || 'Inspect the evidence without changing a word.' },
    sequence: { current: position + 1, total, label: mode === 'diagnostic' ? 'Lantern Trial' : 'Case sequence' },
    cast: castIds.slice(0, 5).map((character, index) => ({
      character,
      entrance: ENTRANCES[rawDialogue.find((line) => characterId(line.speaker_id) === character)?.animation || ''] || STORY_CAST[character].entrance,
      emotion: dialogue.find((line) => line.speaker === character)?.emotion || 'neutral',
      position: (['left', 'right', 'center', 'far-left', 'far-right'] as const)[index % 5],
    })),
    dialogue,
    outcomes: {
      correct: { title: 'The trail holds', text: `${payload.correct_outcome || 'The evidence chain holds and the Bureau gains a reliable lead.'} ${payload.next_hook || payload.transition || ''}`.trim() },
      incorrect: { title: 'A false trail', text: `${payload.incorrect_outcome || 'The trail bends, but the reasoning break is now marked for review.'} ${payload.next_hook || payload.transition || ''}`.trim() },
    },
  }
}
