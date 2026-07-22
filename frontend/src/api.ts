import type {
  ArchiveCase,
  ArchiveCaseDetail,
  AttemptResult,
  BossCaseStatus,
  CoachingFeedback,
  CoachingHint,
  ColdCases,
  DailySummary,
  DiagnosticResults,
  StudySession,
  User,
} from './types'
import type { CinematicStoryPayload } from './story/adaptStoryBeat'

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/v1' : 'http://localhost:5000/v1')

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

type AsyncJob<T> = {
  id: string
  kind: 'coaching' | 'hint' | 'story' | 'session_plan'
  status: 'queued' | 'processing' | 'completed' | 'failed'
  result?: T
  error?: string
}

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))

async function waitForJob<T>(jobId: string): Promise<T> {
  const deadline = Date.now() + 8 * 60_000
  while (Date.now() < deadline) {
    const { job } = await request<{ job: AsyncJob<T> }>(`/jobs/${jobId}`)
    if (job.status === 'completed' && job.result !== undefined) return job.result
    if (job.status === 'failed') throw new ApiError(job.error || 'AI generation failed. Please retry.', 502, 'ai_job_failed')
    await wait(1200)
  }
  throw new ApiError('AI generation is taking longer than expected. Please retry.', 504, 'ai_job_timeout')
}

function requireJobId<T>(job?: AsyncJob<T>): string {
  if (job?.id) return job.id
  throw new ApiError('The server returned an invalid AI job response.', 502, 'invalid_ai_job')
}

async function startSession(path: string): Promise<{ session: StudySession }> {
  const response = await request<{ session?: StudySession; job?: AsyncJob<StudySession> }>(path, { method: 'POST' })
  return { session: response.session ?? await waitForJob<StudySession>(requireJobId(response.job)) }
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
  startDiagnostic: () => startSession('/diagnostics'),
  startDaily: () => startSession('/study-sessions'),
  coldCases: () => request<ColdCases>('/cold-cases'),
  startReview: () => startSession('/review-sessions'),
  bossCase: () => request<BossCaseStatus>('/boss-case'),
  startBoss: () => startSession('/boss-sessions'),
  currentSession: (mode: StudySession['mode'] = 'daily') =>
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
  coaching: async (attemptId: string) => {
    const response = await request<{ status: string; coaching?: CoachingFeedback; job?: AsyncJob<CoachingFeedback> }>(`/attempts/${attemptId}/coaching`, { method: 'POST' })
    const coaching = response.coaching ?? await waitForJob<CoachingFeedback>(requireJobId(response.job))
    return { status: 'completed' as const, coaching }
  },
  requestHint: async (sessionId: string, itemId: string) => {
    const response = await request<{ hint?: CoachingHint; job?: AsyncJob<CoachingHint> }>(`/study-sessions/${sessionId}/items/${itemId}/hints`, { method: 'POST' })
    return { hint: response.hint ?? await waitForJob<CoachingHint>(requireJobId(response.job)) }
  },
  generateStory: async (sessionId: string, itemId: string) => {
    const response = await request<{ story?: CinematicStoryPayload; job?: AsyncJob<CinematicStoryPayload> }>(`/study-sessions/${sessionId}/items/${itemId}/story`, { method: 'POST' })
    return { story: response.story ?? await waitForJob<CinematicStoryPayload>(requireJobId(response.job)) }
  },
  sessionSummary: (id: string) =>
    request<{ session: StudySession; summary: DailySummary }>(`/study-sessions/${id}/summary`),
  archive: (filters: { correctness?: string; section?: string; question_type?: string; page?: number } = {}) => {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([key, value]) => {
      if (value != null && value !== '') params.set(key, String(value))
    })
    const query = params.toString()
    return request<{
      cases: ArchiveCase[]
      filters: { question_types: string[] }
      pagination: { page: number; per_page: number; total: number; pages: number }
    }>(`/archive${query ? `?${query}` : ''}`)
  },
  archiveCase: (attemptId: string) => request<ArchiveCaseDetail>(`/archive/${attemptId}`),
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
