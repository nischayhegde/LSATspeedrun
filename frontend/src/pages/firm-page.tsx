import { type KeyboardEvent, useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Award,
  BriefcaseBusiness,
  Building2,
  Check,
  CircleDollarSign,
  Handshake,
  HeartHandshake,
  Lamp,
  Lock,
  Sparkles,
  Star,
  Trophy,
  UserRound,
  UsersRound,
  Wrench,
} from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { api } from '../api'
import { ErrorNotice, formatMoney, LoadingScreen } from '../components'
import { ClientPortrait, PixelAssetArtwork, StaffRoster } from '../game-art'
import { PixelStudyScenery } from '../art/pixel-scenery'
import { RivalWarRoom } from '../rival-war-room'
import { useSound } from '../sound'
import { MOTION_TIMING } from '../motion'
import type { CharacterGender, GameAsset, GameClient, GameState } from '../types'
import { effectiveClient, storeGame, useGame } from './shared'
// The rules in `styles.css` that only this screen can render.
import '../firm-page.css'
import '../mobile/firm-page.css'


/* Achievements is not here. It was a seventh tab that rendered read-only cards:
   no control, and `_achievement_state` computes booleans off counters that
   nothing grants anything for. A tab slot is navigation the player pays for on
   every visit, so the trophies moved into a closed disclosure in the heading --
   the same shape the Practice page already keeps its help in. */
type FirmTab = 'upgrades' | 'decor' | 'staff' | 'clients' | 'connections' | 'rivals'

const firmTabs: Array<{ key: FirmTab; label: string; icon: typeof Wrench }> = [
  { key: 'upgrades', label: 'Upgrades', icon: Wrench },
  { key: 'decor', label: 'Decor', icon: Lamp },
  { key: 'staff', label: 'Staff', icon: UsersRound },
  { key: 'clients', label: 'Clients', icon: BriefcaseBusiness },
  { key: 'connections', label: 'Connections', icon: Handshake },
  { key: 'rivals', label: 'Rivals', icon: Trophy },
]


function RequirementLine({ asset, game }: { asset: GameAsset; game: GameState }) {
  const missing = [
    asset.requirements.reputation > game.reputation && `${asset.requirements.reputation} Reputation`,
    asset.requirements.tier > game.office_tier && `Firm tier ${asset.requirements.tier}`,
    ...asset.requirements.assets.filter((key) => !game.owned_assets.includes(key)).map((key) => key.replaceAll('_', ' ')),
  ].filter(Boolean)
  return <small className={missing.length ? 'requirements missing' : 'requirements met'}>{missing.length ? `Needs ${missing.join(' · ')}` : 'Requirements met'}</small>
}


/* Every client at a tier is worth the same per case -- `_rebalance_client_catalog`
   equalises that by construction -- so the only thing that distinguishes two
   cards is how the money is shaped, and until now nothing on the card showed it.
   The bar is the decision: the left segment is banked when a case is won, the
   right one only arrives if the contract is finished, and a reputation slip puts
   the client on hold with the close still owed. Drawn rather than described,
   because a proportion is what a bar is for. */
function ClientShape({ client }: { client: GameClient }) {
  const atClose = Math.round((client.close_share_bps ?? 0) / 100)
  if (!atClose) return null
  const shape = atClose <= 12 ? 'STEADY' : atClose <= 18 ? 'BALANCED' : 'SPECULATIVE'
  return (
    <div className={`client-shape client-shape-${shape.toLowerCase()}`}>
      <span className="client-shape-head"><b>{shape}</b><small>{100 - atClose}% per case · {atClose}% at close</small></span>
      <span className="client-shape-bar"><i style={{ width: `${100 - atClose}%` }} /></span>
    </div>
  )
}


function ClientRequirementLine({ client, game }: { client: GameClient; game: GameState }) {
  if (client.unlocked) return <small className="requirements met">Closing bonus every {client.length} wins</small>
  const assetNames = client.requirements.assets.map((key) => game.catalog.assets.find((asset) => asset.key === key)?.name ?? key.replaceAll('_', ' '))
  const requirements = [
    client.requirements.reputation > 0 && `${client.requirements.reputation} Reputation`,
    client.requirements.tier > 0 && `Firm tier ${client.requirements.tier}`,
    ...assetNames,
  ].filter(Boolean)
  return <small className="requirements missing">Requires {requirements.join(' · ')}</small>
}


