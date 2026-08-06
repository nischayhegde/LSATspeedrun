/**
 * Art-parity fingerprint for map crowd proxy rigs: geometry/materials unchanged
 * when driven by HumanoidActor instead of procedural animation.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import * as THREE from 'three'
import { HumanoidActor } from '../src/art/rig/humanoid-actor.ts'
import { buildCrowdWalker as buildWalker } from '../src/art/map-crowd-rig.ts'

const OUT = '.rig-qa-shots'
mkdirSync(OUT, { recursive: true })


function proxyPartFingerprint(walker: ReturnType<typeof buildWalker>) {
  const entries: string[] = []
  for (const part of walker.parts) {
    const node = part.node
    entries.push([
      part.shape,
      part.color.getHexString(),
      node.position.x.toFixed(4),
      node.position.y.toFixed(4),
      node.position.z.toFixed(4),
      node.scale.x.toFixed(4),
      node.scale.y.toFixed(4),
      node.scale.z.toFixed(4),
    ].join('|'))
  }
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
writeFileSync(`${OUT}/crowd-geometry-fingerprint.json`, JSON.stringify({
  match,
  proxyPartCount: walker.parts.length,
  beforeBytes: before.length,
  afterBytes: after.length,
}, null, 2))

if (!match) {
  console.error('Crowd proxy geometry fingerprint CHANGED after animation')
  process.exit(1)
}
console.log(`Crowd proxy geometry fingerprint OK (${walker.parts.length} parts)`)
