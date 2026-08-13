/**
 * The half of the native shell that lives in the web app.
 *
 * `mobile/` is a WebView around this exact application, which is why every
 * feature reaches the phone without a second implementation. What did not
 * reach it was the other direction: the shell injects `native-app-shell`, a
 * `data-native-app` attribute and `window.__LSAT_TYCOON_NATIVE__` before the
 * page loads, and nothing in the web app has ever read any of them. So the
 * shell's own gestures ran blind against whatever the player was doing.
 *
 * Two of those gestures can destroy work:
 *
 * - **Pull to refresh.** A case will not accept an answer without at least 120
 *   characters of written reasoning, and that draft lives in the page. At the
 *   top of a case — which is where the stimulus is, so it is where a reader
 *   scrolls back to — a downward drag past the top edge reloads the WebView and
 *   takes the draft with it. Inside a mega-litigation it also costs seconds off
 *   a 35-minute section that the server is timing whether the tab is there or
 *   not.
 * - **The iOS back-swipe.** A horizontal drag from the left edge pops the
 *   WebView's history. The whiteboard, the map and the answer sheet are all
 *   surfaces a player drags across, and the left edge of a phone is inside all
 *   three.
 *
 * Neither should be switched off permanently: pull to refresh is the only
 * recovery a WebView offers when a request wedges, and back-swipe is how the
 * platform expects you to leave a screen. So the app tells the shell when it is
 * holding something losable, and the shell suspends exactly those two gestures
 * for exactly that long.
 *
 * Outside the shell — every desktop browser, and mobile Safari or Chrome
 * visiting the site directly — `ReactNativeWebView` is absent and every call
 * here is a property lookup that returns null.
 */
import { useEffect } from 'react'

export const NATIVE_SHELL_STATE = 'lsat-shell-state'

type NativeBridge = { postMessage: (payload: string) => void }

function bridge(): NativeBridge | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { ReactNativeWebView?: NativeBridge }).ReactNativeWebView ?? null
}

/** Whether this page is inside the Expo shell rather than a browser tab. */
export function isNativeShell() {
  return bridge() !== null
}

/**
 * Tell the shell whether the page is currently holding something a stray
 * gesture would destroy.
 *
 * `reason` is carried for the shell's logs and for anything later that wants to
 * treat a case differently from a modal; the shell only acts on `guarded`.
 */
export function useNativeShellGuard(guarded: boolean, reason: string) {
  useEffect(() => {
    const shell = bridge()
    if (!shell) return
    const send = (value: boolean) => {
      shell.postMessage(JSON.stringify({ type: NATIVE_SHELL_STATE, guarded: value, reason }))
    }
    send(guarded)
    // Released on unmount as well as on change: a shell left guarded because
    // the page navigated away mid-case would keep pull-to-refresh switched off
    // for the rest of the session, and the one gesture that recovers a wedged
    // WebView would be the one gesture that is gone.
    return () => send(false)
  }, [guarded, reason])
}
