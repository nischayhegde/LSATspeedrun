import { useSyncExternalStore } from 'react'

import { describeSurface, runtimeVersion, subscribeRuntime } from '../demo/demo-runtime'
import { SECTION_LABELS, TOTAL_BUDGET_SECONDS } from '../slides'
import { spokenNotes } from '../slides/spoken-notes'
import type { SlideSpec } from '../slides/types'

/**
 * The presenter overlay, on `P`.
 *
 * Deliberately not a second window. A separate presenter display needs a second
 * screen configured correctly at the venue, and the one thing that is guaranteed
 * about a venue is that the display arrangement will be wrong. An overlay on the
 * same screen is worse in the ideal case and works in every case; the presenter
 * toggles it while the room looks at them rather than the slide, and `?notes` on
 * the URL opens the deck with it already up for a rehearsal.
 *
 * What it shows is the four things a presenter actually needs: this slide's notes,
 * what is next so there is no surprise, the clock, and whether they are ahead or
 * behind. The pacing figure compares elapsed time against the sum of the
 * `budgetSeconds` of every slide up to and including this one, which is a better
 * signal than a bare clock because it accounts for where in the deck they are.
 */

function clock(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

type Props = {
  slides: readonly SlideSpec[]
  index: number
  elapsed: number
  frameMs: number
  memory: { geometries: number; textures: number; cached: number }
  stills: boolean
  onClose: () => void
}

export function Presenter({ slides, index, elapsed, frameMs, memory, stills, onClose }: Props) {
  // Subscribed so the `showing` line follows the app's health rather than only
  // changing when the slide does: the origin can go down mid-slide.
  useSyncExternalStore(subscribeRuntime, runtimeVersion)
  const slide = slides[index]
  const upcoming = slides[index + 1]
  const surface = slide.demo ? describeSurface(slide.demo, stills) : null
  const budgetSoFar = slides
    .slice(0, index + 1)
    .reduce((sum, entry) => sum + (entry.budgetSeconds ?? 45), 0)
  const drift = elapsed - budgetSoFar
  const pace = drift > 20 ? 'behind' : drift < -20 ? 'ahead' : 'on pace'

  return (
    <aside className="presenter" aria-label="Presenter notes">
      <header>
        <span className="presenter-act">{SECTION_LABELS[slide.section]}</span>
        <span className="presenter-count">{index + 1} / {slides.length}</span>
        <button type="button" onClick={onClose} aria-label="Close presenter notes">esc</button>
      </header>

      <div className="presenter-clock">
        <b>{clock(elapsed)}</b>
        <small>
          budget {clock(budgetSoFar)} of {clock(TOTAL_BUDGET_SECONDS)} · <em className={`pace is-${pace.replace(' ', '-')}`}>{pace}</em>
          {drift ? ` (${drift > 0 ? '+' : '−'}${clock(Math.abs(drift))})` : null}
        </small>
        {/* One bar, two marks: where the talk is and where it was meant to be. */}
        <div className="presenter-bar">
          <i style={{ width: `${Math.min(100, (elapsed / TOTAL_BUDGET_SECONDS) * 100)}%` }} />
          <u style={{ left: `${Math.min(100, (budgetSoFar / TOTAL_BUDGET_SECONDS) * 100)}%` }} />
        </div>
      </div>

      <section className="presenter-notes">
        <h3>{slide.headline}</h3>
        <p>{spokenNotes(slide.notes)}</p>
        <dl>
          <dt>this slide</dt>
          <dd>{slide.budgetSeconds ?? 45}s · {slide.kind} · {slide.transition ?? 'cut'}</dd>
          {slide.scene ? (
            <>
              <dt>scene</dt>
              <dd>{slide.scene.id}{slide.scene.framing ? ` / ${slide.scene.framing}` : ''}</dd>
            </>
          ) : null}
          {slide.demo ? (
            <>
              <dt>demo</dt>
              <dd>
                {slide.demo.route}
                {slide.demo.annotations?.length ? ` · ${slide.demo.annotations.length} callouts (A)` : ''}
              </dd>
              {/* Live or a still, for this slide, right now. The lamp in the demo
                  chrome is presenter-only and off by default, so this is where
                  the presenter finds out whether the thing they are about to
                  narrate over can actually be clicked. This screen is the one
                  the audience is not looking at. */}
              <dt>showing</dt>
              <dd className={surface?.showStill ? 'is-warn' : 'is-on'}>
                {surface?.showStill ? `still · ${slide.demo.still}` : 'live app'}
                {surface ? ` · ${surface.label}` : ''}
              </dd>
            </>
          ) : null}
        </dl>
      </section>

      {upcoming ? (
        <section className="presenter-next">
          <span>next</span>
          <b>{upcoming.headline}</b>
          <small>{upcoming.kind} · {upcoming.transition ?? 'cut'}{upcoming.demo ? ' · live demo' : ''}</small>
        </section>
      ) : (
        <section className="presenter-next"><span>next</span><b>End of deck.</b></section>
      )}

      <footer>
        <code>{frameMs ? `${frameMs.toFixed(1)}ms · ${(1000 / frameMs).toFixed(0)}fps` : '—'}</code>
        <code>geo {memory.geometries} · tex {memory.textures} · scenes {memory.cached}</code>
        <code className={stills ? 'is-on' : ''}>stills {stills ? 'ON' : 'off'}</code>
      </footer>

      <ul className="presenter-keys">
        <li><kbd>→</kbd><kbd>space</kbd> next</li>
        <li><kbd>←</kbd> back</li>
        <li><kbd>G</kbd> grid</li>
        <li><kbd>P</kbd> these notes</li>
        <li><kbd>Q</kbd> Q&amp;A panel</li>
        <li><kbd>A</kbd> next callout</li>
        <li><kbd>S</kbd> force stills</li>
        <li><kbd>F</kbd> fullscreen</li>
        <li><kbd>R</kbd> reset clock</li>
      </ul>
    </aside>
  )
}
