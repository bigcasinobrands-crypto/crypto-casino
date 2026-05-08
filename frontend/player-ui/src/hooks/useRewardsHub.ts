import { useCallback, useEffect, useState } from 'react'
import { usePlayerAuth } from '../playerAuth'
import type { RakebackClaimStatus } from './useVipStatus'

export type RewardsCalendarDay = {
  date: string
  state: 'claimable' | 'locked' | 'claimed' | 'blocked'
  amount_minor: number
  unlock_at?: string
  /** When state is blocked — e.g. active_wagering (finish bonus WR first). */
  block_reason?: string
  /** What claim pays: "cash" or "bonus" depending on program wiring. */
  payout_kind?: string
}

export type HuntStatus = {
  wager_accrued_minor: number
  next_threshold_wager_minor?: number
  next_reward_minor?: number
  last_threshold_index: number
  locked_reason?: string
  effective_tier_id?: number
}

/** Subset of grant snapshot exposed for player UI (from GET /v1/rewards/hub). */
export type HubBonusDetails = {
  excluded_game_ids?: unknown
  allowed_game_ids?: unknown
  max_bet_minor?: number
  game_weight_pct?: number
  withdraw_policy?: string
  deposit_minor?: number
  grant_minor?: number
  wagering_multiplier?: number
  /** RFC3339 — when this promotion version was published (live). */
  promotion_published_at?: string
  /** RFC3339 — optional offer window start. */
  promotion_valid_from?: string
  /** RFC3339 — optional offer window end. */
  promotion_valid_to?: string
}

export type HubBonusInstance = {
  id: string
  promotion_version_id: number
  status: string
  granted_amount_minor: number
  currency: string
  wr_required_minor: number
  wr_contributed_minor: number
  /** When true (e.g. VIP), does not use the main “one bonus” primary slot. */
  exempt_from_primary_slot?: boolean
  title?: string
  description?: string
  bonus_type?: string
  created_at: string
  /** Same as available offers — promotion hero image URL. */
  hero_image_url?: string
  details?: HubBonusDetails
}

export type HubOfferAudience = {
  first_deposit_only?: boolean
  nth_deposit?: number
  min_deposit_minor?: number
  max_deposit_minor?: number
  deposit_channels?: string[]
  vip_min_tier?: number
  country_allow?: string[]
  country_deny?: string[]
  tags?: string[]
  invitation_or_target_list?: boolean
}

export type HubOfferDetails = {
  wagering_multiplier?: number
  max_bet_minor?: number
  game_weight_pct?: number
  withdraw_policy?: string
  excluded_game_ids?: unknown
  allowed_game_ids?: unknown
  audience?: HubOfferAudience
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
  /** Present when the offer is redeemed via Profile → Promo Code. */
  promo_code?: string
  /** From Bonus Hub — player hero image (URL or `/v1/uploads/...`). */
  hero_image_url?: string
  /** Operator enabled hub boost — listed despite schedule/segment for this promo. */
  hub_boost?: boolean
  /** Wagering, game lists, and audience rules (from promotion version rules). */
  offer_details?: HubOfferDetails
}

/** One configured daily boost window for the player’s tier (hub returns one icon per slot). */
export type RakebackBoostSlot = {
  index: number
  start_utc: string
  window_start_at: string
  claim_ends_at: string
  claimed: boolean
  claimable: boolean
  active: boolean
}

/** VIP rakeback boost windows (GET /v1/rewards/hub nested under `vip`). */
export type RakebackBoostStatus = {
  enabled?: boolean
  boost_percent_add?: number
  rebate_program_key?: string
  claimable_now?: boolean
  active_now?: boolean
  active_until_at?: string
  /** Server time when the current boost was claimed (`claimed_at`); progress bar runs until `active_until_at`. */
  boost_active_started_at?: string
  claim_window_start_at?: string
  claim_window_ends_at?: string
  next_window_start_at?: string
  claims_remaining_today?: number
  reason?: string
  slots?: RakebackBoostSlot[]
  /** Cash stake since boost started (while `active_now`). */
  boost_wager_accrued_minor?: number
  /** Estimated extra rakeback from boost % on that stake; settles to claimable after boost ends. */
  boost_accrued_estimate_minor?: number
}

/** Subset of hub rakeback boost fields for the “next release” countdown + progress bar. */
export type RakebackBoostReleaseTimerInput = {
  active_now: boolean
  claimable_now: boolean
  active_until_at?: string
  boost_active_started_at?: string
  claim_window_start_at?: string
  claim_window_ends_at?: string
  next_window_start_at?: string
  slots?: RakebackBoostSlot[]
}

/** Present when backend exposes VIP schedule previews (Phase 2+). Until then, omitted. */
export type VipDeliveryPreview = {
  weekly_next_at?: string
  monthly_next_at?: string
}

/** Present when backend exposes rain eligibility (Phase 5+). Until then, omitted. */
export type RainEligibilityPreview = {
  eligible?: boolean
  next_round_at?: string
}

