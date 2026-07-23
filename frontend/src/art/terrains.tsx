/* Empire-map biomes: one painted panorama per section plus animated weather —
   drifting cloud shadows, sun shimmer on water, aurora sweep, twinkling stars. */

import { terrainArt, type TerrainSection } from './assets'

export type { TerrainSection }

export function TerrainArt({ section }: { section: TerrainSection }) {
  return (
    <div className={`av-terrain-scene av-tsc-${section}`} aria-hidden="true">
      <div className="av-layer av-layer-far">
        <img className="av-terrain-img" src={terrainArt(section)} alt="" draggable={false} />
      </div>
      {(section === 'city' || section === 'nation' || section === 'continent') && (
        <div className="av-ov-clouds"><i className="c1" /><i className="c2" /><i className="c3" /></div>
      )}
      {section === 'world' && <div className="av-ov-shimmer" />}
      {section === 'continent' && <div className="av-ov-aurora" />}
      {section === 'space' && (
        <div className="av-ov-stars">
          {Array.from({ length: 40 }, (_, i) => (
            <i
              key={i}
              className={`tw tw-${i % 3}`}
              style={{ left: `${(i * 41) % 100}%`, top: `${(i * 17) % 96}%` }}
            />
          ))}
          <i className="av-shooting-star" />
        </div>
      )}
      <div className="av-terrain-grade" />
    </div>
  )
}
