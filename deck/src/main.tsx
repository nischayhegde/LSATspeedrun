import { createRoot } from 'react-dom/client'

import { Deck } from './deck'
import './styles/theme.css'
import './styles/deck.css'

/**
 * No `StrictMode`.
 *
 * StrictMode deliberately mounts every effect twice in development to surface
 * effects that are not idempotent. That is a good default and the wrong one here:
 * the deck's single `WebGLRenderer` is created in an effect, so a double mount
 * creates two contexts and leaves one orphaned, and the ported office and map
 * scenes each do the same. The deck would run out of WebGL contexts inside a few
 * slides, in development only, which is the worst place for a difference between
 * the environment it is built in and the one it is presented from.
 *
 * The effects here are audited by hand instead: each one that allocates has a
 * matching teardown, and `DeckStage.dispose` is called on unmount.
 */
createRoot(document.getElementById('root')!).render(<Deck />)
