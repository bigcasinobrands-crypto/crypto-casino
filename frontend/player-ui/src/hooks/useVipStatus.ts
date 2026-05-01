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

export function useVipStatus() {
  const { apiFetch, isAuthenticated } = usePlayerAuth()
  const [data, setData] = useState<VipStatusPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!isAuthenticated) {
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
  }, [apiFetch, isAuthenticated])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, loading, err, reload }
}
