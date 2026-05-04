import type {
  LedgerAccountType,
  LedgerEntryLineType,
  LedgerSide,
} from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';

export interface PostingLineInput {
  accountType: LedgerAccountType;
  userId: string | null;
  currency: string;
  side: LedgerSide;
  amount: Decimal | string | number;
  lineType: LedgerEntryLineType;
  referenceId?: string | null;
  referenceType?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PostTransactionOptions {
  idempotencyKey: string;
  createdBy?: string | null;
  correlationId?: string | null;
  transactionMetadata?: Record<string, unknown>;
  /** Emitted only after ledger rows persist (same DB transaction). */
  domainEvents?: Array<{
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    idempotencyKey?: string;
    schemaVersion?: number;
  }>;
}
