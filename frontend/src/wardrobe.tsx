import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Shirt } from 'lucide-react'

import { api } from './api'
import { CloseMark } from './art-2d/marks'
import { ErrorNotice } from './components'
import { loadStylizedCharacter } from './art/scene-loaders'
import { useSound } from './sound'
import type {
  CharacterCosmetics,
  CosmeticCategory,
  CosmeticCategoryKey,
  GameResponse,
  GameState,
} from './types'
import './wardrobe.css'

const StylizedCharacter = lazy(() => loadStylizedCharacter().then((module) => ({ default: module.StylizedCharacter })))

/** The one place the panel decides what a category is *called* in a sentence,
 *  so the empty state and the summary line stay in step with the tab strip. */
const CATEGORY_ORDER: CosmeticCategoryKey[] = ['suit', 'tie', 'hair', 'eyewear', 'accessory']

function sortCategories(categories: CosmeticCategory[]) {
  return [...categories].sort((left, right) => CATEGORY_ORDER.indexOf(left.key) - CATEGORY_ORDER.indexOf(right.key))
}

/**
 * The wardrobe, as a modal over the office.
 *
 * Choices are held as a draft and only sent when the player commits, because
 * the whole point of the panel is trying things on: a save per tap would put a
 * network round trip between the player and the thing they are looking at, and
 * would litter the office's own game state with looks they were only sampling.
 * The preview beside the list is the real character rig with the draft applied,
 * so what they are judging is exactly what they will get.
 */
