/**
 * The slide data contract.
 *
 * Copy is deliberately separated from layout: every string a presenter reads or
 * an audience sees lives in `slides/index.ts` and nothing in `engine/`,
 * `scenes/` or `layouts.tsx` may hard-code a headline. That is what lets the
 * narrative be rewritten — see `deck/NARRATIVE.md` — without touching the
 * engine, and it is why `SlideSpec` carries `notes` and `budgetSeconds` rather
 * than the presenter overlay reaching into a second source of truth.
 */

import type { FigureSpec } from '../figures/types'

export type { FigureSpec }

/** Act boundaries. A change of act is what earns the letterbox transition. */
export type DeckSection = 'title' | 'problem' | 'thesis' | 'product' | 'game' | 'close'

/**
 * Which body layout renders the slide. `kind` decides composition only — every
 * kind reads the same fields off the spec, so a slide can be re-laid-out by
 * changing one word.
 */
export type SlideKind =
  /** Full-bleed scene with an oversized centred title. */
  | 'title'
  /** Headline plus a deck of numbered points, scene behind. */
  | 'statement'
  /** A spiky point-of-view: claim in large type, evidence beneath. */
  | 'pov'
  /** A framed live demo of the running app, with annotations. */
  | 'demo'
  /** Scene is the subject; copy is a small caption plate in a corner. */
  | 'scene'
  /** Two-up comparison — before/after, us/them. */
  | 'split'
  /** The metric wall. Points render as an instrument panel rather than a list. */
  | 'metrics'
  /**
   * Figure-led: the graphic is the argument and the copy frames it.
   *
   * Most of `NARRATIVE.md`'s visual directions are a piece of information design
   * rather than a scene — "two bars, nothing else", four tiles that re-sort,
   * three effect sizes where the last two land at nearly the same length. Those
   * slides set their headline and one sub-line, hand the rest of the frame to a
   * `FigureSpec`, and render their fragment line as fragments rather than as a
   * numbered ledger, because a ledger implies an order the argument does not have.
   */
  | 'figure'

/** Named 3D scenes the deck can show. Bound to slides, not to layouts. */
export type SceneId =
  | 'hero'
  | 'cast'
  /** The close: a bare royal-blue room with the app's own counsel in it. */
  | 'close-room'
  | 'office'
  | 'office-transform'
  | 'map'
  | 'tiers'
  | 'metrics'
  | 'none'

/**
 * A camera framing within a scene.
 *
 * Two consecutive slides naming the same `SceneId` with different framings get
 * a continuous camera move instead of a cut, which is how the office → map
 * sequence flies out through the window. The names a scene understands are its
 * own; an unknown framing is ignored and the camera holds.
 */
export type SceneFraming = string

export type SceneBinding = {
  id: SceneId
  framing?: SceneFraming
  /**
   * Free parameters handed to the scene on show. The office scene reads
   * `tier` and `full`; the map scene reads `region`.
   */
  params?: Record<string, string | number | boolean>
}

/** How this slide arrives from the one before it. */
export type TransitionKind =
  /** GLSL dissolve through a noise field: the paper/ink-bleed idiom. */
  | 'ink-bleed'
  /** The app's `.cutscene-overlay` letterbox, `steps()` easing, #05080d bars. */
  | 'letterbox'
  /** One shared scene, camera flies between framings. No blend at all. */
  | 'camera'
  /** Headline glyphs transformed individually; Fraunces weight interpolation. */
  | 'type'
  /** The scales-of-justice seal as an animated gold-foil mask. */
  | 'foil-seal'
  /** The floor: a short push-dissolve, for beats that should not announce themselves. */
  | 'cut'

export type DemoAnnotation = {
  /** Percentage of the framed viewport, so a callout survives a zoom change. */
  x: number
  y: number
  label: string
  /** Which side the leader line leaves from. */
  from?: 'left' | 'right'
}

