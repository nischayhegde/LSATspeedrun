import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { bindHumanoidSkeleton } from '../app-art/rig'
import { buildStylizedCounsel, type StylizedCounselRig } from '../app-art/stylized-counsel'
import { retargetHumanoidClips } from './counsel-retarget'
import { STAGE_COUNSEL_LOOK } from './stage-counsel'

/**
 * The counsel who walks on slide 10: the deck's own stylized character, moving
 * on an animator's clips.
 *
 * ## Why it is built this way round
 *
 * Two things were both true and looked contradictory. The stylized rig is the
 * deck's art — it is the man on the close slide, the cast in the office, the
 * crowd on the map — and putting a different character on slide 10 leaves two
 * different men playing the founder in one deck. But that rig had also failed
 * ten review passes trying to walk, because its motion was hand-authored joint
 * curves and a walk is not something you can write one joint at a time.
 *
 * Only the *motion* had to come from somewhere else, so only the motion does.
 * `counsel-suit.glb` is loaded for its animation curves, sampled onto this
 * skeleton by `counsel-retarget`, and dropped; not one triangle of it is
 * drawn. What the audience sees is `buildStylizedCounsel` with the same look
 * the close slide uses, and what it does is a real Idle, Walk and backpedal.
 *
 * ## The two traps this rig sets, and where they are handled
 *
 * **Contrapposto in the bind.** `buildStylizedCounsel` bakes a standing
 * weight-shift into its rest pose, and `HumanoidActor` — the way every other
 * scene drives this rig — re-applies that as `restOffsets` on top of every
 * clip, every frame. That is what sheared the torso off the hips on a
 * full-figure walk. Nothing here goes through the actor at all: the retargeted
 * clips are authored against the library's canonical square rest and are
 * absolute, so every joint is written by the clip and nothing is layered on
 * afterwards.
 *
 * **The soles are not at the origin.** The rig varies height by moving the
 * pelvis over fixed-length legs, so its bind pose floats about a fifth of a
 * unit. `bindHumanoidSkeleton` measures that as `soleOffset` and the pelvis is
 * lowered by it here, before anything is baked, so the clips are authored
 * against a body already standing on the floor.
 */

/** Where the motion comes from. See `counsel-retarget` and the models README. */
const MOTION_URL = '/models/counsel-suit.glb'

/** Clip names in the file are `CharacterArmature|<name>`. */
export type CounselClip = 'Idle_Neutral' | 'Walk' | 'Run_Back'

const CLIP_NAMES: readonly CounselClip[] = ['Idle_Neutral', 'Walk', 'Run_Back']

/**
 * A locomotion clip's ground speed, read out of its own planted foot.
 *
 * Signed along the character's facing: `Walk` is positive, `Run_Back` — which
 * is a backpedal, feet forwards, body going the other way — is negative.
 */
export type Stride = {
  /**
   * World units the body has covered by `phase` of the cycle. Not assumed:
   * this is the distance the clip's own support foot dragged through the body,
   * which is the only definition under which the sole holds still.
   */
  at(phase: number): number
  /** The phase at which `at` first reaches `distance`. Signs must agree. */
  phaseFor(distance: number): number
  /** Signed world units per cycle. */
  readonly cycle: number
  /** Seconds per cycle at `timeScale` 1. */
  readonly duration: number
}

/** The joints the scene addresses. Named for what they do, not for the rig. */
export type CounselJoints = {
  hips: THREE.Object3D
  torso: THREE.Object3D
  chest: THREE.Object3D
  head: THREE.Object3D
  shoulderL: THREE.Object3D
  shoulderR: THREE.Object3D
  elbowR: THREE.Object3D
  handR: THREE.Object3D
  hipL: THREE.Object3D
  hipR: THREE.Object3D
  footL: THREE.Object3D
  footR: THREE.Object3D
}

