import { useCallback, useEffect, useState } from 'react'
import { usePlayerAuth } from '../playerAuth'

export type VipProgress = {
  lifetime_wager_minor: number
  next_tier_min_wager_minor?: number
  remaining_wager_minor?: number
}

export type VipTierPerkState = 'active' | 'claimable' | 'pending' | 'unavailable'

export type VipTierPerk = {
  benefit_id: number
  benefit_type: string
  title: string
  description?: string
  state: VipTierPerkState
  sort_order?: number
  promotion_version_id?: number
  bonus_instance_id?: string
  deep_link?: string
  icon_key?: string
}

/** Pending VIP rakeback to claim to cash wallet (`GET /v1/vip/status` → `rakeback_claim`). */
export type RakebackClaimStatus = {
  claimable_minor: number
  pending_periods?: number
  claimable_now?: boolean
  block_reason?: string
}

export type VipStatusPayload = {
  tier: string
  tier_id?: number
  points: number
  next_tier?: string
  progress: VipProgress
  /** Extra rebate percentage points by rewards hub program_key (VIP passive benefits). */
  rebate_percent_add_by_program?: Record<string, number>
  /** Accrued rakeback credits available to move to cash wallet when `claimable_now`. */
  rakeback_claim?: RakebackClaimStatus
  /** Current-tier perks with Active / Claimable / etc. (GET /v1/vip/status). */
  tier_perks?: VipTierPerk[]
}

const VIP_STATUS_CACHE_TTL_MS = 20_000
let vipStatusCacheData: VipStatusPayload | null = null
let vipStatusCacheAt = 0
let vipStatusInFlight: Promise<VipStatusPayload | null> | null = null

export function useVipStatus() {
  const { apiFetch, isAuthenticated } = usePlayerAuth()
  const [data, setData] = useState<VipStatusPayload | null>(() => vipStatusCacheData)
  const [loading, setLoading] = useState(() => isAuthenticated && vipStatusCacheData == null)
  const [err, setErr] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!isAuthenticated) {
      setData(null)
      setLoading(false)
      vipStatusCacheData = null
      vipStatusCacheAt = 0
      return
    }
    const now = Date.now()
    const cacheFresh = vipStatusCacheData != null && now - vipStatusCacheAt < VIP_STATUS_CACHE_TTL_MS
    if (cacheFresh) {
      setData(vipStatusCacheData)
      setLoading(false)
      setErr(null)
      return
    }
    if (vipStatusInFlight) {
      setLoading(vipStatusCacheData == null)
      const shared = await vipStatusInFlight
      setData(shared)
      setLoading(false)
      return
    }
    setLoading(vipStatusCacheData == null)
    setErr(null)
    vipStatusInFlight = (async () => {
      const res = await apiFetch('/v1/vip/status')
      if (!res.ok) {
        return null
      }
      const j = (await res.json()) as VipStatusPayload
      return j
    })()
    try {
      const next = await vipStatusInFlight
      if (next) {
        vipStatusCacheData = next
        vipStatusCacheAt = Date.now()
        setData(next)
        setErr(null)
      } else {
        setErr('Could not load VIP status')
        if (vipStatusCacheData == null) setData(null)
      }
    } catch {
      setErr('Network error')
      if (vipStatusCacheData == null) setData(null)
    } finally {
      vipStatusInFlight = null
      setLoading(false)
    }
  }, [apiFetch, isAuthenticated])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, loading, err, reload }
}
