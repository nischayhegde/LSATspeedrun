import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    target: ['es2020', 'safari15'],
    cssTarget: 'safari15',
  },
  server: {
    // Expo Go on a physical phone must be able to reach the exact same Vite
    // application over the local network. The API remains private behind the
    // Vite proxy, while the web UI is reachable from the development LAN.
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/v1': {
        // Port 5000 is reserved by macOS Control Center on many developer
        // machines; keep the local API on 5001 so the proxy is predictable.
        target: 'http://127.0.0.1:5001',
        changeOrigin: true,
      },
    },
  },
  // `vite preview` serves the real production bundle. It needs the same API
  // proxy as the dev server, otherwise a built app cannot be exercised locally.
  preview: {
    host: '0.0.0.0',
    port: 4173,
    proxy: {
      '/v1': { target: 'http://127.0.0.1:5001', changeOrigin: true },
    },
  },
})
