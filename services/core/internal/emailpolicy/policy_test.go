package emailpolicy

import "testing"

func TestNormalizeDefaultsSubjects(t *testing.T) {
	t.Parallel()
	var raw TransactionalSpec
	raw.Verification.Enabled = false
	raw.PasswordReset.Enabled = false
	n := Normalize(raw)
	if n.Verification.Enabled {
		t.Fatal("verification enabled should follow payload")
	}
	if n.PasswordReset.Enabled {
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
