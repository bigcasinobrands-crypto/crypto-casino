package emailpolicy

import (
	"encoding/json"
	"testing"
)

func ptr(b bool) *bool { return &b }

func TestNormalizeDefaultsSubjects(t *testing.T) {
	t.Parallel()
	var raw TransactionalSpec
	raw.Verification.Enabled = ptr(false)
	raw.PasswordReset.Enabled = ptr(false)
	n := Normalize(raw)
	if VerificationEnabled(n) {
		t.Fatal("verification enabled should follow payload")
	}
	if PasswordResetEnabled(n) {
		t.Fatal("password_reset enabled should follow payload")
	}
	if VerificationSubject(n) != DefaultVerificationSubject {
		t.Fatalf("subject default got %q", VerificationSubject(n))
	}
	s := DefaultTransactional()
	s.Verification.Subject = "  Hi  "
	n2 := Normalize(s)
	if VerificationSubject(n2) != "Hi" {
		t.Fatalf("trim subject got %q", VerificationSubject(n2))
	}
}

func TestNormalizePartialPayloadKeepsAuthMailOn(t *testing.T) {
	t.Parallel()
	var in TransactionalSpec
	in.WalletNotifications.DepositCredited = true
	n := Normalize(in)
	if !VerificationEnabled(n) || !PasswordResetEnabled(n) {
		t.Fatalf("auth mail should default on when verification/password_reset omitted")
	}
	if !n.WalletNotifications.DepositCredited {
		t.Fatal("deposit_credited should persist")
	}
}

func TestNormalizeEmptyJSONDoesNotDisableVerification(t *testing.T) {
	t.Parallel()
	var in TransactionalSpec
	if err := json.Unmarshal([]byte("{}"), &in); err != nil {
		t.Fatal(err)
	}
	n := Normalize(in)
	if !VerificationEnabled(n) || !PasswordResetEnabled(n) {
		t.Fatal(`stored JSON "{}" must not zero-out verification/password_reset sends`)
	}
}
