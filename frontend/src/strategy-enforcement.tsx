/**
 * Strategy gates: choosing an approach commits you to doing it.
 *
 * The server authors every gate (backend/app/enforcement.py) and this file
 * renders whatever it is handed, so adding a fifteenth strategy is a data
 * change on the backend rather than a component change here. What this file
 * adds on top of that data is a *presentation* per strategy: an instrument
 * name, a mark, a hue, and a worked example, all keyed off `strategy_key` with
 * a fallback keyed off the gate family. Prephrasing an answer and diagramming
 * conditionals are different intellectual acts, and a gate that looks identical
 * for both teaches that they are the same thing.
 *
 * The enforcement is structural, not advisory. A `sequence_reveal` gate keeps
 * the answer choices out of the DOM entirely until the artifact lands, because
 * "predict before you look" cannot be enforced by asking nicely once the
 * choices are on screen. A `choice_elimination` gate refuses the final
 * selection until choices are struck, and refuses a struck choice as the
 * answer. Every check here also runs on the server, which is the copy that
 * decides; these run so the button state is instant.
 *
 * Three rules the component is built around.
 *
 * Nothing traps focus and nothing needs fine pointer work: every control is a
 * native button, select, input, or textarea, so a keyboard or a screen reader
 * drives the whole gate.
 *
 * Dropping the approach is always one visible control away, which is both the
 * escape hatch for anyone the gate is fighting and the reason the gate is
 * allowed to be strict in the first place.
 *
 * And a finished gate gets out of the way. Once the required operations are
 * done the panel folds to a single line carrying what was committed, because
 * the alternative is a 700-pixel record of work already finished sitting
 * between the student and the answer choices.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  Ban,
  Columns2,
  Eye,
  FlaskConical,
  GitBranch,
  Layers,
  Lightbulb,
  Link2,
  ListTree,
  Lock,
  Map as MapIcon,
  Minimize2,
  PenLine,
  Quote,
  Scissors,
  Users,
} from 'lucide-react'

import { api } from './api'
import type { SessionItem, StrategyArtifact, StrategyGateField, StrategyGateSpec } from './types'
import './strategy-enforcement.css'

const STOPWORDS = new Set(
  ('a about above after again against all also am an and any are as at be because been before being below between both ' +
    'but by can cannot could did do does doing down during each few for from further had has have having he her here ' +
    'hers herself him himself his how i if in into is it its itself me more most my myself no nor not of off on once ' +
    'only or other ought our ours ourselves out over own same she should so some such than that the their theirs them ' +
    'themselves then there these they this those through to too under until up very was we were what when where which ' +
    'while who whom why will with would you your yours yourself yourselves').split(' '),
)

const RELATION_CUES = new Set([
  'both', 'whereas', 'while', 'unlike', 'agree', 'agrees', 'disagree', 'disagrees', 'shares', 'shared',
  'differ', 'differs', 'contrast', 'contrasts', 'however', 'although', 'though', 'same', 'opposite',
  'each', 'neither', 'narrower', 'broader',
])

const NUMBER_WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']

function countWord(value: number) {
  return NUMBER_WORDS[value] ?? String(value)
}

function normalize(value: string) {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function words(value: string) {
  const cleaned = normalize(value)
  return cleaned ? cleaned.split(' ') : []
}

function sentenceCount(value: string) {
  return value.split(/(?<=[.!?])\s+(?=["'([]?[A-Z0-9])/).filter((part) => part.trim()).length
}

export type GateValues = Record<string, unknown>

type EliminationEntry = { reason?: string; token?: string }
type Eliminations = Record<string, EliminationEntry>
type RowValue = Record<string, string>

function asIndexList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === 'number') : []
}

function asRecord(value: unknown): Record<string, string> {
  return value && typeof value === 'object' ? (value as Record<string, string>) : {}
}

function asEliminations(value: unknown): Eliminations {
  return value && typeof value === 'object' ? (value as Eliminations) : {}
}

function asRows(value: unknown): RowValue[] {
  return Array.isArray(value) ? (value as RowValue[]) : []
}

/**
 * The client half of the validation in backend/app/enforcement.py. Deliberately
 * the same checks in the same order so a student never clears the button here
 * and then meets a refusal from the server.
 */
