import { useEffect, useRef, useState } from 'react'
import { playerFetch } from '../lib/playerFetch'

export type SocialProofResponse =
  | { enabled: false }
  | {
      enabled: true
      online_count: number
      bets_wagered_display_minor: number
      online_bucket_until_unix: number
      online_bucket_secs: number
    }

function parsePayload(j: unknown): SocialProofResponse | null {
  if (!j || typeof j !== 'object') return null
  const o = j as Record<string, unknown>
  if (o.enabled === false) return { enabled: false }
  if (o.enabled !== true) return null
  const online = Number(o.online_count)
  const minor = Number(o.bets_wagered_display_minor)
  const until = Number(o.online_bucket_until_unix)
  const secs = Number(o.online_bucket_secs)
  if (!Number.isFinite(online) || !Number.isFinite(minor)) return null
  if (!Number.isFinite(until) || !Number.isFinite(secs)) return null
  return {
    enabled: true,
    online_count: online,
    bets_wagered_display_minor: minor,
    online_bucket_until_unix: until,
    online_bucket_secs: secs,
  }
}

function isLivePayload(j: SocialProofResponse): j is Extract<SocialProofResponse, { enabled: true }> {
  return j.enabled === true
}

/**
 * null = loading or transient error (UI shows placeholders and retries).
 * { enabled: false } = feature off in CMS.
 * { enabled: true, ... } = live snapshot from API.
 */
export function useSocialProof() {
  const [data, setData] = useState<SocialProofResponse | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const scheduleRetry = () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null
        void load()
      }, 25_000)
    }

    const load = async () => {
      try {
        const res = await playerFetch('/v1/social-proof', { method: 'GET' })
        const text = await res.text()
        if (!res.ok) {
          if (mountedRef.current) scheduleRetry()
          return
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(text) as unknown
        } catch {
          if (mountedRef.current) scheduleRetry()
          return
        }

        const payload = parsePayload(parsed)
        if (payload === null) {
          if (mountedRef.current) scheduleRetry()
          return
        }

        if (!mountedRef.current) return
        setData(payload)

        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
        if (isLivePayload(payload)) {
          const until = payload.online_bucket_until_unix * 1000
          const skew = 1500
          const ms = Math.max(20_000, until - Date.now() + skew)
          refreshTimerRef.current = setTimeout(() => {
            refreshTimerRef.current = null
            void load()
          }, ms)
        }
      } catch {
        if (mountedRef.current) scheduleRetry()
      }
    }

    void load()
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [])

  return data
}
