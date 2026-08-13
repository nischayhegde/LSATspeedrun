import { useCallback, useEffect, useRef, useState } from 'react'

import { PreflightStrip } from '../demo/preflight-strip'
import { setCoverUp } from '../scenes/cover-stage'
import { FOUNDERS, PORTRAIT_PX, UT_SEAL } from './founders'
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
 * ## What this card used to be, and why it was replaced rather than adjusted
 *
 * The founders' verdict was "incredibly corny and unprofessional", said twice
 * in one paragraph. That is a judgement about the concept, so the concept is
 * what changed.
 *
 * The old card was three costumes worn at once: letterpress (an engraved plate
 * with a double border and a hard drop shadow, a section mark set between two
 * hairlines), foil (a sheen sweeping across the button every four seconds, a
 * gold-embossed wordmark), and arcade (bevelled chips with baked-in highlight
 * and shadow insets, the product's pixel furniture). Over all of it sat
 * simulated film: animated grain, scanlines and a vignette. Every one of those
 * is ornament arguing that the thing is serious, and an investor reads a
 * student project arguing that it is serious as a student project.
 *
 * What replaced it is an editorial cover. One typographic statement, one rule,
 * one accent, and a great deal of deliberate space. The identity is carried by
 * colour and type — the app's navy, its beige, its display face — rather than
 * by simulated materials. There is nothing on this card that is here to look
 * like something; every element is a piece of information the room needs:
 * what the product is called, what it is, who is presenting, where they are
 * from, and how to begin.
 *
 * The one moving thing is the shutter that takes the card away. Motion is the
 * transition, not the decoration.
 *
 * ## The handoff is a curtain, not a route change
 *
 * The deck is already mounted and running *underneath* this card from the first
 * frame of the page. That is the whole performance story: by the time anyone
 * presses Start, the WebGL stage exists, its shaders are compiled, the title
 * slide's hero scene is constructed and rendering, and the neighbouring scenes
 * have been warmed. Start therefore has no work to do at all — it closes the
 * deck's own `letterbox` shutter over this card, drops the card inside the
 * black, and opens the shutter onto a scene that has been alive the entire
 * time. Nothing compiles, nothing decodes, nothing pops in.
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
    <span className="start-mark" aria-hidden="true">
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
  const showDiagnostics = import.meta.env.DEV
    && new URLSearchParams(window.location.search).has('hud')
  const shutter = useRef<HTMLDivElement | null>(null)
  const plate = useRef<HTMLDivElement | null>(null)
  /** Guards against a second Enter arriving mid-sweep. */
  const sweeping = useRef(false)

  /**
   * Tell the opening scene it is behind a cover, before that scene exists.
   *
   * The hero slide's mark assembles out of nine parts over 4.2 seconds, and
   * until now nobody had ever seen it: the scene is built the instant the page
   * loads, so the assembly always finished behind this card, and the shutter
   * opened on an object that had already put itself together. Holding it means
   * the deck's opening gesture plays when the presentation opens.
   *
   * Raised during render rather than in an effect, deliberately. `deck.tsx`
   * builds the stage in *its* effect, and effects run after the whole tree has
   * rendered, so a flag set here is already up when the scene is constructed
   * and there is no first frame to correct.
   *
   * Only for the card's first appearance. Brought back over a running deck with
   * `T`, the stage may be showing the office or the map and the hero's assembly
   * is long since over, so a returning card changes nothing behind it.
   */
  const claimedCover = useRef(false)
  const [holdsOpening] = useState(() => arrival === 'immediate' && !reduced)
  if (!claimedCover.current && holdsOpening) {
    claimedCover.current = true
    setCoverUp(true)
  }

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

    // Release the opening gesture as the bars start closing, so the mark is
    // already flying together while the shutter is shut. It takes 4.2 seconds
    // and the sweep takes 1.24, which leaves about three seconds of assembly
    // still to run when the black opens — the audience catches the object
    // building itself, rather than a static mark or the very first frame of a
    // motion that started on their cue.
    if (claimedCover.current) {
      claimedCover.current = false
      setCoverUp(false)
    }

    const host = shutter.current
    const bars = host ? Array.from(host.querySelectorAll('i')) : []

    if (!reduced && bars.length === 2) {
      const closing = bars.map((bar) => bar.animate(
        [{ height: '0vh' }, { height: '50.2vh' }],
        // The app's own easing for this exact furniture. Six discrete jumps read
        // as a shutter; a smooth interpolation reads as a UI animation.
        { duration: CLOSE, easing: 'steps(6, end)', fill: 'both' },
      ))
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

  // The flag is global and the scene obeys it, so it must not survive this
  // component under any exit — including an unmount that never went through
  // `sweep`, which is what a hot reload during development looks like.
  useEffect(() => () => {
    if (claimedCover.current) {
      claimedCover.current = false
      setCoverUp(false)
    }
  }, [])

  /**
   * Focus lands on the card itself, not on the button inside it.
   *
   * A modal has to take focus or a screen reader is left reading the deck
   * behind it, but focusing the button meant Chromium painted a focus ring on
   * the very first frame — programmatic focus counts as `:focus-visible` when
   * there has been no prior pointer interaction — and the first thing an
   * investor saw was a button that appeared to have a stray border. Nothing is
   * lost by focusing the container: Enter and Space are handled on `window` in
   * the capture phase below, so the keyboard path never depended on the button
   * holding focus, and Tab still reaches it and rings it properly.
   */
  useEffect(() => {
    if (plateShown) plate.current?.focus({ preventScroll: true })
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
        <div
          className="start-plate"
          ref={plate}
          tabIndex={-1}
        >
          {/* Head. The mark and what this document is, and nothing else: the
              product's name is the headline below and saying it twice is the
              kind of small redundancy that reads as unconsidered.

              It read `Investor presentation` and the founders struck it. Not for
              the tone — for the assumption. This deck is presented to investors,
              to a class, to a hiring manager and to a friend of a friend who
              might introduce you to one, and the first line of the first screen
              telling three of those four rooms that they are in the wrong one is
              a self-inflicted wound. Worse, it is a line the presenter cannot
              take back once it has been read.
              `Company presentation` says the same thing about the document
              without saying anything about who is watching it, which is the only
              honest thing a start card can know.

              The count stays. It is the one question a room has before a deck
              begins, it is the answer to "how long is this going to be", and it
              comes off `SLIDES.length` so it cannot drift. */}
          <header className="start-head">
            <Mark />
            <p className="start-kicker">Company presentation<i aria-hidden="true" />{slideCount} slides</p>
          </header>

          {/* The statement, and the way to act on it, as one object in the
              middle of the page. Name, then what it is, then begin — that is
              the order the room reads in, and keeping the button attached to
              the sentence it follows is what stops the card becoming a stack
              of unrelated horizontal rails. */}
          <div className="start-lede">
            <h1 className="start-h1">Lawyer Tycoon</h1>
            <p className="start-standfirst">The LSAT speedrun app.</p>
            <div className="start-actions">
              <button type="button" className="start-go" onClick={leave}>
                Start presentation
              </button>
              <p className="start-hint">
                <kbd>Enter</kbd> begins<i aria-hidden="true" /><kbd>F</kbd> fullscreen
              </p>
            </div>
          </div>

          {/* Foot. Everything the room needs to know about who is talking,
              set at the size of a byline because that is what it is. */}
          <footer className="start-foot">
            <ul className="start-founders">
              {FOUNDERS.map((founder) => (
                <li className="start-founder" key={founder.name}>
                  {/* Drawn at the size the file can honestly carry — see
                      `PORTRAIT_PX` in `founders.ts` for the arithmetic. Both
                      portraits take the same two numbers so they read as a
                      pair rather than as a large one and a small one. */}
                  <img
                    src={founder.photo}
                    alt={founder.name}
                    width={PORTRAIT_PX}
                    height={PORTRAIT_PX}
                    style={{ width: PORTRAIT_PX, height: PORTRAIT_PX }}
                    // Eager and high priority: this is the first screen of the
                    // presentation and a portrait that decodes a beat late is a
                    // pop-in on the one frame that gets a first impression.
                    // `width`/`height` are also set as attributes so the box is
                    // reserved before the bytes land and nothing shifts.
                    loading="eager"
                    fetchPriority="high"
                  />
                  <span>
                    <b>{founder.name}</b>
                    {founder.role}
                  </span>
                </li>
              ))}
            </ul>

            <p className="start-provenance">
              <img
                className="start-seal"
                src={UT_SEAL}
                alt=""
                aria-hidden="true"
                width={64}
                height={64}
                loading="eager"
                fetchPriority="high"
              />
              The University of Texas at Austin
            </p>
          </footer>

          {/* Preflight still runs on every load in `StartGate`; only its verbose
              diagnostic surface is opt-in. A failed local service used to place
              a large error panel over the founders, seal and start action—the
              audience-facing cover looked broken before the talk began. Open
              `?hud` during rehearsal to inspect the same checks without making
              them part of the presentation. */}
          {showDiagnostics ? (
            <div className="start-preflight">
              <PreflightStrip />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="start-shutter" ref={shutter} aria-hidden="true">
        <i />
        <i />
      </div>
    </div>
  )
}
