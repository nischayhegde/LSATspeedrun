import { useEffect, useState } from 'react'

import { SECTION_LABELS, SLIDES } from './slides'
import { spokenNotes } from './slides/spoken-notes'
import './styles/speaker.css'

type SyncState = {
  index: number
  id: string
  updatedAt: number
}

export function SpeakerView() {
  const [sync, setSync] = useState<SyncState>({ index: 0, id: SLIDES[0].id, updatedAt: 0 })
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    document.title = 'Lawyer Tycoon · Speaker Notes'
    let active = true
    const update = async () => {
      try {
        const response = await fetch('/presenter-sync', { cache: 'no-store' })
        if (!response.ok) throw new Error(String(response.status))
        const next = await response.json() as SyncState
        if (!active) return
        setSync(next)
        setConnected(true)
      } catch {
        if (active) setConnected(false)
      }
    }
    void update()
    const timer = window.setInterval(() => void update(), 250)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  const index = Math.min(SLIDES.length - 1, Math.max(0, sync.index))
  const slide = SLIDES[index]
  const next = SLIDES[index + 1]

  return (
    <main className="speaker-view">
      <header className="speaker-header">
        <div>
          <small>{SECTION_LABELS[slide.section]}</small>
          <strong>{index + 1} / {SLIDES.length}</strong>
        </div>
        <span className={connected ? 'is-connected' : 'is-disconnected'}>
          <i /> {connected ? 'Following presentation' : 'Reconnecting…'}
        </span>
      </header>

      <section className="speaker-current">
        <div className="speaker-meta">
          <span>{slide.speaker ?? 'Speaker'}</span>
          <span>{slide.budgetSeconds ?? 45} seconds</span>
          <span>{slide.kind}</span>
        </div>
        <h1>{slide.headline}</h1>
        <p>{spokenNotes(slide.notes)}</p>
      </section>

      {slide.demo?.clickPath?.length ? (
        <section className="speaker-demo">
          <small>LIVE DEMO BEATS</small>
          <ol>
            {slide.demo.clickPath.map((step) => (
              <li key={`${step.start}-${step.end}`}>
                <time>{step.start}–{step.end}s</time>
                <span>{step.action}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="speaker-next">
        <small>NEXT</small>
        {next ? (
          <>
            <strong>{next.headline}</strong>
            <p>{next.speaker ?? 'Speaker'} · {next.budgetSeconds ?? 45}s</p>
          </>
        ) : <strong>End of deck.</strong>}
      </section>

      <footer>
        This view follows the presenting computer automatically. Keep this page open; no synchronized clicking is required.
      </footer>
    </main>
  )
}
