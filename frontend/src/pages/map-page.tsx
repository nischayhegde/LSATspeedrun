import { useNavigate, useSearchParams } from 'react-router-dom'

import { formatMoney, LoadingScreen } from '../components'
import { EmpireWorldMap } from '../game-art'
import { useGame } from './shared'


export function ProgressionMapPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const gameQuery = useGame()
  if (gameQuery.isLoading) return <LoadingScreen />
  const game = gameQuery.data!.game!
  const heldRivals = game.catalog.assets.filter((asset) => asset.type === 'rival' && asset.owned).length
  const totalRivals = game.catalog.assets.filter((asset) => asset.type === 'rival').length
  return (
    <div className="map-page empire-game-page">
      <section className="empire-command-bar">
        <span className="pixel-kicker">CONTESTED TERRITORY · {heldRivals} OF {totalRivals} RIVAL FIRMS HELD</span>
        <h1>Your legal empire</h1>
        <p>Every rival practice sits at a real address. Move against one from the world itself, then absorb it when its price has fallen far enough.</p>
      </section>
      {/* `?rival=` lets the firm tab's "Show on the map" hand a specific target
          across, so the two surfaces stay one conversation. Empire value travels
          down as a prop rather than being shown in a second box up here, since
          the map's own headquarters panel is where the rest of the firm's vitals
          already live. */}
      <EmpireWorldMap
        game={game}
        focusRival={searchParams.get('rival')}
        onManage={(tab) => navigate(`/firm?tab=${tab}`)}
        empireValueLabel={formatMoney(game.firm_valuation, true)}
      />
    </div>
  )
}
