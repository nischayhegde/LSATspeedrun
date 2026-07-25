import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import SpeedrunApp from './speedrun-app'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SpeedrunApp />
  </StrictMode>,
)
