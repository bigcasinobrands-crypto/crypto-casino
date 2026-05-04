package fingerprint

import (
	"testing"
)

func TestLedgerMetaFromEvent_exampleDocShape(t *testing.T) {
	root := map[string]any{
		"products": map[string]any{
			"identification": map[string]any{
				"data": map[string]any{
					"visitorId": "Ibk1527CUFmcnjLwIs4A9",
					"requestId": "1708102555327.NLOjmg",
					"ip":        "61.127.217.15",
					"ipLocation": map[string]any{
						"country": map[string]any{
							"code": "DE",
						},
						"city": "Berlin",
					},
					"confidence": map[string]any{
						"score": 0.99,
					},
					"replayed": false,
				},
			},
		},
	}
	m := LedgerMetaFromEvent(root)
	if m["visitor_id"] != "Ibk1527CUFmcnjLwIs4A9" {
		t.Fatalf("visitor_id: %v", m["visitor_id"])
	}
	if m["fingerprint_request_id"] != "1708102555327.NLOjmg" {
		t.Fatalf("fingerprint_request_id: %v", m["fingerprint_request_id"])
	}
	if m["geo_country"] != "DE" {
		t.Fatalf("geo_country: %v", m["geo_country"])
	}
	if m["ip_address"] != "61.127.217.15" {
		t.Fatalf("ip_address: %v", m["ip_address"])
	}
}

func TestLedgerMetaFromEvent_serverAPIv4FlatShape(t *testing.T) {
	root := map[string]any{
		"linked_id": "campaign-1",
		"event_id":  "1708102555327.NLOjmg",
		"ip_address": "61.127.217.15",
		"browser_details": map[string]any{
			"device": "smartphone",
		},
		"identification": map[string]any{
			"visitor_id": "Ibk1527CUFmcnjLwIs4A9",
			"confidence": map[string]any{
				"score": 0.97,
			},
		},
		"replayed":  false,
		"incognito": false,
		"ip_info": map[string]any{
			"v4": map[string]any{
				"geolocation": map[string]any{
					"city_name":    "Berlin",
					"country_code": "DE",
					"subdivisions": []any{
						map[string]any{"iso_code": "BE", "name": "Berlin"},
					},
				},
			},
		},
	}
	m := LedgerMetaFromEvent(root)
	if m["visitor_id"] != "Ibk1527CUFmcnjLwIs4A9" {
		t.Fatalf("visitor_id: %v", m["visitor_id"])
	}
	if m["fingerprint_request_id"] != "1708102555327.NLOjmg" {
		t.Fatalf("fingerprint_request_id: %v", m["fingerprint_request_id"])
	}
	if m["geo_country"] != "DE" {
		t.Fatalf("geo_country: %v", m["geo_country"])
	}
	if m["geo_city"] != "Berlin" {
		t.Fatalf("geo_city: %v", m["geo_city"])
	}
	if m["linked_id"] != "campaign-1" {
		t.Fatalf("linked_id: %v", m["linked_id"])
	}
}
