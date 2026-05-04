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
