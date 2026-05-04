package config

import "testing"

func TestNormalizeFingerprintBaseURL(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"", "https://api.fpjs.io"},
		{"  ", "https://api.fpjs.io"},
		{"https://eu.api.fpjs.io", "https://eu.api.fpjs.io"},
		{"https://eu.api.fpjs.io/", "https://eu.api.fpjs.io"},
		{"eu.api.fpjs.io", "https://eu.api.fpjs.io"},
		{"http://localhost:9999", "http://localhost:9999"},
	}
	for _, tc := range cases {
		if g := normalizeFingerprintBaseURL(tc.in); g != tc.want {
			t.Fatalf("normalizeFingerprintBaseURL(%q) = %q, want %q", tc.in, g, tc.want)
		}
	}
}
