/**
 * Production BullMQ queue names — **granular** streams for SLO/alerting per stage.
 * Register in `BullQueuesModule`: one queue = one independent retry/DLQ policy.
 */

export const Q_DEPOSIT_DETECTED = 'deposit.detected';
export const Q_DEPOSIT_CONFIRMATION = 'deposit.confirmation';
export const Q_DEPOSIT_CREDIT = 'deposit.credit';

export const Q_WITHDRAWAL_RISK = 'withdrawal.risk';
export const Q_WITHDRAWAL_LOCK = 'withdrawal.lock';
export const Q_WITHDRAWAL_SIGN = 'withdrawal.sign';
export const Q_WITHDRAWAL_BROADCAST = 'withdrawal.broadcast';
export const Q_WITHDRAWAL_CONFIRMATION = 'withdrawal.confirmation';

export const Q_BLUEOCEAN_CALLBACK = 'blueocean.callback';

export const Q_WAGERING_PROCESS = 'wagering.process';
export const Q_BONUS_PROCESS = 'bonus.process';
export const Q_VIP_PROCESS = 'vip.process';
export const Q_CASHBACK_PROCESS = 'cashback.process';
export const Q_RAKEBACK_PROCESS = 'rakeback.process';
export const Q_CHALLENGE_PROCESS = 'challenge.process';

export const Q_TREASURY_SWEEP = 'treasury.sweep';
export const Q_TREASURY_REBALANCE = 'treasury.rebalance';
export const Q_TREASURY_GAS_REFILL = 'treasury.gas-refill';

export const Q_RECONCILIATION_RUN = 'reconciliation.run';
export const Q_ANALYTICS_PROJECT = 'analytics.project';
export const Q_NOTIFICATIONS_DISPATCH = 'notifications.dispatch';
export const Q_RISK_ASYNC = 'risk.async';

/** Default set wired in `bull-queues.module.ts` — extend when workers go live. */
export const ALL_QUEUES = [
  Q_DEPOSIT_DETECTED,
  Q_DEPOSIT_CONFIRMATION,
  Q_DEPOSIT_CREDIT,
  Q_WITHDRAWAL_RISK,
  Q_WITHDRAWAL_LOCK,
  Q_WITHDRAWAL_SIGN,
  Q_WITHDRAWAL_BROADCAST,
  Q_WITHDRAWAL_CONFIRMATION,
  Q_BLUEOCEAN_CALLBACK,
  Q_WAGERING_PROCESS,
  Q_BONUS_PROCESS,
  Q_VIP_PROCESS,
  Q_CASHBACK_PROCESS,
  Q_RAKEBACK_PROCESS,
  Q_CHALLENGE_PROCESS,
  Q_TREASURY_SWEEP,
  Q_TREASURY_REBALANCE,
  Q_TREASURY_GAS_REFILL,
  Q_RECONCILIATION_RUN,
  Q_ANALYTICS_PROJECT,
  Q_NOTIFICATIONS_DISPATCH,
  Q_RISK_ASYNC,
] as const;
