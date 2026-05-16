/** Fiat invoice currencies supported for PassimPay createorder type=2 (`symbol`, ISO 4217). */
export const FIAT_DEPOSIT_CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'] as const

export type FiatDepositCurrencyCode = (typeof FIAT_DEPOSIT_CURRENCY_CODES)[number]

export function isFiatDepositCurrencyCode(v: string): v is FiatDepositCurrencyCode {
  return (FIAT_DEPOSIT_CURRENCY_CODES as readonly string[]).includes(v)
}
