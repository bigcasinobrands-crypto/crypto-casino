import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import svgr from 'vite-plugin-svgr'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = (env.DEV_API_PROXY || 'http://127.0.0.1:8080').replace(/\/$/, '')
  return {
    plugins: [
      tailwindcss(),
      react(),
      svgr({
        svgrOptions: {
          icon: true,
          exportType: 'named',
          namedExport: 'ReactComponent',
        },
      }),
    ],
    server: {
      port: 5173,
      proxy: {
        '/v1': { target: apiTarget, changeOrigin: true },
        '/health': { target: apiTarget, changeOrigin: true },
      },
    },
  }
})
