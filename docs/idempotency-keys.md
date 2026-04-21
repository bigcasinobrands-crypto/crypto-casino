# Idempotency key namespaces (FR-DATA-04)

Every money-moving or state-changing operation uses a deterministic idempotency key so that retries and replays never double-count. This document catalogues every namespace in use.

---

## Bonus system

| Key pattern | Purpose | Producer |
|---|---|---|
| `bonus:grant:deposit:{provider_resource_id}:{promotion_version_id}` | Automatic promo grant triggered by a deposit | `bonus/evaluator.go` |
| `bonus:grant:admin:{staff_user_id}:{uuid}` | Manual admin grant (superadmin) | `adminops/bonushub.go` |
| `bonus:auto:{rule_id}:{user_id}:{provider_resource_id}` | Automation-rule grant | `bonus/automation.go` |

### Bonus ledger lines

| Key pattern | Pocket affected | Direction |
|---|---|---|
| `promo.grant:{idempotency_key}` | `bonus_locked` | Credit — funds locked on grant |
| `promo.forfeit:bonus:{instance_id}` | `bonus_locked` | Debit — remaining bonus removed on forfeit |
| `promo.convert:cash:{instance_id}` | `cash` | Credit — real-money credit when WR completed |
| `promo.convert:bonus:{instance_id}` | `bonus_locked` | Debit — bonus removed when converted to cash |

The `{idempotency_key}` in `promo.grant` comes from the grant-level key (`bonus:grant:*`) to tie the ledger line back to the original grant decision.

---

## Fystack (payments)

| Key pattern | Purpose |
|---|---|
| `fystack:deposit:{resource_id}` | Deposit ledger credit |
| `fystack:checkout:{resource_id}` | Checkout ledger credit |
| `fystack:pay:{payment_id}` | Legacy payment ledger credit |
| `fystack:wdr_comp:{provider_id}` | Withdrawal compensation credit (provider confirmed but local state lagged) |
| `fystack:wdr_api_fail:{provider_id}` | Withdrawal API-failure compensation credit |

All Fystack keys are derived from the provider's own resource/payment identifier, guaranteeing at-most-once crediting even if webhooks are delivered multiple times.

---

## BlueOcean (gaming)

| Key pattern | Purpose | Direction |
|---|---|---|
| `bo:debit:{bo_event_id}` | Game bet debit | Debit |
| `bo:credit:{bo_event_id}` | Game win credit | Credit |
| `bo:rollback:{bo_event_id}` | Bet rollback (cancel) | Credit |

`bo_event_id` is the BlueOcean-assigned event identifier, unique per callback. The ledger rejects any duplicate key, so a replayed callback is a no-op.

---

## Webhook deduplication

| Store | Key | Purpose |
|---|---|---|
| `fystack_webhook_deliveries.dedupe_key` | `{event_type}:{resource_id}` | Prevents processing the same Fystack webhook event twice |
| `blueocean_events.provider_event_id` | BlueOcean callback event ID | Prevents processing duplicate BO game callbacks |

Both tables carry a unique constraint on their dedup column; an `INSERT … ON CONFLICT DO NOTHING` pattern guards every handler.

---

## Design invariants

1. **Deterministic** — keys are derived from externally-supplied identifiers (provider resource IDs, event IDs, instance IDs). No UUIDs are generated at write time for idempotency purposes.
2. **Namespace-prefixed** — the colon-delimited prefix (`bonus:`, `fystack:`, `bo:`, `promo.`) prevents collisions across subsystems.
3. **Replay-safe** — any operation can be retried or replayed without side effects as long as the same key is presented.
4. **Audit-friendly** — keys appear in `ledger_entries.idempotency_key` and can be correlated back to the originating webhook delivery or admin action.
