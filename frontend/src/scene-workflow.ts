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
  { id: 'docket', label: 'Choose mode', room: 'Docket', detail: 'Choose rewarded work, Client Intake, or zero-reward Rapid Review.', slug: 'reception-docket' },
  { id: 'intake', label: 'Set terms', room: 'Client Intake', detail: 'Select the client contract for future files without changing active-case terms.', slug: 'client-intake' },
  { id: 'workspace', label: 'Reason', room: 'Workspace', detail: 'Read the evidence, answer, and state a defensible case theory.', slug: 'case-workspace' },
  { id: 'counsel', label: 'Repair', room: 'Mentor', detail: 'Inspect the first unsupported step and repair the method.', slug: 'mentor-conference' },
  { id: 'resolution', label: 'Settle', room: 'Resolution', detail: 'Review learning evidence before the economic reward.', slug: 'case-resolution' },
  { id: 'growth', label: 'Invest', room: 'Design Studio', detail: 'Turn earned fees into visible firm and workflow improvements.', slug: 'firm-shop' },
]

export function journeyStageForScene(slug: string): CaseJourneyStageId | null {
  return caseJourneyStages.find((stage) => stage.slug === slug)?.id ?? null
}
