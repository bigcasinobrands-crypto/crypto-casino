package blueocean

import (
	"encoding/json"
	"testing"
)

func TestLaunchPayloadOK(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want bool
	}{
		{
			name: "bog invalid credentials envelope",
			raw:  `{"error":1,"message":"Invalid user details!"}`,
			want: false,
		},
		{
			name: "success false",
			raw:  `{"success":false,"message":"bad"}`,
			want: false,
		},
		{
			name: "nested response error",
			raw:  `{"error":0,"response":{"error":2}}`,
			want: false,
		},
		{
			name: "error zero with url",
			raw:  `{"error":0,"game_url":"https://example.com/play"}`,
			want: true,
		},
		{
			name: "no error field url only",
			raw:  `{"game_url":"https://example.com/play"}`,
			want: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw := json.RawMessage(tt.raw)
			got := LaunchPayloadOK(raw)
			if got != tt.want {
				t.Fatalf("LaunchPayloadOK(...) = %v, want %v", got, tt.want)
			}
		})
	}
}