export type CounselModel = {
  /** Drives locomotion. Move this, not `figure`. */
  readonly holder: THREE.Group
  /** The scaled character. */
  readonly figure: THREE.Group
  readonly joints: CounselJoints
  /**
   * The contact point of a grip, in `joints.handR`'s own frame.
   *
   * A point in the fingers rather than the wrist pivot, so that closing the
   * hand does not move what it is holding.
   */
  readonly gripLocal: THREE.Vector3
  readonly mixer: THREE.AnimationMixer
  readonly actions: Record<CounselClip, THREE.AnimationAction>
  /** World height of the standing figure, at the applied scale. */
  readonly height: number
  /**
   * World height of the lowest point of the standing figure — the bottom of
   * the shoe — at the applied scale. Zero means he is standing on the deck.
   *
   * Measured off the geometry rather than off a joint: the ankle sits a
   * shoe's depth above the floor by construction, so a bone position can only
   * ever say whether the floor *moved*, not where it is.
   */
  readonly soleRest: number
  readonly stride: Record<'Walk' | 'Run_Back', Stride>
  /** Close the right hand. 0 open, 1 gripping. */
  setGrip(weight: number): void
  dispose(): void
}

let cached: Promise<{ scene: THREE.Group; clips: Map<string, THREE.AnimationClip> }> | null = null

/**
 * The motion source, parsed once per document.
 *
 * Kept whole rather than reduced to clips: the retarget reads the source's
 * *rest pose* off the rig itself, and a clip on its own does not carry one.
 */
function loadMotion() {
  if (!cached) {
    cached = new Promise((resolve, reject) => {
      new GLTFLoader().load(
        MOTION_URL,
        (gltf) => {
          const clips = new Map<string, THREE.AnimationClip>()
          for (const name of CLIP_NAMES) {
            const found = gltf.animations.find(
              (clip) => clip.name === `CharacterArmature|${name}` || clip.name === name,
            )
            if (!found) {
              reject(new Error(`counsel-model: the motion file has no "${name}" clip`))
              return
            }
            clips.set(name, found)
          }
          resolve({ scene: gltf.scene as THREE.Group, clips })
        },
        undefined,
        (error) => { cached = null; reject(error) },
      )
    })
  }
  return cached
}

const STRIDE_SAMPLES = 256

/**
 * Read a locomotion clip's ground speed out of its own planted foot.
 *
 * Sample the cycle; at each step take the *lower* foot — the one bearing
 * weight — and record however far it slid through the body's frame. Negate it,
 * and that is how far the body travelled: a support foot going backwards
 * through the body is a body going forwards over the ground, and the whole
 * point of doing this rather than picking a speed by eye is that it is the only
 * body speed at which the sole is stationary in world space.
 *
 * ## Three things this has to get right, and used to get wrong
 *
 * **The handover contributes nothing.** Which foot is bearing weight is decided
 * per sample, but the displacement being accumulated spans the interval *before*
 * it. On the sample where support changes feet, the newly-planted foot spent
 * that interval swinging forward at twice body speed — so counting it reports
 * the body as having lurched backwards. It happens twice a cycle, every cycle,
 * and it was the whole of this scene's jitter: about seven centimetres of the
 * body reversing direction each stride, written straight through the grip into
 * the incoming slide's transform. An interval whose support foot is not the
 * same at both ends is simply not evidence about anything, and is skipped.
 *
 * **A flight phase is not a stance.** `Run_Back` is a run: there are samples
 * where neither foot is down and the lower of the two is merely the less
 * airborne. Its motion is swing, not ground contact, and integrating it says
 * the body did something it did not. Contact is judged against the clip's own
 * lowest foot, so it needs no units and no guess about scale.
 *
 * **The body does not move backwards.** After the above there is still sampling
 * noise, and noise in *this* curve is not cosmetic: locomotion reads its ground
 * position straight off it every frame, so a curve that dithers is a body that
 * dithers and a slide that shudders. The curve is therefore forced monotonic
 * and smoothed around the loop, then rescaled so the distance per cycle is
 * still the one that was measured — which is what keeps the sole planted.
 */
