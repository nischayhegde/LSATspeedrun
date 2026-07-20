/// <reference types="vite/client" />

interface Window {
  google?: {
    accounts: {
      id: {
        initialize: (config: { client_id: string; callback: (response: { credential: string }) => void }) => void
        renderButton: (element: HTMLElement, options: Record<string, unknown>) => void
      }
    }
  }
}

