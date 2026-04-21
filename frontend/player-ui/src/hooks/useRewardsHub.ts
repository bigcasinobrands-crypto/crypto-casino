import { useCallback, useEffect, useState } from 'react'
import { usePlayerAuth } from '../playerAuth'

export type RewardsCalendarDay = {
  date: string
  state: 'claimable' | 'locked' | 'claimed' | 'blocked'
  amount_minor: number
  unlock_at?: string
  /** When state is blocked — e.g. active_wagering (finish bonus WR first). */
  block_reason?: string
}

export type HuntStatus = {
  wager_accrued_minor: number
  next_threshold_wager_minor?: number
  next_reward_minor?: number
  last_threshold_index: number
}

export type HubBonusInstance = {
  id: string
  promotion_version_id: number
  status: string
  granted_amount_minor: number
  currency: string
  wr_required_minor: number
  wr_contributed_minor: number
  title?: string
  bonus_type?: string
  created_at: string
}

export type HubOffer = {
  promotion_version_id: number
  title: string
  description: string
  kind: string
  schedule_summary?: string
  trigger_type?: string
  bonus_type?: string
  valid_from?: string
  valid_to?: string
}

export type RewardsHubPayload = {
  calendar: RewardsCalendarDay[]
  hunt: HuntStatus
  vip: {
    tier: string
    points: number
    next_tier?: string
    progress: {
      lifetime_wager_minor: number
      next_tier_min_wager_minor?: number
      remaining_wager_minor?: number
    }
  }
  bonus_instances: HubBonusInstance[]
  available_offers: HubOffer[]
  aggregates: {
    bonus_locked_minor: number
    wagering_remaining_minor: number
    lifetime_promo_minor: number
  }
}

export function useRewardsHub() {
  const { apiFetch, accessToken } = usePlayerAuth()
  const [data, setData] = useState<RewardsHubPayload | null>(null)
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
      const res = await apiFetch('/v1/rewards/hub?calendar_days=7')
      if (!res.ok) {
        setErr('Could not load rewards')
        setData(null)
        return
      }
      const j = (await res.json()) as RewardsHubPayload
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
