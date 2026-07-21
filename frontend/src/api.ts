import type { AttemptResult, CoachingFeedback, CoachingHint, DailySummary, DiagnosticResults, StudySession, User } from './types'
import type { CinematicStoryPayload } from './story/adaptStoryBeat'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/v1'

export class ApiError extends Error {
  status: number
  code: string

  constructor(message: string, status: number, code = 'request_failed') {
    super(message)
    this.status = status
    this.code = code
  }
}

function readCookie(name: string) {
  const value = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`))
    ?.split('=')[1]
  return value ? decodeURIComponent(value) : undefined
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method || 'GET'
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (!['GET', 'HEAD'].includes(method.toUpperCase())) {
    const csrf = readCookie('sherlock_csrf')
    if (csrf) headers.set('X-CSRF-Token', csrf)
  }
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(data?.error?.message || 'The Bureau could not complete that request.', response.status, data?.error?.code)
  }
  return data as T
}

export const api = {
  authConfig: () => request<{ google_client_id?: string | null; dev_auth_enabled: boolean }>('/auth/config'),
  me: () => request<{ user: User }>('/me'),
  googleLogin: (credential: string) =>
    request<{ user: User }>('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) }),
  devLogin: () =>
    request<{ user: User }>('/auth/dev', {
      method: 'POST',
      body: JSON.stringify({ email: 'detective@localhost.test', display_name: 'Local Detective' }),
    }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  savePreferences: (target_minutes: number) =>
    request<{ user: User }>('/me/preferences', { method: 'PATCH', body: JSON.stringify({ target_minutes }) }),
  currentDiagnostic: () =>
    request<{
      status: 'not_started' | 'in_progress' | 'paused' | 'debrief' | 'completed'
      session: StudySession | null
      results: DiagnosticResults | null
    }>('/diagnostics/current'),
  startDiagnostic: () =>
    request<{ session: StudySession; results?: DiagnosticResults }>('/diagnostics', { method: 'POST' }),
  startDaily: () => request<{ session: StudySession }>('/study-sessions', { method: 'POST' }),
  currentSession: (mode: 'daily' | 'diagnostic' = 'daily') =>
    request<{ session: StudySession | null }>(`/study-sessions/current?mode=${mode}`),
  session: (id: string) => request<{ session: StudySession; summary?: DailySummary }>(`/study-sessions/${id}`),
  pauseSession: (id: string, keepalive = false) =>
    request<{ session: StudySession }>(`/study-sessions/${id}/pause`, { method: 'POST', keepalive }),
  resumeSession: (id: string) =>
    request<{ session: StudySession }>(`/study-sessions/${id}/resume`, { method: 'POST' }),
  acknowledgeDebrief: (id: string) =>
    request<{ session: StudySession }>(`/study-sessions/${id}/debrief/acknowledge`, { method: 'POST' }),
  acknowledgeSummary: (id: string) =>
    request<{ ok: boolean }>(`/study-sessions/${id}/summary/acknowledge`, { method: 'POST' }),
  saveDraft: (sessionId: string, itemId: string, draft: { selected_label?: string; reasoning: string }, keepalive = false) =>
    request<{ saved: boolean; draft: { selected_label?: string | null; reasoning: string; updated_at: string } }>(`/study-sessions/${sessionId}/items/${itemId}/draft`, {
      method: 'PATCH',
      body: JSON.stringify(draft),
      keepalive,
    }),
  startEvidenceTimer: (sessionId: string, itemId: string) =>
    request<{ item: import('./types').SessionItem }>(`/study-sessions/${sessionId}/items/${itemId}/timer/start`, { method: 'POST' }),
  completeStoryIntroduction: () =>
    request<{ user: User }>('/story/introduction/complete', { method: 'POST' }),
  submitAttempt: (
    sessionId: string,
    body: { item_id: string; selected_label: string; reasoning?: string; elapsed_ms: number },
    idempotencyKey: string,
  ) =>
    request<{ result: AttemptResult }>(`/study-sessions/${sessionId}/attempts`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    }),
  coaching: (attemptId: string) =>
    request<{ status: 'completed'; coaching: CoachingFeedback }>(`/attempts/${attemptId}/coaching`, { method: 'POST' }),
  requestHint: (sessionId: string, itemId: string) =>
    request<{ hint: CoachingHint }>(`/study-sessions/${sessionId}/items/${itemId}/hints`, { method: 'POST' }),
  generateStory: (sessionId: string, itemId: string) =>
    request<{ story: CinematicStoryPayload }>(`/study-sessions/${sessionId}/items/${itemId}/story`, { method: 'POST' }),
  sessionSummary: (id: string) =>
    request<{ session: StudySession; summary: DailySummary }>(`/study-sessions/${id}/summary`),
  progress: () =>
    request<{
      readiness: DiagnosticResults | null
      story: User['story']
      totals: { sessions: number; attempts: number; accuracy: number }
      skills: Array<{
        name: string
        attempts: number
        accuracy: number
        average_time_seconds: number
        explanation_accuracy?: number | null
        pace_unlocked: boolean
      }>
      pace_history: Array<{ date: string; accuracy: number; capm?: number | null; questions: number }>
    }>('/progress'),
  storyProgress: () => request<{
    chapter: number
    xp: number
    cases_solved: number
    state: Record<string, unknown>
    cast: Array<Record<string, string>>
    recent_cases: Array<{ session_id: string; mode: string; case_title: string; chapter_title: string; location_id: string; source: string; completed_at: string; correct: boolean }>
  }>('/story/progress'),
}