/**
 * One beat of a demo's click path, with the seconds it is allowed to take.
 *
 * The founders' own diagnosis of the previous deck is that the demo sprawled, so
 * the narrative budgets every beat to the second. Holding those numbers as data
 * rather than as prose is what lets the presenter overlay show the presenter that
 * they are eleven seconds into a seven-second beat while it is still fixable.
 */
export type DemoStep = {
  /** Seconds from the start of this slide. */
  start: number
  /** Seconds from the start of this slide. */
  end: number
  /** One action, imperative, verbatim from `NARRATIVE.md`. */
  action: string
}

/**
 * A second state one demo slide can be put into on stage, and the key that does
 * it.
 *
 * Exists for `demo-office-transformation`, which is scripted as a *toggle* —
 * a rundown tier-0 office becoming a fully built tier-14 one while the presenter
 * says nothing — and which had no mechanism to perform that script. A `DemoSpec`
 * carries one `route` and one `still`, so the slide could only ever show the
 * "before": the entire before/after, which is the whole point of the slide, was
 * unreachable.
 *
 * ## Why a second route on the spec rather than a scene
 *
 * `scenes/registry.ts` declares an `office-transform` scene that no slide asks
 * for, and animating the deck's own 3D art would be the richer effect. It would
 * also be a different claim. Every other demo slide in this act frames the real
 * running product, and this slide's line — *every object in this room was bought
 * with LSAT questions* — is a claim about the app's own save state. A deck-side
 * recreation of the room is a video of software rather than the software, which
 * is the trade `demo-frame.tsx` argues against at length. So the toggle stays in
 * the demo layer and points at the app's two real tier overrides.
 *
 * ## Both halves have a still, and that is the requirement, not a nicety
 *
 * The base `still` stands in for `route` and this `still` stands in for this
 * `route`, so the before/after survives the stack dying — which is the one state
 * in which the slide most needs to work, and the state in which it previously
 * degraded to showing tier 0 twice. `?stills=1` is a supported way to present
 * this slide, not merely a fallback from it.
 */
export type DemoToggle = {
  /** Route on the app origin for the toggled-to state. Same substitutions as `route`. */
  route: string
  /** Still under `public/stills/` for the toggled-to state. */
  still: string
  /**
   * The key the presenter presses, matched case-insensitively and without
   * modifiers. Data rather than a constant so the click path, the staging note
   * and the presenter overlay all name the same key as the handler binds, and a
   * collision with the deck's own keymap is one edit to fix.
   *
   * Collisions are real and they are silent. The first key tried here was `T`,
   * which `start/use-start-gate.ts` already binds in the *capture* phase with a
   * `stopPropagation()` to bring the start card back — so it won every time and
   * nothing downstream ever saw the key. Keys already spoken for, across
   * `engine/use-deck.ts`, `start/`, and `demo/demo-stage.tsx`: the arrows, space,
   * page up/down, enter, backspace, home, end, escape, and
   * `A` `F` `G` `L` `P` `Q` `R` `S` `T`. `scripts/verify-office-toggle.mjs`
   * checks this key against that list rather than trusting it.
   */
  key: string
  /** Names the toggled-to state for the presenter overlay. Never on the audience screen. */
  label: string
}

