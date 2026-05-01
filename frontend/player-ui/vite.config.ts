import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Default 9090 matches many local core .env PORT values; override with DEV_API_PROXY in .env.development.
  const apiTarget = (env.DEV_API_PROXY || 'http://127.0.0.1:9090').replace(/\/$/, '')
  return {
    build: {
      sourcemap: mode !== 'production',
    },
    plugins: [tailwindcss(), react()],
    server: {
      port: 5174,
      proxy: {
        '/v1': { target: apiTarget, changeOrigin: true, ws: true },
        '/health': { target: apiTarget, changeOrigin: true },
      },
    },
  }
})
