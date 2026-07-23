export type CaseJourneyStageId = 'docket' | 'intake' | 'workspace' | 'counsel' | 'resolution' | 'growth'

export type CaseJourneyStage = {
  id: CaseJourneyStageId
  label: string
  room: string
  detail: string
  slug: string
}

// These rooms are the repeatable learning loop. Other scenes expand one of
// these jobs. Optional Special Matters add fiction without becoming a
// parallel progression path or replacing the instructional loop.
export const caseJourneyStages: CaseJourneyStage[] = [
  { id: 'docket', label: 'Choose work', room: 'Docket', detail: 'Choose rewarded work, Client Intake, or Rapid Review with no rewards.', slug: 'reception-docket' },
  { id: 'intake', label: 'Set terms', room: 'Client Intake', detail: 'Select the client for future cases. Open matters keep their original terms.', slug: 'client-intake' },
  { id: 'workspace', label: 'Reason', room: 'Workspace', detail: 'Read the record, choose an answer, and explain the reasoning.', slug: 'case-workspace' },
  { id: 'counsel', label: 'Review', room: 'Mentor', detail: 'Use the verified key to check the answer, then work with your coach on the reasoning.', slug: 'mentor-conference' },
  { id: 'resolution', label: 'Settle', room: 'Resolution', detail: 'Review the answer and coaching before the fee is settled.', slug: 'case-resolution' },
  { id: 'growth', label: 'Invest', room: 'Design Studio', detail: 'Use earned fees to improve the firm and its workspace.', slug: 'firm-shop' },
]

export function journeyStageForScene(slug: string): CaseJourneyStageId | null {
  return caseJourneyStages.find((stage) => stage.slug === slug)?.id ?? null
}
