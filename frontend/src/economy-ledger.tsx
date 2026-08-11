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
import { memo, useEffect, useRef } from 'react'

import { formatCountDelta, formatMoney, formatMoneyDelta } from './format'
import { useDelta, useLiveAccrual, useRollup, type AccrualRate } from './motion'
import type { GameState } from './types'

/** How long after the last scroll event the card comes back. */
const SETTLE_MS = 420

/** How long the card insists on being seen after one of its figures moves. */
const ANNOUNCE_MS = 3400

/**
 * Whether the card is currently lying on top of readable words.
 *
 * Sampled rather than walked: a handful of hit tests down the middle and along
 * the edges of the card's own rect finds a paragraph, a heading or a district
 * name under it, and costs nothing next to walking the document. Only ever run
 * when the page has stopped moving.
 *
 * "Readable" means an element with its own non-empty text — a container that
 * merely encloses text is not something the card is covering, or every fixed
 * panel would report itself as covering `<main>`.
 */
function hasOwnText(node: Element) {
  return Array.from(node.childNodes).some(
    (child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim().length > 1,
  )
}

function coveringText(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return false
  const xs = [rect.left + 6, rect.left + rect.width * .35, rect.left + rect.width * .65, rect.right - 6]
  const ys = [rect.top + 6, rect.top + rect.height * .35, rect.top + rect.height * .65, rect.bottom - 6]

  /* Two passes, because a hit test lands on a box and text is not a box.
     Sampling alone reported "nothing underneath" while the card lay across
     "+0.36 standing · 1.8% of the lease": the points between two inline spans
     hit the paragraph that contains them, which has no text of its own.
     So a hit on a container is treated as a candidate and its own leaves are
     checked against the card's rect — bounded to that container's subtree, so
     it is a handful of nodes rather than a document walk. */
  const candidates = new Set<Element>()
  for (const x of xs) {
    for (const y of ys) {
      for (const node of document.elementsFromPoint(x, y)) {
        if (element.contains(node)) continue
        if (node === document.body || node === document.documentElement) break
        if (hasOwnText(node)) return true
        candidates.add(node)
        break
      }
    }
  }

  for (const candidate of candidates) {
    for (const leaf of candidate.querySelectorAll('*')) {
      if (!hasOwnText(leaf)) continue
      const box = leaf.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      if (box.right > rect.left && box.left < rect.right && box.bottom > rect.top && box.top < rect.bottom) return true
    }
  }
  return false
}

/**
 * Gets the card out of the way of the thing it is sitting on.
 *
 * A fixed panel on a scrolling document is always over *something* — the note
 * on `.economy-ledger` in styles.css says as much, and click-through was the
 * answer to half of it. The other half is reading. Measured across nine routes
 * at twenty-five widths (`tools/ui-qa/viewport-sweep.mjs`), this card was lying
 * across page text in 472 of the 225 route/width pairs' findings, and at 1024
 * on the Dashboard it covered half of the words "Accuracy by question type".
 *
 * The first attempt hid it while the page was scrolling and while a pointer was
 * near it. Both were half-measures pointing at the wrong rule, and measuring
 * what is actually underneath the card at rest is what showed it: at 1024 on
 * the Dashboard it covers 35% of its own area with the heading "Accuracy by
 * question type"; at 1180 on Practice, 69% of it is over "Mega-litigation · 75
 * questions, 105 minutes, one sitting"; at 390 it lies across three tab labels.
 * The card is over real words on nearly every route at nearly every width, so
 * "hide while the reader is busy" was never going to be enough — and hiding on
 * hover made the card impossible to consult on purpose, since reaching for it
 * was the gesture that sent it away.
 *
 * So the rule is stated the other way round. The card is out of the way by
 * default and comes back when it is wanted:
 *
 * - **Hidden** while the page is scrolling, and whenever it has come to rest on
 *   top of text.
 * - **Shown** when there is nothing under it, when a fine pointer is in its
 *   corner (reaching for the card now produces the card), and for
 *   `ANNOUNCE_MS` after any of its four figures moves — which is the one moment
 *   it has something to say, and the reason it is fixed rather than per-page.
 *
 * That is the rule for the **desktop card**, which is a small pane floating in
 * the bottom-left corner over whatever the page has put there.
 *
 * A phone is not that. Below 900px the card becomes a full-width strip resting
 * one gap above the navigation dock, and `--mobile-dock-clearance` reserves the
 * lane for it at the end of every page — so it is chrome, in the same sense the
 * dock beneath it is chrome, and content passing under it while you scroll is
 * that lane working rather than a collision. It also has no pointer to reach
 * with, so "hidden until wanted" has no gesture that wants it.
 *
 * Measured before changing it: at 390 the strip was yielded at rest on every
 * route, and the claim that the figures were "a scroll away" at the end of the
 * page was true on Dashboard, true on Firm if you are willing to scroll 19,606
 * pixels, and false on Practice. So the live ledger did not reach a phone.
 *
 * On a coarse pointer the strip therefore keeps only the first half of the
 * rule — away while the page is moving, back when it stops — which is what it
 * did before the covering test existed, and what the dock's own reserved lane
 * makes correct there.
 *
 * Everything here writes a `data-` attribute straight onto the node rather than
 * going through state: this component is mounted for the whole session, and a
 * re-render of it per scroll frame is exactly the cost the file's third rule
 * exists to avoid. The animation is transform and opacity only.
 */
function useYieldWhileReading(node: React.RefObject<HTMLElement | null>, figures: string, hidden: boolean) {
  /** Set by the effect below, called by the announce effect further down. */
  const announce = useRef<(() => void) | null>(null)

  /* `hidden` is in the dependency list because Focus Mode returns null before
     the card is rendered at all. Without it, a player who had Focus Mode on
     when the shell mounted got a ref of null here, the effect never ran again,
     and turning Focus Mode back off produced a ledger with none of this
     behaviour attached for the rest of the session. */
  useEffect(() => {
    const element = node.current
    if (!element || hidden) return

    let settle = 0
    let frame = 0
    let announcing = 0
    let scrolling = false
    let pointerOver = false
    let covering = false

    /* Read once, here rather than at module scope, so a browser resized across
       the breakpoint or a device that changes pointer picks up the other rule
       on the next mount. */
    const finePointer = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false

    const apply = () => {
      // See the note above the hook: on a coarse pointer the card is a docked
      // strip with a reserved lane, so covering text while the page moves past
      // it is not a reason to hide, and there is no pointer to bring it back.
      const away = scrolling || (finePointer && covering && !pointerOver)
      if (away) element.setAttribute('data-yield', 'true')
      else element.removeAttribute('data-yield')
    }

    /* Where the card sits when it is not yielding. `getBoundingClientRect`
       carries the yield's translate, so asking it where the card is while the
       card is off the edge of the screen answers "off the edge of the screen",
       and the pointer could never be found inside it. `offsetLeft`/`offsetTop`
       on a fixed element are measured against the viewport and ignore
       transforms, which is exactly the resting box wanted here. */
    const restingRect = () => ({
      left: element.offsetLeft,
      top: element.offsetTop,
      right: element.offsetLeft + element.offsetWidth,
      bottom: element.offsetTop + element.offsetHeight,
    })

    /* Measured with the card put back first. `coveringText` hit-tests the
       card's own rect, and while it is translated off the edge that rect is
       over the margin rather than over the page — so asking the question
       without restoring it always answers "nothing there", and the card would
       return, cover a paragraph, and only discover it on the next scroll. */
    const remeasure = () => {
      // Nothing consumes `covering` on a coarse pointer, and the hit-test is
      // sixteen `elementsFromPoint` calls plus a subtree walk — not something
      // to run on a phone for an answer nothing reads.
      if (!finePointer) { apply(); return }
      const wasYielding = element.hasAttribute('data-yield')
      const previous = element.style.transition
      if (wasYielding) {
        element.style.transition = 'none'
        element.removeAttribute('data-yield')
      }
      covering = coveringText(element)
      if (wasYielding) {
        apply()
        void element.offsetWidth
        element.style.transition = previous
      } else {
        apply()
      }
    }

    announce.current = () => {
      covering = false
      apply()
      window.clearTimeout(announcing)
      announcing = window.setTimeout(remeasure, ANNOUNCE_MS)
    }

    const onScroll = () => {
      scrolling = true
      apply()
      window.clearTimeout(settle)
      settle = window.setTimeout(() => { scrolling = false; remeasure() }, SETTLE_MS)
    }

    const onPointerMove = (event: PointerEvent) => {
      if (frame) return
      const { clientX, clientY } = event
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const rect = restingRect()
        // A margin, so the card is already back by the time the cursor arrives
        // rather than appearing under the cursor once it lands.
        const inside = clientX >= rect.left - 28 && clientX <= rect.right + 28
          && clientY >= rect.top - 28 && clientY <= rect.bottom + 28
        if (inside === pointerOver) return
        pointerOver = inside
        apply()
      })
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', remeasure)
    if (finePointer) window.addEventListener('pointermove', onPointerMove, { passive: true })
    // The first read waits a beat for the route below to finish arriving;
    // asking a skeleton what text it has under it answers about the skeleton.
    const settleIn = window.setTimeout(remeasure, 700)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', remeasure)
      window.removeEventListener('pointermove', onPointerMove)
      window.clearTimeout(settle)
      window.clearTimeout(settleIn)
      window.clearTimeout(announcing)
      announce.current = null
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [node, hidden])

  /* Movement outranks reading. Skips the first run: mounting is not an event,
     and a card that announced itself on arrival would be covering the first
     paragraph of every route for three and a half seconds. */
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    announce.current?.()
  }, [figures])
}

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
  const card = useRef<HTMLElement>(null)
  useYieldWhileReading(
    card,
    `${game.cash}:${game.firm_valuation}:${game.reputation}:${game.upkeep.daily_rent}:${game.upkeep.completed}`,
    Boolean(hidden),
  )
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
    <aside className="economy-ledger" aria-label="Firm economy" ref={card}>
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
