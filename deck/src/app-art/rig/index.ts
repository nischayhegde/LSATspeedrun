/**
 * Humanoid skeletal animation for the app's existing stylized characters.
 *
 * The art is unchanged: this system binds the characters that
 * `buildStylizedCounsel` already produces to a Mixamo-standard humanoid joint
 * hierarchy and drives them with authored humanoid clips through
 * `THREE.AnimationMixer`, replacing per-frame trigonometry with real clips and
 * real crossfades.
 *
 * See `humanoid-clips.ts` for the licensing position: every clip is authored
 * in this repository from published gait-biomechanics description, so no
 * third-party asset or licence is involved.
 */

export {
  HumanoidActor,
  assignHumanoidLod,
  type HumanoidActorOptions,
  type HumanoidGesture,
  type HumanoidLod,
  type HumanoidState,
} from './humanoid-actor'

export {
  HumanoidBehaviorDirector,
  type BehaviorRole,
} from './humanoid-behavior'

export {
  HUMANOID_BONES,
  HUMANOID_NODE_NAMES,
  applyWorldQuaternion,
  bindHumanoidSkeleton,
  canonicalRestQuaternion,
  clampJoint,
  solveLegIK,
  type BindableRig,
  type HumanoidBone,
  type HumanoidProportions,
  type HumanoidSkeleton,
} from './humanoid-rig'

export { humanoidClipLibrary, warmHumanoidClips, type ClipMeta } from './humanoid-clips'

export {
  NavAgent,
  NavField,
  mergeRects,
  scanObstacleRects,
  type NavAgentOptions,
  type NavFieldOptions,
  type NavPoint,
  type NavRect,
  type ObstacleScanOptions,
  type ScannableObject,
} from './nav-floor'
