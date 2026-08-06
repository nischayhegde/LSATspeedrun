import { humanoidTransitionFade, type HumanoidActor, type HumanoidGesture, type HumanoidState } from './humanoid-actor'

/**
 * Ambient behavior: what keeps a room feeling inhabited rather than looped.
 *
 * Fluid motion alone does not make a scene come to life. A character playing
 * one perfect clip forever still reads as a display piece, because the thing
 * that makes a real office feel occupied is that people keep changing what
 * they are doing and keep noticing each other. This scheduler gives every
 * actor a repertoire appropriate to their job, moves them through it on
 * irregular intervals, and lets them react - a glance when someone walks past,
 * a nod when the player looks their way.
 *
 * It is deliberately cheap: a countdown and an occasional state change per
 * actor per frame, no pathfinding and no per-frame allocation. All the actual
 * motion cost is in the clips, which are shared.
 */

export type BehaviorRole =
  | 'deskWork'
  | 'reception'
  | 'investigation'
  | 'diplomatic'
  | 'client'
  /** A single character at a fixed camera, close up: the portrait card and
   *  the hero panel. Nothing locomotes, the feet are usually out of frame,
   *  and the entire performance is the idle and the beats layered over it. */
  | 'portrait'
  /**
   * The player's own lawyer, alone in a tall panel at full height.
   *
   * Split out from `portrait` because the two surfaces have opposite
   * constraints despite both being "one character at a fixed camera". A
   * portrait bust is eighty pixels of head, where a beat that moves a forearm
   * is invisible and one that moves a head is two pixels; the hero is four
   * hundred pixels of whole figure, on screen for as long as a player leaves
   * the office open, with nothing beside it. It is the one surface in the app
   * that can carry - and needs - beats large enough to change the outline of
   * the body.
   */
  | 'portraitHero'
  /** Seated and holding something, so the arms are not free to move. */
  | 'seatedGuest'

type Beat = {
  state: HumanoidState
  /** Relative likelihood of being chosen next. */
  weight: number
  /** Seconds to hold this beat, before per-actor jitter. */
  hold: [number, number]
}

/**
 * Per-role repertoires. Each role has a dominant activity plus genuine
 * alternatives, so two people doing the same job still look like two people.
 */
const REPERTOIRE: Record<BehaviorRole, Beat[]> = {
  deskWork: [
    // Shorter, more frequently interrupted holds so typing reads as bursts of
    // work broken by pauses rather than one unbroken clatter.
    { state: 'seatedType', weight: 5, hold: [3.5, 9] },
    { state: 'seatedIdle', weight: 3, hold: [3, 7] },
  ],
  reception: [
    { state: 'idle', weight: 3, hold: [6, 13] },
    { state: 'idleWeightShift', weight: 3, hold: [7, 15] },
    { state: 'confer', weight: 2, hold: [5, 11] },
    { state: 'reviewDocument', weight: 2, hold: [6, 12] },
  ],
  investigation: [
    { state: 'presentBoard', weight: 4, hold: [7, 14] },
    { state: 'reviewDocument', weight: 3, hold: [6, 12] },
    { state: 'idleWeightShift', weight: 2, hold: [4, 9] },
  ],
  diplomatic: [
    { state: 'confer', weight: 4, hold: [6, 13] },
    { state: 'idle', weight: 2, hold: [5, 10] },
    { state: 'idleWeightShift', weight: 2, hold: [6, 12] },
    { state: 'reviewDocument', weight: 1, hold: [5, 10] },
  ],
  client: [
    { state: 'seatedIdle', weight: 4, hold: [8, 17] },
    { state: 'seatedType', weight: 1, hold: [4, 8] },
  ],
  // Four resting stances rather than three, held for spans that share no
  // common factor, so the sequence of postures a viewer sees over a couple of
  // minutes never lines up with itself. The attentive stance is weighted a
  // little lower than the relaxed three: it is the one that reads as a
  // deliberate change, and a deliberate change every third beat stops being
  // one.
  portrait: [
    { state: 'idle', weight: 3, hold: [9, 19] },
    { state: 'idleWeightShift', weight: 3, hold: [11, 22] },
    { state: 'idleRelaxed', weight: 3, hold: [10, 21] },
    { state: 'idleAlert', weight: 2, hold: [8, 17] },
  ],
  // Held for shorter spans than the busts are, and weighted flat.
  //
  // The hold ranges are the whole reason this differs. Nine to nineteen
  // seconds per stance is right for a figure the eye passes over; on the one
  // character a player actually watches it means the weight is on the same
  // foot for most of a question. Six to thirteen puts a genuine change of
  // stance - which is a slow crossfade carrying the pelvis several
  // centimetres across, not a cut - inside the span of anybody's attention,
  // and the four spans still share no common factor with each other or with
  // any clip's period.
  portraitHero: [
    { state: 'idle', weight: 3, hold: [6, 13] },
    { state: 'idleWeightShift', weight: 3, hold: [7, 15] },
    { state: 'idleRelaxed', weight: 3, hold: [6.5, 14] },
    { state: 'idleAlert', weight: 3, hold: [5.5, 12] },
  ],
  seatedGuest: [
    { state: 'seatedIdle', weight: 1, hold: [20, 30] },
  ],
}