export function validateField(
  field: StrategyGateField,
  values: GateValues,
  gate: StrategyGateSpec,
  item: SessionItem,
  selectedLabel: string,
): string | null {
  const value = values[field.key]
  switch (field.kind) {
    case 'text': {
      const text = typeof value === 'string' ? value.trim() : ''
      const parts = words(text)
      if (text.length < (field.min_chars ?? 0) || parts.length < (field.min_words ?? 0)) {
        return text ? field.short_message || 'This needs more than that.' : null
      }
      if (field.max_words && parts.length > field.max_words) {
        return `Cut it to ${field.max_words} words or fewer. You have ${parts.length}.`
      }
      if (field.single_sentence && sentenceCount(text) > 1) return 'One sentence. Compress it.'
      const meaningful = parts.filter((word) => !STOPWORDS.has(word))
      const distinct = new Set(meaningful).size
      if (distinct < 3 || distinct * 2 < meaningful.length) return 'That is one word repeated. Write it out.'
      const haystacks: string[] = []
      for (const source of (field as { no_copy_from?: string[] }).no_copy_from ?? []) {
        if (source === 'stimulus') haystacks.push(item.question.stimulus || '')
        if (source === 'stem') haystacks.push(item.question.stem)
        if (source === 'passage') haystacks.push(item.question.passage?.text || '')
      }
      const cleaned = normalize(text)
      for (const haystack of haystacks) {
        const candidate = normalize(haystack)
        if (candidate && cleaned && candidate.includes(cleaned)) {
          return field.copy_message || 'Say it in your own words.'
        }
      }
      if ((field as { ban_topic_words?: boolean }).ban_topic_words) {
        const borrowed = borrowedTopicWords(field, text, item)
        // One shared word is a coincidence. Two is the topic leaking in. The
        // server holds the authoritative reasoning-vocabulary allowance, so
        // this side only ever warns late, never early.
        if (borrowed.length > 2) {
          return `You used the topic's own words: ${borrowed.slice(0, 3).join(', ')}. Describe the move, not the subject.`
        }
      }
      if ((field as { require_cue?: boolean }).require_cue && !parts.some((word) => RELATION_CUES.has(word))) {
        return 'Say how they relate. Use a word like both, whereas, unlike, agrees, or disagrees.'
      }
      return null
    }
    case 'segment_pick': {
      const picked = asIndexList(value)
      const minimum = field.min ?? 1
      if (picked.length < minimum || (field.max != null && picked.length > field.max)) {
        return picked.length ? field.count_message || 'Mark the right number of lines.' : null
      }
      if (field.exclude_field) {
        const excluded = new Set(asIndexList(values[field.exclude_field]))
        if (picked.some((index) => excluded.has(index))) {
          return field.overlap_message || 'Those overlap.'
        }
      }
      return null
    }
    case 'segment_label': {
      const labels = asRecord(value)
      const segments = field.segments ?? []
      const missing = segments.filter((_segment, index) => !labels[String(index)]).length
      if (missing) return (field.missing_message || 'Label every line. {count} left.').replace('{count}', String(missing))
      if (field.exactly_one) {
        const count = segments.filter((_segment, index) => labels[String(index)] === field.exactly_one).length
        if (count !== 1) {
          return (field.exactly_one_message || 'Exactly one. You marked {count}.').replace('{count}', String(count))
        }
      }
      if (field.not_all_same && segments.length > 1) {
        const distinct = new Set(segments.map((_segment, index) => labels[String(index)]))
        if (distinct.size === 1) return field.variety_message || 'They are not all doing the same job.'
      }
      return null
    }
    case 'segment_notes': {
      const notes = asRecord(value)
      const segments = field.segments ?? []
      const seen = new Map<string, number>()
      for (let index = 0; index < segments.length; index += 1) {
        const text = (notes[String(index)] || '').trim()
        const parts = words(text)
        if (!text) return null
        if (parts.length < (field.min_words ?? 0) || parts.length > (field.max_words ?? 99)) {
          return (field.length_message || 'Line {index} needs {min} to {max} words. You have {count}.')
            .replace('{index}', String(index + 1))
            .replace('{min}', String(field.min_words))
            .replace('{max}', String(field.max_words))
            .replace('{count}', String(parts.length))
        }
        const cleaned = normalize(text)
        if (cleaned && normalize(segments[index]).includes(cleaned)) {
          return (field.copy_message || 'Line {index} is copied. Use your own words.').replace('{index}', String(index + 1))
        }
        const earlier = seen.get(cleaned)
        if (earlier != null) {
          return (field.duplicate_message || 'Lines {other} and {index} say the same thing.')
            .replace('{index}', String(index + 1))
            .replace('{other}', String(earlier + 1))
        }
        seen.set(cleaned, index)
      }
      return null
    }
    case 'choice_eliminate': {
      const entries = asEliminations(value)
      const struck = Object.keys(entries)
      const minimum = Math.min(field.min_eliminated ?? 1, Math.max(1, item.question.choices.length - 1))
      for (const label of struck) {
        if (!entries[label]?.reason) return field.reason_message || 'Pick a reason for every strike.'
        if (field.require_token && !entries[label]?.token) return field.token_message || 'Point at the word.'
      }
      if (struck.length >= item.question.choices.length) {
        return 'You struck every choice. One of them survives. Bring one back.'
      }
      if (struck.length < minimum) {
        return (field.count_message || 'Strike {min} choices first.')
          .replace('{min}', countWord(minimum))
          .replace('{count}', countWord(struck.length))
      }
      if (gate.restricts_choices && selectedLabel && struck.includes(selectedLabel)) {
        return `You struck ${selectedLabel}. Un-strike it or pick one you kept.`
      }
      return null
    }
    case 'choice_pick':
      return typeof value === 'string' && value ? null : null
    case 'select':
      return typeof value === 'string' && value ? null : null
    case 'rows': {
      const rows = asRows(value).filter((row) => (field.columns ?? []).some((column) => (row[column.key] || '').trim()))
      if (rows.length < (field.min_rows ?? 1)) return rows.length ? field.count_message || 'Add another row.' : null
      for (const row of rows) {
        for (const column of field.columns ?? []) {
          const text = (row[column.key] || '').trim()
          if (column.kind === 'select' ? !column.options.includes(text) : words(text).length < column.min_words) {
            return field.blank_message || 'Every row needs every column.'
          }
        }
      }
      if ((field as { require_shared_term?: boolean }).require_shared_term && !rowsShareATerm(field, rows)) {
        return field.shared_term_message || 'These rules do not link.'
      }
      if ((field as { require_passage_names?: boolean }).require_passage_names) {
        const haystack = normalize(`${item.question.passage?.text || ''} ${item.question.stimulus || ''}`)
        const nameKey = field.columns?.[0]?.key
        for (const row of rows) {
          const raw = (nameKey ? row[nameKey] : '') || ''
          const tokens = words(raw).filter((word) => !STOPWORDS.has(word))
          if (tokens.length && !tokens.some((token) => haystack.includes(token))) {
            return (field.passage_name_message || '"{value}" is not in the passage.').replace('{value}', raw.slice(0, 40))
          }
        }
      }
      return null
    }
    case 'contrapositive':
      // Whether the chosen reading is lawful is decided by the server, which
      // holds the mapping from the opaque option handles. Locally this only
      // knows whether something was picked.
      return null
    default:
      return null
  }
}

/** Topic words a `ban_topic_words` field has borrowed. Shared with the live readout. */
function borrowedTopicWords(field: StrategyGateField, text: string, item: SessionItem): string[] {
  if (!(field as { ban_topic_words?: boolean }).ban_topic_words) return []
  const topic = new Set(
    words(item.question.stimulus || '').filter((word) => word.length >= 5 && !STOPWORDS.has(word)),
  )
  return [...new Set(words(text).filter((word) => topic.has(word)))]
}

/** Whether two of the student's rules have a term in common, which is what makes a chain. */
function rowsShareATerm(field: StrategyGateField, rows: RowValue[]): boolean {
  const termSets = rows.map(
    (row) =>
      new Set(
        (field.columns ?? [])
          .filter((column) => column.kind !== 'select')
          .flatMap((column) => words(row[column.key] || ''))
          .filter((word) => !STOPWORDS.has(word)),
      ),
  )
  return termSets.some((left, leftIndex) =>
    termSets.some((right, rightIndex) => rightIndex > leftIndex && [...left].some((term) => right.has(term))),
  )
}

function isComplete(field: StrategyGateField, values: GateValues, item: SessionItem): boolean {
  const value = values[field.key]
  switch (field.kind) {
    case 'text':
      return (
        typeof value === 'string' &&
        value.trim().length >= (field.min_chars ?? 0) &&
        words(value).length >= (field.min_words ?? 0)
      )
    case 'segment_pick':
      return asIndexList(value).length >= (field.min ?? 1)
    case 'segment_label':
      return (field.segments ?? []).every((_segment, index) => Boolean(asRecord(value)[String(index)]))
    case 'segment_notes':
      return (field.segments ?? []).every((_segment, index) => (asRecord(value)[String(index)] || '').trim().length > 0)
    case 'choice_eliminate':
      return (
        Object.keys(asEliminations(value)).length >=
        Math.min(field.min_eliminated ?? 1, Math.max(1, item.question.choices.length - 1))
      )
    case 'choice_pick':
    case 'select':
    case 'contrapositive':
      return typeof value === 'string' && value.length > 0
    case 'rows':
      return asRows(value).filter((row) => (field.columns ?? []).some((column) => (row[column.key] || '').trim())).length >= (field.min_rows ?? 1)
    default:
      return true
  }
}

