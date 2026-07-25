import { useEffect, useRef } from 'react'
import * as THREE from 'three'

import type { CharacterGender } from '../types'

type ArticulatedCharacterProps = {
  alt: string
  gender: CharacterGender
  tier: number
}

export type CharacterRig = {
  root: THREE.Group
  hips: THREE.Group
  spine: THREE.Group
  chest: THREE.Group
  head: THREE.Group
  leftShoulder: THREE.Group
  rightShoulder: THREE.Group
  leftElbow: THREE.Group
  rightElbow: THREE.Group
  leftHip: THREE.Group
  rightHip: THREE.Group
  leftKnee: THREE.Group
  rightKnee: THREE.Group
  leftFoot: THREE.Group
  rightFoot: THREE.Group
  satchel: THREE.Group
  eyes: THREE.Group[]
  pupils: THREE.Object3D[]
}

const smooth = (value: number) => {
  const clamped = Math.max(0, Math.min(1, value))
  return clamped * clamped * (3 - 2 * clamped)
}

function heldGesture(phase: number, enter: number, hold: number, leave: number) {
  if (phase < enter || phase > leave) return 0
  if (phase < hold) return smooth((phase - enter) / Math.max(.001, hold - enter))
  return 1 - smooth((phase - hold) / Math.max(.001, leave - hold))
}

type Vector3Tuple = [number, number, number]

function standard(color: number, roughness: number, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness })
}

function physical(color: number, roughness: number, clearcoat = 0, clearcoatRoughness = .6) {
  return new THREE.MeshPhysicalMaterial({ color, roughness, clearcoat, clearcoatRoughness })
}

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  surface: THREE.Material,
  position: Vector3Tuple = [0, 0, 0],
  rotation: Vector3Tuple = [0, 0, 0],
  scale: Vector3Tuple = [1, 1, 1],
) {
  const mesh = new THREE.Mesh(geometry, surface)
  mesh.position.set(...position)
  mesh.rotation.set(...rotation)
  mesh.scale.set(...scale)
  parent.add(mesh)
  return mesh
}

function addCapsule(
  parent: THREE.Object3D,
  radius: number,
  length: number,
  surface: THREE.Material,
  position: Vector3Tuple = [0, 0, 0],
  rotation: Vector3Tuple = [0, 0, 0],
  scale: Vector3Tuple = [1, 1, 1],
) {
  return addMesh(parent, new THREE.CapsuleGeometry(radius, length, 7, 18), surface, position, rotation, scale)
}

function addTaperedLimb(
  parent: THREE.Object3D,
  topRadius: number,
  bottomRadius: number,
  length: number,
  surface: THREE.Material,
  position: Vector3Tuple,
  rotation: Vector3Tuple = [0, 0, 0],
  depthScale = .82,
) {
  return addMesh(parent, new THREE.CylinderGeometry(topRadius, bottomRadius, length, 22, 3, false), surface, position, rotation, [1, 1, depthScale])
}

function addEllipsoid(
  parent: THREE.Object3D,
  surface: THREE.Material,
  position: Vector3Tuple,
  scale: Vector3Tuple,
  segments = 24,
) {
  return addMesh(parent, new THREE.SphereGeometry(1, segments, Math.max(12, Math.round(segments * .65))), surface, position, [0, 0, 0], scale)
}

function roundedBoxGeometry(width: number, height: number, depth: number, radius: number) {
  const left = -width / 2
  const bottom = -height / 2
  const right = width / 2
  const top = height / 2
  const r = Math.min(radius, width / 2, height / 2)
  const shape = new THREE.Shape()
  shape.moveTo(left + r, bottom)
  shape.lineTo(right - r, bottom)
  shape.quadraticCurveTo(right, bottom, right, bottom + r)
  shape.lineTo(right, top - r)
  shape.quadraticCurveTo(right, top, right - r, top)
  shape.lineTo(left + r, top)
  shape.quadraticCurveTo(left, top, left, top - r)
  shape.lineTo(left, bottom + r)
  shape.quadraticCurveTo(left, bottom, left + r, bottom)
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: Math.min(r * .28, .035),
    bevelThickness: Math.min(depth * .12, .035),
    curveSegments: 8,
  })
  geometry.translate(0, 0, -depth / 2)
  return geometry
}

