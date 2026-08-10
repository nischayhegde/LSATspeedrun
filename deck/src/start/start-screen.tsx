import { useCallback, useEffect, useRef, useState } from 'react'

import { PreflightStrip } from '../demo/preflight-strip'
import { FOUNDERS, UT_SEAL } from './founders'
import './start.css'

/**
 * The start card: what the room looks at before the talk begins.
 *
 * ## Why there is one at all
 *
 * A deck that opens on slide 1 opens mid-sentence. The founders' original PDF
 * had a title slide carrying three things this deck's own title slide
 * deliberately does not — the University of Texas seal and the two of them — and
 * those are exactly the material that belongs before the argument rather than
 * inside it: credentials and faces, shown once, then never again.
 *
 * ## The handoff is a curtain, not a route change
 *
 * The deck is already mounted and running *underneath* this card from the first
 * frame of the page. That is the whole performance story: by the time anyone
 * presses Start, the WebGL stage exists, its shaders are compiled, the title
 * slide's hero scene is constructed and rendering, the two Google faces have
 * loaded, and the neighbouring scenes have been warmed. Start therefore has no
 * work to do at all — it closes the deck's own `letterbox` shutter over this
 * card, drops the card inside the black, and opens the shutter onto a scene that
 * has been alive the entire time. Nothing compiles, nothing decodes, nothing
 * pops in.
 *
 * This is also why the card is opaque and at z-index 2000 rather than being
 * mounted instead of the deck: it has to hide a deck that is already there.
 *
 * ## Keyboard
 *
 * While the card is up it swallows every key in the capture phase, because the
 * deck's own `window` keydown listener is live underneath and would otherwise
 * page through slides nobody can see. Enter, Space and Escape are handled here;
 * Tab is let through so the button can be reached the ordinary way.
 */

type Props = {
  /** Called once the shutter has finished opening on the deck. */
  onEnter: () => void
  /**
   * `curtain` when the card is being brought *back* over a running deck, which
   * is the `T` key. The sweep then runs in reverse: shutter closed, card placed
   * in the black, shutter opened onto the card.
   */
  arrival: 'immediate' | 'curtain'
  reduced: boolean
  slideCount: number
}

/** Matches `TRANSITION_MS.letterbox` and its 34 / 16 / 50 split. */
const TOTAL = 1240
const CLOSE = Math.round(TOTAL * 0.34)
const HOLD = Math.round(TOTAL * 0.16)
const OPEN = TOTAL - CLOSE - HOLD

const wait = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms) })

/** The product's mark, the same path the demo frame's title bar uses. */
function Mark() {
  return (
    <span className="start-mark bevel" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path
          d="M7 20h10v2H7z M10 18h4v2h-4z M11 7h2v11h-2z M10 3h4v3h-4z M3 6h18v2H3z M4 8h1v3H4z M19 8h1v3h-1z M1 11h7l-1.75 3.25h-3.5z M16 11h7l-1.75 3.25h-3.5z"
          fill="currentColor"
        />
      </svg>
    </span>
  )
}