export type DemoSpec = {
  /**
   * Route on the app origin, e.g. `/progress`. `{session}` is substituted with
   * `demoConfig.liveSessionId` at render time so the registry never holds an id
   * that goes stale the moment the database is reseeded.
   */
  route: string
  /** Still under `public/stills/` used when the app is unreachable or `?stills=1`. */
  still: string
  /**
   * A second state this demo can be toggled into, live or as a still. Absent on
   * every slide but one; see `DemoToggle`.
   */
  toggle?: DemoToggle
  /**
   * The app renders at `width / zoom` CSS pixels and is then scaled to fit, so
   * a dashboard can be authored at desktop width and still be legible from the
   * back of a room. 1 is native.
   */
  zoom?: number
  /** Logical width the app is given before scaling. Defaults to 1440. */
  width?: number
  caption?: string
  /**
   * Never embed the live app for this slide — always paint `still`, even when
   * the origin is healthy. Distinct from the deck-wide `?stills=1` override,
   * which is a fallback for when something is broken: this is an editorial
   * decision that a beat is not worth live time, and it should survive a
   * perfectly working app. The budget bar and click path still render, because
   * the presenter is still talking to a picture on a clock.
   */
  stillOnly?: boolean
  /** Revealed one at a time with `A`, so the presenter can point without narrating. */
  annotations?: DemoAnnotation[]
  /**
   * The hard second budget for the whole demo. Required, and deliberately not
   * optional: a demo slide without a stated ceiling is the failure mode this
   * field exists to prevent. It is rendered on the audience screen as the budget
   * bar and should be shown to the presenter as the loudest thing on the overlay.
   */
  budgetSeconds: number
  /** Which pre-staged browser context this demo starts in, e.g. `Context A`. */
  context?: string
  /** The numbered click path, in order. */
  clickPath?: DemoStep[]
  /** What the presenter must not touch, however tempting. */
  skip?: string[]
  /**
   * Slide id this demo continues from without a fresh load of the app. The deck
   * gives every slide its own iframe, so a demo marked here cannot be reached by
   * advancing the slide and expecting the app's state to survive — see `staging`.
   */
  continuesFrom?: string
  /** Staging the click path alone does not convey. */
  staging?: string
}

/** Who speaks a slide. The narrative assigns every slide to exactly one. */
export type Speaker = 'Alan' | 'Nischay'

/**
 * Which way round the slide is painted.
 *
 * The deck's two colours are load-bearing rather than decorative: the act break
 * at slide 4 is a full inversion from a royal blue field to a beige one, and the
 * narrative asks for it to read as a light coming on. `scene` paints no field at
 * all and lets the 3D stage through, which is what a slide whose subject is the
 * scene needs — anything else would tile an opaque rectangle over the render.
 */
export type SlideField = 'blue' | 'beige' | 'scene'

export type SlideSpec = {
  /** Stable slug. Deep-linked as `#/<id>`, so changing one breaks a bookmark. */
  id: string
  section: DeckSection
  kind: SlideKind
  /** The eyebrow above the headline — act label, POV number, section name. */
  eyebrow?: string
  headline: string
  /** One or two lines under the headline. Kept short by the layout, not by hope. */
  deck?: string
  /** Body points. `metrics` renders these as an instrument panel. */
  points?: string[]
  /** A single quotable line, set large. Used by `pov` and `close`. */
  pull?: string
  /** Attribution for `pull`, e.g. a cited study. */
  attribution?: string
  /**
   * The hairline source credit, set small in a corner of the audience screen.
   *
   * Separate from `attribution`, which belongs to `pull` and is set with it. A
   * credit belongs to the slide: it is the line that lets a researcher in the
   * room find the report, and the deck's position is that volunteering the
   * caveat in the design is worth more than hiding it.
   */
  credit?: string
  /** Speaker notes. Shown by the `P` overlay; never on the audience screen. */
  notes?: string
  /** Who says the notes. Presenter data only; never on the audience screen. */
  speaker?: Speaker
  /** Presenter time budget in seconds. Drives the pacing bar in the overlay. */
  budgetSeconds?: number
  /** Blue field, beige field, or transparent over the 3D stage. Defaults to `scene`. */
  field?: SlideField
  /**
   * The slide's graphic, where the narrative asks for one.
   *
   * The numbers live here rather than inside the figure component for the same
   * reason the headlines do: several of them are figures `CITATIONS.md` had to
   * correct, and a founder fixing 0.22 or $425 should be editing this registry
   * and nothing else.
   */
  figure?: FigureSpec
  scene?: SceneBinding
  demo?: DemoSpec
  /** How this slide arrives. Defaults to `cut`. */
  transition?: TransitionKind
}
