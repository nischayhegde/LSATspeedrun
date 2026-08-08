/**
 * Art-parity fingerprint for map crowd bodies: geometry and materials are
 * unchanged when driven by HumanoidActor instead of procedural animation.
 *
 * The crowd draws real `buildStylizedCounsel` bodies now rather than a capsule
 * proxy, so this fingerprints the parts themselves. The property under test is
 * the same one it always was, and it matters more than it did: the batcher
 * reads each part's *world* matrix, so a clip that quietly edited a part's
 * local transform would be invisible here but would move geometry on screen.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import * as THREE from 'three'
import { HumanoidActor } from '../src/art/rig/humanoid-actor.ts'
import { buildCrowdWalker as buildWalker } from '../src/art/map-crowd-rig.ts'

const OUT = '.rig-qa-shots'
mkdirSync(OUT, { recursive: true })

function partCount(walker: ReturnType<typeof buildWalker>) {
  let count = 0
  walker.root.traverse((object) => { if (object instanceof THREE.Mesh) count += 1 })
  return count
}

/**
 * Every part's geometry, material and local transform. Local rather than world:
 * a joint's world matrix is exactly what the animation is supposed to change,
 * and a fingerprint that included it would fail by design.
 */
function proxyPartFingerprint(walker: ReturnType<typeof buildWalker>) {
  const entries: string[] = []
  walker.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const material = object.material as THREE.MeshStandardMaterial
    entries.push([
      object.geometry.uuid,
      object.geometry.attributes.position?.count ?? 0,
      material.color.getHexString(),
      material.roughness?.toFixed(4),
      material.metalness?.toFixed(4),
      object.position.x.toFixed(4),
      object.position.y.toFixed(4),
      object.position.z.toFixed(4),
      object.scale.x.toFixed(4),
      object.scale.y.toFixed(4),
      object.scale.z.toFixed(4),
    ].join('|'))
  })
  entries.sort()
  return entries.join('\n')
}

const walker = buildWalker(12.7)
walker.root.scale.setScalar(.278 * (.93 + .08))
walker.root.updateWorldMatrix(true, true)
const before = proxyPartFingerprint(walker)

const actor = new HumanoidActor(walker.rig, { seed: 12.7, state: 'walk' })
for (let frame = 0; frame < 180; frame += 1) {
  walker.root.position.x = Math.sin(frame * .04) * 2
  walker.root.position.z = frame * .015
  walker.root.rotation.y = frame * .02
  walker.root.updateWorldMatrix(true, true)
  actor.setGroundSpeed(.85)
  actor.update(1 / 60)
}
const after = proxyPartFingerprint(walker)
actor.dispose()

const match = before === after
const parts = partCount(walker)
writeFileSync(`${OUT}/crowd-geometry-fingerprint.json`, JSON.stringify({
  match,
  partCount: parts,
  beforeBytes: before.length,
  afterBytes: after.length,
}, null, 2))

if (!match) {
  console.error('Crowd body geometry fingerprint CHANGED after animation')
  process.exit(1)
}
console.log(`Crowd body geometry fingerprint OK (${parts} parts)`)
