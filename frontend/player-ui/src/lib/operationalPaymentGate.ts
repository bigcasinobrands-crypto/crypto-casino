import type { OperationalHealth } from '../hooks/useOperationalHealth'

/**
 * Payment / bonus toggles from GET /health/operational.
 * When the field is missing (older API) or payload not loaded yet, default permissive so we do not
 * blank the wallet on transient errors. {@link operationalRealPlayEnabled} matches legacy behaviour.
 */
export function operationalDepositsEnabled(data: OperationalHealth | null | undefined): boolean {
  return data?.deposits_enabled !== false
}

export function operationalWithdrawalsEnabled(data: OperationalHealth | null | undefined): boolean {
  return data?.withdrawals_enabled !== false
}

export function operationalBonusesEnabled(data: OperationalHealth | null | undefined): boolean {
  return data?.bonuses_enabled !== false
}

/** When missing (no payload yet), do not block catalog play; explicit false disables real-money launch. */
export function operationalRealPlayEnabled(data: OperationalHealth | null | undefined): boolean {
  return data?.real_play_enabled !== false
}

export function resolveWalletModalTab(
  requested: 'deposit' | 'withdraw',
  data: OperationalHealth | null | undefined,
): 'deposit' | 'withdraw' {
  const dep = operationalDepositsEnabled(data)
  const wit = operationalWithdrawalsEnabled(data)
  if (requested === 'deposit' && !dep && wit) return 'withdraw'
  if (requested === 'withdraw' && !wit && dep) return 'deposit'
  return requested
}
