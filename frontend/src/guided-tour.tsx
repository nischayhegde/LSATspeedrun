import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, BookOpen, BriefcaseBusiness, Building2, Check, Clock3, Lock, Map, Scale, Sparkles, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

import { api } from './api'
import { useBlockingOverlay, useTopOverlay } from './overlays'
import { useSound } from './sound'
import { loadStylizedCharacter } from './art/scene-loaders'
import { TOUR_REPLAY_EVENT } from './guided-tour-replay'
import './guided-tour.css'

const StylizedCharacter = lazy(() => loadStylizedCharacter().then((module) => ({ default: module.StylizedCharacter })))

// v7 adds three chapters of instruction the tour had never carried: what a
// chosen approach actually does to a question, what sitting a mega-litigation
// is like end to end, and what the Firm tab's districts, standing counsel and
// connections are. It also corrects the mega-litigation step, which still
// described the single-clock form that `backend/app/exam.py` replaced with
// three separately timed sections.
// Only ever a fast path: the account flag from the server is authoritative, so a
// cleared store, a second browser, or a private window falls back to that rather
// than replaying the whole tour over a fully progressed firm.
const TOUR_STORAGE_KEY = 'lsat-tycoon:guided-tour:v7'

/**
 * Where the tour is allowed to offer itself. A brand-new account is sent to
 * /progress (see `serialize_user`), so that is where orientation belongs. Landing
 * anywhere else — a deep link, a bookmark, a shared URL — is a deliberate
 * destination and does not get interrupted; the header's help button replays the
 * tour from any screen.
 *
 * It offers rather than opens. The tour used to put a modal over a brand-new
 * account unasked and then drive the router itself, step by step, so the first
 * thing the app did to a new student was take the wheel — which is at its worst
 * in the case it is most likely to happen in, someone walking another person
 * through signing up and finding the screen moving on its own. Every step of it
 * is still here and one click away; nothing navigates until that click.
 */
const OFFER_ROUTES = new Set(['/progress'])

/**
 * The chapters, in order, and the word each one gets in the rail.
 *
 * The tour is long — it is the only place several of these mechanics are ever
 * explained — and a long linear tour is a tour nobody replays to find the one
 * thing they wanted. The rail turns "step 19 of 28" into a place you can go
 * back to, which is the difference between orientation and documentation.
 */
const chapters = [
  { key: 'exam', label: 'The exam' },
  { key: 'practice', label: 'Practice' },
  { key: 'method', label: 'Methods' },
  { key: 'mock', label: 'Mock exams' },
  { key: 'firm', label: 'The firm' },
  { key: 'world', label: 'The world' },
] as const

type ChapterKey = (typeof chapters)[number]['key']

type TourStep = {
  /** `feature` explains a mechanic that has no single element to point at. */
  kind: 'premise' | 'spotlight' | 'practice' | 'feature' | 'finish'
  chapter: ChapterKey
  eyebrow: string
  title: string
  body: string
  /** Short scannable specifics. Prose says why; these say what. */
  facts?: string[]
  /** Diagram rendered under the body, where a shape explains faster than a sentence. */
  visual?: 'loop' | 'form' | 'share' | 'types' | 'gate' | 'sitting' | 'board'
  target?: string
  route?: string
  cue?: string
  /**
   * Steps that describe a screen Focus Mode puts away. Focus Mode hides the
   * office, firm and world routes and drops their nav entries, so a tour that
   * kept these would navigate to the "put away" gate three times and then
   * spotlight nav items that are not in the document. Filtered out instead,
   * and the finish step says the chapters are there when Focus Mode is off.
   */
  hiddenInFocusMode?: boolean
}

