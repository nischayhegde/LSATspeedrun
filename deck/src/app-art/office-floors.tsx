import { useMemo } from 'react'
import type { GameAsset } from './types'
import {
  OFFICE_FLOORS,
  OFFICE_HIRE_ORDER,
  officeFloorForStaff,
  officeStaffStationFor,
  type OfficeFloorKey,
} from './office-manifest'

/** The people on each floor, in hire order, from what the firm actually owns. */
export function useFloorRoster(assets: GameAsset[]) {
  return useMemo(() => {
    const roster = new Map<OfficeFloorKey, GameAsset[]>(OFFICE_FLOORS.map((floor) => [floor.key, []]))
    // The same DEV overrides the scene honours, so a harness that asks for a
    // full firm gets a directory that agrees with the room it is looking at,
    // and the floor switch can be measured by clicking the thing a player
    // clicks. Compiled out of production builds.
    const hired = (() => {
      if (!import.meta.env.DEV) return assets
      const query = new URLSearchParams(window.location.search)
      const override = query.get('officeStaff')?.split(',').filter(Boolean)
        ?? (query.get('officeAll') === '1' ? [...OFFICE_HIRE_ORDER] : null)
      if (!override?.length) return assets
      return override.map((key, index) => (
        { key, type: 'staff', level: 1, name: key, quantity: 1, id: -2000 - index, owned: true } as unknown as GameAsset
      ))
    })()
    hired
      .filter((asset) => asset.owned && asset.type === 'staff' && officeStaffStationFor(asset.key))
      .forEach((asset) => roster.get(officeFloorForStaff(asset.key))?.push(asset))
    return roster
  }, [assets])
}

/**
 * The building directory.
 *
 * The firm occupies two floors and only one of them is ever built, so this is
 * the only way to see the other half of the staff you have paid for — which
 * makes it a piece of the building rather than a view control. It is drawn as
 * the brass plate beside a lift: a storey number in a roundel, the floor's
 * name, and who is up there, so choosing a floor is an informed choice rather
 * than a guess about what is behind door two.
 *
 * It hides itself entirely while the firm is one floor deep. A button that
 * leads to an empty room is worse than no button.
 */
export function OfficeFloorDirectory({
  current,
  onSelect,
  roster,
}: {
  current: OfficeFloorKey
  onSelect: (floor: OfficeFloorKey) => void
  roster: Map<OfficeFloorKey, GameAsset[]>
}) {
  const upstairs = OFFICE_FLOORS.filter((floor) => floor.key !== OFFICE_FLOORS[0].key)
  const anyUpstairs = upstairs.some((floor) => (roster.get(floor.key)?.length ?? 0) > 0)
  if (!anyUpstairs) return null

  return (
    <nav className="office-floors" aria-label="Office floors">
      <p className="office-floors-plate">Directory</p>
      <ul className="office-floors-list">
        {[...OFFICE_FLOORS].reverse().map((floor) => {
          const people = roster.get(floor.key) ?? []
          const active = floor.key === current
          return (
            <li key={floor.key}>
              <button
                type="button"
                className={`office-floor-button${active ? ' is-current' : ''}`}
                aria-current={active ? 'true' : undefined}
                onClick={() => { if (!active) onSelect(floor.key) }}
              >
                <span className="office-floor-storey" aria-hidden="true">{floor.ordinal}</span>
                <span className="office-floor-text">
                  <span className="office-floor-name">{floor.name}</span>
                  <span className="office-floor-blurb">{floor.blurb}</span>
                </span>
                <span className="office-floor-count">
                  <span className="office-floor-count-number">{people.length}</span>
                  <span className="office-floor-count-label">seated</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
