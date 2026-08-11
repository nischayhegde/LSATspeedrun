/**
 * Every district in a region, checked for the four things a landmark buys it.
 *
 * Twelve of the thirty-eight districts — all of the Treaty Sea, all of the
 * Global Compact — went to merge with `landmark: None`. Nothing failed: the
 * ledger row simply had no pin, the district guide did not render at all
 * (`landmarks.length > 0` gates it), there was no brief to read, and the five
 * connections that open districts *only* in those two regions had nowhere to
 * put a contact. A demo never reaches tier 7, so nothing said so.
 *
 * That is the class of defect a screenshot cannot catch and a type cannot
 * either, because `landmark_key` is legitimately nullable. So this walks all
 * four for every district in a region and fails loudly on any that is missing:
 *
 *   join     every district's `landmark_key` resolves in its own region's scene
 *   siting   no landmark sits on standing ground, or in the launch's own lane
 *   pin      the ledger row's pin lands on the map with the row marked
 *   flight   the guide row moves the camera to the place
 *   brief    the brief renders, and says held, open or locked
 *   contact  each owned network's figure stands at a district it opens
 *
 * The late-game half needs a late-game firm; `tools/map-qa/late-firm.py` stands
 * one up, and `MAPS_EMAIL` signs in as it.
 *
 *   MAPS_EMAIL=late-firm@localhost.test node tools/map-qa/landmarks.mjs v1 ocean orbit
 */
import { open, region, save, TABS, OUT, BASE, EMAIL } from './lib.mjs'

const tag = process.argv[2] ?? 'v1'
const keys = process.argv.slice(3).length ? process.argv.slice(3) : ['ocean', 'orbit']
const dir = `${OUT}/landmarks-${tag}`

