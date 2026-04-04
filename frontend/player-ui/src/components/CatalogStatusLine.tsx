import type { FC } from 'react'
import type { OperationalHealth } from '../hooks/useOperationalHealth'

/** Player-facing catalog stats (same source as admin sync panel, without internal error text). */
const CatalogStatusLine: FC<{ data: OperationalHealth }> = ({ data }) => {
  const parts: string[] = []
  if (typeof data.visible_games_count === 'number') {
    parts.push(`${data.visible_games_count.toLocaleString()} visible in lobby`)
  }
  if (typeof data.blueocean_visible_games_count === 'number') {
    parts.push(`${data.blueocean_visible_games_count.toLocaleString()} Blue Ocean`)
  }
  if (data.last_catalog_sync_at) {
    try {
      parts.push(`last sync ${new Date(data.last_catalog_sync_at).toLocaleString()}`)
    } catch {
      parts.push('last sync recorded')
    }
  }
  if (typeof data.last_catalog_upserted === 'number' && data.last_catalog_upserted > 0) {
    parts.push(`last batch +${data.last_catalog_upserted.toLocaleString()}`)
  }
  if (parts.length === 0) return null

  const syncBad = data.catalog_sync_ok === false

  return (
    <p
      className={`mb-3 text-xs ${syncBad ? 'text-amber-200/85' : 'text-casino-muted'}`}
      title="From GET /health/operational. If sync failed, the banner above explains; staff retries in Blue Ocean ops."
    >
      {parts.join(' · ')}
    </p>
  )
}

export default CatalogStatusLine
