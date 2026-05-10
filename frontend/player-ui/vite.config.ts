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
  // Vercel/CI inject `VITE_*` into `process.env` at build time; `loadEnv` only merges .env files.
  // Without this fallback, production checks and `transformIndexHtml` meta injection can miss the origin
  // even when the dashboard variable is set, which keeps the amber "API origin not set" banner visible.
  const apiOriginRaw = (
    env.VITE_PLAYER_API_ORIGIN ??
    process.env.VITE_PLAYER_API_ORIGIN ??
    ''
  ).trim()
  const apiOriginNormalized = apiOriginRaw.replace(/\/$/, '')
  const onVercel = process.env.VERCEL === '1'
  const skipOriginCheck =
    (env.VITE_SKIP_PLAYER_API_ORIGIN_CHECK ?? process.env.VITE_SKIP_PLAYER_API_ORIGIN_CHECK ?? '').trim() === '1'

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
  const rawGeo = (env.DEV_GEO_COUNTRY ?? process.env.DEV_GEO_COUNTRY ?? '').trim().toUpperCase()
  const devGeoCountry = /^[A-Z]{2}$/.test(rawGeo) ? rawGeo : ''

  const geoDevProxyHooks =
    devGeoCountry.length === 2
      ? {
          configure(proxy: { on: (ev: string, fn: (...args: unknown[]) => void) => void }) {
            proxy.on('proxyReq', (...args: unknown[]) => {
              const proxyReq = args[0] as { setHeader: (name: string, value: string) => void }
              const req = args[1] as { headers: Record<string, unknown> }
              const existing = req.headers['x-geo-country']
              if (existing != null && String(existing).trim() !== '') return
              proxyReq.setHeader('X-Geo-Country', devGeoCountry)
            })
          },
        }
      : {}

  return {
    build: {
      sourcemap: mode !== 'production',
    },
    plugins: [tailwindcss(), react(), injectPlayerApiOriginMeta(apiOriginNormalized)],
    server: {
      port: 5174,
      proxy: {
        '/v1': { target: apiTarget, changeOrigin: true, ws: true, ...geoDevProxyHooks },
        '/health': { target: apiTarget, changeOrigin: true, ...geoDevProxyHooks },
      },
    },
  }
})
