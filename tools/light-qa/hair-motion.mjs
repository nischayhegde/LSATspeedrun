/**
 * Does the hair actually lag the head, and does it settle?
 *
 * Hair used to be rigid geometry parented to the head, which is a fact that a
 * still cannot show and a number can: the angle between the hair and the head
 * was exactly zero on every frame of every clip. So this measures that angle,
 * frame by frame, through a real render loop with the real actor, and captures
 * the strips beside it — the pictures and the numbers describe the same run.
 *
 * ## What is measured
 *
 * A head turn, driven through `setLookTarget` so the input is the same one the
 * office and the portrait use, then released and left to settle:
 *
 *   - `peak`, the largest hair-to-head angle reached, in degrees. Zero is the
 *     old behaviour and is the null result this probe exists to reject.
 *   - `overshoot`, whether the angle crosses zero after the head stops. A
 *     follower that only ever approaches its driver is a smoothing filter; one
 *     that goes past and comes back is follow-through, which is the difference
 *     between hair and a delayed hat.
 *   - `settle`, seconds from the head stopping until the angle stays inside a
 *     tenth of a degree. A settle that never arrives is a spring gaining energy,
 *     which is the failure mode of an explicit integrator and the reason the
 *     real one sub-steps.
 *
 * And a walk, because a stride is mostly *vertical* motion and a purely
 * rotational follower would be blind to it — a walking character whose hair is
 * dead still is exactly the complaint, in a different pose. Reported as the
 * peak and the RMS angle over a run of strides.
 *
 * Every arm runs at a fixed delta, so the result is a property of the code and
 * not of how busy the machine was.
 *
 * ## The controls
 *
 * Two, both of which have to hold or the measurement means nothing:
 *
 *   - `secondary: 0` must give exactly zero on every frame. That is the proof
 *     that the figure at rest is untouched — the hair node exists, but with the
 *     motion off it contributes no rotation at all, so a reduced-motion visitor
 *     and every screenshot of a still pose are byte-identical to before.
 *   - the male cropped cut must also give zero, because `hairSwing` scores it 0.
 *     A crop that swings would mean the amount is not coming from the cut.
 *
 * Usage: node tools/light-qa/hair-motion.mjs <tag>
 *   LIGHT_BASE=http://127.0.0.1:5174
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { launch } from './browser.mjs'

const BASE = process.env.LIGHT_BASE || 'http://127.0.0.1:5174'
const ROOT = process.env.LIGHT_OUT || fileURLToPath(new URL('../../.light', import.meta.url))
const tag = process.argv[2] ?? 'hair'
const SHOTS = `${ROOT}/.light-shots/${tag}`
const REPORTS = `${ROOT}/.light-run`
mkdirSync(SHOTS, { recursive: true })
mkdirSync(REPORTS, { recursive: true })

/**
 * The cuts worth measuring, by the swing `hairSwing` gives them.
 *
 * Both ends and the middle: the longest cut in the game, the female default,
 * the male default, and the crop that must not move.
 */
const ARMS = [
  { key: 'female-full', gender: 'female', hair: 'hair_full', expect: 'moves' },
  { key: 'female-signature', gender: 'female', hair: 'hair_signature', expect: 'moves' },
  { key: 'female-cropped', gender: 'female', hair: 'hair_cropped', expect: 'moves' },
  { key: 'male-full', gender: 'male', hair: 'hair_full', expect: 'moves' },
  { key: 'male-signature', gender: 'male', hair: 'hair_signature', expect: 'moves' },
  { key: 'male-cropped', gender: 'male', hair: 'hair_cropped', expect: 'still' },
  { key: 'female-full-reduced', gender: 'female', hair: 'hair_full', secondary: 0, expect: 'still' },
]

