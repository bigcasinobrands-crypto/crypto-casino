export type VipBenefit = {
  title: string
  description: string
  icon?: string
  icon_color?: string
  /** When merged from `tier_benefits`, stable id for matching `tier_perks` on VIP status. */
  benefit_id?: number
  benefit_type?: string
}

export type VipDisplay = {
  header_color?: string
  character_image_url?: string
  rank_label?: string
}

export type VipTierPerks = {
  hide_from_public_page?: boolean
  display?: VipDisplay
  benefits?: VipBenefit[]
  /** Admin: show weekly VIP bonus promo card + eligibility for weekly delivery pipeline */
  weekly_bonus_enabled?: boolean
  /** Admin: show monthly VIP bonus promo card + eligibility for monthly delivery pipeline */
  monthly_bonus_enabled?: boolean
}

/** Structured benefits from GET /v1/vip/program (vip_tier_benefits). */
export type VipTierBenefitStructured = {
  id: number
  benefit_type: string
  sort_order?: number
  promotion_version_id?: number
  player_title?: string
  player_description?: string
  /** From server join on promotion_versions / promotions (public programme). */
  promotion_display_title?: string
  promotion_display_description?: string
  config?: Record<string, unknown>
}

export type VipProgramTier = {
  id: number
  sort_order: number
  name: string
  min_lifetime_wager_minor: number
  perks: VipTierPerks
  tier_benefits?: VipTierBenefitStructured[]
}

const CHEST_A =
  'https://storage.googleapis.com/banani-generated-images/generated-images/72d3e0a8-1982-470f-8067-a612077106bc.jpg'
const CHEST_B =
  'https://storage.googleapis.com/banani-generated-images/generated-images/47f71885-c9b4-4b16-a1a8-d4e5b4e8805b.jpg'

/** Hero tiles under the intro banner (design reference). */
export const VIP_HERO_TILES: { title: string; image: string }[] = [
  { title: 'Weekly Bonus', image: CHEST_A },
  { title: 'Daily Rewards', image: CHEST_B },
  { title: 'Loyalty Points', image: CHEST_A },
  { title: 'Special Offers', image: CHEST_B },
]

