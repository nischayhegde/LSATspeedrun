// True when this document was opened as a live investor-deck embed.
export function isDeckFrameRequest(search: string): boolean {
  const params = new URLSearchParams(search)
  return params.has('deckDemo') || params.has('autoplay')
}
