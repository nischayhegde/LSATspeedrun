export type User = {
  id: string
  email: string
  display_name: string
  avatar_url?: string | null
  next_route: string
  game_ready: boolean
}

export type CharacterGender = 'male' | 'female'

export type GameRequirement = {
  reputation: number
  tier: number
  assets: string[]
}

export type GameAsset = {
  key: string
  type: 'upgrade' | 'staff' | 'connection' | 'rival'
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
  served_at: string
  elapsed_ms: number
  target_time_seconds: number
  case_terms?: { client_key: string; client_name: string; base_fee: number } | null
  timer_active: boolean
  draft: { selected_label?: string | null; reasoning: string; updated_at?: string | null }
  question: Question
}

export type AttemptResult = {
  attempt_id: string
  duplicate: boolean
  is_correct: boolean
  elapsed_ms: number
  session_complete: boolean
  session_id: string
  coaching_status: 'pending' | 'processing' | 'completed' | 'failed'
  has_reasoning: boolean
  game_reward?: AttemptReward | null
  feedback: {
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
  mode: 'practice'
  status: 'in_progress' | 'paused' | 'completed'
  total_items: number
  current_index: number
  progress_percent: number
  started_at: string
  completed_at?: string | null
  current_item?: SessionItem | null
  pending_item?: SessionItem | null
  pending_result?: AttemptResult | null
}

export type PracticeSummary = {
  kind: 'practice'
  accuracy: number
  correct: number
  questions_completed: number
  elapsed_minutes: number
  explanation_accuracy?: number | null
  skills: Array<{ name: string; attempts: number; accuracy: number }>
}
