/**
 * What one office item actually contributes to the firm.
 *
 * This module exists because the obvious version of this feature is a lie. The
 * request was for an Adventure Capitalist style readout — every item ticking up
 * its own dollar figure — and the economy does not work that way. Of the 107
 * purchasable items with a place in the office, 26 earn money by the hour, 67
 * only multiply the fee on a case the player has to win, and 14 are decor that
 * earns nothing whatsoever. Printing "$/hour" over the other 81 would look
 * exactly like the feature working while teaching the player an economy that
 * does not exist.
 *
 * So an item is classified by what it genuinely does, and each class gets a
 * readout that is true of it:
 *
 *   passive   a real dollars-per-hour rate, which really does accumulate
 *             against the wall clock. A ticking counter is honest here.
 *   casework  a share of the case-fee multiplier, worth exactly nothing until a
 *             case is won. Shown as a percentage and as a share of the matter's
 *             base fee. Never ticks.
 *   view      no economic effect at all. Says so, in the game's own voice.
 *
 * The two numbers behind this arrive as real fields on the asset payload rather
 * than being scraped out of the `benefit` display string. Both round-trip that
 * string exactly today, so parsing would have worked and then broken silently
 * the first time somebody reworded a benefit.
 */

export type OfficeItemMode = 'passive' | 'casework' | 'view'

/** The minimum an item has to tell us about itself to be classified. */
export type OfficeItemLike = {
  key: string
  name: string
  type: string
  benefit: string
  passive_hourly?: number
  payout_mult?: number
  /** Connections only: the districts this network lets the firm sign as
   *  standing counsel, and whether each is signed. Carried through because a
   *  network's fee share is the smaller half of what it bought — see
   *  `OfficeItemEconomics.districts`. */
  districts?: Array<{ key: string; name: string; held: boolean }>
}

export type OfficeItemEconomics = {
  key: string
  name: string
  benefit: string
  mode: OfficeItemMode
  /** Dollars per hour, always 0 outside `passive`. */
  hourly: number
  /** Fraction added to the firm's case-fee multiplier: `.04` is +4%. */
  payoutMult: number
  /**
   * The districts a connection opened, if this item is one.
   *
   * A network's fee share is real but small — the local bar association is
   * +2% — and it is not what the player bought the network for. What they
   * bought is which districts will sign the firm as standing counsel, and a
   * card that quotes only the 2% describes the least of it. Empty for
   * everything that is not a connection.
   */
  districts: Array<{ name: string; held: boolean }>
}

/**
 * An absent `passive_hourly` means "earns nothing by the hour", not "unknown" —
 * the server omits the field on every item that has no rate, so the absence is
 * the signal. Same for `payout_mult` on decor.
 */
export function officeItemEconomics(item: OfficeItemLike): OfficeItemEconomics {
  const hourly = Math.max(0, Math.floor(item.passive_hourly ?? 0))
  const payoutMult = Math.max(0, item.payout_mult ?? 0)
  const mode: OfficeItemMode = hourly > 0 ? 'passive' : payoutMult > 0 ? 'casework' : 'view'
  const districts = (item.districts ?? []).map((district) => ({ name: district.name, held: district.held }))
  return { key: item.key, name: item.name, benefit: item.benefit, mode, hourly, payoutMult, districts }
}

/**
 * One readout for a group of items that share a single object in the scene.
 *
 * Several purchases advance one installation — the partner desk grows with every
 * workstation upgrade — so a single mesh legitimately represents three or four
 * assets and there is no non-arbitrary way to pick one of them to quote.
 *
 * Summing is the honest answer rather than a convenience: `passive_hourly` and
 * `payout_mult` are both plain addends in the server's economy, so the total for
 * a group is exactly the group's contribution. Nothing is averaged or estimated.
 */