/**
 * The layered beats, per role.
 *
 * Every one of these is additive, so it plays over the base state rather than
 * interrupting it, and the repertoire is per-role because the constraint that
 * matters is what the character's hands are doing. A receptionist standing
 * with empty hands can square a cuff; a client holding a folder in both hands
 * cannot, and a beat that moves their arms would tear them off the prop.
 */
const FILLERS: Record<BehaviorRole, Array<{ gesture: HumanoidGesture; weight: number }>> = {
  // The portrait is the deepest repertoire in the cast, because it is the one
  // a player looks at for minutes at a stretch while reading a question, and
  // it is the only role with nothing else on screen competing for the eye.
  //
  // Twenty-two entries, of which the last six are the rare ones - a sigh, a
  // double take, a hand-off of weight from one foot to the other, a small
  // gathering of resolve. Those exist to be seen roughly once a sitting. A
  // beat that fires often has to be forgettable or it grates; a beat that
  // fires once every few minutes can afford to have a personality, and is the
  // reason the loop never closes.
  portrait: [
    { gesture: 'handFlex', weight: 4 },
    { gesture: 'breathDeep', weight: 4 },
    { gesture: 'weightSettle', weight: 3 },
    { gesture: 'weightSettleMirrored', weight: 3 },
    { gesture: 'glance', weight: 3 },
    { gesture: 'glanceMirrored', weight: 3 },
    { gesture: 'postureReset', weight: 2 },
    { gesture: 'cuffAdjust', weight: 2 },
    { gesture: 'cuffAdjustMirrored', weight: 2 },
    { gesture: 'considerTilt', weight: 2 },
    { gesture: 'considerTiltMirrored', weight: 2 },
    { gesture: 'rollShoulders', weight: 2 },
    { gesture: 'breathSigh', weight: 2 },
    { gesture: 'weightTransfer', weight: 2 },
    { gesture: 'weightTransferMirrored', weight: 2 },
    { gesture: 'checkWatch', weight: 1 },
    { gesture: 'checkWatchMirrored', weight: 1 },
    { gesture: 'stretch', weight: 1 },
    { gesture: 'nod', weight: 1 },
    { gesture: 'resolve', weight: 1 },
    { gesture: 'doubleTake', weight: 1 },
    { gesture: 'doubleTakeMirrored', weight: 1 },
  ],
  /**
   * The hero's filler set, weighted the opposite way round from the bust's.
   *
   * The busts lead with the cheap, forgettable beats because they fire often
   * on a figure nobody is studying. Here the ordering is by how much of the
   * body a beat moves, largest first, because the failure this surface
   * actually had was not repetition - the repertoire was already deep - it was
   * that almost everything in it was too small to see. `handFlex` moves a
   * wrist by eight degrees, which at this framing is four pixels; `emphasise`
   * throws a whole arm.
   *
   * The small beats are still here and still carry weight, because a body that
   * only ever does big things is as unconvincing as one that only ever does
   * small ones. They are just no longer the majority.
   */
  portraitHero: [
    { gesture: 'emphasise', weight: 4 },
    { gesture: 'emphasiseMirrored', weight: 4 },
    { gesture: 'turnAway', weight: 3 },
    { gesture: 'turnAwayMirrored', weight: 3 },
    { gesture: 'weightTransfer', weight: 3 },
    { gesture: 'weightTransferMirrored', weight: 3 },
    { gesture: 'braceUp', weight: 3 },
    { gesture: 'neckRelease', weight: 3 },
    { gesture: 'neckReleaseMirrored', weight: 3 },
    { gesture: 'shoulderDrop', weight: 3 },
    { gesture: 'glance', weight: 3 },
    { gesture: 'glanceMirrored', weight: 3 },
    { gesture: 'rollShoulders', weight: 3 },
    { gesture: 'weightSettle', weight: 2 },
    { gesture: 'weightSettleMirrored', weight: 2 },
    { gesture: 'considerTilt', weight: 2 },
    { gesture: 'considerTiltMirrored', weight: 2 },
    { gesture: 'cuffAdjust', weight: 2 },
    { gesture: 'cuffAdjustMirrored', weight: 2 },
    { gesture: 'postureReset', weight: 2 },
    { gesture: 'breathDeep', weight: 2 },
    { gesture: 'breathSigh', weight: 2 },
    { gesture: 'resolve', weight: 2 },
    { gesture: 'nod', weight: 2 },
    { gesture: 'scanRoom', weight: 2 },
    { gesture: 'scanRoomMirrored', weight: 2 },
    { gesture: 'doubleTake', weight: 1 },
    { gesture: 'doubleTakeMirrored', weight: 1 },
    { gesture: 'handFlex', weight: 1 },
    { gesture: 'checkWatch', weight: 1 },
    { gesture: 'checkWatchMirrored', weight: 1 },
    { gesture: 'stretch', weight: 1 },
  ],
  reception: [
    { gesture: 'glance', weight: 4 },
    { gesture: 'glanceMirrored', weight: 4 },
    { gesture: 'scanRoom', weight: 3 },
    { gesture: 'scanRoomMirrored', weight: 3 },
    { gesture: 'nod', weight: 3 },
    { gesture: 'weightSettle', weight: 3 },
    { gesture: 'weightSettleMirrored', weight: 3 },
    { gesture: 'handFlex', weight: 2 },
    { gesture: 'cuffAdjust', weight: 2 },
    { gesture: 'rollShoulders', weight: 2 },
    { gesture: 'checkWatch', weight: 2 },
    { gesture: 'checkWatchMirrored', weight: 1 },
    { gesture: 'breathDeep', weight: 2 },
    { gesture: 'weightTransfer', weight: 2 },
    { gesture: 'doubleTake', weight: 1 },
    { gesture: 'doubleTakeMirrored', weight: 1 },
  ],
  investigation: [
    { gesture: 'considerTilt', weight: 4 },
    { gesture: 'considerTiltMirrored', weight: 4 },
    { gesture: 'glance', weight: 3 },
    { gesture: 'scanRoom', weight: 3 },
    { gesture: 'scanRoomMirrored', weight: 2 },
    { gesture: 'postureReset', weight: 2 },
    { gesture: 'breathDeep', weight: 2 },
    { gesture: 'rollShoulders', weight: 2 },
    { gesture: 'stretch', weight: 1 },
    { gesture: 'weightSettleMirrored', weight: 2 },
    { gesture: 'breathSigh', weight: 2 },
    { gesture: 'resolve', weight: 2 },
    { gesture: 'doubleTake', weight: 1 },
  ],
  diplomatic: [
    { gesture: 'nod', weight: 4 },
    { gesture: 'acknowledge', weight: 3 },
    { gesture: 'acknowledgeMirrored', weight: 2 },
    { gesture: 'glance', weight: 3 },
    { gesture: 'scanRoom', weight: 2 },
    { gesture: 'cuffAdjustMirrored', weight: 2 },
    { gesture: 'checkWatch', weight: 1 },
    { gesture: 'weightSettle', weight: 2 },
  ],
  deskWork: [
    { gesture: 'nod', weight: 3 },
    { gesture: 'glance', weight: 3 },
    { gesture: 'glanceMirrored', weight: 3 },
    { gesture: 'scanRoom', weight: 3 },
    { gesture: 'scanRoomMirrored', weight: 2 },
    { gesture: 'postureReset', weight: 2 },
    { gesture: 'rollShoulders', weight: 2 },
    { gesture: 'checkWatch', weight: 2 },
    { gesture: 'breathDeep', weight: 2 },
    { gesture: 'breathSigh', weight: 2 },
    { gesture: 'resolve', weight: 1 },
  ],
  // Seated with both hands on a folder: head and torso only, so nothing that
  // moves an arm and tears the hands off the prop. `scanRoom` is safe because
  // it drives only head, chest and spine.
  client: [
    { gesture: 'nod', weight: 3 },
    { gesture: 'glance', weight: 3 },
    { gesture: 'scanRoom', weight: 3 },
    { gesture: 'scanRoomMirrored', weight: 2 },
    { gesture: 'considerTilt', weight: 2 },
    { gesture: 'considerTiltMirrored', weight: 2 },
    { gesture: 'breathDeep', weight: 2 },
  ],
  seatedGuest: [
    { gesture: 'nod', weight: 3 },
    { gesture: 'glance', weight: 4 },
    { gesture: 'glanceMirrored', weight: 3 },
    { gesture: 'scanRoom', weight: 3 },
    { gesture: 'scanRoomMirrored', weight: 2 },
    { gesture: 'considerTilt', weight: 2 },
    { gesture: 'considerTiltMirrored', weight: 2 },
    { gesture: 'breathDeep', weight: 3 },
  ],
}

