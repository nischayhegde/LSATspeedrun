import type { PlannedStoryBeat, SessionItem, StudySession } from '../types'

export type SessionStoryArcView = {
  title: string
  premise: string
  objective: string
  episodeLabel: string
  roleLabel: string
  hook: string
  current: number
  total: number
  progress: number
  aiPlanned: boolean
}

const ROLE_LABELS: Record<string, string> = {
  opening: 'Opening scene',
  setup: 'Opening lead',
  inciting_incident: 'Inciting incident',
  first_lead: 'First lead',
  investigation: 'Investigation',
  complication: 'New complication',
  escalation: 'Rising tension',
  rising_action: 'Rising action',
  midpoint: 'Midpoint turn',
  midpoint_reversal: 'Midpoint reversal',
  reversal: 'The trail turns',
  revelation: 'Revelation',
  false_lead: 'False lead',
  confrontation: 'Confrontation',
  climax: 'Climactic deduction',
  resolution: 'Resolution',
  denouement: 'Aftermath',
  epilogue: 'Epilogue',
  bridge: 'Connecting lead',
}

function clean(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function beatObject(item: SessionItem): PlannedStoryBeat | undefined {
  const value = item.planned_story_beat ?? item.planned_beat
  return value && typeof value === 'object' ? value : undefined
}

function humanizeRole(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (ROLE_LABELS[normalized]) return ROLE_LABELS[normalized]
  return normalized
    .split('_')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() || ''}${part.slice(1)}`)
    .join(' ') || 'Active investigation'
}

function inferredRole(position: number, total: number): string {
  if (position === 0) return 'Opening scene'
  if (position >= total - 1) return 'Climactic deduction'
  const ratio = (position + 1) / Math.max(1, total)
  if (ratio < 0.34) return 'Investigation'
  if (ratio < 0.67) return 'Rising tension'
  return 'The trail turns'
}

export function sessionStoryArcView(
  session: StudySession,
  item: SessionItem,
  outcomeResolved: boolean,
  resolvedStoryHook?: string,
  resolvedPlannedPayoff?: string,
): SessionStoryArcView {
  const plan = session.story_plan
  const nestedArc = plan?.arc
  const beat = beatObject(item)
  const rawBeat = item.planned_story_beat ?? item.planned_beat
  const rawRole = clean(item.planned_story_role)
    || clean(beat?.story_role)
    || (typeof rawBeat === 'string' ? clean(rawBeat) : undefined)
  const total = Math.max(1, Number(plan?.total_beats) || session.total_items)
  const current = Math.min(total, Math.max(1, item.position + 1))
  const diagnostic = session.mode === 'diagnostic'
  const roleLabel = rawRole ? humanizeRole(rawRole) : inferredRole(item.position, total)
  const setupHook = clean(beat?.setup_hook)
  const payoffHook = clean(beat?.payoff_hook)
  const hook = (outcomeResolved ? clean(resolvedPlannedPayoff) || payoffHook || clean(resolvedStoryHook) || setupHook : setupHook)
    || (outcomeResolved
      ? 'This evidence is now part of the record; the next file carries the investigation forward.'
      : 'This evidence file advances the investigation without changing the LSAT question beneath it.')

  return {
    title: clean(plan?.arc_title) || clean(nestedArc?.title) || (diagnostic ? 'The Lantern Trials' : 'The Bureau Night Shift'),
    premise: clean(plan?.arc_premise) || clean(nestedArc?.premise) || (diagnostic
      ? 'A sequence of sealed trials will establish how this detective reads evidence under pressure.'
      : 'A connected trail of evidence files is moving through the Lantern Bureau tonight.'),
    objective: clean(plan?.arc_objective) || clean(nestedArc?.objective) || (diagnostic
      ? 'Complete the field evaluation and establish a trustworthy reasoning profile.'
      : 'Follow the full case thread while strengthening the reasoning skills selected for this shift.'),
    episodeLabel: clean(plan?.episode_label) || (diagnostic ? 'Lantern Trial' : 'Case Episode'),
    roleLabel,
    hook,
    current,
    total,
    progress: Math.max(0, Math.min(100, current / total * 100)),
    aiPlanned: plan?.source === 'truefoundry',
  }
}
