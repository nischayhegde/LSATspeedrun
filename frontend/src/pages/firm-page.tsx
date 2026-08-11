import { type KeyboardEvent, useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Award,
  BriefcaseBusiness,
  Building2,
  Check,
  CircleDollarSign,
  HeartHandshake,
  Lamp,
  Landmark,
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
import { RetainerLedger } from '../retainer-ledger'
import { RivalWarRoom } from '../rival-war-room'
import { useSound } from '../sound'
import { formatMoneyDelta } from '../format'
import { MOTION_TIMING, useDelta, useRollupInt } from '../motion'
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
  /* The tab is named for what it is now for. A connection's whole effect is
     the districts it opens, so the retainer ledger leads the panel and the
     networks that gate it follow underneath. */
  { key: 'connections', label: 'Districts', icon: Landmark },
  { key: 'rivals', label: 'Rivals', icon: Trophy },
]

/** How long an acquisition's confirmation stays on the card it belongs to.
 *
 *  Longer than `toastMs`, which was cutting the flash off a third of the way
 *  through its own animation, and held in React rather than left to the tail
 *  of a CSS fade: the global reduced-motion rule collapses animation durations
 *  to .01ms, so anything that ends on `opacity: 0` is invisible from the first
 *  frame for the readers who asked for less motion. */
const ACQUIRED_HOLD_MS = 2200

/** How long the card the staff roster just found stays marked. Longer than a
 *  purchase stamp: that one confirms something you did on the card you were
 *  already looking at, and this one has to survive a smooth scroll across the
 *  page and still be lit when the scroll stops. */
const CALLED_HOLD_MS = 3200


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


/* A network's entire effect is the districts it opens, and the benefit pill
   could only ever say "Counsel opens in 3 districts" -- a number, in a tab
   whose whole problem is that what you buy is hard to see. The server has
   published the names and their held state all along (`asset.districts`), so
   the card names them and marks the ones already signed. Three chips is also
   the shortest honest answer to "what does this actually get me", which the
   payout clause beside it cannot give. */
function ConnectionDistricts({ asset }: { asset: GameAsset }) {
  const districts = asset.districts ?? []
  if (!districts.length) return null
  const held = asset.districts_held ?? districts.filter((district) => district.held).length
  return (
    <div className="connection-districts">
      <small>OPENS {districts.length === 1 ? 'ONE DISTRICT' : `${districts.length} DISTRICTS`}{held > 0 && ` · ${held} SIGNED`}</small>
      <ul>
        {districts.map((district) => (
          <li key={district.key} className={district.held ? 'is-held' : ''}>
            {district.held && <Check size={10} />}{district.name}
          </li>
        ))}
      </ul>
    </div>
  )
}


/* How close a locked honour is, from counters the server already keeps.
   A padlock and a sentence describing something that has not happened is the
   same card thirteen times over; a bar and a count make the cabinet worth
   opening, and none of it changes what an honour is worth, which is nothing on
   purpose. Money is abbreviated because a valuation target is eight digits and
   the card is a hundred and sixty pixels wide. */