export function WardrobePanel({ game, onClose }: { game: GameState; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { play } = useSound()
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const catalog = useQuery({ queryKey: ['cosmetics'], queryFn: api.cosmetics })
  const [draft, setDraft] = useState<Partial<CharacterCosmetics>>(() => ({ ...game.cosmetics }))
  const [activeCategory, setActiveCategory] = useState<CosmeticCategoryKey>('suit')

  const categories = useMemo(
    () => (catalog.data ? sortCategories(catalog.data.cosmetics.categories) : []),
    [catalog.data],
  )
  // The catalog is authoritative about what the player is actually wearing —
  // it re-checks every stored choice against progression that may have moved
  // since it was made — so the draft adopts its answer once it arrives.
  const serverSelection = catalog.data?.cosmetics.selection
  useEffect(() => {
    if (serverSelection) setDraft(serverSelection)
  }, [serverSelection])
  const worn = useMemo<Partial<CharacterCosmetics>>(
    () => serverSelection ?? { ...game.cosmetics },
    [serverSelection, game.cosmetics],
  )

  const save = useMutation({
    mutationFn: (selection: Partial<CharacterCosmetics>) => api.saveCosmetics(selection),
    onSuccess: ({ cosmetics, game: updated }) => {
      queryClient.setQueryData(['cosmetics'], { cosmetics })
      queryClient.setQueryData<GameResponse>(['game'], (current) => ({
        game: updated,
        pending_reviews: current?.pending_reviews ?? [],
      }))
      void play('ledger', { seed: 'wardrobe-save', intensity: .42 })
      onClose()
    },
  })

  useEffect(() => {
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const choose = useCallback((category: CosmeticCategoryKey, key: string) => {
    setDraft((current) => ({ ...current, [category]: key }))
    void play('select', { seed: `wardrobe:${key}`, intensity: .34 })
  }, [play])

  const active = categories.find((category) => category.key === activeCategory) ?? categories[0]
  const changed = useMemo(
    () => CATEGORY_ORDER.filter((category) => draft[category] && draft[category] !== worn[category]),
    [draft, worn],
  )
  const unlockedCount = categories.reduce(
    (total, category) => total + category.items.filter((item) => item.unlocked).length,
    0,
  )
  const totalCount = categories.reduce((total, category) => total + category.items.length, 0)

  // Portalled to the document because the launcher sits inside the office
  // portrait's plaque, and that panel is parallaxed with a transform — which
  // would otherwise make this `position: fixed` scrim resolve against the
  // plaque and squeeze the wardrobe into a column beside the character.
  return createPortal((
    <div className="wardrobe-scrim" role="dialog" aria-modal="true" aria-labelledby="wardrobe-title">
      <div className="wardrobe">
        <header className="wardrobe-head">
          <div>
            <small>CHAMBERS · WARDROBE</small>
            <h2 id="wardrobe-title">Dress your counsel</h2>
            <p>{unlockedCount} of {totalCount} pieces earned. Everything here is won by practising, never bought.</p>
          </div>
          <button type="button" className="wardrobe-close" ref={closeRef} onClick={onClose} aria-label="Close the wardrobe"><CloseMark /></button>
        </header>

        <div className="wardrobe-body">
          <div className="wardrobe-preview">
            <div className="wardrobe-figure">
              <Suspense fallback={<div className="wardrobe-figure-loading"><span>Rendering counsel</span></div>}>
                <StylizedCharacter
                  key={CATEGORY_ORDER.map((category) => draft[category]).join('|')}
                  gender={game.character_gender}
                  tier={game.office_tier}
                  mode="full"
                  cosmetics={draft}
                  label={`Preview of ${game.lawyer_name}`}
                />
              </Suspense>
            </div>
            <p className="wardrobe-preview-note">
              {changed.length
                ? `${changed.length} change${changed.length > 1 ? 's' : ''} not yet worn.`
                : 'This is how the firm sees you today.'}
            </p>
          </div>

          <div className="wardrobe-picker">
            {catalog.isLoading && <p className="wardrobe-status" role="status">Opening the wardrobe…</p>}
            {catalog.error && <ErrorNotice error={catalog.error} retrying={catalog.isFetching} onRetry={() => void catalog.refetch()} />}
            {active && (
              <>
                <div className="wardrobe-tabs" role="tablist" aria-label="Wardrobe categories">
                  {categories.map((category) => (
                    <button
                      key={category.key}
                      type="button"
                      role="tab"
                      id={`wardrobe-tab-${category.key}`}
                      aria-selected={category.key === active.key}
                      aria-controls={`wardrobe-panel-${category.key}`}
                      tabIndex={category.key === active.key ? 0 : -1}
                      className={category.key === active.key ? 'is-active' : ''}
                      onClick={() => setActiveCategory(category.key)}
                    >
                      {category.name}
                    </button>
                  ))}
                </div>
                <p className="wardrobe-blurb">{active.blurb}</p>
                <div
                  className="wardrobe-items"
                  role="tabpanel"
                  id={`wardrobe-panel-${active.key}`}
                  aria-labelledby={`wardrobe-tab-${active.key}`}
                >
                  {active.items.map((item) => {
                    const selected = draft[active.key] === item.key
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={`wardrobe-item ${selected ? 'is-worn' : ''} ${item.unlocked ? '' : 'is-locked'}`}
                        aria-pressed={selected}
                        disabled={!item.unlocked}
                        onClick={() => choose(active.key, item.key)}
                      >
                        <span className="wardrobe-item-copy">
                          <strong>{item.name}</strong>
                          <em>{item.flavor}</em>
                        </span>
                        {item.unlocked
                          ? <b className="wardrobe-item-state">{selected ? 'WORN' : 'WEAR'}</b>
                          : <b className="wardrobe-item-lock"><Lock size={12} aria-hidden="true" />{item.requirement}</b>}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {save.error && <div className="wardrobe-error"><ErrorNotice error={save.error} /></div>}
        <footer className="wardrobe-actions">
          <button type="button" className="wardrobe-cancel" onClick={onClose}>Leave as is</button>
          <button
            type="button"
            className="wardrobe-confirm"
            disabled={!changed.length || save.isPending}
            onClick={() => save.mutate(Object.fromEntries(changed.map((category) => [category, draft[category]])))}
          >
            {save.isPending ? 'Dressing…' : 'Wear this'}
          </button>
        </footer>
      </div>
    </div>
  ), document.body)
}

/** The office-page entry point: a plaque-width button under "YOUR LAWYER". */
export function WardrobeLauncher({ game }: { game: GameState }) {
  const [open, setOpen] = useState(false)
  const { play } = useSound()
  return (
    <>
      <button
        type="button"
        className="wardrobe-launch"
        onClick={() => {
          void play('paper', { seed: 'wardrobe-open', intensity: .3 })
          setOpen(true)
        }}
      >
        <Shirt size={14} aria-hidden="true" />
        <span>Wardrobe</span>
      </button>
      {open && <WardrobePanel game={game} onClose={() => setOpen(false)} />}
    </>
  )
}
