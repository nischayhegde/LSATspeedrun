import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../api'
import { formatMoney } from '../format'
import { storeGame } from '../pages/shared'
import { useSound } from '../sound'
import {
  caseworkValue,
  formatHours,
  passiveAccrual,
  type OfficeItemEconomics,
  type PassiveSnapshot,
} from './office-earnings'
import './office-earnings.css'

/**
 * The per-item earnings readout for the 3D office.
 *
 * Three shapes, because the economy has three kinds of item and only one of them
 * earns by the hour. See `office-earnings.ts` for why that matters more than the
 * uniform ticking counter the Adventure Capitalist comparison implies.
 *
 * The card is positioned inside the room, so it inherits `.av-room`'s clipping
 * and travels with the scene rather than floating over the whole page.
 *
 * Money is formatted with the shared `formatMoney`. The shared `useRollup` and
 * `useDelta` from `motion.ts` are deliberately *not* used here, which is worth
 * stating because both look applicable:
 *
 *  - The passive figure is a live reading of a real accrual, recomputed from the
 *    server's collection timestamp. `useRollup` eases toward a target over
 *    420ms, so pointing it at a value that moves every 120ms would leave the
 *    displayed number permanently trailing the true one. The figure has to be
 *    the truth, not an approach to it.
 *  - The casework figure is static. Rolling it up from zero would look exactly
 *    like accumulation, which is the one thing a case multiplier does not do.
 *  - A delta badge would answer "why did this move", and per-item cash movement
 *    is not something the game state can attribute. The card only ever describes
 *    what one item contributes; it never claims to explain a change in cash.
 */

export type OfficeReadoutTarget = {
  item: OfficeItemEconomics
  /** Room-relative pixel anchor: where the item is on screen right now. */
  x: number
  y: number
  /** A tap opens a card that stays until dismissed; a hover follows the pointer. */
  pinned: boolean
}

type Props = {
  target: OfficeReadoutTarget | null
  onDismiss: () => void
}

/**
 * Whether to show cents, decided by how often the figure would otherwise move.
 *
 * A whole-dollar counter only advances every `3600 / hourly` seconds, so the
 * threshold has to be on the rate, not on how large the item feels. At $190 an
 * hour — a mid-tier earner, not a slow one — a dollar lands every nineteen
 * seconds, and a figure that sits still for nineteen seconds reads as broken
 * rather than as accumulating. $1800/hour is the rate at which whole dollars
 * arrive about every two seconds, which is frequent enough to read as movement
 * on its own.
 *
 * The cents are not decoration: the pool really does hold a fractional amount
 * between collections, and the server floors it only when it is collected. The
 * whole-dollar part shown here is that same floor.
 */
const showsCents = (hourly: number) => hourly > 0 && hourly < 1800

export function OfficeEarningsReadout({ target, onDismiss }: Props) {
  // Focus Mode hides this on every surface. `/office` already sits inside
  // `FocusModeGate`, but the same scene is also rendered on the login and
  // onboarding screens, which are not gated, so the guarantee is made here as
  // well rather than left to depend on which route mounted the office.
  //
  // This gates *rendering only*. Passive income accrues from a server-side
  // timestamp and does not consult anything on this page, so nothing about the
  // economy changes when the readout is hidden.
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  const focusMode = me.data?.user.assistance_level === 'focus'

  // The readout reads its own economy state rather than having it threaded down
  // through the scene's props, because the office page that mounts the scene is
  // owned elsewhere and this keeps the feature to files it owns. The query is
  // already in cache by the time the office renders, so this costs no request.
  const game = useQuery({ queryKey: ['game'], queryFn: api.game })
  const state = game.data?.game

  // Collecting is the only mutation this file owns. It writes the fresh `game`
  // straight into the `['game']` cache — the same pattern `firm-page.tsx` uses
  // for purchases — rather than invalidating and waiting on a refetch, so the
  // safe empties the instant the server confirms it. Because the response
  // carries a new `last_collected_at`, every reader of that field updates with
  // it: this card's own `passive` snapshot above, and `economy-ledger.tsx`'s
  // `useLiveAccrual` (via `motion.ts`), which recomputes its rolling figure
  // from whatever `sinceIso` it is handed next render. Neither is reached into
  // directly; both simply react to the cache write like they would a refetch.
  const queryClient = useQueryClient()
  const { play } = useSound()
  const collect = useMutation({
    mutationFn: api.collectPassive,
    onSuccess: ({ game: next, collected }) => {
      storeGame(queryClient, next)
      if (collected > 0) void play('collect', { seed: String(collected), intensity: .7 })
    },
  })
  const passive: PassiveSnapshot | null = state
    ? {
      hourlyRate: state.passive_income.hourly_rate,
      capHours: state.passive_income.cap_hours,
      lastCollectedAtMs: Date.parse(state.passive_income.last_collected_at),
    }
    : null
  const baseFee = state?.active_client.base_fee ?? 0
  const clientName = state?.active_client.name ?? 'this client'

  const reduced = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  ).current
  const [nowMs, setNowMs] = useState(() => Date.now())

  const item = target?.item ?? null
  const ticking = !focusMode && item?.mode === 'passive' && Boolean(passive)

  // The counter only runs while a passive card is open. A permanently animating
  // element over a WebGL canvas is exactly the sort of thing that has cost this
  // app frames before, and there is nothing to animate when nothing is hovered.
  useEffect(() => {
    if (!ticking || reduced) return
    setNowMs(Date.now())
    const timer = window.setInterval(() => setNowMs(Date.now()), 120)
    return () => window.clearInterval(timer)
  }, [ticking, reduced, item?.key])

  // Dismissal for the tapped card. Escape is the desktop habit; the scene
  // handles tap-elsewhere itself, since it owns the canvas pointer events.
  useEffect(() => {
    if (!target?.pinned) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onDismiss() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [target?.pinned, onDismiss])

  if (focusMode || !target || !item) return null

  const style = {
    ['--readout-x' as string]: `${target.x}px`,
    ['--readout-y' as string]: `${target.y}px`,
  }

  return (
    <div
      className={`office-readout mode-${item.mode}${target.pinned ? ' is-pinned' : ''}`}
      style={style}
      role="status"
      aria-live="off"
    >
      <div className="office-readout-card">
        <header>
          <strong>{item.name}</strong>
          {target.pinned && (
            <button type="button" className="office-readout-close" onClick={onDismiss} aria-label="Close earnings readout">×</button>
          )}
        </header>
        {item.mode === 'passive' && passive
          ? (
            <PassiveBody
              item={item}
              passive={passive}
              nowMs={nowMs}
              reduced={reduced}
              pinned={target.pinned}
              onCollect={() => collect.mutate()}
              collecting={collect.isPending}
              collectError={collect.isError}
            />
          )
          : item.mode === 'casework'
            ? <CaseworkBody item={item} baseFee={baseFee} clientName={clientName} />
            : <ViewBody item={item} />}
      </div>
    </div>
  )
}