/** From GET /v1/rewards/hub `referral` — link code + funnel stages when wired. */
export type HubReferralSummary = {
  link_code?: string
  link_id?: string
  stages?: Record<string, number>
  description?: string
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
    rakeback_boost?: RakebackBoostStatus
    rakeback_claim?: RakebackClaimStatus
  }
  bonus_instances: HubBonusInstance[]
  available_offers: HubOffer[]
  aggregates: {
    bonus_locked_minor: number
    wagering_remaining_minor: number
    lifetime_promo_minor: number
  }
  /** Optional until VIP delivery schedules ship — UI renders only when fields exist. */
  vip_delivery_preview?: VipDeliveryPreview
  /** Optional until rain programme ships — UI renders only when meaningful keys exist. */
  rain_eligibility?: RainEligibilityPreview
  referral?: HubReferralSummary
}

function normalizeReferral(raw: unknown): HubReferralSummary | undefined {
  if (raw == null || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const link_code = typeof r.link_code === 'string' ? r.link_code.trim() : ''
  const link_id = typeof r.link_id === 'string' ? r.link_id.trim() : ''
  const description = typeof r.description === 'string' ? r.description : undefined
  let stages: Record<string, number> | undefined
  if (r.stages && typeof r.stages === 'object' && !Array.isArray(r.stages)) {
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(r.stages as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[k] = Math.trunc(v)
      } else if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v)
        if (Number.isFinite(n)) out[k] = Math.trunc(n)
      }
    }
    if (Object.keys(out).length > 0) stages = out
  }
  const summary: HubReferralSummary = {}
  if (link_code) summary.link_code = link_code
  if (link_id) summary.link_id = link_id
  if (description) summary.description = description
  if (stages) summary.stages = stages
  if (
    !summary.link_code &&
    !summary.link_id &&
    !summary.description &&
    !summary.stages
  ) {
    return undefined
  }
  return summary
}

function parseMinorInt(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Math.trunc(v)
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? Math.trunc(n) : 0
  }
  return 0
}

/**
 * Coerces hub JSON (numbers, stringified numbers) for the My Bonuses strip. Server scopes
 * aggregates to the current in-progress bonus (primary slot first, else oldest other).
 */
const emptyHubPayload: RewardsHubPayload = {
  calendar: [],
  hunt: { wager_accrued_minor: 0, last_threshold_index: 0 },
  vip: { tier: '', points: 0, progress: { lifetime_wager_minor: 0 } },
  bonus_instances: [],
  available_offers: [],
  aggregates: { bonus_locked_minor: 0, wagering_remaining_minor: 0, lifetime_promo_minor: 0 },
}

const REWARDS_HUB_CACHE_TTL_MS = 20_000
let rewardsHubCacheData: RewardsHubPayload | null = null
let rewardsHubCacheAt = 0
let rewardsHubInFlight: Promise<RewardsHubPayload | null> | null = null

export function normalizeRewardsHubPayload(raw: unknown): RewardsHubPayload {
  if (raw == null || typeof raw !== 'object') {
    return emptyHubPayload
  }
  const o = raw as Record<string, unknown>
  const list = Array.isArray(o.bonus_instances) ? (o.bonus_instances as HubBonusInstance[]) : []
  const agg = o.aggregates && typeof o.aggregates === 'object' ? (o.aggregates as Record<string, unknown>) : null
  const aggregates = {
    bonus_locked_minor: parseMinorInt(agg?.bonus_locked_minor),
    wagering_remaining_minor: parseMinorInt(agg?.wagering_remaining_minor),
    lifetime_promo_minor: parseMinorInt(agg?.lifetime_promo_minor),
  }
  const referral = normalizeReferral(o.referral)
  return {
    ...(o as RewardsHubPayload),
    bonus_instances: list,
    aggregates,
    ...(referral !== undefined ? { referral } : {}),
  }
}

export function useRewardsHub() {
  const { apiFetch, isAuthenticated } = usePlayerAuth()
  const [data, setData] = useState<RewardsHubPayload | null>(() => rewardsHubCacheData)
  const [loading, setLoading] = useState(() => isAuthenticated && rewardsHubCacheData == null)
  const [err, setErr] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!isAuthenticated) {
      setData(null)
      setLoading(false)
      rewardsHubCacheData = null
      rewardsHubCacheAt = 0
      return
    }
    const now = Date.now()
    const cacheFresh =
      rewardsHubCacheData != null && now - rewardsHubCacheAt < REWARDS_HUB_CACHE_TTL_MS
    if (cacheFresh) {
      setData(rewardsHubCacheData)
      setLoading(false)
      setErr(null)
      return
    }
    if (rewardsHubInFlight) {
      setLoading(rewardsHubCacheData == null)
      const shared = await rewardsHubInFlight
      setData(shared)
      setLoading(false)
      return
    }
    setLoading(rewardsHubCacheData == null)
    setErr(null)
    rewardsHubInFlight = (async () => {
      const res = await apiFetch('/v1/rewards/hub?calendar_days=7')
      if (!res.ok) {
        return null
      }
      const j = await res.json()
      return normalizeRewardsHubPayload(j)
    })()
    try {
      const next = await rewardsHubInFlight
      if (next) {
        rewardsHubCacheData = next
        rewardsHubCacheAt = Date.now()
        setData(next)
        setErr(null)
      } else {
        setErr('Could not load rewards')
        if (rewardsHubCacheData == null) setData(null)
      }
    } catch {
      setErr('Network error')
      if (rewardsHubCacheData == null) setData(null)
    } finally {
      rewardsHubInFlight = null
      setLoading(false)
    }
  }, [apiFetch, isAuthenticated])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, loading, err, reload }
}
