/**
 * `PaymentSettled.channel` value emitted when PassimPay settles and credits the player ledger.
 * Admin “simulate deposit bonus” uses this so evaluation matches production deposit bonuses.
 */
export const SIMULATE_PAYMENT_SETTLED_CHANNEL = 'on_chain_deposit' as const
