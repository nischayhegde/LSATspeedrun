/**
 * The one file a presenter edits by hand.
 *
 * Everything else about the live demo is derived: `scripts/prepare-demo.mjs`
 * seeds the account, reads the session id out of the seeder's report, and
 * rewrites `liveSessionId` below in place. Editing it yourself is the manual
 * escape hatch for when the seeder cannot run.
 */
export type DemoConfig = {
  /**
   * Origin the app dev server is on.
   *
   * This must stay a `localhost` origin, and the deck itself must be opened on
   * a `localhost` origin too. The app's session cookies (`lsat_session`,
   * `lsat_csrf`) are `SameSite=Lax`, so they only ride along with a framed
   * request when the framing document and the frame are the same site. Site is
   * compared by host, not by port, so `localhost:5180` framing
   * `localhost:5173` is same-site and stays signed in, while `127.0.0.1:5180`
   * framing `localhost:5173` is *cross*-site and lands on the login screen —
   * the two spellings of loopback are different sites to the browser. Opening
   * the deck from `file://` fails the same way.
   *
   * Point this at the Vite dev server (5173), never at the backend (5001):
   * every `/v1` response carries `X-Frame-Options: DENY`.
   */
  appOrigin: string
  /**
   * Session id of the case left open by `backend/scripts/seed_demo.py`, whose
   * third question renders a strategy prompt. The seeder reports it as
   * `live_demo.url`; `prepare-demo.mjs` writes just the id here.
   *
   * Empty string means "not prepared": the case demo falls back to its still
   * image instead of framing a broken URL.
   */
  liveSessionId: string
  /**
   * Session id of the *pre-graded* case written by `stage_demo.py`, used by the
   * verdict slide. Its attempt already carries stored coaching, so the review
   * screen renders real model output from the database instead of waiting on a
   * 20-40 second call in front of an audience. `stage_demo.py --apply` prints
   * this as `verdict.session_id` and rewrites it here on every run.
   */
  verdictSessionId: string
  /**
   * Force every demo slide to its still image regardless of what the health
   * check says. Flip this to `true` for a dry run on a machine with no stack
   * running, or on stage if the app is misbehaving and you want no surprises.
   */
  useStills: boolean
}

export const demoConfig: DemoConfig = {
  appOrigin: 'http://localhost:5173',
  liveSessionId: '2e5ef6d0-429c-40d1-a205-3e8392b1d864',
  verdictSessionId: '8c6a1061-915c-4347-a7f1-2621c84c6590',
  useStills: false,
}
