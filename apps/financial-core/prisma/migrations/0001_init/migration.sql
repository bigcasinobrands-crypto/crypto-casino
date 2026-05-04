-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('DETECTED', 'AWAITING_CONFIRMATIONS', 'READY_TO_CREDIT', 'CREDITED', 'REJECTED', 'SUPERSEDED_BY_REORG');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('USER_CASH', 'USER_BONUS', 'USER_LOCKED', 'USER_CASHBACK', 'USER_RAKEBACK', 'USER_PENDING_WITHDRAWAL', 'PENDING_SETTLEMENT', 'TREASURY_ASSET', 'CASINO_REVENUE', 'SPORTSBOOK_REVENUE', 'BONUS_EXPENSE', 'VIP_EXPENSE', 'CASHBACK_EXPENSE', 'RAKEBACK_EXPENSE', 'AFFILIATE_LIABILITY', 'JACKPOT_POOL', 'CHALLENGE_LIABILITY');

-- CreateEnum
CREATE TYPE "LedgerEntryLineType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'BET_DEBIT', 'WIN_CREDIT', 'STAKE_HOLD', 'SETTLEMENT_RELEASE', 'BONUS_CREDIT', 'BONUS_CONVERSION', 'BONUS_EXPIRY', 'CASHBACK_ISSUANCE', 'RAKEBACK_ISSUANCE', 'VIP_REWARD', 'CHALLENGE_REWARD', 'MANUAL_ADJUSTMENT', 'SWEEP', 'TREASURY_MOVEMENT', 'SPORTSBOOK_BET_DEBIT', 'SPORTSBOOK_WIN_CREDIT', 'SPORTSBOOK_VOID', 'SPORTSBOOK_CASHOUT');

-- CreateEnum
CREATE TYPE "LedgerSide" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "RiskDecision" AS ENUM ('ALLOW', 'BLOCK', 'REVIEW');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('REQUESTED', 'RISK_REVIEW', 'MANUAL_REVIEW', 'APPROVED', 'LEDGER_LOCKED', 'QUEUED', 'SIGNING', 'BROADCAST', 'CONFIRMED', 'FINALIZED', 'REJECTED', 'FAILED', 'CANCELLED', 'STUCK');

-- CreateEnum
CREATE TYPE "BonusStatus" AS ENUM ('CREATED', 'ACTIVE', 'LOCKED', 'WAGERING', 'COMPLETED', 'CONVERTED', 'EXPIRED', 'FORFEITED');

