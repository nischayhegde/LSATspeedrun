import type { StylizedCounselRig } from '../app-art/stylized-counsel'

/**
 * The counsel who stands on slide 10 and on the close: fair skin (seed 1 is
 * `skinColors[0]` `#f6d2b8`), auburn hair, side part, no round glasses.
 *
 * Seed 77014 hashed to a dark skin index and the gold-foulard / round-frame
 * look the founders just rejected. Seed 1 is the fairest bin; hair colour is
 * authored rather than rolled so it cannot drift back to near-black.
 */
export const STAGE_COUNSEL_LOOK = {
  role: 'counsel' as const,
  paletteSeed: 1,
  renderScale: 1,
  suitColor: 0x1f4163,
  hairColor: 0x8b3a24,
  hairVariant: 0 as const,
  eyewear: 'none' as const,
  cosmetics: {
    tie: 'tie_house_burgundy',
    accessory: 'accessory_lapel_pin',
  },
}

/**
 * Square standing. Call AFTER `HumanoidActor.update`.
 *
 * Cause of the shear, measured not assumed:
 *
 * 1. `buildStylizedCounsel` bakes contrapposto into the bind: `rightHip.y`
 *    ≈ 0.092 rad of turnout, plus a loaded-leg knee bend and hip.x.
 * 2. `HumanoidActor` captures that as `restOffsets` and `premultiply`s it
 *    onto every clip, every frame — including standing `idle`.
 * 3. The idle clip then yaws the *hips group* (`hips.y` ±1.2°). Foot IK
 *    keeps the soles where they were planted, so the legs stretch
 *    diagonally while the chest, driven separately, still faces the lens.
 *
 * Overwriting pelvis yaw and the whole leg chain after the actor runs is
 * the last word, the same way the close overwrites the arms for the fold.
 */
export function applyStandingLegs(counsel: StylizedCounselRig) {
  counsel.hips.rotation.set(0, 0, 0)
  counsel.leftHip.rotation.set(0, 0, -.03)
  counsel.rightHip.rotation.set(0, 0, .03)
  counsel.leftKnee.rotation.set(.06, 0, 0)
  counsel.rightKnee.rotation.set(.06, 0, 0)
  counsel.leftFoot.rotation.set(-.04, 0, 0)
  counsel.rightFoot.rotation.set(-.04, 0, 0)
}

export function closeStance(counsel: StylizedCounselRig) {
  counsel.leftHip.position.x = -.19
  counsel.rightHip.position.x = .19
}
