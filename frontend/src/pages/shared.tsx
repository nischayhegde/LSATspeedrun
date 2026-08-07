import { type KeyboardEvent, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Clock3, ShieldAlert, Target, Trophy } from 'lucide-react'

import { api } from '../api'
import type { GameClient, GameResponse, GameState } from '../types'

/* The pieces more than one route needs. Everything else lives in the route
   module that owns it, so a route only ever downloads its own screen. */

export function useGame() {
  return useQuery({ queryKey: ['game'], queryFn: api.game })
}


export function storeGame(queryClient: ReturnType<typeof useQueryClient>, game: GameState) {
  queryClient.setQueryData<GameResponse>(['game'], (current) => ({ game, pending_reviews: current?.pending_reviews ?? [] }))
}


export function storeAuthenticatedUser(queryClient: ReturnType<typeof useQueryClient>, data: Awaited<ReturnType<typeof api.me>>) {
  queryClient.clear()
  queryClient.setQueryData(['me'], data)
}


export function effectiveClient(game: GameState): GameClient {
  return game.catalog.clients.find((client) => client.key === game.active_client.effective_key) ?? game.active_client
}


export function PanelFallback({ label }: { label: string }) {
  return <div className="progress-panel-fallback" role="status">{label}</div>
}


/**
 * One tab strip, shared by the Dashboard and the Practice tab.
 *
 * Both pages had grown into a single column that had to be scrolled end to
 * end to find anything, so both now sort their readings behind the same
 * control. It is the same construction the Firm page already uses: a real
 * tablist with roving tabindex, arrow/Home/End navigation, and focus that
 * follows the selection, so the keyboard reaches every panel the pointer can.
 */
export function TabStrip<Key extends string>({
  id,
  className,
  label,
  tabs,
  active,
  onSelect,
}: {
  id: string
  className: string
  label: string
  tabs: ReadonlyArray<{ key: Key; label: string }>
  active: Key
  onSelect: (key: Key) => void
}) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, current: Key) => {
    const index = tabs.findIndex((tab) => tab.key === current)
    let target: number | null = null
    if (event.key === 'ArrowRight') target = (index + 1) % tabs.length
    if (event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length
    if (event.key === 'Home') target = 0
    if (event.key === 'End') target = tabs.length - 1
    if (target === null) return
    event.preventDefault()
    const key = tabs[target].key
    onSelect(key)
    window.requestAnimationFrame(() => document.getElementById(`${id}-tab-${key}`)?.focus())
  }
  return (
    <div className={className} role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          id={`${id}-tab-${tab.key}`}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          aria-controls={`${id}-panel-${tab.key}`}
          tabIndex={active === tab.key ? 0 : -1}
          className={active === tab.key ? 'active' : ''}
          onKeyDown={(event) => move(event, tab.key)}
          onClick={() => onSelect(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}


/**
 * Only the open tab's contents are mounted — that is what keeps each panel's
 * chunk off the first load — so every other tab's `aria-controls` would point
 * at nothing. These empty hidden panels are what it points at instead.
 */
export function InertTabPanels<Key extends string>({
  id,
  tabs,
  active,
}: {
  id: string
  tabs: ReadonlyArray<{ key: Key; label: string }>
  active: Key
}) {
  return (
    <>
      {tabs.filter((tab) => tab.key !== active).map((tab) => (
        <div key={tab.key} id={`${id}-panel-${tab.key}`} role="tabpanel" aria-labelledby={`${id}-tab-${tab.key}`} hidden />
      ))}
    </>
  )
}


export function MegaLitigationGate({
  questions,
  minutes,
  pending,
  onConfirm,
  onCancel,
}: {
  questions: number
  minutes: number
  pending: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  // Escape backs out. The scrim itself is inert: a click-to-dismiss div is not
  // reachable by keyboard, and this gate is the one screen that must be read.
  useEffect(() => {
    const dismiss = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', dismiss)
    return () => window.removeEventListener('keydown', dismiss)
  }, [onCancel])

  return (
    <div className="mega-gate-scrim" role="dialog" aria-modal="true" aria-labelledby="mega-gate-title">
      <section className="mega-gate">
        <span>MEGA-LITIGATION</span>
        <h2 id="mega-gate-title">This is basically a full practice LSAT.</h2>
        <p>
          {questions} questions across three blocks, sat the way the real test is sat. Start it only when you have the
          whole {minutes} minutes free.
        </p>
        <ul>
          <li>
            <Clock3 size={17} />
            <div><strong>One clock for the whole form — about {minutes} minutes.</strong><span>Spend it however you like across the {questions} questions. It does not stop between them.</span></div>
          </li>
          <li>
            <ShieldAlert size={17} />
            <div><strong>One sitting. There is no pause and no save.</strong><span>The clock keeps running if you close the tab, and whatever is unanswered when it hits zero is submitted blank.</span></div>
          </li>
          <li>
            <Trophy size={17} />
            <div><strong>Above 70% and your firm moves up a tier.</strong><span>Every prerequisite upgrade for that tier is unlocked with it, at no cost.</span></div>
          </li>
          <li>
            <Target size={17} />
            <div><strong>Nothing here pays, prompts, or coaches you.</strong><span>That is what makes it the honest read — and what it finds is what your case runs practice next.</span></div>
          </li>
        </ul>
        <div className="mega-gate-actions">
          <button type="button" className="mega-gate-cancel" onClick={onCancel}>Not right now</button>
          <button type="button" className="primary-button" onClick={onConfirm} disabled={pending}>
            {pending ? 'Filing…' : "I have the time — start"} <ArrowRight />
          </button>
        </div>
      </section>
    </div>
  )
}