function measureStride(
  model: THREE.Object3D,
  mixer: THREE.AnimationMixer,
  action: THREE.AnimationAction,
  left: THREE.Object3D,
  right: THREE.Object3D,
) {
  mixer.stopAllAction()
  action.reset().setEffectiveWeight(1).play()

  const duration = action.getClip().duration
  const localLeft = new THREE.Vector3()
  const localRight = new THREE.Vector3()

  // --- what the feet do, sampled once -----------------------------------------
  const z: [number, number][] = []
  const y: [number, number][] = []
  for (let index = 0; index <= STRIDE_SAMPLES; index += 1) {
    mixer.setTime((index / STRIDE_SAMPLES) * duration)
    model.updateWorldMatrix(true, true)
    left.getWorldPosition(localLeft)
    right.getWorldPosition(localRight)
    model.worldToLocal(localLeft)
    model.worldToLocal(localRight)
    z.push([localLeft.z, localRight.z])
    y.push([localLeft.y, localRight.y])
  }

  mixer.setTime(0)
  action.stop()

  // Contact is anything within a fifth of the foot's own vertical travel of the
  // lowest it ever gets. Expressed in the clip's own range so it holds for a
  // shuffle and for a run alike.
  const lows = y.map((pair) => Math.min(pair[0], pair[1]))
  const floor = Math.min(...lows)
  const band = floor + (Math.max(...lows) - floor) * .2

  /** Per-interval body displacement, or null where the clip is not evidence. */
  const steps: (number | null)[] = []
  for (let index = 1; index <= STRIDE_SAMPLES; index += 1) {
    const wasLeft = y[index - 1][0] < y[index - 1][1]
    const nowLeft = y[index][0] < y[index][1]
    const side = nowLeft ? 0 : 1
    const planted = y[index][side] <= band && y[index - 1][side] <= band
    steps.push(wasLeft === nowLeft && planted ? -(z[index][side] - z[index - 1][side]) : null)
  }

  // Gaps take the average of what was actually observed. A run spends real time
  // airborne and the body keeps travelling through it; the alternative — zero —
  // would say it hangs still in the air, which is both wrong and a hitch.
  const seen = steps.filter((s): s is number => s !== null)
  const mean = seen.length ? seen.reduce((t, v) => t + v, 0) / seen.length : 0
  const filled = steps.map((s) => s ?? mean)

  // Monotonic in the direction of travel, then smoothed around the loop. Both
  // are about the *body*: it does not reverse mid-stride and it does not judder,
  // whatever the noise in a foot's measured height says.
  const sign = Math.sign(filled.reduce((t, v) => t + v, 0)) || 1
  const forward = filled.map((s) => (s * sign > 0 ? s : 0))
  // A fifth of a cycle. Wide enough to take out the once-per-stride surge that
  // the eye reads as a lurch when the whole screen is hung off it, narrow enough
  // to leave the cycle's overall shape alone. Swept: below this the surge
  // survives, above it nothing further is gained and the sole starts to drift.
  const span = Math.round(STRIDE_SAMPLES / 5)
  const smooth = forward.map((_, index) => {
    let total = 0
    for (let k = -span; k <= span; k += 1) {
      total += forward[(index + k + forward.length * 2) % forward.length]
    }
    return total / (span * 2 + 1)
  })

  // Rescale to the distance actually covered. Smoothing preserves a sum only in
  // the interior; wrapping a cycle makes that exact, but the monotonic clamp
  // above does not, so the total is restored explicitly. This is the number the
  // foot-lock depends on — everything else here is about how it is spread.
  const raw = forward.reduce((t, v) => t + v, 0)
  const got = smooth.reduce((t, v) => t + v, 0)
  const fix = Math.abs(got) > 1e-12 ? raw / got : 1

  const table = new Float64Array(STRIDE_SAMPLES + 1)
  for (let index = 1; index <= STRIDE_SAMPLES; index += 1) {
    table[index] = table[index - 1] + smooth[index - 1] * fix
  }
  return { table, cycle: table[STRIDE_SAMPLES], duration }
}

