import { useCallback, useEffect, useRef, useState } from 'react'
import { playerApiUrl } from '../lib/playerApiUrl'

export type SocialProofResponse =
  | { enabled: false }
  | {
      enabled: true
      online_count: number
      bets_wagered_display_minor: number
      online_bucket_until_unix: number
      online_bucket_secs: number
    }

function isEnabledPayload(j: SocialProofResponse): j is Extract<SocialProofResponse, { enabled: true }> {
  return j.enabled === true && typeof (j as { online_count?: number }).online_count === 'number'
}

export function useSocialProof() {
  const [data, setData] = useState<SocialProofResponse | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchOnce = useCallback(async () => {
    try {
      const res = await fetch(playerApiUrl('/v1/social-proof'), { credentials: 'omit' })
      if (!res.ok) return
      const j = (await res.json()) as SocialProofResponse
      setData(j)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
      if (isEnabledPayload(j)) {
        const until = j.online_bucket_until_unix * 1000
        const skew = 1500
        const ms = Math.max(20_000, until - Date.now() + skew)
        timerRef.current = setTimeout(() => {
          void fetchOnce()
        }, ms)
      }
    } catch {
      /* best-effort */
    }
  }, [])

  useEffect(() => {
    void fetchOnce()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [fetchOnce])

  return data
}