/**
 * The rare beats, on their own much longer clock.
 *
 * A repertoire fired at random is still a repertoire, and the thing that
 * eventually gives one away is not that a beat repeats - with mirroring and a
 * continuous size and speed, an exact repeat effectively never happens - but
 * that every beat is drawn from the same distribution, so after a minute or
 * two the viewer has seen the whole *range* and nothing surprises them again.
 *
 * These are held back from that draw entirely and fired perhaps twice in ten
 * minutes, at full size and a little slower than authored. They are the beats
 * with a pose in them: arms folded for four seconds, a hand at the chin, a
 * long look at something across the room. Their job is not to add variety to
 * the minute they land in, it is to make the character look like it has been
 * doing something other than waiting for you the whole time.
 *
 * Roles with an empty list simply never fire one, which is right for anything
 * in the background: a receptionist who folds her arms for five seconds is a
 * receptionist the eye is now following.
 */
const SIGNATURES: Record<BehaviorRole, HumanoidGesture[]> = {
  portraitHero: ['foldArms', 'handToChin', 'handToChinMirrored', 'turnAway', 'turnAwayMirrored', 'stretch'],
  portrait: ['handToChin', 'handToChinMirrored', 'turnAway', 'turnAwayMirrored'],
  reception: [],
  investigation: ['foldArms'],
  diplomatic: [],
  deskWork: [],
  client: [],
  seatedGuest: [],
}

