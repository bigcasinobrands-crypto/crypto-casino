import { useEffect, useState } from 'react'
import { playerFetch } from '../lib/playerFetch'
import {
  ESPORTS_NAV_FALLBACK,
  mergeEsportsNavLogosFromFallback,
  type EsportsNavItem,
} from '../lib/oddin/esportsNavCatalog'
import { applyEsportsBifrostRoutesToAll } from '../lib/oddin/esportsOddinSportRoutes'
import { useOddinBootstrap } from '../context/OddinBootstrapContext'

function normalizeApiItem(x: Record<string, unknown>): EsportsNavItem | null {
  const id = typeof x.id === 'string' ? x.id.trim() : ''
  const label = typeof x.label === 'string' ? x.label.trim() : ''
  if (!id || !label) return null
  const page = typeof x.page === 'string' ? x.page : ''
  const logoUrl =
    typeof x.logoUrl === 'string' && x.logoUrl.trim().startsWith('https://') ? x.logoUrl.trim() : undefined
  return { id, label, page, logoUrl }
}

/**
 * E-Sports sidebar rows: operator list from GET /v1/sportsbook/oddin/esports-nav when configured; slash `page` paths
 * (and bare `od:sport:*` where listed) are upgraded to Oddin `Sports_Routes.csv` route parameters when IDs match; opaque
 * `page` values from the API are kept. Missing `logoUrl`
 * is filled from bundled fallbacks (Oddin should supply HTTPS `logoUrl` per title for a perfect match).
 */
export function useOddinEsportsNav() {
  const { esportsIntegrationActive } = useOddinBootstrap()
  const [items, setItems] = useState<EsportsNavItem[]>(ESPORTS_NAV_FALLBACK)
  const [labelsFromOperator, setLabelsFromOperator] = useState(false)

  useEffect(() => {
    if (!esportsIntegrationActive) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await playerFetch('/v1/sportsbook/oddin/esports-nav')
        if (cancelled || !res.ok) return
        const j = (await res.json()) as { items?: unknown[] }
        const raw = Array.isArray(j.items) ? j.items : []
        if (raw.length === 0) return
        const next: EsportsNavItem[] = []
        for (const row of raw) {
          if (!row || typeof row !== 'object' || Array.isArray(row)) continue
          const it = normalizeApiItem(row as Record<string, unknown>)
          if (it && it.id.toLowerCase() !== 'overview') next.push(it)
        }
        if (next.length === 0 || cancelled) return
        setItems(applyEsportsBifrostRoutesToAll(mergeEsportsNavLogosFromFallback(next)))
        setLabelsFromOperator(true)
      } catch {
        /* use fallback */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [esportsIntegrationActive])

  return { items, labelsFromOperator }
}
