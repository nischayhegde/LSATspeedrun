import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'

import { api } from './api'
import { ErrorNotice } from './components'
import { EventVisitor3D } from './game-art'
import { eventArt, keyHash } from './art/assets'
import { useSound } from './sound'
import { MOTION_TIMING } from './motion'
import type { GameResponse, GameState, StoryQuest } from './types'

/* Kept apart from the case run: the Office is the only route that shows this,
   and pairing it with the case view would have made opening the Office pay
   for the whole question flow. */

const EVENT_GLOBAL_COOLDOWN_MS = 5 * 60_000
const EVENT_DECLINE_COOLDOWN_MS = 30 * 60_000

const EVENT_CATEGORY_LABEL: Record<StoryQuest['category'], string> = {
  pro_bono: 'A CAUSE WORTH TAKING',
  investigation: 'AN INVESTIGATION OPENS',
  shadow: 'A SHADOW OFFER',
  legacy: 'A LEGACY MATTER',
}

export function OfficeEventPopup({ game }: { game: GameState }) {
  const queryClient = useQueryClient()
  const { play } = useSound()
  const [dismissed, setDismissed] = useState(false)
  const [visible, setVisible] = useState(false)

  const quest = useMemo(() => {
    if (game.story.active_quest || game.story.pending_chapter) return null
    const now = Date.now()
    if (now - Number(localStorage.getItem('lt-event-last') || 0) < EVENT_GLOBAL_COOLDOWN_MS) return null
    const options = game.story.quests.filter((entry) =>
      entry.available && !entry.active && !entry.completed
      && now - Number(localStorage.getItem(`lt-event-declined-${entry.key}`) || 0) > EVENT_DECLINE_COOLDOWN_MS)
    if (!options.length) return null
    return options[keyHash(game.id) % options.length]
  }, [game])

  useEffect(() => {
    if (!quest) return
    const timeout = window.setTimeout(() => setVisible(true), MOTION_TIMING.popupDelayMs)
    return () => window.clearTimeout(timeout)
  }, [quest])

  const accept = useMutation({
    mutationFn: () => api.startQuest(quest!.key),
    onSuccess: ({ game: nextGame }) => {
      void play('event', {
        id: `office-event-accepted:${nextGame.id}:${quest!.key}`,
        seed: quest!.key,
        intensity: .6,
      })
      localStorage.setItem('lt-event-last', String(Date.now()))
      queryClient.setQueryData<GameResponse>(['game'], { game: nextGame, pending_reviews: [] })
      setDismissed(true)
    },
  })

  if (!quest || dismissed || !visible) return null

  const decline = () => {
    void play('paper', { seed: `decline:${quest.key}`, intensity: .35 })
    localStorage.setItem(`lt-event-declined-${quest.key}`, String(Date.now()))
    localStorage.setItem('lt-event-last', String(Date.now()))
    setDismissed(true)
  }

  return (
    <div className="office-event-overlay" role="dialog" aria-modal="true" aria-labelledby="office-event-title">
      <article className={`office-event event-${quest.category}`}>
        <div className="event-art">
          <img src={eventArt(quest.scene)} alt="" draggable={false} />
          <div className="event-visitor-3d"><EventVisitor3D seed={quest.key} label={quest.patron} /></div>
          <span className="event-category">{EVENT_CATEGORY_LABEL[quest.category]}</span>
        </div>
        <div className="event-body">
          <span className="event-eyebrow">A VISITOR AT THE OFFICE</span>
          <h2 id="office-event-title">{quest.title}</h2>
          <small className="event-patron">{quest.patron} · {quest.objective}</small>
          <p>{quest.description}</p>
          <div className="event-stakes">
            {quest.start_label && <span className="stake-cost">{quest.start_label}</span>}
            <span className="stake-reward">{quest.reward_label}</span>
          </div>
          {accept.error && <ErrorNotice error={accept.error} />}
          <div className="event-actions">
            <button className="primary-button" onClick={() => accept.mutate()} disabled={accept.isPending}>
              {accept.isPending ? 'Opening the file…' : <>Take the matter <ArrowRight size={17} /></>}
            </button>
            <button className="secondary-button" onClick={decline}>Turn them away</button>
          </div>
        </div>
      </article>
    </div>
  )
}