/** Seconds between signature beats: several minutes, jittered hard. */
const SIGNATURE_GAP: [number, number] = [95, 240]

/**
 * How far a beat's amplitude and playback rate are allowed to wander.
 *
 * These ranges are what stop the repertoire from becoming a longer loop
 * instead of no loop. Twelve gestures fired in random order is still twelve
 * recognisable performances, and a viewer learns them; the same twelve at a
 * freely chosen size and speed are effectively never the same twice. The
 * bounds are set by legibility rather than by taste - below about half
 * amplitude a beat stops being readable at all, and outside roughly a quarter
 * either side of the authored rate the timing stops matching the weight of the
 * body doing it.
 */
const AMPLITUDE_RANGE: [number, number] = [.55, 1]
const RATE_RANGE: [number, number] = [.82, 1.24]

/**
 * How many performances back the picker remembers, and how hard it tries.
 *
 * Choosing size and rate from a continuous range makes an exact repeat
 * essentially impossible, but that is not the bar - the bar is whether a
 * repeat is *recognisable*, and two nods within 2% of each other in both size
 * and speed are the same nod as far as anyone watching is concerned. Left to
 * chance those turn up about once every few hundred beats, which is once every
 * twenty minutes or so on a portrait: rare enough to be invisible in testing
 * and frequent enough to be seen.
 *
 * So the roll is not left to chance. Each beat draws several candidates and
 * keeps whichever sits furthest from every recent performance of the same
 * gesture, which costs a handful of comparisons a few times a minute and turns
 * "unlikely to collide" into "actively spread out". The window is eight beats,
 * about a minute of screen time, past which nobody is comparing.
 */