// ---------------------------------------------------------------------------
// What each approach looks like
//
// The server decides what a gate *requires*. This table decides what it looks
// and reads like, which is the part that has to differ per strategy: a mark, a
// name for the instrument the student is being handed, an accent, and one
// worked example of the artifact being asked for.
//
// The example is deliberately about a question that is not on screen. It is
// there to show the shape of a good answer to someone who has never produced
// one, and an example drawn from the question in front of them would be the
// answer.
// ---------------------------------------------------------------------------

type Instrument = {
  /** Small-caps micro-label. Names the tool, not the strategy's marketing title. */
  eyebrow: string
  icon: typeof Eye
  accent: 'teal' | 'gold' | 'amber' | 'rose'
  /** One worked artifact, from a question the student is not looking at. */
  example: string
  /** What the example is an example of. */
  exampleContext: string
}

const FAMILY_INSTRUMENTS: Record<string, Instrument> = {
  sequence_reveal: {
    eyebrow: 'SEALED FIRST',
    icon: Lock,
    accent: 'gold',
    example: 'It has to give a reason the sample could not stand in for the whole population.',
    exampleContext: 'On a weaken question about a town survey',
  },
  annotate_source: {
    eyebrow: 'SOURCE MARKUP',
    icon: PenLine,
    accent: 'teal',
    example: 'The last sentence is the claim; the two before it are the evidence offered for it.',
    exampleContext: 'On a three-sentence argument',
  },
  choice_elimination: {
    eyebrow: 'ELIMINATION LEDGER',
    icon: Scissors,
    accent: 'rose',
    example: '"only" — the passage says it is one cause, not the single cause.',
    exampleContext: 'Striking a choice for overreach',
  },
  structured_input: {
    eyebrow: 'WORKING BOARD',
    icon: Layers,
    accent: 'teal',
    example: 'If funding is cut → the trial ends. If the trial ends → the data is lost.',
    exampleContext: 'Two rules that share a term',
  },
  candidate_operation: {
    eyebrow: 'BENCH TEST',
    icon: FlaskConical,
    accent: 'amber',
    example: 'Denied: it is not the case that the machines were serviced on time.',
    exampleContext: 'Negating one answer choice',
  },
}

const INSTRUMENTS: Record<string, Instrument> = {
  // -- Logical Reasoning ----------------------------------------------------
  argument_core: {
    eyebrow: 'ARGUMENT DISSECTION',
    icon: Scissors,
    accent: 'teal',
    example: 'The author moves from what the members reported to what every member believes, without showing the two are the same.',
    exampleContext: 'Naming the gap in one clause',
  },
  prephrase: {
    eyebrow: 'SEALED PREDICTION',
    icon: Lock,
    accent: 'gold',
    example: 'It has to give a reason the sample could not stand in for the whole population.',
    exampleContext: 'On a weaken question about a town survey',
  },
  negation_test: {
    eyebrow: 'BENCH TEST',
    icon: FlaskConical,
    accent: 'amber',
    example: 'Denied: it is not the case that the machines were serviced on time. Then the delay has another cause and the argument falls over.',
    exampleContext: 'Negating a necessary-assumption candidate',
  },
  causal_audit: {
    eyebrow: 'CAUSAL AUDIT',
    icon: GitBranch,
    accent: 'amber',
    example: 'It could instead be that the healthier people were the ones who chose to join the programme in the first place.',
    exampleContext: 'One rival explanation, said concretely',
  },
  conditional_chain: {
    eyebrow: 'RULE BOARD',
    icon: Link2,
    accent: 'teal',
    example: 'If funding is cut → the trial ends. If the trial ends → the data is lost. So: if the data survives, funding was not cut.',
    exampleContext: 'Two rules linked, then flipped',
  },
  flaw_abstraction: {
    eyebrow: 'THE MOVE, NOT THE TOPIC',
    icon: Ban,
    accent: 'rose',
    example: 'Takes what is true of one member of a group and concludes it is true of the group as a whole.',
    exampleContext: 'A flaw named without the subject matter',
  },
  scope_precision: {
    eyebrow: 'ELIMINATION LEDGER',
    icon: Scissors,
    accent: 'rose',
    example: '"only" — the passage says it is one cause, not the single cause. Too strong.',
    exampleContext: 'Striking a choice, with the word that kills it',
  },
  role_map: {
    eyebrow: 'ROLE MAP',
    icon: ListTree,
    accent: 'teal',
    example: 'Background · Opposing view · Support · Conclusion. Exactly one sentence is the thing being argued for.',
    exampleContext: 'A four-sentence stimulus, labelled',
  },
  // -- Reading Comprehension ------------------------------------------------
  passage_map: {
    eyebrow: 'PASSAGE MAP',
    icon: MapIcon,
    accent: 'gold',
    example: '1 · sets up the puzzle · 2 · gives the old explanation · 3 · attacks it · 4 · offers the author\u2019s own',
    exampleContext: 'Each paragraph\u2019s job, not its contents',
  },
  viewpoint_ledger: {
    eyebrow: 'VIEWPOINT LEDGER',
    icon: Users,
    accent: 'teal',
    example: 'Traditionalists — hold that the practice is ancient — the author criticizes.',
    exampleContext: 'One row of the ledger',
  },
  paragraph_function: {
    eyebrow: 'STRUCTURE PASS',
    icon: ListTree,
    accent: 'teal',
    example: 'It shifts from describing what everyone accepted to explaining why that account fails.',
    exampleContext: 'Naming the turn',
  },
  textual_proof: {
    eyebrow: 'CITE THE LINE',
    icon: Quote,
    accent: 'gold',
    example: 'An answer you cannot point at is a guess with better manners.',
    exampleContext: 'Why the citation is the whole point',
  },
  comparative_matrix: {
    eyebrow: 'A / B MATRIX',
    icon: Columns2,
    accent: 'gold',
    example: 'Both treat the reform as overdue, whereas A blames the courts and B blames the legislature.',
    exampleContext: 'One sentence on the relationship',
  },
  main_point_synthesis: {
    eyebrow: 'ONE SENTENCE',
    icon: Minimize2,
    accent: 'gold',
    example: 'The author argues that the standard account of the migration is wrong, because the pottery evidence it rests on has been redated.',
    exampleContext: 'Subject, claim, and reason in one sentence',
  },
}

function instrumentFor(gate: StrategyGateSpec): Instrument {
  return INSTRUMENTS[gate.strategy_key] || FAMILY_INSTRUMENTS[gate.kind] || FAMILY_INSTRUMENTS.structured_input
}

/** The step ledger's name for one required operation. The full label is the field's own. */
function shortLabel(field: StrategyGateField): string {
  const label = field.label.replace(/[.?]$/, '')
  const parts = label.split(' ')
  return parts.length > 4 ? `${parts.slice(0, 4).join(' ')}…` : label
}

