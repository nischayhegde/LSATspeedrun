import { useEffect, useRef } from 'react'

import { api } from '../api'
import type { ExamState, StudySession } from '../types'
import { createDemoCursor, demoSleep, waitForPainted } from './demo-cursor'

/**
 * Pitch-deck sitting: start a real section, show the server clock running on a
 * live item, then end the section so time stops the way the product enforces
 * LSAT timing. Compressed to ~12–20s of motion, then hold.
 *
 * Reached only when the iframe URL carries `deckDemo=mega`.
 */
export function useMegaExamDemo(session: StudySession, exam: ExamState): void {
  const played = useRef(false)
  const began = useRef(false)

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('deckDemo') !== 'mega') return
    if (exam.stage === 'awaiting_section' && played.current) return

    let cancelled = false
    const cursor = createDemoCursor()
    const abort = new AbortController()

    void (async () => {
      if (exam.stage === 'awaiting_section' && !began.current && !played.current) {
        began.current = true
        const begin = await waitForPainted('.exam-gate .primary-button', 6_000, abort.signal)
        if (cancelled || !begin) return
        await cursor.hoverClick(begin, { hoverMs: 720, moveMs: 480, signal: abort.signal })
        return
      }

      if (exam.stage !== 'in_section' || played.current) return
      played.current = true

      const clock = await waitForPainted('.exam-clock', 8_000, abort.signal)
      const card = await waitForPainted('.answer-card.exam-card, .exam-card', 8_000, abort.signal)
      if (cancelled || !clock || !card) {
        cursor.hide()
        return
      }
      cursor.showAt(window.innerWidth * 0.72, window.innerHeight * 0.12)
      await cursor.hoverClick(clock, { hoverMs: 1_100, moveMs: 520, peek: true, signal: abort.signal })
      if (cancelled) return

      const choice = card.querySelector<HTMLElement>('.choice')
      if (choice) {
        await cursor.hoverClick(choice, { hoverMs: 640, moveMs: 420, signal: abort.signal })
        await demoSleep(700, abort.signal)
      }
      if (cancelled) return

      const next = document.querySelector<HTMLElement>('.exam-foot .exam-step:last-of-type, button.exam-step:last-of-type')
      if (next && !(next as HTMLButtonElement).disabled) {
        await cursor.hoverClick(next, { hoverMs: 480, moveMs: 380, signal: abort.signal })
        await demoSleep(800, abort.signal)
      }
      if (cancelled) return

      const end = await waitForPainted('.exam-submit', 4_000, abort.signal)
      if (end) await cursor.hoverClick(end, { hoverMs: 700, moveMs: 420, signal: abort.signal })
      const confirm = await waitForPainted('.exam-submit-confirm .primary-button', 4_000, abort.signal)
      if (confirm) {
        await cursor.hoverClick(confirm, { hoverMs: 640, moveMs: 320, signal: abort.signal })
      } else if (session.id) {
        const active = exam.active_section_index
        if (active != null) {
          try {
            await api.submitExamSection(session.id, active)
          } catch {
            /* the click path is the real one; this is only a backstop */
          }
        }
      }
      await waitForPainted('.exam-gate', 8_000, abort.signal)
      await demoSleep(2_400, abort.signal)
      cursor.hide()
    })()

    return () => {
      cancelled = true
      abort.abort()
      cursor.destroy()
    }
  }, [exam.stage, exam.active_section_index, session.id])
}
