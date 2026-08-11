import { useEffect, useRef, useState, type RefObject } from 'react'

import {
  easeScroll,
  frameScrollTop,
  readAutoplayRequest,
  readableBand,
  reserveToolbarSpace,
  settleLayout,
  sleep,
  spanOf,
  waitFor,
  type AutoplayRequest,
  type RunPace,
  type SoloPace,
  type Span,
} from './autoplay-plan'
import './autoplay.css'

/**
 * The driver, in two sequences.
 *
 * **solo** plays one case all the way through — takes up the suggested
 * approach, reads the question, shows the written case theory, picks the
 * credited answer, submits it, and holds on the coach's reading of that
 * reasoning. One slide, the entire product loop, nobody touching the keyboard.
 *
 * **run** answers fifteen questions in about seventy seconds, turning the page
 * itself. Both share everything below; they differ only in what they frame and
 * how long they hold it.
 *
 * ## What it drives, and what it does not
 *
 * It calls the same handlers a finger would: the choice's `onClick`, the submit
 * button's `onClick`, the next-case button's `onClick`. Nothing is stubbed,
 * mocked or pre-rendered — every answer is a real `POST /study-sessions/:id/
 * attempts` against the real seeded run, and the verdict on screen is the
 * server's, decided by the answer key the client is never sent.
 *
 * It deliberately never waits on the coaching model. Explanation grading is a
 * 20-40 second frontier call, and the app already treats it as off the critical
 * path — the request is made, a worker picks it up, and the player moves on.
 * The one thing the driver *does* wait for is that request having been *issued*,
 * because `POST /study-sessions/:id/debrief/acknowledge` refuses to close a
 * debrief for a case that was never sent for grading. Waiting for the handoff
 * rather than for the grade is the whole difference between a run that takes a
 * minute and a run that takes ten.
 *
 * ## Failure
 *
 * Every way this can go wrong ends in the same place: `giveUp` stops issuing
 * actions, re-frames whatever is on screen, and leaves it there. A stopped
 * driver looks like a student who paused mid-question, which is a state an
 * audience reads as ordinary. It never retries forever, never leaves a
 * half-finished interaction on screen, and — because `engaged` stays true — the
 * app's own error notices stay suppressed for the rest of the run, so a backend
 * that dies mid-demo costs the founders a stopped demo rather than a red box.
 */

/*
 * How long to wait for each thing, in time the page was awake for — see
 * `waitFor`. Deliberately several times the observed cost of each call on a
 * healthy stack (submit and next-case both land in about 150ms locally). The
 * point of these numbers is not to keep the demo brisk, which the pace does;
 * it is to decide when a demo has stopped working. Waiting a further eight
 * seconds for a struggling backend costs a slow moment. Giving up on one costs
 * the rest of the run.
 */
const SUBMIT_TIMEOUT_MS = 12_000
const ADVANCE_TIMEOUT_MS = 12_000
const HANDOFF_TIMEOUT_MS = 12_000
/** Shorter, because this one waits on the app's own state, not on a server. */
const ARM_TIMEOUT_MS = 6_000
/** One pause before one retry. A hiccup is worth a second try; an outage is not. */
const RETRY_MS = 1_200

export type AutoplayInputs = {
  /** False for anything that is not a live, answerable practice run. */
  eligible: boolean
  /** Items in the run, used to reject an answer key that belongs to another one. */
  totalItems: number
  itemId: string | undefined
  position: number | undefined
  choiceLabels: readonly string[]
  resultId: string | undefined
  /** A suggested approach is on screen and is waiting to be taken up or declined. */
  strategyPending: boolean
  /** The submit button would accept a click right now. */
  canSubmit: boolean
  submitFailed: boolean
  /** Explanation grading has been requested for the pending attempt. */
  coachingRequested: boolean
  /** The coach's reading of the reasoning is on screen. */
  coachingReady: boolean
  advanceFailed: boolean
  answerCard: RefObject<HTMLElement | null>
  verdict: RefObject<HTMLElement | null>
  applyStrategy: () => void
  select: (label: string) => void
  submit: () => void
  advance: () => void
}

/** Read once: the frame's URL is set by the deck and does not change under us. */
const REQUEST: AutoplayRequest | null = typeof window === 'undefined'
  ? null
  : readAutoplayRequest(window.location.search)

/**
 * Whether this document was opened with an autoplay request at all.
 *
 * A constant rather than part of the hook's return, because the case screen
 * needs it in places a hook's value cannot reach — an effect declared above the
 * hook, and JSX that must not render an error box while a driver is running.
 * It also makes the gate obvious at every call site: everything guarded by this
 * is unreachable unless the URL asked for it.
 */
export const AUTOPLAY_ENGAGED = REQUEST !== null

