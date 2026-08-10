import * as THREE from 'three'

import {
  HumanoidActor,
  HumanoidBehaviorDirector,
  assignHumanoidLod,
  type BehaviorRole,
} from '../app-art/rig'
import { buildStylizedCounsel, type StylizedCounselRig } from '../app-art/stylized-counsel'
import { CameraRig, PALETTE, addStandardLights, disposeTree, seededRandom } from './scene-kit'
import type { DeckScene, SceneContext } from './types'

/**
 * The cast: seven counsel from the product's own character system, standing on a
 * lit floor with the game's ambient behaviour running.
 *
 * These are not deck-original characters. `buildStylizedCounsel` is the exact
 * function the app calls for every person in the office, on the map and on the
 * portrait card, and `HumanoidActor` + `HumanoidBehaviorDirector` are the exact
 * skeletal-animation system that drives them. The slide's claim is that the game
 * is made of real characters, so the slide shows the real characters.
 *
 * Written against `rig/ADOPTION.md`, whose four ordering rules are all obeyed
 * here and all annotated, because each of them has caused a bug once already.
 */

type CastMember = {
  rig: StylizedCounselRig
  actor: HumanoidActor
  holder: THREE.Group
  /** Base position, so the parallax lean can be applied on top of it. */
  home: THREE.Vector3
  seed: number
}

/**
 * Standing repertoires only.
 *
 * `deskWork`, `client` and `seatedGuest` are seated repertoires — hand one to a
 * body standing in open floor and the scheduler will quite correctly put it into
 * `seatedType`, which is a fully committed sitting pose played by someone with no
 * chair under them. ADOPTION.md calls that out as trap two, and it is exactly
 * what a line-up of standing characters would trip.
 */
const ROLES: BehaviorRole[] = ['reception', 'diplomatic', 'investigation', 'reception', 'diplomatic', 'reception', 'investigation']

export function createCastScene(context: SceneContext): DeckScene {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0a1220)
  scene.fog = new THREE.Fog(0x0a1220, 26, 74)

  const rig = new CameraRig(
    {
      line: { position: [0, 4.6, 18.5], target: [0, 2.9, -1], fov: 38, parallax: 1 },
      close: { position: [-3.1, 3.6, 8.4], target: [-2.4, 3.1, -1], fov: 30, parallax: .45 },
      sweep: { position: [9.2, 3.2, 12.5], target: [-2, 2.7, -2], fov: 42, parallax: .8 },
    },
    'line',
    context.width / Math.max(1, context.height),
  )

  addStandardLights(scene, 1)
  // One extra: a gold rim from behind, which is what separates seven navy suits
  // from a navy background. Without it the line-up is a silhouette.
  const rimLight = new THREE.DirectionalLight(PALETTE.pixelGold, 1.15)
  rimLight.position.set(-2, 7, -12)
  scene.add(rimLight)

  // --- floor ---------------------------------------------------------------
  // Warm paper rather than the harness's checkerboard. The checkerboard exists
  // in the harness so foot sliding is unmissable, which is a testing need, not a
  // presentation one; here the floor should read as a lit interior.
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x1b2b3a, roughness: .88, metalness: .04 })
  const floor = new THREE.Mesh(new THREE.CircleGeometry(46, 64), floorMaterial)
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)

  const inlayMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.gold, roughness: .34, metalness: .78 })
  const inlay = new THREE.Mesh(new THREE.TorusGeometry(11.5, .04, 6, 96), inlayMaterial)
  inlay.rotation.x = -Math.PI / 2
  inlay.position.y = .01
  scene.add(inlay)

  // A back wall, so the rim light has something to fall on and the fog has a
  // surface to resolve against rather than fading into the clear colour.
  const wallMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.pixelBlue, roughness: .95, metalness: 0 })
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(90, 26), wallMaterial)
  wall.position.set(0, 13, -22)
  scene.add(wall)

  // --- the cast ------------------------------------------------------------
  const random = seededRandom(48271)
  const director = new HumanoidBehaviorDirector()
  const cast: CastMember[] = []

  for (let index = 0; index < 7; index += 1) {
    const seed = 3100 + index * 137
    // Tier is what dresses a character in this system — a tier-0 counsel and a
    // tier-13 counsel are visibly different people in visibly different suits —
    // so the line-up spans the ladder and reads as a firm that grew.
    const tier = [0, 2, 4, 7, 9, 12, 14][index]
    const counsel = buildStylizedCounsel(index % 2 === 0 ? 'female' : 'male', tier, {
      role: 'visitor',
      paletteSeed: seed,
    })

    const holder = new THREE.Group()
    holder.add(counsel.root)
    // A shallow arc opening toward the camera, not a straight rank: seven bodies
    // in a line is a class photograph, which is the same note the office plan
    // makes about its own crescents.
    const spread = (index - 3) * 3.15
    const depth = -Math.abs(index - 3) * .82
    // Rule: the holder's world Y *is* the floor. The actor lowers the pelvis by
    // the rig's measured sole offset so the soles rest at the holder's origin,
    // and every grounding constraint measures against that plane.
    holder.position.set(spread, 0, depth)
    holder.rotation.y = -spread * .035
    scene.add(holder)
    // Rule: bind after the rig is in the scene graph and its world matrix is
    // fresh — the skeleton measures its own limb lengths from the bind pose.
    holder.updateWorldMatrix(true, true)

    // Rule: pass `reduced` at construction rather than skipping `update`, or the
    // body is left in a bind pose no state ever displays.
    const actor = new HumanoidActor(counsel, { seed, state: 'idle', reduced: context.reduced })
    director.add(actor, ROLES[index], seed)

    cast.push({ rig: counsel, actor, holder, home: holder.position.clone(), seed })
    void random()
  }

  const actors = cast.map((member) => member.actor)

  return {
    scene,
    camera: rig.camera,

    update(delta, elapsed) {
      // The director picks ambient beats per role and actively spreads each draw
      // away from recent performances of the same beat, which is why a line-up of
      // seven does not read as a loop.
      director.update(delta)
      // Small budgets: these bodies are mid-frame rather than portrait-sized, and
      // `medium` LOD keeps joint clamping while dropping foot IK, which is where
      // almost all of the cost is.
      assignHumanoidLod(actors, rig.camera, { fullBudget: 3, mediumBudget: 7 })
      for (const member of cast) {
        if (!context.reduced) {
          // A whole-body sway, so a standing line has some weight in it. Applied
          // to the holder *before* `update`, because foot planting works in world
          // space and needs the body's final placement for this frame.
          member.holder.position.x = member.home.x + Math.sin(elapsed * .27 + member.seed) * .035
        }
        // Nobody is travelling, so the honest ground speed is zero. Feeding a
        // nominal constant here is the entire cause of foot skating.
        member.actor.setGroundSpeed(0)
        member.actor.update(delta)
      }
      rig.update(delta, context.pointer)
    },

    resize(width, height) {
      rig.resize(width, height)
    },

    setFraming(name, immediate) {
      rig.go(name, immediate, 1.7)
    },

    dispose() {
      // Rule: call `dispose` — the mixer caches bindings against the root object.
      for (const member of cast) {
        director.remove(member.actor)
        member.actor.dispose()
        member.holder.removeFromParent()
      }
      disposeTree(scene)
      for (const material of [floorMaterial, inlayMaterial, wallMaterial]) material.dispose()
    },
  }
}
