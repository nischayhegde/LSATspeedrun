import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
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
})
