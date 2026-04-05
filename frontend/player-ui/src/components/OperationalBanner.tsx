import type { FC } from 'react'
import type { OperationalHealth } from '../hooks/useOperationalHealth'

type Props = {
  data: OperationalHealth | null
  error: string | null
}

const OperationalBanner: FC<Props> = ({ data, error }) => {
  if (error && !data) {
    return (
      <div className="border-b border-amber-500/40 bg-amber-950/40 px-4 py-2 text-center text-xs text-amber-200">
        Could not load service status ({error}).
      </div>
    )
  }
  if (!data) return null
  if (data.maintenance_mode) {
    return (
      <div className="border-b border-amber-500/50 bg-amber-900/30 px-4 py-2 text-center text-sm text-amber-100">
        We are in maintenance mode. Some features may be unavailable.
      </div>
    )
  }
  if (data.disable_game_launch) {
    return (
      <div className="border-b border-amber-500/50 bg-amber-900/30 px-4 py-2 text-center text-sm text-amber-100">
        Game launch is temporarily disabled.
      </div>
    )
  }
  if (!data.blueocean_configured) {
    return (
      <div className="border-b border-casino-border bg-casino-elevated/80 px-4 py-2 text-center text-xs text-casino-muted">
        Demo note: Blue Ocean API is not configured on this environment.
      </div>
    )
  }
  const boN = data.blueocean_visible_games_count
  const catalogEmpty =
    data.blueocean_configured && typeof boN === 'number' && boN === 0
  const legacyEmpty =
    !data.blueocean_configured &&
    typeof data.visible_games_count === 'number' &&
    data.visible_games_count === 0
  if (catalogEmpty || legacyEmpty) {
    return (
      <div className="border-b border-amber-500/40 bg-amber-950/35 px-4 py-2 text-center text-xs text-amber-100">
        {data.blueocean_configured
          ? 'The Blue Ocean catalog has no visible games yet. In the staff console, open Blue Ocean ops and run '
          : 'The catalog has no visible games yet. In the staff console, open Blue Ocean ops and run '}
        <span className="font-medium">Sync catalog</span>. If games stay hidden, check they are not marked hidden in the
        catalog.
      </div>
    )
  }
  return null
}

export default OperationalBanner
