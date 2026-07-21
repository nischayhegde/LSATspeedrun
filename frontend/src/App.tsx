import { useQuery } from '@tanstack/react-query'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { api } from './api'
import { AppShell, LoadingScreen } from './components'
import {
  DiagnosticPage,
  DiagnosticResultsPage,
  LoginPage,
  OnboardingPage,
  ProgressPage,
  SessionPage,
  SessionSummaryPage,
  StoryIntroductionPage,
  StudyHomePage,
} from './pages'

function Protected({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })

  if (me.isLoading) return <LoadingScreen />
  if (me.isError) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <AppShell user={me.data!.user}>{children}</AppShell>
}

function HomeRedirect() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  if (me.isLoading) return <LoadingScreen />
  if (me.isError) return <Navigate to="/login" replace />
  return <Navigate to={me.data!.user.next_route} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/onboarding" element={<Protected><OnboardingPage /></Protected>} />
      <Route path="/diagnostic" element={<Protected><DiagnosticPage /></Protected>} />
      <Route path="/diagnostic/results" element={<Protected><DiagnosticResultsPage /></Protected>} />
      <Route path="/story/introduction" element={<Protected><StoryIntroductionPage /></Protected>} />
      <Route path="/study" element={<Protected><StudyHomePage /></Protected>} />
      <Route path="/study/:sessionId" element={<Protected><SessionPage /></Protected>} />
      <Route path="/session/:sessionId/summary" element={<Protected><SessionSummaryPage /></Protected>} />
      <Route path="/progress" element={<Protected><ProgressPage /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
