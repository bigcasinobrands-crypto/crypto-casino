package adminops

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// HardDeletePlayerTx permanently removes a player and dependent rows that would
// otherwise violate FK constraints or append-only triggers. Must run inside an
// outer transaction (caller supplies tx).
func HardDeletePlayerTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID) error {
	if _, err := tx.Exec(ctx, `
		DELETE FROM affiliate_commission_grants
		WHERE partner_id IN (SELECT id FROM affiliate_partners WHERE user_id = $1)
	`, userID); err != nil {
		return fmt.Errorf("affiliate_commission_grants: %w", err)
	}

	if _, err := tx.Exec(ctx, `ALTER TABLE bonus_audit_log DISABLE TRIGGER bonus_audit_log_no_delete`); err != nil {
		return fmt.Errorf("bonus_audit_log disable trigger: %w", err)
	}
	defer func() {
		_, _ = tx.Exec(ctx, `ALTER TABLE bonus_audit_log ENABLE TRIGGER bonus_audit_log_no_delete`)
	}()
	if _, err := tx.Exec(ctx, `DELETE FROM bonus_audit_log WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("bonus_audit_log: %w", err)
	}

	if _, err := tx.Exec(ctx, `DELETE FROM ledger_entries WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("ledger_entries: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM free_spin_grants WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("free_spin_grants: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM user_bonus_instances WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("user_bonus_instances: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM promo_redemptions WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("promo_redemptions: %w", err)
	}

	if _, err := tx.Exec(ctx, `DELETE FROM chat_mutes WHERE user_id = $1 OR muted_by = $1`, userID); err != nil {
		return fmt.Errorf("chat_mutes: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM chat_bans WHERE user_id = $1 OR banned_by = $1`, userID); err != nil {
		return fmt.Errorf("chat_bans: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM chat_messages WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("chat_messages: %w", err)
	}

	if _, err := tx.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID); err != nil {
		return fmt.Errorf("users: %w", err)
	}
	return nil
}