/** Wrap a measured cycle into the world-scaled `Stride` the scene consumes. */
function toStride(
  raw: { table: Float64Array; cycle: number; duration: number },
  scale: number,
): Stride {
  const { table, duration } = raw
  const cycle = raw.cycle * scale
  const sign = Math.sign(raw.cycle) || 1

  const at = (phase: number) => {
    const cycles = Math.floor(phase)
    const spot = (phase - cycles) * STRIDE_SAMPLES
    const index = Math.min(STRIDE_SAMPLES - 1, Math.floor(spot))
    const blend = spot - index
    const within = table[index] + (table[index + 1] - table[index]) * blend
    return (cycles * raw.cycle + within) * scale
  }

  // First crossing rather than a bisection: the curve rises across cycles but
  // dips inside them, so a halving search can converge on the wrong branch and
  // report a phase whose distance is not the one asked for. A forward scan
  // always lands on a real crossing, and it runs twice per resize.
  const phaseFor = (distance: number) => {
    const want = distance / scale
    if (Math.abs(want) < 1e-9) return 0
    const cycles = Math.max(0, Math.floor(want / raw.cycle) - 1)
    for (let step = 0; step < 4096; step += 1) {
      const base = (cycles + Math.floor(step / STRIDE_SAMPLES)) * raw.cycle
      const index = step % STRIDE_SAMPLES
      const low = base + table[index]
      const high = base + table[index + 1]
      if ((want - low) * sign >= 0 && (want - high) * sign <= 0) {
        const span = high - low
        const blend = Math.abs(span) > 1e-12 ? (want - low) / span : 0
        return cycles + Math.floor(step / STRIDE_SAMPLES) + (index + blend) / STRIDE_SAMPLES
      }
    }
    return want / raw.cycle
  }

  return { at, phaseFor, cycle, duration }
}

/**
 * The finger mass and the thumb, picked out of the hand by where they sit.
 *
 * This rig models a hand as a palm, one closed finger slab and a thumb, and
 * gives none of them names — at office scale they are four pixels and nothing
 * ever needed to address them. The slab is the child furthest down the hand
 * and the thumb is the one furthest out to the side, which is true of a hand
 * in a way that an index into `children` is not.
 */
function handParts(hand: THREE.Object3D) {
  let fingers: THREE.Object3D | null = null
  let thumb: THREE.Object3D | null = null
  for (const child of hand.children) {
    if (!fingers || child.position.y < fingers.position.y) fingers = child
    if (!thumb || Math.abs(child.position.x) > Math.abs(thumb.position.x)) thumb = child
  }
  if (fingers && thumb && fingers === thumb) thumb = null
  return { fingers, thumb }
}

