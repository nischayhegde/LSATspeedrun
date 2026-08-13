import { useEffect, useRef, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../api'
import { formatMoney } from '../format'
import { useLiveAccrual } from '../motion'
import { storeGame } from '../pages/shared'
import { useSound } from '../sound'
import {
  passiveAccrual,
  type OfficeItemEconomics,
  type PassiveSnapshot,
} from './office-earnings'
import './office-earnings.css'

/**
 * The per-item earnings readout for the 3D office.
 *
 * Hover is a chip: the dollar this item is putting in the safe, and a one-word
 * source. Tap pins a slightly wider card with the item name and, when the safe
 * is full, Collect. See `office-earnings.ts` for why the three modes exist.
 *
 * The card sits inside `.av-room`, so it clips with the scene. The live figure
 * comes from shared `useLiveAccrual` + `formatMoney`; `useRollup` is not used
 * because a 120ms accrual would trail a 420ms ease forever.
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
        {target.pinned && (
          <header>
            <strong>{item.name}</strong>
            <button type="button" className="office-readout-close" onClick={onDismiss} aria-label="Close earnings readout">×</button>
          </header>
        )}
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
            ? <CaseworkBody item={item} />
            : <ViewBody />}
        {target.pinned && <DistrictsOpened item={item} />}
      </div>
    </div>
  )
}

/**
 * The one-word source, with the same live/paused/pending/idle dot as before.
 *
 * The dot still only pulses when something is actually accumulating. The word
 * is the mode, not a sentence: Hourly, Full, Fees, View.
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
      {accrual.full
        ? <LiveState state="paused">Full</LiveState>
        : <LiveState state="live">Hourly</LiveState>}
      <div
        className={`office-readout-figure${accrual.full ? ' is-full' : ''}`}
        aria-label={`${formatMoney(accrual.stored)} from this item`}
      >
        <span aria-hidden="true">{formatMoney(whole)}</span>
        {withCents && <small aria-hidden="true">.{String(cents).padStart(2, '0')}</small>}
      </div>
      {accrual.full && pinned && (
        <>
          <button
            type="button"
            className="office-readout-collect"
            onClick={onCollect}
            disabled={collecting}
          >
            {collecting ? 'Collecting…' : 'Collect'}
          </button>
          {collectError && <p className="office-readout-collect-error">Couldn&rsquo;t collect — try again.</p>}
        </>
      )}
    </>
  )
}

function CaseworkBody({ item }: { item: OfficeItemEconomics }) {
  return (
    <>
      <LiveState state="pending">Fees</LiveState>
      <div className="office-readout-figure is-static">
        <span>+{Math.round(item.payoutMult * 100)}%</span>
      </div>
    </>
  )
}

/**
 * What a connection opened, which is the thing its crest is on the wall for.
 *
 * Only on the pinned card: hover is the dollar, not the district list.
 */
function DistrictsOpened({ item }: { item: OfficeItemEconomics }) {
  if (!item.districts.length) return null
  return (
    <div className="office-readout-districts">
      <ul>
        {item.districts.map((district) => (
          <li key={district.name} className={district.held ? 'is-held' : ''}>{district.name}</li>
        ))}
      </ul>
    </div>
  )
}

function ViewBody() {
  return (
    <>
      <LiveState state="idle">View</LiveState>
      <div className="office-readout-figure is-static">
        <span>$0</span>
      </div>
    </>
  )
}
