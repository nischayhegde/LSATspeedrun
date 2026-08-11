import { hashUnit } from './map-urban-plan'

/**
 * The small irregularities that make the office read as worked in.
 *
 * The floor plan is authored on a grid — departments on measured coordinates,
 * seats at an exact pitch, props at the same offset on every desk — and a grid
 * is what it looked like: correct, and plainly placed. Real rooms are not
 * placed. Somebody drags a chair out and does not push it back, a folio ends
 * up askew, a bench run is set down a few degrees off the wall it was measured
 * from and nobody ever squares it up.
 *
 * Two things this module exists to guarantee, because both are easy to lose.
 *
 * **It is seeded, not random.** Every displacement is a pure function of a
 * string key, so the same office is the same office on every load. `hashUnit`
 * is the helper the map generator already uses for exactly this, and it is
 * reused here rather than reinvented. A `Math.random()` in the build would
 * reshuffle a player's room every time they opened it, which is a worse
 * failure than a grid.
 *
 * **The magnitudes are bounded and the bounds are the design.** Every constant
 * below is small enough that the clearance it eats is a fraction of the
 * clearance that exists. The relevant clearances are worked out in the
 * comments on `OFFICE_ENTROPY`, and `__officeLayoutAudit` in `office-three`
 * measures the result rather than trusting the arithmetic: this office has a
 * history of characters clipping through furniture, and a chair inside a desk
 * is worse than a rigid grid.
 *
 * What deliberately gets no entropy: the architectural shell, anything hung on
 * a wall, and the continuous worktop a department shares. Offices are not
 * uniformly untidy — the building is straight, the pictures are level, and the
 * mess is in the movable things at desk height. Skewing the walls too would
 * read as a bug rather than as a room.
 */

/** FNV-1a over a string, as a uint32. The office's own hash convention. */
function entropyHash(value: string) {
  let hash = 2166136261
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return hash >>> 0
}

/**
 * A stable `[0, 1)` for a key and an independent stream.
 *
 * `hashUnit` is `fract(sin(seed * 12.9898 + 78.233) * 43758.5453)`, and a
 * uint32 seed pushes that sine's argument past 5e10, where a double has about
 * five digits left after the point and neighbouring seeds start landing on the
 * same value. The hash is folded into a few thousand before it is handed over
 * for that reason. `stream` picks an independent series off the same key, the
 * way `hashUnit(seed + 11)` does throughout the map generator.
 */
export function officeUnit(key: string, stream = 0) {
  return hashUnit((entropyHash(key) % 9973) + stream * 31.7)
}

/** The same, signed: `[-1, 1)`. */
export function officeSigned(key: string, stream = 0) {
  return officeUnit(key, stream) * 2 - 1
}

/**
 * How far each kind of thing is allowed to wander, and why that far.
 *
 * The clearances quoted are the authored ones, taken from the office plan and
 * the department builder, so the reasoning can be rechecked when the plan
 * changes rather than rediscovered.
 */
export const OFFICE_ENTROPY = {
  /**
   * Department bays. The two things that make a run of desks read as placed
   * are that every run is parallel and every run is on a round number, so both
   * are broken slightly. 0.05 rad is 2.9 degrees — visible as "not quite
   * square", well short of "askew". Bays are 1.5 to 3 metres apart at their
   * closest (casework at z -2 against technology at z -0.5), so 13 cm of
   * depth shift and 16 cm of lateral shift cannot bring two of them together.
   */
  bayYaw: .05,
  bayShift: .16,
  bayDepth: .13,
  /**
   * Seats. The chair and its occupant move together and the bench does not,
   * which is the whole point: an untucked chair is a chair that has left the
   * desk it belongs to.
   *
   * `seatSlide` runs along the bench. Neighbouring seats are one `seatPitch`
   * apart — 0.93 m at the tightest tier — and a chair is 0.70 m wide, so
   * there is about 0.23 m of air between two chairs. Two neighbours sliding
   * toward each other at 0.085 close 0.17 m of that and leave 0.06 m.
   *
   * `seatBackOff` pulls the chair away from the bench. It is small on purpose
   * and it is the one number here that is limited by animation rather than by
   * collision: a seated character's hands are authored onto a worktop whose
   * near edge is 0.34 m in front of them, and a body pulled a long way back
   * from that is typing on air.
   *
   * `seatYaw` turns the chair on the spot. This is where most of the untidy
   * read comes from and it costs almost nothing in clearance, because turning
   * a body about its own axis moves its hands by 0.28 * sin(0.11) ≈ 3 cm.
   */
  seatSlide: .085,
  seatBackOff: .05,
  seatYaw: .11,
  /**
   * The things on the desk: trays, folios, files, water glasses, paper. These
   * sit in clear space on a worktop and cannot reach anything, so they get the
   * largest angles in the room — 0.22 rad is 13 degrees, which is what a
   * folder looks like when it has been put down rather than filed.
   */
  propYaw: .22,
  propShift: .035,
  /**
   * Departmental signatures: shelved books, pinned notes. Leaning a spine is
   * the cheapest "somebody uses this" cue there is.
   */
  leanYaw: .09,
} as const

/**
 * The whole-bay displacement for one department, or nothing when entropy is
 * switched off.
 *
 * Returned as a triple rather than applied here because the caller has to fold
 * it into the seat arithmetic before the run is clamped inside the walls —
 * shifting a bay after it has been fitted to the room is how a run ends up
 * half inside the glazing.
 */
export function bayEntropy(seed: string, enabled: boolean) {
  if (!enabled) return { x: 0, z: 0, yaw: 0 }
  return {
    x: officeSigned(seed, 1) * OFFICE_ENTROPY.bayShift,
    z: officeSigned(seed, 2) * OFFICE_ENTROPY.bayDepth,
    yaw: officeSigned(seed, 3) * OFFICE_ENTROPY.bayYaw,
  }
}

/**
 * Where one person's chair actually ended up, in the bay's own frame.
 *
 * `back` is negative because a department faces along its own +z: away from
 * the bench is behind the sitter.
 */
export function seatEntropy(seed: string, enabled: boolean) {
  if (!enabled) return { slide: 0, back: 0, yaw: 0 }
  return {
    slide: officeSigned(seed, 4) * OFFICE_ENTROPY.seatSlide,
    back: -officeUnit(seed, 5) * OFFICE_ENTROPY.seatBackOff,
    yaw: officeSigned(seed, 6) * OFFICE_ENTROPY.seatYaw,
  }
}
