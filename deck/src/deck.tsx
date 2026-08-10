import { useEffect, useRef, useState } from 'react'

import { DemoStage } from './demo/demo-stage'
import { GridOverview } from './engine/grid'
import { Presenter } from './engine/presenter'
import { useDeck } from './engine/use-deck'
import { QaPanel } from './notes'
import { AppSceneLayer } from './scenes/app-scene-layer'
import { registerScenes } from './scenes/registry'
import { DeckStage } from './scenes/stage'
import { SECTION_LABELS, SLIDES } from './slides'
import { SlideBody } from './slides/layouts'

/**
 * The deck.
 *
 * Six layers, bottom to top, and the z-order is the whole architecture:
 *
 *   1. the shared WebGL stage — one canvas, one renderer, every deck-native scene
 *   2. the app-scene layer — the ported office and map, each with its own context
 *   3. two slide layers — the outgoing and incoming copy, both live in a transition
 *   4. the transition overlay — letterbox bars, the foil seal, the ink wash
 *   5. the film layers — vignette, grain, scanlines, over everything including the
 *      demo iframes, which is what makes a live app embed and a procedural scene
 *      look like they were shot on the same stock
 *   6. presenter furniture — the notes overlay, the grid, the HUD
 */

function useStage(reduced: boolean) {
  const [stage, setStage] = useState<DeckStage | null>(null)
  useEffect(() => {
    const made = new DeckStage({ reduced })
    registerScenes(made)
    setStage(made)
    return () => made.dispose()
    // Built exactly once. The renderer must outlive every re-render, and the
    // deck is not rendered under StrictMode for this reason — see `main.tsx`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return stage
}

export function Deck() {
  const reduced = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches).current
  const stage = useStage(reduced)
  const deck = useDeck(SLIDES, stage)
  const stageHost = useRef<HTMLDivElement | null>(null)
  const [telemetry, setTelemetry] = useState({ frameMs: 0, geometries: 0, textures: 0, cached: 0 })

  // The stage's canvas is created by the stage, not by React, because React must
  // never be in a position to replace it.
  useEffect(() => {
    const host = stageHost.current
    if (!stage || !host) return
    host.append(stage.canvas)
    return () => stage.canvas.remove()
  }, [stage])

  // Telemetry is polled rather than pushed. The stage runs at 60fps and a state
  // update per frame would put React's commit on the frame budget it is measuring.
  useEffect(() => {
    if (!stage || (!deck.presenterOpen && !deck.hudOpen)) return
    const poll = window.setInterval(() => {
      const memory = stage.memory
      setTelemetry({
        frameMs: stage.frameMs,
        geometries: memory.geometries,
        textures: memory.textures,
        cached: memory.cached,
      })
    }, 500)
    return () => window.clearInterval(poll)
  }, [deck.hudOpen, deck.presenterOpen, stage])

  const renderLayer = (key: 'a' | 'b') => {
    const slideIndex = deck.layers[key]
    if (slideIndex === null) return null
    const slide = SLIDES[slideIndex]
    const live = deck.layers.live === key
    return (
      <div
        className={`deck-layer${live ? ' is-live' : ''}`}
        data-act-label={SECTION_LABELS[slide.section]}
        data-kind={slide.kind}
        data-section={slide.section}
        // The deck inverts between a royal blue field and a beige one as a
        // rhetorical device — slide 3 → 4 is the hard one, and the narrative
        // wants it to feel like a light coming on. `scene` paints nothing at
        // all, so a slide whose subject is the 3D stage stays transparent.
        data-field={slide.field ?? 'scene'}
        ref={(element) => deck.registerLayer(key, element)}
        // The layer that is leaving must not swallow a click aimed at the one
        // arriving, and an iframe inside it must not keep loading.
        style={live ? undefined : { pointerEvents: 'none' }}
        aria-hidden={!live}
      >
        <SlideBody
          slide={slide}
          stills={deck.stills}
          annotations={deck.annotations}
          active={live}
          reduced={reduced}
        />
      </div>
    )
  }

  return (
    <div className="deck" data-moving={deck.moving ? '' : undefined}>
      <div className="deck-stage" ref={stageHost} aria-hidden="true" />

      <AppSceneLayer slots={deck.appScenes} />

      <div className="deck-layers">
        {renderLayer('a')}
        {renderLayer('b')}
      </div>

      {/* The one live embed of the product, hoisted out of the slide layers so
          that a run of consecutive demo slides is one uninterrupted session of
          the app rather than a fresh load per slide. It positions itself over
          whichever demo slide's screen slot is live; the chrome around that slot
          stays in the slide, where the narrative's layout owns it. See
          `demo/demo-stage.tsx`. */}
      <DemoStage
        slides={SLIDES}
        index={deck.index}
        stills={deck.stills}
        annotations={deck.annotations}
        moving={deck.moving}
      />

      {/* Transition furniture is appended here imperatively by the transition in
          flight and removed when it settles, so nothing accumulates. */}
      <div className="deck-overlay" ref={deck.overlayRef} aria-hidden="true" />

      {/* Click zones, narrow and at the very edges only. Anything wider would
          steal clicks from the live demo iframes, which the presenter needs to be
          able to drive with a mouse. */}
      <button type="button" className="zone zone-prev" onClick={deck.previous} aria-label="Previous slide" />
      <button type="button" className="zone zone-next" onClick={deck.next} aria-label="Next slide" />

      {/* The progress indicator: a hairline with one tick per slide and a heavier
          tick at each act boundary. The only permanent chrome on the audience's
          screen. */}
      <nav className="deck-progress" aria-label="Deck progress">
        {SLIDES.map((slide, position) => (
          <i
            key={slide.id}
            data-section={slide.section}
            className={
              (position === deck.index ? 'is-current ' : '')
              + (position < deck.index ? 'is-past ' : '')
              + (position > 0 && SLIDES[position - 1].section !== slide.section ? 'is-act' : '')
            }
          />
        ))}
      </nav>

      <div className="deck-grain" aria-hidden="true" />
      <div className="deck-scanlines" aria-hidden="true" />
      <div className="deck-vignette" aria-hidden="true" />

      {deck.hudOpen && !deck.presenterOpen ? (
        <div className="deck-hud" aria-hidden="true">
          <span>{deck.index + 1}/{SLIDES.length}</span>
          <span>{SLIDES[deck.index].id}</span>
          <span>{telemetry.frameMs ? `${(1000 / telemetry.frameMs).toFixed(0)}fps` : '—'}</span>
          <span>geo {telemetry.geometries}</span>
          <span>tex {telemetry.textures}</span>
          {deck.stills ? <span className="is-warn">STILLS</span> : null}
        </div>
      ) : null}

      {deck.presenterOpen ? (
        <Presenter
          slides={SLIDES}
          index={deck.index}
          elapsed={deck.elapsed}
          frameMs={telemetry.frameMs}
          memory={telemetry}
          stills={deck.stills}
          onClose={deck.togglePresenter}
        />
      ) : null}

      {deck.qaOpen ? <QaPanel onClose={deck.toggleQa} /> : null}

      {deck.gridOpen ? (
        <GridOverview
          slides={SLIDES}
          index={deck.index}
          onPick={(target) => deck.goto(target)}
          onClose={deck.toggleGrid}
        />
      ) : null}
    </div>
  )
}
