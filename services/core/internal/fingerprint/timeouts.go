package fingerprint

import "time"

// ServerAPIEnrichmentTimeout bounds GET /events/{request_id} during login/session enrichment.
// Matches typical EU Server API latency without blocking the request indefinitely.
const ServerAPIEnrichmentTimeout = 8 * time.Second
