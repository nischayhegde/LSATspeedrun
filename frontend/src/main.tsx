import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import { BlockingOverlayProvider } from './overlays'
import { SoundProvider } from './sound'
import './styles.css'
import './art/art.css'
// Both of these restyle elements that `styles.css` already claims, so they are
// imported here rather than from their components: the entry file is the only
// place the emitted order is guaranteed. They sit after the base sheets and
// before `mobile.css`, which stays last so phone layout keeps the final word.
import './case-instrument.css'
import './practice-lab.css'
import './mobile.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: false, refetchOnWindowFocus: false },
  },
})

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <SoundProvider>
        <BlockingOverlayProvider>
          <App />
        </BlockingOverlayProvider>
      </SoundProvider>
    </BrowserRouter>
  </QueryClientProvider>,
)
