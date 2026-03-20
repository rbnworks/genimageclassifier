import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// When running inside Docker, set BACKEND_URL=http://backend:8000 via the
// compose environment. Locally it falls back to localhost.
const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': { target: backendUrl, changeOrigin: true },
      '/media': { target: backendUrl, changeOrigin: true },
      // WS is not proxied here — Vite's HMR server intercepts all WS upgrades
      // on port 3000. VITE_WS_URL points the browser directly at backend:8000.
    },
  },
})
