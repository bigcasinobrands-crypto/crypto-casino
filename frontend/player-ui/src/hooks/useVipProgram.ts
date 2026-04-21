import { useCallback, useEffect, useState } from 'react'
import { usePlayerAuth } from '../playerAuth'
import type { VipProgramTier } from '../lib/vipPresentation'

export type VipProgramPayload = { tiers: VipProgramTier[] }

export function useVipProgram() {
  const { apiFetch } = usePlayerAuth()
  const [data, setData] = useState<VipProgramPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await apiFetch('/v1/vip/program')
      if (!res.ok) {
        setErr('Could not load VIP programme')
        setData(null)
        return
      }
      const j = (await res.json()) as VipProgramPayload
      setData({ tiers: Array.isArray(j.tiers) ? j.tiers : [] })
    } catch {
      setErr('Network error')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, loading, err, reload }
}
