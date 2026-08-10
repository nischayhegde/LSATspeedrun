import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Eye, FileSearch, Gavel, HeartHandshake, Lock, Scale, ScrollText, ShieldAlert, Trophy } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { api } from '../api'
import { ErrorNotice, LoadingScreen } from '../components'
import { openEpilogue, openPendingChapter } from '../narrative'
import { RivalWarRoom } from '../rival-war-room'
import { useSound } from '../sound'
import type { StoryQuest } from '../types'
import { storeGame, useGame } from './shared'
// The rules in `styles.css` that only this screen can render.
import '../story-page.css'
import '../mobile/story-page.css'


const questPresentation: Record<StoryQuest['category'], { label: string; icon: typeof FileSearch; copy: string }> = {
  pro_bono: { label: 'Public Interest', icon: HeartHandshake, copy: 'Lower fees. Greater standing. A promise kept.' },
  investigation: { label: 'Investigations', icon: FileSearch, copy: 'Build Intel and uncover Sterling’s hidden network.' },
  shadow: { label: 'Shadow Files', icon: Eye, copy: 'Lucrative, secret, and dangerous to the firm’s name.' },
  legacy: { label: 'Legacy Matter', icon: ScrollText, copy: 'Write the rule that survives the empire.' },
}


export function StoryPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { play } = useSound()
  const gameQuery = useGame()
  const [selectedRival, setSelectedRival] = useState<string | null>(null)
  const startQuestMutation = useMutation({
    mutationFn: api.startQuest,
    onSuccess: ({ game }, questKey) => {
      storeGame(queryClient, game)
      void play('file-open', { id: `quest:${game.id}:${questKey}`, seed: questKey, intensity: .68 })
    },
  })
  const operation = useMutation({
    mutationFn: ({ rivalKey, operationKey }: { rivalKey: string; operationKey: string }) => api.rivalOperation(rivalKey, operationKey),
    onSuccess: ({ game }, { rivalKey, operationKey }) => {
      storeGame(queryClient, game)
      void play('story', {
        id: `operation:${game.id}:${rivalKey}:${operationKey}`,
        seed: `${rivalKey}:${operationKey}`,
        intensity: .76,
        profile: { officeTier: game.office_tier, alignment: game.story.alignment },
      })
    },
  })
  if (gameQuery.isLoading) return <LoadingScreen label="Loading…" />
  if (gameQuery.error) return <div className="contained"><ErrorNotice error={gameQuery.error} /></div>
  const game = gameQuery.data!.game!
  const story = game.story
  const rival = story.rival_targets.find((item) => item.key === selectedRival) ?? story.rival_targets[0]
  const grouped = (['pro_bono', 'investigation', 'shadow', 'legacy'] as const)
    .map((category) => ({ category, quests: story.quests.filter((quest) => quest.category === category) }))
    .filter((group) => group.quests.length)

  return (
    <div className={`story-page story-alignment-${story.alignment.toLowerCase()} page-wrap`}>
      <section className="story-hero">
        <div className="story-hero-copy">
          <span className="pixel-kicker">THE MERCER FILES · CAMPAIGN CASEBOARD</span>
          <h1>What will the name<br />on the door <em>mean?</em></h1>
          <p>Ada’s key, Harrow’s evidence, Moth’s secrets, and Sterling’s empire are one case. Every choice changes the resources—and the ending—you can reach.</p>
          <div className="story-alignment-stamp"><Scale /><span>CURRENT PATH</span><strong>{story.alignment}</strong></div>
          {story.epilogue && (
            <button type="button" className="story-epilogue-link" onClick={openEpilogue}>
              <Trophy size={16} /> Read the final record
            </button>
          )}
        </div>
        <div className="story-board-art" aria-hidden="true">
          <div className="board-photo photo-ada">ADA</div><div className="board-photo photo-sterling">STERLING</div><div className="board-photo photo-moth">MOTH?</div>
          <i className="thread t1" /><i className="thread t2" /><i className="thread t3" />
          <div className="board-note">FORGED DEED<br />→ CITY HALL<br />→ ACQUISITIONS</div>
          <span className="board-key">⚿</span>
        </div>
      </section>

      <section className="story-resources" aria-label="Campaign resources">
        <article className="ethics"><Scale /><span>ETHICS<small>Which doors remain open</small></span><strong>{story.ethics.toFixed(1)}</strong><div><i style={{ width: `${story.ethics}%` }} /></div></article>
        <article className="heat"><ShieldAlert /><span>HEAT<small>Scrutiny and scandal risk</small></span><strong>{story.heat.toFixed(1)}</strong><div><i style={{ width: `${story.heat}%` }} /></div></article>
        <article><FileSearch /><span>INTEL<small>Evidence for investigations</small></span><strong>{story.intel}</strong></article>
        <article><Gavel /><span>INFLUENCE<small>Clean competitive leverage</small></span><strong>{story.influence}</strong></article>
      </section>

      <section className="campaign-timeline">
          <div className="story-section-heading"><span>01 · THE CAMPAIGN</span><h2>From one light to a constellation</h2><p>Chapters unlock with headquarters tiers. Story decisions are permanent.</p></div>
        <div className="chapter-track">
          {story.chapters.map((chapter, index) => (
            <article key={chapter.key} className={`${chapter.seen ? 'seen' : ''} ${story.pending_chapter?.key === chapter.key ? 'pending' : ''}`}>
              <i>{chapter.seen ? <Check /> : story.pending_chapter?.key === chapter.key ? '!' : <Lock />}</i>
              <span>{chapter.act} · HQ {chapter.tier}</span><h3>{chapter.title}</h3>
              <small>{chapter.choice ? `Decision: ${chapter.choice.replaceAll('_', ' ')}` : chapter.tier <= game.office_tier ? 'Decision waiting' : `Unlocks at headquarters tier ${chapter.tier}`}</small>
              {story.pending_chapter?.key === chapter.key && (
                <button type="button" className="chapter-play-button" onClick={openPendingChapter}>Play this chapter</button>
              )}
              {index < story.chapters.length - 1 && <b />}
            </article>
          ))}
        </div>
      </section>

      {story.active_quest && (
        <section className={`active-caseboard active-${story.active_quest.category}`}>
          <div className="dossier-tab">ACTIVE FILE</div>
          <span>{story.active_quest.patron}</span><h2>{story.active_quest.title}</h2><p>{story.active_quest.description}</p>
          <div className="quest-progress"><div><i style={{ width: `${story.active_quest.progress / story.active_quest.target * 100}%` }} /></div><strong>{story.active_quest.progress} / {story.active_quest.target}</strong></div>
          <small>{story.active_quest.objective} · Reward: {story.active_quest.reward_label}</small>
        </section>
      )}

      <section className="quest-caseboard">
          <div className="story-section-heading"><span>02 · THE CASEBOARD</span><h2>Choose the work behind the work</h2><p>Files open in order along their track. One at a time. Hidden files surface as your Ethics and Intel change.</p></div>
        {grouped.map(({ category, quests }) => {
          const presentation = questPresentation[category]
          const Icon = presentation.icon
          return <div className={`quest-shelf quest-shelf-${category}`} key={category}>
            <header><Icon /><div><span>{presentation.label}</span><small>{presentation.copy}</small></div></header>
            <div className="quest-grid">{quests.map((quest) => (
              <article key={quest.key} className={`${quest.active ? 'active' : ''} ${quest.completed ? 'completed' : ''} ${quest.locked_by.length ? 'sequence-locked' : ''}`}>
                <div className="dossier-top"><span>HQ {quest.tier} · {quest.patron}</span><i>{quest.completed ? 'CLOSED' : quest.active ? 'ACTIVE' : quest.locked_by.length ? 'SEALED' : 'OPEN'}</i></div>
                <h3>{quest.title}</h3><p>{quest.description}</p><strong>{quest.objective}</strong>
                {quest.start_label && <small className="quest-cost">Opening cost: {quest.start_label}</small>}
                <small className="quest-reward">Reward: {quest.reward_label}</small>
                {quest.locked_by.length > 0 && <small className="quest-sequence"><Lock size={12} /> Opens after {quest.locked_by.join(' · ')}</small>}
                <button disabled={!quest.available || startQuestMutation.isPending} onClick={() => startQuestMutation.mutate(quest.key)}>{quest.completed ? 'File closed' : quest.active ? `${quest.progress} / ${quest.target}` : quest.locked_by.length ? 'Sealed until earlier work closes' : story.active_quest ? 'Caseboard occupied' : !quest.available ? 'Locked' : 'Open this file'}</button>
              </article>
            ))}</div>
          </div>
        })}
      </section>

      {/* Section number only — RivalWarRoom carries its own kicker, title and copy. */}
      <div className="story-section-heading light"><span>03 · RIVAL OPERATIONS</span></div>
      <RivalWarRoom game={game} selectedKey={selectedRival} onSelect={setSelectedRival} onShowOnMap={(asset) => navigate(`/map?rival=${asset.key}`)} />
      {startQuestMutation.error && <ErrorNotice error={startQuestMutation.error} />}
    </div>
  )
}
