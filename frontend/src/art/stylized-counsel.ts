import * as THREE from 'three'

import type { CharacterGender } from '../types'

export type StylizedCounselRole = 'counsel' | 'guide' | 'judge' | 'visitor'

export type StylizedCounselRig = {
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
  leftHand: THREE.Group
  rightHand: THREE.Group
  leftThumb: THREE.Object3D
  rightThumb: THREE.Object3D
  satchel: THREE.Group
  eyes: THREE.Group[]
  pupils: THREE.Object3D[]
  base: {
    hipsY: number
    leftShoulderZ: number
    rightShoulderZ: number
    leftElbowZ: number
    rightElbowZ: number
  }
}

type BuildOptions = {
  role?: StylizedCounselRole
  paletteSeed?: number
}

type V3 = [number, number, number]

const geometryCache = new Map<string, THREE.BufferGeometry>()
const materialCache = new Map<string, THREE.Material>()

function sharedGeometry(key: string, create: () => THREE.BufferGeometry) {
  const existing = geometryCache.get(key)
  if (existing) return existing
  const geometry = create()
  geometry.userData.characterShared = true
  geometryCache.set(key, geometry)
  return geometry
}

function physical(color: number, roughness = .68, finish = .08) {
  const key = `standard:${color.toString(16)}:${roughness}:${finish}`
  const existing = materialCache.get(key)
  if (existing) return existing
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: Math.min(.06, finish * .12),
  })
  material.userData.characterShared = true
  materialCache.set(key, material)
  return material
}

function basic(color: number) {
  const key = `basic:${color.toString(16)}`
  const existing = materialCache.get(key)
  if (existing) return existing
  const material = new THREE.MeshBasicMaterial({ color, toneMapped: false })
  material.userData.characterShared = true
  materialCache.set(key, material)
  return material
}

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: V3 = [0, 0, 0],
  rotation: V3 = [0, 0, 0],
  scale: V3 = [1, 1, 1],
) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  mesh.rotation.set(...rotation)
  mesh.scale.set(...scale)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function ellipsoid(parent: THREE.Object3D, material: THREE.Material, position: V3, scale: V3, segments = 32) {
  const radial = Math.min(28, segments)
  const height = Math.max(14, Math.round(radial * .68))
  return addMesh(parent, sharedGeometry(`sphere:${radial}:${height}`, () => new THREE.SphereGeometry(1, radial, height)), material, position, [0, 0, 0], scale)
}

function capsule(parent: THREE.Object3D, radius: number, length: number, material: THREE.Material, position: V3, scale: V3 = [1, 1, 1]) {
  return addMesh(parent, sharedGeometry(`capsule:${radius}:${length}`, () => new THREE.CapsuleGeometry(radius, length, 6, 14)), material, position, [0, 0, 0], scale)
}

function softBoxGeometry(width: number, height: number, depth: number, radius: number) {
  return sharedGeometry(`soft-box:${width}:${height}:${depth}:${radius}`, () => {
    const shape = new THREE.Shape()
    const x = -width / 2
    const y = -height / 2
    const r = Math.min(radius, width / 2, height / 2)
    shape.moveTo(x + r, y)
    shape.lineTo(x + width - r, y)
    shape.quadraticCurveTo(x + width, y, x + width, y + r)
    shape.lineTo(x + width, y + height - r)
    shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
    shape.lineTo(x + r, y + height)
    shape.quadraticCurveTo(x, y + height, x, y + height - r)
    shape.lineTo(x, y + r)
    shape.quadraticCurveTo(x, y, x + r, y)
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: Math.min(r * .32, .055),
      bevelThickness: Math.min(depth * .14, .05),
      curveSegments: 6,
    })
    geometry.translate(0, 0, -depth / 2)
    return geometry
  })
}

