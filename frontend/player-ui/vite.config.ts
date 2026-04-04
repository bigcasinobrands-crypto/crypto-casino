import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: 5174,
    proxy: {
      // Player API routes (add /v1/auth, etc. on the backend); admin stays on /v1/admin only.
      // 127.0.0.1 avoids Windows localhost → IPv6 (::1) mismatches when the API binds IPv4 only.
      '/v1': { target: 'http://127.0.0.1:8080', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:8080', changeOrigin: true },
    },
  },
})
