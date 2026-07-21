export type StoryProgress = {
  xp: number
  chapter: number
  cases_solved: number
  next_level_xp: number
}

export type User = {
  id: string
  email: string
  display_name: string
  avatar_url?: string | null
  target_minutes: number
  onboarding_complete: boolean
  diagnostic_complete: boolean
  next_route: string
  story: StoryProgress
}

export type Choice = { label: string; text: string }

export type Question = {
  id: string
  section: string
  question_type: string
  difficulty: number
  passage?: { id: string; text: string; type?: string | null } | null
  stimulus?: string | null
  stem: string
  choices: Choice[]
}

export type StoryFrame = {
  case_number: number
  title: string
  eyebrow: string
  location: string
  presenting_character: string
  brief: string
  dialogue: string
  correct_outcome: string
  incorrect_outcome: string
  transition: string
}

export type CoachingHint = {
  level: number
  focus: string
  hint: string
  strategy: string
  provider: string
  model: string
  reasoning_effort: string
  prompt_version: string
}

export type CoachingFeedback = {
  provider: string
  model: string
  reasoning_effort: string
  prompt_version: string
  explanation_grade?: number | null
  reasoning_verdict: 'strong' | 'mostly_correct' | 'partial' | 'misconception' | 'unsupported' | 'not_provided'
  reasoning_summary: string
  first_error?: {
    code: string
    description: string
    repair: string
  } | null
  answer_analysis: {
    correct_answer_explanation: string
    selected_answer_explanation: string
    choice_explanations: Array<{ label: string; is_correct: boolean; explanation: string }>
  }
  next_step_hint: string
  debrief: string
}

export type SessionItem = {
  id: string
  position: number
  requires_reasoning: boolean
  served_at: string
  story: StoryFrame
  hints: CoachingHint[]
  question: Question
}

export type StudySession = {
  id: string
  mode: 'diagnostic' | 'daily' | 'review' | 'boss'
  status: 'in_progress' | 'completed'
  target_minutes: number
  total_items: number
  current_index: number
  progress_percent: number
  started_at: string
  completed_at?: string | null
  current_item?: SessionItem | null
}

export type SkillSummary = {
  name: string
  attempts: number
  accuracy: number
  average_time_seconds: number
  explanation_accuracy?: number | null
  pace_unlocked?: boolean
}

export type DiagnosticResults = {
  kind: 'diagnostic'
  estimated_score: number
  confidence: string
  confidence_low: number
  confidence_high: number
  accuracy: number
  questions_completed: number
  explanation_accuracy?: number | null
  section_accuracy: Record<string, number>
  weak_areas: SkillSummary[]
  message: string
}

export type DailySummary = {
  kind: 'daily' | 'review' | 'boss'
  accuracy: number
  correct: number
  questions_completed: number
  elapsed_minutes: number
  xp_earned: number
  boss_reward_xp?: number
  capm?: number | null
  pace_unlocked: boolean
  pace_message: string
  skills: SkillSummary[]
  ghost?: {
    baseline: string
    capm: number
    accuracy: number
    delta_percent: number
    message: string
  } | null
}

export type ArchiveCase = {
  attempt_id: string
  question_id: string
  title: string
  section: string
  question_type: string
  difficulty: number
  stem: string
  selected_label: string
  correct_label: string
  is_correct: boolean
  reasoning_provided: boolean
  explanation_score?: number | null
  elapsed_ms: number
  session_mode: StudySession['mode']
  attempted_at: string
}

export type ArchiveCaseDetail = {
  attempt: {
    id: string
    selected_label: string
    is_correct: boolean
    reasoning_text?: string | null
    explanation_score?: number | null
    elapsed_ms: number
    feedback?: AttemptResult['feedback'] | null
    coaching_status: AttemptResult['coaching_status']
    attempted_at: string
  }
  question: Question & { correct_answer: string }
  story: StoryFrame
  session: { id: string; mode: StudySession['mode'] }
  review?: { box: number; lapses: number; due_at: string } | null
}

export type ColdCases = {
  due_count: number
  total_cards: number
  next_due_at?: string | null
  cards: Array<{
    id: string
    question_id: string
    section: string
    question_type: string
    difficulty: number
    stem: string
    lapses: number
    box: number
    due_at: string
  }>
}

export type BossCaseStatus = {
  available: boolean
  chapter: number
  cases_until_boss: number
  active_session_id?: string | null
  reward_xp: number
  defeated: number[]
}

export type AttemptResult = {
  attempt_id: string
  duplicate: boolean
  is_correct: boolean
  xp_earned: number
  pace_scored: boolean
  elapsed_ms: number
  session_complete: boolean
  session_id: string
  coaching_status: 'pending' | 'processing' | 'completed' | 'failed'
  feedback: {
    is_correct: boolean
    selected_label: string
    correct_label: string
    headline: string
    diagnosis: string
    coaching_notice: string
    first_error_code?: string | null
    narrative_outcome: string
    transition: string
    coaching?: CoachingFeedback
  }
}
