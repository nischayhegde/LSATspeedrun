export type User = {
  id: string
  email: string
  display_name: string
  avatar_url?: string | null
  next_route: string
  game_ready: boolean
  diagnostic_complete: boolean
}

export type CharacterGender = 'male' | 'female'

export type GameRequirement = {
  reputation: number
  tier: number
  assets: string[]
}

export type GameAsset = {
  key: string
  type: 'upgrade' | 'staff' | 'connection' | 'rival' | 'cosmetic'
  name: string
  cost: number
  list_cost?: number
  discount_bps?: number
  reputation: number
  tier: number
  benefit: string
  description: string
  region?: string
  art?: string | null
  requires?: string[]
  owned: boolean
  available: boolean
  requirements: GameRequirement
}

export type ClientContract = {
  cases_remaining: number
  completed_contracts: number
  loyalty: number
}

export type GameClient = {
  key: string
  name: string
  base_fee: number
  reputation: number
  tier: number
  length: number
  icon: string
  description: string
  region?: string
  archetype?: string
  special?: string
  matter_type?: 'commercial' | 'pro_bono'
  reputation_win_bonus?: number
  reputation_loss_cap?: number
  requires?: string[]
  requirements: GameRequirement
  unlocked: boolean
  selected: boolean
  on_hold: boolean
  contract?: ClientContract | null
}

export type FirmTier = {
  tier: number
  name: string
  cost: number
  reputation: number
  short: string
  region: string
  feature: string
  rent_daily: number
  owned?: boolean
  next?: boolean
  available?: boolean
  required_assets?: string[]
  missing_assets?: string[]
}

export type AttemptReward = {
  id: string
  rule_version: string
  explanation_grade: 'Invalid' | 'Weak' | 'Good' | 'Excellent'
  explanation_score: number
  score: number
  breakdown: { answer: number; explanation: number; time: number }
  timing: { elapsed_seconds: number; target_seconds: number }
  client_key: string
  base_fee: number
  score_multiplier: number
  firm_multiplier: number
  streak_bonus: number
  staff_bonus: number
  contract_bonus: number
  quest_bonus: number
  payout: number
  reputation_before: number
  reputation_after: number
  reputation_change: number
  created_at: string
}

export type StoryChoice = {
  key: string
  label: string
  stakes: string
  result: string
}

export type StoryChapter = {
  key: string
  act: string
  tier: number
  scene: string
  title: string
  location: string
  speaker: string
  dialogue: string[]
  choices: StoryChoice[]
}

export type StoryQuest = {
  key: string
  tier: number
  category: 'pro_bono' | 'investigation' | 'shadow' | 'legacy'
  scene: string
  title: string
  patron: string
  description: string
  objective: string
  condition: string
  target: number
  reward_label: string
  start_label?: string
  active: boolean
  completed: boolean
  available: boolean
  progress: number
}

export type RivalOperation = {
  key: string
  name: string
  category: 'clean' | 'gray' | 'sabotage'
  description: string
  discount_bps: number
  cost: number
  heat_surcharge_bps?: number
  intel?: number
  influence?: number
  ethics_max?: number
  completed: boolean
  available: boolean
  missing: string[]
}

export type RivalTarget = GameAsset & { operations: RivalOperation[] }

export type StoryState = {
  ethics: number
  heat: number
  influence: number
  intel: number
  alignment: 'Principled' | 'Pragmatic' | 'Ruthless'
  pending_chapter?: StoryChapter | null
  active_quest?: StoryQuest | null
  quests: StoryQuest[]
  chapters: Array<{ key: string; act: string; tier: number; title: string; scene: string; seen: boolean; choice?: string | null }>
  completed_quests: string[]
  rival_discounts: Record<string, number>
  rival_targets: RivalTarget[]
}

export type GameState = {
  id: string
  lawyer_name: string
  firm_name: string
  character_gender: CharacterGender
  cash: number
  reputation: number
  reputation_band: { name: string; minimum: number; next?: number | null }
  office_tier: number
  office: FirmTier
  current_streak: number
  best_streak: number
  total_cases: number
  total_correct: number
  total_validated_correct: number
  lifetime_earnings: number
  firm_valuation: number
  owned_assets: string[]
  active_client: GameClient & { cases_remaining: number; effective_key: string }
  upkeep: {
    daily_rent: number
    offline_daily_rent: number
    offline_multiplier: number
    active_window_hours: number
    reputation_grace_hours: number
    rent_arrears: number
    arrears_cap: number
    lifetime_rent_paid: number
    last_settled_at: string
    last_active_at: string
    base_reputation_decay_daily: number
    reputation_guard: number
    reputation_decay_daily: number
    accruing: boolean
    completed: boolean
    completed_at?: string | null
    completion_requirement: { key: string; label: string }
  }
  passive_income: {
    hourly_rate: number
    stored_hours: number
    cap_hours: number
    available: number
    last_collected_at: string
  }
  daily: {
    date: string
    cases_completed: number
    claimed: number[]
    goals: Array<{ cases: number; reward: number; complete: boolean; claimed: boolean }>
  }
  achievements: Array<{ key: string; name: string; description: string; unlocked: boolean }>
  next_milestone?: { kind: 'tier' | 'asset'; name: string; cost: number; reputation: number } | null
  story: StoryState
  catalog: { assets: GameAsset[]; clients: GameClient[]; tiers: FirmTier[] }
}