/**
 * Why a run stopped, for whoever finds it stopped.
 *
 * A driver whose whole failure story is "it goes quiet and looks composed"
 * needs somewhere to say what happened, or the first stalled rehearsal costs an
 * hour of guessing. This is that somewhere: no DOM, no logging, nothing an
 * audience can see, and nothing at all unless the URL asked for a run. Read it
 * from the console as `__autoplay`.
 */
export type AutoplayStop = { reason: string; position: number | undefined; at: number }

if (AUTOPLAY_ENGAGED) {
  (window as unknown as { __autoplay: { stop: AutoplayStop | null } }).__autoplay = { stop: null }
}

function recordStop(stop: AutoplayStop): void {
  const slot = (window as unknown as { __autoplay?: { stop: AutoplayStop | null } }).__autoplay
  if (slot) slot.stop = stop
}

/*
 * Marked at import time rather than from an effect, so the class is on the
 * document before React's first paint. An effect would run one frame late,
 * which on this page is one frame of the markup toolbar appearing and then
 * vanishing — the exact "visible machinery" the run is supposed to have none
 * of. See `autoplay.css` for what the class does and why.
 */
if (AUTOPLAY_ENGAGED) document.documentElement.classList.add('autoplay-run')

export function useAutoplay(inputs: AutoplayInputs): void {
  const request = REQUEST
  const [stopped, setStopped] = useState(false)

  /**
   * The current props, readable from inside a running sequence.
   *
   * The sequence for one question outlives several renders — it picks a choice,
   * which re-renders, then submits, which re-renders again — so everything it
   * reads after its first await has to come from here rather than from the
   * closure it was created in.
   */
  const latest = useRef(inputs)
  latest.current = inputs

  const stoppedRef = useRef(false)
  const startedRef = useRef(false)

  // An answer key sized for a different run is the one failure that would be
  // invisible until it was fifteen wrong answers deep, so it is refused up
  // front rather than discovered a question at a time.
  const keyFits = Boolean(request) && inputs.totalItems > 0
    && request!.answers.length === inputs.totalItems

  useEffect(() => {
    if (request && inputs.totalItems > 0 && !keyFits && !stoppedRef.current) {
      stoppedRef.current = true
      recordStop({
        reason: `key is ${request.answers.length} long, run has ${inputs.totalItems} questions`,
        position: undefined,
        at: Math.round(performance.now()),
      })
      setStopped(true)
    }
  }, [keyFits, inputs.totalItems, request])

  const active = Boolean(request) && keyFits && !stopped && inputs.eligible

  const pace = request?.pace
  const scene = request?.scene

  // Held for the whole slide, not per question: it changes the document height,
  // and doing that between questions would move the page under the audience.
  useEffect(() => {
    if (!AUTOPLAY_ENGAGED || !inputs.eligible) return
    return reserveToolbarSpace()
  }, [inputs.eligible])

  useEffect(() => {
    if (!active || !pace) return
    const itemId = inputs.itemId
    const resultId = inputs.resultId
    if (!itemId && !resultId) return

    const controller = new AbortController()
    const signal = controller.signal

    const readSpan = (): Span | null => {
      const card = latest.current.answerCard.current
      if (!card) return null
      return spanOf(
        card.querySelector('.stimulus'),
        card.querySelector('.question-label'),
        card.querySelector('h1'),
        card.querySelector('.choices'),
      )
    }

    /*
     * The single case's four reading beats. Each one is a separate span rather
     * than a scroll offset, because the page's real height depends on the
     * question, on whether the approach has been taken up yet, and on whether
     * the reasoning box is still mounted — all of which change under the
     * sequence as it runs. Measuring at the moment of use is the only version
     * of this that survives a different question being pinned.
     */
    // Not `.strategy-tip` alone: the control arm of the strategy trial renders
    // an `.is-neutral` card in the same slot, which offers nothing to take up.
    const strategySpan = (): Span | null =>
      spanOf(document.querySelector('.strategy-tip:not(.is-neutral)'))

    const stemSpan = (): Span | null => {
      const card = latest.current.answerCard.current
      if (!card) return null
      return spanOf(
        card.querySelector('.stimulus'),
        card.querySelector('.question-label'),
        card.querySelector('h1'),
      )
    }

    const reasoningSpan = (): Span | null =>
      spanOf(latest.current.answerCard.current?.querySelector('.reasoning-box') ?? null)

    /**
     * The five choices, and nothing else.
     *
     * The first version of this reached down to the submit button as well, on
     * the theory that choosing and committing are one gesture and should be
     * framed together. Watching it run said otherwise: the case theory sits
     * between the choices and the button, so the span covered most of the card
     * and resolved to a scroll 76 pixels from where the reasoning beat had just
     * left the page. A 76-pixel move is not a camera move, it is a twitch, and
     * it made the moment the answer is chosen look like a rendering glitch.
     *
     * So the selection beat goes back up to the choices — a real move, away
     * from the reasoning and onto the five options — and the confirmation is
     * left to the thing that actually confirms, which is the verdict.
     */
    const choicesSpan = (): Span | null =>
      spanOf(latest.current.answerCard.current?.querySelector('.choices') ?? null)

    /**
     * The payoff, anchored at the stamp.
     *
     * The verdict, the grade, the fee and the coach's reading of the reasoning
     * are together taller than the frame, and no arrangement fits them. So this
     * deliberately does not try: it starts at the stamp and lets the review run
     * off the bottom, because the top of that block is the part the narration
     * is about and the part the room reads first.
     */
    const soloVerdictSpan = (): Span | null => {
      const card = latest.current.answerCard.current
      return spanOf(
        card?.querySelector('.verdict-stamp') ?? null,
        latest.current.verdict.current,
      ) ?? spanOf(card)
    }

    /**
     * The confirmation beat, framed from the bottom up.
     *
     * Three things want to be on screen: the verdict stamp and the judge's
     * ruling, the choice the app just marked, and the next-case button it is
     * about to press. The button is the least interesting of the three and the
     * most damaging to get wrong — half a button sticking out of the bottom of
     * the frame is the kind of detail that makes a room stop believing the rest
     * — so it anchors the span, and the choices are added above it only when
     * they fit.
     *
     * On this run they do: 700 pixels of content against 755 of usable frame.
     * A longer question falls back to the ruling and the button, which is still
     * a complete thought.
     */
    const verdictSpan = (): Span | null => {
      const card = latest.current.answerCard.current
      const ruling = spanOf(
        latest.current.verdict.current,
        card?.querySelector('.verdict-stamp') ?? null,
        // Scoped to the card: the run's closing debrief has a continue row too,
        // and a span reaching for that one would frame a different page.
        card?.querySelector('.continue-row') ?? null,
      )
      if (!ruling) return spanOf(card)
      const choices = spanOf(card?.querySelector('.choices') ?? null)
      if (!choices) return ruling
      const combined = { top: choices.top, bottom: ruling.bottom }
      return combined.bottom - combined.top <= readableBand() ? combined : ruling
    }

    const frameOn = async (span: Span | null) => {
      if (!span) return
      await easeScroll(frameScrollTop(span), pace.scrollMs, signal)
    }

    const giveUp = (reason: string) => {
      if (stoppedRef.current) return
      stoppedRef.current = true
      recordStop({ reason, position: latest.current.position, at: Math.round(performance.now()) })
      setStopped(true)
      // Land on a composed frame rather than wherever the last aborted scroll
      // left the page. Its own controller, because `signal` is about to abort.
      const settle = new AbortController()
      const ruled = Boolean(latest.current.resultId)
      const span = scene === 'solo'
        ? (ruled ? soloVerdictSpan() : stemSpan() ?? strategySpan())
        : (ruled ? verdictSpan() : readSpan())
      if (span) void easeScroll(frameScrollTop(span), pace.scrollMs, settle.signal)
    }

    const submitAnswer = async (): Promise<string | null> => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (!(await waitFor(() => latest.current.canSubmit, ARM_TIMEOUT_MS, signal))) {
          return signal.aborted ? null : 'submit button never armed'
        }
        latest.current.submit()
        const settled = await waitFor(
          () => Boolean(latest.current.resultId) || latest.current.submitFailed,
          SUBMIT_TIMEOUT_MS,
          signal,
        )
        // The verdict arriving re-runs this effect, which aborts us. That is
        // success, not a stall.
        if (signal.aborted || latest.current.resultId) return null
        if (!settled) return 'no verdict came back'
        await sleep(RETRY_MS, signal)
      }
      return 'the answer was refused twice'
    }

    const advance = async (): Promise<string | null> => {
      const from = latest.current.resultId
      for (let attempt = 0; attempt < 2; attempt += 1) {
        latest.current.advance()
        const settled = await waitFor(
          () => latest.current.resultId !== from || latest.current.advanceFailed,
          ADVANCE_TIMEOUT_MS,
          signal,
        )
        // Finishing the run unmounts this whole screen for the debrief, which
        // aborts us before any state we can still read has changed.
        if (signal.aborted || latest.current.resultId !== from) return null
        if (!settled) return 'the next case never arrived'
        await sleep(RETRY_MS, signal)
      }
      return 'the next case was refused twice'
    }

    const readAndAnswer = async (dwell: RunPace) => {
      const position = latest.current.position
      const label = position == null ? undefined : request!.answers[position]
      // Out of key, or a key that does not name a choice this question has.
      if (!label) {
        giveUp(`no answer in the key for position ${position}`)
        return
      }
      if (!latest.current.choiceLabels.includes(label)) {
        giveUp(`key says ${label}, which this question does not offer`)
        return
      }
      if (!startedRef.current) {
        startedRef.current = true
        // Framed before the opening pause rather than after it, so the room's
        // first sight of the app is a composed page — but only once the page
        // has stopped moving, or the frame is computed against a layout that no
        // longer exists by the time anyone looks at it.
        await settleLayout(signal)
        await frameOn(readSpan())
        await sleep(dwell.warmupMs, signal)
      }
      await frameOn(readSpan())
      await sleep(dwell.readMs, signal)
      if (signal.aborted) return
      latest.current.select(label)
      await sleep(dwell.selectMs, signal)
      if (signal.aborted) return
      const failure = await submitAnswer()
      if (failure && !signal.aborted) giveUp(failure)
    }

    const confirmAndTurn = async (dwell: RunPace) => {
      await sleep(dwell.verdictSettleMs, signal)
      await frameOn(verdictSpan())
      await sleep(dwell.verdictMs, signal)
      if (signal.aborted) return
      const handedOff = await waitFor(() => latest.current.coachingRequested, HANDOFF_TIMEOUT_MS, signal)
      if (signal.aborted) return
      if (!handedOff) {
        giveUp('grading was never requested, so the next case would be refused')
        return
      }
      const failure = await advance()
      if (failure && !signal.aborted) giveUp(failure)
    }

    /**
     * One case, from the suggested approach to the coach's reading of it.
     *
     * The order is the product's order, not a convenient one: the method is
     * chosen *before* the question is read, because that is the claim — that
     * picking an approach up front is what changes the answer. Reading the
     * stem after the tip, and the written theory after the stem, means the room
     * watches a case being worked rather than a form being filled in.
     */
    const playSoloCase = async (dwell: SoloPace) => {
      const label = request!.answers[0]
      if (!latest.current.choiceLabels.includes(label)) {
        giveUp(`key says ${label}, which this question does not offer`)
        return
      }
      if (!startedRef.current) {
        startedRef.current = true
        await settleLayout(signal)
        await frameOn(strategySpan() ?? stemSpan())
        await sleep(dwell.warmupMs, signal)
      }

      if (latest.current.strategyPending) {
        await frameOn(strategySpan())
        await sleep(dwell.strategyMs, signal)
        if (signal.aborted) return
        latest.current.applyStrategy()
        // Taking the approach up can unfold a panel beneath the card, which
        // moves everything under it. Frame after that has happened, not before.
        await sleep(dwell.appliedMs, signal)
        await settleLayout(signal, 900)
      }
      if (signal.aborted) return

      await frameOn(stemSpan())
      await sleep(dwell.stemMs, signal)
      if (signal.aborted) return

      await frameOn(reasoningSpan())
      await sleep(dwell.reasoningMs, signal)
      if (signal.aborted) return

      await frameOn(choicesSpan())
      await sleep(dwell.choicesMs, signal)
      if (signal.aborted) return
      latest.current.select(label)
      await sleep(dwell.selectMs, signal)
      if (signal.aborted) return

      const failure = await submitAnswer()
      if (failure && !signal.aborted) giveUp(failure)
    }

    /**
     * The end of the slide, and the end of the sequence.
     *
     * Nothing is turned and nothing is advanced: one case is the whole demo, so
     * the composed final state and the intended final state are the same
     * screen. The driver stops here on purpose, which means the ordinary
     * ending and every failure ending look alike from the audience's side.
     */
    const holdSoloVerdict = async (dwell: SoloPace) => {
      await sleep(dwell.verdictSettleMs, signal)
      // The reasoning box and the approach card both unmount when the verdict
      // arrives, so the page is materially shorter than the one just framed.
      await settleLayout(signal, 1_200)
      await frameOn(soloVerdictSpan())
      // Pre-graded, so this is a read rather than a wait — but if a grade ever
      // is missing, the frame is already correct and the hold still happens.
      await waitFor(() => latest.current.coachingReady, 2_000, signal)
      await frameOn(soloVerdictSpan())
      await sleep(dwell.verdictMs, signal)
    }

    if (scene === 'solo') {
      const dwell = pace as SoloPace
      void (resultId ? holdSoloVerdict(dwell) : playSoloCase(dwell))
    } else {
      const dwell = pace as RunPace
      void (resultId ? confirmAndTurn(dwell) : readAndAnswer(dwell))
    }

    return () => controller.abort()
    // `latest` carries everything else. Re-running on anything but the two
    // identities below would restart a sequence that is already mid-question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pace, scene, inputs.itemId, inputs.resultId])
}
