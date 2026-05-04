package adminops

import "testing"

func TestCountryFromLocale(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"en-GB", "GB"},
		{"ro-RO", "RO"},
		{"pt-BR", "BR"},
		{"en", ""},
		{"zh-CN", "CN"},
		{"", ""},
	}
	for _, tt := range tests {
		got := countryFromLocale(tt.in)
		if got != tt.want {
			t.Errorf("countryFromLocale(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}
