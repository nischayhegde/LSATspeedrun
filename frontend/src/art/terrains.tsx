/* Empire-map biomes: one painted panorama per section plus animated weather —
   drifting cloud shadows, sun shimmer on water, aurora sweep, twinkling stars. */

import { terrainArt, type TerrainSection } from './assets'

export type { TerrainSection }

export function TerrainArt({ section, activity = 1 }: { section: TerrainSection; activity?: number }) {
  const activityClass = `activity-${Math.max(1, Math.min(5, Math.round(activity)))}`
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
      <div className={`av-map-life av-map-life-${section} ${activityClass}`}>
        {section === 'city' && (
          <>
            <div className="av-transit-corridor av-city-corridor"><i /><i /></div>
            <div className="av-city-tram"><i /><i /><i /></div>
            <div className="av-crosswalk-flow"><i /><i /><i /><i /></div>
            <div className="av-city-river-traffic"><i><b /></i><i><b /></i></div>
          </>
        )}
        {section === 'nation' && (
          <>
            <div className="av-transit-corridor av-national-corridor"><i /><i /></div>
            <div className="av-national-train"><i /><i /><i /><i /></div>
            <div className="av-map-flight"><i /></div>
          </>
        )}
        {section === 'world' && (
          <>
            <div className="av-sea-lane lane-one"><i /></div>
            <div className="av-sea-lane lane-two"><i /></div>
            <div className="av-trade-ship ship-one"><i /><b /></div>
            <div className="av-trade-ship ship-two"><i /><b /></div>
          </>
        )}
        {section === 'continent' && (
          <>
            <div className="av-transit-corridor av-continental-corridor"><i /><i /></div>
            <div className="av-continental-express"><i /><i /><i /></div>
            <div className="av-map-flight continental-flight"><i /></div>
          </>
        )}
        {section === 'space' && (
          <>
            <div className="av-orbit-ring ring-one"><i /></div>
            <div className="av-orbit-ring ring-two"><i /></div>
            <div className="av-orbit-shuttle"><i /><b /></div>
            <div className="av-satellite-sweep"><i /><i /><i /></div>
          </>
        )}
      </div>
      <div className="av-terrain-grade" />
    </div>
  )
}
