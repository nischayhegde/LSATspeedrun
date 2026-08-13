import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'

/**
 * The draft autosave is the only thing standing between a student and the loss
 * of reasoning they are part-way through writing, and it used to be a fire-and-
 * forget `PATCH` whose failures were dropped on the floor:
 *
 *     void api.saveDraft(...).catch(() => undefined)
 *
 * Every way that call can fail — the run was removed underneath the tab, the
 * network dropped, the server erred — looked identical to a save that worked.
 * The student kept typing into a box that was no longer being persisted and
 * found out only when the text was gone.
 *
 * Two things change that. The in-progress text is mirrored to this device the
 * moment it is typed, so the server is no longer the only copy; and the outcome
 * of the save is reported rather than swallowed, so "not saved" is something the
 * student can see while there is still time to act on it. The mirror is cleared
 * as soon as the server confirms the write, which means a mirror that outlives
 * the keystroke is itself the signal that the server copy is behind.
 */
export type DraftSaveState = 'idle' | 'saving' | 'saved' | 'unsaved'

export type LocalDraft = { reasoning: string; selected: string; at: number }

const KEY_PREFIX = 'lsat:draft:'
/** A mirror is a rescue copy, not history. Anything older than this is stale. */
const MIRROR_TTL_MS = 24 * 60 * 60 * 1000

const keyFor = (itemId: string) => `${KEY_PREFIX}${itemId}`

/** Every storage call is guarded: Safari's private mode throws on write, and a
 *  failed rescue copy must never take the page down with it. */
function safely<T>(run: () => T): T | undefined {
  try {
    return run()
  } catch {
    return undefined
  }
}

export function readLocalDraft(itemId: string | undefined): LocalDraft | null {
  if (!itemId) return null
  const raw = safely(() => window.localStorage.getItem(keyFor(itemId)))
  if (!raw) return null
  const parsed = safely(() => JSON.parse(raw) as LocalDraft)
  if (!parsed || typeof parsed.reasoning !== 'string') return null
  if (!parsed.at || Date.now() - parsed.at > MIRROR_TTL_MS) {
    safely(() => window.localStorage.removeItem(keyFor(itemId)))
    return null
  }
  return parsed
}

function writeLocalDraft(itemId: string, draft: LocalDraft) {
  safely(() => window.localStorage.setItem(keyFor(itemId), JSON.stringify(draft)))
}

function clearLocalDraft(itemId: string) {
  safely(() => window.localStorage.removeItem(keyFor(itemId)))
}

/** Mirrors accumulate one key per question ever attempted on this device, so a
 *  sweep on mount keeps that bounded rather than letting it grow for ever. */
function pruneExpiredDrafts() {
  safely(() => {
    const stale: string[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key?.startsWith(KEY_PREFIX)) continue
      const raw = window.localStorage.getItem(key)
      const parsed = raw ? safely(() => JSON.parse(raw) as LocalDraft) : undefined
      if (!parsed?.at || Date.now() - parsed.at > MIRROR_TTL_MS) stale.push(key)
    }
    stale.forEach((key) => window.localStorage.removeItem(key))
  })
}

export type DraftAutosave = {
  state: DraftSaveState
  /** The status the last failed save came back with, for an honest message. */
  failureStatus: number | null
  /** True when the text on screen was restored from this device, not the server. */
  recovered: boolean
  acknowledgeRecovery: () => void
}

export function useDraftAutosave({
  sessionId,
  itemId,
  selected,
  reasoning,
  enabled,
  recovered,
}: {
  sessionId: string
  itemId: string | undefined
  selected: string
  reasoning: string
  enabled: boolean
  recovered: boolean
}): DraftAutosave {
  const [state, setState] = useState<DraftSaveState>('idle')
  const [failureStatus, setFailureStatus] = useState<number | null>(null)
  const [recoveryShown, setRecoveryShown] = useState(recovered)
  // Only the newest save may report a result. A slow failure landing after a
  // later success must not repaint the indicator back to "not saved".
  const runRef = useRef(0)

  useEffect(() => pruneExpiredDrafts(), [])

  useEffect(() => {
    setState('idle')
    setFailureStatus(null)
    setRecoveryShown(recovered)
    // A restored mirror is by definition not on the server yet.
    if (recovered) setState('unsaved')
  }, [itemId, recovered])

  useEffect(() => {
    if (!enabled || !itemId) return
    // The rescue copy is written before the request is even attempted, so a tab
    // that closes mid-keystroke still has somewhere to come back to.
    writeLocalDraft(itemId, { reasoning, selected, at: Date.now() })
    const run = ++runRef.current
    setState((current) => (current === 'saved' ? 'saved' : current))
    const timeout = window.setTimeout(async () => {
      setState('saving')
      try {
        await api.saveDraft(sessionId, itemId, { selected_label: selected || undefined, reasoning })
        if (runRef.current !== run) return
        clearLocalDraft(itemId)
        setFailureStatus(null)
        setState('saved')
        setRecoveryShown(false)
      } catch (error) {
        if (runRef.current !== run) return
        // The mirror is deliberately left in place: it is now the only copy.
        setFailureStatus((error as { status?: number })?.status ?? null)
        setState('unsaved')
      }
    }, 700)
    return () => window.clearTimeout(timeout)
  }, [enabled, itemId, reasoning, selected, sessionId])

  const acknowledgeRecovery = useCallback(() => setRecoveryShown(false), [])

  return { state, failureStatus, recovered: recoveryShown, acknowledgeRecovery }
}

/** Once an answer is submitted the server holds the real record, so the rescue
 *  copy has done its job and should not linger to be restored over it. */
export function discardLocalDraft(itemId: string | undefined) {
  if (itemId) clearLocalDraft(itemId)
}
