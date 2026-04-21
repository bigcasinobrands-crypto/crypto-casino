# Bonus / VIP QA matrix (staging)

Minimum scenarios before production promotion changes.

| # | Scenario | Expect |
|---|----------|--------|
| E1 | Publish version A; publish conflicting B (same exclusivity key) | HTTP 409 `dedupe_conflict` |
| E2 | VIP + first-deposit same family, different segment fingerprint | Both can be live |
| E3 | Deposit webhook twice (same idempotency key) | Single grant |
| E4 | Two candidates same group, different `priority` | Higher priority wins order |
| E5 | `GET /v1/bonuses/available` with Bearer | JSON `offers` array, rate limited |
| E6 | `GET /v1/vip/status` with Bearer | Tier + points JSON |
| E7 | Admin `GET /v1/admin/users/{id}/facts` | Windows + VIP + risk_summary |
| E8 | Worker VIP accrual after `game.debit` | `vip_point_ledger` row idempotent |

Optional load: exercise `/v1/bonuses/available` and deposit simulation concurrently; watch DB CPU.
