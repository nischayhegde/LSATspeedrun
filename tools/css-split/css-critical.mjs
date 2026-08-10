/**
 * The stylesheet bytes a route blocks its first paint on, per build.
 *
 * Not the same as every stylesheet a route ends up downloading: sheets that
 * arrive with a lazy panel land after the paint and cost nothing here. The
 * render-blocking set is the entry sheet plus whatever `lsat-route-stylesheets`
 * wrote a `<link>` for, which is exactly the map it embeds in the document.
 *
 *   node tools/css-split/css-critical.mjs .verify/dist-orig frontend/dist
 */
import { readFileSync, readdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const gz = (dir, href) => gzipSync(readFileSync(`${dir}${href}`), { level: 9 }).length

for (const dist of process.argv.slice(2)) {
  const html = readFileSync(`${dist}/index.html`, 'utf8')
  const entry = `/assets/${readdirSync(`${dist}/assets`).find((f) => /^index-.*\.css$/.test(f))}`
  const routes = html.match(/var R=(\[.*?\]\]),K=/s)
  console.log(`\n${dist}   entry ${(gz(dist, entry) / 1024).toFixed(1)} kB gzipped`)
  if (!routes) { console.log('  no route sheets: every screen blocks on the entry alone'); continue }
  for (const [pattern, sheets] of JSON.parse(routes[1])) {
    const own = sheets.reduce((n, href) => n + gz(dist, href), 0)
    console.log(
      `  ${pattern.padEnd(24)} ${((gz(dist, entry) + own) / 1024).toFixed(1)} kB` +
        `  (entry + ${(own / 1024).toFixed(1)} in ${sheets.length} sheet${sheets.length === 1 ? '' : 's'})`,
    )
  }
}
