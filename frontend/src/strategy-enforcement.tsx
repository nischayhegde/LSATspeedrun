/**
 * Strategy gates: choosing an approach commits you to doing it.
 *
 * The server authors every gate (backend/app/enforcement.py) and this file
 * renders whatever it is handed, so adding a fifteenth strategy is a data
 * change on the backend rather than a component change here.
 *
 * The enforcement is structural, not advisory. A `sequence_reveal` gate keeps
 * the answer choices out of the DOM entirely until the artifact lands, because
 * "predict before you look" cannot be enforced by asking nicely once the
 * choices are on screen. A `choice_elimination` gate refuses the final
 * selection until choices are struck, and refuses a struck choice as the
 * answer. Every check here also runs on the server, which is the copy that
 * decides; these run so the button state is instant.
 *
 * Two rules the component is built around. Nothing traps focus and nothing
 * needs fine pointer work: every control is a native button, select, input, or
 * textarea, so a keyboard or a screen reader drives the whole gate. And
 * dropping the approach is always one visible control away, which is both the
 * escape hatch for anyone the gate is fighting and the reason the gate is
 * allowed to be strict in the first place.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
        const topic = new Set(
          words(item.question.stimulus || '').filter((word) => word.length >= 5 && !STOPWORDS.has(word)),
        )
        const borrowed = parts.filter((word) => topic.has(word))
        // One shared word is a coincidence. Two is the topic leaking in. The
        // server holds the authoritative reasoning-vocabulary allowance, so
        // this side only ever warns late, never early.
        if (new Set(borrowed).size > 2) {
          return `You used the topic's own words: ${[...new Set(borrowed)].slice(0, 3).join(', ')}. Describe the move, not the subject.`
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
      if ((field as { require_shared_term?: boolean }).require_shared_term) {
        const termSets = rows.map(
          (row) =>
            new Set(
              (field.columns ?? [])
                .filter((column) => column.kind !== 'select')
                .flatMap((column) => words(row[column.key] || ''))
                .filter((word) => !STOPWORDS.has(word)),
            ),
        )
        const linked = termSets.some((left, leftIndex) =>
          termSets.some((right, rightIndex) => rightIndex > leftIndex && [...left].some((term) => right.has(term))),
        )
        if (!linked) return field.shared_term_message || 'These rules do not link.'
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
// The hook the question view uses
// ---------------------------------------------------------------------------

export type StrategyGateController = {
  gate: StrategyGateSpec | null
  /** Render this under the strategy card. */
  panel: React.ReactNode
  /** True while a sequence gate is still holding the answer choices back. */
  choicesHidden: boolean
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
  options: { armed: boolean; selectedLabel: string; locked: boolean },
): StrategyGateController {
  const { armed, selectedLabel, locked } = options
  const gate = item?.strategy_gate ?? null
  const [values, setValues] = useState<GateValues>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState(false)
  const [gateMs, setGateMs] = useState(0)
  const armedAt = useRef<number | null>(null)

  useEffect(() => {
    setValues({})
    setTouched({})
    setServerErrors({})
    setRevealed(false)
    setGateMs(0)
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
      />
    ) : null

  return { gate, panel, choicesHidden, strickenLabels, satisfied, blockedReason, payload, applyServerErrors }
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
}

export function GatePanel({ gate, item, values, setValue, errorFor, selectedLabel, blocking, preAnswerDone, locked }: PanelProps) {
  const visibleFields = gate.fields.filter((field) => field.stage === 'pre_answer' || selectedLabel || !blocking)
  return (
    <section className={`gate ${preAnswerDone ? 'is-done' : ''} ${blocking ? '' : 'is-advisory'}`} aria-label="Required steps for this approach">
      <header className="gate-head">
        <h3>{blocking ? gate.copy.armed_title : gate.copy.light_title}</h3>
        <p>{blocking ? gate.instruction : gate.confirm}</p>
      </header>
      <div className="gate-fields">
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
      <p className="gate-foot" role="status">
        {preAnswerDone ? gate.confirm : gate.copy.timing_note}
      </p>
    </section>
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
  const { field, error } = props
  const errorId = `${field.key}-error`
  return (
    <fieldset className={`gate-field ${error ? 'has-error' : ''}`} disabled={props.disabled}>
      <legend>{field.label}</legend>
      {field.help && <p className="gate-help">{field.help}</p>}
      <FieldBody {...props} errorId={error ? errorId : undefined} />
      {error && (
        <p className="gate-error" id={errorId} role="alert">
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
      const count = words(text).length
      return (
        <>
          <textarea
            className="gate-text"
            value={text}
            placeholder={field.placeholder}
            aria-invalid={Boolean(errorId)}
            aria-describedby={errorId}
            rows={3}
            onChange={(event) => setValue(field.key, event.target.value)}
          />
          {Boolean(field.min_words) && (
            <p className="gate-count">
              {count >= (field.min_words ?? 0) ? `${count} words` : `${(field.min_words ?? 0) - count} more words`}
            </p>
          )}
        </>
      )
    }
    case 'segment_pick': {
      const picked = asIndexList(value)
      const single = field.max === 1
      return (
        <ul className="gate-segments" role={single ? 'radiogroup' : 'group'}>
          {(field.segments ?? []).map((segment, index) => {
            const on = picked.includes(index)
            return (
              <li key={`${field.key}-${index}`}>
                <button
                  type="button"
                  role={single ? 'radio' : 'checkbox'}
                  aria-checked={on}
                  aria-describedby={errorId}
                  className={`gate-segment ${on ? 'is-on' : ''}`}
                  onClick={() =>
                    setValue(
                      field.key,
                      single ? [index] : on ? picked.filter((entry) => entry !== index) : [...picked, index].sort((a, b) => a - b),
                    )
                  }
                >
                  <span className="gate-segment-mark" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span>{segment}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )
    }
    case 'segment_label': {
      const labels = asRecord(value)
      return (
        <ul className="gate-segments is-labelled">
          {(field.segments ?? []).map((segment, index) => (
            <li key={`${field.key}-${index}`}>
              <p className="gate-segment-text">{segment}</p>
              <label className="gate-inline-label">
                <span className="gate-visually-hidden">{`Role for line ${index + 1}`}</span>
                <select
                  value={labels[String(index)] || ''}
                  aria-describedby={errorId}
                  onChange={(event) => setValue(field.key, { ...labels, [String(index)]: event.target.value })}
                >
                  <option value="">Choose one</option>
                  {(field.options ?? []).map((option) => {
                    const text = typeof option === 'string' ? option : option.text || option.value || ''
                    return (
                      <option key={text} value={text}>
                        {text}
                      </option>
                    )
                  })}
                </select>
              </label>
            </li>
          ))}
        </ul>
      )
    }
    case 'segment_notes': {
      const notes = asRecord(value)
      return (
        <ul className="gate-segments is-noted">
          {(field.segments ?? []).map((segment, index) => (
            <li key={`${field.key}-${index}`}>
              <p className="gate-segment-text">{segment}</p>
              <label className="gate-inline-label">
                <span className="gate-visually-hidden">{`Note for paragraph ${index + 1}`}</span>
                <input
                  type="text"
                  value={notes[String(index)] || ''}
                  aria-describedby={errorId}
                  placeholder={`${field.min_words} to ${field.max_words} words`}
                  onChange={(event) => setValue(field.key, { ...notes, [String(index)]: event.target.value })}
                />
              </label>
            </li>
          ))}
        </ul>
      )
    }
    case 'choice_eliminate': {
      const entries = asEliminations(value)
      return (
        <ul className="gate-choices">
          {item.question.choices.map((choice) => {
            const entry = entries[choice.label]
            const struck = Boolean(entry)
            return (
              <li key={choice.label} data-label={choice.label} className={struck ? 'is-struck' : ''}>
                <div className="gate-choice-head">
                  <button
                    type="button"
                    aria-pressed={struck}
                    className="gate-strike"
                    onClick={() => {
                      const next = { ...entries }
                      if (struck) delete next[choice.label]
                      else next[choice.label] = {}
                      setValue(field.key, next)
                    }}
                  >
                    {struck ? 'Bring back' : 'Strike'} {choice.label}
                  </button>
                  <span className="gate-choice-text">{choice.text}</span>
                </div>
                {struck && (
                  <div className="gate-choice-detail">
                    <label className="gate-inline-label">
                      <span className="gate-visually-hidden">{`Reason for striking ${choice.label}`}</span>
                      <select
                        value={entry?.reason || ''}
                        aria-describedby={errorId}
                        onChange={(event) =>
                          setValue(field.key, { ...entries, [choice.label]: { ...entry, reason: event.target.value } })
                        }
                      >
                        <option value="">Why does it die?</option>
                        {(field.reasons ?? []).map((reason) => (
                          <option key={reason} value={reason}>
                            {reason}
                          </option>
                        ))}
                      </select>
                    </label>
                    {field.require_token && (
                      <label className="gate-inline-label">
                        <span className="gate-visually-hidden">{`Offending word in ${choice.label}`}</span>
                        <select
                          value={entry?.token || ''}
                          aria-describedby={errorId}
                          onChange={(event) =>
                            setValue(field.key, { ...entries, [choice.label]: { ...entry, token: event.target.value } })
                          }
                        >
                          <option value="">Which word?</option>
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
        <div className="gate-pills" role="radiogroup" aria-describedby={errorId}>
          {item.question.choices.map((choice) => (
            <button
              key={choice.label}
              type="button"
              role="radio"
              aria-checked={value === choice.label}
              className={`gate-pill ${value === choice.label ? 'is-on' : ''}`}
              onClick={() => setValue(field.key, choice.label)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      )
    case 'select':
      return (
        <div className="gate-pills" role="radiogroup" aria-describedby={errorId}>
          {(field.options ?? []).map((option) => {
            const optionValue = typeof option === 'string' ? option : option.value || ''
            const text = typeof option === 'string' ? option : option.text || ''
            return (
              <button
                key={optionValue}
                type="button"
                role="radio"
                aria-checked={value === optionValue}
                className={`gate-pill is-wide ${value === optionValue ? 'is-on' : ''}`}
                onClick={() => setValue(field.key, optionValue)}
              >
                {text}
              </button>
            )
          })}
        </div>
      )
    case 'rows': {
      const rows = asRows(value)
      const maximum = field.max_rows ?? 5
      const shown = rows.length ? rows : [{}]
      return (
        <>
          <ul className="gate-rows">
            {shown.map((row, index) => (
              <li key={`${field.key}-row-${index}`}>
                {(field.columns ?? []).map((column) =>
                  column.kind === 'select' ? (
                    <label className="gate-inline-label" key={column.key}>
                      <span className="gate-column-label">{column.label}</span>
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
                    <label className="gate-inline-label" key={column.key}>
                      <span className="gate-column-label">{column.label}</span>
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
            <button type="button" className="gate-add" onClick={() => setValue(field.key, [...shown, {}])}>
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
        return <p className="gate-help">Write the first rule and the three readings appear here.</p>
      }
      return (
        <div className="gate-pills is-stacked" role="radiogroup" aria-describedby={errorId}>
          {(field.options ?? []).map((option) => {
            if (typeof option === 'string') return null
            const text = (option.template || '').replace('{sufficient}', sufficient).replace('{necessary}', necessary)
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={value === option.id}
                className={`gate-pill is-wide ${value === option.id ? 'is-on' : ''}`}
                onClick={() => setValue(field.key, option.id)}
              >
                {text}
              </button>
            )
          })}
        </div>
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
export function LockedChoicesNotice({ gate }: { gate: StrategyGateSpec }) {
  return (
    <div className="gate-locked" role="status">
      <p>{gate.copy.locked_choices}</p>
    </div>
  )
}
