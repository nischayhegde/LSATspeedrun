/**
 * The economy ledger: a small fixed readout of the four figures that move on
 * their own — cash, firm value, reputation, and the daily lease.
 *
 * Why it is fixed rather than per-page: these figures change while you are
 * looking at something else. Buying an upgrade on the Firm screen takes cash
 * down and firm value up in the same request; winning a case pays a fee; the
 * lease re-rates when a retainer is signed on the map. A reading that only
 * exists on one screen cannot show any of that happening.
 *
 * Three rules this file exists to keep:
 *
 * 1. Only confirmed numbers move — including the one number here that visibly
 *    moves without a refetch. CASH and FIRM VALUE tick up between refetches
 *    while passive income is accruing, but what drives that tick is
 *    `passive_income.hourly_rate`: a rate the server already confirmed, not a
 *    guess about the future. At any instant the figure shown is exactly what
 *    `cash + floor(hourlyRate * min(elapsedHours, capHours))` computes from
 *    the server's own `last_collected_at` and `cap_hours` — the same formula
 *    `_passive_state` runs on the backend — so it is arithmetic on confirmed
 *    inputs, not a prediction that might not come true. See `useLiveAccrual`
 *    in `motion.ts`. A refetch still supplies every input (`cash` itself, the
 *    rate, the cap, the timestamp), so nothing here is ever the source of
 *    truth: if the rate goes stale, the accrual comes back capped, or a real
 *    cost fires and cash actually drops, the next tick or refetch corrects it
 *    — gently through the existing roll if the drop is small, immediately if
 *    it is not. Reputation and the daily lease stay exactly as they were:
 *    only a refetch moves them, because they change in discrete steps, not
 *    against the wall clock.
 *
 * 2. The delta states the movement, not a motive. The game state carries no
 *    record of *why* a figure moved, and several causes share a direction — a
 *    fee and a daily claim both raise cash. So the badge reports size and
 *    direction only. Cash falling reads as a subtraction because it is drawn
 *    as one, not because the card guessed it was a purchase.
 *
 * 3. It stays cheap. This is on screen permanently, so: no backdrop-filter, no
 *    blend modes, no filters, and nothing animated except `transform` and
 *    `opacity`. Each row owns its own animation state, so a rolling figure
 *    re-renders one row rather than the application shell.
 */
import { memo } from 'react'

import { formatCountDelta, formatMoney, formatMoneyDelta } from './format'
import { useDelta, useLiveAccrual, useRollup, type AccrualRate } from './motion'
import type { GameState } from './types'

/** Whether a rise in this figure is a good thing, which is what colours it. */
type Polarity = 'asset' | 'liability'

function EconomyReadingRow({ label, value, polarity, render, renderDelta, hint, accruing }: {
  label: string
  value: number
  polarity: Polarity
  render: (value: number) => string
  renderDelta: (delta: number) => string
  hint: string
  /**
   * Present only on CASH and FIRM VALUE: the currently-confirmed passive rate
   * to tick between refetches. Absent on REPUTATION and the lease, which move
   * only on a refetch — see rule 1 above.
   */
  accruing?: AccrualRate
}) {
  // The roll only ever chases the server-confirmed `value`; the live accrual
  // is added after, on every render, without going through the 420ms ease.
  // That keeps the two kinds of movement distinct: a real jump in `value`
  // (a case paid, an upgrade bought) still rolls smoothly, while the ticking
  // dollars from `useLiveAccrual` advance in plain whole-dollar steps every
  // ~600ms, which is cheap and already reads as smooth at reading distance.
  const rolled = useRollup(value)
  const accrued = useLiveAccrual(accruing)
  const delta = useDelta(value)
  const shown = (typeof rolled === 'number' ? rolled : value) + accrued
  // A liability going up is the bad direction, so the two are inverted against
  // each other rather than both painting "up" green.
  const good = polarity === 'asset' ? (delta ?? 0) > 0 : (delta ?? 0) < 0

  return (
    <div className="economy-reading" title={hint}>
      <small>{label}</small>
      <strong>{render(shown)}</strong>
      {/* The live region is the badge, never the figure. A rolling number
          changes sixty times a second, and announcing it would read every
          intermediate value aloud; the badge changes exactly once per event.
          It carries its own label so the announcement is "CASH −$332" rather
          than a bare number with nothing to attach it to. */}
      {delta !== null && (
        <b className={`economy-delta ${good ? 'is-good' : 'is-bad'}`} key={`${label}:${delta}`} role="status">
          <span className="economy-delta-context">{label} </span>{renderDelta(delta)}
        </b>
      )}
    </div>
  )
}

