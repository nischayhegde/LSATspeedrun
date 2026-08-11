/* The capture beat.
 *
 * Acquiring a rival never happens inside the 3D map — the "Acquire" button
 * lives on the firm tab or the story tab, wherever `RivalWarRoom` is mounted,
 * and there is no live camera on screen at that moment to cut to. So this is a
 * flat overlay rather than an in-scene moment, built entirely from the asset's
 * own catalog art and a light CSS-driven sketch, with zero new dependencies.
 *
 * Deliberately outside the `useBlockingOverlay` registry in overlays.tsx. That
 * system exists for state that has to survive a remount — a pending story
 * chapter, the once-ever epilogue — and this is the opposite: a one-shot
 * celebration with no server state behind it. Registering it there would mean
 * teaching the priority list about a layer that outranks nothing and defers to
 * nothing, for no benefit, while adding a second thing that can leave the
 * screen blocked if it is ever built wrong. Local state that unmounts with its
 * parent is simpler and cannot soft-lock the app: navigating away during the
 * animation tears the whole component down, timer and all.
 */

import { lazy, Suspense, useEffect, useMemo } from 'react'

import { CloseMark } from './art-2d/marks'
import { keyHash, rivalSiteArt } from './art/assets'
import type { GameAsset } from './types'
import './rival-capture-cutscene.css'

const CatalogAssetRender = lazy(() =>
  import('./art/catalog-asset-render').then((module) => ({ default: module.CatalogAssetRender })),
)

/** However many times this plays, the joke should not have to work twice in a
 *  row for the same firm, so it is picked deterministically from the firm's
 *  own key rather than at random. */
const QUIPS = [
  'Their managing partner is already updating a résumé.',
  "Somewhere, a shredder is working unpaid overtime.",
  "The nameplate didn't even make it to the dumpster.",
  'Their malpractice insurer just breathed a long sigh of relief.',
  'The junior associate inherits everything. Congratulations, junior associate.',
  'That "Boutique Firm of the Year" plaque is yours now. Please dust it.',
  "Their senior partner just learned what \"at-will\" means.",
  'The break room fridge is now, legally, your break room fridge.',
] as const

function quipFor(key: string) {
  return QUIPS[keyHash(key) % QUIPS.length]
}

/** "Acquire Harrow & Finch" is the purchase; "Harrow & Finch" is the firm.
 *  Mirrors `rivalFirmName` in rival-war-room.tsx exactly — duplicated rather
 *  than imported so this file has no dependency on the component that mounts
 *  it, which is what that component depends on in the first place. */
function firmName(asset: GameAsset) {
  return asset.name.replace(/^Acquire\s+/i, '')
}

const AUTO_DISMISS_MS = 4600

export function RivalCaptureCutscene({ asset, onClose }: { asset: GameAsset; onClose: () => void }) {
  const quip = useMemo(() => quipFor(asset.key), [asset.key])
  const fallbackSrc = useMemo(() => rivalSiteArt(asset.art ?? 'mega-tower'), [asset.art])

  // The only escape hatch this layer needs is its own: it never asks the
  // overlay registry for the screen, so nothing above it can be blocked by a
  // handler that forgot to fire.
  useEffect(() => {
    const timer = window.setTimeout(onClose, AUTO_DISMISS_MS)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    /**
     * The dialog is the frame, not the backdrop. The backdrop is the dimmed
     * sheet behind it, and giving it the role told a screen reader that the
     * whole viewport was the dialog and that its accessible name was a heading
     * sitting several levels down inside it.
     *
     * Clicking the sheet still dismisses. That is a convenience duplicating
     * three accessible controls — the close button, "Back to business", and
     * Escape, bound above — so it is exempt from the keyboard rules rather
     * than given a keydown handler no keyboard user could ever reach: the
     * backdrop is not focusable and must not become a tab stop in front of the
     * dialog's own buttons. Comparing target with currentTarget is what lets
     * the frame drop the `stopPropagation` handler it used to need, which was
     * itself only there to cancel this one.
     */
    /* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
    <div className="rcc-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="rcc-frame" role="dialog" aria-modal="true" aria-labelledby="rcc-title">
        <button type="button" className="rcc-close" onClick={onClose} aria-label="Dismiss">
          <CloseMark />
        </button>
        <div className="rcc-stage">
          <div className="rcc-stage-art">
            <Suspense fallback={<div className="rcc-art-fallback" style={{ backgroundImage: `url(${fallbackSrc})` }} />}>
              <CatalogAssetRender asset={asset} fallbackSrc={fallbackSrc} />
            </Suspense>
          </div>
          <div className="rcc-sold" aria-hidden="true"><span>SOLD</span></div>
          <div className="rcc-lawyer" aria-hidden="true">
            <svg viewBox="0 0 64 88" width="52" height="72">
              <g className="rcc-lawyer-fall">
                <rect x="20" y="30" width="24" height="34" rx="6" className="rcc-lawyer-suit" />
                <circle cx="32" cy="18" r="13" className="rcc-lawyer-head" />
                <rect x="27" y="27" width="10" height="9" className="rcc-lawyer-tie" />
                <rect x="9" y="34" width="9" height="26" rx="4" className="rcc-lawyer-arm rcc-lawyer-arm-left" />
                <rect x="46" y="34" width="9" height="26" rx="4" className="rcc-lawyer-arm rcc-lawyer-arm-right" />
                <rect x="21" y="62" width="9" height="22" rx="4" className="rcc-lawyer-leg" />
                <rect x="34" y="62" width="9" height="22" rx="4" className="rcc-lawyer-leg" />
              </g>
            </svg>
            <span className="rcc-lawyer-burst">!</span>
          </div>
          <div className="rcc-papers" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <i key={index} className={`rcc-paper rcc-paper-${index}`} />)}
          </div>
        </div>
        <div className="rcc-copy">
          <span className="rcc-kicker">ACQUIRED</span>
          <h3 id="rcc-title">{firmName(asset)}</h3>
          <p>{quip}</p>
          <button type="button" className="rcc-continue" onClick={onClose}>Back to business</button>
        </div>
      </div>
    </div>
  )
}
