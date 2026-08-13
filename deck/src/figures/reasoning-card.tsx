import type { ReasoningCardFigure } from './types'
import { pct, usePhase, vars, type FigureBody } from './kit'

/**
 * `pov-reasoning-is-the-work` — The emphasis moving off the answer and onto the
 * reasoning, and VanLehn's three effect sizes beside it.
 *
 * The card is a mock rather than a screenshot because the slide is an *argument
 * about* an interface, and an argument needs the interface to move: the five
 * choices do not disappear, they shrink and recede, and the reasoning box takes
 * the room they gave up. A student who has used any other prep app recognises
 * that reallocation instantly, which is worth more than pixel fidelity.
 *
 * The bars are the slide, though. 0.76 and 0.79 have to land at visibly the same
 * length, so they are scaled from zero against the largest value with no padding,
 * no rounding to a nicer axis and no minimum gap — 0.76 comes out at 96.2% of
 * 0.79 and reads as "the same bar", which is the claim. Anything that made those
 * two bars easier to tell apart would be making the deck's strongest piece of
 * evidence weaker.
 */

/** Cumulative milliseconds: explanation, coaching, then the two feedback levels. */
const MARKS = [40, 700, 1500] as const

/** Per-word reveal of the written reasoning. Fast enough to read as typing rather than as a list. */
const WORD_STAGGER_MS = 22

/** Per-bar delay in the effect sequence. The audience has to see three separate draws. */
const EFFECT_STAGGER_MS = 320

export function ReasoningCard({ spec, active, reduced }: FigureBody<ReasoningCardFigure>) {
  const phase = usePhase(active, reduced, MARKS)
  const segments = splitAround(spec.reasoning, spec.underline)
  const effects = spec.effects.slice(0, 2)
  const peak = Math.max(...effects.map((effect) => Math.abs(effect.value)), Number.EPSILON)

  let wordIndex = 0

  return (
    <div className="fig-rc">
      <div className="fig-rc-card" data-focused="true" style={{ opacity: phase >= 1 ? 1 : 0 }}>
        <p className="fig-rc-stem">Your explanation · answer (B)</p>
        <div className="fig-rc-box" data-focused="true">
          <p className="fig-rc-written">
            {segments.map((segment, segmentIndex) => {
              const words = segment.text.split(/(\s+)/).filter((part) => part.length > 0)
              const body = words.map((word, index) => {
                if (/^\s+$/.test(word)) return <span key={`gap-${segmentIndex}-${index}`}> </span>
                const delay = `${wordIndex++ * WORD_STAGGER_MS}ms`
                return (
                  <span
                    className="fig-rc-word"
                    key={`word-${segmentIndex}-${index}`}
                    style={vars({ opacity: phase >= 1 ? 1 : 0, '--fig-delay': delay })}
                  >
                    {word}
                  </span>
                )
              })
              return segment.marked ? (
                // The clause the coaching panel picks on. Underlined via the text
                // decoration rather than a positioned rule, because the clause can
                // wrap and a positioned rule cannot follow it across a line break.
                <span
                  className="fig-rc-mark"
                  key={`seg-${segmentIndex}`}
                  data-marked={phase >= 2 ? 'true' : 'false'}
                >
                  {body}
                </span>
              ) : (
                <span key={`seg-${segmentIndex}`}>{body}</span>
              )
            })}
          </p>
        </div>

        <div
          className="fig-rc-coach"
          style={{ transform: phase >= 2 ? 'translateY(0)' : 'translateY(102%)' }}
        >
          <span className="fig-rc-coach-tag" />
          <div>
            <p className="fig-rc-coach-clause">Fixed criteria → strength · first error · clean path</p>
          </div>
        </div>
      </div>

      <ol className="fig-rc-effects">
        {effects.map((effect, index) => (
          <li
            key={effect.label}
            data-emphasis={effect.emphasis ? 'true' : 'false'}
            style={vars({ '--fig-delay': `${index * EFFECT_STAGGER_MS}ms` })}
          >
            <p className="fig-rc-effect-head">
              <b>{effect.value.toFixed(2)}</b>
              <span>{effect.label}</span>
            </p>
            <span className="fig-rc-effect-track">
              <span
                className="fig-rc-effect-run"
                style={{ width: phase >= 3 ? pct(Math.abs(effect.value) / peak) : '0%' }}
              />
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/**
 * The reasoning, split into the clause the coach underlines and everything
 * around it.
 *
 * `underline` is contracted to appear in `reasoning`; if a registry edit breaks
 * that, the text still renders in full and simply carries no underline, which is
 * a quiet failure rather than a slide with a hole in it.
 */
function splitAround(text: string, clause: string): Array<{ text: string; marked: boolean }> {
  const at = clause.length > 0 ? text.indexOf(clause) : -1
  if (at < 0) return [{ text, marked: false }]
  const parts: Array<{ text: string; marked: boolean }> = []
  if (at > 0) parts.push({ text: text.slice(0, at), marked: false })
  parts.push({ text: clause, marked: true })
  const rest = text.slice(at + clause.length)
  if (rest.length > 0) parts.push({ text: rest, marked: false })
  return parts
}
