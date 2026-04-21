import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = (env.DEV_API_PROXY || 'http://127.0.0.1:8080').replace(/\/$/, '')
  return {
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
