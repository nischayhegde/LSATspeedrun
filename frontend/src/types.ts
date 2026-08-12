export type AssistanceLevel = 'full' | 'focus'

export type User = {
  id: string
  email: string
  display_name: string
  avatar_url?: string | null
  next_route: string
  game_ready: boolean
  diagnostic_complete: boolean
  target_score: number | null
  target_test_date: string | null
  /** "focus" hides office/firm/world chrome for a leaner, high-score-focused view. Always user-overridable. */
  assistance_level: AssistanceLevel
  /** Set once the account has finished or skipped the guided tour, on any device. */
  guided_tour_completed: boolean
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
  /**
   * Dollars per hour this one item adds to the passive rate, present only on the
   * minority of assets that genuinely earn while idle. Absent means the item
   * earns nothing by the hour — not that the number is unknown — so the office
   * readout reads the absence as "this does not earn on its own".
   */
  passive_hourly?: number
  /**
   * The share this item adds to the firm's case-fee multiplier, as a fraction:
   * `.04` is the +4% the catalog prints. It is realised only when a case is won,
   * so it is never an hourly figure. Absent on cosmetics, which have no effect.
   */
  payout_mult?: number
  /**
   * Connections only: the districts this network lets you sign as standing
   * counsel, and whether each is currently held. Read by the connection card in
   * the Firm tab, which names them, and by the office relationship wall, whose
   * seals say which network they are and how much of the map each has actually
   * been used for.
   */
  districts?: Array<{ key: string; name: string; held: boolean }>
  districts_held?: number
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
  /**
   * How much of this client's value arrives only when the contract closes, in
   * basis points. Expected value is equalised across every client at a tier, so
   * this split is the entire difference between signing one and signing another:
   * money banked per case against money staked on finishing the contract.
   */
  close_share_bps?: number
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
  /** Chapters and earlier files still standing between the firm and this one. */
  locked_by: string[]
  progress: number
}

export type StoryEpilogue = {
  ending_key: string
  title: string
  verdict: string
  beats: string[]
  closing: string
  promise?: string | null
  alignment: string
  alignment_note: string
  signature: string
  opened_at?: string | null
  completed_at?: string | null
  days_elapsed?: number | null
  chapters_resolved: number
  chapters_total: number
  quests_closed: number
  quests_total: number
  shadow_files_closed: number
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
  /** Validated case wins the operation consumes. See `story.casework`. */
  casework?: number
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
  epilogue?: StoryEpilogue | null
  active_quest?: StoryQuest | null
  quests: StoryQuest[]
  chapters: Array<{ key: string; act: string; tier: number; title: string; scene: string; seen: boolean; choice?: string | null }>
  completed_quests: string[]
  rival_discounts: Record<string, number>
  rival_targets: RivalTarget[]
  /** Validated case wins earned and not yet spent on rival operations. */
  casework: number
  casework_spent: number
}

/** The wardrobe categories the player's own 3D counsel is built from. */
export type CosmeticCategoryKey = 'suit' | 'tie' | 'hair' | 'eyewear' | 'accessory'

/** One piece of the player's look, per category. Always complete: the server
 *  fills any category the player has not customized with that category's
 *  "as issued" default, which renders exactly as the character always has. */
export type CharacterCosmetics = Record<CosmeticCategoryKey, string>

export type CosmeticItem = {
  key: string
  category: CosmeticCategoryKey
  name: string
  flavor: string
  unlocked: boolean
  /** Plain-language unlock condition, shown on locked pieces. */
  requirement: string
  unlock: { kind: 'start' | 'tier' | 'reputation' | 'cases' | 'chapter'; value?: number | string }
}

export type CosmeticCategory = {
  key: CosmeticCategoryKey
  name: string
  blurb: string
  default: string
  selected: string
  items: CosmeticItem[]
}

export type WardrobeCatalog = {
  selection: CharacterCosmetics
  categories: CosmeticCategory[]
}

/** One district the firm can hold a standing retainer over.
 *
 *  `landmark_key` is an optional join onto the 3D scene's own district
 *  directory (`MapLandmark.key`). The backend owns this catalog, so a district
 *  stays purchasable and legible even when the procedural planner lays the
 *  region out differently or renames a place. */
