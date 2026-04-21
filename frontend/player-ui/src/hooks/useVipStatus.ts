import { useCallback, useEffect, useState } from 'react'
import { usePlayerAuth } from '../playerAuth'

export type VipProgress = {
  lifetime_wager_minor: number
  next_tier_min_wager_minor?: number
  remaining_wager_minor?: number
}

export type VipStatusPayload = {
  tier: string
  tier_id?: number
  points: number
  next_tier?: string
  progress: VipProgress
  /** Extra rebate percentage points by rewards hub program_key (VIP passive benefits). */
  rebate_percent_add_by_program?: Record<string, number>
}

export function useVipStatus() {
  const { apiFetch, accessToken } = usePlayerAuth()
  const [data, setData] = useState<VipStatusPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!accessToken) {
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setErr(null)
    try {
      const res = await apiFetch('/v1/vip/status')
      if (!res.ok) {
        setErr('Could not load VIP status')
        setData(null)
        return
      }
      const j = (await res.json()) as VipStatusPayload
      setData(j)
    } catch {
      setErr('Network error')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [apiFetch, accessToken])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, loading, err, reload }
}
