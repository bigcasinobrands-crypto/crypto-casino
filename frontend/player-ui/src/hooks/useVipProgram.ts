import { useCallback, useEffect, useState } from 'react'
import { usePlayerAuth } from '../playerAuth'
import type { VipProgramTier } from '../lib/vipPresentation'

export type VipProgramPayload = { tiers: VipProgramTier[] }

const VIP_PROGRAM_CACHE_TTL_MS = 5 * 60_000
let vipProgramCacheData: VipProgramPayload | null = null
let vipProgramCacheAt = 0
let vipProgramInFlight: Promise<VipProgramPayload | null> | null = null

export function useVipProgram() {
  const { apiFetch } = usePlayerAuth()
  const [data, setData] = useState<VipProgramPayload | null>(() => vipProgramCacheData)
  const [loading, setLoading] = useState(() => vipProgramCacheData == null)
  const [err, setErr] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const now = Date.now()
    const cacheFresh =
      vipProgramCacheData != null && now - vipProgramCacheAt < VIP_PROGRAM_CACHE_TTL_MS
    if (cacheFresh) {
      setData(vipProgramCacheData)
      setLoading(false)
      setErr(null)
      return
    }
    if (vipProgramInFlight) {
      setLoading(vipProgramCacheData == null)
      const shared = await vipProgramInFlight
      setData(shared)
      setLoading(false)
      return
    }
    setLoading(vipProgramCacheData == null)
    setErr(null)
    vipProgramInFlight = (async () => {
      const res = await apiFetch(`/v1/vip/program?t=${Date.now()}`)
      if (!res.ok) {
        return null
      }
      const j = (await res.json()) as VipProgramPayload
      return { tiers: Array.isArray(j.tiers) ? j.tiers : [] }
    })()
    try {
      const next = await vipProgramInFlight
      if (next) {
        vipProgramCacheData = next
        vipProgramCacheAt = Date.now()
        setData(next)
        setErr(null)
      } else {
        setErr('Could not load VIP programme')
        if (vipProgramCacheData == null) setData(null)
      }
    } catch {
      setErr('Network error')
      if (vipProgramCacheData == null) setData(null)
    } finally {
      vipProgramInFlight = null
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, loading, err, reload }
}