export function StartScreen({ onEnter, arrival, reduced, slideCount }: Props) {
  const [plateShown, setPlateShown] = useState(arrival === 'immediate' || reduced)
  const shutter = useRef<HTMLDivElement | null>(null)
  const button = useRef<HTMLButtonElement | null>(null)
  /** Guards against a second Enter arriving mid-sweep. */
  const sweeping = useRef(false)

  /**
   * Close the shutter, swap what is behind it, open the shutter.
   *
   * `fill: 'both'` on every animation for the same reason `transitions.ts` needs
   * it: a finished animation without a fill snaps the bar back to its stylesheet
   * height of zero, which would tear the black open a frame early.
   */
  const sweep = useCallback(async (showPlateAfter: boolean) => {
    if (sweeping.current) return
    sweeping.current = true
    const host = shutter.current
    const bars = host ? Array.from(host.querySelectorAll('i')) : []
    const wordmark = host?.querySelector('b')

    if (!reduced && bars.length === 2) {
      const closing = bars.map((bar) => bar.animate(
        [{ height: '0vh' }, { height: '50.2vh' }],
        // The app's own easing for this exact furniture. Six discrete jumps read
        // as a shutter; a smooth interpolation reads as a UI animation.
        { duration: CLOSE, easing: 'steps(6, end)', fill: 'both' },
      ))
      wordmark?.animate(
        [
          { opacity: 0, letterSpacing: '.5em' },
          { opacity: 1, letterSpacing: '.28em', offset: .55 },
          { opacity: 1, letterSpacing: '.26em', offset: .8 },
          { opacity: 0, letterSpacing: '.24em' },
        ],
        { duration: CLOSE + HOLD + OPEN * .4, easing: 'linear', fill: 'both' },
      )
      await Promise.all(closing.map((animation) => animation.finished)).catch(() => undefined)

      setPlateShown(showPlateAfter)
      // One frame inside the black before the bars start back, so the swap is
      // committed to the screen and not to the same paint as the opening.
      await wait(HOLD)

      const opening = bars.map((bar) => bar.animate(
        [{ height: '50.2vh' }, { height: '0vh' }],
        { duration: OPEN, easing: 'steps(7, end)', fill: 'both' },
      ))
      await Promise.all(opening.map((animation) => animation.finished)).catch(() => undefined)
    } else {
      setPlateShown(showPlateAfter)
    }

    sweeping.current = false
    if (!showPlateAfter) onEnter()
  }, [onEnter, reduced])

  const leave = useCallback(() => { void sweep(false) }, [sweep])

  // Bringing the card back over a running deck.
  useEffect(() => {
    if (arrival === 'curtain' && !reduced) void sweep(true)
    // Runs once, on mount, for the arrival it was mounted with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The button is the only focusable thing on the card, and it is focused so
  // that the presenter's very first keystroke lands somewhere sensible whether
  // or not they have clicked into the window yet.
  useEffect(() => {
    if (plateShown) button.current?.focus({ preventScroll: true })
  }, [plateShown])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Tab is the one key the card does not own: the button has to be
      // reachable, and a trapped Tab in a one-control dialog is worse than none.
      if (event.key === 'Tab') return
      // Everything else is swallowed before the deck's own listener, which is
      // live on `window` underneath this card.
      event.stopPropagation()
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault()
        if (plateShown) leave()
        return
      }
      // Escape only means anything when the card was brought back deliberately;
      // on first load there is nothing behind it to go back to.
      if (event.key === 'Escape' && arrival === 'curtain' && plateShown) {
        event.preventDefault()
        leave()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [arrival, leave, plateShown])

  return (
    <div className="start" role="dialog" aria-modal="true" aria-label="Lawyer Tycoon — start the presentation">
      {plateShown ? (
        <div className="start-plate">
          <div className="start-rail">
            <span><Mark /><b className="start-wordmark">Lawyer Tycoon</b></span>
            <span>Investor presentation · {slideCount} slides</span>
          </div>

          <div className="start-stage">
            <div className="start-title">
              <p className="start-eyebrow">LSAT prep, reimagined</p>
              <h1 className="start-h1 foil">Lawyer<br />Tycoon</h1>
              <p className="start-standfirst">The LSAT speedrun app.</p>

              <div className="start-divider" aria-hidden="true"><i /><b>§</b><i /></div>

              <ul className="start-method">
                <li>Diagnose</li>
                <li aria-hidden="true"><i>·</i></li>
                <li>Practice</li>
                <li aria-hidden="true"><i>·</i></li>
                <li>Progress</li>
              </ul>

              <p className="start-pull">“One measured learning loop. No busywork.”</p>

              <div className="start-actions">
                <button
                  type="button"
                  ref={button}
                  className="start-go bevel"
                  onClick={leave}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 4l13 8-13 8z" /></svg>
                  Start slideshow
                </button>
                <p className="start-hint">
                  <kbd>Enter</kbd> or <kbd>Space</kbd> to begin
                  <i aria-hidden="true">·</i>
                  <kbd>T</kbd> returns here
                  <i aria-hidden="true">·</i>
                  <kbd>F</kbd> fullscreen
                </p>
              </div>
            </div>

            <aside className="start-card engraved">
              <img className="start-seal" src={UT_SEAL} alt="The University of Texas at Austin seal" />
              <p className="start-provenance">
                Built at UT Austin
                <small>Student-built · Evidence-first</small>
              </p>
              <hr className="start-card-rule" />
              <p className="start-card-label">Co-founders</p>
              <ul className="start-founders">
                {FOUNDERS.map((founder) => (
                  <li className="start-founder" key={founder.name}>
                    <img src={founder.plate} alt={founder.name} width={512} height={512} />
                    <b>{founder.name}</b>
                    <span>{founder.role}</span>
                  </li>
                ))}
              </ul>
            </aside>
          </div>

          {/* The demo preflight. On the start card because this is the screen
              that is up while the laptop is still being plugged in, and because
              running it is also what resolves the live case session id that the
              demo slides point at. See `demo/preflight-strip.tsx`. */}
          <div className="start-rail">
            <span>The University of Texas at Austin</span>
            <PreflightStrip />
          </div>

          <div className="start-grain" aria-hidden="true" />
          <div className="start-scanlines" aria-hidden="true" />
          <div className="start-vignette" aria-hidden="true" />
        </div>
      ) : null}

      <div className="start-shutter" ref={shutter} aria-hidden="true">
        <i />
        <i />
        <b className="foil">Lawyer Tycoon</b>
      </div>
    </div>
  )
}
