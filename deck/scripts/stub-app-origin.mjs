#!/usr/bin/env node
/**
 * A stand-in for the app dev server, for measuring the demo frame's geometry
 * without the product's backend.
 *
 *     cd deck && node scripts/stub-app-origin.mjs &
 *     cd deck && node scripts/verify-demo-proportion.mjs
 *
 * ## Why this exists, and what it is careful not to be
 *
 * The frame's geometry is the composition of three things: the slot the slide
 * gives it, the logical viewport the app is laid out at, and the scale between
 * them. `--stills` on the proportion harness measures the first of those
 * honestly and the other two not at all — the still is a `<picture>` in the
 * slot, so it can only ever report the slot. And every screen size anybody
 * checks at is 16:9, which is the same shape the stills are captured at, so a
 * stills pass reports 100% whether or not the *iframe* would.
 *
 * So: the smallest thing that will make `demo/health.ts` answer `live` and give
 * the deck a real `<iframe>` to lay out, scale and position. It answers `HEAD /`
 * and serves one page on every path, and the page's only content is a report of
 * `innerWidth x innerHeight` — which is the logical viewport the deck handed it,
 * and the number that decides whether the app's own UI is being magnified or
 * shrunk.
 *
 * It is emphatically not an attempt to run the product. Nothing here knows a
 * route, a session or a question; the four corner marks and the centre cross are
 * there so a screenshot shows at a glance whether the frame is whole and
 * centred, which is the one thing a blank page could not tell you.
 */
import { createServer } from 'node:http'

import { APP_PORT } from '../app-origin.mjs'

const PORT = Number(process.argv[2] || APP_PORT)

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>stub app origin</title>
<style>
  html, body { margin: 0; height: 100%; }
  body {
    background: #fffdf7;
    color: #182027;
    font: 600 14px/1.4 ui-monospace, monospace;
    display: grid;
    place-items: center;
  }
  /* The frame's own edges, so a capture shows whether any of it is outside the
     slot the deck positioned it in. */
  .edge { position: fixed; background: #1b2f6b; }
  .edge.t { inset: 0 0 auto 0; height: 6px; }
  .edge.b { inset: auto 0 0 0; height: 6px; }
  .edge.l { inset: 0 auto 0 0; width: 6px; }
  .edge.r { inset: 0 0 0 auto; width: 6px; }
  .cross { position: fixed; background: #c89b4b; }
  .cross.h { top: 50%; left: 0; right: 0; height: 2px; }
  .cross.v { left: 50%; top: 0; bottom: 0; width: 2px; }
  b { font-size: 28px; }
</style></head>
<body>
  <div class="edge t"></div><div class="edge b"></div>
  <div class="edge l"></div><div class="edge r"></div>
  <div class="cross h"></div><div class="cross v"></div>
  <p style="text-align:center">logical viewport<br><b id="v">?</b></p>
  <script>
    const read = () => {
      document.getElementById('v').textContent = innerWidth + ' x ' + innerHeight
      document.title = 'stub ' + innerWidth + 'x' + innerHeight
    }
    read(); addEventListener('resize', read)
  </script>
</body></html>
`

createServer((request, response) => {
  if (request.method === 'HEAD') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end()
    return
  }
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(PAGE)
}).listen(PORT, '127.0.0.1', () => {
  console.log(`stub app origin on http://localhost:${PORT} — every path serves the same page`)
})
