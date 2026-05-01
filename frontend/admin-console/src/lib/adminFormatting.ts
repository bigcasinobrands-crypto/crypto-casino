/** Maps API / config keys to short, human-readable labels for non-technical staff. */
const KEY_LABELS: Record<string, string> = {
  user_id: 'Player ID',
  amount_minor: 'Amount (minor units)',
  currency: 'Currency',
  channel: 'Payment channel',
  provider_resource_id: 'Provider reference',
  country: 'Country',
  deposit_index: 'Deposit number',
  first_deposit: 'First deposit',
  dry_run: 'Preview only',
  promotion_matches: 'Matching promotions',
  ok: 'Completed',
  inserted: 'Grant result',
  grants_paused: 'Grants paused',
  bog_configured: 'Blue Ocean connected',
  last_sync_at: 'Last catalog sync',
  last_sync_error: 'Last sync error',
  last_sync_upserted: 'Games last synced',
  last_sync_currency: 'Sync currency',
  maintenance_mode: 'Maintenance mode',
  disable_game_launch: 'Game launch disabled',
  blueocean_launch_mode: 'Blue Ocean launch mode',
  tier_id: 'Tier',
  from_tier_id: 'Previous tier',
  to_tier_id: 'New tier',
  lifetime_wager_minor: 'Lifetime wager (minor)',
  rebate_program_key: 'Rebate program',
  percent_add: 'Extra percent',
  grant_amount_minor: 'Grant amount (minor)',
}

export function humanFieldLabel(key: string): string {
  return KEY_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function fmtScalar(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return '[details]'
  return String(v)
}

function formatPercent(value: unknown, maxFractionDigits = 2): string {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n)) return '?'
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(n)
}

/** One-line summary for reward_programs.config (and similar flat maps). */
export function formatFlatConfig(config: Record<string, unknown> | undefined | null): string {
  if (!config || typeof config !== 'object') return '—'
  const entries = Object.entries(config)
  if (entries.length === 0) return '—'
  return entries.map(([k, v]) => `${humanFieldLabel(k)}: ${fmtScalar(v)}`).join(' · ')
}

/** VIP tier activity meta column — short text instead of JSON. */
export function formatTierEventMeta(meta: Record<string, unknown> | undefined | null): string {
  if (!meta || Object.keys(meta).length === 0) return '—'
  return Object.entries(meta)
    .map(([k, v]) => `${humanFieldLabel(k)}: ${fmtScalar(v)}`)
    .join(' · ')
}

export function formatVipBenefitDetail(b: {
  benefit_type: string
  promotion_version_id?: number
  config: Record<string, unknown>
}): string {
  if (b.benefit_type === 'grant_promotion') {
    return `Unlock: promotion version ${b.promotion_version_id ?? '—'}`
  }
  if (b.benefit_type === 'rebate_percent_add') {
    const key =
      typeof b.config.rebate_program_key === 'string' ? b.config.rebate_program_key : ''
    const pctStr = formatPercent(b.config.percent_add)
    if (key) return `Extra ${pctStr}% on “${key}” rebate`
    return `Extra ${pctStr}% rebate`
  }
  if (b.benefit_type === 'vip_card_feature') {
    const icon = typeof b.config.icon_key === 'string' ? b.config.icon_key : 'sparkles'
    const title = typeof b.config.title === 'string' ? b.config.title : ''
    const subtitle = typeof b.config.subtitle === 'string' ? b.config.subtitle : ''
    return `Card row: ${icon}${title ? ` · ${title}` : ''}${subtitle ? ` — ${subtitle}` : ''}`
  }
  if (b.benefit_type === 'rakeback_boost_schedule') {
    const key = typeof b.config.rebate_program_key === 'string' ? b.config.rebate_program_key : ''
    const boost = formatPercent(b.config.boost_percent_add)
    const windows = Array.isArray(b.config.windows) ? b.config.windows.length : 0
    return `Timed boost +${boost}%${key ? ` on "${key}"` : ''}${windows > 0 ? ` · ${windows} window(s)/day` : ''}`
  }
  return b.benefit_type.replace(/_/g, ' ')
}

export function mergeVipTierPerksFromForm(
  base: Record<string, unknown>,
  ui: {
    showOnPublicPage: boolean
    headerColor: string
    imageUrl: string
    rankLabel: string
    weeklyBonusEnabled?: boolean
    monthlyBonusEnabled?: boolean
  },
): Record<string, unknown> {
  const prevDisplay =
    base.display && typeof base.display === 'object' && !Array.isArray(base.display)
      ? { ...(base.display as Record<string, unknown>) }
      : {}
  return {
    ...base,
    hide_from_public_page: !ui.showOnPublicPage,
    ...(typeof ui.weeklyBonusEnabled === 'boolean' ? { weekly_bonus_enabled: ui.weeklyBonusEnabled } : {}),
    ...(typeof ui.monthlyBonusEnabled === 'boolean' ? { monthly_bonus_enabled: ui.monthlyBonusEnabled } : {}),
    display: {
      ...prevDisplay,
      header_color: ui.headerColor.trim(),
      character_image_url: ui.imageUrl.trim(),
      rank_label: ui.rankLabel.trim(),
    },
  }
}
