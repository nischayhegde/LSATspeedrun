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
  // `,K=` is the shape from before a route sheet could be written behind the
  // entry link; `,B=` is the one with a list for each side. Both are read so
  // that a build from either side of that change can be weighed.
  const routes = html.match(/var R=(\[.*?\]\]),[BK]=/s)
  console.log(`\n${dist}   entry ${(gz(dist, entry) / 1000).toFixed(1)} kB gzipped`)
  if (!routes) { console.log('  no route sheets: every screen blocks on the entry alone'); continue }
  for (const row of JSON.parse(routes[1])) {
    // A sheet written behind the entry link blocks the paint exactly as one
    // written in front of it does, so both count towards what a route waits on.
    const sheets = [...row[1], ...(row[2] || [])]
    const own = sheets.reduce((n, href) => n + gz(dist, href), 0)
    console.log(
      `  ${row[0].padEnd(24)} ${((gz(dist, entry) + own) / 1000).toFixed(1)} kB` +
        `  (entry + ${(own / 1000).toFixed(1)} in ${sheets.length} sheet${sheets.length === 1 ? '' : 's'})`,
    )
  }
}
