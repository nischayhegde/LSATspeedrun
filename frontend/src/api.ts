import type {
  AttemptReward,
  CharacterGender,
  CoachingFeedback,
  GameResponse,
  GameState,
  PracticeSummary,
  StudySession,
  User,
} from './types'

const API_URL = import.meta.env.VITE_API_URL || '/v1'

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
    const csrf = readCookie('lsat_csrf')
    if (csrf) headers.set('X-CSRF-Token', csrf)
  }
  const response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(data?.error?.message || 'The request could not be completed.', response.status, data?.error?.code)
  }
  return data as T
}

type AsyncJob<T> = {
  id: string
  kind: 'coaching'
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
    if (job.status === 'failed') throw new ApiError(job.error || 'AI coaching failed. Please retry.', 502, 'ai_job_failed')
    await wait(1200)
  }
  throw new ApiError('AI coaching is taking longer than expected. Please retry.', 504, 'ai_job_timeout')
}

export const api = {
  health: () => request<{
    status: string
    questions: { total: number; lr: number; rc: number }
    datasets: string[]
    question_bank: { source: string; snapshot: boolean; manifest_total?: number; revisions?: Record<string, string> }
  }>('/health'),
  authConfig: () => request<{ google_client_id?: string | null; dev_auth_enabled: boolean }>('/auth/config'),
  me: () => request<{ user: User }>('/me'),
  googleLogin: (credential: string) =>
    request<{ user: User }>('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) }),
  devLogin: () =>
    request<{ user: User }>('/auth/dev', {
      method: 'POST',
      body: JSON.stringify({ email: 'student@localhost.test', display_name: 'Local Student' }),
    }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  game: () => request<GameResponse>('/game'),
  createGame: (body: { lawyer_name: string; firm_name: string; character_gender: CharacterGender }) =>
    request<GameResponse>('/game/profile', { method: 'POST', body: JSON.stringify(body) }),
  updateGame: (body: Partial<{ lawyer_name: string; firm_name: string; character_gender: CharacterGender }>) =>
    request<{ game: GameState }>('/game/profile', { method: 'PATCH', body: JSON.stringify(body) }),
  purchase: (assetKey: string) =>
    request<{ game: GameState }>('/game/purchases', { method: 'POST', body: JSON.stringify({ asset_key: assetKey }) }),
  advanceFirm: (targetTier: number) =>
    request<{ game: GameState }>('/game/advance', { method: 'POST', body: JSON.stringify({ target_tier: targetTier }) }),
  selectClient: (clientKey: string) =>
    request<{ game: GameState }>('/game/client', { method: 'POST', body: JSON.stringify({ client_key: clientKey }) }),
  collectPassive: () => request<{ collected: number; game: GameState }>('/game/passive-income/collect', { method: 'POST' }),
  claimDaily: (milestone: number) =>
    request<{ claimed: number; game: GameState }>(`/game/daily-rewards/${milestone}/claim`, { method: 'POST' }),
  chooseStory: (chapterKey: string, choiceKey: string) =>
    request<{ result: { chapter: string; choice: string; result: string }; game: GameState }>('/game/story/choice', {
      method: 'POST',
      body: JSON.stringify({ chapter_key: chapterKey, choice_key: choiceKey }),
    }),
  startQuest: (questKey: string) =>
    request<{ result: { quest: string; advance: number }; game: GameState }>('/game/quests/start', {
      method: 'POST',
      body: JSON.stringify({ quest_key: questKey }),
    }),
  rivalOperation: (rivalKey: string, operationKey: string) =>
    request<{ result: { rival_key: string; operation_key: string; cost: number; discount_bps: number }; game: GameState }>('/game/rival-operations', {
      method: 'POST',
      body: JSON.stringify({ rival_key: rivalKey, operation_key: operationKey }),
    }),
  currentSession: () => request<{ session: StudySession | null }>('/study-sessions/current'),
  startPractice: () => request<{ session: StudySession }>('/study-sessions', { method: 'POST' }),
  reviewAvailability: () => request<{ available_questions: number; session: StudySession | null }>('/study-sessions/review/available'),
  startReview: () => request<{ session: StudySession }>('/study-sessions/review', { method: 'POST' }),
  session: (id: string) => request<{ session: StudySession; summary?: PracticeSummary }>(`/study-sessions/${id}`),
  pauseSession: (id: string) =>
    request<{ session: StudySession }>(`/study-sessions/${id}/pause`, { method: 'POST' }),
  resumeSession: (id: string) =>
    request<{ session: StudySession }>(`/study-sessions/${id}/resume`, { method: 'POST' }),
  acknowledgeReview: (id: string) =>
    request<{ session: StudySession; summary?: PracticeSummary }>(`/study-sessions/${id}/debrief/acknowledge`, { method: 'POST' }),
  saveDraft: (sessionId: string, itemId: string, draft: { selected_label?: string; reasoning: string }) =>
    request<{ saved: boolean }>(`/study-sessions/${sessionId}/items/${itemId}/draft`, {
      method: 'PATCH',
      body: JSON.stringify(draft),
    }),
  submitAttempt: (
    sessionId: string,
    body: { item_id: string; selected_label: string; reasoning?: string; confidence?: 1 | 2 | 3 | 4 },
    idempotencyKey: string,
  ) =>
    request<{ result: import('./types').AttemptResult }>(`/study-sessions/${sessionId}/attempts`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    }),
  coaching: async (attemptId: string) => {
    const response = await request<{
      status: string
      coaching?: CoachingFeedback
      job?: AsyncJob<CoachingFeedback>
      reward?: AttemptReward | null
      game?: GameState | null
    }>(`/attempts/${attemptId}/coaching`, { method: 'POST' })
    const coaching = response.coaching ?? await waitForJob<CoachingFeedback>(response.job!.id)
    if (response.reward && response.game) return { coaching, reward: response.reward, game: response.game }
    const settled = await request<{ reward: AttemptReward | null; game: GameState | null }>(`/attempts/${attemptId}/reward`)
    return { coaching, reward: settled.reward, game: settled.game }
  },
}
