package affiliate

import "testing"

func TestNormalizeReferralCode(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"  abc12  ", "ABC12"},
		{"ab-c", "AB-C"},
		{"", ""},
		{"   ", ""},
	}
	for _, tt := range tests {
		if got := NormalizeReferralCode(tt.in); got != tt.want {
			t.Errorf("NormalizeReferralCode(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}
