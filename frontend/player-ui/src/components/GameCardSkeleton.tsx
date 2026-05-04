import type { FC } from 'react'
import { PulsingBrandTile } from './PulsingBrandTile'

/** Portrait tile shell with vybebet wordmark + pulse — fills fetch time in game grids. */
export const GameCardSkeleton: FC = () => (
  <div className="relative aspect-[3/4] w-full overflow-hidden rounded-casino-md bg-casino-elevated ring-1 ring-white/[0.06]">
    <PulsingBrandTile className="absolute inset-0" size="card" />
  </div>
)
