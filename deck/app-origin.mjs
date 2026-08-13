/**
 * The one origin the deck frames, probes, and signs into.
 *
 * Demo slides, health pings, Playwright harnesses, and `demo.config.ts` all
 * read this. Do not hardcode a port beside it — a stale 5173 is how the pitch
 * falls back to stills while the product is running on another port.
 *
 * On a public HTTPS host the deck is served from `/pitch/` on the same
 * hostname as the app. Framing `localhost` from that host would pin every
 * demo to a still, so the browser origin wins there. Node scripts and the
 * local Vite deck keep the loopback default.
 *
 * Scripts that already take `--app=` keep that flag as an override. This file
 * is the default they fall back to.
 */
export const APP_PORT = 5174
const LOCAL_ORIGIN = `http://localhost:${APP_PORT}`

function shippedOrigin() {
  try {
    const value = import.meta.env && import.meta.env.VITE_APP_ORIGIN
    return typeof value === 'string' && value ? value.replace(/\/$/, '') : ''
  } catch {
    return ''
  }
}

function resolveAppOrigin() {
  const shipped = shippedOrigin()
  if (shipped) return shipped
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return window.location.origin
    }
  }
  return LOCAL_ORIGIN
}

export const APP_ORIGIN = resolveAppOrigin()
