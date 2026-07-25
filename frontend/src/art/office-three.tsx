import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'

type OfficeThreeProps = { tier: number; upgrades: number; staffCount: number }

type OfficeLook = {
  wall: number
  floor: number
  wood: number
  darkWood: number
  accent: number
  upholstery: number
  sky: number
  exterior: 'forest' | 'street' | 'city' | 'harbor' | 'world' | 'ocean' | 'orbit' | 'lunar' | 'nexus'
}

// Every headquarters level has its own material and exterior language. The
// geometry grows progressively; these palettes keep adjacent upgrades legible.
const OFFICE_LOOKS: OfficeLook[] = [
  { wall: 0x493226, floor: 0x38251d, wood: 0x65432f, darkWood: 0x2b1d17, accent: 0x3a3935, upholstery: 0x4d4035, sky: 0x101c24, exterior: 'forest' },
  { wall: 0x82705b, floor: 0x4c3427, wood: 0x76513a, darkWood: 0x34241d, accent: 0x796343, upholstery: 0x43535a, sky: 0x172936, exterior: 'street' },
  { wall: 0x69786f, floor: 0x493226, wood: 0x744a32, darkWood: 0x30211b, accent: 0x8c7446, upholstery: 0x31534f, sky: 0x18303a, exterior: 'street' },
  { wall: 0x273846, floor: 0x3e2b22, wood: 0x70452f, darkWood: 0x271b18, accent: 0x96713d, upholstery: 0x253e4a, sky: 0x102638, exterior: 'city' },
  { wall: 0x3b3338, floor: 0x35241f, wood: 0x6d4431, darkWood: 0x251a18, accent: 0xa47a3e, upholstery: 0x49333b, sky: 0x132a3e, exterior: 'city' },
  { wall: 0x2b4147, floor: 0x382a25, wood: 0x674634, darkWood: 0x211c1a, accent: 0x9d8552, upholstery: 0x294d52, sky: 0x12384a, exterior: 'harbor' },
  { wall: 0x222f3a, floor: 0x302722, wood: 0x5a4032, darkWood: 0x1a1818, accent: 0xb08a43, upholstery: 0x243b4a, sky: 0x112b41, exterior: 'world' },
  { wall: 0x1d3440, floor: 0x292421, wood: 0x513c31, darkWood: 0x17181a, accent: 0xb49b5d, upholstery: 0x1f4b50, sky: 0x102e44, exterior: 'world' },
  { wall: 0x203544, floor: 0x27231f, wood: 0x4b382f, darkWood: 0x15181b, accent: 0xc09648, upholstery: 0x274650, sky: 0x0c2942, exterior: 'world' },
  { wall: 0x233832, floor: 0x2c2721, wood: 0x503a2e, darkWood: 0x161a18, accent: 0xc4a45c, upholstery: 0x2c4940, sky: 0x102b3d, exterior: 'city' },
  { wall: 0x202d36, floor: 0x252525, wood: 0x483a32, darkWood: 0x14191d, accent: 0x66a8a5, upholstery: 0x263e49, sky: 0x0d3040, exterior: 'city' },
  { wall: 0x173443, floor: 0x222a2e, wood: 0x453b34, darkWood: 0x101a20, accent: 0x65b8b1, upholstery: 0x1e4957, sky: 0x08374a, exterior: 'ocean' },
  { wall: 0x20283b, floor: 0x262b36, wood: 0x493d35, darkWood: 0x121722, accent: 0x8faeb5, upholstery: 0x2b3d55, sky: 0x080f25, exterior: 'orbit' },
  { wall: 0x2a3038, floor: 0x303238, wood: 0x55483d, darkWood: 0x171a20, accent: 0xb8c6c9, upholstery: 0x3a4652, sky: 0x090e1c, exterior: 'lunar' },
  { wall: 0x151d2a, floor: 0x24242b, wood: 0x493a31, darkWood: 0x0d1118, accent: 0xd0aa55, upholstery: 0x203c46, sky: 0x070b18, exterior: 'nexus' },
]

function seeded(index: number) {
  return Math.abs(Math.sin(index * 91.731 + 17.17) * 43758.5453) % 1
}

function woodTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 768
  canvas.height = 768
  const context = canvas.getContext('2d')!
  context.fillStyle = '#4b2f24'
  context.fillRect(0, 0, 768, 768)
  for (let plank = 0; plank < 12; plank += 1) {
    const y = plank * 64
    context.fillStyle = plank % 2 ? '#56372a' : '#452a22'
    context.fillRect(0, y, 768, 62)
    context.strokeStyle = 'rgba(14,8,7,.75)'
    context.lineWidth = 3
    context.strokeRect(0, y, 768, 64)
    for (let line = 0; line < 11; line += 1) {
      const offset = seeded(plank * 23 + line) * 18
      context.beginPath()
      context.moveTo(0, y + 9 + line * 4.4 + offset * .18)
      context.bezierCurveTo(190, y + offset, 470, y + 42 - offset, 768, y + 18 + offset)
      context.strokeStyle = `rgba(214,151,91,${.028 + seeded(line) * .045})`
      context.lineWidth = 1.2
      context.stroke()
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(3.2, 4.6)
  texture.anisotropy = 4
  return texture
}

function shackWoodTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 1024
  const context = canvas.getContext('2d')!
  context.fillStyle = '#39271d'
  context.fillRect(0, 0, 1024, 1024)
  for (let plank = 0; plank < 11; plank += 1) {
    const y = plank * 94
    const tone = 42 + Math.round(seeded(plank + 90) * 22)
    context.fillStyle = `rgb(${tone + 22},${tone + 3},${Math.max(22, tone - 10)})`
    context.fillRect(0, y + 3, 1024, 87)
    context.fillStyle = 'rgba(15,9,6,.76)'
    context.fillRect(0, y, 1024, 5)
    for (let grain = 0; grain < 18; grain += 1) {
      const gy = y + 10 + grain * 4.1 + seeded(plank * 31 + grain) * 8
      context.beginPath()
      context.moveTo(0, gy)
      context.bezierCurveTo(230, gy - 12, 580, gy + 16, 1024, gy - 3)
      context.strokeStyle = `rgba(${grain % 3 ? '218,169,112' : '28,15,10'},${.035 + seeded(grain + plank) * .075})`
      context.lineWidth = grain % 4 === 0 ? 2 : 1
      context.stroke()
    }
    for (const x of [18, 1002]) {
      context.beginPath()
      context.arc(x, y + 46, 3.2, 0, Math.PI * 2)
      context.fillStyle = 'rgba(14,13,12,.88)'
      context.fill()
      context.beginPath()
      context.arc(x - 1, y + 45, 1, 0, Math.PI * 2)
      context.fillStyle = 'rgba(205,172,118,.42)'
      context.fill()
    }
    if (plank % 3 === 1) {
      const knotX = 170 + seeded(plank * 17) * 650
      context.beginPath()
      context.ellipse(knotX, y + 46, 23, 10, -.08, 0, Math.PI * 2)
      context.strokeStyle = 'rgba(22,12,8,.55)'
      context.lineWidth = 4
      context.stroke()
      context.beginPath()
      context.ellipse(knotX, y + 46, 9, 4, -.08, 0, Math.PI * 2)
      context.fillStyle = 'rgba(18,10,7,.48)'
      context.fill()
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(1.3, 1.05)
  texture.anisotropy = 4
  return texture
}

function screenTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 320
  const context = canvas.getContext('2d')!
  context.fillStyle = '#06141a'
  context.fillRect(0, 0, 512, 320)
  context.fillStyle = '#5ed0c6'
  context.font = '700 28px system-ui'
  context.fillText('ACTIVE MATTER', 36, 54)
  context.fillStyle = '#d9c487'
  context.fillRect(36, 82, 305, 8)
  context.fillStyle = '#658e91'
  ;[126, 166, 206, 246].forEach((y, index) => context.fillRect(36, y, 365 - index * 42, 7))
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  mesh.rotation.set(...rotation)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

export function OfficeThreeScene({ tier, upgrades, staffCount }: OfficeThreeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const level = Math.max(0, Math.min(14, Math.round(tier)))
    const rustic = level === 0
    const heritage = level <= 1
    const executive = level >= 5
    const international = level >= 8
    const frontier = level >= 12
    const look = OFFICE_LOOKS[level]
    const detailLevel = Math.min(6, 1 + Math.floor(level / 2) + Math.floor(upgrades / 7))
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = rustic ? .72 : .78 + Math.min(.1, level * .007)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(rustic ? 0x100d0b : 0x07111a)
    scene.fog = new THREE.FogExp2(rustic ? 0x1b130f : 0x09131d, rustic ? .052 : .035)
    const environment = new RoomEnvironment()
    const pmrem = new THREE.PMREMGenerator(renderer)
    const environmentTarget = pmrem.fromScene(environment, .04)
    scene.environment = environmentTarget.texture

    const camera = new THREE.PerspectiveCamera(rustic ? 42 : 39, 1, .1, 80)
    camera.position.set(rustic ? -.2 : 0, rustic ? 3.0 : 3.15, rustic ? 10.7 : 10.4)
    const cameraTarget = new THREE.Vector3(rustic ? -.15 : .1, rustic ? 1.72 : 1.8, rustic ? -.65 : -.4)
    camera.lookAt(cameraTarget)

    const root = new THREE.Group()
    root.position.y = -.08
    scene.add(root)

    const floorMap = rustic ? shackWoodTexture() : woodTexture()
    const wallMap = rustic ? shackWoodTexture() : null
    const screenMap = screenTexture()
    const wall = new THREE.MeshStandardMaterial({ color: look.wall, map: wallMap, bumpMap: wallMap, bumpScale: rustic ? .055 : 0, roughness: rustic ? 1 : .9, metalness: 0 })
    const wood = new THREE.MeshPhysicalMaterial({ color: look.wood, map: floorMap, bumpMap: floorMap, bumpScale: rustic ? .04 : .014, roughness: rustic ? .92 : .48, metalness: .01, clearcoat: rustic ? 0 : .12, clearcoatRoughness: .5 })
    const darkWood = new THREE.MeshPhysicalMaterial({ color: look.darkWood, roughness: rustic ? .96 : .55, clearcoat: rustic ? 0 : .18, clearcoatRoughness: .48 })
    const brass = new THREE.MeshStandardMaterial({ color: look.accent, roughness: rustic ? .68 : .34, metalness: rustic ? .52 : .72 })
    const charcoal = new THREE.MeshPhysicalMaterial({ color: 0x202a32, roughness: .52, metalness: .18, clearcoat: .18 })
    const leather = new THREE.MeshPhysicalMaterial({ color: look.upholstery, roughness: rustic ? .88 : .38, clearcoat: rustic ? 0 : .34, clearcoatRoughness: .42 })
    const paper = new THREE.MeshStandardMaterial({ color: rustic ? 0xb8a47c : 0xded1ad, roughness: .94 })
    const teal = new THREE.MeshStandardMaterial({ color: 0x214e52, roughness: .48, metalness: .18 })
    const screen = new THREE.MeshStandardMaterial({ color: 0x10292e, map: screenMap, emissiveMap: screenMap, emissive: 0x216e6e, emissiveIntensity: .58, roughness: .24 })

    // Architectural shell: tier zero is a genuinely built timber shack. Each
    // later level keeps the volume but upgrades its finish, structure and trim.
    addMesh(root, new THREE.PlaneGeometry(15, 11), new THREE.MeshStandardMaterial({ map: floorMap, bumpMap: floorMap, bumpScale: rustic ? .045 : .016, color: look.floor, roughness: rustic ? .95 : .62 }), [0, 0, .5], [-Math.PI / 2, 0, 0])
    addMesh(root, new THREE.PlaneGeometry(15, 6.8), wall, [0, 3.35, -4.1])
    addMesh(root, new THREE.PlaneGeometry(10, 6.8), new THREE.MeshStandardMaterial({ color: look.darkWood, roughness: .98 }), [-7.45, 3.35, .35], [0, Math.PI / 2, 0])
    addMesh(root, new THREE.PlaneGeometry(10, 6.8), new THREE.MeshStandardMaterial({ color: look.darkWood, roughness: .98 }), [7.45, 3.35, .35], [0, -Math.PI / 2, 0])
    let hearthEmber: THREE.Mesh | null = null
    let hearthLight: THREE.PointLight | null = null
    if (rustic) {
      // Uneven boards, exposed posts, sill and diagonal wind braces create the
      // room silhouette before any furniture is added.
      for (let row = 0; row < 10; row += 1) {
        const y = .32 + row * .67
        addMesh(root, new THREE.BoxGeometry(15.05, .61, .18 + seeded(row + 40) * .05), wall, [(seeded(row + 9) - .5) * .09, y, -3.98], [0, 0, (seeded(row + 70) - .5) * .008])
      }
      for (const x of [-6.78, -4.48, -1.95, .68, 3.32, 6.65]) addMesh(root, new THREE.BoxGeometry(.22, 6.75, .34), darkWood, [x, 3.36, -3.72])
      addMesh(root, new THREE.BoxGeometry(15, .32, .44), darkWood, [0, .19, -3.65])
      addMesh(root, new THREE.BoxGeometry(.25, 5.4, .34), darkWood, [4.65, 3.15, -3.62], [0, 0, -.62])
      addMesh(root, new THREE.BoxGeometry(.25, 5.0, .34), darkWood, [-5.75, 3.25, -3.62], [0, 0, .54])
      // A low plank ceiling and exposed joists complete the timber envelope.
      // This keeps the shack from reading as furniture floating in a box.
      addMesh(root, new THREE.PlaneGeometry(15, 10.6), new THREE.MeshStandardMaterial({ color: 0x241711, map: wallMap, bumpMap: wallMap, bumpScale: .05, roughness: 1, side: THREE.DoubleSide }), [0, 6.62, .4], [Math.PI / 2, 0, 0])
      for (let index = 0; index < 7; index += 1) addMesh(root, new THREE.BoxGeometry(.3, .34, 10.7), darkWood, [-6.9 + index * 2.28, 6.43, .2], [0, 0, index % 2 ? .035 : -.035])
      for (const z of [-3.55, 1.45, 5.15]) addMesh(root, new THREE.BoxGeometry(14.55, .24, .32), darkWood, [0, 6.31, z], [0, 0, z > 0 ? .012 : -.01])
    } else {
      addMesh(root, new THREE.BoxGeometry(15, .18, .22), darkWood, [0, 1.15, -3.91])
      const trimCount = Math.min(10, 5 + Math.floor(level / 2))
      for (let index = 0; index < trimCount; index += 1) addMesh(root, new THREE.BoxGeometry(.16, .18, 10), level >= 10 ? brass : darkWood, [-6.7 + index * (13.4 / Math.max(1, trimCount - 1)), 6.55, .45], [0, 0, index % 2 ? .018 : -.018])

      // The headquarters is rebuilt in coherent architectural stages. Early
      // tiers retain timber wainscot; city tiers gain panel bays and crown
      // moulding; international/frontier tiers introduce stone and metal.
      const lowerWallMaterial = !executive ? wood : !international ? darkWood : charcoal
      addMesh(root, new THREE.BoxGeometry(14.8, 1.42 + Math.min(.45, level * .04), .18), lowerWallMaterial, [0, .76 + Math.min(.2, level * .02), -3.82])
      addMesh(root, new THREE.BoxGeometry(14.92, .12, .28), level >= 8 ? brass : darkWood, [0, 1.52 + Math.min(.38, level * .04), -3.72])
      const panelCount = Math.min(international ? 8 : 6, 3 + Math.floor(level / 2))
      for (let panel = 0; panel < panelCount; panel += 1) {
        const x = -6.6 + panel * (13.2 / Math.max(1, panelCount - 1))
        addMesh(root, new THREE.BoxGeometry(level >= 10 ? .09 : .13, 1.18, .08), level >= 8 ? brass : darkWood, [x, .79, -3.65])
      }
      addMesh(root, new THREE.BoxGeometry(15, .22, .31), level >= 10 ? brass : darkWood, [0, 6.35, -3.64])
      if (level >= 3) {
        const cofferCount = Math.min(7, 3 + Math.floor(level / 2))
        for (let beam = 0; beam < cofferCount; beam += 1) {
          const x = -6.45 + beam * (12.9 / Math.max(1, cofferCount - 1))
          addMesh(root, new THREE.BoxGeometry(level >= 10 ? .1 : .18, .16, 10.35), level >= 10 ? brass : darkWood, [x, 6.46, .42])
        }
      }
    }

    // Window: the first office looks over scrub and crooked roofs; each later
    // headquarters gets an exterior appropriate to its named region.
    const windowWidth = rustic ? 2.85 : 3.5 + Math.min(.65, level * .045)
    const windowHeight = rustic ? 2.55 : 3.45 + Math.min(.35, level * .025)
    const windowX = rustic ? -3.62 : -3.2
    const windowGroup = new THREE.Group()
    windowGroup.position.set(windowX, rustic ? 3.22 : 3.25, -3.94)
    root.add(windowGroup)
    const windowAnchor = new THREE.Object3D()
    windowAnchor.position.set(0, 0, .28)
    windowGroup.add(windowAnchor)
    const empireAnchor = new THREE.Object3D()
    empireAnchor.position.set(windowWidth * .32, .12, .3)
    windowGroup.add(empireAnchor)
    addMesh(windowGroup, new THREE.PlaneGeometry(windowWidth, windowHeight), new THREE.MeshBasicMaterial({ color: look.sky }), [0, 0, .015])
    const exterior = new THREE.Group()
    const exteriorMovers: THREE.Object3D[] = []
    windowGroup.add(exterior)
    if (look.exterior === 'forest') {
      addMesh(exterior, new THREE.CircleGeometry(.23, 24), new THREE.MeshBasicMaterial({ color: 0xb3a47a }), [.72, .72, .06])
      for (let index = 0; index < 12; index += 1) {
        const height = .5 + seeded(index + 9) * .92
        const tree = addMesh(exterior, new THREE.ConeGeometry(.14 + height * .12, height, 7), new THREE.MeshStandardMaterial({ color: index % 2 ? 0x13251f : 0x1a2f27, roughness: 1 }), [-1.34 + index * .24, -1.25 + height / 2, .08])
        tree.castShadow = false
        tree.userData.restRotation = tree.rotation.z
        exteriorMovers.push(tree)
      }
      addMesh(exterior, new THREE.BoxGeometry(1.2, .48, .05), new THREE.MeshStandardMaterial({ color: 0x271b18, roughness: 1 }), [-.58, -1.03, .1])
      addMesh(exterior, new THREE.ConeGeometry(.88, .45, 4), new THREE.MeshStandardMaterial({ color: 0x38251e, roughness: 1 }), [-.58, -.69, .1], [0, 0, Math.PI / 4])
    } else if (look.exterior === 'ocean') {
      for (let band = 0; band < 5; band += 1) addMesh(exterior, new THREE.PlaneGeometry(windowWidth, .12), new THREE.MeshBasicMaterial({ color: band % 2 ? 0x245b68 : 0x337786, transparent: true, opacity: .6 }), [0, -1.15 + band * .15, .07])
    } else if (look.exterior === 'orbit' || look.exterior === 'lunar' || look.exterior === 'nexus') {
      const planetColor = look.exterior === 'lunar' ? 0xbec1ba : look.exterior === 'nexus' ? 0x427d91 : 0x315f78
      addMesh(exterior, new THREE.CircleGeometry(look.exterior === 'nexus' ? .62 : .88, 48), new THREE.MeshStandardMaterial({ color: planetColor, emissive: planetColor, emissiveIntensity: .12, roughness: .84 }), [.56, -.08, .07])
      for (let index = 0; index < 28; index += 1) addMesh(exterior, new THREE.CircleGeometry(.008 + seeded(index) * .013, 8), new THREE.MeshBasicMaterial({ color: index % 4 ? 0xb7cad1 : 0xd6b76a }), [-windowWidth / 2 + seeded(index * 2) * windowWidth, -windowHeight / 2 + seeded(index * 2 + 1) * windowHeight, .09])
    } else {
      const count = 12 + Math.min(12, level)
      for (let index = 0; index < count; index += 1) {
        const width = .14 + seeded(index + 2) * .25
        const height = .35 + seeded(index + 9) * (look.exterior === 'street' ? .8 : 1.48)
        const building = addMesh(exterior, new THREE.BoxGeometry(width, height, .06), new THREE.MeshStandardMaterial({ color: index % 3 ? 0x0c1826 : 0x14283b, emissive: index % 4 === 0 ? 0x6e5730 : 0x07101a, emissiveIntensity: .18 + level * .01 }), [-windowWidth / 2 + .18 + index * ((windowWidth - .36) / Math.max(1, count - 1)), -windowHeight / 2 + height / 2, .08])
        building.castShadow = false
        if (index % 4 === 0) exteriorMovers.push(building)
      }
      if (look.exterior === 'harbor') addMesh(exterior, new THREE.PlaneGeometry(windowWidth, .42), new THREE.MeshBasicMaterial({ color: 0x174759, transparent: true, opacity: .72 }), [0, -windowHeight / 2 + .2, .1])
    }
    const glass = addMesh(windowGroup, new THREE.PlaneGeometry(windowWidth, windowHeight), new THREE.MeshPhysicalMaterial({ color: rustic ? 0x465f62 : 0x5d899f, transmission: rustic ? .08 : .18, transparent: true, opacity: rustic ? .34 : .22, roughness: rustic ? .28 : .12, metalness: .05, clearcoat: rustic ? .2 : 1 }), [0, 0, .14])
    glass.castShadow = false
    const frameMaterial = rustic ? darkWood : brass
    addMesh(windowGroup, new THREE.BoxGeometry(windowWidth + .3, rustic ? .19 : .12, .18), frameMaterial, [0, windowHeight / 2 + .11, .19])
    addMesh(windowGroup, new THREE.BoxGeometry(windowWidth + .3, rustic ? .22 : .12, .18), frameMaterial, [0, -windowHeight / 2 - .11, .19])
    addMesh(windowGroup, new THREE.BoxGeometry(rustic ? .2 : .12, windowHeight + .28, .18), frameMaterial, [-windowWidth / 2 - .1, 0, .19])
    addMesh(windowGroup, new THREE.BoxGeometry(rustic ? .2 : .12, windowHeight + .28, .18), frameMaterial, [windowWidth / 2 + .1, 0, .19])
    addMesh(windowGroup, new THREE.BoxGeometry(rustic ? .13 : .08, windowHeight, .14), frameMaterial, [0, 0, .2])
    addMesh(windowGroup, new THREE.BoxGeometry(windowWidth, rustic ? .13 : .08, .14), frameMaterial, [0, rustic ? .08 : 0, .2], [0, 0, rustic ? -.018 : 0])

    const rainCount = 90
    const rainPositions = new Float32Array(rainCount * 6)
    for (let index = 0; index < rainCount; index += 1) {
      const x = -windowWidth / 2 + .08 + seeded(index * 2) * (windowWidth - .16)
      const y = -windowHeight / 2 + .08 + seeded(index * 2 + 1) * (windowHeight - .16)
      rainPositions[index * 6] = x; rainPositions[index * 6 + 1] = y; rainPositions[index * 6 + 2] = .24
      rainPositions[index * 6 + 3] = x - .055; rainPositions[index * 6 + 4] = y - (rustic ? .15 : .2); rainPositions[index * 6 + 5] = .24
    }
    const rainGeometry = new THREE.BufferGeometry()
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3))
    const rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: 0xa5d1dc, transparent: true, opacity: .42 }))
    windowGroup.add(rain)

    // Storage grows from a hand-built shelf into a full legal library.
    const books: THREE.Mesh[] = []
    const addShelf = (x: number) => {
      const shelf = new THREE.Group()
      shelf.position.set(x, rustic ? 2.35 : 2.65, -3.55)
      root.add(shelf)
      if (rustic) {
        addMesh(shelf, new THREE.BoxGeometry(.18, 4.5, .56), darkWood, [-.77, 0, 0])
        addMesh(shelf, new THREE.BoxGeometry(.18, 4.5, .56), darkWood, [.77, 0, 0])
        for (let row = 0; row < 4; row += 1) addMesh(shelf, new THREE.BoxGeometry(1.78, .16, .7), wood, [0, -2.02 + row * 1.35, .05], [0, 0, (row % 2 ? 1 : -1) * .012])
        for (let row = 0; row < 3; row += 1) {
          for (let column = 0; column < 4 + row; column += 1) {
            const height = .46 + seeded(row * 17 + column) * .27
            const palette = [0x574237, 0x3b4b49, 0x77593b, 0x4f3e35]
            const book = addMesh(shelf, new THREE.BoxGeometry(.14 + seeded(column) * .045, height, .35), new THREE.MeshStandardMaterial({ color: palette[(row + column) % palette.length], roughness: .94 }), [-.58 + column * .23, -1.74 + row * 1.35 + height / 2, .24], [0, 0, (seeded(column + row * 6) - .5) * .13])
            books.push(book)
          }
        }
        addMesh(shelf, new THREE.BoxGeometry(1.28, .56, .58), wood, [0, 1.68, .13])
        addMesh(shelf, new THREE.BoxGeometry(1.05, .035, .6), darkWood, [0, 1.69, .44])
      } else {
        addMesh(shelf, new RoundedBoxGeometry(1.8, 5.15, .48, 3, .05), darkWood, [0, 0, 0])
        addMesh(shelf, new RoundedBoxGeometry(1.55, 4.75, .54, 3, .04), new THREE.MeshStandardMaterial({ color: level >= 10 ? 0x121c27 : 0x101923, roughness: .85 }), [0, 0, .05])
        const rowCount = Math.min(5, 3 + Math.floor(level / 4))
        for (let row = 0; row < rowCount; row += 1) {
          const rowY = -1.85 + row * (4.55 / Math.max(1, rowCount - 1))
          addMesh(shelf, new THREE.BoxGeometry(1.68, .11, .65), wood, [0, rowY, .18])
          const columnCount = Math.min(9, 6 + Math.floor(level / 3))
          for (let column = 0; column < columnCount; column += 1) {
            const height = .48 + seeded(row * 17 + column) * .31
            const palette = [0x75503f, 0x415c66, 0x9b713c, 0x4e6050, 0x5d455c]
            const book = addMesh(shelf, new RoundedBoxGeometry(.11 + seeded(column) * .04, height, .38, 2, .018), new THREE.MeshStandardMaterial({ color: palette[(row * 3 + column) % palette.length], roughness: .72 }), [-.64 + column * (1.3 / Math.max(1, columnCount - 1)), rowY + .1 + height / 2, .27], [0, 0, (seeded(column + row * 6) - .5) * .08])
            books.push(book)
          }
        }
      }
    }
    if (!rustic && level >= 2) addShelf(-6.15)
    addShelf(rustic ? 6.05 : 6.15)

    if (rustic) {
      // A joined file chest and working cast-iron stove make the room a
      // believable cold-weather practice rather than a collection of props.
      addMesh(root, new THREE.BoxGeometry(1.35, .72, .92), wood, [-5.55, .38, 1.35])
      addMesh(root, new THREE.BoxGeometry(1.42, .09, .99), darkWood, [-5.55, .79, 1.35], [0, 0, -.035])
      for (const x of [-6.12, -4.98]) addMesh(root, new THREE.BoxGeometry(.08, .78, .98), brass, [x, .4, 1.35])
      for (let index = 0; index < 4; index += 1) addMesh(root, new THREE.CylinderGeometry(.055, .055, 1.0, 10), paper, [-5.9 + index * .18, 1.06, .86], [0, 0, -.18 + index * .07])

      const hearth = new THREE.Group()
      hearth.position.set(-5.82, 0, -2.6)
      root.add(hearth)
      const fieldStone = new THREE.MeshStandardMaterial({ color: 0x4b453e, roughness: 1, metalness: 0 })
      for (let stone = 0; stone < 13; stone += 1) {
        const row = Math.floor(stone / 5)
        const column = stone % 5
        const stoneMesh = addMesh(hearth, new RoundedBoxGeometry(.42 + seeded(stone) * .16, .24 + seeded(stone + 3) * .13, .52, 2, .045), fieldStone, [-1.03 + column * .49 + (row % 2) * .09, .15 + row * .27, .1], [0, (seeded(stone + 8) - .5) * .13, (seeded(stone + 14) - .5) * .08])
        stoneMesh.castShadow = true
      }
      addMesh(hearth, new RoundedBoxGeometry(1.2, .82, .72, 4, .09), charcoal, [0, .92, .02])
      addMesh(hearth, new RoundedBoxGeometry(.78, .46, .04, 3, .04), new THREE.MeshStandardMaterial({ color: 0x17191a, roughness: .74, metalness: .66 }), [0, .93, .4])
      hearthEmber = addMesh(hearth, new THREE.PlaneGeometry(.54, .23), new THREE.MeshStandardMaterial({ color: 0x8b2f18, emissive: 0xd54b20, emissiveIntensity: .65, roughness: .88 }), [0, .9, .43])
      hearthEmber.castShadow = false
      hearthLight = new THREE.PointLight(0xff7d31, .52, 3.6, 1.8)
      hearthLight.position.set(0, .92, .72)
      hearth.add(hearthLight)
      addMesh(hearth, new THREE.CylinderGeometry(.18, .2, 4.25, 18), charcoal, [.22, 3.25, -.05])
      addMesh(hearth, new THREE.BoxGeometry(1.42, .12, .9), darkWood, [0, 1.39, -.02])
      for (const x of [-.46, .46]) addMesh(hearth, new THREE.CylinderGeometry(.055, .07, .36, 10), charcoal, [x, .38, 0])

      // One continuous peg rail ties the working wall together.
      addMesh(root, new THREE.BoxGeometry(2.05, .16, .18), wood, [4.95, 2.18, -3.62], [0, 0, -.012])
      for (let peg = 0; peg < 5; peg += 1) addMesh(root, new THREE.CylinderGeometry(.035, .045, .27, 10), brass, [4.18 + peg * .38, 2.06, -3.38], [Math.PI / 2, 0, 0])
    } else if (heritage) {
      // Tier one is a repaired neighborhood office: it keeps the original
      // timber history, but adds fitted filing drawers and proper task light.
      for (let drawer = 0; drawer < 3; drawer += 1) {
        addMesh(root, new RoundedBoxGeometry(1.28, .43, .62, 3, .04), darkWood, [-5.62, .28 + drawer * .46, -.65])
        addMesh(root, new THREE.BoxGeometry(.32, .035, .035), brass, [-5.62, .28 + drawer * .46, -.31])
      }
    }

    // The work surface is a scarred trestle table in the shack and becomes a
    // progressively engineered partner desk as the firm rises.
    const desk = new THREE.Group()
    desk.position.set(rustic ? 1.18 : 1.55, 0, rustic ? .95 : .9)
    root.add(desk)
    if (rustic) {
      for (let plank = 0; plank < 5; plank += 1) addMesh(desk, new THREE.BoxGeometry(5.45, .16 + seeded(plank + 120) * .04, .35), wood, [(seeded(plank + 80) - .5) * .06, 1.25 + (plank % 2) * .018, -.7 + plank * .35], [0, (seeded(plank + 30) - .5) * .025, (seeded(plank + 15) - .5) * .012])
      for (const x of [-2.18, 2.18]) {
        addMesh(desk, new THREE.BoxGeometry(.24, 1.22, 1.25), darkWood, [x, .62, 0], [0, 0, x < 0 ? -.08 : .08])
        addMesh(desk, new THREE.BoxGeometry(.2, 1.65, .2), darkWood, [x * .92, .55, .49], [0, 0, x < 0 ? -.18 : .18])
        addMesh(desk, new THREE.BoxGeometry(.2, 1.65, .2), darkWood, [x * .92, .55, -.49], [0, 0, x < 0 ? -.18 : .18])
      }
      addMesh(desk, new THREE.BoxGeometry(4.3, .14, .18), darkWood, [0, .56, .02])
    } else {
      addMesh(desk, new RoundedBoxGeometry(5.35, .25, 1.78, 5, .08), wood, [0, 1.28, 0])
      addMesh(desk, new RoundedBoxGeometry(5.05, 1.18, 1.42, 4, .04), darkWood, [0, .63, .03])
      addMesh(desk, new RoundedBoxGeometry(1.42, .75, .055, 3, .03), leather, [0, .68, .76])
      addMesh(desk, new THREE.BoxGeometry(.18, .72, 1.18), brass, [-2.18, .66, .03])
      addMesh(desk, new THREE.BoxGeometry(.18, .72, 1.18), brass, [2.18, .66, .03])
    }

    // Tier zero uses a repaired manual typewriter; screens and extra displays
    // arrive only as the firm's actual case-management capacity grows.
    if (rustic) {
      addMesh(desk, new THREE.BoxGeometry(1.48, .24, .82), charcoal, [-.82, 1.48, -.08], [-.04, .08, 0])
      addMesh(desk, new THREE.BoxGeometry(1.12, .38, .22), charcoal, [-.82, 1.71, -.34], [-.08, .08, 0])
      for (let row = 0; row < 3; row += 1) for (let key = 0; key < 8; key += 1) addMesh(desk, new THREE.CylinderGeometry(.035, .035, .022, 8), paper, [-1.27 + key * .13, 1.62 - row * .06, .02 + row * .12], [Math.PI / 2, 0, 0])
      addMesh(desk, new THREE.PlaneGeometry(.82, .76), paper, [-.82, 2.0, -.37], [-.13, .08, 0])
      addMesh(desk, new THREE.CylinderGeometry(.035, .035, 1.32, 12), brass, [-.82, 1.84, -.31], [0, 0, Math.PI / 2])
    } else {
      addMesh(desk, new RoundedBoxGeometry(1.63, .98, .08, 4, .035), charcoal, [-.88, 2.0, -.23], [-.08, .05, 0])
      const display = addMesh(desk, new THREE.PlaneGeometry(1.46, .81), screen, [-.88, 2.0, -.175], [-.08, .05, 0])
      display.castShadow = false
      addMesh(desk, new THREE.CylinderGeometry(.09, .12, .68, 18), charcoal, [-.88, 1.55, -.25])
      addMesh(desk, new RoundedBoxGeometry(.72, .05, .38, 3, .025), charcoal, [-.88, 1.29, -.12])
      const extraDisplays = level >= 4 ? 1 + Math.floor((level - 4) / 5) : 0
      for (let monitor = 0; monitor < extraDisplays; monitor += 1) {
        const x = -1.82 - monitor * .78
        addMesh(desk, new RoundedBoxGeometry(.68, .48, .055, 3, .025), charcoal, [x, 1.82, -.18], [-.06, .1 + monitor * .05, 0])
        addMesh(desk, new THREE.PlaneGeometry(.59, .39), screen, [x, 1.82, -.145], [-.06, .1 + monitor * .05, 0]).castShadow = false
      }
    }
    for (let index = 0; index < (rustic ? 7 : 4); index += 1) addMesh(desk, new RoundedBoxGeometry(1.05 - Math.min(index, 3) * .05, .025, .72, 2, .008), index % 2 ? paper : new THREE.MeshStandardMaterial({ color: rustic ? 0x81785e : 0xb6c8b9, roughness: .9 }), [.35 + index * .018, 1.39 + index * .027, .16], [0, -.16 + index * .025, (seeded(index) - .5) * .02])
    const caseAnchor = new THREE.Object3D()
    caseAnchor.position.set(.38, 1.47, .2)
    desk.add(caseAnchor)
    const lampGroup = new THREE.Group()
    lampGroup.position.set(1.42, 1.42, -.18)
    desk.add(lampGroup)
    const lampAnchor = new THREE.Object3D()
    lampAnchor.position.set(0, rustic ? .52 : 1.05, .08)
    lampGroup.add(lampAnchor)
    let lanternFlame: THREE.Mesh | null = null
    if (rustic) {
      addMesh(lampGroup, new THREE.CylinderGeometry(.29, .36, .12, 18), charcoal, [0, 0, 0])
      addMesh(lampGroup, new THREE.CylinderGeometry(.25, .22, .66, 18, 1, true), new THREE.MeshPhysicalMaterial({ color: 0xd3a75c, transparent: true, opacity: .27, transmission: .25, roughness: .2, side: THREE.DoubleSide }), [0, .38, 0])
      addMesh(lampGroup, new THREE.CylinderGeometry(.22, .28, .1, 18), charcoal, [0, .74, 0])
      addMesh(lampGroup, new THREE.TorusGeometry(.32, .025, 10, 30, Math.PI), charcoal, [0, .7, 0], [0, 0, 0])
      lanternFlame = addMesh(lampGroup, new THREE.ConeGeometry(.07, .28, 12), new THREE.MeshStandardMaterial({ color: 0xffc363, emissive: 0xff7a20, emissiveIntensity: 2.1, roughness: .4 }), [0, .3, 0])
    } else {
      addMesh(lampGroup, new THREE.CylinderGeometry(.35, .42, .08, 28), brass, [0, 0, 0])
      addMesh(lampGroup, new THREE.CylinderGeometry(.04, .04, 1.2, 18), brass, [0, .58, 0], [0, 0, -.16])
      addMesh(lampGroup, new THREE.ConeGeometry(.48, .52, 28, 1, true), new THREE.MeshStandardMaterial({ color: 0x18252f, roughness: .35, metalness: .62, side: THREE.DoubleSide }), [-.1, 1.23, 0], [0, 0, Math.PI])
    }
    const deskLight = new THREE.PointLight(rustic ? 0xffad55 : 0xffc871, rustic ? 2.05 : 2.5, rustic ? 4.6 : 5.8, 1.45)
    deskLight.position.set(rustic ? 0 : -.1, rustic ? .42 : 1.02, .08)
    deskLight.castShadow = true
    deskLight.shadow.mapSize.set(512, 512)
    lampGroup.add(deskLight)

    // Coffee mug and GPU-animated steam points.
    addMesh(desk, new THREE.CylinderGeometry(.17, .14, .38, 24), new THREE.MeshPhysicalMaterial({ color: rustic ? 0x425157 : 0xd8c9a4, roughness: rustic ? .72 : .36, clearcoat: rustic ? .08 : .4 }), [1.98, 1.52, .28])
    addMesh(desk, new THREE.TorusGeometry(.16, .035, 12, 24, Math.PI * 1.65), rustic ? charcoal : paper, [2.13, 1.53, .28], [Math.PI / 2, 0, Math.PI / 2])
    const coffeeAnchor = new THREE.Object3D()
    coffeeAnchor.position.set(1.98, 1.72, .28)
    desk.add(coffeeAnchor)
    const steamGeometry = new THREE.BufferGeometry()
    const steamPositions = new Float32Array(24 * 3)
    for (let index = 0; index < 24; index += 1) { steamPositions[index * 3] = 3.53 + (seeded(index) - .5) * .18; steamPositions[index * 3 + 1] = 1.82 + seeded(index + 7) * .65; steamPositions[index * 3 + 2] = 1.18 + (seeded(index + 13) - .5) * .16 }
    steamGeometry.setAttribute('position', new THREE.BufferAttribute(steamPositions, 3))
    const steam = new THREE.Points(steamGeometry, new THREE.PointsMaterial({ color: 0xe8e1d1, size: .045, transparent: true, opacity: .3, depthWrite: false }))
    root.add(steam)

    // Seating follows the office: a repaired slat chair first, tailored leather
    // only after the practice reaches a real suite.
    const chair = new THREE.Group()
    chair.position.set(rustic ? -.72 : -.28, 0, rustic ? 2.72 : 2.6)
    chair.rotation.y = rustic ? .18 : -.05
    root.add(chair)
    if (rustic) {
      addMesh(chair, new THREE.BoxGeometry(1.15, .18, 1.0), wood, [0, 1.02, 0], [-.025, 0, 0])
      for (const x of [-.47, .47]) for (const z of [-.38, .38]) addMesh(chair, new THREE.BoxGeometry(.13, 1.1, .13), darkWood, [x, .51, z], [z > 0 ? -.07 : .04, 0, x < 0 ? -.025 : .025])
      addMesh(chair, new THREE.BoxGeometry(.14, 1.75, .16), darkWood, [-.47, 1.72, -.4], [-.08, 0, 0])
      addMesh(chair, new THREE.BoxGeometry(.14, 1.75, .16), darkWood, [.47, 1.72, -.4], [-.08, 0, 0])
      for (let slat = 0; slat < 3; slat += 1) addMesh(chair, new THREE.BoxGeometry(.75, .16, .1), wood, [0, 1.43 + slat * .38, -.41], [-.08, 0, slat === 1 ? .018 : -.012])
    } else {
      addMesh(chair, new RoundedBoxGeometry(1.42, .34, 1.18, 5, .14), leather, [0, 1.1, 0])
      addMesh(chair, new RoundedBoxGeometry(1.48, 1.75, .3, 6, .18), leather, [0, 2.05, -.48], [-.08, 0, 0])
      addMesh(chair, new THREE.CylinderGeometry(.07, .08, .9, 16), charcoal, [0, .62, 0])
      for (let index = 0; index < 5; index += 1) {
        const angle = index / 5 * Math.PI * 2
        addMesh(chair, new THREE.CylinderGeometry(.035, .035, .72, 10), charcoal, [Math.cos(angle) * .31, .19, Math.sin(angle) * .31], [Math.sin(angle) * Math.PI / 2, 0, -Math.cos(angle) * Math.PI / 2])
      }
    }

    // Corkboard, architectural clock, and a restrained sleeping cat.
    const board = new THREE.Group(); board.position.set(rustic ? 2.35 : 2.15, rustic ? 3.72 : 3.48, -3.86); root.add(board)
    addMesh(board, rustic ? new THREE.BoxGeometry(2.12, 1.34, .16) : new RoundedBoxGeometry(2.05, 1.28, .14, 3, .04), darkWood, [0, 0, 0], [0, 0, rustic ? -.025 : 0])
    addMesh(board, rustic ? new THREE.BoxGeometry(1.84, 1.08, .08) : new RoundedBoxGeometry(1.82, 1.06, .08, 3, .025), new THREE.MeshStandardMaterial({ color: rustic ? 0x65462e : 0x7b5d3d, roughness: .97 }), [0, 0, .11])
    addMesh(board, new THREE.PlaneGeometry(.62, .46), paper, [-.43, .18, .17], [0, 0, rustic ? -.13 : -.07])
    addMesh(board, new THREE.PlaneGeometry(.7, .56), paper, [.43, -.12, .17], [0, 0, rustic ? .09 : .05])
    const storyAnchor = new THREE.Object3D()
    storyAnchor.position.set(0, 0, .22)
    board.add(storyAnchor)
    const firmAnchor = new THREE.Object3D()
    firmAnchor.position.set(rustic ? 5.95 : -6.05, rustic ? 2.4 : 2.65, -3.22)
    root.add(firmAnchor)
    const clock = new THREE.Group(); clock.position.set(rustic ? -.15 : -.2, rustic ? 4.42 : 4.15, -3.84); root.add(clock)
    addMesh(clock, new THREE.CylinderGeometry(rustic ? .36 : .42, rustic ? .36 : .42, .12, rustic ? 18 : 36), rustic ? darkWood : brass, [0, 0, 0], [Math.PI / 2, 0, 0])
    addMesh(clock, new THREE.CircleGeometry(rustic ? .28 : .34, rustic ? 18 : 36), paper, [0, 0, .075])
    const minuteHand = addMesh(clock, new THREE.BoxGeometry(.025, .25, .025), charcoal, [0, .11, .095])
    minuteHand.geometry.translate(0, -.11, 0)
    const cat = new THREE.Group(); cat.position.set(rustic ? -4.75 : -4.65, rustic ? .92 : .34, rustic ? 1.35 : 2.1); cat.rotation.y = .22; root.add(cat)
    const catFur = new THREE.MeshPhysicalMaterial({ color: 0x9a6646, roughness: .82, sheen: .5, sheenColor: new THREE.Color(0x5f392b) })
    const catBody = addMesh(cat, new THREE.SphereGeometry(.42, 24, 18), catFur, [0, 0, 0]); catBody.scale.set(1.55, .62, .85)
    addMesh(cat, new THREE.SphereGeometry(.24, 22, 16), catFur, [-.48, .16, .01])
    addMesh(cat, new THREE.ConeGeometry(.1, .22, 4), catFur, [-.57, .4, -.08], [0, 0, -.14])
    addMesh(cat, new THREE.ConeGeometry(.1, .22, 4), catFur, [-.38, .39, -.08], [0, 0, .14])
    const tailCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(.38,.02,0), new THREE.Vector3(.7,.18,.08), new THREE.Vector3(.86,.48,.04), new THREE.Vector3(.7,.65,0)])
    const catTail = addMesh(cat, new THREE.TubeGeometry(tailCurve, 22, .055, 10, false), catFur, [0, 0, 0])

    // Renovations read as architectural improvements, not loose reward props.
    if (!rustic) {
      const rug = addMesh(root, new THREE.PlaneGeometry(5.2 + Math.min(1.4, level * .1), 3.15), new THREE.MeshStandardMaterial({ color: look.upholstery, roughness: .98, metalness: 0 }), [.15, .018, 1.35], [-Math.PI / 2, 0, 0])
      rug.receiveShadow = true
      addMesh(root, new THREE.BoxGeometry(5.45 + Math.min(1.4, level * .1), .025, 3.36), new THREE.MeshStandardMaterial({ color: look.accent, roughness: .75, metalness: .25 }), [.15, .008, 1.35])
      // The rug surface sits just above its border to avoid z-fighting.
      rug.position.y = .026
    }
    const practicalCount = rustic ? 0 : Math.min(4, Math.max(1, detailLevel - 1))
    for (let index = 0; index < practicalCount; index += 1) {
      const x = -4.5 + index * (9 / Math.max(1, practicalCount - 1))
      addMesh(root, new THREE.CylinderGeometry(.25, .29, .08, 24), charcoal, [x, 6.25, .4])
      addMesh(root, new THREE.CircleGeometry(.2, 24), new THREE.MeshStandardMaterial({ color: 0xf0ddb0, emissive: 0xc89b54, emissiveIntensity: .72, roughness: .5 }), [x, 6.20, .4], [Math.PI / 2, 0, 0])
    }
    if (level >= 6) {
      // An integrated evidence wall becomes denser with national/global scale.
      const evidencePanel = new THREE.Group(); evidencePanel.position.set(3.25, 4.55, -3.82); root.add(evidencePanel)
      addMesh(evidencePanel, new RoundedBoxGeometry(3.1, 1.1, .09, 4, .035), new THREE.MeshStandardMaterial({ color: 0x101a22, roughness: .38, metalness: .36 }), [0, 0, 0])
      const traceCount = Math.min(9, 3 + Math.floor(level / 2))
      for (let trace = 0; trace < traceCount; trace += 1) addMesh(evidencePanel, new THREE.BoxGeometry(.18 + seeded(trace) * .55, .018, .012), new THREE.MeshBasicMaterial({ color: trace % 3 ? 0x5da39e : look.accent }), [-1.2 + (trace % 4) * .72, -.35 + Math.floor(trace / 4) * .3, .06], [0, 0, (seeded(trace + 4) - .5) * .4])
    }
    if (frontier) {
      // Orbital/lunar tiers gain one coherent, restrained jurisdiction model.
      const jurisdiction = new THREE.Group(); jurisdiction.position.set(4.3, 1.85, -.7); root.add(jurisdiction)
      addMesh(jurisdiction, new THREE.SphereGeometry(.32, 28, 20), new THREE.MeshStandardMaterial({ color: level === 13 ? 0xaab2b1 : 0x376f7f, roughness: .54, metalness: .18, emissive: level === 14 ? 0x173d48 : 0x000000, emissiveIntensity: .35 }), [0, 0, 0])
      for (let ring = 0; ring < Math.min(3, level - 11); ring += 1) addMesh(jurisdiction, new THREE.TorusGeometry(.48 + ring * .12, .018, 10, 42), brass, [0, 0, 0], [Math.PI / 2 + ring * .38, ring * .31, 0])
    }
    for (let index = 0; index < Math.min(3, staffCount); index += 1) {
      const x = -4.75 + index * .58
      addMesh(root, new THREE.BoxGeometry(.48, .035, .64), paper, [x, .92 + index * .05, rustic ? 1.0 : -.7], [0, -.12 + index * .08, .015 * index])
    }

    // Restrained cinematic lighting: deeper timber contact shadows at tier zero,
    // cleaner architectural fill as the headquarters becomes more prestigious.
    scene.add(new THREE.HemisphereLight(rustic ? 0x66777c : 0x9ab9c5, rustic ? 0x160c08 : 0x211510, rustic ? .46 : .94))
    const keyLight = new THREE.DirectionalLight(rustic ? 0xd8ad79 : 0xffe0aa, rustic ? .72 : 1.5)
    keyLight.position.set(-3.5, 7.2, 6.5)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(1024, 1024)
    keyLight.shadow.camera.left = -8; keyLight.shadow.camera.right = 8; keyLight.shadow.camera.top = 7; keyLight.shadow.camera.bottom = -4
    scene.add(keyLight)
    const windowLight = new THREE.SpotLight(rustic ? 0x557b86 : 0x7ab3cd, rustic ? 1.35 : 2.65, 14, .72, .72, 1.3)
    windowLight.position.set(windowX, 3.7, -2.8)
    windowLight.target.position.set(-1.2, 0, 2.8)
    scene.add(windowLight, windowLight.target)

    const dustCount = 105
    const dustPositions = new Float32Array(dustCount * 3)
    for (let index = 0; index < dustCount; index += 1) { dustPositions[index * 3] = -6 + seeded(index) * 12; dustPositions[index * 3 + 1] = .25 + seeded(index + 31) * 5.8; dustPositions[index * 3 + 2] = -3.4 + seeded(index + 61) * 7.5 }
    const dustGeometry = new THREE.BufferGeometry(); dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3))
    const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0xe8d4a5, size: .025, transparent: true, opacity: .22, depthWrite: false }))
    root.add(dust)

    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const ssao = new SSAOPass(scene, camera, 1, 1)
    ssao.kernelRadius = rustic ? 11 : 8
    ssao.minDistance = .002
    ssao.maxDistance = rustic ? .12 : .09
    composer.addPass(ssao)
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), rustic ? .07 : .1, rustic ? .24 : .3, .94)
    composer.addPass(bloom)
    composer.addPass(new OutputPass())

    const surface = canvas.closest<HTMLElement>('.av-office')
    const pointer = new THREE.Vector2(0, 0)
    const onPointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect()
      pointer.x = ((event.clientX - bounds.left) / Math.max(1, bounds.width) - .5) * 2
      pointer.y = ((event.clientY - bounds.top) / Math.max(1, bounds.height) - .5) * 2
    }
    const onPointerLeave = () => pointer.set(0, 0)
    surface?.addEventListener('pointermove', onPointerMove)
    surface?.addEventListener('pointerleave', onPointerLeave)
    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      const width = Math.max(1, Math.round(bounds.width))
      const height = Math.max(1, Math.round(bounds.height))
      renderer.setSize(width, height, false)
      composer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const startedAt = performance.now()
    let frame = 0
    let lastAnchorDispatch = -Infinity

    const anchorPosition = (object: THREE.Object3D) => {
      const projected = object.getWorldPosition(new THREE.Vector3()).project(camera)
      return {
        x: THREE.MathUtils.clamp((projected.x * .5 + .5) * 100, 2, 98),
        y: THREE.MathUtils.clamp((-projected.y * .5 + .5) * 100, 2, 98),
      }
    }

    const draw = (now = performance.now()) => {
      const elapsed = (now - startedAt) / 1000
      const targetX = pointer.x * .34
      const targetY = (rustic ? 3.0 : 3.15) - pointer.y * .14
      camera.position.x += (targetX - camera.position.x) * .035
      camera.position.y += (targetY - camera.position.y) * .035
      cameraTarget.x = (rustic ? -.15 : .1) + pointer.x * .2
      cameraTarget.y = (rustic ? 1.72 : 1.8) - pointer.y * .08
      camera.lookAt(cameraTarget)
      if (now - lastAnchorDispatch > 80) {
        lastAnchorDispatch = now
        canvas.dispatchEvent(new CustomEvent('office-anchor-update', {
          bubbles: true,
          detail: {
            lamp: anchorPosition(lampAnchor),
            window: anchorPosition(windowAnchor),
            coffee: anchorPosition(coffeeAnchor),
            cat: anchorPosition(cat),
            case: anchorPosition(caseAnchor),
            firm: anchorPosition(firmAnchor),
            empire: anchorPosition(empireAnchor),
            story: anchorPosition(storyAnchor),
          },
        }))
      }

      const office = surface
      const storm = office?.classList.contains('room-storm') ?? false
      const focus = office?.classList.contains('room-focus') ?? false
      const cozy = office?.classList.contains('is-cozy') ?? false
      const awake = office?.classList.contains('cat-awake') ?? false
      deskLight.intensity += ((focus ? (rustic ? 3.7 : 4.8) : (rustic ? 2.05 : 2.5)) - deskLight.intensity) * .08
      windowLight.intensity += ((storm ? (rustic ? 3.2 : 5.0) : (rustic ? 1.35 : 2.65)) - windowLight.intensity) * .06
      ;(screen as THREE.MeshStandardMaterial).emissiveIntensity = .52 + Math.sin(elapsed * 1.1) * .07
      if (lanternFlame) {
        lanternFlame.scale.y = .84 + Math.sin(elapsed * 8.2) * .11 + Math.sin(elapsed * 13.7) * .05
        lanternFlame.rotation.z = Math.sin(elapsed * 6.4) * .045
      }
      if (hearthEmber && hearthLight) {
        const emberPulse = .88 + Math.sin(elapsed * 3.7) * .08 + Math.sin(elapsed * 8.9) * .035
        ;(hearthEmber.material as THREE.MeshStandardMaterial).emissiveIntensity = .58 * emberPulse
        hearthLight.intensity = .48 * emberPulse
      }
      minuteHand.rotation.z = -elapsed * .11
      catTail.rotation.y = Math.sin(elapsed * (awake ? 4.4 : 1.05)) * (awake ? .22 : .07)
      cat.rotation.z = Math.sin(elapsed * .7) * .005
      books.forEach((book, index) => { if (index % 11 === 0) book.rotation.z = Math.sin(elapsed * .16 + index) * .012 })
      exteriorMovers.forEach((object, index) => {
        if (look.exterior === 'forest') object.rotation.z = (object.userData.restRotation ?? 0) + Math.sin(elapsed * .42 + index * .71) * .015
        else if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) object.material.emissiveIntensity = .13 + Math.sin(elapsed * .55 + index) * .045 + level * .008
      })
      dust.rotation.y = elapsed * .009

      const rainAttribute = rainGeometry.getAttribute('position') as THREE.BufferAttribute
      const rainArray = rainAttribute.array as Float32Array
      const rainSpeed = storm ? .038 : .018
      for (let index = 0; index < rainCount; index += 1) {
        const base = index * 6
        rainArray[base + 1] -= rainSpeed
        rainArray[base + 4] -= rainSpeed
        if (rainArray[base + 4] < -windowHeight / 2 - .1) {
          rainArray[base + 1] = windowHeight / 2 + .08
          rainArray[base + 4] = windowHeight / 2 - (rustic ? .07 : .12)
        }
      }
      rainAttribute.needsUpdate = true

      const steamAttribute = steamGeometry.getAttribute('position') as THREE.BufferAttribute
      const steamArray = steamAttribute.array as Float32Array
      for (let index = 0; index < 24; index += 1) {
        steamArray[index * 3 + 1] += cozy ? .006 : .002
        steamArray[index * 3] += Math.sin(elapsed + index) * .00035
        if (steamArray[index * 3 + 1] > 2.52) steamArray[index * 3 + 1] = 1.82
      }
      steamAttribute.needsUpdate = true
      ;(steam.material as THREE.PointsMaterial).opacity = cozy ? .52 : .22

      composer.render()
      canvas.classList.add('is-ready')
      if (!reduced) frame = window.requestAnimationFrame(draw)
    }
    draw()

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      observer.disconnect()
      surface?.removeEventListener('pointermove', onPointerMove)
      surface?.removeEventListener('pointerleave', onPointerLeave)
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.LineSegments) {
          object.geometry.dispose()
          const material = object.material
          if (Array.isArray(material)) material.forEach((item) => item.dispose())
          else material.dispose()
        }
      })
      floorMap.dispose(); wallMap?.dispose(); screenMap.dispose(); environmentTarget.dispose(); environment.dispose(); pmrem.dispose(); composer.dispose(); renderer.dispose()
    }
  }, [staffCount, tier, upgrades])

  return <canvas className="office-three-canvas" ref={canvasRef} aria-label="Interactive three-dimensional law office" role="img" />
}
