import { Fragment, type ReactNode } from 'react'

import { DemoFrame, DemoRoute } from '../demo/demo-frame'
import { presenterChrome } from '../demo/demo-runtime'
import { Figure } from '../figures'
import type { SlideSpec } from './types'

/**
 * How each `SlideKind` is composed.
 *
 * Nothing in this file contains copy. Every string comes off the `SlideSpec`, so
 * the narrative can be rewritten wholesale without a layout change — which is the
 * arrangement the content and the engine were built under, in parallel.
 */

/**
 * A headline split into individually addressable glyphs.
 *
 * The `type` transition animates `[data-glyph]` elements one at a time, including
 * along Fraunces' `wght` axis, and it can only do that if each glyph is its own
 * box. Words are kept whole in an inline-block wrapper so that the line still
 * breaks between words rather than mid-word, which is the one thing per-glyph
 * splitting usually destroys.
 *
 * The whole headline is also exposed as an `aria-label` on the container with the
 * glyphs hidden from the accessibility tree, because a screen reader handed 46
 * one-character elements reads them out as 46 letters.
 */
function Headline({ text, className }: { text: string; className?: string }) {
  const words = text.split(' ')
  let glyphIndex = 0
  return (
    <h1 className={className} aria-label={text}>
      {words.map((word, wordIndex) => (
        <Fragment key={`${word}-${wordIndex}`}>
          <span className="hl-word" aria-hidden="true">
            {Array.from(word).map((glyph, position) => {
              const index = glyphIndex
              glyphIndex += 1
              return (
                <span
                  key={`${glyph}-${position}`}
                  className="hl-glyph"
                  data-glyph=""
                  style={{ ['--glyph' as string]: index }}
                >
                  {glyph}
                </span>
              )
            })}
          </span>
          {wordIndex < words.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </h1>
  )
}

function Eyebrow({ text }: { text?: string }) {
  if (!text) return null
  return <p className="eyebrow">{text}</p>
}

function Deck({ text }: { text?: string }) {
  if (!text) return null
  return <p className="slide-deck">{text}</p>
}

/**
 * The hairline source credit.
 *
 * Rendered as the last element of the body so it sits at the bottom of whatever
 * the layout is, and marked up as a `<small>` rather than styled small here —
 * this file emits structure and the stylesheet decides what a hairline looks
 * like.
 */
function Credit({ text }: { text?: string }) {
  if (!text) return null
  return <small className="slide-credit">{text}</small>
}

/**
 * The demo budget bar: a depleting rule and a second count.
 *
 * The defence against the failure the founders named as their biggest, the demo
 * running long — which makes it an instrument for the person driving, not
 * information for the room. A countdown on a product demo tells the audience
 * only that the demo is timed, so it is drawn with the rest of the
 * presenter-only chrome and off by default. See `demo/demo-runtime.ts`.
 *
 * The number is in the DOM as text and again as a data attribute, so the
 * stylesheet can deplete the bar over exactly that many seconds without the
 * value being written down twice in two places.
 */
function DemoBudget({ seconds }: { seconds: number }) {
  if (!presenterChrome) return null
  return (
    <div className="demo-budget" data-seconds={seconds}>
      <span className="demo-budget-value">{seconds}s</span>
      <i className="demo-budget-bar" style={{ ['--budget' as string]: seconds }} />
    </div>
  )
}

/**
 * Points as a numbered ledger.
 *
 * Numbered rather than bulleted, and set in the monospace face with a gold rule
 * between rows, because the product's own surfaces are ledgers — a docket, an
 * evidence list, a billing statement. A round bullet would be the one element on
 * the slide that came from a template.
 */
function Points({ items, dense }: { items?: string[]; dense?: boolean }) {
  if (!items?.length) return null
  return (
    <ol className={`ledger${dense ? ' is-dense' : ''}`}>
      {items.map((item, position) => (
        <li key={item} style={{ ['--row' as string]: position }}>
          <i>{String(position + 1).padStart(2, '0')}</i>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  )
}

/** One large figure for the burnout lockup. `points[0]` is `stat|label`. */
function BurnoutPunch({ items }: { items?: string[] }) {
  const item = items?.[0]
  if (!item) return null
  const [stat, label] = item.split('|')
  return (
    <p className="burnout-punch">
      <strong>{stat}</strong>
      <span>{label}</span>
    </p>
  )
}

/**
 * Points as a single middot-separated row.
 *
 * This is the shape the narrative actually writes its third line in — *900+ video
 * lessons (7Sage) · 90-minute classes, 5 days a week (LSAT Lab) · $65–$425/mo* —
 * and it is not a list. Numbering it implies a sequence, and setting it as four
 * stacked rows turns a glanceable line into something the room reads instead of
 * listening. The separators are decorative, so they are hidden from screen
 * readers and the fragments stay as list items underneath.
 */
function Fragments({ items }: { items?: string[] }) {
  if (!items?.length) return null
  return (
    <ul className="fragments">
      {items.map((item, position) => (
        <li key={item}>
          {position > 0 ? <i aria-hidden="true">·</i> : null}
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

type BodyProps = {
  slide: SlideSpec
  stills: boolean
  annotations: number
  active: boolean
  reduced: boolean
}

function TitleBody({ slide }: BodyProps) {
  return (
    <div className="body body-title" data-speaker={slide.speaker}>
      <Eyebrow text={slide.eyebrow} />
      <Headline text={slide.headline} className="display xxl" />
      <Deck text={slide.deck} />
      {slide.pull ? <p className="pull-quiet">{slide.pull}</p> : null}
      <Credit text={slide.credit} />
    </div>
  )
}

function StatementBody({ slide }: BodyProps) {
  return (
    <div className="body body-statement" data-speaker={slide.speaker}>
      <div className="plate">
        <Eyebrow text={slide.eyebrow} />
        <Headline text={slide.headline} className="display lg" />
        <Deck text={slide.deck} />
        <hr className="rule" />
        <Points items={slide.points} />
        {/* Optional Q&A prompt. `close-one-stop-shop` is the last slide and
            holds `Questions?` under the rule for the whole of Q&A. */}
        {slide.pull ? <p className="statement-pull">{slide.pull}</p> : null}
        <Credit text={slide.credit} />
      </div>
    </div>
  )
}

function PovBody({ slide }: BodyProps) {
  return (
    <div className="body body-pov" data-speaker={slide.speaker}>
      <div className="pov-claim">
        <Eyebrow text={slide.eyebrow} />
        <Headline text={slide.headline} className="display xl" />
      </div>
      <div className="pov-evidence">
        <Deck text={slide.deck} />
        <Points items={slide.points} dense />
        {slide.pull ? (
          <blockquote className="pull">
            <p>{slide.pull}</p>
            {slide.attribution ? <cite>{slide.attribution}</cite> : null}
          </blockquote>
        ) : null}
        <Credit text={slide.credit} />
      </div>
    </div>
  )
}

/**
 * Product-first: the running app *is* the slide, and the words are a caption
 * plate on it.
 *
 * ## Three arrangements, and why this is the third
 *
 * It began as a 30% copy column beside a 70% embed, which measured out at 36.5%
 * of a 1920x1080 projector with 693px of deck copy beside it — "a lot of white
 * space", correctly.
 *
 * It then became a full-bleed frame with the copy in a rail down the left, which
 * is the version the founders saw: the frame was still sized at a fixed 16:10
 * logical aspect and pushed off centre by exactly the rail's width, so the app
 * held 77% of the viewport in both axes with black bands above and below it, and
 * the rail was a 349px column that broke `ACT IV — PROOF` over two lines and the
 * headline over three. A five-word headline in a sliver, beside a letterboxed
 * app, is two problems with one cause: the frame and the copy were competing for
 * the same screen and both lost.
 *
 * So the copy stops competing. It is the same object `SceneBody` puts over a 3D
 * scene — `caption-plate`, the deck's own plate, its own border, its own padding
 * — seated at the bottom-left on `--gutter` by the grid rather than by a bespoke
 * offset. The app gets the entire viewport: 100% of its height and 100% of its
 * width, with the logical aspect taken from the slot so there is nothing left to
 * letterbox. Geometry is in `demo/demo-stage.css`, which also explains why the
 * embed now sits *under* this layer rather than over it.
 *
 * The frame's title line comes with the copy rather than in a band over the app —
 * see `DemoRoute`. These slides carry no `deck`, `points` or `credit` in the
 * registry, so the plate is an eyebrow and a headline, which is what lets it be
 * a caption instead of a column.
 */
function DemoBody({ slide, stills, annotations, active }: BodyProps) {
  return (
    <div className="body body-demo" data-speaker={slide.speaker}>
      {slide.demo ? (
        <DemoFrame demo={slide.demo} stills={stills} annotations={annotations} active={active} bleed />
      ) : null}
      <div className="demo-copy caption-plate">
        {slide.demo ? <DemoBudget seconds={slide.demo.budgetSeconds} /> : null}
        {slide.demo ? <DemoRoute demo={slide.demo} stills={stills} /> : null}
        <Eyebrow text={slide.eyebrow} />
        <Headline text={slide.headline} className="display sm" />
        <Deck text={slide.deck} />
        <Points items={slide.points} dense />
        <Credit text={slide.credit} />
      </div>
    </div>
  )
}

/**
 * Scene-first: the 3D scene is the slide and the copy is a plate in the corner.
 *
 * The plate is deliberately small and deliberately opaque. A caption laid straight
 * over a busy 3D scene is unreadable at projector contrast however it is set, and
 * every attempt to fix that with a text shadow makes the type look cheap.
 *
 * Slide 11 keeps a film-title lockup in the top-left gutter so the standing
 * counsel, the floor and the contact shadow stay fully visible. Slide 10
 * centres the lockup with air above the act chrome and below the folio,
 * so the type is not clipped; the punch is one figure, not a triad.
 */
function SceneBody({ slide }: BodyProps) {
  if (slide.scene?.id === 'counsel-stage') {
    return (
      <div className="body body-scene body-counsel-stage" data-speaker={slide.speaker}>
        <div className="counsel-lockup-top">
          <Eyebrow text={slide.eyebrow} />
          <Headline text={slide.headline} className="display sm" />
          <Deck text={slide.deck} />
        </div>
      </div>
    )
  }
  if (slide.scene?.id === 'burnout') {
    return (
      <div className="body body-scene body-burnout" data-speaker={slide.speaker}>
        <div className="counsel-lockup-center">
          <Eyebrow text={slide.eyebrow} />
          <Headline text={slide.headline} className="display md" />
          <BurnoutPunch items={slide.points} />
          <Deck text={slide.deck} />
          <Credit text={slide.credit} />
        </div>
      </div>
    )
  }
  return (
    <div className="body body-scene" data-speaker={slide.speaker}>
      <div className="caption-plate">
        <Eyebrow text={slide.eyebrow} />
        <Headline text={slide.headline} className="display sm" />
        <Deck text={slide.deck} />
        <Points items={slide.points} dense />
        <Credit text={slide.credit} />
      </div>
    </div>
  )
}

function SplitBody({ slide, stills, annotations, active }: BodyProps) {
  const [left, right] = [slide.points?.slice(0, 3) ?? [], slide.points?.slice(3) ?? []]
  return (
    <div className="body body-split" data-speaker={slide.speaker}>
      <div className="split-head">
        <Eyebrow text={slide.eyebrow} />
        <Headline text={slide.headline} className="display lg" />
        <Deck text={slide.deck} />
      </div>
      <div className="split-columns">
        <div className="split-column">
          <Points items={left} dense />
        </div>
        <div className="split-column">
          <Points items={right} dense />
        </div>
      </div>
      <Credit text={slide.credit} />
      {slide.demo ? (
        <DemoFrame demo={slide.demo} stills={stills} annotations={annotations} active={active} />
      ) : null}
    </div>
  )
}

/**
 * The metric wall.
 *
 * The 3D scene behind this slide is already an instrument rack, so the DOM layer
 * does not repeat it: it lists the measures as a dense two-column index in the
 * monospace face, which is the one arrangement where twenty-odd derived figures
 * read as an inventory rather than as a wall of text.
 */
function MetricsBody({ slide }: BodyProps) {
  return (
    <div className="body body-metrics" data-speaker={slide.speaker}>
      <div className="metrics-head">
        <Eyebrow text={slide.eyebrow} />
        <Headline text={slide.headline} className="display md" />
        <Deck text={slide.deck} />
      </div>
      <ul className="metric-index">
        {slide.points?.map((point, position) => (
          <li key={point} style={{ ['--row' as string]: position }}>
            <b>{String(position + 1).padStart(2, '0')}</b>
            <span>{point}</span>
          </li>
        ))}
      </ul>
      {slide.pull ? <p className="metrics-note">{slide.pull}</p> : null}
      <Credit text={slide.credit} />
    </div>
  )
}

/**
 * Figure-led: copy at the top, graphic below, credit hairlined under it.
 *
 * The proportions are the point. The headline block is capped so that the figure
 * always gets the majority of the frame, because on these slides the figure *is*
 * the claim — the audience is meant to see 0.22 against 2.77 rather than read
 * that one is larger. The copy is centred and narrow for the same reason a
 * caption is: it should be read once and then stop competing.
 */
function FigureBody({ slide, active, reduced }: BodyProps) {
  const claim = (
    <>
      <Headline text={slide.headline} className="display lg" />
      <Deck text={slide.deck} />
    </>
  )
  return (
    <div className="body body-figure" data-speaker={slide.speaker}>
      <div className="figure-copy">
        <Eyebrow text={slide.eyebrow} />
        {slide.figure?.kind === 'claim-seal' ? (
          <div className="figure-claim">{claim}</div>
        ) : (
          claim
        )}
      </div>
      {slide.figure ? (
        <div className="figure-stage">
          <Figure spec={slide.figure} active={active} reduced={reduced} />
        </div>
      ) : null}
      <div className="figure-foot">
        <Fragments items={slide.points} />
        {slide.pull ? <p className="statement-pull">{slide.pull}</p> : null}
        <Credit text={slide.credit} />
      </div>
    </div>
  )
}

const BODIES: Record<SlideSpec['kind'], (props: BodyProps) => ReactNode> = {
  title: TitleBody,
  statement: StatementBody,
  pov: PovBody,
  demo: DemoBody,
  scene: SceneBody,
  split: SplitBody,
  metrics: MetricsBody,
  figure: FigureBody,
}

export function SlideBody(props: BodyProps) {
  const Body = BODIES[props.slide.kind] ?? StatementBody
  return <Body {...props} />
}