const { browser, page, errors } = await open()
const report = { base: BASE, email: EMAIL, regions: {} }
const failures = []
const warnings = []
try {
  report.account = await page.evaluate(async () => {
    const game = (await (await fetch('/v1/game', { credentials: 'include' })).json()).game
    const connections = game.catalog.assets.filter((asset) => asset.type === 'connection')
    return {
      tier: game.office_tier,
      reputation: Math.round(game.reputation),
      districts_held: game.territory.districts.filter((district) => district.owned).length,
      districts_total: game.territory.districts.length,
      connections_owned: connections.filter((asset) => asset.owned).length,
      unjoined: game.territory.districts.filter((district) => !district.landmark_key).map((district) => district.key),
    }
  })
  console.log('account:', JSON.stringify(report.account))
  if (report.account.unjoined.length) {
    failures.push(`${report.account.unjoined.length} districts carry no landmark_key: ${report.account.unjoined.join(', ')}`)
  }

  for (const key of keys) {
    await region(page, TABS[key], { key })
    // The scene resets `renderer.info` every frame, so reading it without
    // drawing one reports 1 call and 1 triangle. Ticked, not slept.
    await page.evaluate(() => window.__clock?.tick(2))
    // A firm this probe stood up is a fresh firm, so the prologue chapter card
    // is open over the right-hand third of the map. `dismissOverlays` does not
    // know about it because no other probe signs in as a new account.
    await page.evaluate(() => {
      for (const button of document.querySelectorAll('.chapter-prompt-later, .tour-offer-decline')) button.click()
    })
    await page.waitForTimeout(200)
    const found = { key }

    /* ---- the join, and the ground each landmark was sited on ---- */
    found.scene = await page.evaluate(() => {
      const THREE = window.__mapThree
      const world = window.__mapScene.world
      const round = (value) => Number(value.toFixed(2))
      const landmarks = world.userData.landmarks ?? []
      // The same footprint sweep `sites.mjs` prints, so "clear of the ground"
      // is judged against the ground the region actually built rather than
      // against the constants somebody typed while authoring.
      const ground = []
      const box = new THREE.Box3()
      world.traverse((child) => {
        if (!child.isMesh || child.isInstancedMesh) return
        // A contact's own footing is not ground the district has to avoid: on
        // the Treaty Sea it is placed *at* the district, so counting it made
        // all three districts with a contact look as though they had been sited
        // on top of something.
        if (child.userData?.contactLandform) return
        const type = child.geometry?.type ?? ''
        if (type !== 'ExtrudeGeometry' && type !== 'CylinderGeometry') return
        box.setFromObject(child)
        const size = box.getSize(new THREE.Vector3())
        if (size.y > 1.2 || size.x < .8 || size.x > 12) return
        const centre = box.getCenter(new THREE.Vector3())
        ground.push({ x: centre.x, z: centre.z, hx: size.x / 2, hz: size.z / 2 })
      })
      // How far a landmark's disc reaches into the nearest piece of standing
      // ground. Negative is clear; positive means a district is sitting on a
      // rival's compound or on the player's own office island.
      const overlaps = landmarks.map((landmark) => {
        let worst = { into: -Infinity, at: null }
        for (const plot of ground) {
          const dx = Math.max(0, Math.abs(landmark.position[0] - plot.x) - plot.hx)
          const dz = Math.max(0, Math.abs(landmark.position[1] - plot.z) - plot.hz)
          const into = landmark.radius - Math.hypot(dx, dz)
          if (into > worst.into) worst = { into: round(into), at: `${round(plot.x)},${round(plot.z)}` }
        }
        return { key: landmark.key, ...worst }
      })
      // And clear of whatever the region drives a vehicle down. On the Treaty
      // Sea that is the launch's standing circuit, and a contact standing in it
      // gets run over once a lap.
      const lanes = (world.userData.roadWays ?? []).flatMap((way) => way.points)
      const inLane = landmarks.map((landmark) => {
        let nearest = Infinity
        for (const [x, z] of lanes) nearest = Math.min(nearest, Math.hypot(landmark.position[0] - x, landmark.position[1] - z))
        return { key: landmark.key, clear: lanes.length ? round(nearest - landmark.radius) : null }
      })
      return {
        landmarks: landmarks.map((entry) => ({ key: entry.key, name: entry.name, kind: entry.kind, position: entry.position.map(round), radius: entry.radius })),
        duplicates: landmarks.map((entry) => entry.key).filter((entry, index, all) => all.indexOf(entry) !== index),
        overlaps, inLane,
        contacts: (() => {
          const labels = []
          world.traverse((child) => {
            if (child.userData?.mapLabelKind === 'contact') labels.push(child.userData.mapLabelKey)
          })
          return labels
        })(),
        siting: (world.userData.landmarkSiting ?? [])
          .filter((row) => row.label.startsWith('contact-'))
          .map((row) => ({ label: row.label, cleared: row.cleared, x: round(row.x), z: round(row.z) })),
        /*
         * The scene graph's own census, not `renderer.info.render`.
         *
         * That counter reports 1 call and 1 triangle here however much is on
         * screen, because the style pass composites last and resets it: what
         * survives the read is the final fullscreen pass. The question this
         * probe has to answer is "how much did naming six places cost the
         * region the user asked to stay sparse", and a graph census answers it
         * exactly and without a frame.
         */
        cost: (() => {
          let meshes = 0
          let instanced = 0
          let triangles = 0
          world.traverse((child) => {
            if (!child.isMesh) return
            const index = child.geometry?.index
            const position = child.geometry?.attributes?.position
            const faces = ((index ? index.count : position?.count ?? 0) / 3) * (child.isInstancedMesh ? child.count : 1)
            triangles += faces
            if (child.isInstancedMesh) instanced += 1
            else meshes += 1
          })
          return { meshes, instanced, triangles: Math.round(triangles) }
        })(),
      }
    })

    found.districts = await page.evaluate(async (regionKey) => {
      const game = (await (await fetch('/v1/game', { credentials: 'include' })).json()).game
      return game.territory.districts
        .filter((district) => district.region === regionKey)
        .map((district) => ({ key: district.key, name: district.name, landmark_key: district.landmark_key, owned: district.owned, available: district.available }))
    }, key)

    const registered = new Set(found.scene.landmarks.map((entry) => entry.key))
    for (const district of found.districts) {
      if (!district.landmark_key) failures.push(`${key}/${district.key}: no landmark_key`)
      else if (!registered.has(district.landmark_key)) failures.push(`${key}/${district.key}: landmark ${district.landmark_key} is not registered in ${key}`)
    }
    if (found.scene.duplicates.length) failures.push(`${key}: duplicate landmark keys ${found.scene.duplicates.join(', ')}`)
    for (const row of found.scene.overlaps) {
      // Overlap is the defect: a district whose pick disc covers a rival's
      // compound or the player's own office steals the click from it.
      if (row.into > 0) failures.push(`${key}/${row.key}: reaches ${row.into} into standing ground at ${row.at}`)
      // Touching distance is not a defect, but it is one lattice change away
      // from being one, which is the trap `.map-generator-notes.md` records
      // civic set-pieces falling into every time the plan moves under them.
      else if (row.into > -.25) warnings.push(`${key}/${row.key}: only ${-row.into} clear of ground at ${row.at}`)
    }
    for (const row of found.scene.inLane) {
      if (row.clear !== null && row.clear < 0) failures.push(`${key}/${row.key}: ${-row.clear} inside a traffic lane`)
    }

    /* ---- the guide, the brief, and the flight ---- */
    await page.evaluate(() => {
      const toggle = document.querySelector('.uw-district-guide-toggle')
      if (toggle && toggle.getAttribute('aria-expanded') !== 'true') toggle.click()
    })
    await page.waitForTimeout(300)
    found.guide = await page.evaluate(() => ({
      heading: document.querySelector('.uw-district-guide-toggle strong')?.textContent ?? null,
      rows: [...document.querySelectorAll('.uw-district-guide-list button')].map((node) => node.textContent.trim()),
    }))
    if (found.guide.rows.length < found.districts.length) {
      failures.push(`${key}: district guide lists ${found.guide.rows.length} places for ${found.districts.length} retained districts`)
    }

    // Every district in the region, one at a time: hover for the brief, click
    // for the flight. Both off the same row a player uses.
    /*
     * Where a landmark lands on screen, as a fraction of the half-viewport from
     * dead centre. This is the honest test of a camera flight, and the first
     * version of this probe got it wrong: it measured the camera's distance to
     * the place and asserted the flight had shortened it. `travelToLandmark`
     * pins the zoom at .72, so the camera ends at the *same* standoff from
     * whatever it framed — 32.36 units on the Treaty Sea and 36.56 on the
     * Global Compact, for all six districts of each — and a flight that started
     * closer than the standoff correctly moves away. Three of twelve flights
     * failed a test that was measuring the wrong thing.
     */
    found.briefs = []
    for (const district of found.districts) {
      const framing = async () => page.evaluate((landmarkKey) => {
        const THREE = window.__mapThree
        const scene = window.__mapScene
        const landmark = (scene.world.userData.landmarks ?? []).find((entry) => entry.key === landmarkKey)
        if (!landmark) return null
        const point = new THREE.Vector3(landmark.position[0], .2, landmark.position[1]).project(scene.camera)
        return { off: Number(Math.hypot(point.x, point.y).toFixed(3)), behind: point.z > 1 }
      }, district.landmark_key)
      const before = await framing()
      const opened = await page.evaluate((landmarkKey) => {
        const scene = window.__mapScene
        const landmark = (scene.world.userData.landmarks ?? []).find((entry) => entry.key === landmarkKey)
        if (!landmark) return null
        const row = [...document.querySelectorAll('.uw-district-guide-list button')]
          .find((node) => node.textContent.includes(landmark.name))
        if (!row) return null
        row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
        row.click()
        return { position: landmark.position }
      }, district.landmark_key)
      if (!opened) {
        failures.push(`${key}/${district.key}: no guide row for ${district.landmark_key}`)
        continue
      }
      await page.waitForTimeout(250)
      // The camera eases towards its target in the animate loop, which the
      // synthetic clock owns, so a real-time wait would leave it where it was.
      await page.evaluate(() => window.__clock?.tick(180))
      const brief = await page.evaluate(() => {
        const node = document.querySelector('.uw-district-brief')
        if (!node) return null
        return {
          state: [...node.classList].find((name) => name.startsWith('is-')) ?? null,
          head: node.querySelector('.uw-district-brief-head b')?.textContent ?? null,
          retainer: node.querySelector('.uw-district-brief-head span')?.textContent ?? null,
          terms: [...node.querySelectorAll('.uw-district-brief-terms dd')].map((dd) => dd.textContent),
          gate: [...node.querySelectorAll('.uw-district-brief-gate')].map((p) => p.textContent),
          ledger: node.querySelector('.uw-district-brief-ledger')?.textContent?.trim() ?? null,
        }
      })
      const after = await framing()
      const flight = { from: before?.off ?? null, to: after?.off ?? null, behind: after?.behind ?? null }
      found.briefs.push({ district: district.key, landmark: district.landmark_key, flight, brief })
      if (!brief) failures.push(`${key}/${district.key}: no brief rendered`)
      else if (!brief.head) failures.push(`${key}/${district.key}: brief fell back to the scene's own description, so the join did not resolve`)
      // Half a half-viewport from centre. Generous, because the flight settles
      // over several frames and the district guide covers the left third, but
      // far tighter than the 1.0 that means "somewhere on screen" and than the
      // >1 that means the flight went to the wrong place or nowhere.
      if (after?.behind) failures.push(`${key}/${district.key}: flight left the place behind the camera`)
      else if ((after?.off ?? 9) > .5) failures.push(`${key}/${district.key}: flight left the place ${after?.off} off centre`)
      await page.screenshot({ path: `${dir}/${key}-${district.key}.png` })
    }

    /* ---- the contact figures ---- */
    for (const label of found.scene.contacts) {
      const landmarkKey = String(label).replace('landmark:', '')
      if (!registered.has(landmarkKey)) failures.push(`${key}: contact posted at unregistered landmark ${landmarkKey}`)
    }
    for (const row of found.scene.siting) {
      if (!row.cleared) failures.push(`${key}: contact ${row.label} found no ground`)
    }

    /* ---- the pin, from the ledger back to the map ---- */
    const first = found.districts[0]
    found.pin = await page.evaluate(async (districtKey) => {
      const link = document.querySelector('.uw-district-brief-ledger')
      if (!link) return { reached: false, why: 'no ledger link on the brief' }
      link.click()
      await new Promise((resolve) => setTimeout(resolve, 1500))
      const plot = document.querySelector('.retainer-plot.is-asked-for')
      return {
        reached: location.pathname !== '/map',
        url: location.pathname + location.search,
        plot: plot?.querySelector('strong')?.textContent ?? null,
        hasPin: Boolean(plot?.querySelector('.retainer-plot-map')),
        asked: districtKey,
      }
    }, first.key)
    if (!found.pin.hasPin) failures.push(`${key}: the ledger row for ${found.pin.plot} has no map pin`)
    await page.screenshot({ path: `${dir}/${key}-ledger.png` })

    await page.evaluate(() => document.querySelector('.retainer-plot.is-asked-for .retainer-plot-map')?.click())
    await page.waitForFunction(() => location.pathname === '/map', null, { timeout: 30000, polling: 100 })
    await page.waitForFunction(() => Boolean(window.__mapScene), null, { timeout: 120000, polling: 100 })
    await page.waitForTimeout(2000)
    await page.evaluate(() => window.__clock?.tick(240))
    found.returned = await page.evaluate(() => ({
      region: window.__mapScene?.region ?? null,
      row: document.querySelector('.uw-retainer-row.is-asked-for strong')?.textContent
        ?? document.querySelector('.retainer-plot.is-asked-for strong')?.textContent ?? null,
    }))
    if (found.returned.region !== key) failures.push(`${key}: the pin landed on ${found.returned.region}`)
    await page.screenshot({ path: `${dir}/${key}-pinned.png` })

    report.regions[key] = found
    console.log(`\n=== ${key} ===`)
    console.log(` guide: ${found.guide.heading} · ${found.guide.rows.length} rows`)
    console.log(` landmarks: ${found.scene.landmarks.map((entry) => entry.key).join(', ')}`)
    console.log(` nearest ground: ${found.scene.overlaps.map((row) => `${row.key} ${row.into > 0 ? `ON ${row.at}` : `clear by ${-row.into}`}`).join(' | ')}`)
    console.log(` lane clearance: ${found.scene.inLane.map((row) => `${row.key} ${row.clear ?? 'n/a'}`).join(' | ')}`)
    console.log(` contacts: ${found.scene.contacts.join(', ') || 'none'}`)
    for (const row of found.briefs) {
      console.log(`  ${row.district} -> ${row.landmark} ${row.brief?.head ?? 'NO BRIEF'} · framed ${row.flight.from} -> ${row.flight.to} off centre`)
    }
    console.log(` pin: ${found.pin.plot} hasPin=${found.pin.hasPin} back to ${found.returned.region} marked ${found.returned.row}`)
    console.log(` cost: ${found.scene.cost.meshes} meshes + ${found.scene.cost.instanced} batches, ${found.scene.cost.triangles} triangles`)
  }

  report.failures = failures
  report.warnings = warnings
  report.errors = errors.slice(0, 10)
  save(`${dir}/report.json`, report)
  console.log(`\n${failures.length ? `FAILED (${failures.length})` : 'PASSED'}`)
  for (const line of failures) console.log(`  ! ${line}`)
  for (const line of warnings) console.log(`  ~ ${line}`)
  console.log('wrote', dir)
} finally {
  await browser.close().catch(() => {})
}
if (failures.length) process.exitCode = 1
