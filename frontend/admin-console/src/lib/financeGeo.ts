/** Response shape for GET /v1/admin/analytics/finance-geo */

export type FinanceGeoCoverage = {
  total_lines: number
  fingerprint_ledger_lines: number
  traffic_session_lines: number
  ledger_explicit_lines: number
  unknown_source_lines: number
  unknown_country_lines: number
  country_resolved_pct: number
}

export type FinanceGeoRow = {
  iso2: string
  name: string
  currency: string
  deposits_minor: number
  withdrawals_minor: number
  net_minor: number
  deposit_lines: number
  withdrawal_lines: number
}

export type FinanceGeoPayload = {
  period: string
  notes?: string
  rows: FinanceGeoRow[]
  coverage: FinanceGeoCoverage
}

const zeroCoverage = (): FinanceGeoCoverage => ({
  total_lines: 0,
  fingerprint_ledger_lines: 0,
  traffic_session_lines: 0,
  ledger_explicit_lines: 0,
  unknown_source_lines: 0,
  unknown_country_lines: 0,
  country_resolved_pct: 0,
})

/** Matches server zero payload when analytics display is suppressed (no DB deletes). */
export function emptyFinanceGeoPayload(periodLabel: string): FinanceGeoPayload {
  return {
    period: periodLabel,
    notes: 'display_suppressed',
    rows: [],
    coverage: zeroCoverage(),
  }
}
