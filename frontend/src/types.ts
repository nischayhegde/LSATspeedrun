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

export type SessionItem = {
  id: string
  position: number
  requires_reasoning: boolean
  served_at: string
  story: StoryFrame
  question: Question
}

export type StudySession = {
  id: string
  mode: 'diagnostic' | 'daily'
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
  section_accuracy: Record<string, number>
  weak_areas: SkillSummary[]
  message: string
}

export type DailySummary = {
  kind: 'daily'
  accuracy: number
  correct: number
  questions_completed: number
  elapsed_minutes: number
  xp_earned: number
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

export type AttemptResult = {
  attempt_id: string
  duplicate: boolean
  is_correct: boolean
  xp_earned: number
  pace_scored: boolean
  elapsed_ms: number
  session_complete: boolean
  session_id: string
  feedback: {
    is_correct: boolean
    selected_label: string
    correct_label: string
    headline: string
    diagnosis: string
    coaching: string
    first_error_code?: string | null
    narrative_outcome: string
    transition: string
  }
}

