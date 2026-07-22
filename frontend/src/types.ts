export type User = {
  id: string
  email: string
  display_name: string
  avatar_url?: string | null
  next_route: string
}

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
  served_at: string
  elapsed_ms: number
  timer_active: boolean
  draft: {
    selected_label?: string | null
    reasoning: string
    updated_at?: string | null
  }
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
