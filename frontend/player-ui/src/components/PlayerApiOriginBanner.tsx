import { playerApiOriginConfigured } from '../lib/playerApiUrl'

/** Warns when the player SPA cannot resolve API URLs (challenges, bonuses, balance, avatars). */
export default function PlayerApiOriginBanner() {
  if (!import.meta.env.PROD || playerApiOriginConfigured()) return null
  return (
    <div
      className="border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-center text-[11px] font-semibold leading-snug text-amber-100"
      role="status"
    >
      API origin not set in this build — set{' '}
      <span className="font-mono text-[10px]">VITE_PLAYER_API_ORIGIN</span> and redeploy, or set{' '}
      <span className="font-mono text-[10px]">meta[name=player-api-origin]</span> in index.html. Until then, data may not
      match admin and avatars may not load.
    </div>
  )
}
