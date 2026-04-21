package bonus

import (
	"testing"
)

func TestEligibilityFingerprintStable(t *testing.T) {
	raw := []byte(`{"trigger":{"type":"deposit","first_deposit_only":true,"nth_deposit":0,"channels":["card"]},"reward":{"type":"percent_match","percent":100,"cap_minor":50000},"segment":{"vip_min_tier":0,"tags":["a","b"],"country_allow":["US"]}}`)
	fp1, err := EligibilityFingerprintHex(raw, "percent_match")
	if err != nil {
		t.Fatal(err)
	}
	fp2, err := EligibilityFingerprintHex(raw, "percent_match")
	if err != nil {
		t.Fatal(err)
	}
	if fp1 != fp2 {
		t.Fatalf("fingerprint not stable: %s vs %s", fp1, fp2)
	}
}

func TestExclusivityKey(t *testing.T) {
	if ExclusivityKey("grp1", "x", "fp") != "g:grp1" {
		t.Fatal()
	}
	if ExclusivityKey("", "fam", "fp") != "f:fam|fp" {
		t.Fatal()
	}
}
