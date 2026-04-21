/**
 * Deposit channel ids in bonus rules `trigger.channels` must match
 * `PaymentSettled.channel` from Fystack webhooks (empty = any channel).
 */
export const DEPOSIT_CHANNEL_OPTIONS: { id: string; label: string }[] = [
  { id: 'on_chain_deposit', label: 'On-chain deposit' },
  { id: 'hosted_checkout', label: 'Hosted checkout' },
]
