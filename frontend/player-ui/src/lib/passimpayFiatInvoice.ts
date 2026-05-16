import { readApiError } from '../api/errors'
import type { ApiErr } from '../api/errors'

export type FiatInvoiceResult =
  | { ok: true; invoiceUrl: string; orderId?: string }
  | { ok: false; apiErr: ApiErr | null; status: number }

/** POST /v1/wallet/fiat-deposit-invoice — PassimPay createorder type=2 (fiat on-ramp). */
export async function fetchPassimpayFiatInvoiceUrl(
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>,
  amountMinor: number,
  currency = 'USD',
): Promise<FiatInvoiceResult> {
  const res = await apiFetch('/v1/wallet/fiat-deposit-invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount_minor: amountMinor, currency }),
  })
  if (!res.ok) {
    const parsed = await readApiError(res)
    return { ok: false, apiErr: parsed, status: res.status }
  }
  const j = (await res.json()) as { invoice_url?: string; order_id?: string }
  const url = j.invoice_url?.trim()
  if (!url) {
    return { ok: false, apiErr: null, status: res.status }
  }
  return { ok: true, invoiceUrl: url, orderId: j.order_id }
}