function garmentPanelGeometry(points: Array<[number, number]>, depth = .055) {
  const shape = new THREE.Shape()
  points.forEach(([x, y], index) => index === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y))
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: .012,
    bevelThickness: .012,
    curveSegments: 4,
  })
  geometry.translate(0, 0, -depth / 2)
  return geometry
}

/** A softly tailored volume with independent waist, chest, and shoulder widths. */
function tailoredTorsoGeometry(waist: number, chest: number, shoulder: number, depth: number) {
  const rings = [
    { y: -.08, x: waist, z: depth * .86 },
    { y: .48, x: chest * .9, z: depth },
    { y: 1.08, x: chest, z: depth * 1.04 },
    { y: 1.48, x: shoulder, z: depth * .98 },
    { y: 1.68, x: shoulder * .72, z: depth * .83 },
  ]
  const radialSegments = 20
  const positions: number[] = []
  const indices: number[] = []
  rings.forEach((ring) => {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const angle = (segment / radialSegments) * Math.PI * 2
      positions.push(Math.cos(angle) * ring.x, ring.y, Math.sin(angle) * ring.z)
    }
  })
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const next = (segment + 1) % radialSegments
      const a = ring * radialSegments + segment
      const b = ring * radialSegments + next
      const c = (ring + 1) * radialSegments + segment
      const d = (ring + 1) * radialSegments + next
      indices.push(a, c, b, b, c, d)
    }
  }
  const bottomCenter = positions.length / 3
  positions.push(0, rings[0].y, 0)
  const topCenter = positions.length / 3
  positions.push(0, rings[rings.length - 1].y, 0)
  for (let segment = 0; segment < radialSegments; segment += 1) {
    const next = (segment + 1) % radialSegments
    indices.push(bottomCenter, next, segment)
    const topStart = (rings.length - 1) * radialSegments
    indices.push(topCenter, topStart + segment, topStart + next)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function addTube(parent: THREE.Object3D, points: THREE.Vector3[], radius: number, surface: THREE.Material) {
  const curve = new THREE.CatmullRomCurve3(points)
  return addMesh(parent, new THREE.TubeGeometry(curve, 24, radius, 8, false), surface)
}

export function buildCharacter(gender: CharacterGender, tier: number): CharacterRig {
  const root = new THREE.Group()
  const stage = tier >= 11 ? 5 : tier >= 8 ? 4 : tier >= 5 ? 3 : tier >= 3 ? 2 : tier >= 1 ? 1 : 0
  const suits = [0x1c2c3f, 0x1a304b, 0x183553, 0x17324f, 0x142d49, 0x102741]
  const suitBase = standard(suits[stage], .84)
  const suitSecondary = standard(new THREE.Color(suits[stage]).offsetHSL(.004, -.04, -.035).getHex(), .9)
  const suitEdge = standard(new THREE.Color(suits[stage]).offsetHSL(0, -.02, .025).getHex(), .84)
  const shirt = standard(0xd9d4c8, .9)
  const tie = physical(stage >= 4 ? 0x5d252d : 0x202329, .52, .08, .7)
  const skin = physical(gender === 'female' ? 0xb56f50 : 0x9d6248, .58, .04, .76)
  const skinWarm = physical(gender === 'female' ? 0xc48361 : 0xaf7052, .61, .02, .82)
  const hair = standard(gender === 'female' ? 0x181516 : 0x171616, .48)
  const hairHighlight = standard(gender === 'female' ? 0x2b2321 : 0x272321, .55)
  const eyeWhite = physical(0xd8d2c6, .38, .1, .6)
  const iris = physical(0x403126, .32, .12, .45)
  const facialDetail = standard(0x2b201e, .68)
  const leather = physical(0x60341f, .43, .22, .5)
  const leatherDark = physical(0x321d16, .5, .12, .58)
  const brass = standard(0xb28b49, .32, .72)
  const shoe = physical(0x171616, .3, .34, .38)

  const hips = new THREE.Group()
  hips.position.y = 3.05
  root.add(hips)
  addMesh(hips, roundedBoxGeometry(.92, .46, .46, .13), suitSecondary, [0, -.08, 0])
  addMesh(hips, new THREE.CylinderGeometry(.45, .45, .075, 26), leatherDark, [0, .1, 0], [0, 0, 0], [1, 1, .58])
  addMesh(hips, roundedBoxGeometry(.13, .10, .045, .025), brass, [0, .07, .29])

  const makeLeg = (side: -1 | 1) => {
    const hip = new THREE.Group()
    hip.position.set(side * .255, -.18, 0)
    hips.add(hip)
    addTaperedLimb(hip, .265, .215, 1.24, suitBase, [0, -.66, 0], [0, 0, side * -.012], .8)
    addCapsule(hip, .022, .92, suitEdge, [side * -.09, -.64, .165], [0, 0, side * -.012], [.68, 1, .58])
    const knee = new THREE.Group()
    knee.position.set(0, -1.30, 0)
    hip.add(knee)
    addTaperedLimb(knee, .205, .15, 1.16, suitBase, [0, -.61, 0], [0, 0, side * .01], .78)
    addCapsule(knee, .018, .88, suitEdge, [side * -.065, -.6, .142], [0, 0, side * .01], [.7, 1, .6])
    const foot = new THREE.Group()
    foot.position.set(side * .012, -1.24, .13)
    knee.add(foot)
    addMesh(foot, roundedBoxGeometry(.39, .19, .69, .055), shoe, [0, 0, .055], [0, side * -.025, 0])
    addMesh(foot, roundedBoxGeometry(.41, .035, .71, .015), leatherDark, [0, -.11, .055], [0, side * -.025, 0])
    if (gender === 'female') addMesh(foot, roundedBoxGeometry(.19, .17, .16, .035), shoe, [0, -.16, -.19], [0, side * -.025, 0])
    return { hip, knee, foot }
  }
  const leftLeg = makeLeg(-1)
  const rightLeg = makeLeg(1)
  leftLeg.hip.rotation.z = -.025
  rightLeg.hip.rotation.z = .035
  rightLeg.knee.rotation.z = -.015

  const spine = new THREE.Group()
  hips.add(spine)
  const chest = new THREE.Group()
  spine.add(chest)
  const shoulder = gender === 'female' ? .61 : .68
  const chestWidth = gender === 'female' ? .58 : .64
  const waist = gender === 'female' ? .46 : .51
  addMesh(chest, tailoredTorsoGeometry(waist, chestWidth, shoulder, gender === 'female' ? .28 : .31), suitBase)
  if (gender === 'female') {
    addMesh(chest, garmentPanelGeometry([[-.24, 1.55], [.24, 1.55], [.16, .72], [0, .52], [-.16, .72]], .055), shirt, [0, 0, .345])
  } else {
    addMesh(chest, new THREE.CylinderGeometry(.13, .16, 1.32, 18), shirt, [0, .91, .275], [0, 0, 0], [1, 1, .4])
  }
  addMesh(chest, garmentPanelGeometry([[0, 1.58], [-.37, 1.14], [-.24, .74], [-.015, 1.2]], .07), suitEdge, [-.015, 0, .325])
  addMesh(chest, garmentPanelGeometry([[0, 1.58], [.37, 1.14], [.24, .74], [.015, 1.2]], .07), suitSecondary, [.015, 0, .325])
  addMesh(chest, garmentPanelGeometry([[-.43, .72], [-.04, .63], [-.03, -.09], [-.47, -.05]], .065), suitBase, [0, 0, .305])
  addMesh(chest, garmentPanelGeometry([[.43, .72], [.04, .63], [.03, -.09], [.47, -.05]], .065), suitSecondary, [0, 0, .305])
  if (gender === 'male') {
    addMesh(chest, new THREE.ConeGeometry(.075, .25, 18), tie, [0, 1.45, .365], [0, 0, Math.PI])
    addMesh(chest, roundedBoxGeometry(.09, .69, .055, .025), tie, [0, 1.00, .37])
  } else {
    addMesh(chest, garmentPanelGeometry([[0, 1.58], [-.23, 1.52], [-.10, 1.24]], .055), shirt, [-.02, 0, .38])
    addMesh(chest, garmentPanelGeometry([[0, 1.58], [.23, 1.52], [.10, 1.24]], .055), shirt, [.02, 0, .38])
  }
  addMesh(chest, new THREE.SphereGeometry(.032, 16, 10), brass, [.285, .86, .355])
  addMesh(chest, roundedBoxGeometry(.23, .035, .042, .014), suitEdge, [-.27, .42, .352], [0, 0, -.03])
  addMesh(chest, roundedBoxGeometry(.23, .035, .042, .014), suitEdge, [.27, .42, .352], [0, 0, .03])
  addMesh(chest, new THREE.SphereGeometry(.033, 16, 10), brass, [0, .55, .374])

  /* The strap is genuinely dimensional and follows the tailored torso. */
  addTube(chest, [new THREE.Vector3(.27, 1.63, .33), new THREE.Vector3(.57, 1.03, .40), new THREE.Vector3(.86, .28, .44)], .055, leatherDark)
  addMesh(chest, roundedBoxGeometry(.13, .16, .07, .025), brass, [.56, 1.03, .445], [0, 0, -.38])

  const makeArm = (side: -1 | 1) => {
    const shoulderJoint = new THREE.Group()
    shoulderJoint.position.set(side * shoulder, 1.46, .01)
    chest.add(shoulderJoint)
    addTaperedLimb(shoulderJoint, .205, .16, .96, suitBase, [0, -.5, 0], [0, 0, 0], .84)
    addCapsule(shoulderJoint, .018, .67, suitEdge, [side * -.065, -.50, .135], [0, 0, 0], [.72, 1, .62])
    const elbow = new THREE.Group()
    elbow.position.set(0, -.99, 0)
    shoulderJoint.add(elbow)
    addTaperedLimb(elbow, .16, .118, .71, suitBase, [0, -.37, 0], [0, 0, 0], .82)
    addMesh(elbow, new THREE.CylinderGeometry(.145, .14, .075, 18), shirt, [0, -.75, 0])
    if (gender === 'female' && side === -1) {
      const watch = addMesh(elbow, new THREE.TorusGeometry(.125, .022, 8, 24), brass, [0, -.82, 0], [Math.PI / 2, 0, 0])
      watch.scale.z = .78
      addMesh(elbow, new THREE.CylinderGeometry(.052, .052, .025, 18), physical(0xd9d6cc, .3, .18, .45), [0, -.82, .105], [Math.PI / 2, 0, 0])
    }
    addCapsule(elbow, .105, .20, skin, [0, -.91, .015], [0, 0, side * .035], [1, 1, .82])
    addEllipsoid(elbow, skinWarm, [side * -.02, -1.08, .035], [.12, .18, .082], 20)
    addCapsule(elbow, .032, .14, skinWarm, [side * .095, -1.08, .055], [0, 0, side * -.62], [.85, 1, .72])
    return { shoulder: shoulderJoint, elbow }
  }
  const leftArm = makeArm(-1)
  const rightArm = makeArm(1)
  leftArm.shoulder.rotation.z = .09
  leftArm.elbow.rotation.z = .12
  rightArm.shoulder.rotation.z = -.12
  rightArm.elbow.rotation.z = -.93

  const neck = new THREE.Group()
  neck.position.set(0, 1.72, 0)
  chest.add(neck)
  addCapsule(neck, .14, .22, skin, [0, .15, 0], [0, 0, 0], [1, 1, .86])
  const head = new THREE.Group()
  head.position.set(0, .62, 0)
  head.scale.set(1.06, 1.04, 1)
  neck.add(head)

  /* Adult proportions: a narrow, slightly asymmetric face rather than an oversized illustrated head. */
  addEllipsoid(head, hair, [0, .08, -.085], [gender === 'female' ? .35 : .34, .45, .30])
  if (gender === 'female') {
    addCapsule(head, .09, .49, hairHighlight, [-.18, -.23, .14], [0, 0, -.12], [.76, 1, .52])
    addCapsule(head, .085, .45, hairHighlight, [.22, -.20, .13], [0, 0, .11], [.74, 1, .5])
  }
  addEllipsoid(head, skin, [0, -.02, .055], [gender === 'female' ? .30 : .315, .405, .275])
  addEllipsoid(head, skinWarm, [-.16, .02, .267], [.07, .16, .025], 18)
  addEllipsoid(head, skin, [-.315, -.02, .035], [.055, .095, .06], 16)
  addEllipsoid(head, skin, [.315, -.02, .035], [.055, .095, .06], 16)
  if (gender === 'female') {
    addCapsule(head, .095, .30, hair, [-.245, .22, .20], [0, 0, -.42], [.8, 1, .52])
    addCapsule(head, .085, .26, hairHighlight, [.16, .28, .205], [0, 0, .56], [.75, 1, .5])
  } else {
    addCapsule(head, .10, .34, hair, [-.16, .31, .19], [0, 0, -.68], [1, 1, .55])
    addCapsule(head, .10, .34, hairHighlight, [.14, .32, .19], [0, 0, .72], [1, 1, .55])
  }

  if (gender === 'female') {
    const waves: Array<{ points: Vector3Tuple[]; radius: number; highlight?: boolean }> = [
      { points: [[-.27, .30, -.10], [-.39, -.02, -.12], [-.31, -.45, -.08], [-.48, -.92, -.02], [-.34, -1.58, .03]], radius: .095 },
      { points: [[-.18, .38, -.16], [-.22, .02, -.22], [-.12, -.43, -.21], [-.28, -.96, -.16], [-.16, -1.82, -.10]], radius: .085, highlight: true },
      { points: [[-.06, .40, -.19], [-.02, .02, -.27], [-.08, -.39, -.28], [.04, -.92, -.25], [-.02, -1.72, -.18]], radius: .083 },
      { points: [[.12, .38, -.18], [.19, .02, -.24], [.10, -.43, -.23], [.28, -.94, -.16], [.17, -1.76, -.08]], radius: .086 },
      { points: [[.25, .30, -.09], [.37, -.03, -.13], [.29, -.45, -.08], [.45, -.92, -.01], [.32, -1.56, .05]], radius: .094, highlight: true },
      { points: [[-.30, .22, .04], [-.42, -.10, .02], [-.35, -.49, .08], [-.49, -.92, .14], [-.39, -1.42, .18]], radius: .073, highlight: true },
      { points: [[.29, .21, .05], [.41, -.11, .03], [.34, -.49, .09], [.47, -.91, .15], [.38, -1.39, .18]], radius: .073 },
    ]
    waves.forEach((wave) => addTube(head, wave.points.map((point) => new THREE.Vector3(...point)), wave.radius, wave.highlight ? hairHighlight : hair))
  } else {
    const crownStrands: Vector3Tuple[][] = [
      [[-.29, .22, -.02], [-.19, .42, .06], [-.03, .48, .09]],
      [[-.12, .40, .02], [.02, .49, .08], [.18, .39, .13]],
      [[.05, .43, .02], [.18, .46, .08], [.30, .27, .11]],
    ]
    crownStrands.forEach((points, index) => addTube(head, points.map((point) => new THREE.Vector3(...point)), .075, index === 1 ? hairHighlight : hair))
    addMesh(head, roundedBoxGeometry(.07, .28, .09, .025), hair, [-.292, .07, .11], [0, 0, -.08])
    addMesh(head, roundedBoxGeometry(.07, .26, .09, .025), hair, [.292, .08, .11], [0, 0, .08])
  }

  const eyes: THREE.Group[] = []
  const pupils: THREE.Object3D[] = []
  ;[-1, 1].forEach((side) => {
    const eye = new THREE.Group()
    eye.position.set(side * .112, .035, .305)
    head.add(eye)
    addEllipsoid(eye, eyeWhite, [0, 0, 0], [.075, .032, .021], 20)
    addEllipsoid(eye, iris, [0, 0, .022], [.024, .025, .012], 18)
    const pupil = addEllipsoid(eye, facialDetail, [0, 0, .032], [.009, .011, .006], 14)
    pupils.push(pupil)
    eyes.push(eye)
    addCapsule(head, .012, .12, facialDetail, [side * .112, .135, .305], [0, 0, Math.PI / 2 + side * -.06], [1, 1, .72])
  })
  addMesh(head, new THREE.ConeGeometry(.038, .125, 18), skinWarm, [0, -.045, .326], [Math.PI / 2, 0, 0])
  addTube(head, [new THREE.Vector3(-.072, -.202, .337), new THREE.Vector3(0, -.228, .348), new THREE.Vector3(.072, -.202, .337)], .009, facialDetail)

  const satchel = new THREE.Group()
  satchel.position.set(.72, .28, .31)
  chest.add(satchel)
  addMesh(satchel, roundedBoxGeometry(.88, .62, .27, .085), leather)
  addMesh(satchel, roundedBoxGeometry(.82, .27, .07, .055), leatherDark, [0, .14, .165], [-.08, 0, 0])
  addMesh(satchel, roundedBoxGeometry(.075, .42, .045, .02), leatherDark, [-.27, -.03, .185])
  addMesh(satchel, roundedBoxGeometry(.075, .42, .045, .02), leatherDark, [.27, -.03, .185])
  addMesh(satchel, roundedBoxGeometry(.12, .13, .05, .022), brass, [.13, .03, .205])
  addMesh(satchel, roundedBoxGeometry(.36, .022, .03, .01), brass, [-.09, -.21, .195])

  return {
    root,
    hips,
    spine,
    chest,
    head,
    leftShoulder: leftArm.shoulder,
    rightShoulder: rightArm.shoulder,
    leftElbow: leftArm.elbow,
    rightElbow: rightArm.elbow,
    leftHip: leftLeg.hip,
    rightHip: rightLeg.hip,
    leftKnee: leftLeg.knee,
    rightKnee: rightLeg.knee,
    leftFoot: leftLeg.foot,
    rightFoot: rightLeg.foot,
    satchel,
    eyes,
    pupils,
  }
}

function shadowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(128, 32, 2, 128, 32, 122)
  gradient.addColorStop(0, 'rgba(4,7,10,.55)')
  gradient.addColorStop(.55, 'rgba(4,7,10,.22)')
  gradient.addColorStop(1, 'rgba(4,7,10,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 256, 64)
  return new THREE.CanvasTexture(canvas)
}

/** A compact PBR Three.js portrait with a true joint hierarchy. */
export function ArticulatedCharacter({ alt, gender, tier }: ArticulatedCharacterProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return
    root.classList.remove('is-ready')
    let disposed = false
    let frame = 0
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' })
    } catch {
      return
    }
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.02

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1.8, 1.8, 3.6, -3.6, .1, 40)
    camera.position.set(0, 3.33, 10.5)
    camera.lookAt(0, 3.22, 0)
    const rig = buildCharacter(gender, tier)
    rig.root.position.set(-.03, .03, 0)
    rig.root.rotation.y = -.07
    rig.root.scale.set(1.15, 1, 1.07)
    rig.satchel.visible = false
    scene.add(rig.root)

    const ambient = new THREE.HemisphereLight(0xe6dcc8, 0x111b24, .78)
    scene.add(ambient)
    const key = new THREE.DirectionalLight(0xffe5c2, 2.35)
    key.position.set(-3.2, 6.8, 7.5)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0x9dbac4, .72)
    fill.position.set(3.8, 3.7, 5)
    scene.add(fill)
    const rim = new THREE.DirectionalLight(0xd0a967, 1.1)
    rim.position.set(3, 6, -4.5)
    scene.add(rim)
    const faceFill = new THREE.PointLight(0xffd8b0, 1.08, 8, 2)
    faceFill.position.set(-.4, 5.65, 3.2)
    scene.add(faceFill)
    const shadowMap = shadowTexture()
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.5, .42), new THREE.MeshBasicMaterial({ map: shadowMap, transparent: true, depthWrite: false }))
    shadow.position.set(.02, .02, -.4)
    scene.add(shadow)

    const pointerTarget = new THREE.Vector2(0, 0)
    const pointer = new THREE.Vector2(0, 0)
    const onPointerMove = (event: PointerEvent) => {
      const bounds = root.getBoundingClientRect()
      pointerTarget.x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / Math.max(1, bounds.width) - .5) * 2))
      pointerTarget.y = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / Math.max(1, bounds.height) - .5) * 2))
    }
    const onPointerLeave = () => pointerTarget.set(0, 0)
    root.addEventListener('pointermove', onPointerMove)
    root.addEventListener('pointerleave', onPointerLeave)

    const resize = () => {
      const bounds = root.getBoundingClientRect()
      const width = Math.max(1, Math.round(bounds.width))
      const height = Math.max(1, Math.round(bounds.height))
      const aspect = width / height
      const viewHeight = 6.05
      camera.top = viewHeight / 2
      camera.bottom = -viewHeight / 2
      camera.left = -(viewHeight * aspect) / 2
      camera.right = (viewHeight * aspect) / 2
      camera.updateProjectionMatrix()
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
      renderer.setSize(width, height, false)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(root)
    resize()
    root.classList.add('is-ready')

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const startedAt = performance.now()
    const draw = (now: number) => {
      if (disposed) return
      const time = reducedMotion ? 0 : (now - startedAt) / 1000
      pointer.lerp(pointerTarget, reducedMotion ? 1 : .075)
      const phase = time % 16
      const glanceRight = heldGesture(phase, 1.0, 2.0, 5.0)
      const strapAdjust = heldGesture(phase, 5.6, 6.6, 8.9)
      const glanceLeft = heldGesture(phase, 9.0, 10.0, 13.0)
      const postureReset = heldGesture(phase, 12.8, 13.8, 15.8)
      const glance = glanceRight - glanceLeft
      const breath = Math.sin(time * 1.18)
      const sway = Math.sin(time * .43 + .8)

      rig.hips.position.x = sway * .018 - postureReset * .025
      rig.hips.rotation.z = sway * .006 - postureReset * .008
      rig.spine.rotation.z = sway * .011 + glance * .008 + pointer.x * .018
      rig.chest.scale.set(1 + breath * .009, 1 + breath * .006, 1)
      rig.head.rotation.y = pointer.x * .18 + glance * .13 + sway * .018
      rig.head.rotation.x = pointer.y * -.055 + breath * .005
      rig.head.rotation.z = pointer.x * -.045 + glance * -.028 + sway * .009
      rig.leftShoulder.rotation.z = .09 + breath * .012 + postureReset * .018
      rig.rightShoulder.rotation.z = (gender === 'female' ? -.2 : -.14) - breath * .014 - strapAdjust * .08
      rig.leftElbow.rotation.z = .12 + sway * .012
      rig.rightElbow.rotation.z = (gender === 'female' ? -1.2 : -.98) - strapAdjust * .12 + pointer.x * .02
      rig.leftHip.rotation.z = -.025 - sway * .006 + postureReset * .013
      rig.rightHip.rotation.z = .035 - sway * .006 - postureReset * .018
      rig.rightKnee.rotation.z = -.015 - postureReset * .012
      rig.satchel.rotation.z = sway * .015 - strapAdjust * .055
      rig.satchel.position.y = .28 + breath * .008 + strapAdjust * .035

      const blinkPhase = time % 6.7
      const blink = blinkPhase > 3.02 && blinkPhase < 3.28 ? Math.sin(((blinkPhase - 3.02) / .26) * Math.PI) : 0
      rig.eyes.forEach((eye) => { eye.scale.y = Math.max(.08, 1 - blink * .94) })
      rig.pupils.forEach((pupil) => pupil.position.set(pointer.x * .012, pointer.y * -.006, .032))
      renderer.render(scene, camera)
      if (!reducedMotion) frame = window.requestAnimationFrame(draw)
    }
    frame = window.requestAnimationFrame(draw)

    const onContextLost = () => root.classList.remove('is-ready')
    canvas.addEventListener('webglcontextlost', onContextLost)
    return () => {
      disposed = true
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      root.removeEventListener('pointermove', onPointerMove)
      root.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      root.classList.remove('is-ready')
      const geometries = new Set<THREE.BufferGeometry>()
      const materials = new Set<THREE.Material>()
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        geometries.add(object.geometry)
        const values = Array.isArray(object.material) ? object.material : [object.material]
        values.forEach((value) => materials.add(value))
      })
      geometries.forEach((geometry) => geometry.dispose())
      materials.forEach((value) => value.dispose())
      shadowMap.dispose()
      renderer.dispose()
    }
  }, [gender, tier])

  return (
    <div className="av-rigged-character av-rigged-character-three" ref={rootRef} role="img" aria-label={alt} data-character-rig="three">
      <div className="av-rigged-character-fallback" aria-hidden="true"><span>Rendering counsel</span></div>
      <canvas className="av-rigged-character-canvas" ref={canvasRef} aria-hidden="true" />
      <i className="av-rigged-character-rim" aria-hidden="true" />
    </div>
  )
}