function garmentGeometry(points: Array<[number, number]>, depth = .065, bevel = .022) {
  const key = `garment:${points.flat().join(',')}:${depth}:${bevel}`
  return sharedGeometry(key, () => {
    const shape = new THREE.Shape()
    points.forEach(([x, y], index) => index ? shape.lineTo(x, y) : shape.moveTo(x, y))
    shape.closePath()
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: bevel,
      bevelThickness: bevel,
      curveSegments: 5,
    })
    geometry.translate(0, 0, -depth / 2)
    return geometry
  })
}

function addLine(parent: THREE.Object3D, points: THREE.Vector3[], radius: number, material: THREE.Material) {
  const key = `line:${points.map((point) => `${point.x},${point.y},${point.z}`).join(';')}:${radius}`
  const geometry = sharedGeometry(key, () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 14, radius, 6, false))
  return addMesh(parent, geometry, material)
}

function referenceHairGeometry(gender: CharacterGender) {
  return sharedGeometry(`reference-hair:${gender}`, () => {
    // The male cut is a genuine open cap: no lower front surface can drift over
    // the face and read as a second, detached fringe. The female shell extends
    // around the back while lower front vertices tuck behind the cheeks.
    const geometry = new THREE.SphereGeometry(1, 28, 18, 0, Math.PI * 2, 0, gender === 'male' ? 1.68 : 2.50)
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index)
      const y = positions.getY(index)
      const z = positions.getZ(index)
      const side = Math.abs(x)
      const left = Math.max(0, -x)
      const upper = Math.max(0, y)
      const lower = Math.max(0, -y)
      const front = Math.max(0, z)
      const back = Math.max(0, -z)
      if (gender === 'male') {
        // A restrained side part: a broad, low lift over the left temple and a
        // round crown. The former narrow/high crest produced the hard wedge
        // visible in the full-height lawyer panel.
        const part = Math.exp(-Math.pow((x + .18) / .58, 2))
        const crown = Math.pow(upper, .68)
        const curl = Math.exp(-Math.pow((x + .63) / .21, 2) - Math.pow((y - .48) / .36, 2))
        const templeLift = left * (.024 + upper * .018)
        const hairlineCurve = front * Math.max(0, 1 - side * 1.75) * .025
        positions.setXYZ(
          index,
          x * (.485 + upper * .02) - .01 - crown * part * .01 - curl * .055,
          y * .465 + .19 + templeLift + crown * (.042 + part * .052) + curl * .085 - side * .012 - back * .02 + hairlineCurve,
          z * (.41 + upper * .022 + back * .03) - .05 + front * crown * (.024 + part * .014) + curl * .028,
        )
      } else {
        const centerFront = Math.max(0, 1 - side * 1.8)
        positions.setXYZ(
          index,
          x * (.49 + lower * .15) - .012,
          y * .52 + .13 + left * .035 - side * lower * .018,
          z * (.39 + upper * .025) - .06 - front * lower * .42 * centerFront - back * lower * .02,
        )
      }
    }
    positions.needsUpdate = true
    geometry.computeVertexNormals()
    return geometry
  })
}

function addHand(parent: THREE.Group, side: -1 | 1, skin: THREE.Material) {
  const hand = new THREE.Group()
  hand.position.set(side * .01, -1.02, .18)
  parent.add(hand)
  ellipsoid(hand, skin, [0, -.01, 0], [.128, .18, .082], 24)
  for (let finger = 0; finger < 4; finger += 1) {
    const x = (finger - 1.5) * .045
    const length = .105 + (.5 - Math.abs(finger - 1.5) * .22) * .018
    const digit = capsule(hand, .019, length, skin, [x, -.19, .008], [.92, 1, .74])
    digit.rotation.z = (finger - 1.5) * -.025
  }
  const thumb = capsule(hand, .027, .105, skin, [side * .115, -.035, .012], [.9, 1, .75])
  thumb.rotation.z = side * -.75
  return { hand, thumb }
}