const steps: TourStep[] = [
  {
    kind: 'premise',
    chapter: 'exam',
    eyebrow: 'YOUR FIRST MORNING',
    title: 'The firm is small. Your docket is not.',
    body: 'Every LSAT question arrives as a matter to solve. Strong answers build skill; durable understanding builds the firm.',
  },
  {
    kind: 'premise',
    chapter: 'exam',
    eyebrow: 'THE TRAINING LOOP',
    title: 'Diagnose. Drill. Review. Transfer.',
    body: 'You will move quickly when fluency matters, slow down when an error needs repair, and prove improvement on unseen questions.',
    visual: 'loop',
  },
  {
    kind: 'premise',
    chapter: 'exam',
    eyebrow: 'THE EXAM ITSELF',
    title: 'Four sections. Only three count.',
    body: 'The LSAT is four 35-minute multiple-choice sections back to back, with one 10-minute break in the middle. The fourth section is unscored — it pilots questions for future tests, looks exactly like the others, and you are never told which one it is.',
    visual: 'form',
    facts: [
      'Scored: two Logical Reasoning sections and one Reading Comprehension',
      'Roughly 78 scored questions, converted to the 120–180 scale',
      'Logic games were retired in August 2024 — this app never drills them',
      'Argumentative Writing is separate, online, and unscored',
    ],
  },
  {
    kind: 'premise',
    chapter: 'exam',
    eyebrow: 'WHAT THE SCORE IS MADE OF',
    title: 'Two questions in three are arguments.',
    body: 'Logical Reasoning is scored twice and Reading Comprehension once, so LR carries about twice the weight. Every mega-litigation here is built on that same split, and a case is one real LSAT question either way.',
    visual: 'share',
    facts: [
      'About 51 scored LR questions against 27 in RC',
      'A mega-litigation is 75 questions in the form’s own order: LR I, RC, LR II',
      'A run of cases is six questions, or one whole reading passage, untimed per question but paced against a target',
    ],
  },
  {
    kind: 'premise',
    chapter: 'exam',
    eyebrow: 'THE QUESTION TYPES',
    title: 'A short list does most of the damage.',
    body: 'Both sections reuse a small set of tasks. Name the task before you read the choices and most of the section stops being a reading exercise. These are the labels this app files every case under.',
    visual: 'types',
  },
  {
    kind: 'spotlight',
    chapter: 'practice',
    eyebrow: 'DASHBOARD',
    title: 'Start from evidence, not guesswork.',
    body: 'Accuracy, pacing, confidence, and retention are reported separately, because they fail separately. The Speedrun Index sits on top, and the app never claims a trend it cannot support with a sample.',
    target: '[data-tour="nav-progress"]',
    route: '/progress',
    cue: 'Dashboard',
  },
  {
    kind: 'spotlight',
    chapter: 'practice',
    eyebrow: 'PRACTICE',
    title: 'The docket knows the next right move.',
    body: 'One button always points at today’s work. A run is six cases — six real LSAT questions wrapped in a client and a fee — mixing unseen questions with whatever repairs have come due, so review happens without you scheduling it. Roughly one run in three is a reading case instead: a single passage and all its questions, which comes out at five to eight.',
    target: '[data-tour="nav-cases"]',
    route: '/cases',
    cue: 'Practice',
  },
  {
    kind: 'practice',
    chapter: 'practice',
    eyebrow: 'ANSWERING A QUESTION',
    title: 'Make one clean commitment.',
    body: 'Read for the task, choose the answer the text proves, and record confidence honestly. Feedback then explains the reasoning—not just the letter.',
    route: '/cases',
    cue: 'Question workflow',
  },
  {
    kind: 'feature',
    chapter: 'practice',
    eyebrow: 'WRITE, THEN LEARN',
    title: 'The explanation is the work.',
    body: 'Every case wants your reasoning in writing before it accepts the letter. The coach then grades that reasoning, names the first place it went wrong, and shows why each choice lives or dies.',
    facts: [
      'At least 120 characters of reasoning per case',
      'Rate your confidence 1–5 — an assured miss is treated as worse than a hesitant one',
      'Graded Invalid, Weak, Good, or Excellent, and the grade moves your fee',
      'You cannot skip past the debrief to the next question',
    ],
    cue: 'Reasoning',
  },
  {
    kind: 'feature',
    chapter: 'practice',
    eyebrow: 'REPAIR',
    title: 'Mistakes come back on a schedule.',
    body: 'Anything you missed, guessed at, or solved too slowly is queued and folded into a later run at widening intervals — until you get it right on a day you had forgotten it.',
    facts: [
      'A confident miss comes due immediately — so does a right answer you doubted',
      'Repairs fill up to half a run and go first',
      'Getting one right pushes the interval out; missing it resets to today',
      'The post-run brief ranks the decisions worth re-reading',
    ],
    cue: 'Repair queue',
  },
  {
    kind: 'feature',
    chapter: 'method',
    eyebrow: 'THE METHOD LAB',
    title: 'Fourteen methods, tested on you.',
    body: 'Each case may suggest a named LSAT method — prephrasing the answer, splitting the argument, diagramming conditionals, striking choices with a reason. Roughly a quarter of cases stay silent on purpose, so the app can compare you with the method against you without it.',
    facts: [
      'Accuracy, pace, and explanation quality are compared, not vibes',
      'A verdict reads "forming" until both sides of the comparison have a sample',
      'Weak question types keep getting tested longer before the app settles',
      'The Dashboard’s Methods tab shows the lift for each one, with and without',
    ],
    cue: 'Method Lab',
  },
  {
    kind: 'feature',
    chapter: 'method',
    eyebrow: 'IMPLEMENTING A METHOD',
    title: '"Use it" is not a promise. It is a gate.',
    body: 'Pressing Use it does not tick a box and let you carry on. It arms a short sequence of operations the case will not accept an answer without — chosen so that doing the operation is the method, rather than a description of one you meant to use.',
    visual: 'gate',
    facts: [
      'Prephrase hides the answer choices until you have written what the credited answer must do — and you cannot edit the prediction once they appear',
      'Elimination refuses your final selection until choices are struck with a reason, and refuses a struck choice as the answer',
      'Naming a flaw rejects the stimulus’s own topic words, so you have to say the shape of the error',
      'Every check is arithmetic on your text and the question’s text — word counts, sentence picks, overlap. No model’s opinion ever blocks a submission',
    ],
    cue: 'Gates',
  },
  {
    kind: 'feature',
    chapter: 'method',
    eyebrow: 'WHEN THE CLIENT INSISTS',
    title: 'A few matters come with a standing order.',
    body: 'Most gates are an offer: Skip this one is always there and is recorded honestly as answering without the method, never as a failure. On a small number of cases the client wants the method worked on the record, and there is no skip — but there is always a way out, and it opens on evidence that you tried.',
    facts: [
      'At most two per run and six a day, drawn only from methods you have not already mastered',
      'Withdraw the method opens after two refusals from the checks, or after 90 seconds inside the panel',
      'A withdrawal is filed as ordered-and-not-filed. Nothing is charged and the case goes on',
      'Clear a method eight times at 75% and the gate steps down to optional — scaffolding that never comes off is a tax',
    ],
    cue: 'Standing orders',
  },
  {
    kind: 'feature',
    chapter: 'mock',
    eyebrow: 'THE MEGA-LITIGATION',
    title: 'Basically a full practice LSAT.',
    body: 'The one measurement that pays nothing, prompts nothing, and coaches nothing — which is exactly what makes it worth trusting. No method gates, no confidence prompt, no written reasoning: three timed sections and an answer sheet, the way test day works.',
    facts: [
      '75 questions as LR I, RC, LR II — the real form’s shape, the three scored sections',
      'About two hours including the break. Nothing in the firm ever waits on one',
      'Clear 70% of the form and your firm jumps a tier, prerequisites unlocked free',
      'It is what the Dashboard’s projected score and every "you are weakest at" line are computed from',
    ],
    cue: 'Mega-litigation',
  },
  {
    kind: 'feature',
    chapter: 'mock',
    eyebrow: 'SITTING ONE',
    title: 'Three sections, three clocks, one bell each.',
    body: 'The server holds the only clock that counts. Each section is 35 minutes on its own timer, and the 10-minute intermission sits after the second one, which is where LSAC puts it.',
    visual: 'sitting',
    facts: [
      'A section is armed and waits for your click — it never starts because you walked back to the desk',
      'Inside a running section you move freely: any question, in any order, flag what you want to revisit, change answers until the bell',
      'A five-minute warning, then the section ends hard. What is blank at the bell stays blank',
      'You cannot reach into a section that has not started or one that has finished',
      'Left sitting at a boundary for an hour, the form closes itself out and the rest is recorded blank — "one sitting" is a fact here, not a label',
    ],
    cue: 'The sitting',
  },
  {
    kind: 'feature',
    chapter: 'mock',
    eyebrow: 'AFTER THE BELL',
    title: 'The answers stay sealed until you have earned them.',
    body: 'A finished form does not open into a key. Everything you missed is collected into one untimed blind review — the same questions, no clock, no coaching — and you answer them again before any answer is released. Reading an explanation is easy; producing the answer twice is what tells you whether you can.',
    facts: [
      'Only the questions you got wrong. A clean form releases immediately',
      'Untimed, and it costs nothing — this is measurement, not billing',
      'What you fix on the second pass is the difference between a careless miss and a gap',
      'Then the score projection, the section split, and the per-type weaknesses that steer every later run',
    ],
    cue: 'Blind review',
  },
  {
    kind: 'feature',
    chapter: 'firm',
    eyebrow: 'GETTING PAID',
    title: 'Every case is billable.',
    body: 'A client pays a base fee; what you actually collect depends on the verdict, the quality of your written reasoning, how fast you closed, and everything you have built.',
    facts: [
      'Fee = client base × your score × your firm, plus streak, staff, and contract bonuses',
      'Reputation rises on wins and falls on losses; pro bono pays normally and shields the loss',
      'Streaks compound, and one careless miss ends them',
      'The exact breakdown is shown after every case — nothing is hidden',
    ],
    cue: 'The economy',
  },
  {
    kind: 'feature',
    chapter: 'firm',
    eyebrow: 'RENT COMES DUE',
    title: 'A firm left alone loses ground.',
    body: 'Your office bills rent every day whether you show up or not, and a silent week costs reputation as well as cash. It is the one pressure that makes a daily habit the cheap option.',
    facts: [
      'Daily rent scales with your tier; away from the desk it accrues at a fifth of the rate',
      'Arrears stop at three days — you can always dig out',
      'Reputation only starts slipping after two quiet days, and staff can shield it',
      'Passive income accrues hourly up to a cap; collect it in the office',
    ],
    cue: 'Upkeep',
  },
  {
    kind: 'spotlight',
    chapter: 'firm',
    eyebrow: 'OFFICE',
    title: 'Your working day lives here.',
    body: 'Open the next case, meet the active client, collect passive income, and clear daily goals. The workspace itself fills in with every upgrade you actually own — and at the top tiers it is two floors, a Practice Floor and Chambers, with a switch between them.',
    target: '[data-tour="nav-office"]',
    route: '/office',
    cue: 'Office',
    hiddenInFocusMode: true,
  },
  {
    kind: 'spotlight',
    chapter: 'firm',
    eyebrow: 'THE FIRM TAB',
    title: 'Six tabs, and each one buys a different kind of thing.',
    body: 'Upgrades raise what a case pays. Decor changes the room you work in. Staff hire people who shield reputation and add bonuses. Clients set your rate. Districts is where the firm takes ground. Rivals is where you take someone else’s.',
    target: '[data-tour="nav-firm"]',
    route: '/firm',
    cue: 'Firm',
    facts: [
      'Every card states what is missing in plain words, so a locked one is never a mystery',
      'Two filters sit over each grid: status (all, ready, owned) and the firm address the item belongs to',
      'Trophies live in a disclosure in the heading. They grant nothing on purpose — a cash prize for "100 cases" would retune an economy built on three to six cases per upgrade — and each locked one shows how far along you are',
      'A headquarters tier needs reputation, cash, and every prior upgrade, hire and acquisition',
    ],
    hiddenInFocusMode: true,
  },
  {
    kind: 'feature',
    chapter: 'firm',
    eyebrow: 'DISTRICTS AND STANDING COUNSEL',
    title: 'Where the firm is the first call.',
    body: 'The Districts tab opens on a board of 38 districts across five regions of the map. Signing one makes your firm standing counsel to its institutions — the duty roster, the shopkeepers’ association, the port authority. This is not a client retainer and it pays no fee per case.',
    visual: 'board',
    // The board this step is describing, behind the card, rather than the
    // Upgrades grid the previous step left on screen.
    route: '/firm?tab=connections',
    facts: [
      'Standing holds your reputation up from below, so a bad week costs less than it would',
      'A branch you are already paid to keep comes off the daily lease — district counsel seats are the thing that reduces rent',
      'A district shows COUNSEL HELD, OPEN, or LOCKED. Locked means a network you do not own yet',
      'The region rail carries the tier range each region covers, because the firm’s address and the map’s regions are two different axes that nest',
    ],
    cue: 'Districts',
    hiddenInFocusMode: true,
  },
  {
    kind: 'feature',
    chapter: 'firm',
    eyebrow: 'DISTRICTS',
    title: 'A network is not a perk. It is a key.',
    body: 'A network card in the same tab — the local bar association, the chamber of commerce, the board network — carries a small share of every case fee, but that is the least of what it does. What you are buying is the districts it unlocks, and the card names them and ticks the ones you have already signed.',
    route: '/firm?tab=connections',
    facts: [
      '"Show on the map" flies to the region and marks every district that connection opened',
      'Their crests hang on the office wall, and hovering one names the same districts in the same two colours',
      'Fourteen networks, and several districts are locked behind one specific network rather than behind money',
    ],
    cue: 'Districts',
    hiddenInFocusMode: true,
  },
  {
    kind: 'feature',
    chapter: 'firm',
    eyebrow: 'STAFF, CLIENTS, RIVALS',
    title: 'Three tabs you can walk from one end to the other.',
    body: 'The firm floor on the Staff tab is not a picture: every figure standing on it is a button that finds that person’s card, clears whichever filter was hiding it, and marks it. Nothing is bought from the roster — price, requirement and button stay together on the card.',
    route: '/firm?tab=staff',
    facts: [
      'Clients set the fee every case pays, and the bar on each card shows how much is banked per win against how much waits for the close',
      'A reputation slip puts a client on hold and someone else bills at their rate until it recovers',
      'The Rivals tab leads with the war room, because weakening a firm and then buying it is one move, not two',
      'A rival bought the gray way carries heat, and heat surcharges every gray operation after it',
    ],
    cue: 'Staff and clients',
    hiddenInFocusMode: true,
  },
  {
    kind: 'feature',
    chapter: 'world',
    eyebrow: 'THE CAMPAIGN',
    title: 'The work has a story attached.',
    body: 'Chapters arrive as you climb the tiers, and the choices in them are not cosmetic: they move where you sit between principled and ruthless, and that changes which work will have you.',
    facts: [
      'Ethics, heat, influence, and intel all track separately',
      'Quests run alongside cases: pro bono, investigations, shadow work, legacy matters',
      'Rival operations can buy out a competitor cleanly — or not cleanly, for a price',
      'Heat surcharges every future gray operation, so ruthless is a real bet',
    ],
    cue: 'Story',
  },
  {
    kind: 'spotlight',
    chapter: 'world',
    eyebrow: 'WORLD',
    title: 'The map is your career record.',
    body: 'Each arc is a living legal environment. Levels sit on one deliberate route, with districts unlocking as your firm and LSAT skill advance — and the districts you are counsel to are marked on it.',
    target: '[data-tour="nav-map"]',
    route: '/map',
    cue: 'World',
    hiddenInFocusMode: true,
  },
  {
    kind: 'spotlight',
    chapter: 'world',
    eyebrow: 'YOUR EVIDENCE',
    title: 'Read the signal, not the decoration.',
    body: 'This compact standing shows verified accuracy and completed cases. The Dashboard holds the deeper analysis, and on a narrow window these badges step aside so the navigation keeps its words.',
    target: '[data-tour="standing"]',
    cue: 'Standing',
  },
  {
    kind: 'spotlight',
    chapter: 'world',
    eyebrow: 'SOUND',
    title: 'A quiet layer of feedback.',
    body: 'Sound marks navigation, files, verdicts, and promotions. Keep it on, lower it, use Lite mode, or mute it at any time.',
    target: '[data-tour="sound"]',
    cue: 'Sound controls',
  },
  {
    kind: 'finish',
    chapter: 'world',
    eyebrow: 'THE DOCKET IS OPEN',
    title: 'Take a case. Or take the whole test.',
    body: 'Start billing cases whenever you like. When you have a free couple of hours, a mega-litigation tells the app what to prescribe, and clearing 70% of it promotes your firm. Everything here is in the account menu under Replay tutorial, and you can jump straight to a chapter.',
  },
]

