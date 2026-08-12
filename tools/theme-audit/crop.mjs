/**
 * Crops the same band out of a before/after pair and stacks them, so a change
 * of a few pixels can be looked at rather than inferred from a percentage.
 *
 *   node tools/theme-audit/crop.mjs login-desktop 250 330
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const [name, y0, y1, x0 = 0, x1 = 0] = process.argv.slice(2)
const top = Number(y0)
const bottom = Number(y1)
const DIR = new URL('../../.theme-audit', import.meta.url).pathname

const pair = (process.env.PAIR || 'before,after').split(',')
const imgs = pair.map((tag) => PNG.sync.read(readFileSync(`${DIR}/${tag}/${name}.png`)))
const left = Number(x0) || 0
const right = Number(x1) || imgs[0].width
const w = right - left
const h = bottom - top
const gap = 8

const out = new PNG({ width: w, height: h * 2 + gap })
out.data.fill(255)
imgs.forEach((src, i) => {
  const yOff = i * (h + gap)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((top + y) * src.width + (left + x)) * 4
      const d = ((yOff + y) * w + x) * 4
      out.data[d] = src.data[s]
      out.data[d + 1] = src.data[s + 1]
      out.data[d + 2] = src.data[s + 2]
      out.data[d + 3] = 255
    }
  }
})

const path = `${DIR}/crop-${name}-${top}.png`
writeFileSync(path, PNG.sync.write(out))
console.log(path)