/**
 * `hidden` is the Focus Mode switch. It only stops this component rendering:
 * the `['game']` query, its refetches, and every mutation that moves these
 * figures live above it and are untouched, so the economy keeps running and
 * the card shows current values — not stale ones — whenever it comes back.
 */
export const EconomyLedger = memo(function EconomyLedger({ game, hidden }: {
  game: GameState
  hidden?: boolean
}) {
  if (hidden) return null
  // Cash and firm value share one accrual: firm value is cash plus a fixed
  // sum of past investment (`_valuation` on the backend), so whatever passive
  // income is currently adding to cash is adding exactly that much to firm
  // value too. Not present at all when there is no rate to accrue against —
  // `useLiveAccrual` already no-ops on that, but skipping it here means a firm
  // with no passive income never runs the interval in the first place.
  const accruing: AccrualRate | undefined = game.passive_income.hourly_rate > 0
    ? {
      hourlyRate: game.passive_income.hourly_rate,
      capHours: game.passive_income.cap_hours,
      sinceIso: game.passive_income.last_collected_at,
    }
    : undefined
  return (
    <aside className="economy-ledger" aria-label="Firm economy">
      <EconomyReadingRow
        label="CASH"
        value={game.cash}
        polarity="asset"
        // Never compact here: this is the one figure that visibly ticks
        // between refetches (see rule 1 above), and `formatMoney`'s compact
        // notation rounds to the nearest ~$100–$1K at this size — which would
        // make every whole-dollar step from `useLiveAccrual` invisible.
        render={(value) => formatMoney(value)}
        renderDelta={(delta) => formatMoneyDelta(delta)}
        hint="Cash on hand. Falls when you buy, rises when a case pays."
        accruing={accruing}
      />
      <EconomyReadingRow
        label="FIRM VALUE"
        value={game.firm_valuation}
        polarity="asset"
        // Same reasoning as CASH: this row accrues live off the same rate,
        // so it needs the same exact, uncompacted figure.
        render={(value) => formatMoney(value)}
        renderDelta={(delta) => formatMoneyDelta(delta)}
        hint="What the firm is worth, including everything you have bought."
        accruing={accruing}
      />
      <EconomyReadingRow
        label="REPUTATION"
        value={game.reputation}
        polarity="asset"
        render={(value) => Math.round(value).toLocaleString()}
        renderDelta={formatCountDelta}
        hint={`${game.reputation_band.name} counsel.`}
      />
      <EconomyReadingRow
        label={game.upkeep.completed ? 'LEASE' : 'DAILY LEASE'}
        value={game.upkeep.completed ? 0 : game.upkeep.daily_rent}
        polarity="liability"
        render={(value) => game.upkeep.completed ? 'Retired' : `${formatMoney(value, true)} / day`}
        renderDelta={(delta) => formatMoneyDelta(delta)}
        hint={game.upkeep.completed
          ? 'The final charter is closed; rent no longer accrues.'
          /* "Retainers" here meant districts, not clients -- a client retainer
             does nothing to rent. Named for the thing that actually reduces it. */
          : 'Charged against activity. District counsel seats reduce it.'}
      />
    </aside>
  )
})