// ---------------------------------------------------------------------------
// Live requirements
//
// Every one of these is a check the submission will actually be refused for.
// Showing them as they are met is the difference between a box that says "not
// yet" after the fact and an instrument that says what it wants while the
// student is still writing.
// ---------------------------------------------------------------------------

type Requirement = { key: string; label: string; met: boolean; progress?: number }

function requirementsFor(field: StrategyGateField, values: GateValues, item: SessionItem): Requirement[] {
  const value = values[field.key]
  const out: Requirement[] = []
  switch (field.kind) {
    case 'text': {
      const text = typeof value === 'string' ? value : ''
      const count = words(text).length
      if (field.min_words) {
        out.push({
          key: 'min',
          label: count >= field.min_words ? `${count} words` : `${count} of ${field.min_words} words`,
          met: count >= field.min_words,
          progress: Math.min(1, count / field.min_words),
        })
      }
      if (field.max_words) out.push({ key: 'max', label: `${field.max_words} words at most`, met: count <= field.max_words })
      if (field.single_sentence) out.push({ key: 'one', label: 'one sentence', met: Boolean(text.trim()) && sentenceCount(text) <= 1 })
      const sources = (field as { no_copy_from?: string[] }).no_copy_from ?? []
      if (sources.length) {
        const cleaned = normalize(text)
        const copied = sources.some((source) => {
          const haystack =
            source === 'stimulus' ? item.question.stimulus || '' : source === 'stem' ? item.question.stem : item.question.passage?.text || ''
          const candidate = normalize(haystack)
          return Boolean(cleaned) && Boolean(candidate) && candidate.includes(cleaned)
        })
        out.push({ key: 'own', label: 'your own words', met: Boolean(text.trim()) && !copied })
      }
      if ((field as { ban_topic_words?: boolean }).ban_topic_words) {
        const borrowed = borrowedTopicWords(field, text, item)
        out.push({
          key: 'topic',
          label: borrowed.length > 2 ? `drop: ${borrowed.slice(0, 3).join(', ')}` : 'none of the topic\u2019s words',
          met: Boolean(text.trim()) && borrowed.length <= 2,
        })
      }
      if ((field as { require_cue?: boolean }).require_cue) {
        out.push({
          key: 'cue',
          label: 'says how they relate',
          met: words(text).some((word) => RELATION_CUES.has(word)),
        })
      }
      return out
    }
    case 'segment_pick': {
      const picked = asIndexList(value).length
      const minimum = field.min ?? 1
      const exact = field.max === 1
      out.push({
        key: 'count',
        label: exact ? (picked === 1 ? 'one marked' : 'mark one') : `${picked} of ${minimum} marked`,
        met: picked >= minimum && (field.max == null || picked <= field.max),
        progress: Math.min(1, picked / Math.max(1, minimum)),
      })
      return out
    }
    case 'segment_label': {
      const labels = asRecord(value)
      const segments = field.segments ?? []
      const done = segments.filter((_segment, index) => labels[String(index)]).length
      out.push({
        key: 'count',
        label: `${done} of ${segments.length} labelled`,
        met: done === segments.length,
        progress: segments.length ? done / segments.length : 0,
      })
      if (field.exactly_one) {
        const marked = segments.filter((_segment, index) => labels[String(index)] === field.exactly_one).length
        out.push({ key: 'one', label: `one ${field.exactly_one.toLowerCase()}`, met: marked === 1 })
      }
      if (field.not_all_same) {
        const distinct = new Set(segments.map((_segment, index) => labels[String(index)]).filter(Boolean)).size
        out.push({ key: 'variety', label: 'not all the same job', met: distinct > 1 })
      }
      return out
    }
    case 'segment_notes': {
      const notes = asRecord(value)
      const segments = field.segments ?? []
      const done = segments.filter((_segment, index) => {
        const count = words(notes[String(index)] || '').length
        return count >= (field.min_words ?? 0) && count <= (field.max_words ?? 99)
      }).length
      out.push({
        key: 'count',
        label: `${done} of ${segments.length} mapped`,
        met: done === segments.length,
        progress: segments.length ? done / segments.length : 0,
      })
      return out
    }
    case 'choice_eliminate': {
      const entries = asEliminations(value)
      const struck = Object.keys(entries)
      const minimum = Math.min(field.min_eliminated ?? 1, Math.max(1, item.question.choices.length - 1))
      out.push({
        key: 'count',
        label: `${struck.length} of ${minimum} struck`,
        met: struck.length >= minimum,
        progress: Math.min(1, struck.length / minimum),
      })
      out.push({
        key: 'alive',
        label: `${item.question.choices.length - struck.length} still standing`,
        met: struck.length < item.question.choices.length,
      })
      const reasoned = struck.every((label) => entries[label]?.reason)
      if (struck.length) out.push({ key: 'reason', label: 'every strike has a reason', met: reasoned })
      if (field.require_token && struck.length) {
        out.push({ key: 'token', label: 'every strike points at a word', met: struck.every((label) => entries[label]?.token) })
      }
      return out
    }
    case 'rows': {
      const rows = asRows(value).filter((row) => (field.columns ?? []).some((column) => (row[column.key] || '').trim()))
      const minimum = field.min_rows ?? 1
      out.push({
        key: 'count',
        label: `${rows.length} of ${minimum} rows`,
        met: rows.length >= minimum,
        progress: Math.min(1, rows.length / minimum),
      })
      if ((field as { require_shared_term?: boolean }).require_shared_term) {
        out.push({ key: 'link', label: rowsShareATerm(field, rows) ? 'they link' : 'share a term to link them', met: rowsShareATerm(field, rows) })
      }
      return out
    }
    default:
      return out
  }
}

// ---------------------------------------------------------------------------
// What a finished step is folded down to
// ---------------------------------------------------------------------------

