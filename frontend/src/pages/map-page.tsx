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
  return (
    <div className="map-page empire-game-page">
      {/* No page header above the map: the title and the standing blurb cost a
          band of the viewport that the world itself is better spent on. The
          rival holding count they carried is now a quiet overlay inside the
          map frame. */}
      {/* `?rival=` lets the firm tab's "Show on the map" hand a specific target
          across, so the two surfaces stay one conversation. Empire value travels
          down as a prop rather than being shown in a second box up here, since
          the map's own headquarters panel is where the rest of the firm's vitals
          already live. */}
      <EmpireWorldMap
        game={game}
        focusRival={searchParams.get('rival')}
        focusConnection={searchParams.get('connection')}
        focusDistrict={searchParams.get('district')}
        onManage={(tab, district) => navigate(`/firm?tab=${tab}${district ? `&district=${district}` : ''}`)}
        empireValueLabel={formatMoney(game.firm_valuation, true)}
      />
    </div>
  )
}
