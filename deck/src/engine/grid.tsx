import { SECTION_LABELS } from '../slides'
import type { SlideSpec } from '../slides/types'

/**
 * The `G` overview: the whole deck as a grid, click to jump.
 *
 * ## Why the thumbnails are drawn rather than captured
 *
 * The obvious implementation is a live scaled clone of each slide, or a captured
 * bitmap of each. Both are wrong here. A live clone means twenty-three slides
 * mounted at once, which for this deck means twenty-three WebGL scenes and five
 * app iframes — an instant crash. A captured bitmap means a capture pass, which
 * means either shipping screenshots that go stale the moment the copy changes, or
 * rendering every slide at boot.
 *
 * So each tile is a small designed representation of its slide: the act's colour,
 * the slide number, the headline, and a mark for what is on it — a scene, a live
 * demo, or copy alone. That is genuinely more useful mid-talk than a 160px
 * screenshot of a dark 3D scene would be, which is the honest reason as well as
 * the cheap one.
 */

const SECTION_ORDER: SlideSpec['section'][] = ['title', 'problem', 'thesis', 'product', 'game', 'close']

type Props = {
  slides: readonly SlideSpec[]
  index: number
  onPick: (index: number) => void
  onClose: () => void
}

export function GridOverview({ slides, index, onPick, onClose }: Props) {
  const grouped = SECTION_ORDER
    .map((section) => ({
      section,
      entries: slides
        .map((slide, position) => ({ slide, position }))
        .filter((entry) => entry.slide.section === section),
    }))
    .filter((group) => group.entries.length > 0)

  return (
    <div className="grid-overview" role="dialog" aria-label="Slide overview">
      <header>
        <b>Lawyer Tycoon</b>
        <span>{slides.length} slides</span>
        <button type="button" onClick={onClose}>close <kbd>G</kbd></button>
      </header>

      <div className="grid-scroll">
        {grouped.map((group) => (
          <section key={group.section} data-section={group.section}>
            <h2>{SECTION_LABELS[group.section]}</h2>
            <div className="grid-tiles">
              {group.entries.map(({ slide, position }) => (
                <button
                  type="button"
                  key={slide.id}
                  className={`grid-tile${position === index ? ' is-current' : ''}`}
                  data-section={slide.section}
                  onClick={() => { onPick(position); onClose() }}
                >
                  <i>{String(position + 1).padStart(2, '0')}</i>
                  <strong>{slide.headline}</strong>
                  <em>
                    {slide.demo ? 'live demo' : slide.scene && slide.scene.id !== 'none' ? slide.scene.id : slide.kind}
                  </em>
                  <span className="grid-tile-hash">#/{slide.id}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