export function formatVipWagerThreshold(minor: number): string {
  const usd = minor / 100
  if (usd >= 1_000_000) {
    const m = usd / 1_000_000
    return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`
  }
  if (usd >= 1_000) {
    const k = usd / 1_000
    return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`
  }
  return `$${usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

export function humanizeRebateKey(key: string): string {
  const k = key.trim()
  if (!k) return 'rebate programme'
  if (k.toLowerCase() === 'weekly_cashback') return 'Rakeback'
  return k
    .split('_')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ')
}

function normalizeRakebackCopy(s: string): string {
  return s.replace(/weekly\s+cashback/gi, 'rakeback').replace(/cashback/gi, 'rakeback')
}

function hasPercentCopy(s: string): boolean {
  return /\d+(\.\d+)?\s*%/.test(s)
}

function formatPercent(value: unknown, maxFractionDigits = 2): string {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n)) return '0'
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(n)
}

function structuredTierBenefitToCard(b: VipTierBenefitStructured): VipBenefit {
  const base: VipBenefit = { title: '', description: '', icon: 'sparkles', icon_color: '#c084fc', benefit_id: b.id, benefit_type: b.benefit_type }
  if (b.benefit_type === 'vip_card_feature') {
    const cfg = b.config ?? {}
    const cfgTitle = typeof cfg.title === 'string' ? cfg.title.trim() : ''
    const cfgSubtitle = typeof cfg.subtitle === 'string' ? cfg.subtitle.trim() : ''
    const cfgIcon = typeof cfg.icon_key === 'string' ? cfg.icon_key.trim() : ''
    return {
      ...base,
      title: cfgTitle || (typeof b.player_title === 'string' ? b.player_title.trim() : '') || 'VIP benefit',
      description: cfgSubtitle || (typeof b.player_description === 'string' ? b.player_description.trim() : '') || '',
      icon: cfgIcon || 'sparkles',
    }
  }
  if (b.benefit_type === 'rebate_percent_add') {
    const cfg = b.config ?? {}
    const key = typeof cfg.rebate_program_key === 'string' ? cfg.rebate_program_key.trim() : ''
    const ptRaw = typeof b.player_title === 'string' ? normalizeRakebackCopy(b.player_title.trim()) : ''
    const pt = ptRaw.toLowerCase() === 'vip rakeback boost' ? '' : ptRaw
    const pd = typeof b.player_description === 'string' ? normalizeRakebackCopy(b.player_description.trim()) : ''
    const title = pt && !hasPercentCopy(pt) ? pt : 'Upgraded Rakeback'
    let description = pd
    if (!description || hasPercentCopy(description)) {
      description = key
        ? `Enhanced ${humanizeRebateKey(key).toLowerCase()} so you keep more value from eligible play.`
        : 'Enhanced rakeback so you keep more value from eligible play.'
    }
    return { ...base, title, description, icon: 'circle-dollar-sign' }
  }
  if (b.benefit_type === 'grant_promotion') {
    const pt = typeof b.player_title === 'string' ? b.player_title.trim() : ''
    const pdt = typeof b.promotion_display_title === 'string' ? b.promotion_display_title.trim() : ''
    const title = pt || pdt || 'VIP bonus'
    const pd = typeof b.player_description === 'string' ? b.player_description.trim() : ''
    const pdd = typeof b.promotion_display_description === 'string' ? b.promotion_display_description.trim() : ''
    const description = pd || pdd || 'Promotion attached to this tier.'
    return { ...base, title, description, icon: 'sparkles' }
  }
  if (b.benefit_type === 'level_up_cash_percent') {
    const cfg = b.config ?? {}
    let pct = 0
    const raw = cfg.percent_of_previous_level_wager
    if (typeof raw === 'number' && Number.isFinite(raw)) pct = raw
    else if (typeof raw === 'string' && raw.trim()) pct = Number(raw) || 0
    const title =
      (typeof b.player_title === 'string' && b.player_title.trim()) || 'Level Up Rewards'
    const description =
      (typeof b.player_description === 'string' && b.player_description.trim()) ||
      (pct > 0
        ? `Straight cash reward at ${formatPercent(pct)}% of your previous-level wager.`
        : 'Straight cash reward on level up.')
    return { ...base, title, description, icon: 'arrow-up-circle', icon_color: '#eab308' }
  }
  if (b.benefit_type === 'rakeback_boost_schedule') {
    const cfg = b.config ?? {}
    const windows = Array.isArray(cfg.windows) ? cfg.windows.length : 0
    const rawTitle = typeof b.player_title === 'string' ? normalizeRakebackCopy(b.player_title.trim()) : ''
    const rawDescription = typeof b.player_description === 'string' ? normalizeRakebackCopy(b.player_description.trim()) : ''
    const title = rawTitle && !hasPercentCopy(rawTitle) ? rawTitle : 'Rakeback Boost'
    const description =
      rawDescription && !hasPercentCopy(rawDescription)
        ? rawDescription
        : windows > 0
          ? `Unlock timed boosts up to ${windows} times per day.`
          : 'Unlock timed boosts throughout the day.'
    return { ...base, title, description, icon: 'timer', icon_color: '#22d3ee' }
  }
  return {
    ...base,
    title: typeof b.player_title === 'string' && b.player_title.trim() ? b.player_title.trim() : 'VIP benefit',
    description: typeof b.player_description === 'string' && b.player_description.trim() ? b.player_description.trim() : '',
    icon: 'arrow-up-circle',
  }
}

export function mergeTierPresentation(tier: VipProgramTier): {
  display: VipDisplay
  benefits: VipBenefit[]
} {
  const key = tier.name.trim().toUpperCase()
  const perks = tier.perks ?? {}
  const apiBenefits = Array.isArray(perks.benefits) ? perks.benefits : []
  const structuredRaw = Array.isArray(tier.tier_benefits) ? [...tier.tier_benefits] : []
  const structured = structuredRaw.filter((b) => {
    if (b.benefit_type !== 'rakeback_boost_schedule') return true
    const cfg = b.config ?? {}
    return cfg.display_to_customer !== false
  })
  structured.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id)
  const fromStructured = structured.map(structuredTierBenefitToCard)
  const baseBenefits = fromStructured.length > 0 ? fromStructured : apiBenefits.length > 0 ? apiBenefits : []
  /** Shown when admin enables scheduled VIP delivery for this tier (`VipProgramPage`). */
  const scheduledBonusCards: VipBenefit[] = []
  if (perks.weekly_bonus_enabled === true) {
    scheduledBonusCards.push({
      title: 'Weekly bonuses',
      description: 'Scheduled VIP-only offers on the weekly cadence.',
      icon: 'gift',
      icon_color: '#c084fc',
      benefit_type: 'vip_scheduled_bonus_weekly',
    })
  }
  if (perks.monthly_bonus_enabled === true) {
    scheduledBonusCards.push({
      title: 'Monthly bonuses',
      description: 'Scheduled VIP-only offers on the monthly cadence.',
      icon: 'gift',
      icon_color: '#22d3ee',
      benefit_type: 'vip_scheduled_bonus_monthly',
    })
  }
  const benefits = [...baseBenefits, ...scheduledBonusCards]
  const display: VipDisplay = {
    ...(FALLBACK_DISPLAY_BY_NAME[key] ?? {}),
    ...perks.display,
  }
  return { display, benefits }
}

const FALLBACK_DISPLAY_BY_NAME: Record<string, VipDisplay> = {
  TADPOLE: {
    header_color: '#898b8a',
    character_image_url:
      'https://storage.googleapis.com/banani-generated-images/generated-images/ef83d3d0-a445-4d27-8cd3-33ddbd1e7ab4.jpg',
    rank_label: 'Rank 1',
  },
  STANDARD: {
    header_color: '#898b8a',
    character_image_url:
      'https://storage.googleapis.com/banani-generated-images/generated-images/ef83d3d0-a445-4d27-8cd3-33ddbd1e7ab4.jpg',
    rank_label: 'Rank 1',
  },
  FISH: {
    header_color: '#898b8a',
    character_image_url:
      'https://storage.googleapis.com/banani-generated-images/generated-images/ef83d3d0-a445-4d27-8cd3-33ddbd1e7ab4.jpg',
    rank_label: 'Rank 1',
  },
  SEAL: {
    header_color: '#b5b318',
    character_image_url:
      'https://storage.googleapis.com/banani-generated-images/generated-images/f71961e7-d1fe-4fed-baab-ddf1721a127d.jpg',
    rank_label: 'Rank 5',
  },
  PIRANHA: {
    header_color: '#0188ef',
    character_image_url:
      'https://storage.googleapis.com/banani-generated-images/generated-images/d48069ca-7344-40dc-9496-71fac363005c.jpg',
    rank_label: 'Rank 10',
  },
  SHARK: {
    header_color: '#f16422',
    character_image_url:
      'https://storage.googleapis.com/banani-generated-images/generated-images/632cae50-02f1-4b30-b233-d3095377e376.jpg',
    rank_label: 'Rank 15',
  },
}

export const VIP_FAQ_GENERAL: { q: string; a: string }[] = [
  {
    q: 'Why is our VIP programme worth it?',
    a: 'We structure rewards around lifetime play so consistent wagering unlocks clearer perks, rakeback boosts, and scheduled bonuses.',
  },
  {
    q: 'How are bonuses calculated?',
    a: 'Weekly and monthly rewards scale with your recent activity. Exact formulas may vary by promotion — check your Rewards hub for live offers.',
  },
  {
    q: 'How do I enter the $25,000 weekly raffle?',
    a: 'When this promotion is active, eligibility rules are posted on the raffle page and in Rewards. Watch announcements for entry windows.',
  },
  {
    q: 'Where can I find updates and community links?',
    a: 'Use the footer links for official channels once your operator publishes them. Live chat can confirm the latest handles.',
  },
  {
    q: 'Is there a dedicated VIP channel?',
    a: 'Higher tiers may unlock private community access depending on operator policy. Ask support if you believe you qualify.',
  },
]

export const VIP_FAQ_BENEFITS: { q: string; a: string }[] = [
  {
    q: 'What is a reload bonus?',
    a: 'A deposit match or top-up offer that credits bonus funds subject to wagering requirements.',
  },
  {
    q: 'What is rakeback?',
    a: 'A return on house edge from your play, often paid as cash or bonus according to programme rules.',
  },
  {
    q: 'When is the monthly bonus scheduled?',
    a: 'Typically assessed around the start of each month based on prior-period activity. Timelines are confirmed in-product.',
  },
  {
    q: 'How do I know how much to wager for the next tier?',
    a: 'Your profile and Rewards hub show lifetime wager and the next threshold once configured for your account.',
  },
  {
    q: 'What rewards do I get when I level up?',
    a: 'Level-up rewards may include cash or bonus credits added to your balance or rewards calendar, per active campaigns.',
  },
  {
    q: 'What can a VIP host do for me?',
    a: 'Hosts can help with tailored offers, limits reviews, and escalation — separate from standard live support queues.',
  },
]
