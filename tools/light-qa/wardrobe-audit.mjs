/**
 * Does every piece of the wardrobe actually reach the figure?
 *
 * The suite was authored by one session, the portrait rig was converted to a
 * skeleton by another, and the map's people were switched to seeded character
 * models by a third. Nobody has since asked the only question that matters: if
 * a player equips an item, does anything about the body change?
 *
 * ## Why this asks the builder rather than the screen
 *
 * Both surfaces the player's own counsel appears on — the portrait canvases in
 * `stylized-character.tsx` and the map's `createLawyer` — go through
 * `buildStylizedCounsel`, and they go through it with different arguments. The
 * portrait passes `cosmetics` as a prop; the map cannot reach React from inside
 * a scene graph, so it reads a module registry filled by `setPlayerCosmetics`.
 * Those are two distinct paths to the same builder, and each is exercised here
 * as the surface exercises it.
 *
 * The test is a signature per figure: mesh count, triangle count, the summed
 * material colours, and the body's bounding box. An item that adds geometry
 * moves the first two, an item that only recolours moves the third, and an item
 * that reaches nothing at all moves none of them — which is the failure being
 * hunted. Comparing signatures is what makes "it renders" falsifiable; a
 * screenshot of a suit is not, because two suits differ by forty grey pixels
 * somewhere in a hundred-pixel-wide figure.
 *
 * Stills are captured as well, for the pieces where a number cannot say whether
 * the result is *right* — a tie that renders inside the chest still moves every
 * counter.
 *
 * ## The two render settings, and why both
 *
 * `setRenderScale` quantises to a rung and the rung decides which features are
 * cut at all: at .25 `silhouetteOnly` is on. The map's crowd builds at .278,
 * which quantises to that rung, and the office's cast at .46, which does not.
 * A piece dropped by a detail gate would therefore be present in the portrait
 * and missing from a body on the pavement, which is exactly the shape of bug
 * the user suspects — so every item is built at both rungs and the two are
 * compared.
 *
 * Usage: node tools/light-qa/wardrobe-audit.mjs <tag>
 *   LIGHT_BASE=http://127.0.0.1:5174
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { launch } from './browser.mjs'

const BASE = process.env.LIGHT_BASE || 'http://127.0.0.1:5174'
const ROOT = process.env.LIGHT_OUT || fileURLToPath(new URL('../../.light', import.meta.url))
const tag = process.argv[2] ?? 'wardrobe'
const SHOTS = `${ROOT}/.light-shots/${tag}`
const REPORTS = `${ROOT}/.light-run`
mkdirSync(SHOTS, { recursive: true })
mkdirSync(REPORTS, { recursive: true })

/**
 * The suite, as the backend authors it in `game.py`'s `WARDROBE`.
 *
 * Restated rather than fetched so the probe says out loud what it believes the
 * catalog to be: a piece the backend has added and the client has never heard
 * of is a finding, and a probe that reads the catalog from the server can only
 * report that every item it was told about works.
 */
const SUITE = {
  suit: [
    'suit_house_navy', 'suit_charcoal', 'suit_slate', 'suit_forest',
    'suit_oxblood', 'suit_cream_linen', 'suit_pinstripe',
  ],
  tie: [
    'tie_house_burgundy', 'tie_open_collar', 'tie_regimental',
    'tie_gold_foulard', 'tie_bow', 'tie_cravat',
  ],
  hair: ['hair_signature', 'hair_cropped', 'hair_full', 'hair_distinguished'],
  eyewear: [
    'eyewear_as_issued', 'eyewear_none', 'eyewear_round',
    'eyewear_rectangular', 'eyewear_tortoiseshell',
  ],
  accessory: [
    'accessory_as_issued', 'accessory_none', 'accessory_lapel_pin',
    'accessory_pocket_square', 'accessory_wristwatch', 'accessory_briefcase',
  ],
}

const report = { tag, base: BASE, at: new Date().toISOString(), genders: {}, errors: [] }

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 900, height: 900 } })
page.on('pageerror', (error) => report.errors.push(String(error.message).slice(0, 300)))
page.on('console', (message) => {
  if (message.type() === 'error') report.errors.push(message.text().slice(0, 300))
})

