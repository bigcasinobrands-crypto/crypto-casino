import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Injects meta[name="player-api-origin"] from the resolved VITE_PLAYER_API_ORIGIN (see loadEnv). */
function injectPlayerApiOriginMeta(originNoTrailingSlash: string): Plugin {
  const escaped = originNoTrailingSlash.replace(/\\/g, '\\\\').replace(/"/g, '&quot;')
  return {
    name: 'inject-player-api-origin-meta',
    transformIndexHtml(html) {
      return html.replace(
        /<meta\s+name="player-api-origin"\s+content="[^"]*"\s*\/?>/,
        `<meta name="player-api-origin" content="${escaped}" />`,
      )
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiOriginRaw = (env.VITE_PLAYER_API_ORIGIN ?? '').trim()
  const apiOriginNormalized = apiOriginRaw.replace(/\/$/, '')
  const onVercel = process.env.VERCEL === '1'
  const skipOriginCheck = (env.VITE_SKIP_PLAYER_API_ORIGIN_CHECK ?? '').trim() === '1'

  if (mode === 'production' && onVercel && !skipOriginCheck && !apiOriginRaw) {
    throw new Error(
      '[player-ui] Production build on Vercel requires VITE_PLAYER_API_ORIGIN (public core API URL, no trailing slash), ' +
        'e.g. https://your-api.onrender.com. Without it, /v1/* is rewritten to index.html and games/sign-in break. ' +
        'Set the var in the Vercel project → Settings → Environment Variables, then redeploy. ' +
        'To opt out of this check (not recommended), set VITE_SKIP_PLAYER_API_ORIGIN_CHECK=1.',
    )
  }

  // Default 9090 matches many local core .env PORT values; override with DEV_API_PROXY in .env.development.
  const apiTarget = (env.DEV_API_PROXY || 'http://127.0.0.1:9090').replace(/\/$/, '')
  return {
    build: {
      sourcemap: mode !== 'production',
    },
    plugins: [tailwindcss(), react(), injectPlayerApiOriginMeta(apiOriginNormalized)],
    server: {
      port: 5174,
      proxy: {
        '/v1': { target: apiTarget, changeOrigin: true, ws: true },
        '/health': { target: apiTarget, changeOrigin: true },
      },
    },
  }
})
