import { getDemoSessions } from './demo-runtime'

/**
 * Pitch preflight. Live app origin, Google cookies, and `/demo-api` are not
 * required: the five demo slides play captured autoplay videos, so probing
 * them on a public `/pitch/` host is what used to paint a sign-in demand
 * over the start card.
 */

export type CheckState = 'checking' | 'ok' | 'warn' | 'bad'

export type Check = {
  id: 'origin' | 'app' | 'api' | 'auth' | 'session'
  /** Two or three words, for a status strip that is read at a glance. */
  label: string
  state: CheckState
  /** One sentence, and when it is bad it must say what to do about it. */
  detail: string
}

export type PreflightResult = {
  checks: readonly Check[]
  /** What the case route will actually use. */
  sessionId: string
  sessionSource: 'resolved' | 'pinned' | 'none'
  /** False when at least one check is `bad`. */
  ok: boolean
  /**
   * `'stills'` when nothing below was run because nothing below could help —
   * see `runPreflight`. `checks` is empty and there is nothing to display but
   * the fact itself.
   */
  mode: 'live' | 'stills'
}

export async function runPreflight(): Promise<PreflightResult> {
  const sessions = getDemoSessions()
  return {
    checks: [],
    sessionId: sessions.liveSessionId,
    sessionSource: sessions.liveSessionId ? 'pinned' : 'none',
    ok: true,
    mode: 'stills',
  }
}