const report = { tag, base: BASE, at: new Date().toISOString(), arms: {}, errors: [] }

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 520, height: 620 } })
page.on('pageerror', (error) => report.errors.push(String(error.message).slice(0, 300)))
page.on('console', (message) => { if (message.type() === 'error') report.errors.push(message.text().slice(0, 300)) })

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })

  // One canvas, one renderer, one context, reused by every arm. A WebGL context
  // per arm is how a probe like this ends up losing the earliest ones to the
  // browser's context limit half way through a run.
  await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js')
    const counsel = await import('/src/art/stylized-counsel.ts')
    const rig = await import('/src/art/rig/index.ts')
    const canvas = document.createElement('canvas')
    canvas.width = 480
    canvas.height = 600
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:480px;height:600px;z-index:99999;background:#12161c'
    document.body.appendChild(canvas)
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(1)
    renderer.setSize(480, 600, false)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x12161c)
    // The portrait's own framing and lights, so what is judged here is what the
    // portrait draws rather than a diagnostic view of it.
    const camera = new THREE.OrthographicCamera(-.95, .95, 1.35, -1.05, .1, 40)
    camera.position.set(0, 2.62, 10.5)
    camera.lookAt(0, 2.56, .12)
    scene.add(new THREE.HemisphereLight(0xf5ecdf, 0x1b2631, 1.42))
    const key = new THREE.DirectionalLight(0xffe5ca, 2.15)
    key.position.set(-3.8, 7.8, 8.5)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xa9d3df, .74)
    fill.position.set(4.8, 4.3, 6.5)
    scene.add(fill)
    window.__hair = { THREE, counsel, rig, renderer, scene, camera, canvas, current: null }
  })

  for (const arm of ARMS) {
    const measured = await page.evaluate(async (spec) => {
      const { THREE, counsel, rig, renderer, scene, camera } = window.__hair
      if (window.__hair.current) scene.remove(window.__hair.current.body.root)

      const body = counsel.buildStylizedCounsel(spec.gender, 8, {
        cosmetics: { hair: spec.hair },
      })
      scene.add(body.root)
      body.root.updateWorldMatrix(true, true)
      const actor = new rig.HumanoidActor(body, { seed: 7.5, state: 'idle', reduced: false })
      if (spec.secondary !== undefined) actor.setSecondaryMotion(spec.secondary)
      actor.setLod('full')
      window.__hair.current = { body, actor }

      /*
       * The hair-to-head angle, which is the whole measurement.
       *
       * The hair node's local rotation *is* that angle by construction: it is
       * the only thing written to it, and it is written as the counter-rotation
       * of the lag. Reading the local quaternion therefore needs no world
       * matrices and cannot be confused by the head's own motion.
       */
      const hairAngle = () => {
        const q = body.hair.node.quaternion
        const sin = Math.min(1, Math.hypot(q.x, q.y, q.z))
        return 2 * Math.atan2(sin, Math.abs(q.w)) * 180 / Math.PI
      }
      /*
       * The same lag, signed, about the axis a head turn drives.
       *
       * An unsigned angle cannot see an overshoot: a follower that swings ten
       * degrees one way, comes back through zero and rings four degrees the
       * other way has the same magnitude trace as one that simply decays. The y
       * component of the quaternion is the yaw part of the lag with its sign
       * intact, which is what a turn produces and what a settle has to cross.
       */
      const hairYaw = () => {
        const q = body.hair.node.quaternion
        return Math.asin(Math.max(-1, Math.min(1, 2 * q.y * q.w))) * 180 / Math.PI
      }

      const STEP = 1 / 60
      const step = (frames) => {
        for (let index = 0; index < frames; index += 1) {
          actor.update(STEP)
          body.root.updateWorldMatrix(true, true)
        }
      }
      const trace = (frames, before) => {
        const angles = []
        const yaws = []
        for (let index = 0; index < frames; index += 1) {
          if (before) before(index)
          actor.update(STEP)
          body.root.updateWorldMatrix(true, true)
          angles.push(Number(hairAngle().toFixed(4)))
          yaws.push(Number(hairYaw().toFixed(4)))
        }
        return { angles, yaws }
      }
      const rms = (values) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length)

      // Settle the idle first, so the turn below starts from a body at rest
      // rather than from the bind pose the spring is still converging onto.
      step(120)

      /*
       * The floor this arm's settle is measured against.
       *
       * A settle cannot be "returns to zero", because the head never stops: the
       * idle clip breathes, drifts its own playback rate and fires beats, and
       * the hair goes on trailing all of it, which is the feature and not an
       * artefact. The first attempt at this metric asked for under a tenth of a
       * degree and reported that five of seven cuts never settle at all — a
       * conclusion about the idle, dressed as a conclusion about the spring.
       *
       * So the reference is this cut's own lag under plain idle, and a settle is
       * the turn's energy falling back into it.
       */
      const idle = trace(120)
      const idleRms = rms(idle.angles)
      const idleMax = Math.max(...idle.angles)

      // A head turn: forty degrees to one side over a third of a second, held,
      // then released. `setLookTarget` is the same input the office's characters
      // and the portrait's use.
      const look = new THREE.Vector3()
      const turn = trace(150, (index) => {
        if (index < 20) look.set(-2.4 * (index / 20), 2.6, 3)
        else if (index < 40) look.set(-2.4, 2.6, 3)
        else if (index === 40) actor.setLookTarget(null)
        if (index <= 40) actor.setLookTarget(look.clone())
      })
      const turnDuring = turn.angles.slice(0, 41)
      const turnAfter = turn.angles.slice(41)
      const yawDuring = turn.yaws.slice(0, 41)
      const yawAfter = turn.yaws.slice(41)
      const peak = Math.max(...turn.angles)
      /*
       * A follower that crosses back through its driver has overshot, and
       * overshoot is half of what follow-through means — a spring that only ever
       * approaches its target is a smoothing filter, and smoothed hair reads as
       * a hat on a delay.
       *
       * Taken on the signed yaw, and only after the head stops, where the sole
       * thing that can carry the hair past its driver is the momentum it built
       * on the way out.
       */
      const turnSign = Math.sign(yawDuring[yawDuring.length - 1] || 1)
      let overshoot = null
      let overshootDegrees = 0
      for (let index = 0; index < yawAfter.length; index += 1) {
        if (yawAfter[index] * turnSign < -.05) {
          if (overshoot === null) overshoot = index
          overshootDegrees = Math.max(overshootDegrees, Math.abs(yawAfter[index]))
        }
      }
      // Back inside the idle's own lag, and staying there.
      const floor = idleMax + .05
      let settle = null
      for (let index = 0; index < turnAfter.length; index += 1) {
        if (turnAfter.slice(index).every((value) => value <= floor)) { settle = index * STEP; break }
      }

      // A walk, which is where the vertical impulse earns its keep.
      actor.setState('walk')
      step(90)
      const walk = trace(180)
      const walkPeak = Math.max(...walk.angles)
      const walkRms = rms(walk.angles)

      // Back to a still pose for the strip, and one render so the canvas holds
      // the frame the screenshot is about to take.
      actor.setState('idle')
      step(60)
      renderer.render(scene, camera)

      return {
        swing: Number(body.hair.swing.toFixed(3)),
        idle: { rms: Number(idleRms.toFixed(3)), max: Number(idleMax.toFixed(3)) },
        turn: {
          peak: Number(peak.toFixed(3)),
          duringMax: Number(Math.max(...turnDuring).toFixed(3)),
          overshootFrame: overshoot,
          overshootDegrees: Number(overshootDegrees.toFixed(3)),
          settleSeconds: settle === null ? null : Number(settle.toFixed(3)),
          yawTail: yawAfter.slice(0, 40),
        },
        walk: {
          peak: Number(walkPeak.toFixed(3)),
          rms: Number(walkRms.toFixed(3)),
          sample: walk.angles.slice(0, 24),
        },
      }
    }, arm)

    // A strip through the turn, so the numbers have pictures beside them.
    const frames = []
    for (let index = 0; index < 8; index += 1) {
      await page.evaluate((count) => {
        const { renderer, scene, camera, current } = window.__hair
        const THREE = window.__hair.THREE
        const look = new THREE.Vector3()
        for (let frame = 0; frame < count; frame += 1) {
          const at = frame
          if (at < 20) look.set(-2.4 * (at / 20), 2.6, 3)
          else look.set(-2.4, 2.6, 3)
          current.actor.setLookTarget(look.clone())
          current.actor.update(1 / 60)
          current.body.root.updateWorldMatrix(true, true)
        }
        renderer.render(scene, camera)
      }, index === 0 ? 1 : 5)
      frames.push(await page.locator('canvas').last().screenshot({ path: `${SHOTS}/${arm.key}-turn-${index}.png` }))
    }

    report.arms[arm.key] = { ...arm, ...measured }
    const verdict = arm.expect === 'still'
      ? (measured.turn.peak < .01 && measured.walk.peak < .01 ? 'still as expected' : `MOVED (peak ${measured.turn.peak}°)`)
      : (measured.turn.peak > .5 ? 'moves' : `NO MOTION (peak ${measured.turn.peak}°)`)
    console.log(
      `${arm.key.padEnd(20)} swing ${String(measured.swing).padStart(5)}`,
      `idle ${String(measured.idle.rms).padStart(5)}°`,
      `turn peak ${String(measured.turn.peak).padStart(6)}°`,
      `settle ${measured.turn.settleSeconds === null ? ' none' : `${String(measured.turn.settleSeconds).padStart(4)}s`}`,
      `overshoot ${measured.turn.overshootFrame === null ? '   —  ' : `${String(measured.turn.overshootDegrees).padStart(5)}°`}`,
      `walk peak ${String(measured.walk.peak).padStart(6)}° rms ${String(measured.walk.rms).padStart(6)}°`,
      ` ${verdict}`,
    )
  }
} finally {
  writeFileSync(`${REPORTS}/hair-motion-${tag}.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(`\nwrote ${REPORTS}/hair-motion-${tag}.json and ${SHOTS}`)
