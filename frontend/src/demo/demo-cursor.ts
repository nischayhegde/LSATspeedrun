/**
 * A visible pointer the live demos drive, so a click reads as a person using
 * the product rather than a script teleporting onto a control.
 *
 * Move, hover, then click — in that order, and never before the target has a
 * painted rect. The hover is the pause the audience needs to see *what* will
 * be clicked; the dwell after the click is the caller's job (cash dropping,
 * a strategy locking, a shelf filling the room).
 */
import './demo-cursor.css'

const DEFAULT_MOVE_MS = 520
const DEFAULT_HOVER_MS = 640
const PRESS_MS = 90
const RELEASE_MS = 160

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function demoSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted || ms <= 0) {
      resolve()
      return
    }
    const finish = () => {
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    const timer = window.setTimeout(finish, ms)
    signal?.addEventListener('abort', finish, { once: true })
  })
}

/**
 * Wait until `selector` has a real painted box — width, height, opacity —
 * so a demo never clicks a control that has not appeared yet.
 */
export async function waitForPainted(
  selector: string,
  timeoutMs = 8_000,
  signal?: AbortSignal,
): Promise<HTMLElement | null> {
  const deadline = performance.now() + timeoutMs
  while (!signal?.aborted && performance.now() < deadline) {
    const node = document.querySelector<HTMLElement>(selector)
    if (node && isPainted(node)) return node
    await demoSleep(80, signal)
  }
  if (signal?.aborted) return null
  const node = document.querySelector<HTMLElement>(selector)
  return node && isPainted(node) ? node : node
}

export function isPainted(node: Element): boolean {
  const rect = node.getBoundingClientRect()
  if (rect.width <= 6 || rect.height <= 6) return false
  const style = getComputedStyle(node)
  return style.opacity !== '0' && style.visibility !== 'hidden' && style.pointerEvents !== 'none'
}

export type HoverClickOptions = {
  hoverMs?: number
  moveMs?: number
  signal?: AbortSignal
  /** Skip the actual click (hover only — used when the script says not to start a form). */
  peek?: boolean
}

export type DemoCursorHandle = {
  showAt(x: number, y: number): void
  moveTo(target: Element | { x: number; y: number }, durationMs?: number, signal?: AbortSignal): Promise<void>
  hoverClick(target: Element, options?: HoverClickOptions): Promise<void>
  press(): void
  release(): void
  hide(): void
  destroy(): void
}

function pointOf(target: Element | { x: number; y: number }): { x: number; y: number } {
  if ('x' in target && 'y' in target && !(target instanceof Element)) return target
  const rect = (target as Element).getBoundingClientRect()
  return { x: rect.left + rect.width * 0.58, y: rect.top + rect.height * 0.52 }
}

export function createDemoCursor(): DemoCursorHandle {
  const node = document.createElement('div')
  node.className = 'deck-demo-cursor'
  node.setAttribute('aria-hidden', 'true')
  node.innerHTML = '<i></i>'
  document.body.appendChild(node)

  let x = Math.round(window.innerWidth * 0.38)
  let y = Math.round(window.innerHeight * 0.46)
  let raf = 0
  let destroyed = false
  let hovered: Element | null = null

  const place = (nx: number, ny: number) => {
    x = nx
    y = ny
    node.style.left = `${Math.round(nx)}px`
    node.style.top = `${Math.round(ny)}px`
  }
  place(x, y)

  const markHover = (el: Element | null) => {
    if (hovered && hovered !== el) hovered.classList.remove('is-demo-hover')
    hovered = el
    if (el) el.classList.add('is-demo-hover')
  }

  const handle: DemoCursorHandle = {
    showAt(nx, ny) {
      if (destroyed) return
      place(nx, ny)
      node.dataset.visible = 'true'
    },
    async moveTo(target, durationMs = DEFAULT_MOVE_MS, signal) {
      if (destroyed || signal?.aborted) return
      const to = pointOf(target)
      node.dataset.visible = 'true'
      const fromX = x
      const fromY = y
      const dist = Math.hypot(to.x - fromX, to.y - fromY)
      const duration = dist < 12 ? 0 : durationMs
      if (duration <= 0) {
        place(to.x, to.y)
        return
      }
      await new Promise<void>((resolve) => {
        const started = performance.now()
        const tick = (now: number) => {
          if (destroyed || signal?.aborted) {
            resolve()
            return
          }
          const t = Math.min(1, (now - started) / duration)
          place(fromX + (to.x - fromX) * easeInOut(t), fromY + (to.y - fromY) * easeInOut(t))
          if (t < 1) raf = requestAnimationFrame(tick)
          else resolve()
        }
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(tick)
      })
    },
    async hoverClick(target, options = {}) {
      if (destroyed || options.signal?.aborted) return
      await handle.moveTo(target, options.moveMs ?? DEFAULT_MOVE_MS, options.signal)
      if (destroyed || options.signal?.aborted) return
      markHover(target)
      await demoSleep(options.hoverMs ?? DEFAULT_HOVER_MS, options.signal)
      if (destroyed || options.signal?.aborted) return
      if (options.peek) {
        markHover(null)
        return
      }
      handle.press()
      await demoSleep(PRESS_MS, options.signal)
      if (destroyed || options.signal?.aborted) {
        handle.release()
        markHover(null)
        return
      }
      if (target instanceof HTMLElement) target.click()
      await demoSleep(RELEASE_MS, options.signal)
      handle.release()
      markHover(null)
    },
    press() {
      if (destroyed) return
      node.dataset.pressed = 'true'
    },
    release() {
      if (destroyed) return
      delete node.dataset.pressed
    },
    hide() {
      if (destroyed) return
      delete node.dataset.visible
      markHover(null)
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      cancelAnimationFrame(raf)
      markHover(null)
      node.remove()
    },
  }
  return handle
}