const PERFORMANCE_MEMORY = 8
const PERFORMANCE_CANDIDATES = 4

type Scheduled = {
  actor: HumanoidActor
  /** Mutable: a character that walks away from its desk stops being a desk
   *  worker for as long as it is standing. See `setRole`. */
  role: BehaviorRole
  /** Seconds until the next beat change. */
  remaining: number
  /** Seconds until the next small reaction. */
  fillerRemaining: number
  /** Seconds until the next rare, held beat. */
  signatureRemaining: number
  random: number
  /** Set while the caller is driving this actor directly, e.g. walking it
   *  somewhere. Ambient beats resume once the caller releases it. */
  suspended: boolean
  /** The last two beats played, which the picker avoids. One would not be
   *  enough: with a dozen options, banning only the immediate predecessor
   *  still produces A-B-A often enough to notice. */
  recent: HumanoidGesture[]
  /** The last few performances in full, so a repeat of the same beat can be
   *  pushed away from how it was played last time. */
  history: Array<{ gesture: HumanoidGesture; amplitude: number; timeScale: number }>
  /**
   * The resting stances most recently drifted through.
   *
   * Excluding only the stance currently held - which is what this used to do -
   * leaves the sequence free to go A, B, A, B indefinitely, and a two-cycle is
   * the easiest pattern of all for an eye to pick up. It is also the *most
   * likely* sequence under a weighted draw from four options, because at every
   * change the stance just left is the single most available alternative.
   * Remembering two and refusing both turns four stances into a genuine
   * shuffle: the next one is always one of the two the viewer has not seen
   * recently.
   */
  recentStates: HumanoidState[]
}

/** Small deterministic PRNG so a scene replays identically across reloads. */
function nextRandom(state: number) {
  return (Math.imul(state, 1664525) + 1013904223) >>> 0
}

function pickWeighted<T extends { weight: number }>(entries: readonly T[], roll: number) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0)
  let cursor = roll * total
  for (const entry of entries) {
    cursor -= entry.weight
    if (cursor <= 0) return entry
  }
  return entries[entries.length - 1]
}

export class HumanoidBehaviorDirector {
  private readonly entries: Scheduled[] = []

  add(actor: HumanoidActor, role: BehaviorRole, seed: number) {
    const random = nextRandom(seed >>> 0)
    const entry: Scheduled = {
      actor,
      role,
      // Stagger the first change so a scene does not switch over all at once
      // a fixed number of seconds after it loads.
      remaining: 2 + (random % 1000) / 1000 * 9,
      fillerRemaining: 1.5 + (random % 700) / 700 * 6,
      // Never on the first minute. A held pose within seconds of the panel
      // opening reads as the character's greeting rather than as something it
      // was already doing.
      signatureRemaining: 45 + (random % 900) / 900 * 60,
      random,
      suspended: false,
      recent: [],
      history: [],
      recentStates: [],
    }
    this.entries.push(entry)
    return entry
  }

  remove(actor: HumanoidActor) {
    const index = this.entries.findIndex((entry) => entry.actor === actor)
    if (index >= 0) this.entries.splice(index, 1)
  }