export type GameResponse = { game: GameState | null; pending_reviews?: string[] }

export type Choice = { label: string; text: string }

export type StrategyDefinition = {
  key: string
  /** Published name in LSAC and prep materials. Catalog subtitle only. */
  title: string
  /** Student-facing name, used on the question card and dashboard. */
  plain_title: string
  /** Gerund form, for sentences the backend assembles. */
  plain_subject: string
  section: 'Logical Reasoning' | 'Reading Comprehension'
  prompt: string
  plain_line: string
  steps: string[]
  best_for: string
  sources: Array<{ label: string; url: string }>
}

export type StrategyTrial = StrategyDefinition & { variant: 'prompt' }

export type Question = {
  id: string
  section: 'Logical Reasoning' | 'Reading Comprehension'
  question_type: string
  passage?: { id: string; text: string; type?: string | null } | null
  stimulus?: string | null
  stem: string
  choices: Choice[]
}

export type CoachingFeedback = {
  provider: string
  model: string
  reasoning_effort: string
  prompt_version: string
  explanation_grade?: number | null
  reasoning_verdict: 'strong' | 'mostly_correct' | 'partial' | 'misconception' | 'unsupported' | 'not_provided'
  reasoning_summary: string
  understood_correctly?: string
  first_error?: { code: string; description: string; repair: string } | null
  answer_analysis: {
    correct_answer_explanation: string
    selected_answer_explanation: string
    choice_explanations: Array<{ label: string; is_correct: boolean; explanation: string }>
  }
  next_step_hint: string
  solution_method?: string
  debrief: string
}

export type SessionItem = {
  id: string
  position: number
  section_index: number
  requires_reasoning: boolean
  reasoning_min_chars: number
  strategy_trial?: StrategyTrial | null
  served_at: string
  elapsed_ms: number
  target_time_seconds: number
  case_terms?: { client_key: string; client_name: string; base_fee: number } | null
  timer_active: boolean
  draft: { selected_label?: string | null; reasoning: string; updated_at?: string | null }
  question: Question
}

export type ActiveOfficeCase = {
  sessionId: string
  clientKey: string
  clientName: string
  baseFee: number
}

export type AttemptResult = {
  attempt_id: string
  duplicate: boolean
  recorded: boolean
  feedback_released: boolean
  is_correct?: boolean
  elapsed_ms: number
  session_complete: boolean
  session_id: string
  coaching_status?: 'pending' | 'processing' | 'completed' | 'failed'
  has_reasoning?: boolean
  game_reward?: AttemptReward | null
  feedback?: {
    is_correct: boolean
    selected_label: string
    correct_label: string
    headline: string
    diagnosis: string
    coaching_notice: string
    coaching?: CoachingFeedback
  }
}

export type StudySession = {
  id: string
  mode: 'practice' | 'diagnostic' | 'blind_review'
  diagnostic_session_id?: string | null
  practice_style: 'cases' | 'diagnostic' | 'blind_review'
  feedback_policy: 'immediate' | 'delayed'
  status: 'in_progress' | 'paused' | 'completed' | 'abandoned'
  target_minutes: number
  accommodation_multiplier: number
  /** Blocks keep their labels and boundaries; a mega-litigation has one clock, so they carry no minutes. */
  section_plan: Array<{ index: number; label: string; start: number; end: number; questions: number }>
  ended_by_user: boolean
  total_items: number
  current_index: number
  progress_percent: number
  started_at: string
  /** Whole-form deadline. Set only for a mega-litigation. */
  deadline_at?: string | null
  /** Server-authoritative time left on that deadline; the client counts down between polls but never decides. */
  remaining_ms?: number | null
  time_limit_seconds?: number | null
  completed_at?: string | null
  blind_review?: {
    state: 'unavailable' | 'not_required' | 'not_needed' | 'ready' | 'in_progress' | 'paused' | 'completed'
    session_id?: string | null
    total_items: number
  }
  current_item?: SessionItem | null
  pending_item?: SessionItem | null
  pending_result?: AttemptResult | null
}

export type PracticeSummary = {
  kind: 'practice' | 'diagnostic' | 'blind_review'
  practice_style?: StudySession['practice_style']
  feedback_policy?: StudySession['feedback_policy']
  accuracy: number
  /** Correct out of every question on the form, counting anything left blank. The promotion bar reads this one. */
  form_accuracy?: number
  correct: number
  questions_completed: number
  elapsed_minutes: number
  explanation_accuracy?: number | null
  skills: Array<{ name: string; attempts: number; accuracy: number }>
  sections?: Array<{ index: number; label: string; correct: number; questions: number; accuracy: number; elapsed_minutes: number; timing_compromised: boolean }>
  omitted?: number
  confidence?: { average: number | null; high_confidence_errors: number; high_confidence_attempts: number }
  timing_compromised?: boolean
  promotion?: MegaLitigationPromotion
}

