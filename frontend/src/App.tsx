import { useQuery } from '@tanstack/react-query'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { api } from './api'
import { AppShell, LoadingScreen } from './components'
import { LoginPage, PracticeHomePage, PracticeSessionPage } from './pages'

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
      <Route path="/practice" element={<Protected><PracticeHomePage /></Protected>} />
      <Route path="/practice/:sessionId" element={<Protected><PracticeSessionPage /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
