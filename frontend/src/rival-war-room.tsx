/* The rival war room.
 *
 * "Destroy rival firms" was always two halves: a ladder of operations that
 * damage a competing firm's valuation, and the acquisition that absorbs it once
 * it is cheap enough. The operations half was built on the campaign caseboard
 * and the acquisition half in the firm catalog, and when the caseboard left the
 * primary navigation the two halves stopped being reachable from the same
 * place. What survived looked like a plain "Acquire X" buy button with an
 * unexplained discount attached to it.
 *
 * This component is the whole loop in one surface: pick a target, weaken it,
 * watch its price fall, take it. It renders in the firm tab and, in a compact
 * form, over the world map, so the same mechanic is driven from both.
 *
 * Operations are paid for in casework — validated case wins earned and not yet
 * committed. Cash, Intel and Influence all accumulate on their own given enough
 * time, so gating on them alone let the most aggressive part of the firm sim be
 * played without practising. Casework can only come from settling a real graded
 * attempt, which is the point: pressure on a rival is something you earn at the
 * desk.
 */

import { lazy, Suspense, useMemo, useState } from 'react'
import { Check, Crosshair, Gavel, Landmark, Lock, ShieldAlert, Sparkles, Target, Trophy } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
import { formatMoney } from './components'
import { rivalSiteArt } from './art/assets'
import { useSound } from './sound'
import type { GameAsset, GameResponse, GameState, RivalOperation, RivalTarget } from './types'
import './rival-war-room.css'

/* Kept local rather than imported from `pages`, which imports this module. */
function storeGame(queryClient: ReturnType<typeof useQueryClient>, game: GameState) {
  queryClient.setQueryData<GameResponse>(['game'], (current) => ({ game, pending_reviews: current?.pending_reviews ?? [] }))
}

/* Imported straight from the card renderer rather than through `game-art`,
   which re-exports the world map and would make this module part of a cycle
   the moment the map renders a war room of its own. */
const CatalogAssetRender = lazy(() => import('./art/catalog-asset-render').then((module) => ({ default: module.CatalogAssetRender })))

/** Mirrors the tier bands the world map divides its five regions into. */
const MAP_REGIONS: Array<{ key: string; name: string; range: [number, number] }> = [
  { key: 'city', name: 'Old Quarter', range: [0, 4] },
  { key: 'nation', name: 'The Circuit', range: [5, 6] },
  { key: 'ocean', name: 'Treaty Sea', range: [7, 9] },
  { key: 'continent', name: 'Sovereign Arc', range: [10, 11] },
  { key: 'orbit', name: 'Global Compact', range: [12, 14] },
]

export function mapRegionForTier(tier: number) {
  return MAP_REGIONS.find((region) => tier >= region.range[0] && tier <= region.range[1]) ?? MAP_REGIONS[0]
}

export type RivalStanding = 'held' | 'contested' | 'standing' | 'unreachable'

/**
 * The map and the firm tab have to agree about what a rival's territory looks
 * like, so both read standing from here rather than each deciding for itself.
 */
export function rivalStanding(asset: GameAsset): RivalStanding {
  if (asset.owned) return 'held'
  if ((asset.discount_bps ?? 0) > 0) return 'contested'
  return asset.available ? 'standing' : 'unreachable'
}

export const STANDING_COPY: Record<RivalStanding, { label: string; blurb: string }> = {
  held: { label: 'HELD', blurb: 'Absorbed into the firm.' },
  contested: { label: 'CONTESTED', blurb: 'Operations are already running against this firm.' },
  standing: { label: 'STANDING', blurb: 'Untouched, and charging full price.' },
  unreachable: { label: 'OUT OF REACH', blurb: 'Requirements are not met yet.' },
}

const CATEGORY_ICON = { clean: Gavel, gray: Target, sabotage: ShieldAlert } as const

const CATEGORY_COPY = {
  clean: 'On the record',
  gray: 'Hard-nosed',
  sabotage: 'Indefensible',
} as const

/** "Acquire Harrow & Finch" is the purchase. "Harrow & Finch" is the firm. */
export function rivalFirmName(asset: GameAsset) {
  return asset.name.replace(/^Acquire\s+/i, '')
}