export type TerritoryDistrict = {
  key: string
  name: string
  region: string
  region_name: string
  landmark_key: string | null
  tier: number
  reputation: number
  retainer: string
  description: string
  cost: number
  standing: number
  rent_relief_bps: number
  owned: boolean
  locks: string[]
  affordable: boolean
  available: boolean
}

export type TerritoryState = {
  districts: TerritoryDistrict[]
  regions: Array<{
    key: string
    name: string
    seat: string
    /** Inclusive first and last firm tier this region covers. The catalog's own
     *  `region` field is a different axis -- the street address the firm held at
     *  one tier -- and this range is what nests one inside the other, so the two
     *  can be shown on the same screen without reading as a contradiction. */
    tier_range: [number, number]
    total: number
    held: number
    swept: boolean
    sweep_standing: number
  }>
  held: number
  total: number
  standing: number
  standing_cap: number
  /** Standing lifts the reputation floor only to here; the gates above it stay
   *  payable in casework alone. */
  standing_floor_ceiling: number
  rent_relief_bps: number
  daily_rent: number
  relieved_daily_rent: number
}

export type TrialPlan = {
  status: 'unscheduled' | 'passed' | 'no_evidence' | 'no_target' | 'on_plan' | 'tight' | 'accuracy_gap' | 'target_met'
  test_date: string | null
  target_score: number | null
  days_remaining: number | null
  weeks_remaining: number | null
  phase: string | null
  phase_note: string | null
  headline: string
  detail: string
  streak: number
  projected_score?: number
  pace: {
    weekly_target: number
    recent_week: number
    state: 'ahead' | 'on_track' | 'behind' | 'idle'
    note: string
    evidence_cases: number
    gap_cases: number | null
    case_weight: number
  } | null
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
  /** Consecutive calendar days on which a case was finished — distinct from the
   *  validated-win streak above. Advances at most once per day, and no longer
   *  advances merely by loading a page. */
  daily_streak: number
  daily_streak_best: number
  /** What the win streak is currently worth as a reputation floor, and which of
   *  the two gates is binding. `day_limited` means more casework today cannot
   *  raise it and only coming back tomorrow can — the anti-farm gate. */
  streak_form: {
    wins: number
    days: number
    standing: number
    earned_standing: number
    licensed_standing: number
    cap: number
    next_win_target: number | null
    day_limited: boolean
  }
  total_cases: number
  total_correct: number
  total_validated_correct: number
  lifetime_earnings: number
  firm_valuation: number
  owned_assets: string[]
  active_client: GameClient & { cases_remaining: number; effective_key: string }
  upkeep: {
    /** What the lease actually costs after district retainers offset it. */
    daily_rent: number
    /** Before that offset, so the reduction is showable rather than implied. */
    list_daily_rent: number
    rent_relief: number
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
  achievements: Array<{
    key: string
    name: string
    description: string
    unlocked: boolean
    /** How far along a locked honour is, when it counts something. Absent on
     *  the ones that are a yes or a no, like joining a named network. */
    progress?: { current: number; target: number; unit: 'cases' | 'streak' | 'reputation' | 'hired' | 'firms' | 'money' | 'tier' }
  }>
  next_milestone?: { kind: 'tier' | 'asset'; name: string; cost: number; reputation: number } | null
  territory: TerritoryState
  story: StoryState
  /** How the player's counsel is currently dressed. Travels with every game
   *  payload because three separate 3D surfaces need it on first paint. */
  cosmetics: CharacterCosmetics
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

/**
 * A named technique was offered on this question.
 *
 * `required` is the mandatory arm: the same offer, with no way to decline it
 * up front. The card drops its Use it / Skip pair and the gate below arms
 * itself, because there is no decision left to take. It is a property of the
 * delivered question rather than of the assignment — a mandatory arm whose
 * gate could not be built arrives here as `false`, since refusing a skip for
 * steps nobody was shown would be a dead end.
 */
export type StrategyTrial = StrategyDefinition & {
  variant: 'prompt' | 'prompt_required'
  required: boolean
}

/**
 * The control arm's card. It carries no technique, no steps, and no gate,
 * because naming nothing is the condition being measured — the difference
 * against it is what ranks every approach on the dashboard.
 *
 * Deliberately a separate field from `strategy_trial` rather than a variant of
 * it: `strategy_trial` means "a named technique was offered" on both sides of
 * the wire, and the apply/skip decision the server requires is keyed off that.
 * There is nothing here to apply or to skip. See backend/app/services.py.
 */
export type StrategyNeutralCard = {
  variant: 'control_visible'
  plain_title: string
  plain_line: string
  note: string
}

/**
 * One required operation inside a strategy gate. The server authors these, and
 * the gate component renders whatever it is handed, so adding a strategy never
 * touches the component. See backend/app/enforcement.py.
 */
export type StrategyGateField = {
  key: string
  kind:
    | 'text'
    | 'segment_pick'
    | 'segment_label'
    | 'segment_notes'
    | 'choice_eliminate'
    | 'choice_pick'
    | 'select'
    | 'rows'
    | 'contrapositive'
  /** `pre_answer` blocks the answer choices. `pre_submit` blocks only the submit. */
  stage: 'pre_answer' | 'pre_submit'
  label: string
  help?: string
  placeholder?: string
  message?: string
  segments?: string[]
  options?: Array<{ value?: string; text?: string; id?: string; template?: string } | string>
  min_words?: number
  max_words?: number | null
  min_chars?: number
  single_sentence?: boolean
  short_message?: string
  copy_message?: string
  source?: string
  min?: number
  max?: number | null
  exclude_field?: string | null
  count_message?: string
  overlap_message?: string
  exactly_one?: string | null
  not_all_same?: boolean
  missing_message?: string
  exactly_one_message?: string
  variety_message?: string
  length_message?: string
  duplicate_message?: string
  min_eliminated?: number
  reasons?: string[]
  require_token?: boolean
  choice_tokens?: Record<string, string[]>
  reason_message?: string
  token_message?: string
  columns?: Array<{ key: string; label: string; kind: 'text' | 'select'; options: string[]; min_words: number }>
  min_rows?: number
  max_rows?: number
  blank_message?: string
  shared_term_message?: string
  passage_name_message?: string
  source_field?: string
}

export type StrategyGateSpec = {
  version: string
  strategy_key: string
  kind: 'sequence_reveal' | 'annotate_source' | 'choice_elimination' | 'structured_input' | 'candidate_operation'
  strength: 'strong' | 'moderate'
  level: 'full' | 'light'
  /** False once demonstrated mastery has retired the scaffolding. */
  blocking: boolean
  hides_choices: boolean
  restricts_choices: boolean
  required: boolean
  /** True when the server will already accept a withdrawal on this question. */
  stand_down_ready: boolean
  /** How long in the panel earns a withdrawal. The server decides; this mirrors it. */
  stand_down_after_ms: number
  instruction: string
  confirm: string
  fields: StrategyGateField[]
  copy: Record<string, string>
}

/** What the gate posts alongside the answer. */
export type StrategyArtifact = { fields: Record<string, unknown> }

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
  strategy_neutral?: StrategyNeutralCard | null
  strategy_gate?: StrategyGateSpec | null
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

/** One separately timed section of a mega-litigation, as the client sees it. */
export type ExamSection = {
  index: number
  label: string
  section_type: string
  questions: number
  start_position: number
  end_position: number
  time_limit_seconds: number
  /** Intermission owed *after* this section. Non-zero on exactly one section. */
  break_seconds: number
  status: 'pending' | 'in_progress' | 'completed'
  started_at: string | null
  deadline_at: string | null
  ended_at: string | null
  ended_reason: 'submitted' | 'expired' | 'abandoned' | null
  unanswered: number
  target_time_seconds: number
}

/** One row of the running section's answer sheet. Says nothing about correctness. */
export type ExamAnswerSheetEntry = {
  position: number
  item_id: string
  /** Numbered from 1 inside its own section, the way the real interface numbers. */
  number: number
  answered: boolean
  flagged: boolean
  passage_id: string | null
}

/** One question of the running section, delivered up front. No case dressing. */
export type ExamPaper = {
  id: string
  position: number
  number: number
  selected_label: string | null
  flagged: boolean
  target_time_seconds: number
  question: Question
}

export type ExamState = {
  stage: 'awaiting_section' | 'in_section' | 'intermission' | 'completed'
  sections: ExamSection[]
  active_section_index: number | null
  next_section_index: number | null
  /**
   * Milliseconds left on whichever clock is running — the section's, or the
   * intermission's. The client ticks this down between reads for smoothness and
   * re-reads on every server reply, but the server alone decides when a section
   * is over: a countdown that reaches zero here only prompts a read.
   */
  remaining_ms: number | null
  warning_seconds: number
  intermission_ends_at: string | null
  /** When an unattended boundary gives up and closes the sitting out. */
  boundary_expires_at: string | null
  answered: number
  answer_sheet: ExamAnswerSheetEntry[]
}

export type StudySession = {
  id: string
  mode: 'practice' | 'diagnostic' | 'blind_review'
  /** Set only on a blind review: the diagnostic whose misses it retries. */
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
  /** Whole-form deadline. Only on a pre-0036 mega-litigation, which had one. */
  deadline_at?: string | null
  /** Server-authoritative time left on that deadline; the client counts down between polls but never decides. */
  remaining_ms?: number | null
  /**
   * Present exactly when the run is administered as separately timed sections,
   * which is every mega-litigation started since 0036. Its absence on a
   * diagnostic means a sitting begun under the old whole-form clock, which
   * finishes under the rules it started with.
   */
  exam?: ExamState | null
  time_limit_seconds?: number | null
  completed_at?: string | null
  /** Answer-release stage of a completed diagnostic. Absent on every other run. */
  blind_review?: {
    state: 'unavailable' | 'not_required' | 'not_needed' | 'ready' | 'in_progress' | 'paused' | 'completed'
    session_id?: string | null
    total_items: number
  }
  current_item?: SessionItem | null
  pending_item?: SessionItem | null
  pending_result?: AttemptResult | null
}

/** Per-section facts a sitting produced. Rates are over the whole section. */
export type ExamSectionReport = {
  index: number
  label: string
  section_type: string
  questions: number
  answered: number
  unanswered: number
  correct: number
  /** Over every question in the section, blanks included. A blank is a result. */
  accuracy: number
  /** Over what was actually answered, so the clock's cost separates from being wrong. */
  answered_accuracy: number | null
  time_limit_seconds: number
  seconds_used: number | null
  seconds_on_questions: number
  ended_reason: 'submitted' | 'expired' | 'abandoned' | null
  ran_out_of_time: boolean
  flagged: number
  flagged_unanswered: number
  answers_changed: number
  /** Both halves scored over their own whole length, so a collapse reads as one. */
  opening: { questions: number; correct: number }
  closing: { questions: number; correct: number }
}

export type ExamReport = {
  administered: true
  sections: ExamSectionReport[]
  unanswered: number
  sections_expired: number
  sections_abandoned: number
  flagged_unanswered: number
  answers_changed: number
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
  sections?: Array<{ index: number; label: string; correct: number; questions: number; answered?: number; accuracy: number; elapsed_minutes: number; timing_compromised: boolean }>
  /** Only on a sectioned mega-litigation. What the administration itself produced. */
  exam?: ExamReport
  omitted?: number
  confidence?: { average: number | null; high_confidence_errors: number; high_confidence_attempts: number }
  timing_compromised?: boolean
  promotion?: MegaLitigationPromotion
  /**
   * Present instead of `promotion` when the form cleared the bar but the free
   * tier was not on offer. The server only sets it on that branch, so its mere
   * presence means "you earned this and it was withheld" — see
   * `finalize_diagnostic` in backend/app/services.py.
   */
  promotion_status?: MegaLitigationPromotionStatus
}

/** Whether a cleared mega-litigation would promote the firm, and why not. */
export type MegaLitigationPromotionStatus = {
  available: boolean
  blocked_reason: 'cooldown' | 'lifetime_limit' | 'max_tier' | null
  /** Free promotions already granted, out of `limit`. */
  used: number
  limit: number
  remaining: number
  cooldown_hours: number
  /** ISO timestamp the cooldown lifts. Only set when `blocked_reason` is `cooldown`. */
  available_at: string | null
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
  /** Of the prompt-arm sample, how many the student self-reported using. Shown as a compliance rate — never used to define the treatment arm. */
  applied: number
  skipped: number
  ranking_score: number
  /** Always "measuring" — there is deliberately no "confirmed"/"supported" binary. See `research/00-implementation-plan.md` P0-6. */
  verdict: 'measuring'
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
  trial: TrialPlan
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
    /** Null on a form sat before sections existed, which had no bell to report. */
    exam: ExamReport | null
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
  projection?: ScoreProjection
  confidence: { average: number | null; high_confidence_error_rate: number | null; sample: number }
  strategy_lab?: {
    catalog: StrategyDefinition[]
    results: StrategyResult[]
    /** The approach with the most encouraging running total so far. Never a claim that it works — see `evidence_note`. */
    leader: StrategyResult | null
    trials_completed: number
    strategies_tested: number
    intro: string
    empty_state: { title: string; body: string }
    catalog_note: string
    evidence_note: string
    /** The same comparison run separately for Logical Reasoning and Reading Comprehension. */
    sections: StrategySectionReading[]
    sections_note: string
  }
  /** What practice is weighted toward, and why.
   *
   * This used to be the last mega-litigation's verdict and nothing else. It is
   * now read from every first encounter the account has filed, decayed toward
   * recent work, so it moves as a student improves rather than staying frozen
   * at whatever their last sitting said. `sitting` is the old figure, kept
   * because a student who has just finished a form wants to know what it said —
   * it is a report of that run and no longer a statement about what practice
   * will do next. */
  focus: {
    types: string[]
    weak: {
      type: string
      section: string
      /** Points below this student's own accuracy on the *rest* of that
       * section, after shrinkage. The rest rather than the whole: a baseline
       * containing the type's own answers is one the type moves. */
      gap: number
      shrunk_accuracy: number
      raw_accuracy: number
      /** The rest of the section, which is what `gap` is measured against. */
      section_baseline: number
      effective_sample: number
      answers: number
      half_width: number
      /** Whether the gap clears its own 95% interval. A gap that does not is
       * reported and never acted on. */
      separates: boolean
    }[]
    /** Whole-section accuracy, for display. Not what `gap` is measured against. */
    section_baselines: Record<string, number>
    first_encounters: number
    half_life_days: number
    sitting: {
      types: string[]
      session_id: string | null
      completed_at: string | null
      baseline_accuracy: number | null
    }
    explanation: string
  }
  recommendation: { skill: string; accuracy: number; reason: string } | null
}

/**
 * One approach's record inside a single section's comparison. Every figure and
 * every piece of prose is computed in `backend/app/strategies.py`; nothing on
 * the client decides what counts as enough evidence or formats a number the
 * backend withheld.
 */
export type StrategySectionResult = {
  key: string
  plain_title: string
  /** The catalogue's own label for the approach, which is not what grouped it. */
  section: string
  sample: number
  control_sample: number
  lift: number | null
  /** The difference after shrinking both arms toward "this made no difference". */
  adjusted_lift: number | null
  /** Effective per-arm size of the difference, dominated by the thinner arm. */
  contrast_sample: number
  contrast_evidence: string
  eligible: boolean
  with_headline: string
  with_note: string
  without_headline: string
  without_note: string
  difference_headline: string
  /** Never a claim that an approach works; see the panel's own evidence note. */
  verdict: string
  verdict_label: string
  /** The two sentences the armed gate's record line shows, both counts rather than claims. */
  summary: string
  detail: string
}

/** The Methods tab's reading for one section: Logical Reasoning or Reading Comprehension. */
export type StrategySectionReading = {
  section: string
  short_label: string
  /**
   * `leader` names an approach. `level` means the comparison is strong enough
   * to read and nothing is ahead. `insufficient` and `none` are the two ways of
   * not having an answer, and both say which.
   */
  status: 'leader' | 'level' | 'insufficient' | 'none'
  headline: string
  summary: string
  next_step: string
  evidence_label: string | null
  evidence_note: string | null
  lift_headline: string
  trials: number
  prompt_trials: number
  control_trials: number
  strategies_tested: number
  leader: StrategySectionResult | null
  /** Whichever approach the reading is about, named or not. */
  focus: StrategySectionResult | null
  results: StrategySectionResult[]
  itt: { note: string }
}

export type ReviewQueue = {
  due: number
  scheduled: number
  mastered: number
  /** Every card the scheduler is tracking, mastered ones included. */
  tracked?: number
  /** The retention the scheduler aims to hold each card above. */
  desired_retention?: number
  /** Recall probability of the single weakest card right now, 0-1. */
  weakest_retrievability?: number | null
  items: Array<{
    id: string
    question_id: string
    question_type: string
    section: Question['section']
    reason_code: string
    interval_index: number
    retrievability?: number
    due_at: string
  }>
}

/** One persisted point on the projected-score trend line. */
export type ProjectionPoint = {
  id: string
  date: string
  scaled_score: number
  lower_bound: number
  upper_bound: number
  percentile: number | null
  effective_sample: number
  observed_attempts: number
  evidence_grade: 'baseline' | 'emerging' | 'directional' | 'stable'
}

/**
 * A projected LSAT score, always reported as a band rather than a point.
 * `available: false` is the honest answer before any question is answered —
 * there is no `scaled_score` on that branch, by design.
 */
export type ScoreProjection =
  | {
      available: false
      reason: string
      note: string
      model_version: string
      history: ProjectionPoint[]
      target_score: number | null
    }
  | {
      available: true
      model_version: string
      scaled_score: number
      lower_bound: number
      upper_bound: number
      band_confidence: number
      percentile: number | null
      percentile_lower: number | null
      percentile_upper: number | null
      estimated_accuracy: number
      projected_raw: number
      form_items: number
      form_lr_items: number
      form_rc_items: number
      effective_sample: number
      observed_attempts: number
      lr_attempts: number
      rc_attempts: number
      lr_accuracy: number
      rc_accuracy: number
      evidence_grade: 'baseline' | 'emerging' | 'directional' | 'stable'
      missing_sections: string[]
      uncertainty: {
        sampling: number
        lsat_sem: number
        equating: number
        bank_calibration: number
        missing_section: number
        total: number
      }
      method: {
        conversion_table: string
        percentile_table: string
        sem_source: string
        recency_half_life_days: number
        evidence_weights: Record<string, number>
      }
      history: ProjectionPoint[]
      target_score: number | null
      target_gap?: number
      target_within_band?: boolean
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
  trial: TrialPlan
}

/** One previously answered question, as the history grid renders it. */
export type HistoryAttempt = {
  attempt_id: string
  session_id: string
  position: number
  question_id: string
  question_type: string
  section: Question['section']
  is_correct: boolean
  selected_label: string
  correct_label: string
  confidence: number | null
  answer_changed: boolean
  evidence_class: string
  from_review_queue: boolean
  elapsed_ms: number
  target_time_seconds: number
  over_target: boolean
  pace_ratio: number | null
  explanation_score: number | null
  coaching_status: string
  has_reasoning: boolean
  created_at: string | null
}

/** The same row with everything needed to re-read the item and the coaching. */
export type HistoryAttemptDetail = HistoryAttempt & {
  question: Question & { difficulty?: number }
  reasoning_text: string | null
  feedback: AttemptResult['feedback'] | null
  strategy_key: string | null
  strategy_applied: boolean | null
  session: { id: string; mode: StudySession['mode']; status: StudySession['status']; completed_at: string | null }
}

export type HistoryPage<T> = {
  attempts: T[]
  total: number
  limit: number
  offset: number
  has_more: boolean
  filters: {
    correct: boolean | null
    question_type: string | null
    section: string | null
    session_id: string | null
    from_review_queue: boolean | null
    evidence_class: string | null
    since: string | null
    until: string | null
  }
}

export type HistorySession = {
  id: string
  mode: StudySession['mode']
  practice_style: StudySession['practice_style']
  status: StudySession['status']
  started_at: string | null
  completed_at: string | null
  total_items: number
  answered: number
  correct: number
  accuracy: number | null
  elapsed_minutes: number
  review_repeats: number
  reviewable: boolean
}

export type HistoryFacets = {
  question_types: Array<{ question_type: string; section: Question['section']; attempts: number; correct: number }>
  sections: string[]
  attempts: number
  correct: number
  incorrect: number
  first_attempt_at: string | null
  last_attempt_at: string | null
}

export type SessionReview = {
  session: StudySession
  summary: PracticeSummary
  /** Present on both halves of a diagnostic pair: the timed form and its untimed retry. */
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
