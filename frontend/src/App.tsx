import { useQuery } from '@tanstack/react-query'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { api } from './api'
import { AppShell, LoadingScreen } from './components'
import {
  CaseArchivePage,
  DiagnosticPage,
  DiagnosticResultsPage,
  EvidenceLockerPage,
  LoginPage,
  OnboardingPage,
  ProgressPage,
  SessionPage,
  SessionSummaryPage,
  StudyHomePage,
} from './pages'

function Protected({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })

  if (me.isLoading) return <LoadingScreen />
  if (me.isError) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  const user = me.data!.user
  const path = location.pathname

  // Mandatory intake sequence: first onboarding, then the diagnostic. The rest
  // of the app stays locked until the diagnostic is completed.
  if (!user.onboarding_complete) {
    if (path !== '/onboarding') return <Navigate to="/onboarding" replace />
  } else if (!user.diagnostic_complete) {
    if (path !== '/diagnostic' && path !== '/diagnostic/results') {
      return <Navigate to="/diagnostic" replace />
    }
  } else {
    // Intake finished — keep users out of the setup-only screens.
    if (path === '/onboarding') return <Navigate to="/study" replace />
    if (path === '/diagnostic') return <Navigate to="/diagnostic/results" replace />
  }

  return <AppShell user={user}>{children}</AppShell>
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
      <Route path="/study" element={<Protected><StudyHomePage /></Protected>} />
      <Route path="/study/:sessionId" element={<Protected><SessionPage /></Protected>} />
      <Route path="/session/:sessionId/summary" element={<Protected><SessionSummaryPage /></Protected>} />
      <Route path="/progress" element={<Protected><ProgressPage /></Protected>} />
      <Route path="/archive" element={<Protected><CaseArchivePage /></Protected>} />
      <Route path="/archive/:attemptId" element={<Protected><EvidenceLockerPage /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

