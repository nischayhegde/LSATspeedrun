/**
 * Which chunks a route drags in, and whether three.js is one of them.
 *
 * The brief for this pass was "work out what is actually on the critical path
 * for first paint versus what is only needed when a 3D surface is opened, and
 * make sure the split matches that". You cannot answer that from the build log,
 * which lists chunk sizes with no edges. A chunk's real cost is its static
 * closure: every chunk the browser must also fetch and run before that one can
 * execute. A 10 kB route chunk that statically imports three.js costs 750 kB.
 *
 *   node .verify/chunkgraph.mjs
 *
 * Prints, per route/scene chunk, the transitive static closure with its total
 * weight, and flags any chunk that reaches `three` without a dynamic import in
 * between. Dynamic edges are listed separately: those are the deferred ones.
 */
import { build } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'frontend')

const ROOTS = [
  'index', 'login-page', 'onboarding-page', 'dashboard-page', 'cases-page',
  'case-session-page', 'firm-page', 'story-page', 'office-page', 'map-page',
  'narrative', 'game-art', 'catalog-asset-render', 'stylized-character',
  'map-three-scene', 'office-three',
]

function report() {
  return {
    name: 'chunkgraph',
    generateBundle(_options, bundle) {
      const byName = new Map()
      for (const o of Object.values(bundle)) if (o.type === 'chunk') byName.set(o.name, o)
      const size = (c) => c.code.length

      const closure = (name) => {
        const seen = new Set()
        const dyn = new Set()
        const queue = [name]
        while (queue.length) {
          const n = queue.shift()
          if (seen.has(n)) continue
          seen.add(n)
          const c = byName.get(n)
          if (!c) continue
          for (const f of c.imports) { const o = bundle[f]; if (o?.type === 'chunk') queue.push(o.name) }
          for (const f of c.dynamicImports) { const o = bundle[f]; if (o?.type === 'chunk') dyn.add(o.name) }
        }
        return { seen, dyn }
      }

      console.log('\n== static closure per chunk (what must run before it can) ==')
      for (const name of ROOTS) {
        if (!byName.has(name)) { console.log(`  (no chunk named ${name})`); continue }
        const { seen, dyn } = closure(name)
        const total = [...seen].reduce((a, n) => a + (byName.has(n) ? size(byName.get(n)) : 0), 0)
        const heavy = [...seen]
          .filter((n) => n !== name && byName.has(n) && size(byName.get(n)) > 8 * 1024)
          .sort((a, b) => size(byName.get(b)) - size(byName.get(a)))
        const flag = seen.has('three') ? '  <<< THREE STATIC' : ''
        console.log(`\n${(total / 1024).toFixed(1).padStart(8)} kB  ${name}  (${seen.size} chunks)${flag}`)
        if (heavy.length) console.log(`           static: ${heavy.join(', ')}`)
        const deferred = [...dyn].filter((n) => !seen.has(n))
        if (deferred.length) console.log(`           deferred via import(): ${deferred.join(', ')}`)
      }
    },
  }
}

await build({
  root,
  configFile: path.join(root, 'vite.config.ts'),
  logLevel: 'warn',
  plugins: [report()],
  build: { write: false },
})