function addHair(head: THREE.Group, gender: CharacterGender, hair: THREE.Material) {
  // The shell carries the crown and side hair as one continuous volume.
  addMesh(head, referenceHairGeometry(gender), hair)
  if (gender === 'male') {
    // This deeply intersecting front sweep sculpts the reference's friendly
    // side-part into the crown. It reads as one hairstyle from every camera
    // angle rather than as a fringe pasted onto the forehead.
    addMesh(
      head,
      sharedGeometry('reference-hair:male-front-sweep', () => new THREE.CapsuleGeometry(.13, .43, 8, 20)),
      hair,
      [-.075, .455, .345],
      [0, 0, -2.25],
      [1.06, 1, .72],
    )
  }
}

export function buildStylizedCounsel(gender: CharacterGender, tier: number, options: BuildOptions = {}): StylizedCounselRig {
  const role = options.role ?? 'counsel'
  const paletteSeed = Math.abs(options.paletteSeed ?? (gender === 'female' ? 1 : 0))
  const skinColors = [0xf2bda2, 0xd89473, 0xb87556, 0x8d5945]
  const hairColors = [0x392724, 0x3a2925, 0x6a4031, 0x2c2523]
  const skin = physical(skinColors[paletteSeed % skinColors.length], .58, .05)
  const skinShade = physical(new THREE.Color(skinColors[paletteSeed % skinColors.length]).offsetHSL(0, .01, -.08).getHex(), .64, .025)
  const hair = physical(hairColors[paletteSeed % hairColors.length], .52, .12)
  // A restrained version of the reference's blue jacket: saturated enough to
  // read as a designed character, dark enough to sit inside the app's navy UI.
  const suitPalette = [0x315b84, 0x294f77, 0x24486d, 0x1f4163, 0x1b3857, 0x142f4b]
  const stage = tier >= 11 ? 5 : tier >= 8 ? 4 : tier >= 5 ? 3 : tier >= 3 ? 2 : tier >= 1 ? 1 : 0
  const visitorPalette = [0x31524f, 0x3f465c, 0x59434a, 0x315064]
  const roleColor = role === 'judge' ? 0x20242d : role === 'visitor' ? visitorPalette[paletteSeed % visitorPalette.length] : suitPalette[stage]
  const suit = physical(roleColor, .72, .10)
  const suitLight = physical(new THREE.Color(roleColor).offsetHSL(.005, -.035, .045).getHex(), .70, .10)
  const trouser = physical(new THREE.Color(roleColor).lerp(new THREE.Color(0x45484f), .70).getHex(), .78, .04)
  const shirt = physical(0xf0e7d4, .84, .025)
  const tie = physical(role === 'judge' ? 0x8f6b3f : 0x743f45, .66, .07)
  const shoe = physical(0x25201f, .46, .22)
  const sole = physical(0x141414, .86, .02)
  const brassKey = 'standard:brass'
  let brass = materialCache.get(brassKey)
  if (!brass) {
    brass = new THREE.MeshStandardMaterial({ color: 0xc29a57, roughness: .35, metalness: .48 })
    brass.userData.characterShared = true
    materialCache.set(brassKey, brass)
  }
  const ink = physical(0x2b2524, .42, .18)
  const eyeWhite = physical(0xf8f1e5, .52, .06)
  const lip = physical(gender === 'female' ? 0xb96765 : 0xa75f59, .58, .08)

  const root = new THREE.Group()
  root.name = `${gender}-${role}-stylized-counsel`
  const hips = new THREE.Group()
  const hipsY = 2.62
  hips.position.y = hipsY
  hips.userData.baseY = hipsY
  root.add(hips)
  addMesh(hips, softBoxGeometry(gender === 'female' ? .86 : .94, .18, .43, .09), trouser, [0, -.03, 0])

  const makeLeg = (side: -1 | 1) => {
    const hip = new THREE.Group()
    hip.position.set(side * .275, -.08, 0)
    hips.add(hip)
    // Overlapping capsules remove the toy-block knee seam while retaining a
    // true knee joint for the map walk cycle.
    capsule(hip, .255, .78, trouser, [0, -.57, 0], [1, 1, .91])
    const crease = capsule(hip, .014, .68, suitLight, [side * -.08, -.57, .245], [.7, 1, .55])
    crease.castShadow = false
    const knee = new THREE.Group()
    knee.position.set(0, -1.09, 0)
    hip.add(knee)
    capsule(knee, .245, .74, trouser, [0, -.54, 0], [1, 1, .91])
    const foot = new THREE.Group()
    foot.position.set(0, -1.12, .04)
    knee.add(foot)
    addMesh(foot, softBoxGeometry(.48, .24, .66, .12), shoe, [0, -.03, .17])
    addMesh(foot, softBoxGeometry(.50, .05, .68, .025), sole, [0, -.165, .17])
    addMesh(foot, softBoxGeometry(.39, .035, .27, .018), suitLight, [0, .012, .39])
    return { hip, knee, foot }
  }
  const leftLeg = makeLeg(-1)
  const rightLeg = makeLeg(1)
  leftLeg.hip.scale.y = .97
  rightLeg.hip.scale.y = .97

  const spine = new THREE.Group()
  hips.add(spine)
  const chest = new THREE.Group()
  spine.add(chest)
  // A gently tapered capsule gives the jacket the reference model's friendly
  // rounded silhouette. The lapels and panels below keep it unmistakably a
  // tailored suit rather than a generic pill-shaped torso.
  capsule(chest, .60, .60, suit, [0, .87, 0], [gender === 'female' ? 1.04 : 1.12, 1, gender === 'female' ? .40 : .42])
  addMesh(chest, garmentGeometry([[-.22, 1.67], [.22, 1.67], [.12, .82], [0, .68], [-.12, .82]], .07), shirt, [0, 0, .31])
  addMesh(chest, garmentGeometry([[0, 1.63], [-.35, 1.30], [-.23, .86], [-.02, 1.10]], .075), suitLight, [-.012, 0, .35])
  addMesh(chest, garmentGeometry([[0, 1.63], [.35, 1.30], [.23, .86], [.02, 1.10]], .075), suitLight, [.012, 0, .35])
  addMesh(chest, garmentGeometry([[-.50, .73], [-.05, .62], [-.04, -.02], [-.51, .05]], .065), suit, [0, 0, .325])
  addMesh(chest, garmentGeometry([[.50, .73], [.05, .62], [.04, -.02], [.51, .05]], .065), suitLight, [0, 0, .325])
  if (gender === 'male') {
    addMesh(chest, garmentGeometry([[-.07, 1.54], [.07, 1.54], [.095, .72], [0, .57], [-.095, .72]], .06), tie, [0, 0, .395])
  } else {
    addMesh(chest, garmentGeometry([[-.21, 1.64], [0, 1.38], [.21, 1.64]], .06), shirt, [0, 0, .40])
  }
  for (const y of [.42, .82]) ellipsoid(chest, brass, [.08, y, .39], [.045, .045, .025], 18)
  addMesh(chest, softBoxGeometry(.24, .035, .04, .014), shirt, [.31, .62, .39])

  const armX = gender === 'female' ? .63 : .68
  const makeArm = (side: -1 | 1) => {
    const shoulder = new THREE.Group()
    shoulder.position.set(side * armX, 1.43, 0)
    chest.add(shoulder)
    addMesh(
      shoulder,
      sharedGeometry(`upper-arm:${gender}`, () => new THREE.CapsuleGeometry(gender === 'female' ? .18 : .195, .54, 6, 14)),
      suit,
      [0, -.45, 0],
      [0, 0, 0],
      [1, 1, .90],
    )
    const elbow = new THREE.Group()
    elbow.position.set(0, -.94, 0)
    shoulder.add(elbow)
    capsule(elbow, gender === 'female' ? .155 : .165, .68, suit, [0, -.45, 0], [1, 1, .92])
    addMesh(elbow, sharedGeometry(`shirt-cuff:${gender}`, () => new THREE.CylinderGeometry(gender === 'female' ? .17 : .18, gender === 'female' ? .17 : .18, .075, 18)), shirt, [0, -.91, 0])
    const { hand, thumb } = addHand(elbow, side, skin)
    return { shoulder, elbow, hand, thumb }
  }
  const leftArm = makeArm(-1)
  const rightArm = makeArm(1)
  // A relaxed open stance keeps both arms and hands legible; the previous
  // inward rotations hid them behind the jacket and created a rigid doll.
  const leftShoulderZ = .035
  const rightShoulderZ = -.035
  const leftElbowZ = .025
  const rightElbowZ = -.025
  leftArm.shoulder.rotation.z = leftShoulderZ
  rightArm.shoulder.rotation.z = rightShoulderZ
  leftArm.elbow.rotation.z = leftElbowZ
  rightArm.elbow.rotation.z = rightElbowZ

  const neck = new THREE.Group()
  neck.position.set(0, 1.68, 0)
  chest.add(neck)
  capsule(neck, .14, .20, skinShade, [0, .12, 0], [1, 1, .84])
  const head = new THREE.Group()
  head.position.set(0, .58, .015)
  neck.add(head)
  ellipsoid(head, skin, [0, 0, 0], [gender === 'female' ? .455 : .46, .53, .405], 36)
  for (const side of [-1, 1]) {
    ellipsoid(head, skin, [side * .42, -.015, -.015], [.06, .105, .068], 24)
    ellipsoid(head, skinShade, [side * .438, -.018, .01], [.016, .05, .022], 18)
  }
  addHair(head, gender, hair)

  const eyes: THREE.Group[] = []
  const pupils: THREE.Object3D[] = []
  for (const side of [-1, 1]) {
    const eye = new THREE.Group()
    eye.position.set(side * .14, .055, .365)
    head.add(eye)
    ellipsoid(eye, eyeWhite, [0, 0, 0], [.067, .080, .028], 24)
    const pupil = ellipsoid(eye, ink, [0, -.004, .027], [.032, .041, .016], 20)
    pupil.userData.baseZ = .027
    ellipsoid(eye, basic(0xffffff), [-.012, .018, .042], [.009, .011, .005], 14)
    eyes.push(eye)
    pupils.push(pupil)
    addLine(head, [
      new THREE.Vector3(side * .22, .205, .382),
      new THREE.Vector3(side * .145, .228, .40),
      new THREE.Vector3(side * .075, .210, .393),
    ], gender === 'female' ? .015 : .018, hair)
  }
  ellipsoid(head, skinShade, [0, -.05, .392], [.032, .058, .036], 22)
  addLine(head, [
    new THREE.Vector3(-.105, -.235, .376),
    new THREE.Vector3(-.045, -.266, .397),
    new THREE.Vector3(0, -.271, .402),
    new THREE.Vector3(.045, -.266, .397),
    new THREE.Vector3(.105, -.235, .376),
  ], .012, lip)

  const satchel = new THREE.Group()
  satchel.position.set(.68, .30, .25)
  chest.add(satchel)

  leftLeg.hip.rotation.z = -.025
  rightLeg.hip.rotation.z = .025
  rightLeg.knee.rotation.z = -.012
  head.rotation.z = gender === 'female' ? -.012 : .008

  root.traverse((object) => {
    if (object instanceof THREE.Mesh) object.frustumCulled = false
  })

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
    leftHand: leftArm.hand,
    rightHand: rightArm.hand,
    leftThumb: leftArm.thumb,
    rightThumb: rightArm.thumb,
    satchel,
    eyes,
    pupils,
    base: { hipsY, leftShoulderZ, rightShoulderZ, leftElbowZ, rightElbowZ },
  }
}
