import { useEffect, useRef, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../api'
import { formatMoney } from '../format'
import { useLiveAccrual } from '../motion'
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
 * Every card leads with whether the item is earning *right now*, because that is
 * the question a player hovering an object is actually asking and it is not
 * answerable from a rate alone: a passive earner stops the moment the safe hits
 * its ceiling, a casework item has never earned anything by itself, and decor
 * never will. The status is stated in words on every card rather than implied by
 * whether a number happens to be moving.
 *
 * The ticking comes from the shared `useLiveAccrual`, the same hook the economy
 * ledger uses, so there is exactly one thing in the app that turns a confirmed
 * rate and a settlement timestamp into a live figure. This card asks it for
 * cents on a shorter tick (see `AccrualWatch`); nothing else about it differs.
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

  const item = target?.item ?? null

  // The one clock in this card, and it only runs while a passive card is open:
  // a null rate makes `useLiveAccrual` a no-op, and there is nothing to animate
  // when nothing is hovered. A permanently ticking element over a WebGL canvas
  // is exactly the sort of thing that has cost this app frames before.
  //
  // Focus Mode passes null too. The card is not rendered there, so this would
  // only be a timer nobody can see; the accrual itself is server-side and keeps
  // running regardless of what this page does or does not tick.
  const live = useLiveAccrual(
    !focusMode && item?.mode === 'passive' && state
      ? {
        hourlyRate: item.hourly,
        capHours: state.passive_income.cap_hours,
        sinceIso: state.passive_income.last_collected_at,
      }
      : null,
    // 120ms and cents, rather than the ledger's whole dollars every 600ms. An
    // item's own rate is a fraction of the firm's, so at the rates most items
    // charge a whole-dollar counter would sit still long enough to read as
    // broken. See `showsCents` for where that threshold comes from.
    { tickMs: 120, precision: 2 },
  )

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
              live={live}
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
        <DistrictsOpened item={item} />
      </div>
    </div>
  )
}

/**
 * Whether the item is putting money in the safe at this moment, said plainly.
 *
 * The dot is the same shape on every card and only animates when something is
 * genuinely accumulating, so "is this earning" is answerable at a glance and
 * without reading the number underneath it.
 */
function LiveState({ state, children }: { state: 'live' | 'paused' | 'pending' | 'idle'; children: ReactNode }) {
  return (
    <p className={`office-readout-state is-${state}`}>
      <span className="office-readout-dot" aria-hidden="true" />
      {children}
    </p>
  )
}

function PassiveBody({
  item,
  passive,
  live,
  reduced,
  pinned,
  onCollect,
  collecting,
  collectError,
}: {
  item: OfficeItemEconomics
  passive: PassiveSnapshot
  /** Dollars and cents this item has accrued, from the shared clock. 0 when
   *  the reader asked for reduced motion, which is why the figure below falls
   *  back to the settled reading rather than trusting this on its own. */
  live: number
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
  // Renders are driven by the accrual clock above, so reading it here reads it
  // at the tick. The settled figure is the floor rather than a second opinion:
  // under reduced motion the clock is deliberately silent and returns 0, and a
  // card that then showed $0 in the safe would be wrong, not merely still.
  const accrual = passiveAccrual(item.hourly, passive, Date.now())
  const exact = Math.max(live, accrual.stored)
  const whole = Math.floor(exact)
  const cents = Math.floor((exact - whole) * 100)
  // Reduced motion drops the cents rather than the figure: the number stays
  // truthful and readable, it just stops moving several times a second.
  const withCents = showsCents(item.hourly) && !reduced && !accrual.full

  return (
    <>
      {/* The answer to "am I earning from this right now", above the number,
          because the number alone cannot distinguish a full safe from a fast
          one — both show a large figure and neither is moving much. */}
      {accrual.full
        ? <LiveState state="paused">Paused &mdash; safe is full</LiveState>
        : <LiveState state="live">Earning now, {formatMoney(item.hourly)} an hour</LiveState>}
      <div
        className={`office-readout-figure${accrual.full ? ' is-full' : ''}`}
        aria-label={`${formatMoney(accrual.stored)} earned by this item since your last collection`}
      >
        <span aria-hidden="true">{formatMoney(whole)}</span>
        {withCents && <small aria-hidden="true">.{String(cents).padStart(2, '0')}</small>}
      </div>
      <p className="office-readout-lede">in the safe from this item</p>
      {/* How far through the safe's capacity this accrual is. The counter says
          how much; this says how much room is left, which is the part that
          decides whether it is still worth anything to leave it running. */}
      <div
        className={`office-readout-fill${accrual.full ? ' is-full' : ''}`}
        style={{ ['--fill' as string]: `${Math.min(100, Math.round((accrual.storedHours / Math.max(passive.capHours, .0001)) * 100))}%` }}
        aria-hidden="true"
      />
      <dl>
        {/* The hourly rate is stated in the status line above rather than
            repeated here; what this adds is the size of it relative to
            everything else the player owns. */}
        {/* Labelled rather than described, because "31% of passive income" as
            a value wraps onto two lines on a phone and the label has room for
            the words. */}
        <div>
          <dt>Share of passive</dt>
          <dd>{accrual.share >= .005 ? `${Math.round(accrual.share * 100)}%` : '<1%'} of the firm</dd>
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
      {/* Same question, answered honestly: this one is not earning right now
          and will not until a case settles. */}
      <LiveState state="pending">Not earning now &mdash; pays when you win</LiveState>
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

/**
 * What a connection opened, which is the thing its crest is on the wall for.
 *
 * A network carries a small fee share — the local bar association is +2% — so
 * it classified as `casework` and the card described it as two percent of a
 * case fee and nothing else. That is true and it is the least of what the
 * purchase did: the network is the only reason a district's institutions will
 * sign the firm as standing counsel, and the crest already carries a wooden tab
 * per district that lights when one is signed. This says in words what those
 * tabs say in enamel, so the wall can be read from a chair as well as from
 * across the room.
 *
 * Rendered under every mode rather than as a fourth one, because a network is
 * genuinely both things at once and the modes describe how an item pays.
 */
function DistrictsOpened({ item }: { item: OfficeItemEconomics }) {
  if (!item.districts.length) return null
  const held = item.districts.filter((district) => district.held).length
  return (
    <div className="office-readout-districts">
      <p>
        Opens {item.districts.length === 1 ? 'one district' : `${item.districts.length} districts`}
        {held > 0 && <span> &middot; {held} signed</span>}
      </p>
      <ul>
        {item.districts.map((district) => (
          <li key={district.name} className={district.held ? 'is-held' : ''}>{district.name}</li>
        ))}
      </ul>
    </div>
  )
}

function ViewBody({ item }: { item: OfficeItemEconomics }) {
  return (
    <>
      <LiveState state="idle">Earns nothing, now or later</LiveState>
      {/* Decor earns nothing, and saying so plainly is the whole point of this
          mode. The game's own catalog comment is the right voice for it: it
          reads as a choice the player made, not as a feature that is missing. */}
      <p className="office-readout-lede is-view">Bought for the view.</p>
      <p className="office-readout-view-note">{item.benefit || 'Earns nothing, and never pretended to.'}</p>
    </>
  )
}
