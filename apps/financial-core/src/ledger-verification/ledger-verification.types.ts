import type { Decimal } from 'decimal.js';

export type Decimalish = string | number | Decimal;

export type VerificationRequiredAction =
  | 'NONE'
  | 'BLOCK'
  | 'RETRY'
  | 'MANUAL_REVIEW';

export type VerificationRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Every money-adjacent gate returns this shape — **never** proceed on `allowed: false`
 * without explicit policy (e.g. manual review queue).
 */
export interface LedgerVerificationResult {
  allowed: boolean;
  reason: string;
  ledgerState: Record<string, unknown>;
  requiredAction: VerificationRequiredAction;
  riskLevel: VerificationRiskLevel;
}

export function allow(
  reason: string,
  ledgerState: Record<string, unknown>,
  riskLevel: VerificationRiskLevel = 'LOW',
): LedgerVerificationResult {
  return {
    allowed: true,
    reason,
    ledgerState,
    requiredAction: 'NONE',
    riskLevel,
  };
}

export function deny(
  reason: string,
  ledgerState: Record<string, unknown>,
  requiredAction: VerificationRequiredAction,
  riskLevel: VerificationRiskLevel,
): LedgerVerificationResult {
  return {
    allowed: false,
    reason,
    ledgerState,
    requiredAction,
    riskLevel,
  };
}

