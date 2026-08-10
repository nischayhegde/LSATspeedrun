/**
 * The static server the perf tools measure against, compressing the way the
 * CloudFront in front of production does.
 *
 * Every perf number this repository has recorded so far was taken against a
 * server that handed back raw bytes, and production is not that server:
 * `deploy/ec2/cloudformation.yaml` sets `Compress: true` on the default cache
 * behaviour, so a real visitor's stylesheets and scripts arrive compressed and
 * their fonts and images do not. Measured on this build, the entry stylesheet
 * is 221 kB raw and 48 kB gzipped — so a harness serving it raw spends 4.6x the
 * real bandwidth on it, and the ranking of what sits on the critical path comes
 * out wrong. woff2 is deflate inside and measures true either way, which means
 * the fonts were also being understated *relative* to everything else.
 *
 * What is modelled, and it is worth being exact because the point is fidelity:
 *
 *  - Brotli when the viewer offers it and gzip otherwise, which is the order
 *    CloudFront picks in. Chrome offers both, so a Playwright run gets brotli.
 *  - Only the content types CloudFront compresses. The list below is its
 *    documented set trimmed to the types this build actually emits.
 *  - Only objects between 1,000 and 10,000,000 bytes, which are CloudFront's
 *    own bounds. This is not a detail: it is why the 0.5 kB scene-hint chunks
 *    stay their raw size here.
 *
 * The compressed body is built once per file and kept, because the tools run
 * hundreds of cold loads against the same directory and brotli on a 272 kB
 * chunk is a third of a second of CPU. Paying that inside a load being timed
 * would put the harness's own work into the measurement — a CDN answers from
 * cache, and so does this.
 *
 * The one thing deliberately not modelled is the exact compression level
 * CloudFront uses, which Amazon does not publish. Brotli quality 5 is the usual
 * approximation for a CDN compressing on the fly; it is a little larger than
 * the quality 11 a build step would produce, so a number taken here is
 * pessimistic rather than flattering.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { extname, join } from 'node:path'

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.webp': 'image/webp',
}

/** What CloudFront will compress, of the things this build emits. */
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg', '.json'])
const MIN_BYTES = 1000
const MAX_BYTES = 10_000_000

/**
 * Serves `root` with production's compression.
 *
 * `compress` is `'auto'` for what a real viewer gets, `'gzip'` to force gzip
 * even where the browser asked for brotli, or `false` for the raw bytes every
 * measurement before this one was taken against.
 *
 * `api` answers `/v1/*` with a 401. Without it the static fallback hands
 * `index.html` back for `/v1/me`, which is a 200 with an HTML body — the app
 * reads that as a signed-in reader whose game state is an empty object and
 * renders a screen no real visitor ever sees.
 */
export function serveLikeProd(root, { compress = 'auto', api = true } = {}) {
  const cache = new Map()
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    if (api && url.startsWith('/v1/')) {
      res.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ detail: 'unauthorized', code: 'unauthorized' }))
      return
    }
    let file = join(root, url)
    if (!existsSync(file) || !extname(file)) file = join(root, 'index.html')
    try {
      const raw = await readFile(file)
      const head = { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }
      const offered = req.headers['accept-encoding'] || ''
      const wants = compress === false ? null
        : compress === 'gzip' ? (/gzip/.test(offered) ? 'gzip' : null)
          : /\bbr\b/.test(offered) ? 'br' : /gzip/.test(offered) ? 'gzip' : null
      const eligible = COMPRESSIBLE.has(extname(file)) && raw.length >= MIN_BYTES && raw.length <= MAX_BYTES
      let body = raw
      if (wants && eligible) {
        const key = `${wants}:${file}`
        let done = cache.get(key)
        if (!done) {
          done = wants === 'br'
            ? brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })
            : gzipSync(raw, { level: 6 })
          cache.set(key, done)
        }
        body = done
        head['content-encoding'] = wants
      }
      res.writeHead(200, head)
      res.end(body)
    } catch { res.writeHead(404); res.end('no') }
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })))
}

/** How a run should describe the wire it measured over. */
export const describeCompression = (compress) => (
  compress === false ? 'uncompressed' : compress === 'gzip' ? 'gzip, as prod would for a viewer without brotli' : 'brotli/gzip, as the CloudFront in front of prod'
)

/**
 * Reads `--no-compress` / `--gzip` off an argv the caller has already parsed.
 * Compression is the default because production compresses; a run that wants
 * the old raw numbers has to ask for them.
 */
export const compressionFromOpts = (opts) => (opts['--no-compress'] ? false : opts['--gzip'] ? 'gzip' : 'auto')
