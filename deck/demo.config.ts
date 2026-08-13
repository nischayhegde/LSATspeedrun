/**
 * The one file a presenter edits by hand.
 *
 * Everything else about the live demo is derived: `scripts/prepare-demo.mjs`
 * seeds the account, reads the session id out of the seeder's report, and
 * rewrites `liveSessionId` below in place. Editing it yourself is the manual
 * escape hatch for when the seeder cannot run.
 *
 * The app origin is not edited here. It lives in `app-origin.mjs` so the
 * deck, the health probe, and every demo script share one port.
 */
import { APP_ORIGIN } from './app-origin.mjs'

export type DemoConfig = {
  /**
   * Origin the app dev server is on.
   *
   * This must stay a `localhost` origin, and the deck itself must be opened on
   * a `localhost` origin too. The app's session cookies (`lsat_session`,
   * `lsat_csrf`) are `SameSite=Lax`, so they only ride along with a framed
   * request when the framing document and the frame are the same site. Site is
   * compared by host, not by port, so `localhost:5180` framing
   * `localhost:5174` is same-site and stays signed in, while `127.0.0.1:5180`
   * framing `localhost:5174` is *cross*-site and lands on the login screen —
   * the two spellings of loopback are different sites to the browser. Opening
   * the deck from `file://` fails the same way.
   *
   * Point this at the Vite dev server (5174), never at the backend (5001):
   * every `/v1` response carries `X-Frame-Options: DENY`.
   */
  appOrigin: string
  /**
   * What the room reads in the demo frame's title bar, in place of the dev
   * origin above.
   *
   * The bar used to print `appOrigin` verbatim, so every demo slide showed an
   * audience of investors the string `localhost:5174`. The frame is styled as
   * the product's own chrome — engine-turned plate, gold mark, monospace — and
   * the one piece of text in it said "this is a dev server on a laptop".
   *
   * Left as the product's name rather than defaulting to a domain, because a
   * domain on a projector is a claim: someone in the room will type it. Put a
   * real one here when there is one to put.
   */
  displayOrigin: string
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
   * Session id of the *single* case the app plays end to end by itself, and the
   * credited answer for it — one letter, because it is one question.
   *
   * This is the case demo: the suggested approach taken up, the question read,
   * the written case theory shown, the answer chosen and submitted, and the
   * coach's reading of that reasoning coming back. All of it unattended, so the
   * founders narrate instead of clicking.
   *
   * Its attempt is answered and graded during staging, so submitting on stage
   * replays a stored verdict rather than starting a 20-40 second model call —
   * the same trick `verdictSessionId` uses, folded into the one slide so the
   * submit and its own payoff no longer have to be split across two.
   *
   * `stage_demo.py --apply` prints these as `solo.session_id` and
   * `solo.answer_key`, and `prepare-demo.mjs` pins them here together.
   */
  soloSessionId: string
  soloAnswerKey: string
  /**
   * Session id of the fifteen-question run the app drives itself through, and
   * the credited answers for it, in item order — `'ACEBACAEBEAADBD'` means item
   * 0's answer is A, item 1's is C, and so on.
   *
   * The key has to be carried here because the app is never told it: the API's
   * `serialize_question` omits `correct_answer` on purpose, so a driver reading
   * only what the client is sent could not answer anything. `stage_demo.py`
   * computes both values when it stages the run and `prepare-demo.mjs` pins them
   * here, so they are always written together and cannot drift apart.
   *
   * They are the two halves of one URL — see `{autoplay}` in
   * `src/demo/demo-runtime.ts`. Either one empty means "not staged", and a slide
   * asking for autoplay falls back to the ordinary live case rather than to a
   * URL that would answer nothing.
   *
   * The volume run, kept rather than used: the founders' case demo is one
   * question, not fifteen. It works, it is tested and it is inert, so it stays
   * reachable behind `{autoplayRun}` in case a volume argument ever wants a
   * picture. Nothing in the deck requests it.
   */
  autoplaySessionId: string
  autoplayAnswerKey: string
  /**
   * The account the demo data is seeded under, and the one the deck signs itself
   * in as during preflight so the presenter never sees a login screen. Must match
   * the email `seed_demo.py` and `stage_demo.py` stage against, or the deck will
   * be signed in as a user with no demo data.
   */
  demoEmail: string
  /**
   * Force every demo slide to its still image regardless of what the health
   * check says. Set `FORCE_STILLS` below for a dry run on a machine with no
   * stack running, or on stage if the app is misbehaving and you want no
   * surprises.
   *
   * Computed rather than written, because the wrong default here is not a
   * degraded demo, it is the deck framing someone else's software. See
   * `liveDemoIsPossibleHere` below.
   */
  useStills: boolean
}

/**
 * Flip to `true` for a dry run: every demo slide shows its still and nothing is
 * framed. This is the presenter's switch and it is the only one in this file
 * that is a plain answer rather than a question about the machine.
 */
const FORCE_STILLS = false

/**
 * Whether framing the app can work *on the machine the deck is open on*, which
 * is a narrower question than "is the app running" and is the one that has to
 * be answered before the first render rather than after a probe.
 *
 * The rule is the `SameSite=Lax` rule documented on `appOrigin` above, applied
 * instead of assumed: the app's session cookies ride along with a framed
 * request only when the framing document and the frame are the same site, and
 * site is compared by host. So the deck's own hostname has to *be* the app
 * origin's hostname. On the presenting machine it is — `localhost:5180` frames
 * `localhost:5174` — and nothing about the live demo changes.
 *
 * Everywhere else it is not, and the old answer was a hardcoded `useStills:
 * false` that made the deck probe `localhost:5174` and embed whatever replied.
 * A deck opened on a laptop that happened to be running an unrelated dev server
 * on 5174 put that stranger's app on screen in place of the product, with no
 * still. Even against a dead port the probe is asynchronous, so one iframe was
 * dispatched at `localhost:5174/cases/…?autoplay=C` before the fallback won.
 * Answering synchronously here means no such iframe is ever constructed.
 *
 * This also catches the footgun the runbook can only warn about: opening the
 * deck as `127.0.0.1:5180` is cross-site to `localhost:5174`, so it used to
 * frame six login screens. Now it shows six stills and the lamp reads `stills`.
 *
 * `?live=1` overrides it, for the case this cannot see: a host alias that is
 * genuinely same-site both ways, reached under a name neither of us guessed.
 */
export function liveDemoIsPossibleHere(): boolean {
  if (typeof window === 'undefined') return false
  const here = window.location
  if (new URLSearchParams(here.search).has('live')) return true
  return here.hostname === new URL(APP_ORIGIN).hostname
}

export const demoConfig: DemoConfig = {
  appOrigin: APP_ORIGIN,
  displayOrigin: 'Lawyer Tycoon',
  liveSessionId: 'a91a19c4-d28f-4a01-80ab-641f27850002',
  verdictSessionId: 'b0324368-97d3-482c-84cb-59beb554dbb6',
  soloSessionId: '38e2cbf5-763e-428e-99bb-ee9de02fb784',
  soloAnswerKey: 'C',
  autoplaySessionId: '6dc21ec7-446e-429c-8a9a-4682e6bb7601',
  autoplayAnswerKey: 'ACEBACAEBEAADBD',
  demoEmail: 'student@localhost.test',
  useStills: FORCE_STILLS || !liveDemoIsPossibleHere(),
}
