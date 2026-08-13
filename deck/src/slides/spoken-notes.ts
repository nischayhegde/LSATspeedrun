/**
 * Slide notes contain two different documents in one string:
 * the words delivered aloud, followed by fact-checks, contingencies, and stage
 * directions introduced by `⟢`. Presenter-facing script views show only the
 * spoken portion so a defensive research note can never be mistaken for a line
 * to deliver.
 */
export function spokenNotes(notes?: string) {
  if (!notes) return 'No spoken script for this slide.'
  return notes.split(/\s+⟢/u, 1)[0].trim()
}
