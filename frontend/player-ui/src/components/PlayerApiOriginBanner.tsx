import { playerApiOriginConfigured } from '../lib/playerApiUrl'

/** Warns when the player SPA cannot resolve API URLs (challenges, bonuses, balance, avatars). */
export default function PlayerApiOriginBanner() {
  if (!import.meta.env.PROD || playerApiOriginConfigured()) return null
  return (
    <div
      className="border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-center text-[11px] font-semibold leading-snug text-amber-100"
      role="status"
    >
      API origin not set in this build — lobby games and sign-in call <span className="font-mono text-[10px]">/v1</span> on this
      static host and fail. Set{' '}
      <span className="font-mono text-[10px]">VITE_PLAYER_API_ORIGIN</span> in Vercel and redeploy, or set{' '}
      <span className="font-mono text-[10px]">meta[name=player-api-origin]</span> in index.html. On the core API, add this
      origin to <span className="font-mono text-[10px]">PLAYER_CORS_ORIGINS</span> (for example{' '}
      <span className="font-mono text-[10px]">https://*.vercel.app</span>).
    </div>
  )
}