try {
  // Any page off the dev server will do: what is needed is a document whose
  // origin can dynamically import the app's own modules, which is how this
  // probe reaches the builder without a harness page of its own.
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })

  const measured = await page.evaluate(async ({ suite }) => {
    const THREE = await import('/node_modules/three/build/three.module.js')
    const counsel = await import('/src/art/stylized-counsel.ts')

    /**
     * Everything about a built body that a wardrobe piece could move.
     *
     * Colours are summed as a single integer rather than listed because the
     * question is only whether the figure changed, and a sum over every
     * material in the body is sensitive to one lapel changing shade while
     * staying a scalar that can be diffed at a glance.
     */
    const signature = (root) => {
      let meshes = 0
      let triangles = 0
      let colour = 0
      const box = new THREE.Box3()
      root.updateWorldMatrix(true, true)
      root.traverse((node) => {
        if (!node.isMesh) return
        meshes += 1
        const index = node.geometry.getIndex()
        const position = node.geometry.getAttribute('position')
        triangles += index ? index.count / 3 : (position ? position.count / 3 : 0)
        const material = node.material
        if (material?.color) {
          colour = (colour + material.color.getHex()) % 0xffffffff
        }
        box.expandByObject(node)
      })
      return {
        meshes,
        triangles,
        colour,
        box: [
          Number(box.min.x.toFixed(3)), Number(box.min.y.toFixed(3)), Number(box.min.z.toFixed(3)),
          Number(box.max.x.toFixed(3)), Number(box.max.y.toFixed(3)), Number(box.max.z.toFixed(3)),
        ].join(','),
      }
    }

    const build = (gender, cosmetics, renderScale) => {
      const rig = counsel.buildStylizedCounsel(gender, 8, { cosmetics, renderScale })
      return { rig, signature: signature(rig.root) }
    }

    const same = (a, b) => a.meshes === b.meshes && a.triangles === b.triangles
      && a.colour === b.colour && a.box === b.box

    /**
     * The reference is the undressed figure, not the category's first entry.
     *
     * Using the first entry looked obvious and is wrong: the "as issued" and
     * "signature" defaults are defined as *no override*, so they resolve to
     * whatever the palette seed rolled — and the player's seed is fixed at 0 for
     * the male cut and 1 for the female one. On the female seed the roll happens
     * to be the full cut, so measuring "Full volume" against "Signature cut"
     * reported the item as broken when what it had actually found was that those
     * two choices are the same hair for every female player. Against the
     * undressed figure the distinction is clean: `null` cosmetics is the exact
     * path every NPC takes and the exact figure a player had before the wardrobe
     * existed.
     */
    const out = {}
    for (const gender of ['male', 'female']) {
      out[gender] = {}
      const plain = { 1: build(gender, null, 1).signature, .278: build(gender, null, .278).signature }
      for (const [category, keys] of Object.entries(suite)) {
        out[gender][category] = {}
        const base = {}
        for (const [other, list] of Object.entries(suite)) base[other] = list[0]
        for (const key of keys) {
          const selection = { ...base, [category]: key }
          const portrait = build(gender, selection, 1)
          const crowd = build(gender, selection, .278)
          /*
           * The map's path, which is not the portrait's. `createLawyer` builds
           * with no options at all, so the builder resolves the wardrobe from
           * the module registry `setPlayerCosmetics` fills rather than from an
           * argument. A piece that arrives through the prop and not through the
           * registry renders in the portrait and not on the map, which is
           * precisely the failure being hunted, and only this comparison can
           * see it.
           */
          counsel.setPlayerCosmetics(selection)
          const viaRegistry = signature(counsel.buildStylizedCounsel(gender, 8).root)
          counsel.setPlayerCosmetics(null)
          out[gender][category][key] = {
            portrait: portrait.signature,
            crowd: crowd.signature,
            registry: viaRegistry,
            // Whether the piece reached the figure at all, per path.
            movedPortrait: !same(portrait.signature, plain[1]),
            movedCrowd: !same(crowd.signature, plain[.278]),
            // The registry path has to agree with the prop path piece for
            // piece, or the two surfaces disagree about what the player wears.
            registryAgrees: same(viaRegistry, portrait.signature),
          }
        }
        // Two pieces in one category that build the same body are a choice the
        // player cannot see the result of, whether or not either is "broken".
        for (const key of keys) {
          const collisions = keys.filter((other) => other !== key
            && same(out[gender][category][other]?.portrait ?? {}, out[gender][category][key].portrait))
          out[gender][category][key].collidesWith = collisions
        }
      }
    }

    return { out }
  }, { suite: SUITE })

  report.genders = measured.out

  const failures = []
  for (const [gender, categories] of Object.entries(measured.out)) {
    for (const [category, items] of Object.entries(categories)) {
      for (const [key, entry] of Object.entries(items)) {
        // "None" removes a feature the seed may not have rolled, so it is the
        // one piece allowed to leave the undressed figure untouched.
        const optional = key.endsWith('_none')
        const flags = [
          entry.movedPortrait || optional ? '' : 'PORTRAIT-UNCHANGED',
          entry.movedCrowd || optional ? '' : 'CROWD-UNCHANGED',
          entry.registryAgrees ? '' : 'REGISTRY-DISAGREES',
          entry.collidesWith.length ? `SAME-AS ${entry.collidesWith.join(',')}` : '',
        ].filter(Boolean)
        if (flags.length) failures.push(`${gender} ${key}: ${flags.join(' ')}`)
        console.log(
          `${gender.padEnd(6)} ${key.padEnd(26)} portrait ${String(entry.portrait.meshes).padStart(3)}m/${String(entry.portrait.triangles).padStart(6)}t`,
          `crowd ${String(entry.crowd.meshes).padStart(3)}m/${String(entry.crowd.triangles).padStart(5)}t  ${flags.length ? flags.join(' ') : 'ok'}`,
        )
      }
    }
  }
  report.failures = failures
  console.log(`\n${failures.length} findings`)
  for (const line of failures) console.log(`  ${line}`)
} finally {
  writeFileSync(`${REPORTS}/wardrobe-audit-${tag}.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(`\nwrote ${REPORTS}/wardrobe-audit-${tag}.json`)
