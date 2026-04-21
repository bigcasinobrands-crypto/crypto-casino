# Staging E2E smoke test plan (NFR-TEST)

All tests run against the staging environment with test-only credentials. No real funds are involved.

---

## 1. Deposit → Grant → Bet → WR flow (critical path)

**Objective:** Verify the full bonus lifecycle from deposit through wagering-requirement completion.

| Step | Action | Expected result |
|---|---|---|
| 1 | Create a test user via registration endpoint | User row created, `cash` pocket = 0 |
| 2 | Trigger a Fystack deposit webhook (`event_type: payment.completed`, test `resource_id`) | `ledger_entries` credit with key `fystack:deposit:{resource_id}`; user `cash` pocket incremented |
| 3 | Verify bonus auto-granted | `user_bonus_instances` row with `status = active`; `bonus_locked` pocket credited via `promo.grant:bonus:grant:deposit:{resource_id}:{version_id}` |
| 4 | Place a BlueOcean bet (debit callback) | `ledger_entries` debit with key `bo:debit:{event_id}`; allocator deducts from `bonus_locked` first |
| 5 | Verify WR progress | `user_bonus_instances.wr_contributed_minor` incremented according to game contribution profile |
| 6 | Repeat bets until `wr_contributed_minor >= wr_required_minor` | WR threshold met |
| 7 | Verify conversion | `bonus_locked` debited via `promo.convert:bonus:{instance_id}`; `cash` credited via `promo.convert:cash:{instance_id}`; instance `status = completed` |

**CI gate:** blocking — pipeline fails if any step errors.

---

## 2. Allocator replay (idempotency)

**Objective:** Confirm that replaying the same deposit webhook does not produce a double grant.

| Step | Action | Expected result |
|---|---|---|
| 1 | Send the same Fystack deposit webhook as test 1 (identical `resource_id`) | Webhook delivery deduped (`fystack_webhook_deliveries.dedupe_key` conflict) |
| 2 | Query `user_bonus_instances` for the user | Exactly one instance for the promotion version — no duplicate |
| 3 | Query `ledger_entries` for `fystack:deposit:{resource_id}` | Exactly one row |

**CI gate:** blocking.

---

## 3. Webhook replay (Fystack idempotency)

**Objective:** Verify that replaying a Fystack webhook delivery is fully idempotent at every layer.

| Step | Action | Expected result |
|---|---|---|
| 1 | Replay the same Fystack delivery payload | HTTP 200 (accepted but no-op) |
| 2 | Verify `fystack_webhook_deliveries` row count unchanged | No new row inserted |
| 3 | Verify ledger unchanged | No new `ledger_entries` rows |
| 4 | Verify bonus unchanged | No new `user_bonus_instances` rows |

**CI gate:** blocking.

---

## 4. Chat

**Objective:** Verify real-time chat send, receive, and staff moderation.

| Step | Action | Expected result |
|---|---|---|
| 1 | Connect to WebSocket `/v1/chat/ws` with test user JWT | Connection accepted; join envelope received |
| 2 | Send a chat message | Message appears in own WS stream and transcript query |
| 3 | Query `GET /v1/chat/transcript` | Message present with correct `user_id`, `content`, `created_at` |
| 4 | Staff: `POST /v1/admin/chat/messages/{msgID}/delete` | Message `deleted_at` set; delete envelope broadcast to connected clients |
| 5 | Re-query transcript | Message either absent or marked as deleted |

**CI gate:** nightly.

---

## 5. Admin — promotion lifecycle

**Objective:** Verify the full promotion management workflow.

| Step | Action | Expected result |
|---|---|---|
| 1 | `POST /v1/admin/bonushub/promotions` — create promotion | Promotion row created with `grants_paused = false` |
| 2 | `POST /v1/admin/bonushub/promotions/{id}/versions` — add version with deposit-trigger rules | Version row created, `published = false` |
| 3 | `POST /v1/admin/bonushub/promotions/{id}/versions/{vid}/publish` | Version `published = true`; older published version (if any) unpublished |
| 4 | `GET /v1/admin/bonushub/promotions` | New promotion appears in list with published version |

**CI gate:** nightly.

---

## 6. CI scheduling

| Suite | Schedule | Gate |
|---|---|---|
| Deposit → Grant → Bet → WR (test 1) | Every CI run | **Blocking** — merge blocked on failure |
| Allocator replay (test 2) | Every CI run | **Blocking** |
| Webhook replay (test 3) | Every CI run | **Blocking** |
| Chat (test 4) | Nightly | Non-blocking (alert on failure) |
| Admin promotion lifecycle (test 5) | Nightly | Non-blocking (alert on failure) |

---

## Test data management

- Each CI run creates disposable test users with a `test+{run_id}@` email prefix.
- Staging Fystack and BlueOcean endpoints accept synthetic resource/event IDs without real provider calls.
- Teardown step truncates test-user data after the run to keep staging clean.