-- CreateEnum
CREATE TYPE "ReconciliationSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "fc_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fc_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_deposits" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "currency" VARCHAR(16) NOT NULL,
    "chain_id" VARCHAR(64) NOT NULL,
    "tx_hash" VARCHAR(128) NOT NULL,
    "log_index" INTEGER NOT NULL DEFAULT 0,
    "amount_minor" BIGINT NOT NULL,
    "confirmations_required" INTEGER NOT NULL,
    "confirmations_observed" INTEGER NOT NULL DEFAULT 0,
    "status" "DepositStatus" NOT NULL,
    "rejection_reason" TEXT,
    "ledger_idempotency_key" TEXT NOT NULL,
    "credited_transaction_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fc_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_ledger_accounts" (
    "id" UUID NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "user_id" UUID,
    "currency" VARCHAR(16) NOT NULL,
    "scope_key" VARCHAR(256) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fc_ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_ledger_transactions" (
    "id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "correlation_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "fc_ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_ledger_entries" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "side" "LedgerSide" NOT NULL,
    "line_type" "LedgerEntryLineType" NOT NULL,
    "reference_id" UUID,
    "reference_type" VARCHAR(64),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "line_number" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fc_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_balance_snapshots" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "balance" DECIMAL(38,18) NOT NULL,
    "snapshot_at" TIMESTAMP(3) NOT NULL,
    "entry_id_cursor" UUID,

    CONSTRAINT "fc_balance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_domain_events" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(128) NOT NULL,
    "aggregate_type" VARCHAR(64) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "idempotency_key" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "causation_id" UUID,
    "correlation_id" UUID,

    CONSTRAINT "fc_domain_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_processed_callbacks" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" VARCHAR(128),
    "response_body" JSONB,
    "http_status" INTEGER,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "fc_processed_callbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_risk_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action_type" VARCHAR(64) NOT NULL,
    "decision" "RiskDecision" NOT NULL,
    "score" DECIMAL(10,4) NOT NULL,
    "reasons" TEXT[],
    "context" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fc_risk_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_withdrawal_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" VARCHAR(16) NOT NULL,
    "destination" TEXT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "provider_tx_hash" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fc_withdrawal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_withdrawal_events" (
    "id" UUID NOT NULL,
    "withdrawal_id" UUID NOT NULL,
    "from_status" "WithdrawalStatus",
    "to_status" "WithdrawalStatus" NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fc_withdrawal_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_bonus_instances" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "BonusStatus" NOT NULL,
    "original_amount" DECIMAL(38,18) NOT NULL,
    "remaining_amount" DECIMAL(38,18) NOT NULL,
    "wagering_multiplier" DECIMAL(10,4) NOT NULL,
    "wagered_toward_requirement" DECIMAL(38,18) NOT NULL DEFAULT 0,
    "game_weights" JSONB NOT NULL DEFAULT '{}',
    "sportsbook_contribution_rules" JSONB NOT NULL DEFAULT '{}',
    "eligible_provider_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fc_bonus_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_audit_log" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID,
    "action" VARCHAR(128) NOT NULL,
    "payload" JSONB NOT NULL,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fc_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_reconciliation_alerts" (
    "id" UUID NOT NULL,
    "alert_type" VARCHAR(64) NOT NULL,
    "severity" "ReconciliationSeverity" NOT NULL,
    "delta" JSONB NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fc_reconciliation_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fc_users_email_key" ON "fc_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "fc_deposits_ledger_idempotency_key_key" ON "fc_deposits"("ledger_idempotency_key");

-- CreateIndex
CREATE INDEX "fc_deposits_user_id_status_idx" ON "fc_deposits"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fc_deposits_chain_id_tx_hash_log_index_key" ON "fc_deposits"("chain_id", "tx_hash", "log_index");

-- CreateIndex
CREATE UNIQUE INDEX "fc_ledger_accounts_scope_key_key" ON "fc_ledger_accounts"("scope_key");

-- CreateIndex
CREATE INDEX "fc_ledger_accounts_user_id_idx" ON "fc_ledger_accounts"("user_id");

-- CreateIndex
CREATE INDEX "fc_ledger_accounts_type_currency_idx" ON "fc_ledger_accounts"("type", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "fc_ledger_transactions_idempotency_key_key" ON "fc_ledger_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "fc_ledger_transactions_created_at_idx" ON "fc_ledger_transactions"("created_at");

-- CreateIndex
CREATE INDEX "fc_ledger_entries_account_id_created_at_idx" ON "fc_ledger_entries"("account_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "fc_ledger_entries_transaction_id_idx" ON "fc_ledger_entries"("transaction_id");

-- CreateIndex
CREATE INDEX "fc_balance_snapshots_account_id_snapshot_at_idx" ON "fc_balance_snapshots"("account_id", "snapshot_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "fc_domain_events_idempotency_key_key" ON "fc_domain_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "fc_domain_events_aggregate_type_aggregate_id_occurred_at_idx" ON "fc_domain_events"("aggregate_type", "aggregate_id", "occurred_at");

-- CreateIndex
CREATE INDEX "fc_domain_events_event_type_occurred_at_idx" ON "fc_domain_events"("event_type", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "fc_processed_callbacks_idempotency_key_key" ON "fc_processed_callbacks"("idempotency_key");

-- CreateIndex
CREATE INDEX "fc_processed_callbacks_provider_processed_at_idx" ON "fc_processed_callbacks"("provider", "processed_at");

-- CreateIndex
CREATE INDEX "fc_risk_events_user_id_created_at_idx" ON "fc_risk_events"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "fc_withdrawal_requests_idempotency_key_key" ON "fc_withdrawal_requests"("idempotency_key");

-- CreateIndex
CREATE INDEX "fc_withdrawal_requests_user_id_status_idx" ON "fc_withdrawal_requests"("user_id", "status");

-- CreateIndex
CREATE INDEX "fc_withdrawal_events_withdrawal_id_created_at_idx" ON "fc_withdrawal_events"("withdrawal_id", "created_at");

-- CreateIndex
CREATE INDEX "fc_bonus_instances_user_id_status_idx" ON "fc_bonus_instances"("user_id", "status");

-- CreateIndex
CREATE INDEX "fc_audit_log_action_created_at_idx" ON "fc_audit_log"("action", "created_at");

-- CreateIndex
CREATE INDEX "fc_reconciliation_alerts_severity_resolved_at_created_at_idx" ON "fc_reconciliation_alerts"("severity", "resolved_at", "created_at");

-- AddForeignKey
ALTER TABLE "fc_deposits" ADD CONSTRAINT "fc_deposits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "fc_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_deposits" ADD CONSTRAINT "fc_deposits_credited_transaction_id_fkey" FOREIGN KEY ("credited_transaction_id") REFERENCES "fc_ledger_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_ledger_accounts" ADD CONSTRAINT "fc_ledger_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "fc_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_ledger_entries" ADD CONSTRAINT "fc_ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "fc_ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_ledger_entries" ADD CONSTRAINT "fc_ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fc_ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_withdrawal_requests" ADD CONSTRAINT "fc_withdrawal_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "fc_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_withdrawal_events" ADD CONSTRAINT "fc_withdrawal_events_withdrawal_id_fkey" FOREIGN KEY ("withdrawal_id") REFERENCES "fc_withdrawal_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_bonus_instances" ADD CONSTRAINT "fc_bonus_instances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "fc_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