  /**
   * Switches an actor to a different repertoire.
   *
   * A role is not a fixed property of a character, it is a property of where
   * they currently are. The repertoires are written around what the body can
   * plausibly do from its present posture, and the desk repertoires are seated
   * ones: hand a desk role to someone who has got up and walked across the
   * room and the scheduler will, entirely reasonably by its own lights, put
   * them back into `seatedType` - which is a fully committed sitting pose,
   * folded at the hips and knees, played by a body standing in open floor.
   * That reads exactly as "that character does not stand straight", and it is
   * not a posture bug at all: the pose is correct and the character is in the
   * wrong place for it. Callers that move a character between contexts are
   * expected to move its role with it.
   *
   * The current beat is left alone and the countdown is restarted, so the
   * change takes effect at the next natural beat rather than by cutting the
   * pose the character is holding right now.
   */
  setRole(actor: HumanoidActor, role: BehaviorRole) {
    const entry = this.entries.find((item) => item.actor === actor)
    if (!entry || entry.role === role) return
    entry.role = role
    entry.remaining = Math.min(entry.remaining, .6 + (entry.random % 300) / 300 * 1.4)
    entry.recent.length = 0
  }

  /** Hands control of an actor to the caller, e.g. while it walks a route. */
  suspend(actor: HumanoidActor, suspended: boolean) {
    const entry = this.entries.find((item) => item.actor === actor)
    if (entry) {
      entry.suspended = suspended
      // Give it a fresh beat when it comes back rather than resuming a stale
      // countdown that may already have expired.
      if (!suspended) entry.remaining = 1.5 + (entry.random % 500) / 500 * 5
    }
  }

  /** Nudges an actor to look at something - another character walking past,
   *  or the player's attention landing on them. */
  notice(actor: HumanoidActor, gesture: HumanoidGesture = 'glance') {
    const entry = this.entries.find((item) => item.actor === actor)
    if (!entry || entry.suspended || actor.isPlayingGesture) return
    this.fire(entry, gesture)
    entry.fillerRemaining = 6 + (entry.random % 400) / 400 * 8
  }

  /** Rolls one number in [0, 1) and advances the entry's stream. */
  private roll(entry: Scheduled) {
    entry.random = nextRandom(entry.random)
    return entry.random / 4294967296
  }

  /** Plays a beat at a size and speed chosen for this occurrence. */
  private fire(
    entry: Scheduled,
    gesture: HumanoidGesture,
    amplitudeRange: readonly [number, number] = AMPLITUDE_RANGE,
    rateRange: readonly [number, number] = RATE_RANGE,
  ) {
    const priors = entry.history.filter((item) => item.gesture === gesture)
    let amplitude = 0
    let timeScale = 0
    let best = -1
    for (let candidate = 0; candidate < PERFORMANCE_CANDIDATES; candidate += 1) {
      const a = amplitudeRange[0] + this.roll(entry) * (amplitudeRange[1] - amplitudeRange[0])
      const t = rateRange[0] + this.roll(entry) * (rateRange[1] - rateRange[0])
      // Distance in units of each axis's own range, so neither dominates
      // purely because it is measured on a wider scale. A performance is far
      // from another if it differs a lot on *either* axis, which is why this
      // is a max and not a sum: a nod at the same size but half again the
      // speed is plainly a different nod.
      let nearest = Infinity
      for (const prior of priors) {
        nearest = Math.min(nearest, Math.max(
          Math.abs(a - prior.amplitude) / (amplitudeRange[1] - amplitudeRange[0]),
          Math.abs(t - prior.timeScale) / (rateRange[1] - rateRange[0]),
        ))
      }
      if (nearest > best) {
        best = nearest
        amplitude = a
        timeScale = t
      }
      // Nothing to be spread away from, so the first draw stands.
      if (!priors.length) break
    }

    // Fade length tracks the beat's own size. A small gesture arriving over
    // the same 0.3s as a big one reads as faster than it is, because what the
    // eye judges is angular speed rather than duration.
    const fade = .22 + amplitude * .16
    entry.actor.playGesture(gesture, { amplitude, timeScale, fade })
    entry.recent.push(gesture)
    if (entry.recent.length > 2) entry.recent.shift()
    entry.history.push({ gesture, amplitude, timeScale })
    if (entry.history.length > PERFORMANCE_MEMORY) entry.history.shift()
  }

