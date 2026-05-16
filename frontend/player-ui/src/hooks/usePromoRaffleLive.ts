import { useCallback, useEffect, useState } from 'react'
import { playerFetch } from '../lib/playerFetch'

export type ActiveRafflePromoPayload = {
  slug: string
  status?: string
  end_at?: string
  draw_at?: string
}

export type PromoRaffleLiveState = {
  loading: boolean
  /** Epoch ms for countdown (draw_at while drawing, else end_at) */
  endMs: number | null
  slug: string | null
  tickets: number
}

function resolveCountdownEndMs(active: ActiveRafflePromoPayload): number | null {
  const endAt = active.end_at ? Date.parse(active.end_at) : NaN
  const drawAt = active.draw_at ? Date.parse(active.draw_at) : NaN

  if (active.status === 'drawing' && Number.isFinite(drawAt)) {
    return drawAt
  }
  if (Number.isFinite(endAt)) {
    return endAt
  }
  if (Number.isFinite(drawAt)) {
    return drawAt
  }
  return null
}

/** Lobby promo tile: raffle countdown + ticket total (GET /v1/raffles/active + optional detail for tickets). */
export function usePromoRaffleLive(
  isAuthenticated: boolean,
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>,
): PromoRaffleLiveState {
  const [state, setState] = useState<PromoRaffleLiveState>({
    loading: true,
    endMs: null,
    slug: null,
    tickets: 0,
  })

  const refresh = useCallback(async () => {
    try {
      const res = await playerFetch('/v1/raffles/active')
      const j = (await res.json()) as { active?: ActiveRafflePromoPayload | null }
      if (!res.ok || !j.active?.slug) {
        setState({ loading: false, endMs: null, slug: null, tickets: 0 })
        return
      }
      const slug = j.active.slug
      const endMs = resolveCountdownEndMs(j.active)

      let tickets = 0
      if (isAuthenticated) {
        const path = `/v1/raffles/${encodeURIComponent(slug)}`
        try {
          const dRes = await apiFetch(path)
          if (dRes.ok) {
            const d = (await dRes.json()) as { me?: { total_tickets?: number } }
            const tot = d.me?.total_tickets
            tickets = typeof tot === 'number' && Number.isFinite(tot) ? tot : 0
          }
        } catch {
          tickets = 0
        }
      }

      setState({ loading: false, endMs, slug, tickets })
    } catch {
      setState({ loading: false, endMs: null, slug: null, tickets: 0 })
    }
  }, [apiFetch, isAuthenticated])

  useEffect(() => {
    let cancelled = false
    void refresh()
    const id = window.setInterval(() => {
      if (!cancelled) void refresh()
    }, 60000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [refresh])

  return state
}