function PassiveBody({
  item,
  passive,
  nowMs,
  reduced,
  pinned,
  onCollect,
  collecting,
  collectError,
}: {
  item: OfficeItemEconomics
  passive: PassiveSnapshot
  nowMs: number
  reduced: boolean
  /** Whether the card is tapped open rather than just hovered. The button
   *  below only appears pinned: an unpinned card has `pointer-events: none`
   *  (see `office-earnings.css`) so a mouse can travel through it to keep
   *  hovering the scene, and a control that cannot be reached should not be
   *  drawn as though it could. */
  pinned: boolean
  onCollect: () => void
  collecting: boolean
  collectError: boolean
}) {
  const accrual = passiveAccrual(item.hourly, passive, nowMs)
  const exact = item.hourly * accrual.storedHours
  const whole = Math.floor(exact)
  const cents = Math.floor((exact - whole) * 100)
  // Reduced motion drops the cents rather than the figure: the number stays
  // truthful and readable, it just stops moving several times a second.
  const withCents = showsCents(item.hourly) && !reduced && !accrual.full

  return (
    <>
      <div
        className={`office-readout-figure${accrual.full ? ' is-full' : ''}`}
        aria-label={`${formatMoney(accrual.stored)} earned by this item since your last collection`}
      >
        <span aria-hidden="true">{formatMoney(whole)}</span>
        {withCents && <small aria-hidden="true">.{String(cents).padStart(2, '0')}</small>}
      </div>
      <p className="office-readout-lede">in the safe from this item</p>
      <dl>
        <div>
          <dt>Earning</dt>
          <dd>{formatMoney(item.hourly)} / hour</dd>
        </div>
        <div>
          <dt>Share of firm</dt>
          <dd>{accrual.share >= .005 ? `${Math.round(accrual.share * 100)}%` : '<1%'} of passive income</dd>
        </div>
        {item.payoutMult > 0 && (
          <div>
            <dt>Also</dt>
            <dd>+{Math.round(item.payoutMult * 100)}% of every case fee</dd>
          </div>
        )}
      </dl>
      {/* The safe stops filling at its ceiling. A counter that just stopped
          would look broken, so the readout says what happened and what to do
          about it — and the ceiling itself moves with storage upgrades, so it
          is read from the server rather than assumed to be eight hours. */}
      {accrual.full
        ? (
          <>
            <p className="office-readout-cap is-full">Safe full at {formatHours(passive.capHours)} — collect it to start earning again</p>
            {pinned && (
              <button
                type="button"
                className="office-readout-collect"
                onClick={onCollect}
                disabled={collecting}
              >
                {collecting ? 'Collecting…' : 'Collect'}
              </button>
            )}
            {collectError && <p className="office-readout-collect-error">Couldn&rsquo;t collect — try again.</p>}
          </>
        )
        : <p className="office-readout-cap">Safe full in {formatHours(accrual.hoursToFull)}</p>}
    </>
  )
}

function CaseworkBody({ item, baseFee, clientName }: { item: OfficeItemEconomics; baseFee: number; clientName: string }) {
  const value = caseworkValue(item.payoutMult, baseFee)
  return (
    <>
      {/* No ticking figure here. This item is worth nothing until a case is won,
          so an accumulating counter would be a straightforward lie. */}
      <div className="office-readout-figure is-static">
        <span>+{Math.round(item.payoutMult * 100)}%</span>
      </div>
      <p className="office-readout-lede">of every case fee you earn</p>
      <dl>
        {baseFee > 0 && (
          <div>
            <dt>On this matter</dt>
            <dd>about {formatMoney(value)} of {clientName}&rsquo;s {formatMoney(baseFee)} base fee</dd>
          </div>
        )}
        <div>
          <dt>Paid</dt>
          <dd>when you win a case, not by the hour</dd>
        </div>
      </dl>
      <p className="office-readout-cap">Answer questions to collect it</p>
    </>
  )
}

function ViewBody({ item }: { item: OfficeItemEconomics }) {
  return (
    <>
      {/* Decor earns nothing, and saying so plainly is the whole point of this
          mode. The game's own catalog comment is the right voice for it: it
          reads as a choice the player made, not as a feature that is missing. */}
      <p className="office-readout-lede is-view">Bought for the view.</p>
      <p className="office-readout-view-note">{item.benefit || 'Earns nothing, and never pretended to.'}</p>
    </>
  )
}