  /**
   * Drifts to a new resting stance, over a crossfade of its own length.
   *
   * The fade is where a change of stance actually happens - the pelvis travels
   * several centimetres across between two of these clips, and the crossfade
   * is the only thing that moves it - so a fixed duration means every weight
   * transfer this character ever makes takes exactly the same time. Scaling
   * the authored figure by a quarter either way keeps the pairing (attention
   * arrives faster than it leaves) while making no two transfers the same
   * length, and because it multiplies the table rather than replacing it, the
   * relationships tuned there survive.
   */
  private drift(entry: Scheduled, beats: Beat[]) {
    const blocked = entry.recentStates
    let options = beats.filter((beat) => beat.state !== entry.actor.state && !blocked.includes(beat.state))
    // With three or fewer stances there may be nothing left once two are
    // banned, so the ban relaxes to just the current stance rather than
    // letting the character sit still through its own beat.
    if (!options.length) options = beats.filter((beat) => beat.state !== entry.actor.state)
    if (!options.length) options = beats
    const beat = pickWeighted(options, this.roll(entry))
    entry.actor.setState(beat.state, humanoidTransitionFade(entry.actor.state, beat.state) * (.78 + this.roll(entry) * .5))
    entry.recentStates.push(beat.state)
    if (entry.recentStates.length > 2) entry.recentStates.shift()
    return beat.hold[0] + (beat.hold[1] - beat.hold[0]) * this.roll(entry)
  }

  update(delta: number) {
    for (const entry of this.entries) {
      if (entry.suspended) continue
      const beats = REPERTOIRE[entry.role]
      // A reduced-motion actor holds one still pose, and it holds whatever was
      // last asked of it until the page closes, because nothing advances to
      // end a gesture. Ambient beats are exactly the wrong thing to leave a
      // character stuck in: they are one-off punctuation, so freezing on one
      // strands the figure mid-bow or mid-stretch forever. States are still
      // allowed to drift, since every state is a legitimate standing pose.
      const ambient = !entry.actor.isReduced

      entry.remaining -= delta
      if (entry.remaining <= 0) entry.remaining = this.drift(entry, beats)

      // The rare held beats get first refusal, and reset the ordinary filler
      // clock behind them. Letting a fidget land on top of a four-second pose
      // would cut the pose short, which is precisely the thing it exists not
      // to do.
      entry.signatureRemaining -= delta
      const signatures = SIGNATURES[entry.role]
      if (ambient && entry.signatureRemaining <= 0 && signatures.length && !entry.actor.isPlayingGesture) {
        const choice = signatures[Math.floor(this.roll(entry) * signatures.length) % signatures.length]
        // Full size, and slower than authored rather than faster. These are the
        // beats with a hold in them and the hold is the content; playing one
        // quickly turns it back into a fidget.
        this.fire(entry, choice, [.92, 1], [.84, .98])
        entry.signatureRemaining = SIGNATURE_GAP[0] + this.roll(entry) * (SIGNATURE_GAP[1] - SIGNATURE_GAP[0])
        entry.fillerRemaining = 4 + this.roll(entry) * 5
        continue
      }

      entry.fillerRemaining -= delta
      if (ambient && entry.fillerRemaining <= 0 && !entry.actor.isPlayingGesture) {
        const repertoire = FILLERS[entry.role]
        const fresh = repertoire.filter((option) => !entry.recent.includes(option.gesture))
        this.fire(entry, pickWeighted(fresh.length ? fresh : repertoire, this.roll(entry)).gesture)
        // Irregular, and short enough that the body is rarely doing nothing
        // at all. The gap is what the old scheduler got wrong for a close-up
        // surface: five to seventeen seconds between beats is fine for a
        // background figure across a room, and reads as a mannequin with an
        // occasional twitch when the character fills the frame.
        //
        // The hero is tighter again. Most of its beats are additive and ride
        // over an idle that never stops, so a new one starting while the last
        // is still unwinding is not a collision - it is two overlapping
        // impulses on the same body, which is what continuous motion is made
        // of. The floor is a second and a half rather than zero only so that
        // two beats never stack hard enough to double an angle.
        const close = entry.role === 'portrait' || entry.role === 'portraitHero'
        const floor = entry.role === 'portraitHero' ? 1.6 : close ? 2.2 : 3
        const spread = entry.role === 'portraitHero' ? 4.4 : close ? 5.5 : 7
        entry.fillerRemaining = floor + this.roll(entry) * spread
      }
    }
  }
}