export async function loadCounselModel(targetHeight: number): Promise<CounselModel> {
  const motion = await loadMotion()

  const rig: StylizedCounselRig = buildStylizedCounsel('male', 13, STAGE_COUNSEL_LOOK)
  rig.satchel.visible = false
  rig.root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) node.castShadow = true
  })

  const figure = new THREE.Group()
  figure.add(rig.root)
  const holder = new THREE.Group()
  holder.add(figure)
  holder.updateWorldMatrix(true, true)

  const skeleton = bindHumanoidSkeleton(rig)
  // Put the soles on the floor before anything is measured or baked. Every
  // consumer treats the holder's origin as the ground; the bind pose does not.
  rig.hips.position.y -= skeleton.proportions.soleOffset
  holder.updateWorldMatrix(true, true)

  // The motion rig is sampled, not shown, and two scenes can be alive at once
  // (`stage.ts` keeps a warm copy), so each retarget gets its own instance to
  // wind through its clips.
  const source = motion.scene.clone(true)
  const { clips } = retargetHumanoidClips(source, motion.clips, skeleton)

  // Height off the standing pose, which the retarget leaves the rig in. These
  // are ordinary meshes rather than a `SkinnedMesh`, so the box is the truth.
  //
  // Both ends of the box are wanted, and the bottom one is not zero. The
  // retarget lowers the pelvis a few centimetres so this rig carries the same
  // slack in the knee that the source clips were authored against — without
  // which every long stride asks for an ankle further away than a locked leg
  // can reach. That drop is measured from the hips, so it puts the shoes
  // *through* the floor: about two and a half centimetres of the sole under
  // the deck, hidden by the contact shadow and real all the same.
  //
  // So the figure is scaled by the height it actually occupies and then lifted
  // by however far it sank, which lands the shoe on nought and the top of the
  // head on `targetHeight`. Doing this before the clips are sampled would not
  // work — the drop is what makes them reachable — and doing it by moving the
  // pelvis back up would undo it. It is a placement, so the placement moves.
  const bounds = new THREE.Box3().setFromObject(rig.root)
  const scale = targetHeight / Math.max(1e-6, bounds.max.y - bounds.min.y)
  figure.scale.setScalar(scale)
  figure.position.y = -bounds.min.y * scale
  holder.updateWorldMatrix(true, true)

  // Re-measured after placing rather than derived from the numbers above, so
  // what the scene reports as its ground plane is where the shoe actually is.
  const placed = new THREE.Box3().setFromObject(holder)

  const joints: CounselJoints = {
    hips: rig.hips,
    torso: rig.spine,
    chest: rig.chest,
    head: rig.head,
    shoulderL: rig.leftShoulder,
    shoulderR: rig.rightShoulder,
    elbowR: rig.rightElbow,
    handR: rig.rightHand,
    hipL: rig.leftHip,
    hipR: rig.rightHip,
    footL: rig.leftFoot,
    footR: rig.rightFoot,
  }

  const mixer = new THREE.AnimationMixer(figure)
  const actions = {} as Record<CounselClip, THREE.AnimationAction>
  for (const name of CLIP_NAMES) {
    const clip = clips.get(name)
    if (!clip) throw new Error(`counsel-model: retarget produced no "${name}"`)
    const action = mixer.clipAction(clip)
    action.enabled = true
    actions[name] = action
  }

  const stride = {
    Walk: toStride(measureStride(figure, mixer, actions.Walk, joints.footL, joints.footR), scale),
    Run_Back: toStride(measureStride(figure, mixer, actions.Run_Back, joints.footL, joints.footR), scale),
  }
  mixer.stopAllAction()
  mixer.setTime(0)

  // The grip point, two thirds of the way down the hand and on its centre
  // line: the pad of a closed hand, which is the part that goes round an edge.
  const handBox = new THREE.Box3()
  const toHand = new THREE.Matrix4().copy(joints.handR.matrixWorld).invert()
  const meshBox = new THREE.Box3()
  const meshMatrix = new THREE.Matrix4()
  joints.handR.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    const bounds = mesh.geometry.boundingBox
    if (!bounds) return
    meshMatrix.multiplyMatrices(toHand, mesh.matrixWorld)
    meshBox.copy(bounds).applyMatrix4(meshMatrix)
    handBox.union(meshBox)
  })
  const gripLocal = handBox.isEmpty()
    ? new THREE.Vector3(0, -.2, .02)
    : new THREE.Vector3(0, THREE.MathUtils.lerp(handBox.max.y, handBox.min.y, .78), handBox.getCenter(new THREE.Vector3()).z)

  const { fingers, thumb } = handParts(joints.handR)
  const fingersRest = fingers?.rotation.x ?? 0
  const thumbRest = thumb ? { x: thumb.rotation.x, z: thumb.rotation.z } : null

  return {
    holder,
    figure,
    joints,
    gripLocal,
    mixer,
    actions,
    height: placed.max.y - placed.min.y,
    soleRest: placed.min.y,
    stride,
    setGrip(weight: number) {
      const w = THREE.MathUtils.clamp(weight, 0, 1)
      // A hand that is one slab and one thumb cannot make a fist, but it can
      // close, and closing is what has to read: the slab rolls in under the
      // palm and the thumb comes across it.
      if (fingers) fingers.rotation.x = fingersRest - .95 * w
      if (thumb && thumbRest) {
        thumb.rotation.x = thumbRest.x - .5 * w
        thumb.rotation.z = thumbRest.z + .3 * w
      }
    },
    dispose() {
      mixer.stopAllAction()
      mixer.uncacheRoot(figure)
      holder.removeFromParent()
    },
  }
}
