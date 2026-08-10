/**
 * Deliberate stub of the app's per-item earnings readout.
 *
 * The real component (`frontend/src/art/office-earnings-readout.tsx`) is a
 * hover price card wired to the live game: it reads `../api`, `../format`,
 * `../sound` and `../pages/shared`, and it collects passive income by mutation.
 * None of that exists in the deck, and the deck does not want a floating price
 * card over the room on stage — the office is being shown as a place, not as a
 * shop. `office-three.tsx` still mounts it, so the port keeps the module's
 * shape and renders nothing.
 *
 * Keep the exported type identical to the app's. If the app's readout target
 * gains a field, mirror it here rather than diverging.
 */

import type { OfficeItemEconomics } from './office-earnings'

export type OfficeReadoutTarget = {
  item: OfficeItemEconomics
  x: number
  y: number
  pinned: boolean
}

export function OfficeEarningsReadout(_props: {
  target: OfficeReadoutTarget | null
  onDismiss: () => void
}) {
  return null
}
