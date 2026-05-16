import { useEffect, useRef, useState } from 'react'
import { playerFetch } from '../lib/playerFetch'

export type RecentWinRow = {
  game_id: string
  game_title: string
  thumbnail_url: string
  player_label: string
  amount_minor: number
  currency: string
  source: string
}

export type RecentWinsResponse =
  | { enabled: false }
  | {
      enabled: true
      wins: RecentWinRow[]
      marquee_duration_sec: number
      online_count: number
      refresh_after_secs: number
    }

function parsePayload(j: unknown): RecentWinsResponse | null {
  if (!j || typeof j !== 'object') return null
  const o = j as Record<string, unknown>
  if (o.enabled === false) return { enabled: false }
  if (o.enabled !== true) return null
  const winsRaw = o.wins
  if (!Array.isArray(winsRaw)) return null
  const wins: RecentWinRow[] = []
  for (const row of winsRaw) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    wins.push({
      game_id: typeof r.game_id === 'string' ? r.game_id : '',
      game_title: typeof r.game_title === 'string' ? r.game_title : '',
      thumbnail_url: typeof r.thumbnail_url === 'string' ? r.thumbnail_url : '',
      player_label: typeof r.player_label === 'string' ? r.player_label : '',
      amount_minor: Number(r.amount_minor),
      currency: typeof r.currency === 'string' ? r.currency : 'USD',
      source: typeof r.source === 'string' ? r.source : 'bot',
    })
  }
  const dur = Number(o.marquee_duration_sec)
  const online = Number(o.online_count)
  const refresh = Number(o.refresh_after_secs)
  if (!Number.isFinite(dur) || !Number.isFinite(refresh)) return null
  return {
    enabled: true,
    wins,
    marquee_duration_sec: dur,
    online_count: Number.isFinite(online) ? online : 0,
    refresh_after_secs: refresh,
  }
}

/**
 * Polls GET /v1/recent-wins (social proof config). Returns null while loading / error.
 */
export function useRecentWins() {
  const [data, setData] = useState<RecentWinsResponse | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        const res = await playerFetch('/v1/recent-wins', { method: 'GET' })
        const text = await res.text()
        if (!res.ok) {
          if (mountedRef.current) setData({ enabled: false })
          return
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(text) as unknown
        } catch {
          if (mountedRef.current) setData({ enabled: false })
          return
        }
        const payload = parsePayload(parsed)
        if (payload === null) {
          if (mountedRef.current) setData({ enabled: false })
          return
        }
        if (!mountedRef.current) return
        setData(payload)

        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = null
        if (payload.enabled === true) {
          const ms = Math.max(25_000, Math.min(180_000, payload.refresh_after_secs * 1000))
          timerRef.current = setTimeout(() => {
            timerRef.current = null
            void load()
          }, ms)
        }
      } catch {
        if (mountedRef.current) setData({ enabled: false })
      }
    }

    void load()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return data
}