type Highlight = { left: number; top: number; width: number; height: number }

function findVisibleTarget(selector?: string) {
  if (!selector) return null
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find((element) => {
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  }) ?? null
}

export function GuidedTour({ oriented, focusMode = false }: { oriented: boolean; focusMode?: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { play } = useSound()
  const [dismissed, setDismissed] = useState(() => window.localStorage.getItem(TOUR_STORAGE_KEY) === 'complete')
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const [highlight, setHighlight] = useState<Highlight | null>(null)
  const [practiceChoice, setPracticeChoice] = useState<number | null>(null)
  const [practiceRevealed, setPracticeRevealed] = useState(false)
  const [offerDeclined, setOfferDeclined] = useState(false)
  /**
   * Focus Mode hides the office, firm and world routes behind a gate and takes
   * their nav entries away. Left in, those steps navigated to the "put away"
   * screen and then spotlighted three nav items that are not in the document —
   * the retry loop in the highlight effect gives up after 90 frames and the
   * step reads with no spotlight, which is a tour describing something the
   * student cannot see.
   */
  const tour = useMemo(
    () => (focusMode ? steps.filter((entry) => !entry.hiddenInFocusMode) : steps),
    [focusMode],
  )
  const openChapters = useMemo(
    () => chapters.filter((chapter) => tour.some((entry) => entry.chapter === chapter.key)),
    [tour],
  )
  const step = tour[Math.min(index, tour.length - 1)]
  // Keeps the Escape listener stable while still calling the latest `close`.
  const closeRef = useRef<(reason: 'finished' | 'skipped') => void>(() => {})
  // Only one modal layer at a time; see overlays.tsx.
  const visible = useBlockingOverlay('guided-tour', open)
  // The offer is chrome, not a layer, so it does not claim the screen — but a
  // brand-new account is also the one most likely to have a story chapter
  // waiting, and an offer painted underneath a full-screen scrim is one a
  // player can see the edge of and cannot click. It waits instead, and appears
  // on its own once the screen is clear.
  const blockingOverlay = useTopOverlay()
  const alreadyOriented = oriented || dismissed

  const recordCompletion = useMutation({
    mutationFn: () => api.updateMe({ guided_tour_completed: true }),
    onSuccess: (data) => queryClient.setQueryData(['me'], data),
  })

  useEffect(() => {
    const replay = () => {
      setIndex(0)
      setPracticeChoice(null)
      setPracticeRevealed(false)
      setOpen(true)
    }
    window.addEventListener(TOUR_REPLAY_EVENT, replay)
    return () => window.removeEventListener(TOUR_REPLAY_EVENT, replay)
  }, [])

  // The tour moves between routes as part of its own steps. That is the tour
  // doing what it was asked to do — `open` is now only ever set by a click, on
  // the offer below or on "Replay tutorial" in either menu — so the navigation
  // is consented rather than imposed.
  // A step's route may carry a query, because three of the Firm chapter's steps
  // describe one particular tab of six and the page reads which tab from
  // `?tab=`. Comparing the whole route against `pathname` alone would never
  // match one of those and the effect would navigate on every render, so the
  // comparison is against pathname plus search — and a step with no query still
  // matches whatever query the page is already carrying, which is what keeps
  // the tour from resetting a tab the reader chose themselves.
  useEffect(() => {
    if (!open || !step?.route) return
    const [wantPath, wantQuery] = step.route.split('?')
    const here = location.pathname === wantPath
      && (!wantQuery || location.search.replace(/^\?/, '') === wantQuery)
    if (!here) navigate(step.route, { replace: true })
  }, [location.pathname, location.search, navigate, open, step])

  useEffect(() => {
    if (!open || step.kind !== 'spotlight') {
      setHighlight(null)
      return
    }
    let frame = 0
    // A target can be a frame or two late (lazy art, a route still settling),
    // so retry — but give up rather than re-queue forever if the element is
    // hidden at this breakpoint. The step then reads without a spotlight
    // instead of spinning a rAF loop for as long as the tour is open.
    let attempts = 0
    const measure = () => {
      const target = findVisibleTarget(step.target)
      if (!target) {
        if (attempts++ < 90) frame = window.requestAnimationFrame(measure)
        return
      }
      attempts = 0
      const rect = target.getBoundingClientRect()
      const pad = 8
      setHighlight({
        left: Math.max(8, rect.left - pad),
        top: Math.max(8, rect.top - pad),
        width: Math.min(window.innerWidth - 16, rect.width + pad * 2),
        height: Math.min(window.innerHeight - 16, rect.height + pad * 2),
      })
    }
    frame = window.requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
    }
  }, [location.pathname, open, step])

  const progress = Math.round((index + 1) / tour.length * 100)

  // Finishing and skipping close the tour the same way: both record on the
  // account that this player has been offered orientation, so no device or
  // browser ever forces it again. Declared before the visibility guard so the
  // Escape listener below can use it.
  const close = (reason: 'finished' | 'skipped') => {
    window.localStorage.setItem(TOUR_STORAGE_KEY, 'complete')
    setDismissed(true)
    setOpen(false)
    if (!oriented) recordCompletion.mutate()
    void play(reason === 'finished' ? 'event' : 'paper', { seed: `tour:${reason}`, intensity: reason === 'finished' ? .46 : .3 })
  }
  closeRef.current = close

  useEffect(() => {
    if (!visible) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current('skipped')
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [visible, closeRef])

  /**
   * The offer: obvious, and only an offer.
   *
   * It is deliberately not a modal and deliberately not `useBlockingOverlay`.
   * It takes no focus, covers nothing, blocks no key, and moves no route, so a
   * new account can be shown around by a person instead of by the app. Taking
   * it starts exactly the tour that used to start itself.
   */
  if (!open && !alreadyOriented && !offerDeclined && !blockingOverlay && OFFER_ROUTES.has(location.pathname)) {
    const decline = () => {
      // Recorded the same way a skip is: this account has now been offered
      // orientation, so no device or browser asks again. "Replay tutorial" in
      // the account menu and the mobile menu is how it comes back.
      window.localStorage.setItem(TOUR_STORAGE_KEY, 'complete')
      setOfferDeclined(true)
      setDismissed(true)
      if (!oriented) recordCompletion.mutate()
      void play('paper', { seed: 'tour:declined', intensity: .3 })
    }
    return (
      <aside className="tour-offer" aria-label="Guided introduction">
        <div className="tour-offer-mark" aria-hidden="true"><Scale size={17} /></div>
        <div className="tour-offer-copy">
          <span>NEW HERE?</span>
          <strong>Take the guided tour of the firm.</strong>
          {/* It used to promise two minutes and then run a tour that is not two
              minutes long. It says what it is instead: the chapters, in order,
              so the length is visible before the click rather than after it. */}
          <small>{openChapters.map((chapter) => chapter.label).join(' · ')} — {tour.length} steps, skippable at any point.</small>
        </div>
        <div className="tour-offer-actions">
          <button type="button" className="tour-offer-take" onClick={() => { setOpen(true); void play('paper', { seed: 'tour:accepted', intensity: .46 }) }}>
            Start the tour <ArrowRight size={15} />
          </button>
          <button type="button" className="tour-offer-decline" onClick={decline}>Not now</button>
        </div>
      </aside>
    )
  }

  if (!visible || !step) return null

  const advance = () => {
    if (step.kind === 'practice' && !practiceRevealed) {
      if (practiceChoice === null) return
      setPracticeRevealed(true)
      void play(practiceChoice === 1 ? 'verdict-correct' : 'verdict-repair', { seed: `tour-practice:${practiceChoice}`, intensity: .52 })
      return
    }
    if (index === tour.length - 1) {
      close('finished')
      navigate('/progress', { replace: true })
      return
    }
    void play('paper', { seed: `tour:${index}`, intensity: .46 })
    setIndex((current) => current + 1)
  }

  const back = () => {
    if (index === 0) return
    void play('paper', { seed: `tour:back:${index}`, intensity: .3 })
    setIndex((current) => current - 1)
  }

  const jumpToChapter = (key: ChapterKey) => {
    const target = tour.findIndex((entry) => entry.chapter === key)
    if (target < 0 || target === index) return
    void play('paper', { seed: `tour:chapter:${key}`, intensity: .34 })
    setPracticeChoice(null)
    setPracticeRevealed(false)
    setIndex(target)
  }

  const placement = highlight && highlight.left + highlight.width / 2 > window.innerWidth * .55 ? 'left' : 'right'

  return (
    <div className={`guided-tour guided-tour-mode-${step.kind}`} role="dialog" aria-modal="true" aria-label="Lawyer Tycoon guided introduction">
      {step.kind === 'premise' && (
        <div className="tour-cinematic" aria-hidden="true">
          <div className="tour-skyline"><i /><i /><i /><i /><i /></div>
          <div className="tour-office-window" />
          <div className="tour-desk"><span /><b /><em /></div>
          <div className="tour-counsel-character">
            <Suspense fallback={null}>
              <StylizedCharacter gender="male" tier={1} role="guide" mode="scene" direction="right" activity="briefing" label="Your orientation guide" />
            </Suspense>
          </div>
          <div className="tour-case-stream"><i>LR</i><i>RC</i><i>LR</i></div>
        </div>
      )}
      {step.kind === 'finish' && (
        <div className="tour-finish-seal" aria-hidden="true"><Scale /><i /><span><Sparkles /></span></div>
      )}
      {highlight && (
        <div
          className="guided-tour-spotlight"
          style={{ left: highlight.left, top: highlight.top, width: highlight.width, height: highlight.height }}
          aria-hidden="true"
        />
      )}
      <section className={`guided-tour-card place-${placement}`}>
        <div className="tour-card-progress"><i style={{ width: `${progress}%` }} /></div>
        {step.kind !== 'premise' && (
          <div className="tour-guide-avatar" aria-hidden="true">
            <Suspense fallback={null}>
              <StylizedCharacter gender="male" tier={1} role="guide" mode="portrait" mood={step.kind === 'practice' ? 'thinking' : 'happy'} activity={step.kind === 'practice' ? 'working' : 'briefing'} />
            </Suspense>
          </div>
        )}
        {/* The rail is why the tour can be this long. Every chapter is one
            click from every other, so replaying it to re-read how the method
            gates work is a click and not nineteen. It is also the only place
            the tour says how much of it is left in units a reader cares
            about. */}
        <nav className="tour-chapters" aria-label="Tutorial chapters">
          {openChapters.map((chapter) => {
            const current = chapter.key === step.chapter
            return (
              <button
                type="button"
                key={chapter.key}
                className={current ? 'is-current' : ''}
                aria-current={current ? 'step' : undefined}
                onClick={() => jumpToChapter(chapter.key)}
              >
                {chapter.label}
              </button>
            )
          })}
        </nav>
        <div className="tour-card-heading">
          <span>{step.eyebrow}</span>
          <small>{String(index + 1).padStart(2, '0')} / {String(tour.length).padStart(2, '0')}</small>
          <button type="button" className="tour-dismiss" onClick={() => close('skipped')} aria-label="Close the guided tour">
            <X size={15} />
          </button>
        </div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        {step.visual === 'form' && (
          <div className="tour-form" aria-label="One LSAT form: four 35-minute sections, three of them scored">
            <ol>
              {[
                { label: 'LR', count: '25–26' },
                { label: 'LR', count: '25–26' },
                { label: 'RC', count: '27' },
                { label: '?', count: '25–27', unscored: true },
              ].map((block, blockIndex) => (
                <li className={block.unscored ? 'is-unscored' : ''} key={`${block.label}-${blockIndex}`}>
                  <b>{block.label}</b><span>{block.count}</span>
                </li>
              ))}
            </ol>
            <p>35 minutes each · the unscored section is LR or RC and can sit anywhere in the order</p>
          </div>
        )}
        {step.visual === 'share' && (
          <div className="tour-share" aria-label="Logical Reasoning is roughly two-thirds of the scored questions">
            <div className="tour-share-bar">
              <i className="is-lr" style={{ width: '65%' }}><span>Logical Reasoning</span></i>
              <i className="is-rc" style={{ width: '35%' }}><span>RC</span></i>
            </div>
            <div className="tour-share-legend"><em>~51 questions · two sections</em><em>27 questions · one section</em></div>
          </div>
        )}
        {step.visual === 'types' && (
          <div className="tour-types">
            <section>
              <h3>Logical Reasoning <small>about 26 a section</small></h3>
              <ul>
                <li><b>Roughly half</b><span>Flaw · Assumption · Strengthen · Weaken</span></li>
                <li><b>About a third</b><span>Inference · Principle · Paradox · Argument Structure</span></li>
                <li><b>The rest</b><span>Main Conclusion · Parallel Reasoning</span></li>
              </ul>
            </section>
            <section>
              <h3>Reading Comprehension <small>27 in four sets</small></h3>
              <p>Five to eight questions per passage set, asking for the Main Point, an Inference, the Author’s Perspective, the Function of a line, or an Analogy. A set is usually one passage; some forms include a comparative pair, and some now include none.</p>
            </section>
          </div>
        )}
        {step.visual === 'gate' && (
          <div className="tour-gate" aria-label="What pressing Use it arms on a case">
            <ol>
              <li><b>1</b><span><strong>You take the method</strong>The case arms the operations that method is made of</span></li>
              <li><b>2</b><span><strong>You do the operation</strong>Write the prephrase, strike the choices, name the flaw</span></li>
              <li><b>3</b><span><strong>The case checks your text</strong>Word counts and overlap against the question — never a model’s opinion</span></li>
              <li className="is-gate"><b><Lock size={13} /></b><span><strong>Only then does Submit open</strong>Fail a check and it says which one, and why</span></li>
            </ol>
          </div>
        )}
        {step.visual === 'sitting' && (
          <div className="tour-sitting" aria-label="One mega-litigation: three 35-minute sections with a 10-minute intermission after the second">
            <ol>
              <li><b>LR I</b><span>35 min</span></li>
              <li><b>RC</b><span>35 min</span></li>
              <li className="is-break"><b>Break</b><span>10 min</span></li>
              <li><b>LR II</b><span>35 min</span></li>
            </ol>
            <p>Each section is armed and waits for your click · five-minute warning · the bell is the server’s, not the tab’s</p>
          </div>
        )}
        {step.visual === 'board' && (
          <div className="tour-board" aria-label="How a district reads on the Districts board">
            <ul>
              <li className="is-held"><b>COUNSEL HELD</b><span>Signed. Reputation supported, and a branch here comes off the lease</span></li>
              <li className="is-open"><b>OPEN</b><span>Everything it needs is met — this is the one you can sign now</span></li>
              <li className="is-locked"><b>LOCKED</b><span>Named on the card: a tier, a sum, or a network you do not own</span></li>
            </ul>
          </div>
        )}
        {step.facts && (
          <ul className="tour-facts">
            {step.facts.map((fact) => <li key={fact}><Check size={14} /><span>{fact}</span></li>)}
          </ul>
        )}
        {step.visual === 'loop' && (
          <div className="tour-loop" aria-label="The learning loop">
            <span><Scale /> Diagnose</span><i />
            <span><BriefcaseBusiness /> Practice</span><i />
            <span><Check /> Repair</span><i />
            <span><Map /> Transfer</span>
          </div>
        )}
        {step.kind === 'finish' && (
          <div className="tour-promise"><Building2 /><span><strong>Instruction first.</strong> The world grows because the learning is working.</span></div>
        )}
        {step.kind === 'practice' && (
          <div className="tour-question-demo">
            <div className="tour-question-meta"><span><BookOpen /> Logical Reasoning</span><span><Clock3 /> Untimed tutorial</span></div>
            <p>Every brief filed today is reviewed before closing. No reviewed brief is left unassigned. Which statement must be true?</p>
            <div className="tour-answer-list" role="radiogroup" aria-label="Tutorial answer choices">
              {[
                'Some unassigned briefs were filed today.',
                'Every brief filed today is assigned before closing.',
                'Only briefs filed today are reviewed.',
                'No brief filed today is urgent.',
              ].map((choice, choiceIndex) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={practiceChoice === choiceIndex}
                  disabled={practiceRevealed}
                  className={`${practiceChoice === choiceIndex ? 'selected' : ''} ${practiceRevealed && choiceIndex === 1 ? 'correct' : ''} ${practiceRevealed && practiceChoice === choiceIndex && choiceIndex !== 1 ? 'incorrect' : ''}`}
                  onClick={() => {
                    setPracticeChoice(choiceIndex)
                    void play('select', { seed: `tour-choice:${choiceIndex}`, intensity: .34 })
                  }}
                  key={choice}
                >
                  <i>{String.fromCharCode(65 + choiceIndex)}</i><span>{choice}</span>{practiceRevealed && choiceIndex === 1 && <Check />}
                </button>
              ))}
            </div>
            {/* Mirrors the real runner's 1–5 control so the first live case looks familiar. */}
            <div className="tour-confidence"><span>Confidence</span>{[1, 2, 3, 4, 5].map((value) => <button type="button" className={value === 3 ? 'active' : ''} tabIndex={-1} key={value}>{value}</button>)}<em>Moderate</em></div>
            {practiceRevealed && (
              <div className={`tour-answer-reasoning ${practiceChoice === 1 ? 'is-correct' : 'needs-repair'}`} role="status">
                <strong>{practiceChoice === 1 ? 'Correct reasoning' : 'Repair the chain'}</strong>
                <p><b>Filed today</b> → reviewed → assigned. Choice B is the only answer guaranteed by both rules. A contradicts the chain, C reverses it, and D introduces “urgent” without support.</p>
              </div>
            )}
          </div>
        )}
        {/* Sticky, because several chapters are longer than a card and the one
            control that must never be hunted for is the one that advances. */}
        <footer className="tour-card-footer">
        <div className="tour-card-actions">
          <button type="button" className="tour-back" onClick={back} disabled={index === 0}>Back</button>
          {step.kind !== 'finish' && (
            <button type="button" className="tour-skip" onClick={() => close('skipped')}>Skip the tour</button>
          )}
          {/* Moving focus into an aria-modal dialog on open is the intended
              dialog behaviour, not the stray page-load autofocus this rule
              guards against. */}
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <button type="button" className="tour-next" onClick={advance} disabled={step.kind === 'practice' && practiceChoice === null} autoFocus>
            {step.kind === 'finish' ? 'Open Dashboard' :step.kind === 'practice' && !practiceRevealed ? 'Lock answer' : step.kind === 'premise' ? 'Continue' : `Next · ${step.cue ?? 'Continue'}`}
            <ArrowRight />
          </button>
        </div>
        <small className="tour-required">Optional orientation · skip with Escape at any point, replay any time from the header</small>
        </footer>
      </section>
    </div>
  )
}
