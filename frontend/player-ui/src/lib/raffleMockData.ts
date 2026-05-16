/** Static raffle demo data until `/v1/raffles/*` APIs exist. */

export type PrizeBadgeTier = 'gold' | 'silver' | 'bronze' | 'normal'

export type RaffleTopPrize = {
  rank: number
  amountUsd: number
  badge: PrizeBadgeTier
  username: string
}

export type ExtendedWinner = {
  rank: number
  amountUsd: number
  username: string
}

export const RAFFLE_ASSET_PATHS = {
  heroGraphic: '/raffle/hero-graphic.png',
  goldenTicket: '/raffle/golden-ticket.jpg',
} as const

/** Mock wallet-style balance shown on the purchase panel (Gold). */
export const MOCK_REWARDS_GOLD_BALANCE = 1250

/** Earned raffle tickets for the current period (demo). */
export const MOCK_USER_TICKET_COUNT = 0

/** Slider max — demo purchase quantity cap. */
export const MOCK_MAX_PURCHASE_TICKETS = 1500

/** Linear demo pricing: Gold spent per ticket when buying with rewards balance. */
export const MOCK_GOLD_PER_TICKET = 42

export const MOCK_EXTRA_WINNERS_COUNT = 90

export const MOCK_TOP_PRIZES: RaffleTopPrize[] = [
  { rank: 1, amountUsd: 2500, badge: 'gold', username: 'Satoshi' },
  { rank: 2, amountUsd: 1800, badge: 'silver', username: 'Satoshi' },
  { rank: 3, amountUsd: 1250, badge: 'bronze', username: 'Satoshi' },
  { rank: 4, amountUsd: 1130, badge: 'normal', username: 'OscarGr…' },
  { rank: 5, amountUsd: 1000, badge: 'normal', username: 'smooyal…' },
  { rank: 6, amountUsd: 875, badge: 'normal', username: 'Satoshi' },
  { rank: 7, amountUsd: 750, badge: 'normal', username: 'Satoshi' },
  { rank: 8, amountUsd: 625, badge: 'normal', username: 'Satoshi' },
  { rank: 9, amountUsd: 500, badge: 'normal', username: 'crazytl…' },
  { rank: 10, amountUsd: 375, badge: 'normal', username: 'Satoshi' },
]

export type ApiRafflePrizeRow = {
  rank_order: number
  amount_minor: number
  currency: string
  prize_type: string
  winner_slots?: number
}

/** Format ledger minor units with currency code (best-effort Intl). */
export function formatPrizeMinor(amountMinor: number, currency: string): string {
  const ccy = currency.trim().toUpperCase() || 'USD'
  const major = amountMinor / 100
  if (!Number.isFinite(major)) return '—'
  try {
    const canon = ccy === 'USDT' || ccy === 'USDC' ? 'USD' : ccy
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: canon.length === 3 ? canon : 'USD',
      maximumFractionDigits: 2,
    }).format(major)
  } catch {
    return `${major.toFixed(2)} ${ccy}`
  }
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}


export function computePurchaseCostGold(ticketCount: number): number {
  return Math.round(ticketCount * MOCK_GOLD_PER_TICKET)
}

export function generateExtendedWinners(fromRank = 11, toRank = 100): ExtendedWinner[] {
  const base = 355
  return Array.from({ length: toRank - fromRank + 1 }, (_, i) => {
    const rank = fromRank + i
    const amountUsd = Math.max(25, Math.round(base - i * 3.6))
    const raw = `player${((rank * 7919) % 99999).toString().padStart(5, '0')}`
    const username = raw.length > 8 ? `${raw.slice(0, 7)}…` : raw
    return { rank, amountUsd, username }
  })
}