function digestFor(field: StrategyGateField, values: GateValues, item: SessionItem): string {
  const value = values[field.key]
  switch (field.kind) {
    case 'text':
      return typeof value === 'string' ? value.trim() : ''
    case 'segment_pick': {
      const picked = asIndexList(value).map((index) => index + 1)
      if (!picked.length) return ''
      return picked.length === 1 ? `line ${picked[0]}` : `lines ${picked.join(', ')}`
    }
    case 'segment_label': {
      const labels = asRecord(value)
      const segments = field.segments ?? []
      if (field.exactly_one) {
        const index = segments.findIndex((_segment, position) => labels[String(position)] === field.exactly_one)
        if (index >= 0) return `${field.exactly_one?.toLowerCase()} on line ${index + 1}`
      }
      return `${segments.length} labelled`
    }
    case 'segment_notes': {
      const notes = asRecord(value)
      const first = notes['0']
      return first ? `1 · ${first}` : `${(field.segments ?? []).length} mapped`
    }
    case 'choice_eliminate': {
      const struck = Object.keys(asEliminations(value)).sort()
      if (!struck.length) return ''
      const alive = item.question.choices.map((choice) => choice.label).filter((label) => !struck.includes(label))
      return `struck ${struck.join(', ')} · ${alive.join(', ')} standing`
    }
    case 'choice_pick':
      return typeof value === 'string' && value ? `testing ${value}` : ''
    case 'select': {
      const option = (field.options ?? []).find((entry) => typeof entry !== 'string' && entry.value === value)
      return option && typeof option !== 'string' ? option.text || '' : ''
    }
    case 'rows': {
      const rows = asRows(value).filter((row) => (field.columns ?? []).some((column) => (row[column.key] || '').trim()))
      const first = rows[0]
      if (!first) return ''
      const columns = (field.columns ?? []).filter((column) => column.kind !== 'select')
      const rendered = columns.map((column) => first[column.key]).filter(Boolean).join(' → ')
      return rows.length > 1 ? `${rendered} (+${rows.length - 1})` : rendered
    }
    case 'contrapositive': {
      const option = (field.options ?? []).find((entry) => typeof entry !== 'string' && entry.id === value)
      if (!option || typeof option === 'string') return ''
      const rows = asRows(values[field.source_field || 'rules'])
      const first = rows[0] || {}
      return (option.template || '')
        .replace('{sufficient}', (first.sufficient || '').trim())
        .replace('{necessary}', (first.necessary || '').trim())
    }
    default:
      return ''
  }
}

// ---------------------------------------------------------------------------
// The hook the question view uses
// ---------------------------------------------------------------------------

export type StrategyGateController = {
  gate: StrategyGateSpec | null
  /** Render this under the strategy card. */
  panel: React.ReactNode
  /** True while a sequence gate is still holding the answer choices back. */
  choicesHidden: boolean
  /** True on the render where a sequence gate has just let the choices through. */
  justRevealed: boolean
  /** Labels the student struck. They cannot be selected. */
  strickenLabels: string[]
  /** True when everything the gate needs before submitting is done. */
  satisfied: boolean
  /** Copy for the submit button while the gate is holding it. */
  blockedReason: string
  /** Merge into the submit body. */
  payload: { strategy_gate_ms: number; strategy_artifact?: StrategyArtifact }
  /** Hand a rejected submission back so the failed box can say why. */
  applyServerErrors: (fields?: Array<{ field: string | null; message: string }>) => void
}

