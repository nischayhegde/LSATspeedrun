import type {
  AssistanceLevel,
  AttemptReward,
  CharacterCosmetics,
  CharacterGender,
  CoachingFeedback,
  DailyDocket,
  GameResponse,
  GameState,
  HistoryAttempt,
  HistoryAttemptDetail,
  HistoryFacets,
  HistoryPage,
  HistorySession,
  PerformanceSnapshot,
  PracticeSummary,
  ReviewQueue,
  ScoreProjection,
  SessionReview,
  StudySession,
  TerritoryState,
  TrialPlan,
  User,
  WardrobeCatalog,
} from './types'

/** What `POST /game/territory` reports back about the district just signed. */
export type SecuredDistrict = {
  district: string
  name: string
  price: number
  standing_gained: number
  region_swept: boolean
  territory: TerritoryState
}

const API_URL = import.meta.env.VITE_API_URL || '/v1'

export class ApiError extends Error {
  status: number
  code: string
  /**
   * Per-field messages, when the endpoint sends any. Only the strategy gate
   * does so far: a refused gate has to point at the box that failed rather
   * than showing one generic sentence for six required operations.
   */
  fields?: Array<{ field: string | null; message: string }>
  /**
   * Only on a refused mandatory approach: whether the server will now accept a
   * withdrawal. It rides on the refusal because the refusal is what earns it.
   */
  standDown?: boolean

  constructor(
    message: string,
    status: number,
    code = 'request_failed',
    fields?: Array<{ field: string | null; message: string }>,
    standDown?: boolean,
  ) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
    this.standDown = standDown
  }
}