function CaseworkMeter({ game }: { game: GameState }) {
  const casework = game.story.casework ?? 0
  // The cheapest operation costs two, so a bar scaled to ten reads as "roughly
  // how many moves do I have" rather than as an abstract percentage.
  const filled = Math.min(1, casework / 10)
  return (
    <div className={`wr-casework ${casework === 0 ? 'is-empty' : ''}`}>
      <span className="wr-kicker">CASEWORK ON HAND</span>
      <strong>{casework}</strong>
      <div className="wr-casework-bar" aria-hidden="true"><i style={{ width: `${filled * 100}%` }} /></div>
      <small>{casework === 0
        ? 'Win a case with a valid write-up to bank casework. Operations cannot be bought any other way.'
        : `${casework} validated win${casework === 1 ? '' : 's'} banked and uncommitted. Every operation spends some.`}</small>
    </div>
  )
}

function OperationCard({
  operation,
  disabled,
  onLaunch,
}: {
  operation: RivalOperation
  disabled: boolean
  onLaunch: () => void
}) {
  const Icon = CATEGORY_ICON[operation.category]
  const label = operation.completed
    ? 'Operation complete'
    : operation.missing.length > 0
      ? 'Locked'
      : !operation.available
        ? 'Discount capped'
        : operation.category === 'sabotage' ? 'Authorize sabotage' : 'Launch operation'
  return (
    <article className={`wr-operation wr-operation-${operation.category} ${operation.completed ? 'is-complete' : ''}`}>
      <header>
        <span><Icon size={13} />{CATEGORY_COPY[operation.category]}</span>
        <strong>−{operation.discount_bps / 100}%</strong>
      </header>
      <h4>{operation.name}</h4>
      <p>{operation.description}</p>
      <ul className="wr-operation-costs">
        {operation.casework ? <li className="wr-cost-casework"><Sparkles size={11} />{operation.casework} casework</li> : null}
        <li>{formatMoney(operation.cost)}</li>
        {operation.intel ? <li>{operation.intel} Intel</li> : null}
        {operation.influence ? <li>{operation.influence} Influence</li> : null}
        {operation.heat_surcharge_bps ? <li className="wr-cost-heat">+{operation.heat_surcharge_bps / 100}% heat surcharge</li> : null}
      </ul>
      {operation.missing.length > 0 && !operation.completed && <em className="wr-operation-missing">Needs {operation.missing.join(' · ')}</em>}
      <button type="button" disabled={disabled || operation.completed || !operation.available} onClick={onLaunch}>
        {operation.completed ? <><Check size={13} /> {label}</> : operation.missing.length > 0 ? <><Lock size={12} /> {label}</> : label}
      </button>
    </article>
  )
}

