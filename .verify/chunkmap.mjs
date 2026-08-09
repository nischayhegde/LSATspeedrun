/**
 * What is actually inside each emitted chunk, by rendered byte count.
 *
 * The build log tells you a chunk is 331 kB. It does not tell you which of your
 * modules — or which dependency you forgot you had — is responsible for that,
 * and every guess about "what is on the critical path for first paint" is
 * unfalsifiable until you can see the breakdown. Rollup already knows: every
 * chunk carries `modules`, keyed by module id, each with the size it rendered to
 * after tree-shaking (`renderedLength`), which is the number that ships.
 *
 *   node .verify/chunkmap.mjs [chunkName ...]
 *
 * With no arguments it prints a per-chunk summary. Named chunks are expanded
 * module by module, largest first, and dependencies are rolled up per package
 * so `node_modules` noise does not bury the app's own modules.
 */
import { build } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'frontend')
const expand = new Set(process.argv.slice(2))

const kb = (n) => (n / 1024).toFixed(2).padStart(9)

function report() {
  return {
    name: 'chunkmap',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((o) => o.type === 'chunk')

      console.log('\n== chunks by rendered size ==')
      console.log('       kB  entry  name')
      for (const c of [...chunks].sort((a, b) => b.code.length - a.code.length)) {
        console.log(`${kb(c.code.length)}  ${c.isEntry ? '  *  ' : '     '}  ${c.name}`)
      }

      for (const name of expand) {
        const chunk = chunks.find((c) => c.name === name)
        if (!chunk) { console.log(`\n!! no chunk named ${name}`); continue }

        // A dependency's cost is the cost of the whole package, not of the
        // twenty files it happens to be spread over.
        const rows = new Map()
        for (const [id, m] of Object.entries(chunk.modules)) {
          const dep = id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
          const key = dep ? `node_modules: ${dep[1]}` : path.relative(root, id)
          rows.set(key, (rows.get(key) ?? 0) + m.renderedLength)
        }
        const total = [...rows.values()].reduce((a, b) => a + b, 0)
        console.log(`\n== ${name}: ${(chunk.code.length / 1024).toFixed(2)} kB emitted, ${(total / 1024).toFixed(2)} kB from ${rows.size} modules/packages ==`)
        for (const [key, size] of [...rows].sort((a, b) => b[1] - a[1])) {
          if (size < 512) continue
          console.log(`${kb(size)}  ${key}`)
        }
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
