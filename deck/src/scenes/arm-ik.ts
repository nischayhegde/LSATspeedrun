import * as THREE from 'three'

/**
 * A two-bone analytic IK constraint, layered on top of whatever a baked clip
 * has already put on the bones this frame.
 *
 * ## Why the grab needs this at all
 *
 * The counsel has to finish his reach with his fingers *on* the left edge of
 * the incoming slide, and that edge is a DOM element whose position is decided
 * by the viewport, not by the animation. No baked clip can know where it is. So
 * the arm is authored by the clip right up to the moment of contact and then
 * bent, by exactly as much as it takes, to land the hand on a world point the
 * scene computes from the camera projection. Every earlier attempt posed the
 * arm by hand and then moved the slide to wherever the hand happened to be,
 * which is the same thing backwards and is why the contact never registered.
 *
 * ## Why analytic rather than CCD
 *
 * CCD is three lines shorter and gives a different elbow every frame — it
 * converges to whatever configuration is nearest the last one, so the arm rolls
 * as the target moves and the elbow can end up above the shoulder. The closed
 * form places the elbow on a circle and a pole vector picks the point on it, so
 * the elbow is wherever the pole says and nowhere else, which is what makes the
 * pose hold still while the body walks under it.
 *
 * ## Working in world space
 *
 * Both rotations are computed as world-space swings and converted back through
 * the parent's inverse. That is deliberate: it means the solver needs to know
 * nothing about how the exporter happened to orient the bind pose — which for
 * this FBX-converted rig is not aligned to any axis you would guess — and the
 * same class works on the left arm, the right arm, or a leg.
 */
export class TwoBoneIk {
  private readonly upper: THREE.Object3D
  private readonly lower: THREE.Object3D
  private readonly tip: THREE.Object3D
  private readonly tipOffset: THREE.Vector3
  /** Bind lengths, measured once. The solve never changes them. */
  readonly upperLength: number
  readonly lowerLength: number
  /** Last solve's demanded reach as a fraction of what the chain can span. */
  reachRatio = 0

  private readonly root = new THREE.Vector3()
  private readonly joint = new THREE.Vector3()
  private readonly end = new THREE.Vector3()
  private readonly toTarget = new THREE.Vector3()
  private readonly desired = new THREE.Vector3()
  private readonly axis = new THREE.Vector3()
  private readonly from = new THREE.Vector3()
  private readonly to = new THREE.Vector3()
  private readonly swing = new THREE.Quaternion()
  private readonly parent = new THREE.Quaternion()
  private readonly world = new THREE.Quaternion()
  private readonly before = new THREE.Quaternion()

  /**
   * @param tipOffset the effector, in `tip`'s local space. For a grip this is
   *   a point in the fingers rather than the wrist pivot, so that closing the
   *   hand does not move the contact point.
   */
  constructor(upper: THREE.Object3D, lower: THREE.Object3D, tip: THREE.Object3D, tipOffset: THREE.Vector3) {
    this.upper = upper
    this.lower = lower
    this.tip = tip
    this.tipOffset = tipOffset.clone()

    upper.updateWorldMatrix(true, true)
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = this.tipOffset.clone()
    upper.getWorldPosition(a)
    lower.getWorldPosition(b)
    tip.localToWorld(c)
    this.upperLength = a.distanceTo(b)
    this.lowerLength = b.distanceTo(c)
  }

  /** Where the effector currently is, in world space. */
  effector(out: THREE.Vector3) {
    return out.copy(this.tipOffset).applyMatrix4(this.tip.matrixWorld)
  }

  /**
   * Bend the chain so the effector reaches `target`.
   *
   * `pole` is a world point the elbow is pulled towards; it only has to be
   * roughly right, since it is projected onto the plane perpendicular to the
   * shoulder→target line. `weight` blends the result against the pose the clip
   * left on the bones, so a reach can fade in without the arm snapping.
   */
  solve(target: THREE.Vector3, pole: THREE.Vector3, weight: number) {
    const blend = THREE.MathUtils.clamp(weight, 0, 1)
    if (blend <= 0) return

    const a = this.upperLength

    this.upper.updateWorldMatrix(true, false)
    this.upper.getWorldPosition(this.root)

    // The second bone's length is measured now, not at bind. The effector is a
    // point in the *fingers*, so the elbow-to-effector distance is a function of
    // whatever the clip is doing to the wrist this frame — and the clip is
    // swinging the arms. Solving the elbow circle against the bind length while
    // the real length breathes leaves the hand a few millimetres off target, in
    // a direction that cycles with the gait. Millimetres on a hand are pixels on
    // a slide positioned from it.
    this.upper.updateWorldMatrix(false, true)
    this.lower.getWorldPosition(this.joint)
    this.effector(this.end)
    const b = Math.max(1e-4, this.joint.distanceTo(this.end))
    this.toTarget.copy(target).sub(this.root)
    // Slightly inside full extension. At exactly `a + b` the elbow angle is
    // undefined and the arm locks straight, which reads as a mannequin.
    this.reachRatio = this.toTarget.length() / (a + b)
    const reach = THREE.MathUtils.clamp(
      this.toTarget.length(),
      Math.abs(a - b) + 1e-4,
      (a + b) * .995,
    )
    if (reach < 1e-5) return
    this.toTarget.normalize()

    // Elbow on the circle where the two bone spheres intersect.
    const along = (a * a - b * b + reach * reach) / (2 * reach)
    const radius = Math.sqrt(Math.max(0, a * a - along * along))
    this.axis.copy(pole).sub(this.root)
    this.axis.addScaledVector(this.toTarget, -this.axis.dot(this.toTarget))
    if (this.axis.lengthSq() < 1e-8) {
      // Pole is on the line. Any perpendicular will do; pick one off world up.
      this.axis.set(0, 1, 0).addScaledVector(this.toTarget, -this.toTarget.y)
      if (this.axis.lengthSq() < 1e-8) this.axis.set(1, 0, 0)
    }
    this.axis.normalize()

    this.desired.copy(this.root)
      .addScaledVector(this.toTarget, along)
      .addScaledVector(this.axis, radius)

    // 1. Swing the upper bone so the elbow lands on `desired`.
    this.lower.updateWorldMatrix(true, false)
    this.lower.getWorldPosition(this.joint)
    this.from.copy(this.joint).sub(this.root).normalize()
    this.to.copy(this.desired).sub(this.root).normalize()
    this.apply(this.upper, blend)

    // 2. Swing the lower bone so the effector lands on `target`.
    this.upper.updateWorldMatrix(false, true)
    this.lower.getWorldPosition(this.joint)
    this.effector(this.end)
    this.from.copy(this.end).sub(this.joint).normalize()
    this.to.copy(target).sub(this.joint).normalize()
    this.apply(this.lower, blend)
    this.lower.updateWorldMatrix(false, true)
  }

  /** Rotate `bone` by the world swing from `this.from` to `this.to`, blended. */
  private apply(bone: THREE.Object3D, blend: number) {
    if (this.from.lengthSq() < 1e-10 || this.to.lengthSq() < 1e-10) return
    this.swing.setFromUnitVectors(this.from, this.to)
    bone.getWorldQuaternion(this.world)
    this.before.copy(bone.quaternion)
    this.world.premultiply(this.swing)
    if (bone.parent) {
      bone.parent.getWorldQuaternion(this.parent)
      this.world.premultiply(this.parent.invert())
    }
    bone.quaternion.copy(this.before).slerp(this.world.normalize(), blend)
    bone.updateWorldMatrix(false, false)
  }
}