export function useStrategyGate(
  item: SessionItem | null | undefined,
  options: { armed: boolean; selectedLabel: string; locked: boolean; onDrop?: () => void },
): StrategyGateController {
  const { armed, selectedLabel, locked, onDrop } = options
  const gate = item?.strategy_gate ?? null
  const [values, setValues] = useState<GateValues>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState(false)
  const [gateMs, setGateMs] = useState(0)
  const [reopened, setReopened] = useState(false)
  const [justRevealed, setJustRevealed] = useState(false)
  const armedAt = useRef<number | null>(null)

  useEffect(() => {
    setValues({})
    setTouched({})
    setServerErrors({})
    setRevealed(false)
    setGateMs(0)
    setReopened(false)
    setJustRevealed(false)
    armedAt.current = null
  }, [item?.id])

  // Enforcement time is measured, not estimated. It starts when the student
  // opts in and stops when the gate stops blocking, so the pace comparison in
  // the strategy trial is never a comparison of scaffolding.
  useEffect(() => {
    if (!armed || !gate?.blocking) return
    if (armedAt.current == null) armedAt.current = Date.now()
  }, [armed, gate?.blocking])

  const blocking = Boolean(gate?.blocking && armed && !locked)
  const preAnswerFields = useMemo(() => (gate?.fields ?? []).filter((field) => field.stage === 'pre_answer'), [gate])
  const preSubmitFields = useMemo(() => (gate?.fields ?? []).filter((field) => field.stage === 'pre_submit'), [gate])

  const errorFor = useCallback(
    (field: StrategyGateField) => {
      if (!gate || !item) return null
      if (serverErrors[field.key]) return serverErrors[field.key]
      if (!touched[field.key]) return null
      return validateField(field, values, gate, item, selectedLabel)
    },
    [gate, item, serverErrors, touched, values, selectedLabel],
  )

  const preAnswerDone = useMemo(() => {
    if (!gate || !item) return true
    return preAnswerFields.every(
      (field) => isComplete(field, values, item) && !validateField(field, values, gate, item, selectedLabel),
    )
  }, [gate, item, preAnswerFields, values, selectedLabel])

  const preSubmitDone = useMemo(() => {
    if (!gate || !item) return true
    return preSubmitFields.every(
      (field) => isComplete(field, values, item) && !validateField(field, values, gate, item, selectedLabel),
    )
  }, [gate, item, preSubmitFields, values, selectedLabel])

  useEffect(() => {
    if (!blocking) return
    if (preAnswerDone && !revealed) {
      setRevealed(true)
      if (armedAt.current != null) setGateMs(Math.min(600_000, Date.now() - armedAt.current))
    }
  }, [blocking, preAnswerDone, revealed])

  // The one moment worth animating: the choices were being withheld and now
  // they are not. Held for a render so the question view can land the reveal
  // and put the choices in front of the student without a hunt.
  const wasHidden = useRef(false)
  const hidingNow = Boolean(gate?.hides_choices && blocking && !preAnswerDone)
  useEffect(() => {
    if (hidingNow) {
      wasHidden.current = true
      setJustRevealed(false)
      return
    }
    if (!wasHidden.current) return
    wasHidden.current = false
    setJustRevealed(true)
    const timer = window.setTimeout(() => setJustRevealed(false), 1200)
    return () => window.clearTimeout(timer)
  }, [hidingNow])

  const strickenLabels = useMemo(() => {
    if (!gate?.restricts_choices || !armed) return []
    const field = (gate.fields ?? []).find((entry) => entry.kind === 'choice_eliminate')
    if (!field) return []
    return Object.keys(asEliminations(values[field.key]))
  }, [gate, values, armed])

  const setValue = useCallback((key: string, next: unknown) => {
    setValues((current) => ({ ...current, [key]: next }))
    setTouched((current) => ({ ...current, [key]: true }))
    setServerErrors((current) => (current[key] ? { ...current, [key]: '' } : current))
  }, [])

  const applyServerErrors = useCallback((fields?: Array<{ field: string | null; message: string }>) => {
    if (!fields?.length) return
    const next: Record<string, string> = {}
    for (const entry of fields) if (entry.field) next[entry.field] = entry.message
    setServerErrors(next)
    setTouched((current) => ({ ...current, ...Object.fromEntries(Object.keys(next).map((key) => [key, true])) }))
    setRevealed(true)
    // A refusal has to be visible, so a folded gate opens itself back up.
    setReopened(true)
  }, [])

  const satisfied = !blocking || (preAnswerDone && preSubmitDone)
  const choicesHidden = Boolean(gate?.hides_choices && blocking && !preAnswerDone)

  const payload = useMemo(() => {
    if (!gate || !armed) return { strategy_gate_ms: 0 }
    const hasValues = Object.keys(values).length > 0
    const elapsed = gateMs || (armedAt.current != null ? Math.min(600_000, Date.now() - armedAt.current) : 0)
    return {
      strategy_gate_ms: elapsed,
      ...(hasValues ? { strategy_artifact: { fields: values } as StrategyArtifact } : {}),
    }
  }, [gate, armed, values, gateMs])

  const blockedReason = useMemo(() => {
    if (satisfied) return ''
    if (!preAnswerDone) return gate?.copy?.locked_submit || 'Finish the approach first.'
    const pending = preSubmitFields.find((field) => !isComplete(field, values, item as SessionItem))
    return pending?.label || gate?.copy?.locked_submit || 'Finish the approach first.'
  }, [satisfied, preAnswerDone, preSubmitFields, values, item, gate])

  // The student's own running record with this approach, which the dashboard
  // already computes and writes the sentences for. Read only while a gate is
  // open and unanswered, so a case never spends a request on it twice.
  const record = useQuery({
    queryKey: ['performance'],
    queryFn: api.performance,
    enabled: Boolean(gate && armed && !locked),
    staleTime: 120_000,
    retry: false,
  })
  const reading = useMemo(() => {
    const results = record.data?.performance.strategy_lab?.results ?? []
    const found = results.find((entry) => entry.key === gate?.strategy_key)
    if (!found || (!found.sample && !found.control_sample)) return null
    return { summary: found.summary, detail: found.detail }
  }, [record.data, gate?.strategy_key])

  // Folded once the required work is done, until the student asks for it back
  // or the server refuses the artifact.
  const folded = Boolean(gate) && (locked || (preAnswerDone && !reopened))

  const panel =
    gate && item && armed ? (
      <GatePanel
        gate={gate}
        item={item}
        values={values}
        setValue={setValue}
        errorFor={errorFor}
        selectedLabel={selectedLabel}
        blocking={blocking}
        preAnswerDone={preAnswerDone}
        locked={locked}
        folded={folded}
        onFold={setReopened}
        onDrop={onDrop}
        reading={reading}
      />
    ) : null

  return { gate, panel, choicesHidden, justRevealed, strickenLabels, satisfied, blockedReason, payload, applyServerErrors }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

type PanelProps = {
  gate: StrategyGateSpec
  item: SessionItem
  values: GateValues
  setValue: (key: string, value: unknown) => void
  errorFor: (field: StrategyGateField) => string | null
  selectedLabel: string
  blocking: boolean
  preAnswerDone: boolean
  locked: boolean
  folded?: boolean
  onFold?: (reopened: boolean) => void
  onDrop?: () => void
  reading?: { summary: string; detail: string } | null
}

export function GatePanel({
  gate,
  item,
  values,
  setValue,
  errorFor,
  selectedLabel,
  blocking,
  preAnswerDone,
  locked,
  folded = false,
  onFold,
  onDrop,
  reading = null,
}: PanelProps) {
  const instrument = instrumentFor(gate)
  const Mark = instrument.icon
  const [exampleOpen, setExampleOpen] = useState(false)
  const visibleFields = gate.fields.filter((field) => field.stage === 'pre_answer' || selectedLabel || !blocking)
  // A `pre_submit` step (citing the line that proves the answer) is not done
  // when the rest is, so it stays out of the fold and keeps its own panel.
  const pendingLater = selectedLabel
    ? gate.fields.filter((field) => field.stage === 'pre_submit' && !isComplete(field, values, item))
    : []
  const done = preAnswerDone
  const digest = gate.fields
    .filter((field) => field.stage === 'pre_answer')
    .map((field) => digestFor(field, values, item))
    .filter(Boolean)
    .join(' · ')

  return (
    <section
      className={[
        'strategy-gate',
        `sg-${gate.kind.replace(/_/g, '-')}`,
        `sg-accent-${instrument.accent}`,
        done ? 'is-done' : '',
        folded ? 'is-folded' : '',
        blocking ? '' : 'is-advisory',
        locked ? 'is-locked' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-gate={gate.strategy_key}
      aria-label="Required steps for this approach"
    >
      {folded ? (
        <FoldedGate
          gate={gate}
          instrument={instrument}
          digest={digest}
          locked={locked}
          onReopen={() => onFold?.(true)}
        />
      ) : (
        <>
          <header className="sg-head">
            <span className="sg-mark" aria-hidden="true">
              <Mark size={17} />
            </span>
            <div className="sg-title">
              <span className="sg-eyebrow">
                {instrument.eyebrow}
                {blocking ? '' : ' · OPTIONAL NOW'}
              </span>
              <h3>{blocking ? gate.copy.armed_title : gate.copy.light_title}</h3>
              <p>{blocking ? gate.instruction : gate.confirm}</p>
            </div>
            <StepLedger gate={gate} values={values} item={item} />
          </header>

          {reading && (
            <p className="sg-record">
              <span>YOUR RECORD</span>
              {reading.summary} {reading.detail}
            </p>
          )}

          <div className="sg-fields">
            {visibleFields.map((field) => (
              <GateField
                key={field.key}
                field={field}
                gate={gate}
                item={item}
                value={values[field.key]}
                values={values}
                setValue={setValue}
                error={errorFor(field)}
                disabled={locked}
              />
            ))}
          </div>

          <footer className="sg-foot">
            <p className="sg-note" role="status">
              {done ? gate.confirm : gate.copy.timing_note}
            </p>
            <div className="sg-foot-actions">
              <button
                type="button"
                className="sg-ghost"
                aria-expanded={exampleOpen}
                onClick={() => setExampleOpen((open) => !open)}
              >
                <Lightbulb size={13} /> {exampleOpen ? 'Hide the example' : 'Show a worked example'}
              </button>
              {onDrop && !locked && (
                <button
                  type="button"
                  className="sg-ghost is-drop"
                  onClick={() => {
                    if (window.confirm(gate.copy.abandon_confirm || 'Drop the approach?')) onDrop()
                  }}
                >
                  {gate.copy.abandon_label || 'Drop the approach'}
                </button>
              )}
            </div>
            {exampleOpen && (
              <div className="sg-example">
                <span>{instrument.exampleContext}</span>
                <p>{instrument.example}</p>
              </div>
            )}
          </footer>
        </>
      )}

      {folded && pendingLater.length > 0 && (
        <div className="sg-fields is-later">
          {pendingLater.map((field) => (
            <GateField
              key={field.key}
              field={field}
              gate={gate}
              item={item}
              value={values[field.key]}
              values={values}
              setValue={setValue}
              error={errorFor(field)}
              disabled={locked}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * The finished gate. One row: what was committed, and the way back into it.
 *
 * This is the whole answer to the complaint that a committed approach buries
 * the answer choices — the panel that was six hundred pixels tall while the
 * work was being done is a single line once it is.
 */
function FoldedGate({
  gate,
  instrument,
  digest,
  locked,
  onReopen,
}: {
  gate: StrategyGateSpec
  instrument: Instrument
  digest: string
  locked: boolean
  onReopen: () => void
}) {
  const Mark = instrument.icon
  return (
    <div className="sg-seal">
      <span className="sg-mark" aria-hidden="true">
        <Mark size={15} />
      </span>
      <div className="sg-seal-copy">
        <span className="sg-eyebrow">{locked ? 'ON THE RECORD' : 'COMMITTED'}</span>
        <strong title={digest}>{digest || gate.confirm}</strong>
      </div>
      {!locked && (
        <button type="button" className="sg-reopen" onClick={onReopen}>
          Review it
        </button>
      )}
    </div>
  )
}

/** One dot per required operation, filling as each is finished. */
function StepLedger({ gate, values, item }: { gate: StrategyGateSpec; values: GateValues; item: SessionItem }) {
  const fields = gate.fields
  if (fields.length < 2) return null
  const firstUnfinished = fields.findIndex((field) => !isComplete(field, values, item))
  return (
    <ol className="sg-steps" aria-label="Steps in this approach">
      {fields.map((field, index) => {
        const complete = isComplete(field, values, item)
        const current = index === firstUnfinished
        return (
          <li key={field.key} className={complete ? 'is-done' : current ? 'is-current' : ''}>
            <b aria-hidden="true">{index + 1}</b>
            <span>{shortLabel(field)}</span>
          </li>
        )
      })}
    </ol>
  )
}

type FieldProps = {
  field: StrategyGateField
  gate: StrategyGateSpec
  item: SessionItem
  value: unknown
  values: GateValues
  setValue: (key: string, value: unknown) => void
  error: string | null
  disabled: boolean
}

function GateField(props: FieldProps) {
  const { field, error, values, item } = props
  const errorId = `${field.key}-error`
  const requirements = requirementsFor(field, values, item)
  const complete = isComplete(field, values, item) && !error
  return (
    <fieldset
      className={`sg-field ${error ? 'has-error' : ''} ${complete ? 'is-met' : ''}`}
      data-kind={field.kind}
      disabled={props.disabled}
    >
      <legend>{field.label}</legend>
      {field.help && <p className="sg-help">{field.help}</p>}
      <FieldBody {...props} errorId={error ? errorId : undefined} />
      {requirements.length > 0 && (
        <ul className="sg-reqs" aria-hidden="true">
          {requirements.map((requirement) => (
            <li key={requirement.key} className={requirement.met ? 'is-met' : ''}>
              {requirement.progress != null && !requirement.met && (
                <i style={{ ['--sg-fill' as string]: requirement.progress }} />
              )}
              {requirement.label}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="sg-error" id={errorId} role="alert">
          <b>{props.gate.copy.invalid_title}</b> {error}
        </p>
      )}
    </fieldset>
  )
}

function FieldBody({ field, gate, item, value, values, setValue, errorId }: FieldProps & { errorId?: string }) {
  switch (field.kind) {
    case 'text': {
      const text = typeof value === 'string' ? value : ''
      return (
        <textarea
          className="sg-text"
          value={text}
          placeholder={field.placeholder}
          aria-invalid={Boolean(errorId)}
          aria-describedby={errorId}
          rows={field.max_words && field.max_words > 30 ? 3 : 2}
          onChange={(event) => setValue(field.key, event.target.value)}
        />
      )
    }
    case 'segment_pick': {
      const picked = asIndexList(value)
      const single = field.max === 1
      return (
        <ul className="sg-segments" role={single ? 'radiogroup' : 'group'}>
          {(field.segments ?? []).map((segment, index) => {
            const on = picked.includes(index)
            return (
              <li key={`${field.key}-${index}`}>
                <button
                  type="button"
                  role={single ? 'radio' : 'checkbox'}
                  aria-checked={on}
                  aria-describedby={errorId}
                  className={`sg-segment ${on ? 'is-on' : ''}`}
                  onClick={() =>
                    setValue(
                      field.key,
                      single ? [index] : on ? picked.filter((entry) => entry !== index) : [...picked, index].sort((a, b) => a - b),
                    )
                  }
                >
                  <span className="sg-segment-mark" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="sg-segment-text">{segment}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )
    }
    case 'segment_label': {
      const labels = asRecord(value)
      const options = (field.options ?? []).map((option) => (typeof option === 'string' ? option : option.text || option.value || ''))
      return (
        <ul className="sg-segments is-labelled">
          {(field.segments ?? []).map((segment, index) => (
            <li key={`${field.key}-${index}`} data-sg-segment={index}>
              <p className="sg-segment-text">
                <b aria-hidden="true">{index + 1}</b>
                {segment}
              </p>
              <div className="sg-chips" role="radiogroup" aria-label={`Role for line ${index + 1}`} aria-describedby={errorId}>
                {options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={labels[String(index)] === option}
                    className={`sg-chip ${labels[String(index)] === option ? 'is-on' : ''}`}
                    onClick={() => setValue(field.key, { ...labels, [String(index)]: option })}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )
    }
    case 'segment_notes': {
      const notes = asRecord(value)
      return (
        <ol className="sg-map">
          {(field.segments ?? []).map((segment, index) => {
            const note = notes[String(index)] || ''
            const count = words(note).length
            const inRange = count >= (field.min_words ?? 0) && count <= (field.max_words ?? 99)
            return (
              <li key={`${field.key}-${index}`} className={inRange ? 'is-met' : ''}>
                <span className="sg-map-index" aria-hidden="true">
                  {index + 1}
                </span>
                <p className="sg-map-source">{segment}</p>
                <label className="sg-inline-label">
                  <span className="sg-visually-hidden">{`Note for paragraph ${index + 1}`}</span>
                  <input
                    type="text"
                    value={note}
                    aria-describedby={errorId}
                    placeholder={`Its job, in ${field.min_words} to ${field.max_words} words`}
                    onChange={(event) => setValue(field.key, { ...notes, [String(index)]: event.target.value })}
                  />
                </label>
                <span className="sg-map-count" aria-hidden="true">
                  {count}
                </span>
              </li>
            )
          })}
        </ol>
      )
    }
    case 'choice_eliminate': {
      const entries = asEliminations(value)
      return (
        <ul className="sg-ledger">
          {item.question.choices.map((choice) => {
            const entry = entries[choice.label]
            const struck = Boolean(entry)
            return (
              <li key={choice.label} data-label={choice.label} className={struck ? 'is-struck' : ''}>
                <div className="sg-ledger-head">
                  <button
                    type="button"
                    aria-pressed={struck}
                    className="sg-strike"
                    aria-label={`${struck ? 'Bring back' : 'Strike'} choice ${choice.label}`}
                  onClick={() => {
                      const next = { ...entries }
                      if (struck) delete next[choice.label]
                      else next[choice.label] = {}
                      setValue(field.key, next)
                    }}
                  >
                    {choice.label}
                  </button>
                  <span className="sg-ledger-text">{choice.text}</span>
                </div>
                {struck && (
                  <div className="sg-ledger-detail">
                    <div className="sg-chips" role="radiogroup" aria-label={`Reason for striking ${choice.label}`} aria-describedby={errorId}>
                      {(field.reasons ?? []).map((reason) => (
                        <button
                          key={reason}
                          type="button"
                          role="radio"
                          aria-checked={entry?.reason === reason}
                          className={`sg-chip ${entry?.reason === reason ? 'is-on' : ''}`}
                          onClick={() => setValue(field.key, { ...entries, [choice.label]: { ...entry, reason } })}
                        >
                          {reason}
                        </button>
                      ))}
                    </div>
                    {field.require_token && (
                      <label className="sg-inline-label is-token">
                        <span className="sg-visually-hidden">{`Offending word in ${choice.label}`}</span>
                        <select
                          value={entry?.token || ''}
                          aria-describedby={errorId}
                          onChange={(event) =>
                            setValue(field.key, { ...entries, [choice.label]: { ...entry, token: event.target.value } })
                          }
                        >
                          <option value="">Which word overreaches?</option>
                          {(field.choice_tokens?.[choice.label] ?? []).map((token) => (
                            <option key={token} value={token}>
                              {token}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )
    }
    case 'choice_pick':
      return (
        <div className="sg-chips is-labels" role="radiogroup" aria-describedby={errorId}>
          {item.question.choices.map((choice) => (
            <button
              key={choice.label}
              type="button"
              role="radio"
              aria-checked={value === choice.label}
              aria-label={`Choice ${choice.label}`}
              className={`sg-chip is-label ${value === choice.label ? 'is-on' : ''}`}
              onClick={() => setValue(field.key, choice.label)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      )
    case 'select': {
      // The negation test's ruling is the one place a gate can be failed by a
      // contradiction rather than by an omission: rule that the argument
      // collapses and then answer something else, and the server refuses both.
      // Saying so here costs a line and saves a rejection.
      const candidate = typeof values.candidate === 'string' ? values.candidate : ''
      const consequence =
        field.key === 'collapse' && candidate && value
          ? value === 'collapses'
            ? `Then ${candidate} is required, so ${candidate} has to be your answer.`
            : `Then ${candidate} is not required. Test another choice, or answer something else.`
          : ''
      return (
        <>
          <div className="sg-chips is-stacked" role="radiogroup" aria-describedby={errorId}>
            {(field.options ?? []).map((option) => {
              const optionValue = typeof option === 'string' ? option : option.value || ''
              const text = typeof option === 'string' ? option : option.text || ''
              return (
                <button
                  key={optionValue}
                  type="button"
                  role="radio"
                  aria-checked={value === optionValue}
                  className={`sg-chip is-wide ${value === optionValue ? 'is-on' : ''}`}
                  onClick={() => setValue(field.key, optionValue)}
                >
                  {text}
                </button>
              )
            })}
          </div>
          {consequence && (
            <p className="sg-consequence" role="status">
              <ArrowRight size={13} /> {consequence}
            </p>
          )}
        </>
      )
    }
    case 'rows': {
      const rows = asRows(value)
      const maximum = field.max_rows ?? 5
      const shown = rows.length ? rows : [{}]
      const columns = field.columns ?? []
      const linked = (field as { require_shared_term?: boolean }).require_shared_term
        ? rowsShareATerm(field, shown.filter((row) => columns.some((column) => (row[column.key] || '').trim())))
        : false
      return (
        <>
          <ul className={`sg-rows ${linked ? 'is-linked' : ''}`}>
            {shown.map((row, index) => (
              <li key={`${field.key}-row-${index}`}>
                <span className="sg-row-index" aria-hidden="true">
                  {index + 1}
                </span>
                {columns.map((column, columnIndex) =>
                  column.kind === 'select' ? (
                    <label className="sg-inline-label" key={column.key}>
                      <span className="sg-column-label">{column.label}</span>
                      <select
                        value={row[column.key] || ''}
                        aria-describedby={errorId}
                        onChange={(event) => {
                          const next = [...shown]
                          next[index] = { ...row, [column.key]: event.target.value }
                          setValue(field.key, next)
                        }}
                      >
                        <option value="">Choose one</option>
                        {column.options.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label className="sg-inline-label" key={column.key}>
                      <span className="sg-column-label">
                        {columnIndex > 0 && <i aria-hidden="true">→</i>}
                        {column.label}
                      </span>
                      <input
                        type="text"
                        value={row[column.key] || ''}
                        aria-describedby={errorId}
                        onChange={(event) => {
                          const next = [...shown]
                          next[index] = { ...row, [column.key]: event.target.value }
                          setValue(field.key, next)
                        }}
                      />
                    </label>
                  ),
                )}
              </li>
            ))}
          </ul>
          {shown.length < maximum && (
            <button type="button" className="sg-add" onClick={() => setValue(field.key, [...shown, {}])}>
              Add another
            </button>
          )}
        </>
      )
    }
    case 'contrapositive': {
      const rows = asRows(values[field.source_field || 'rules'])
      const first = rows[0] || {}
      const sufficient = (first.sufficient || '').trim()
      const necessary = (first.necessary || '').trim()
      if (!sufficient || !necessary) {
        return <p className="sg-help">Write the first rule and the three readings appear here.</p>
      }
      return (
        <>
          <p className="sg-rule-echo">
            <span>YOUR FIRST RULE</span>
            <b>
              If {sufficient} <i aria-hidden="true">→</i> {necessary}
            </b>
          </p>
          <div className="sg-chips is-stacked" role="radiogroup" aria-describedby={errorId}>
            {(field.options ?? []).map((option) => {
              if (typeof option === 'string') return null
              const text = (option.template || '').replace('{sufficient}', sufficient).replace('{necessary}', necessary)
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={value === option.id}
                  className={`sg-chip is-wide ${value === option.id ? 'is-on' : ''}`}
                  onClick={() => setValue(field.key, option.id)}
                >
                  {text}
                </button>
              )
            })}
          </div>
        </>
      )
    }
    default:
      return null
  }
}

/**
 * What stands in for the answer choices while a sequencing gate holds them
 * back. It is a real element rather than an empty space so the state is
 * announced, and so nobody thinks the page failed to load.
 */
export function LockedChoicesNotice({ gate, count }: { gate: StrategyGateSpec; count?: number }) {
  return (
    <div className="sg-shutter" role="status">
      <span className="sg-shutter-mark" aria-hidden="true">
        <Eye size={16} />
      </span>
      <p>{gate.copy.locked_choices}</p>
      {Boolean(count) && (
        <small>
          {countWord(count as number)} answer{count === 1 ? '' : 's'} sealed
        </small>
      )}
      <span className="sg-shutter-rule" aria-hidden="true" />
    </div>
  )
}