export function FirmPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { play } = useSound()
  const initial = (searchParams.get('tab') as FirmTab) || 'upgrades'
  const [tab, setTab] = useState<FirmTab>(firmTabs.some((item) => item.key === initial) ? initial : 'upgrades')

  useEffect(() => {
    const requested = searchParams.get('tab') as FirmTab | null
    if (requested && firmTabs.some((item) => item.key === requested)) setTab(requested)
  }, [searchParams])
  const [catalogView, setCatalogView] = useState<'all' | 'ready' | 'owned'>('all')
  const [catalogRegion, setCatalogRegion] = useState('all')
  const queryClient = useQueryClient()
  const gameQuery = useGame()
  const [justBought, setJustBought] = useState<string | null>(null)
  const [justActivated, setJustActivated] = useState<string | null>(null)
  const purchase = useMutation({
    mutationFn: api.purchase,
    onSuccess: ({ game }, key) => {
      storeGame(queryClient, game)
      void play('purchase', { id: `purchase:${game.id}:${key}`, seed: key, intensity: .75 })
      setJustBought(key)
      window.setTimeout(() => setJustBought(null), MOTION_TIMING.toastMs)
    },
  })
  const advance = useMutation({
    mutationFn: api.advanceFirm,
    onSuccess: ({ game }, tier) => {
      storeGame(queryClient, game)
      void play('promotion', {
        id: `promotion:${game.id}:${tier}`,
        seed: String(tier),
        intensity: .95,
        profile: { officeTier: game.office_tier, alignment: game.story.alignment },
      })
    },
  })
  const client = useMutation({
    mutationFn: api.selectClient,
    onSuccess: ({ game }, key) => {
      storeGame(queryClient, game)
      void play('client', { seed: key, intensity: .72 })
      setJustActivated(key)
      window.setTimeout(() => setJustActivated(null), MOTION_TIMING.toastMs)
    },
  })
  const appearance = useMutation({
    mutationFn: (characterGender: CharacterGender) => api.updateGame({ character_gender: characterGender }),
    onSuccess: ({ game }) => {
      storeGame(queryClient, game)
      void play('paper', { seed: game.character_gender, intensity: .32 })
    },
  })

  if (gameQuery.isLoading) return <LoadingScreen />
  const game = gameQuery.data!.game!
  const typeMap: Record<FirmTab, GameAsset['type'] | null> = { upgrades: 'upgrade', decor: 'cosmetic', staff: 'staff', clients: null, connections: 'connection', rivals: 'rival' }
  const achieved = game.achievements.filter((item) => item.unlocked).length
  const assets = game.catalog.assets.filter((item) => item.type === typeMap[tab])
  const regions = Array.from(new Set([
    ...game.catalog.tiers.map((tier) => tier.region),
    ...game.catalog.assets.map((asset) => asset.region).filter((region): region is string => Boolean(region)),
  ]))
  const visibleAssets = assets.filter((item) =>
    (catalogRegion === 'all' || item.region === catalogRegion)
    && (catalogView === 'all' || (catalogView === 'ready' ? item.available : item.owned)),
  )
  const unlockedStaff = game.catalog.assets.filter((item) => item.type === 'staff' && (item.owned || item.available))
  const visibleClients = game.catalog.clients.filter((item) =>
    (catalogRegion === 'all' || item.region === catalogRegion)
    && (catalogView === 'all' || (catalogView === 'ready' ? item.unlocked : item.selected)),
  )
  const nextTier = game.catalog.tiers.find((tier) => tier.next)
  const missingTierAssets = (nextTier?.missing_assets ?? []).map((key) =>
    game.catalog.assets.find((asset) => asset.key === key)?.name ?? key.replaceAll('_', ' '),
  )
  const workingClient = effectiveClient(game)
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, current: FirmTab) => {
    const currentIndex = firmTabs.findIndex((item) => item.key === current)
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % firmTabs.length
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + firmTabs.length) % firmTabs.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = firmTabs.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const next = firmTabs[nextIndex].key
    void play('tab', { seed: next, intensity: .32 })
    setTab(next)
    window.requestAnimationFrame(() => document.getElementById(`firm-tab-${next}`)?.focus())
  }
  const selectTab = (next: FirmTab) => {
    if (next === tab) return
    void play('tab', { seed: next, intensity: .32 })
    setTab(next)
  }
  const selectCatalogView = (next: 'all' | 'ready' | 'owned') => {
    if (next === catalogView) return
    void play('select', { seed: next, intensity: .25 })
    setCatalogView(next)
  }

  return (
    <div className="firm-page page-wrap">
      <section className="page-heading firm-ledger-heading">
        <PixelStudyScenery variant="ledger" className="firm-ledger-scenery" />
        <div className="firm-heading-copy"><span className="eyebrow">THE PARTNERS' LEDGER · MANAGE THE FIRM</span><h1>Build a legendary practice.</h1><p>Spend case fees on a living, growing office. Every improvement appears in your firm and makes the next case worth more.</p><div className="ledger-rule"><i /><span>§</span><i /></div></div>
        <div className="firm-wallet">
          <div className="wallet-clasp"><i /><i /></div><small>FIRM TREASURY</small><strong>{formatMoney(game.cash)}</strong><span><Star size={15} /> {game.reputation.toFixed(1)} Reputation</span>
          <span className={`wallet-lease ${game.upkeep.rent_arrears ? 'has-arrears' : ''}`}><CircleDollarSign size={15} /> {game.upkeep.completed ? 'Lease retired' : `${formatMoney(game.upkeep.daily_rent)} daily rent${game.upkeep.rent_arrears ? ` · ${formatMoney(game.upkeep.rent_arrears)} due` : ''}`}</span>
          <button
            className="appearance-button"
            disabled={appearance.isPending}
            aria-label={`Switch to the ${game.character_gender === 'female' ? 'male' : 'female'} character`}
            onClick={() => appearance.mutate(game.character_gender === 'female' ? 'male' : 'female')}
          >
            <UserRound size={14} />
            {appearance.isPending ? 'Updating character…' : <>Character: {game.character_gender === 'female' ? 'Female' : 'Male'}<span>Switch</span></>}
          </button>
        </div>
        <details className="firm-trophies">
          <summary><Award size={14} /> Trophies <b>{achieved} of {game.achievements.length}</b></summary>
          <div className="achievement-grid">
            {game.achievements.map((item, index) => (
              <article key={item.key} className={item.unlocked ? 'unlocked' : ''}>
                <div>{item.unlocked ? <Trophy /> : <Lock />}</div><span>{String(index + 1).padStart(2, '0')}</span><h3>{item.name}</h3><p>{item.description}</p>{item.unlocked && <small><Check /> ACHIEVED</small>}
              </article>
            ))}
          </div>
        </details>
      </section>
      <div className="firm-tabs" role="tablist" aria-label="Firm management sections">
        {firmTabs.map(({ key, label, icon: Icon }, index) => <button key={key} id={`firm-tab-${key}`} type="button" role="tab" aria-selected={tab === key} aria-controls={`firm-panel-${key}`} tabIndex={tab === key ? 0 : -1} className={tab === key ? 'active' : ''} onKeyDown={(event) => moveTab(event, key)} onClick={() => selectTab(key)}><span className="firm-tab-icon"><Icon size={17} /></span><span>{label}</span><small>{String(index + 1).padStart(2, '0')}</small></button>)}
      </div>

      {firmTabs.filter(({ key }) => key !== tab).map(({ key }) => <div key={key} id={`firm-panel-${key}`} role="tabpanel" aria-labelledby={`firm-tab-${key}`} hidden />)}
      <div id={`firm-panel-${tab}`} className={`firm-panel firm-panel-${tab}`} role="tabpanel" aria-labelledby={`firm-tab-${tab}`} tabIndex={0}>
        {tab === 'staff' && <StaffRoster staff={unlockedStaff} />}
        {/* The rivals tab leads with the war room rather than the catalog grid,
            because weakening a firm and then buying it is one move: the grid
            below is only ever the raw price list. */}
        {tab === 'rivals' && <RivalWarRoom game={game} onShowOnMap={(asset) => navigate(`/map?rival=${asset.key}`)} />}
        <div className="catalog-toolbar">
          <div><span>CATALOG VIEW</span><strong>{tab === 'clients' ? visibleClients.length : visibleAssets.length} RESULTS</strong></div>
          <div className="catalog-view-buttons" role="group" aria-label="Filter catalog status">
            {(['all', 'ready', 'owned'] as const).map((view) => <button key={view} className={catalogView === view ? 'active' : ''} onClick={() => selectCatalogView(view)}>{view === 'owned' && tab === 'clients' ? 'Active' : view}</button>)}
          </div>
          <label><span>CITY REGION</span><select value={catalogRegion} onChange={(event) => {
            const nextRegion = event.target.value
            if (nextRegion !== catalogRegion) void play('select', { seed: nextRegion, intensity: .25 })
            setCatalogRegion(nextRegion)
          }}><option value="all">All districts</option>{regions.map((region) => <option key={region} value={region}>{region}</option>)}</select></label>
        </div>
        {tab === 'upgrades' && nextTier && (
          <section className="tier-upgrade-banner">
          <div className="tier-preview"><Building2 /><span>TIER {nextTier.tier}</span></div>
          <div>
            <span className="eyebrow">{nextTier.region} · OFFICE TRANSFORMATION</span>
            <h2>{nextTier.name}</h2><p>{nextTier.short}</p>
            <small>{nextTier.feature} · Requires {nextTier.reputation} Reputation and every prior upgrade, staff hire, and acquisition</small>
            <span className="next-tier-rent"><CircleDollarSign size={14} /> New lease: {formatMoney(nextTier.rent_daily)} per day</span>
            {missingTierAssets.length > 0 && <><br /><small className="requirements missing">Still needed: {missingTierAssets.slice(0, 3).join(' · ')}{missingTierAssets.length > 3 ? ` · +${missingTierAssets.length - 3} more` : ''}</small></>}
          </div>
          <div className="tier-buy"><strong>{formatMoney(nextTier.cost)}</strong><button className="primary-button" disabled={!nextTier.available || game.cash < nextTier.cost || advance.isPending} onClick={() => advance.mutate(nextTier.tier)}>{advance.isPending ? 'Renovating…' : !nextTier.available ? 'Locked' : game.cash < nextTier.cost ? 'Keep earning' : 'Advance firm'}</button></div>
          </section>
        )}

        {tab === 'clients' ? (
          <>
            {/* This screen sets a rate; it does not hand out work. Cases are
                minted on demand over on Practice, so anything here phrased as
                an inventory of waiting matters was describing something that
                does not exist. The retainer's counter is a progress bar to a
                bonus that renews itself, not a supply that runs out. */}
            <section className="client-roster-status">
              <ClientPortrait kind={workingClient.icon} name={workingClient.name} mood="happy" />
              <div><span className="eyebrow">ON RETAINER</span><h2>{workingClient.name}</h2><p>{game.active_client.on_hold ? `${game.active_client.name} is on hold until Reputation recovers, so ${workingClient.name} is billing for now.` : `${game.active_client.cases_remaining} more wins closes this retainer for a bonus, then it renews.`}</p></div>
              <aside>
                <span>YOUR RATE</span>
                <strong>{formatMoney(workingClient.base_fee)}</strong>
                <small>per case, before firm and streak bonuses</small>
              </aside>
            </section>
            <div className="management-grid client-grid">
            {visibleClients.map((item) => (
              <article key={item.key} className={`management-card client-card ${item.matter_type === 'pro_bono' ? 'pro-bono-client' : ''} ${item.selected ? 'selected' : ''} ${!item.unlocked ? 'locked' : ''} ${justActivated === item.key ? 'just-activated' : ''}`}>
                <ClientPortrait kind={item.icon} name={item.name} mood={item.selected ? 'happy' : 'neutral'} className="client-card-portrait" />
                {item.matter_type === 'pro_bono' && <div className="pro-bono-seal"><HeartHandshake /> PRO BONO</div>}
                <div className="card-status">{item.on_hold ? <><Lock size={12} /> ON HOLD</> : item.selected ? 'ON RETAINER' : item.unlocked ? 'CAN RETAIN' : <><Lock size={12} /> LOCKED</>}</div>
                <div className="content-location-tag">{item.region || `TIER ${item.tier}`}{item.archetype && <b>{item.archetype}</b>}</div>
                <h3>{item.name}</h3><p>{item.description}</p>
                <div className="client-fee"><span>Base fee per case</span><strong>{formatMoney(item.base_fee)}</strong></div>
                <ClientShape client={item} />
                {item.special && <div className="client-special"><Sparkles size={13} /><span><small>CASE TWIST</small>{item.special}</span></div>}
                {item.on_hold && <div className="effective-client-note"><BriefcaseBusiness size={13} />Billing {workingClient.name} instead · {formatMoney(workingClient.base_fee)} per case</div>}
                {item.contract && <div className="contract-mini"><span>{item.contract.cases_remaining} to bonus</span><span>{item.contract.loyalty} loyalty</span></div>}
                <ClientRequirementLine client={item} game={game} />
                <button className={item.selected ? 'secondary-button full' : 'primary-button full'} disabled={!item.unlocked || item.selected || client.isPending} onClick={() => client.mutate(item.key)}>{client.isPending && client.variables === item.key ? 'Signing…' : item.on_hold ? 'Retained · On hold' : item.selected ? 'Billing this rate' : !item.unlocked ? 'Locked' : `Bill at ${formatMoney(item.base_fee)}`}</button>
                {justActivated === item.key && <div className="client-activated-flash"><Check /> NEW CLIENT ACTIVE</div>}
              </article>
            ))}
            </div>
          </>
      ) : (
        <div className="management-grid asset-management-grid">
          {visibleAssets.map((item) => (
            <article key={item.key} className={`management-card asset-card asset-card-${item.type} ${item.owned ? 'owned' : ''} ${!item.available && !item.owned ? 'locked' : ''} ${justBought === item.key ? 'just-bought' : ''}`}>
              <PixelAssetArtwork asset={item} />
              <div className="card-status">{item.owned ? <><Check size={13} /> OWNED</> : item.available ? 'AVAILABLE' : <><Lock size={12} /> LOCKED</>}</div>
              <div className="asset-card-copy"><span className="asset-card-number">ASSET {String(assets.indexOf(item) + 1).padStart(2, '0')} · {item.region?.toUpperCase()}</span><h3>{item.name}</h3><p>{item.description}</p></div><div className="benefit-pill"><Sparkles size={14} /><span><small>GAME EFFECT</small>{item.benefit}</span></div>
              <RequirementLine asset={item} game={game} />
              {/* Locked is named before cost, because an unmet requirement is the
                  blocker that earning more cannot clear. Leaving it out labelled a
                  disabled button 'Purchase', which reads as an unresponsive click. */}
              <div className="purchase-row"><strong>{item.list_cost && item.list_cost > item.cost ? <><del>{formatMoney(item.list_cost)}</del>{formatMoney(item.cost)} <small>−{(item.discount_bps! / 100).toFixed(0)}%</small></> : formatMoney(item.cost)}</strong><button className="primary-button" disabled={item.owned || !item.available || game.cash < item.cost || purchase.isPending} onClick={() => purchase.mutate(item.key)}>{item.owned ? 'Installed' : !item.available ? 'Locked' : game.cash < item.cost ? 'Keep earning' : 'Purchase'}</button></div>
              {/* A connection's whole effect is the retainer board it opens, and
                  that board is on the map. Same hand-off the rivals tab already
                  makes, so owning one is something you can go and look at. */}
              {item.type === 'connection' && <button type="button" className="asset-locate" onClick={() => navigate(`/map?connection=${item.key}`)}>Show on the map</button>}
            </article>
          ))}
        </div>
        )}
      </div>
      {(purchase.error || advance.error || client.error || appearance.error) && <ErrorNotice error={purchase.error || advance.error || client.error || appearance.error} />}
    </div>
  )
}
