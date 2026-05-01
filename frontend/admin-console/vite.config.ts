import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import svgr from 'vite-plugin-svgr'

/** Blue Ocean catalog sync can run several minutes; http-proxy defaults (~60s) otherwise return 502 to the browser. */
function apiDevProxy(target: string): ProxyOptions {
  const ms = 15 * 60 * 1000
  return {
    target,
    changeOrigin: true,
    timeout: ms,
    proxyTimeout: ms,
    configure(proxy) {
      proxy.on('proxyReq', (proxyReq, req) => {
        proxyReq.setTimeout(ms)
        req.socket?.setTimeout(ms)
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Must match the core API listen port (see `PORT` in services/core/.env; default 9090 in config when unset).
  const apiTarget = (env.DEV_API_PROXY || 'http://127.0.0.1:9090').replace(/\/$/, '')
  const apiProxy = apiDevProxy(apiTarget)
  return {
    build: {
      sourcemap: mode !== 'production',
    },
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
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
        '/v1': apiProxy,
        '/health': apiProxy,
      },
    },
    // `vite preview` does not inherit `server.proxy` — repeat here so `/v1` hits the API.
    preview: {
      proxy: {
        '/v1': apiProxy,
        '/health': apiProxy,
      },
    },
  }
})
