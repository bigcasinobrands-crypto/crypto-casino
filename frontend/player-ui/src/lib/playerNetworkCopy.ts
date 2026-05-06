import { playerApiConfiguredOrigin, playerApiOriginConfigured } from './playerApiUrl'

/**
 * When `fetch` throws (HTTP 0 / no response): branch dev vs prod and whether the API base is baked in.
 * Fingerprint / region env vars do not replace `VITE_PLAYER_API_ORIGIN`; misconfigured API URL or CORS
 * should not surface local-only hints on Vercel.
 */
export function messageCannotReachApi(): string {
  if (import.meta.env.DEV) {
    return 'Cannot reach API. Run the core service (e.g. npm run dev:api) and check DEV_API_PROXY / network.'
  }
  if (!playerApiOriginConfigured()) {
    return 'Cannot reach API. Set VITE_PLAYER_API_ORIGIN on your host (e.g. Vercel) to your public core API URL and redeploy.'
  }
  const hint = playerApiConfiguredOrigin()
  const suffix = hint ? ` Request URL starts at: ${hint}.` : ''
  return (
    'Cannot reach API. The browser got no response (not HTTP 4xx/5xx). Check the core API is up, PLAYER_CORS_ORIGINS includes this page’s exact origin (https + host, with or without www), HTTPS matches the player page, and mixed content is not blocked.' +
    suffix
  )
}

/** Lobby/catalog list fetch failed in the catch path (network). */
export function messageLobbyCatalogNetwork(): string {
  if (import.meta.env.DEV) {
    return 'Network error — is the core API running? Set DEV_API_PROXY in frontend/player-ui/.env.development to match services/core PORT (e.g. http://127.0.0.1:9090), then restart Vite.'
  }
  if (!playerApiOriginConfigured()) {
    return 'Network error — set VITE_PLAYER_API_ORIGIN to your public API URL and redeploy so /v1 requests hit the core API.'
  }
  const hint = playerApiConfiguredOrigin()
  const suffix = hint ? ` Request URL starts at: ${hint}.` : ''
  return (
    'Network error — could not reach the API. Check deployment health, CORS (PLAYER_CORS_ORIGINS), and SSL. In DevTools → Network, failed preflight/request often means the Origin is missing from PLAYER_CORS_ORIGINS or the API is down.' +
    suffix
  )
}

/** HTTP status hints for game list failures (non-catch). */
export function messageGamesListUpstream(status: number): string {
  if (status === 502 || status === 503 || status === 504) {
    if (import.meta.env.DEV) {
      return 'Could not reach the API (bad gateway). Start Postgres (npm run compose:up) and the core API (npm run dev:api on port 8080).'
    }
    return 'Could not reach the API (bad gateway). Check your core API deployment and upstream services.'
  }
  return 'Could not load games.'
}