export function RivalWarRoom({
  game,
  compact = false,
  selectedKey,
  onSelect,
  onShowOnMap,
}: {
  game: GameState
  /** The map overlay drops the target strip and the long copy. */
  compact?: boolean
  /** Lets the map drive the selection from a click on the world. */
  selectedKey?: string | null
  onSelect?: (key: string) => void
  onShowOnMap?: (asset: GameAsset) => void
}) {
  const queryClient = useQueryClient()
  const { play } = useSound()
  const [localKey, setLocalKey] = useState<string | null>(null)

  const rivals = useMemo(
    () => game.catalog.assets.filter((asset) => asset.type === 'rival').sort((a, b) => a.tier - b.tier),
    [game.catalog.assets],
  )
  const targets = game.story.rival_targets

  const activeKey = selectedKey ?? localKey
  const target: RivalTarget | undefined =
    targets.find((item) => item.key === activeKey)
    // Default to the cheapest target the firm can actually move against, which
    // is almost always the one the player is working towards.
    ?? targets.find((item) => item.available)
    ?? targets[0]
  const targetAsset = rivals.find((asset) => asset.key === target?.key)

  const operation = useMutation({
    mutationFn: ({ rivalKey, operationKey }: { rivalKey: string; operationKey: string }) => api.rivalOperation(rivalKey, operationKey),
    onSuccess: ({ game: next }, { rivalKey, operationKey }) => {
      storeGame(queryClient, next)
      void play('story', {
        id: `operation:${next.id}:${rivalKey}:${operationKey}`,
        seed: `${rivalKey}:${operationKey}`,
        intensity: .76,
        profile: { officeTier: next.office_tier, alignment: next.story.alignment },
      })
    },
  })

  const acquire = useMutation({
    mutationFn: api.purchase,
    onSuccess: ({ game: next }, key) => {
      storeGame(queryClient, next)
      void play('promotion', { id: `acquire:${next.id}:${key}`, seed: key, intensity: .92 })
    },
  })

  const choose = (key: string) => {
    if (key === activeKey) return
    void play('select', { seed: key, intensity: .3 })
    setLocalKey(key)
    onSelect?.(key)
  }

  const held = rivals.filter((asset) => asset.owned).length

  if (!target || !targetAsset) {
    return (
      <section className={`rival-war-room ${compact ? 'is-compact' : ''}`}>
        <div className="wr-cleared">
          <Trophy size={26} />
          <h3>Every rival firm now carries your crest.</h3>
          <p>All {rivals.length} competing practices have been absorbed. The war room is quiet; the caseboard is where the story goes from here.</p>
        </div>
      </section>
    )
  }

  const discount = (target.discount_bps ?? 0) / 100
  const standing = rivalStanding(targetAsset)
  const region = mapRegionForTier(targetAsset.tier)
  const affordable = game.cash >= target.cost
  const completedOperations = target.operations.filter((item) => item.completed).length

  return (
    <section className={`rival-war-room ${compact ? 'is-compact' : ''}`}>
      {!compact && (
        <header className="wr-heading">
          <div>
            <span className="wr-kicker"><Crosshair size={12} /> RIVAL OPERATIONS</span>
            <h2>Win clean — or make them cheaper.</h2>
            <p>
              Every rival can be worn down before you buy it. Each operation runs once per firm and cuts up to 45% off the
              acquisition price, but the ruthless ones cost ethics, reputation and heat that the rest of the campaign remembers.
            </p>
          </div>
          <div className="wr-tally">
            <span>{held} of {rivals.length}</span>
            <small>FIRMS HELD</small>
          </div>
        </header>
      )}

      <CaseworkMeter game={game} />

      {!compact && (
        <div className="wr-target-strip" role="tablist" aria-label="Rival firms">
          {rivals.map((asset) => {
            const state = rivalStanding(asset)
            return (
              <button
                key={asset.key}
                type="button"
                role="tab"
                aria-selected={asset.key === target.key}
                className={`wr-target wr-target-${state} ${asset.key === target.key ? 'is-active' : ''}`}
                disabled={asset.owned}
                onClick={() => choose(asset.key)}
              >
                <span className="wr-target-art">
                  <Suspense fallback={<i className="wr-target-art-fallback" />}>
                    <CatalogAssetRender asset={asset} fallbackSrc={rivalSiteArt(asset.art ?? 'mega-tower')} />
                  </Suspense>
                </span>
                <span>{rivalFirmName(asset)}</span>
                <small>{mapRegionForTier(asset.tier).name}</small>
                <b>{STANDING_COPY[state].label}</b>
              </button>
            )
          })}
        </div>
      )}

      <div className="wr-valuation">
        <div className="wr-valuation-copy">
          <span className="wr-kicker"><Landmark size={12} /> {region.name} · {targetAsset.region ?? `Tier ${targetAsset.tier}`}</span>
          <h3>{rivalFirmName(targetAsset)}</h3>
          <p>{targetAsset.description}</p>
          <div className="wr-standing" data-standing={standing}>
            <b>{STANDING_COPY[standing].label}</b>
            <small>{completedOperations
              ? `${completedOperations} of ${target.operations.length} operations run.`
              : STANDING_COPY[standing].blurb}</small>
          </div>
        </div>
        <div className="wr-valuation-price">
          <small>LIST VALUE</small>
          <del>{formatMoney(target.list_cost ?? target.cost)}</del>
          <small>NEGOTIATED VALUE</small>
          <strong>{formatMoney(target.cost)}</strong>
          <b className={discount > 0 ? 'has-discount' : ''}>{discount.toFixed(0)}% off list{discount >= 45 ? ' · capped' : ''}</b>
          <button
            type="button"
            className="wr-acquire"
            disabled={!targetAsset.available || !affordable || acquire.isPending}
            onClick={() => acquire.mutate(targetAsset.key)}
          >
            {acquire.isPending ? 'Signing…' : !targetAsset.available ? 'Requirements not met' : affordable ? `Acquire for ${formatMoney(target.cost)}` : 'Keep earning'}
          </button>
          {onShowOnMap && <button type="button" className="wr-locate" onClick={() => onShowOnMap(targetAsset)}>Show on the map</button>}
        </div>
      </div>

      <div className="wr-operation-grid">
        {target.operations.map((item) => (
          <OperationCard
            key={item.key}
            operation={item}
            disabled={operation.isPending}
            onLaunch={() => operation.mutate({ rivalKey: target.key, operationKey: item.key })}
          />
        ))}
      </div>

      {(operation.error || acquire.error) && (
        <p className="wr-error" role="alert">
          {operation.error instanceof Error ? operation.error.message : acquire.error instanceof Error ? acquire.error.message : 'That move could not be made.'}
        </p>
      )}
    </section>
  )
}
