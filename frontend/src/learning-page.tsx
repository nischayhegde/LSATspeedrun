import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowRight, BookOpen, Brain, BriefcaseBusiness, CheckCircle2, Clock3, RotateCcw, Scale, Target } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { api } from './api'
import { ErrorNotice, LoadingScreen } from './components'
import { DailyLearningBrief, StudyFocusPicker } from './learning-ux'


export function LearningPage() {
  const navigate = useNavigate()
  const gameQuery = useQuery({ queryKey: ['game'], queryFn: api.game })
  const current = useQuery({ queryKey: ['current-session'], queryFn: api.currentSession })
  const review = useQuery({ queryKey: ['review-availability'], queryFn: api.reviewAvailability })
  const startReview = useMutation({ mutationFn: api.startReview, onSuccess: ({ session }) => navigate(`/cases/${session.id}`) })

  if (gameQuery.isLoading || current.isLoading || review.isLoading) return <LoadingScreen label="Opening your learning record…" />
  if (gameQuery.error || current.error || review.error) return <div className="page-wrap"><ErrorNotice error={gameQuery.error || current.error || review.error} /></div>

  const game = gameQuery.data!.game!
  const active = current.data?.session
  const reviewable = review.data?.available_questions ?? 0
  const accuracy = game.total_cases ? Math.round(game.total_correct / game.total_cases * 100) : 0

  return (
    <div className="learning-page page-wrap">
      <section className="learning-hero" data-tour="learning">
        <div>
          <span className="eyebrow gold">LEARNING RECORD · PRACTICE EVIDENCE</span>
          <h1>Build judgment you can use again.</h1>
          <p>New cases build independent reasoning. Closed files let you retrieve earlier work. The record separates what you have seen from what you have actually answered.</p>
          <div className="learning-hero-actions">
            <Link className="primary-button" to={active ? `/cases/${active.id}` : '/cases'}><BriefcaseBusiness />{active ? 'Resume open case' : 'Open the Docket'}<ArrowRight /></Link>
            <button className="secondary-button" disabled={!reviewable || startReview.isPending} onClick={() => review.data?.session ? navigate(`/cases/${review.data.session.id}`) : startReview.mutate()}><RotateCcw />{review.data?.session ? 'Resume review' : 'Review closed files'}</button>
          </div>
          {startReview.error && <ErrorNotice error={startReview.error} />}
        </div>
        <div className="learning-record-card" aria-label="Practice record summary">
          <span>PRACTICE RECORD</span>
          <div><strong>{game.total_cases}</strong><small>rewarded cases answered</small></div>
          <div><strong>{accuracy}%</strong><small>verified-answer accuracy</small></div>
          <div><strong>{game.total_validated_correct}</strong><small>correct with strong reasoning</small></div>
          <p>These are practice totals—not a claim that a skill is mastered.</p>
        </div>
      </section>

      <StudyFocusPicker />

      <section className="learning-evidence-grid">
        <article><div><Scale /><span>01 · ATTEMPT</span></div><h2>Make the judgment.</h2><p>Read the record, predict the answer, choose, rate your confidence, and explain the decisive step.</p><Link to="/cases">Take a new case <ArrowRight /></Link></article>
        <article><div><Brain /><span>02 · REPAIR</span></div><h2>Find the first turn.</h2><p>Compare your reasoning with the verified key and coach’s notes. Keep the valid step; repair the first unsupported one.</p><Link to={active ? `/cases/${active.id}` : '/cases'}>Open current work <ArrowRight /></Link></article>
        <article><div><RotateCcw /><span>03 · RETRIEVE</span></div><h2>Return without rewards.</h2><p>Previously answered questions stay available for rapid retrieval. Review never pays cash or advances the firm.</p><Link to="/cases?view=review">Open Rapid Review <ArrowRight /></Link></article>
      </section>

      <section className="learning-status-strip">
        <div><Target /><span><strong>{reviewable}</strong><small>closed files available</small></span></div>
        <div><CheckCircle2 /><span><strong>{game.total_validated_correct}</strong><small>reasoning-verified answers</small></span></div>
        <div><Clock3 /><span><strong>1–4</strong><small>confidence recorded before feedback</small></span></div>
        <div><BookOpen /><span><strong>0</strong><small>credits from passive reading</small></span></div>
      </section>

      <DailyLearningBrief reviewCount={reviewable} />
    </div>
  )
}