export function officeGroupEconomics(items: OfficeItemLike[]): OfficeItemEconomics | null {
  if (!items.length) return null
  const parts = items.map(officeItemEconomics)
  if (parts.length === 1) return parts[0]
  const hourly = parts.reduce((total, part) => total + part.hourly, 0)
  const payoutMult = parts.reduce((total, part) => total + part.payoutMult, 0)
  // The last item in the group is the most advanced stage of the installation,
  // which is the one a player recognises as "the thing that is there now".
  const lead = parts[parts.length - 1]
  return {
    key: lead.key,
    name: `${lead.name} +${parts.length - 1} more`,
    benefit: lead.benefit,
    mode: hourly > 0 ? 'passive' : payoutMult > 0 ? 'casework' : 'view',
    hourly,
    payoutMult,
    // Flattened rather than taken from the lead: only connections carry
    // districts and each has its own crest, so in practice this is one item's
    // list, but a shared object would legitimately open all of them.
    districts: parts.flatMap((part) => part.districts),
  }
}

/** The firm-wide passive state, exactly as the server reports it. */
export type PassiveSnapshot = {
  /** Every owned item's rate, summed. The denominator for an item's share. */
  hourlyRate: number
  /** Hours the safe holds before it stops filling. Storage upgrades raise it. */
  capHours: number
  lastCollectedAtMs: number
}

export type PassiveAccrual = {
  /** Dollars this one item has put in the safe since the last collection. */
  stored: number
  /** Hours of accumulation counted so far, capped. */
  storedHours: number
  /** True once the safe stopped filling, so a stalled counter reads as a prompt. */
  full: boolean
  /** Hours until the safe is full. 0 once it is. */
  hoursToFull: number
  /** This item's share of the firm's hourly rate, as a fraction. */
  share: number
}

/**
 * How much of the stored pool belongs to one item, at `nowMs`.
 *
 * This mirrors the server's `_passive_state` rather than inventing a second
 * model: elapsed hours since the last collection, clamped to the cap. Because
 * the firm's rate is a plain sum of item rates, an item's share of the pool is
 * its rate times the same elapsed hours — an exact decomposition, not an
 * estimate, which is the only reason a per-item figure can be shown at all.
 *
 * The cap is the part worth getting right. A counter that silently stops looks
 * broken, so `full` is surfaced and the readout turns into "collect it".
 */
export function passiveAccrual(
  hourly: number,
  snapshot: PassiveSnapshot,
  nowMs: number,
): PassiveAccrual {
  const elapsedHours = Math.max(0, (nowMs - snapshot.lastCollectedAtMs) / 3_600_000)
  const capHours = Math.max(0, snapshot.capHours)
  const storedHours = Math.min(elapsedHours, capHours)
  return {
    stored: Math.floor(hourly * storedHours),
    storedHours,
    full: elapsedHours >= capHours,
    hoursToFull: Math.max(0, capHours - elapsedHours),
    share: snapshot.hourlyRate > 0 ? hourly / snapshot.hourlyRate : 0,
  }
}

/**
 * What a case multiplier is worth on a specific matter, in dollars.
 *
 * Deliberately expressed against the *base fee* and nothing else. The settled
 * fee also runs through a score multiplier, the firm tier, the client's own
 * multiplier and several bonuses, and reproducing that chain here would be a
 * second copy of `settle_attempt` that drifts from the first. A share of the
 * base fee is arithmetic the player can check against the number the case
 * screen already shows them, so it is quoted as exactly that and labelled as
 * exactly that.
 */
export function caseworkValue(payoutMult: number, baseFee: number) {
  return Math.round(Math.max(0, baseFee) * Math.max(0, payoutMult))
}

/** Hours rendered the way a safe-filling countdown reads best. */
export function formatHours(hours: number) {
  if (hours >= 1) {
    const whole = Math.floor(hours)
    const minutes = Math.round((hours - whole) * 60)
    if (minutes === 0) return `${whole}h`
    return `${whole}h ${minutes}m`
  }
  const minutes = Math.floor(hours * 60)
  if (minutes >= 1) return `${minutes}m`
  return `${Math.max(0, Math.floor(hours * 3600))}s`
}