function readCookie(name: string) {
  const value = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`))
    ?.split('=')[1]
  return value ? decodeURIComponent(value) : undefined
}

type BootstrapResult = { ok: boolean; status: number; body: unknown }
type BootstrapMap = Record<string, Promise<BootstrapResult | null> | undefined>

/**
 * `index.html` starts the first GETs a protected screen needs before this
 * bundle has even been parsed. Each one is worth exactly one adoption: after
 * that the answer is stale and the caller wants the network. Adoption is only
 * safe when this build talks to the same-origin proxy the inline script used.
 */
function takeBootstrapped(path: string): Promise<BootstrapResult | null> | null {
  if (API_URL !== '/v1') return null
  const pending = (window as Window & { __lsatBootstrap?: BootstrapMap }).__lsatBootstrap
  const inflight = pending?.[path]
  if (!inflight) return null
  delete pending![path]
  return inflight
}

function unwrap<T>(result: BootstrapResult): T {
  const data = (result.body ?? {}) as {
    error?: {
      message?: string
      code?: string
      fields?: Array<{ field: string | null; message: string }>
      stand_down?: boolean
    }
  }
  if (!result.ok) {
    throw new ApiError(
      data?.error?.message || 'The request could not be completed.',
      result.status,
      data?.error?.code,
      data?.error?.fields,
      data?.error?.stand_down,
    )
  }
  return result.body as T
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method || 'GET'
  if (method.toUpperCase() === 'GET' && !init.body) {
    const bootstrapped = takeBootstrapped(path)
    if (bootstrapped) {
      const result = await bootstrapped
      if (result) return unwrap<T>(result)
    }
  }
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (!['GET', 'HEAD'].includes(method.toUpperCase())) {
    const csrf = readCookie('lsat_csrf')
    if (csrf) headers.set('X-CSRF-Token', csrf)
  }
  const response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(
      data?.error?.message || 'The request could not be completed.',
      response.status,
      data?.error?.code,
      data?.error?.fields,
      data?.error?.stand_down,
    )
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

/**
 * What one look at an attempt's explanation grading found.
 *
 * `pending` is a real answer, not an error: grading is a 20-30 second call that
 * runs on a background worker, so a caller polls this instead of holding a
 * request open and holding the player still. `unavailable` is terminal — grading
 * gave up, and the case was settled from the verified answer key instead.
 */
export type CoachingSnapshot = {
  status: 'completed' | 'pending' | 'unavailable'
  coaching?: CoachingFeedback
  reward?: AttemptReward | null
  game?: GameState | null
  notice?: string
}

export type HistoryQuery = {
  limit?: number
  offset?: number
  correct?: boolean
  question_type?: string
  section?: string
  session_id?: string
  from_review_queue?: boolean
  evidence_class?: string
  since?: string
  until?: string
  detail?: boolean
}

/** Drop unset filters rather than sending `?correct=undefined`. */
function historyQuery(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

export const api = {
  authConfig: () => request<{ google_client_id?: string | null; dev_auth_enabled: boolean }>('/auth/config'),
  me: () => request<{ user: User }>('/me'),
  updateMe: (
    body: Partial<{
      target_score: number | null
      target_test_date: string | null
      assistance_level: AssistanceLevel
      guided_tour_completed: boolean
    }>,
  ) => request<{ user: User }>('/me', { method: 'PATCH', body: JSON.stringify(body) }),
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
  cosmetics: () => request<{ cosmetics: WardrobeCatalog }>('/game/cosmetics'),
  /** Partial by design: only the categories named here move, so the panel can
   *  save one change without restating a look it may not fully know about. */
  saveCosmetics: (selection: Partial<CharacterCosmetics>) =>
    request<{ cosmetics: WardrobeCatalog; game: GameState }>('/game/cosmetics', {
      method: 'PATCH',
      body: JSON.stringify({ selection }),
    }),
  purchase: (assetKey: string) =>
    request<{ game: GameState }>('/game/purchases', { method: 'POST', body: JSON.stringify({ asset_key: assetKey }) }),
  secureDistrict: (districtKey: string) =>
    request<{ counsel: SecuredDistrict; game: GameState }>('/game/territory', {
      method: 'POST',
      body: JSON.stringify({ district_key: districtKey }),
    }),
  trialPlan: () => request<TrialPlan>('/trial'),
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
  // "I have read the ending" is an account fact, not a browser fact, so it is
  // stored with the campaign rather than only in localStorage — the same policy
  // the guided tour already follows. See `overlays.tsx` for the full policy.
  epilogueAcknowledgement: () => request<{ read: boolean }>('/game/story/epilogue'),
  acknowledgeEpilogue: () => request<{ read: boolean }>('/game/story/epilogue/read', { method: 'POST' }),
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
  activeSessions: () => request<{ sessions: StudySession[]; queue_cap: number }>('/study-sessions/active'),
  dailyDocket: () => request<{ daily_docket: DailyDocket }>(`/daily-docket?timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}`),
  performance: () => request<{ performance: PerformanceSnapshot }>('/performance'),
  currentDiagnostic: () => request<{
    session: StudySession | null
    latest: { session: StudySession; summary: PracticeSummary } | null
  }>('/diagnostics/current'),
  startDiagnostic: (accommodationMultiplier = 1) => request<{ session: StudySession }>('/diagnostics', {
    method: 'POST',
    body: JSON.stringify({ accommodation_multiplier: accommodationMultiplier }),
  }),
  startBlindReview: (diagnosticId: string) =>
    request<{ session: StudySession | null; blind_review_complete?: boolean }>(`/diagnostics/${diagnosticId}/blind-review`, {
      method: 'POST',
    }),
  startPractice: (options?: {
    size?: number
    question_type?: string
  }) => request<{ session: StudySession }>('/study-sessions', {
    method: 'POST',
    body: JSON.stringify(options || {}),
  }),
  session: (id: string) => request<{ session: StudySession; summary?: PracticeSummary }>(`/study-sessions/${id}`),
  pauseSession: (id: string) =>
    request<{ session: StudySession }>(`/study-sessions/${id}/pause`, { method: 'POST' }),
  resumeSession: (id: string) =>
    request<{ session: StudySession }>(`/study-sessions/${id}/resume`, { method: 'POST' }),
  abandonSession: (id: string) =>
    request<{ session: StudySession }>(`/study-sessions/${id}/abandon`, { method: 'POST' }),
  sessionReview: (id: string) => request<{ review: SessionReview }>(`/study-sessions/${id}/review`),
  acknowledgeSessionReview: (id: string) =>
    request<{ session: StudySession; brief_complete: boolean }>(`/study-sessions/${id}/review/acknowledge`, { method: 'POST' }),
  sessionHistory: (params: { limit?: number; offset?: number } = {}) =>
    request<{ sessions: HistorySession[]; total: number; limit: number; offset: number; has_more: boolean }>(
      `/history/sessions${historyQuery(params)}`,
    ),
  /** Compact rows for the answer grid. Paginated; a heavy account has thousands. */
  attemptHistory: (params: HistoryQuery = {}) =>
    request<HistoryPage<HistoryAttempt>>(`/history/attempts${historyQuery(params)}`),
  attemptDetail: (attemptId: string) =>
    request<{ attempt: HistoryAttemptDetail }>(`/history/attempts/${attemptId}`),
  historyFacets: () => request<HistoryFacets>('/history/facets'),
  projection: () => request<{ projection: ScoreProjection }>('/projection'),
  reviewQueue: () => request<{ review_queue: ReviewQueue }>('/reviews'),
  acknowledgeReview: (id: string) =>
    request<{ session: StudySession; settlement_pending?: boolean }>(
      `/study-sessions/${id}/debrief/acknowledge`,
      { method: 'POST' },
    ),
  saveDraft: (sessionId: string, itemId: string, draft: { selected_label?: string; reasoning: string }) =>
    request<{ saved: boolean }>(`/study-sessions/${sessionId}/items/${itemId}/draft`, {
      method: 'PATCH',
      body: JSON.stringify(draft),
    }),
  /* The sectioned mega-litigation. Marking an answer is not submitting it:
     nothing is graded until a section closes, which is why these four are
     separate from `submitAttempt` rather than options on it. */
  startExamSection: (sessionId: string, sectionIndex: number) =>
    request<{ session: StudySession; summary?: PracticeSummary }>(
      `/study-sessions/${sessionId}/sections/${sectionIndex}/start`,
      { method: 'POST' },
    ),
  submitExamSection: (sessionId: string, sectionIndex: number) =>
    request<{ session: StudySession; summary?: PracticeSummary }>(
      `/study-sessions/${sessionId}/sections/${sectionIndex}/submit`,
      { method: 'POST' },
    ),
  /** The running section's questions, fetched once so navigation costs no clock. */
  examSection: (sessionId: string) =>
    request<{ items: import('./types').ExamPaper[]; exam: import('./types').ExamState }>(
      `/study-sessions/${sessionId}/section`,
    ),
  /** Mark, change, clear (`null`) or flag one answer on the running sheet. */
  recordExamAnswer: (
    sessionId: string,
    itemId: string,
    body: { selected_label?: string | null; flagged?: boolean },
  ) =>
    request<{
      saved: boolean
      answer: { item_id: string; position: number; selected_label: string | null; flagged: boolean }
      exam: import('./types').ExamState
    }>(`/study-sessions/${sessionId}/answers/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  focusExamItem: (sessionId: string, position: number) =>
    request<{ session: StudySession; summary?: PracticeSummary }>(
      `/study-sessions/${sessionId}/focus/${position}`,
      { method: 'POST' },
    ),
  submitAttempt: (
    sessionId: string,
    body: {
      item_id: string
      selected_label: string
      reasoning?: string
      confidence?: number
      answer_changed?: boolean
      strategy_applied?: boolean
      strategy_prompt_ms?: number
      /** Time spent inside the strategy gate, held apart from the answer clock. */
      strategy_gate_ms?: number
      strategy_artifact?: import('./types').StrategyArtifact
    },
    idempotencyKey: string,
  ) =>
    request<{ result: import('./types').AttemptResult }>(`/study-sessions/${sessionId}/attempts`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    }),
  coaching: async (attemptId: string): Promise<CoachingSnapshot> => {
    const response = await request<{
      status: string
      coaching?: CoachingFeedback | null
      job?: AsyncJob<CoachingFeedback>
      reward?: AttemptReward | null
      game?: GameState | null
      notice?: string
    }>(`/attempts/${attemptId}/coaching`, { method: 'POST' })
    if (response.status === 'unavailable') {
      return { status: 'unavailable', notice: response.notice, reward: response.reward, game: response.game }
    }
    // Handed to a worker and still running. Returning immediately is the whole
    // point: the caller re-polls this while the player keeps moving.
    if (!response.coaching) return { status: 'pending' }
    if (response.reward && response.game) {
      return { status: 'completed', coaching: response.coaching, reward: response.reward, game: response.game }
    }
    const settled = await request<{ reward: AttemptReward | null; game: GameState | null }>(`/attempts/${attemptId}/reward`)
    return { status: 'completed', coaching: response.coaching, reward: settled.reward, game: settled.game }
  },
}
