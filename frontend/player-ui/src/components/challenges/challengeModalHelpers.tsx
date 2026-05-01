import type { VipProgramTier } from '../../lib/vipPresentation'
import type { PlayerChallengeListItem } from './playerChallengeTypes'

/** Currencies we display with a leading $ (stablecoins / USD-priced tokens). */
const USD_LIKE = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDP', 'FDUSD'])

export function formatUsdMinor(minor: number, currency = 'USDT'): string {
  const v = typeof minor === 'number' && Number.isFinite(minor) ? minor : 0
  const major = v / 100
  const cur = (currency || 'USDT').trim().toUpperCase() || 'USDT'
  const formatted = major.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (USD_LIKE.has(cur)) {
    const suffix = cur === 'USDT' ? '' : ` ${cur}`
    return `$${formatted}${suffix}`
  }
  return `${formatted} ${cur}`.trim()
}

export function prizeLabel(c: PlayerChallengeListItem): { label: string; cash: boolean } {
  if (c.prize_type === 'cash' && typeof c.prize_amount_minor === 'number') {
    return { label: formatUsdMinor(c.prize_amount_minor, c.prize_currency ?? 'USDT'), cash: true }
  }
  if (c.prize_type === 'free_spins') return { label: 'Free spins', cash: false }
  if (c.prize_type === 'bonus') return { label: 'Bonus credit', cash: false }
  return { label: c.prize_type.replace(/_/g, ' '), cash: false }
}

export function formatPayoutRail(key?: string): string | null {
  const k = key?.trim()
  if (!k) return null
  const u = k.toUpperCase()
  const i = u.indexOf('_')
  if (i > 0) return `${u.slice(0, i)} · ${u.slice(i + 1)}`
  return u
}

export function parseTimeMs(iso: string): number {
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : NaN
}

/** Before start: show live countdown. Server still enforces starts_at/ends_at on enter. */
export function shouldShowStartCountdown(c: PlayerChallengeListItem, nowMs: number): boolean {
  if (c.my_entry) return false
  const starts = parseTimeMs(c.starts_at)
  const ends = parseTimeMs(c.ends_at)
  if (!Number.isFinite(starts) || !Number.isFinite(ends)) return false
  if (nowMs >= starts || nowMs >= ends) return false
  return true
}

export function msUntilStart(c: PlayerChallengeListItem, nowMs: number): number {
  const starts = parseTimeMs(c.starts_at)
  if (!Number.isFinite(starts)) return 0
  return Math.max(0, starts - nowMs)
}

export function canJoinChallengeInUi(c: PlayerChallengeListItem, nowMs: number): boolean {
  if (c.my_entry) return false
  const starts = parseTimeMs(c.starts_at)
  const ends = parseTimeMs(c.ends_at)
  if (!Number.isFinite(starts) || !Number.isFinite(ends)) return false
  if (nowMs < starts || nowMs >= ends) return false
  const st = c.status?.toLowerCase() ?? ''
  return st === 'active' || st === 'scheduled'
}

export function firstCatalogGameId(gameIds?: string[]): string | null {
  if (!Array.isArray(gameIds)) return null
  for (const x of gameIds) {
    const t = String(x).trim()
    if (t) return t
  }
  return null
}

/** True if the challenge lists at least one catalog id that matches this lobby (id or id_hash). */
export function challengeLinkedToCatalogKeys(c: PlayerChallengeListItem, allowedKeys: ReadonlySet<string>): boolean {
  if (allowedKeys.size === 0) return false
  const ids = c.game_ids
  if (!Array.isArray(ids) || ids.length === 0) return false
  for (const x of ids) {
    const t = String(x).trim()
    if (t && allowedKeys.has(t)) return true
  }
  return false
}

export function formatStartsInCountdown(ms: number): string {
  if (ms <= 0) return '0:00:00'
  const sec = Math.floor(ms / 1000)
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

/**
 * Challenge is in its playable time window and still open for join/play in the API model.
 * Includes `scheduled` so UI stays correct until the server promotes to `active` (avoids vanishing at starts_at).
 */
export function isChallengeInPlayableWindow(c: PlayerChallengeListItem, nowMs: number): boolean {
  const st = (c.status ?? '').trim().toLowerCase()
  if (st !== 'active' && st !== 'scheduled') return false
  const starts = parseTimeMs(c.starts_at)
  const ends = parseTimeMs(c.ends_at)
  if (!Number.isFinite(starts) || !Number.isFinite(ends)) return false
  return nowMs >= starts && nowMs < ends
}

/** Time remaining until `ends_at` (e.g. "2d 14h 30m"). Shows "Ended" when past end. */
export function formatEndsCountdown(iso: string, nowMs: number): string {
  const end = parseTimeMs(iso)
  if (!Number.isFinite(end)) return '—'
  const msLeft = end - nowMs
  if (msLeft <= 0) return 'Ended'
  const sec = Math.floor(msLeft / 1000)
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function resolveVipTierMeta(vipTiers: VipProgramTier[], vipTierMinimum?: string) {
  const raw = vipTierMinimum?.trim()
  const id = raw ? Number.parseInt(raw, 10) : NaN
  const tier = Number.isFinite(id) ? vipTiers.find((t) => t.id === id) : undefined
  const color = tier?.perks?.display?.header_color?.trim() || '#7b61ff'
  return { tier, color, label: tier?.name?.trim() ? `VIP · ${tier.name}` : 'VIP' }
}

export function ChallengeThumbBadgeStack({
  challenge,
  vipTiers,
}: {
  challenge: PlayerChallengeListItem
  vipTiers: VipProgramTier[]
}) {
  const showFeatured = challenge.is_featured === true
  const showVip = challenge.vip_only === true
  if (!showFeatured && !showVip) return null

  const { color: vipColor, label: vipLabel } = resolveVipTierMeta(vipTiers, challenge.vip_tier_minimum)
  const featuredText = (challenge.badge_label?.trim() || 'Featured').toUpperCase()

  return (
    <div className="pointer-events-none absolute right-2 top-2 z-10 flex max-w-[min(10rem,calc(100%-1rem))] flex-col items-end gap-0.5">
      {showVip ? (
        <span
          className="rounded-casino-sm px-1.5 py-0.5 text-[9px] font-extrabold uppercase leading-tight text-white shadow-[0_1px_8px_rgba(0,0,0,0.45)] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]"
          style={{ backgroundColor: vipColor }}
        >
          {vipLabel}
        </span>
      ) : null}
      {showFeatured ? (
        <span className="rounded-casino-sm bg-black/70 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-tight text-white ring-1 ring-white/15 backdrop-blur-sm">
          {featuredText}
        </span>
      ) : null}
    </div>
  )
}

export function formatChallengeEndAt(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
