export type VipBenefit = {
  title: string
  description: string
  icon?: string
  icon_color?: string
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
}

/** Structured benefits from GET /v1/vip/program (vip_tier_benefits). */
export type VipTierBenefitStructured = {
  id: number
  benefit_type: string
  sort_order?: number
  promotion_version_id?: number
  player_title?: string
  player_description?: string
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

const BENEFITS_FISH: VipBenefit[] = [
  { title: 'Level Up Rewards', description: 'Straight Cash every level', icon: 'arrow-up-circle', icon_color: '#eab308' },
  { title: 'Daily Dollar Hunts', description: 'Earn XP & get cash rewards', icon: 'zap', icon_color: '#f97316' },
  { title: 'Upgraded Rakeback', description: '3 boosts per day', icon: 'circle-dollar-sign', icon_color: '#22c55e' },
  { title: 'Small Fry', description: 'Keep on swimming', icon: 'sparkles', icon_color: '#60a5fa' },
]

const BENEFITS_SEAL: VipBenefit[] = [
  { title: 'Level Up Rewards', description: 'Straight Cash every level', icon: 'arrow-up-circle', icon_color: '#eab308' },
  { title: 'Daily Dollar Hunts', description: 'Earn XP & get cash rewards', icon: 'zap', icon_color: '#f97316' },
  { title: 'Upgraded Rakeback', description: '3 boosts per day', icon: 'circle-dollar-sign', icon_color: '#22c55e' },
  { title: 'Rain unlocked', description: 'Claim rains for free', icon: 'cloud-rain', icon_color: '#a8a29e' },
]

const BENEFITS_PIRANHA: VipBenefit[] = [
  { title: 'Level Up Rewards', description: 'Straight Cash every level', icon: 'arrow-up-circle', icon_color: '#eab308' },
  { title: 'Daily Dollar Hunts', description: 'Earn XP & get cash rewards', icon: 'zap', icon_color: '#f97316' },
  { title: 'Upgraded Rakeback', description: '3 boosts per day', icon: 'circle-dollar-sign', icon_color: '#22c55e' },
  { title: 'Exclusive Promos', description: 'Look out for messages', icon: 'mail', icon_color: '#ef4444' },
]

const BENEFITS_SHARK: VipBenefit[] = [
  { title: 'Level Up Rewards', description: 'Straight Cash every level', icon: 'arrow-up-circle', icon_color: '#eab308' },
  { title: 'Daily Dollar Hunts', description: 'Earn XP & get cash rewards', icon: 'zap', icon_color: '#f97316' },
  { title: 'Upgraded Rakeback', description: '3 boosts per day', icon: 'circle-dollar-sign', icon_color: '#22c55e' },
  { title: 'Upgraded Weekly', description: 'Empower your bonus', icon: 'trending-up', icon_color: '#14f195' },
]

const FALLBACK_BENEFITS_BY_NAME: Record<string, VipBenefit[]> = {
  FISH: BENEFITS_FISH,
  SEAL: BENEFITS_SEAL,
  PIRANHA: BENEFITS_PIRANHA,
  SHARK: BENEFITS_SHARK,
}

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

function structuredTierBenefitToCard(b: VipTierBenefitStructured): VipBenefit {
  const title =
    (typeof b.player_title === 'string' && b.player_title.trim()) ||
    (b.benefit_type === 'grant_promotion' ? 'Tier unlock reward' : 'Rebate boost')
  const description =
    (typeof b.player_description === 'string' && b.player_description.trim()) ||
    (b.benefit_type === 'grant_promotion'
      ? 'Bonus when you reach this tier (subject to offer rules and checks).'
      : 'Extra rebate percentage on the matching rewards programme.')
  const icon =
    b.benefit_type === 'grant_promotion' ? 'sparkles' : b.benefit_type === 'rebate_percent_add' ? 'circle-dollar-sign' : 'arrow-up-circle'
  return { title, description, icon, icon_color: '#c084fc' }
}

export function mergeTierPresentation(tier: VipProgramTier): {
  display: VipDisplay
  benefits: VipBenefit[]
} {
  const key = tier.name.trim().toUpperCase()
  const fallbackBenefits = FALLBACK_BENEFITS_BY_NAME[key] ?? []
  const perks = tier.perks ?? {}
  const apiBenefits = Array.isArray(perks.benefits) ? perks.benefits : []
  const structured = Array.isArray(tier.tier_benefits) ? tier.tier_benefits : []
  const fromStructured = structured.length > 0 ? structured.map(structuredTierBenefitToCard) : []
  const benefits =
    fromStructured.length > 0 ? fromStructured : apiBenefits.length > 0 ? apiBenefits : fallbackBenefits
  const display: VipDisplay = {
    ...(FALLBACK_DISPLAY_BY_NAME[key] ?? {}),
    ...perks.display,
  }
  return { display, benefits }
}

const FALLBACK_DISPLAY_BY_NAME: Record<string, VipDisplay> = {
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