export type MegaLitigationPromotion = {
  name: string
  tier: number
  granted_assets: Array<{ key: string; name: string }>
  waived_cost: number
  reputation_before: number
  reputation_after: number
}

export type PerformanceMetric = {
  attempts: number
  accuracy: number
  average_seconds: number
  pace_adherence: number
  reasoning: number | null
}

export type StrategyResult = {
  key: string
  title: string
  plain_title: string
  plain_subject: string
  section: StrategyDefinition['section']
  best_for: string
  sample: number
  accuracy: number
  average_seconds: number
  pace_adherence: number | null
  control_sample: number
  control_accuracy: number
  control_seconds: number
  lift: number | null
  explanation_mean: number | null
  control_explanation_mean: number | null
  explanation_lift: number | null
  skipped: number
  /** Internal three-tier evidence state. Prefer `verdict` for display. */
  status: 'forming' | 'directional' | 'supported'
  ranking_score: number
  verdict: 'checking' | 'confirmed'
  verdict_label: string
  summary: string
  detail: string
  next_step: string
  with_headline: string
  with_note: string
  without_headline: string
  without_note: string
  difference_headline: string
  difference_note: string
}

export type PerformanceSnapshot = {
  overall: PerformanceMetric & {
  speedrun_index: number
  accuracy_delta: number | null
  pace_delta: number | null
  average_seconds_delta: number | null
  reasoning_delta: number | null
  evidence: 'baseline' | 'emerging' | 'directional' | 'stable'
}
  recent: PerformanceMetric
  skills: Array<PerformanceMetric & { name: string; priority: number }>
  trend: Array<{
    id: string
    kind: 'practice' | 'diagnostic'
    date: string | null
    accuracy: number
    reasoning: number | null
    questions: number
    minutes: number
  }>
  diagnostic: {
    session_id: string
    completed_at: string | null
    summary: PracticeSummary
    raw_correct: number
    raw_total: number
    form_total: number
    form_accuracy: number | null
    sections: NonNullable<PracticeSummary['sections']>
    promotion: MegaLitigationPromotion | null
    time_limit_minutes: number
    elapsed_minutes: number
    budget_used_percent: number
    completion_percent: number
    projection_available: false
    projection_note: string
  } | null
  test_performance: PerformanceMetric
  coached_practice: PerformanceMetric
  evidence_classes: Record<string, PerformanceMetric>
  readiness: { status: 'forming' | 'ready'; lr_samples: number; rc_samples: number; completed_diagnostics: number }
  review: ReviewQueue & { recovery_rate: number | null }
  confidence: { average: number | null; high_confidence_error_rate: number | null; sample: number }
  strategy_lab?: {
    catalog: StrategyDefinition[]
    results: StrategyResult[]
    leader: StrategyResult | null
    trials_completed: number
    strategies_tested: number
    strongest: StrategyResult | null
    intro: string
    empty_state: { title: string; body: string }
    catalog_note: string
    evidence_note: string
  }
  /** What the last mega-litigation told practice to work on. */
  focus: {
    types: string[]
    session_id: string | null
    completed_at: string | null
    baseline_accuracy: number | null
    explanation: string
  }
  recommendation: { skill: string; accuracy: number; reason: string } | null
}

export type ReviewQueue = {
  due: number
  scheduled: number
  mastered: number
  items: Array<{ id: string; question_id: string; question_type: string; section: Question['section']; reason_code: string; interval_index: number; due_at: string }>
}

export type DailyDocketState = 'locked' | 'clear' | 'ready' | 'active' | 'complete'

export type DailyDocket = {
  date: string
  timezone: string
  active_session: StudySession | null
  cases: {
    state: DailyDocketState
    target: number
    repairs_due: number
    session_id?: string | null
    summary?: PracticeSummary | null
  }
  deep_brief: { state: DailyDocketState; session_id?: string | null; priority_count: number }
  next_action: {
    kind: 'resume' | 'start_cases' | 'open_brief' | 'done'
    session_id?: string | null
    label: string
  }
}

export type SessionReview = {
  session: StudySession
  summary: PracticeSummary
  comparison?: {
    diagnostic: { session_id: string; summary: PracticeSummary }
    blind_review?: { session_id: string; summary: PracticeSummary } | null
  } | null
  items: Array<{
    position: number
    question: Question
    attempt_id: string
    selected_label: string
    correct_label: string
    is_correct: boolean
    confidence: number | null
    elapsed_ms: number
    target_time_seconds: number
    priority_reason: 'high_confidence_miss' | 'miss' | 'low_confidence_correct' | 'slow_correct' | null
    evidence_class: string
    feedback: AttemptResult['feedback']
    coaching_status: string
    diagnostic_selected_label?: string | null
    blind_review_selected_label?: string | null
    blind_review_is_correct?: boolean | null
  }>
}
