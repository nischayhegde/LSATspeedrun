import { readdirSync, readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
const DIR = '/Users/alan/LSATspeedrun/.theme-audit'
const A = process.argv[2], B = process.argv[3]
for (const name of readdirSync(`${DIR}/${A}`).filter(f=>f.endsWith('.png')).sort()) {
  let a,b
  try { a = PNG.sync.read(readFileSync(`${DIR}/${A}/${name}`)); b = PNG.sync.read(readFileSync(`${DIR}/${B}/${name}`)) } catch { continue }
  if (a.width!==b.width||a.height!==b.height) { console.log(name.padEnd(30),'size-changed'); continue }
  let n=0
  for (let i=0;i<a.data.length;i+=4) {
    if (Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2])>12) n++
  }
  const pct=(n/(a.width*a.height))*100
  if (pct>=0.01) console.log(name.padEnd(30), pct.toFixed(2)+'%')
}
