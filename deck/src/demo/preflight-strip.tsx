import { useEffect, useState } from 'react'

import { runPreflight, type Check, type PreflightResult } from './preflight'
import './preflight-strip.css'

/**
 * The preflight, as something you can read.
 *
 * It lives on the start card, which is the correct and only place for it: the
 * whole point is to be seen *before* anyone is on stage, and the start card is by
 * definition the screen that is up while the founders are still plugging in. Once
 * the talk has begun there is nothing useful this could say that would be worth
 * putting on the projector.
 *
 * Two states, and the difference between them is the design:
 *
 *   - **Everything is fine.** A single quiet line of five green dots in the
 *     card's bottom rail, reading as provenance rather than as instrumentation —
 *     "app · api · signed in · case · origin" is a claim about the demo being
 *     real, which is a thing this deck wants to make anyway.
 *   - **Something is wrong.** The same line, with the offending dots amber or
 *     red, plus a plate that says what broke and the command that fixes it. It
 *     overlays the card's corner rather than sitting in the layout, because a
 *     panel that only exists when something is broken must not be able to move
 *     anything when it is not.
 *
 * The check itself runs once per page load and is shared: `runPreflight` is
 * called here, and its resolved session id is written into `demo-runtime` where
 * the demo stage reads it. So the *act of showing this* is also what makes the
 * case slide point at the right session — which means it cannot be skipped by
 * accident.
 */

/** Cached across mounts: one preflight per page load, not one per render of the card. */
let inFlight: Promise<PreflightResult> | null = null

export function preflight(): Promise<PreflightResult> {
  inFlight ??= runPreflight()
  return inFlight
}

const ORDER: Check['id'][] = ['app', 'api', 'auth', 'session', 'origin']

export function PreflightStrip() {
  const [result, setResult] = useState<PreflightResult | null>(null)

  useEffect(() => {
    let live = true
    void preflight().then((value) => { if (live) setResult(value) })
    return () => { live = false }
  }, [])

  if (!result) {
    return <span className="pf-strip" aria-live="polite"><i className="pf-dot is-checking" />Checking the demo</span>
  }

  // Not on the presenting machine, so there was nothing to check and there is
  // nothing to fix. One line saying what the deck is, rather than five red dots
  // and a repair plate addressed to someone who is not reading this.
  if (result.mode === 'stills') {
    return <span className="pf-strip" aria-live="polite"><i className="pf-dot is-ok" />Showing captured product demos</span>
  }

  const checks = ORDER
    .map((id) => result.checks.find((check) => check.id === id))
    .filter((check): check is Check => Boolean(check))
  const trouble = checks.filter((check) => check.state !== 'ok')

  return (
    <>
      <span className="pf-strip" aria-live="polite">
        {checks.map((check) => (
          <span className="pf-item" key={check.id} title={check.detail}>
            <i className={`pf-dot is-${check.state}`} />
            {check.label}
          </span>
        ))}
      </span>

      {trouble.length ? (
        <aside className="pf-panel" role="status">
          <p className="pf-panel-head">
            {trouble.some((check) => check.state === 'bad')
              ? 'The live demos will not work yet'
              : 'The live demos will work, with a caveat'}
          </p>
          <ul>
            {trouble.map((check) => (
              <li key={check.id} data-state={check.state}>
                <b>{check.label}</b>
                {check.detail}
              </li>
            ))}
          </ul>
          <p className="pf-panel-foot">
            Every embed falls back to a still if it cannot connect, and <kbd>S</kbd> forces
            all of them to stills at any time.
          </p>
        </aside>
      ) : null}
    </>
  )
}
