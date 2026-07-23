export type CaseJourneyStageId = 'intake' | 'workspace' | 'counsel' | 'resolution' | 'growth'

export type CaseJourneyStage = {
  id: CaseJourneyStageId
  label: string
  room: string
  detail: string
  slug: string
}

// These rooms are the repeatable learning loop. Other scenes expand one of
// these jobs; they do not create a parallel story mode.
export const caseJourneyStages: CaseJourneyStage[] = [
  { id: 'intake', label: 'Choose', room: 'Docket', detail: 'Select a verified matter and understand the client brief.', slug: 'reception-docket' },
  { id: 'workspace', label: 'Reason', room: 'Workspace', detail: 'Read the evidence, answer, and state a defensible case theory.', slug: 'case-workspace' },
  { id: 'counsel', label: 'Repair', room: 'Mentor', detail: 'Inspect the first unsupported step and repair the method.', slug: 'mentor-conference' },
  { id: 'resolution', label: 'Settle', room: 'Resolution', detail: 'Review learning evidence before the economic reward.', slug: 'case-resolution' },
  { id: 'growth', label: 'Invest', room: 'Design Studio', detail: 'Turn earned fees into visible firm and workflow improvements.', slug: 'firm-shop' },
]

export function journeyStageForScene(slug: string): CaseJourneyStageId | null {
  return caseJourneyStages.find((stage) => stage.slug === slug)?.id ?? null
}
