import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'

import { api } from '../api'
import { ErrorNotice, LoadingScreen } from '../components'
import { MiniAvatar, OfficeScene } from '../game-art'
import { useSound } from '../sound'
import type { CharacterGender, GameResponse } from '../types'
import { useGame } from './shared'
// The rules in `styles.css` that only this screen can render.
import '../onboarding-page.css'
import '../mobile/onboarding-page.css'


export function OnboardingPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { play } = useSound()
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  const gameQuery = useGame()
  const [step, setStep] = useState<'intent' | 'identity'>('intent')
  const [targetScore, setTargetScore] = useState('')
  const [targetTestDate, setTargetTestDate] = useState('')
  const [gender, setGender] = useState<CharacterGender>('female')
  const [lawyerName, setLawyerName] = useState('')
  const [firmName, setFirmName] = useState('')

  useEffect(() => {
    if (!lawyerName && me.data?.user.display_name) setLawyerName(me.data.user.display_name)
  }, [lawyerName, me.data?.user.display_name])

  const saveIntent = useMutation({
    mutationFn: (body: { target_score: number | null; target_test_date: string | null }) => api.updateMe(body),
    onSuccess: (data) => {
      queryClient.setQueryData<{ user: typeof data.user }>(['me'], data)
      setStep('identity')
    },
  })

  const create = useMutation({
    mutationFn: () => api.createGame({ lawyer_name: lawyerName, firm_name: firmName, character_gender: gender }),
    onSuccess: (data) => {
      queryClient.setQueryData<GameResponse>(['game'], data)
      void queryClient.invalidateQueries({ queryKey: ['me'] })
      void play('event', { id: `firm-opened:${data.game?.id ?? firmName}`, seed: firmName, intensity: .85 })
      navigate('/progress', { replace: true })
    },
  })

  if (me.isLoading || gameQuery.isLoading) return <LoadingScreen />
  if (gameQuery.data?.game) return <Navigate to="/progress" replace />

  if (step === 'intent') {
    const parsedScore = targetScore.trim() ? Number(targetScore) : null
    const scoreInvalid = parsedScore !== null && (Number.isNaN(parsedScore) || parsedScore < 120 || parsedScore > 180)
    return (
      <div className="onboarding-page">
        <section className="onboarding-scene-wrap">
          <OfficeScene gender={gender} previewTier={0} />
          {/* The caption sets the scene and the panel beside it does the asking
              — the same division as step 02. It used to ask a competing
              question of its own, so the student met two headlines at once. */}
          <div className="opening-caption">
            <span>BEFORE WE BEGIN</span>
            <h2>An empty desk.<br />A blank set of files.</h2>
            <p>How much firm you see around them is up to you.</p>
          </div>
        </section>
        <section className="onboarding-panel">
          <span className="step-indicator">YOUR GOAL · 01</span>
          <h1>Tell us your target,<br />or skip straight in.</h1>
          <p>Used to work back a weekly caseload. Both are optional and you can change them later.</p>
          <div className="name-fields">
            <label>
              Target score (120–180)
              <input
                type="number"
                inputMode="numeric"
                min={120}
                max={180}
                value={targetScore}
                onChange={(event) => setTargetScore(event.target.value)}
                placeholder="e.g. 170"
              />
            </label>
            <label>
              Test date (optional)
              <input
                type="date"
                value={targetTestDate}
                onChange={(event) => setTargetTestDate(event.target.value)}
              />
            </label>
          </div>
          {scoreInvalid && <p className="field-error">Enter a target score between 120 and 180, or leave it blank.</p>}
          {saveIntent.error && <ErrorNotice error={saveIntent.error} />}
          <button
            className="primary-button onboarding-cta"
            disabled={scoreInvalid || saveIntent.isPending}
            onClick={() =>
              saveIntent.mutate({
                target_score: parsedScore,
                target_test_date: targetTestDate.trim() || null,
              })
            }
          >
            {saveIntent.isPending ? 'Saving…' : <>Continue <ArrowRight /></>}
          </button>
          <small>
            <button type="button" className="link-button" onClick={() => setStep('identity')}>
              Skip — I'll decide later
            </button>
          </small>
        </section>
      </div>
    )
  }

  return (
    <div className="onboarding-page">
      <section className="onboarding-scene-wrap">
        <OfficeScene gender={gender} previewTier={0} />
        <div className="opening-caption">
          <span>DAY ONE</span>
          <h2>One flickering lamp.<br />One client at the door.</h2>
          <p>The rest is yours to build.</p>
        </div>
      </section>
      <section className="onboarding-panel">
        <span className="step-indicator">YOUR ORIGIN · 02</span>
        <h1>Name the lawyer<br />who changes this room.</h1>
        <p>Identical progression, outfits and abilities either way. Change it later.</p>
        <div className="character-choice" role="radiogroup" aria-label="Character presentation">
          {(['female', 'male'] as CharacterGender[]).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={gender === value}
              className={gender === value ? 'selected' : ''}
              onClick={() => {
                if (gender !== value) void play('select', { seed: value, intensity: .35 })
                setGender(value)
              }}
            >
              <MiniAvatar gender={value} />
              <span>{value === 'female' ? 'Female character' : 'Male character'}</span>
              {gender === value && <Check size={18} />}
            </button>
          ))}
        </div>
        <div className="name-fields">
          <label>Lawyer name<input value={lawyerName} onChange={(event) => setLawyerName(event.target.value)} maxLength={50} placeholder="Alex Morgan" /></label>
          <label>Firm name<input value={firmName} onChange={(event) => setFirmName(event.target.value)} maxLength={80} placeholder="Morgan Legal" /></label>
        </div>
        {create.error && <ErrorNotice error={create.error} />}
        <button className="primary-button onboarding-cta" disabled={lawyerName.trim().length < 2 || firmName.trim().length < 2 || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? 'Hanging the sign…' : <>Open the doors <ArrowRight /></>}
        </button>
        <small>You begin with a $250 client retainer and Reputation 50.</small>
      </section>
    </div>
  )
}