function AchievementProgress({ progress }: { progress?: { current: number; target: number; unit: string } }) {
  if (!progress) return null
  const share = Math.max(0, Math.min(1, progress.current / progress.target))
  const figure = progress.unit === 'money'
    ? `${formatMoney(progress.current, true)} of ${formatMoney(progress.target, true)}`
    : progress.unit === 'reputation'
      ? `${progress.current.toFixed(1)} of ${progress.target} Reputation`
      : progress.unit === 'tier'
        ? `Tier ${Math.round(progress.current)} of ${progress.target}`
        : `${Math.round(progress.current)} of ${Math.round(progress.target)} ${progress.unit}`
  return (
    <small className="achievement-progress">
      <i aria-hidden="true"><b style={{ width: `${Math.round(share * 100)}%` }} /></i>
      {figure}
    </small>
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
      window.setTimeout(() => setJustBought((current) => (current === key ? null : current)), ACQUIRED_HOLD_MS)
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
      window.setTimeout(() => setJustActivated((current) => (current === key ? null : current)), ACQUIRED_HOLD_MS)
    },
  })
  const appearance = useMutation({
    mutationFn: (characterGender: CharacterGender) => api.updateGame({ character_gender: characterGender }),
    onSuccess: ({ game }) => {
      storeGame(queryClient, game)
      void play('paper', { seed: game.character_gender, intensity: .32 })
    },
  })

  /* Every purchase on this page is a debit, and until now the only thing that
     said so was the card you clicked. The treasury travels to its new figure
     and names the movement, so the answer to "did that go through, and what
     did it cost me" is in the one place the money lives. Read before the
     loading guard, because hooks cannot be conditional; both accommodate a
     missing value and `useDelta` reports nothing for the first one it sees. */
  const cash = gameQuery.data?.game?.cash
  const cashShown = useRollupInt(cash)
  const cashDelta = useDelta(cash, 2400)

  if (gameQuery.isLoading) return <LoadingScreen />
  const game = gameQuery.data!.game!
  const typeMap: Record<FirmTab, GameAsset['type'] | null> = { upgrades: 'upgrade', decor: 'cosmetic', staff: 'staff', clients: null, connections: 'connection', rivals: 'rival' }
  const achieved = game.achievements.filter((item) => item.unlocked).length
  const assets = game.catalog.assets.filter((item) => item.type === typeMap[tab])
  /* The catalog's `region` is not the map's region, and the Districts tab shows
     both within a hundred pixels of each other: the ledger's rail reads Old
     Quarter / The Circuit / Treaty Sea / Sovereign Arc / Global Compact, and
     this filter reads Market Ward / Civic Center / Financial District and
     eleven more. Only one name appears in both, so side by side they look like
     two naming systems that were never reconciled.

     They are two axes, and they nest. A catalog region is the street address
     the firm occupied at one tier -- `_asset()` defaults it to
     `FIRM_TIERS[tier]["region"]` -- and a map region is an area covering a run
     of tiers. So every address sits inside exactly one region, and the fix is
     to show that rather than to rename either set: the addresses are grouped
     under the region that contains them, in tier order. */
  const tierForAddress = new Map<string, number>()
  for (const tier of game.catalog.tiers) {
    if (!tierForAddress.has(tier.region)) tierForAddress.set(tier.region, tier.tier)
  }
  for (const asset of game.catalog.assets) {
    // A handful of assets override the region their tier would give them.
    if (asset.region && !tierForAddress.has(asset.region)) tierForAddress.set(asset.region, asset.tier)
  }
  const addressGroups = game.territory.regions.map((region) => ({
    key: region.key,
    name: region.name,
    addresses: Array.from(tierForAddress.entries())
      .filter(([, tier]) => tier >= region.tier_range[0] && tier <= region.tier_range[1])
      .sort((left, right) => left[1] - right[1])
      .map(([address]) => address),
  })).filter((group) => group.addresses.length > 0)
  // Anything the tier ranges do not claim still has to be selectable.
  const groupedAddresses = new Set(addressGroups.flatMap((group) => group.addresses))
  const looseAddresses = Array.from(tierForAddress.keys()).filter((address) => !groupedAddresses.has(address))
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
  /* Take the player from a face on the firm floor to the card that hires them.
     The two filters above the grid can both be hiding that card — a candidate
     is not in the "owned" view, and nobody is in another region's — so they are
     cleared first, and the trip waits a frame for the grid to contain the card
     again.

     Landing is three things, and only the first is the scroll. Focus moves to
     the card, so a keyboard is where the eye is and the next Tab reaches the
     hire button rather than starting again from the roster. The brass flash is
     set on the element rather than rendered from state: it is a transient
     "this one", like a focus ring, it has to survive whatever the page renders
     in the next two seconds, and React does not manage `data-called`, so it
     stays put until the timer takes it off. */
  const callAssetCard = (asset: GameAsset) => {
    if (catalogView === 'owned' && !asset.owned) setCatalogView('all')
    if (catalogView === 'ready' && asset.owned) setCatalogView('all')
    if (catalogRegion !== 'all' && asset.region !== catalogRegion) setCatalogRegion('all')
    void play('select', { seed: asset.key, intensity: .3 })
    window.requestAnimationFrame(() => {
      const card = document.getElementById(`asset-${asset.key}`)
      if (!card) return
      card.scrollIntoView({ behavior: 'smooth', block: 'center' })
      card.focus({ preventScroll: true })
      card.dataset.called = 'true'
      window.setTimeout(() => { delete card.dataset.called }, CALLED_HOLD_MS)
    })
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
        {/* No standfirst. It said that spending money on the office improves
            the office, which the six tabs under it say better, and it cost a
            band of the screen on every visit — most of it on a phone, where
            the heading already runs past the fold. */}
        <div className="firm-heading-copy"><span className="eyebrow">THE PARTNERS' LEDGER · MANAGE THE FIRM</span><h1>Build a legendary practice.</h1><div className="ledger-rule"><i /><span>§</span><i /></div></div>
        <div className="firm-wallet">
          <div className="wallet-clasp"><i /><i /></div><small>FIRM TREASURY</small><strong>{formatMoney(cashShown ?? game.cash)}</strong>
          {cashDelta !== null && <span className={`wallet-delta ${cashDelta < 0 ? 'is-debit' : 'is-credit'}`} role="status">{formatMoneyDelta(cashDelta)}</span>}
          <span><Star size={15} /> {game.reputation.toFixed(1)} Reputation</span>
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
        {/* An honour grants nothing, on purpose: the economy is tuned around
            three to six cases per upgrade, and a prize for reaching a hundred
            of them would quietly retune it. What the locked ones were missing
            was a reading, not a reward. Every one counts something the server
            already tracks, so each now shows how far along it is rather than a
            padlock and a sentence about a thing that has not happened. */}
        <details className="firm-trophies">
          <summary><Award size={14} /> Trophies <b>{achieved} of {game.achievements.length}</b></summary>
          <div className="achievement-grid">
            {game.achievements.map((item, index) => (
              <article key={item.key} className={item.unlocked ? 'unlocked' : ''}>
                <div>{item.unlocked ? <Trophy /> : <Lock />}</div><span>{String(index + 1).padStart(2, '0')}</span><h3>{item.name}</h3><p>{item.description}</p>
                {item.unlocked ? <small><Check /> ACHIEVED</small> : <AchievementProgress progress={item.progress} />}
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
        {tab === 'staff' && <StaffRoster staff={unlockedStaff} onSelect={callAssetCard} />}
        {/* The rivals tab leads with the war room rather than the catalog grid,
            because weakening a firm and then buying it is one move: the grid
            below is only ever the raw price list. */}
        {tab === 'rivals' && <RivalWarRoom game={game} onShowOnMap={(asset) => navigate(`/map?rival=${asset.key}`)} />}
        {/* Signing a district is a firm interaction, so the counsel ledger is in
            the firm tab. It leads the panel and the connection catalog that
            gates it follows, which is the order the decision is made in. */}
        {tab === 'connections' && (
          <RetainerLedger
            game={game}
            highlightKey={searchParams.get('district')}
            onShowOnMap={(district) => navigate(`/map?district=${district.key}`)}
          />
        )}
        <div className="catalog-toolbar">
          <div><span>CATALOG VIEW</span><strong>{tab === 'clients' ? visibleClients.length : visibleAssets.length} RESULTS</strong></div>
          <div className="catalog-view-buttons" role="group" aria-label="Filter catalog status">
            {(['all', 'ready', 'owned'] as const).map((view) => <button key={view} className={catalogView === view ? 'active' : ''} onClick={() => selectCatalogView(view)}>{view === 'owned' && tab === 'clients' ? 'Active' : view}</button>)}
          </div>
          {/* Was "CITY REGION · All districts", which is what made this read as
              a rival geography to the ledger's five regions -- and "districts"
              is flatly the wrong noun, since these are the firm's own past
              addresses and the districts are the thing on the board above. */}
          <label><span>FIRM ADDRESS</span><select value={catalogRegion} onChange={(event) => {
            const nextRegion = event.target.value
            if (nextRegion !== catalogRegion) void play('select', { seed: nextRegion, intensity: .25 })
            setCatalogRegion(nextRegion)
          }}>
            <option value="all">Every address</option>
            {addressGroups.map((group) => (
              <optgroup key={group.key} label={group.name} >
                {group.addresses.map((address) => <option key={address} value={address}>{address}</option>)}
              </optgroup>
            ))}
            {looseAddresses.map((address) => <option key={address} value={address}>{address}</option>)}
          </select></label>
        </div>
        {/* Said once, on the one tab where the two are adjacent. */}
        {tab === 'connections' && (
          <p className="catalog-axis-note">
            Above: the five <b>regions</b> of the map, and the districts your firm is counsel to.
            Here: the <b>address</b> the firm held at each tier. Every address sits inside one region.
          </p>
        )}
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
              {/* The one tab that set something and then said nothing about
                  where it applies. Decor, districts and rivals all hand off to
                  the surface their purchase shows up on; this screen sets the
                  fee every case pays and never named the place cases are
                  worked, which is the other half of the reported confusion
                  about where work comes from. Cases are minted on Practice and
                  nowhere else, so that is where this points. */}
              <aside>
                <span>YOUR RATE</span>
                <strong>{formatMoney(workingClient.base_fee)}</strong>
                <small>per case, before firm and streak bonuses</small>
                <button type="button" className="client-roster-go" onClick={() => navigate('/cases')}>
                  Work a case at this rate <ArrowRight size={13} />
                </button>
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
                {/* Same stamp the asset cards take, for the same reason: the
                    card that just changed is the thing worth looking at. */}
                {justActivated === item.key && <span className="asset-acquired" aria-hidden="true"><Check size={14} /> ON RETAINER</span>}
              </article>
            ))}
            </div>
          </>
      ) : (
        <div className="management-grid asset-management-grid">
          {/* `tabIndex={-1}` on the card so the roster can put focus on the one
              it just found. It stays out of the tab order; only the trip
              lands there. */}
          {visibleAssets.map((item) => (
            <article key={item.key} id={`asset-${item.key}`} tabIndex={-1} className={`management-card asset-card asset-card-${item.type} ${item.owned ? 'owned' : ''} ${!item.available && !item.owned ? 'locked' : ''} ${justBought === item.key ? 'just-bought' : ''}`}>
              <PixelAssetArtwork asset={item} />
              <div className="card-status">{item.owned ? <><Check size={13} /> OWNED</> : item.available ? 'AVAILABLE' : <><Lock size={12} /> LOCKED</>}</div>
              <div className="asset-card-copy"><span className="asset-card-number">ASSET {String(assets.indexOf(item) + 1).padStart(2, '0')} · {item.region?.toUpperCase()}</span><h3>{item.name}</h3><p>{item.description}</p></div><div className="benefit-pill"><Sparkles size={14} /><span><small>GAME EFFECT</small>{item.benefit}</span></div>
              {item.type === 'connection' && <ConnectionDistricts asset={item} />}
              <RequirementLine asset={item} game={game} />
              {/* Locked is named before cost, because an unmet requirement is the
                  blocker that earning more cannot clear. Leaving it out labelled a
                  disabled button 'Purchase', which reads as an unresponsive click. */}
              <div className="purchase-row"><strong>{item.list_cost && item.list_cost > item.cost ? <><del>{formatMoney(item.list_cost)}</del>{formatMoney(item.cost)} <small>−{(item.discount_bps! / 100).toFixed(0)}%</small></> : formatMoney(item.cost)}</strong><button className="primary-button" disabled={item.owned || !item.available || game.cash < item.cost || purchase.isPending} onClick={() => purchase.mutate(item.key)}>{item.owned ? 'Installed' : !item.available ? 'Locked' : game.cash < item.cost ? 'Keep earning' : 'Purchase'}</button></div>
              {/* A connection's whole effect is the counsel board it opens, and
                  that board is on the map. Same hand-off the rivals tab already
                  makes, so owning one is something you can go and look at. */}
              {item.type === 'connection' && <button type="button" className="asset-locate" onClick={() => navigate(`/map?connection=${item.key}`)}>Show on the map</button>}
              {/* Decor is kept deliberately cosmetic: it is the one asset class
                  whose entire value is the office view, and the one that already
                  satisfied "look at the room and see what you bought" before any
                  of this work. What it lacked was a route to its own payoff --
                  you could buy a rug and never be sent to look at it. Same
                  hand-off the connections above make to the map. */}
              {item.type === 'cosmetic' && item.owned && <button type="button" className="asset-locate" onClick={() => navigate('/office')}>See it in the office</button>}
              {/* A stamp on the deed rather than a curtain over it. The old
                  confirmation covered the whole card for its whole life, so
                  the one thing it was confirming -- this item, now owned --
                  was the one thing you could not see. */}
              {justBought === item.key && <span className="asset-acquired" aria-hidden="true"><Check size={14} /> ACQUIRED</span>}
            </article>
          ))}
        </div>
        )}
      </div>
      {(purchase.error || advance.error || client.error || appearance.error) && <ErrorNotice error={purchase.error || advance.error || client.error || appearance.error} />}
    </div>
  )
}
