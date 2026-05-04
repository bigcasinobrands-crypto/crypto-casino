import type { LedgerAccountType } from '@prisma/client';

/** Stable unique key per ledger pocket — avoids Postgres UNIQUE(NULL) pitfalls for system accounts. */
export function ledgerScopeKey(
  type: LedgerAccountType,
  currency: string,
  userId: string | null,
): string {
  const ccy = currency.toUpperCase();
  if (userId) {
    return `user:${userId}:${type}:${ccy}`;
  }
  return `system:${type}:${ccy}`;
}
