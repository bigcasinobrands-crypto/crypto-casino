/**
 * Short-lived balance hint for the player UI (sessionStorage).
 * Avoids header “€0.00” flashes on reload while /wallet/balance and SSE catch up.
 */
export const PLAYER_WALLET_BALANCE_CACHE_KEY = 'player_wallet_balance_hint_v1'

export type PlayerWalletBalanceCache = {
  userId: string
  balance_minor: number
  cash_minor: number
  bonus_locked_minor: number
  /** Remaining bonus playthrough (minor units); optional for older cached sessions */
  wagering_remaining_minor?: number
  currency: string
}

function isFin(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

export function readPlayerWalletBalanceCache(): PlayerWalletBalanceCache | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(PLAYER_WALLET_BALANCE_CACHE_KEY)
    if (!raw) return null
    const j = JSON.parse(raw) as Partial<PlayerWalletBalanceCache>
    if (typeof j.userId !== 'string' || !j.userId.trim()) return null
    if (!isFin(j.balance_minor)) return null
    const cash = isFin(j.cash_minor) ? j.cash_minor : j.balance_minor
    const bonus = isFin(j.bonus_locked_minor) ? j.bonus_locked_minor : 0
    const currency =
      typeof j.currency === 'string' && j.currency.trim() ? j.currency.trim().toUpperCase() : 'EUR'
    const wagerRem = isFin(j.wagering_remaining_minor) ? j.wagering_remaining_minor : 0
    return {
      userId: j.userId.trim(),
      balance_minor: j.balance_minor,
      cash_minor: cash,
      bonus_locked_minor: bonus,
      wagering_remaining_minor: wagerRem,
      currency,
    }
  } catch {
    return null
  }
}

export function writePlayerWalletBalanceCache(row: PlayerWalletBalanceCache): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(PLAYER_WALLET_BALANCE_CACHE_KEY, JSON.stringify(row))
  } catch {
    /* quota / private mode */
  }
}

export function clearPlayerWalletBalanceCache(): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(PLAYER_WALLET_BALANCE_CACHE_KEY)
  } catch {
    /* ignore */
  }
}
