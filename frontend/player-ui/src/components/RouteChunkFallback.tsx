import { PulsingBrandTile } from './PulsingBrandTile'

/** Shown while a lazy route chunk is downloading / parsing (Rewards, Profile, VIP, catalog, etc.). */
export function RouteChunkFallback() {
  return (
    <div
      className="flex min-h-[min(420px,55dvh)] flex-1 flex-col items-center justify-center bg-casino-bg px-4"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <PulsingBrandTile size="card" />
    </div>
  )
}
