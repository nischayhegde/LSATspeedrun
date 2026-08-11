/** Is a GPU timer query available in this browser? */
import { chromium } from '/private/tmp/pwrt/node_modules/playwright/index.mjs'
import { homedir } from 'node:os'

const CHROME = process.env.LIGHT_CHROME
  || `${homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage()
console.log(await page.evaluate(() => {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')
  return {
    webgl2: Boolean(gl),
    timer: Boolean(gl && gl.getExtension('EXT_disjoint_timer_query_webgl2')),
    renderer: gl ? gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) : null,
    extensions: gl ? gl.getSupportedExtensions().filter((name) => /timer|disjoint/i.test(name)) : [],
  }
}))
await browser.close()
