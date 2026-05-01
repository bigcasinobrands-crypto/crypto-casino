# Contributing integrations

Add or swap **payment rails, aggregators, captcha, email**, etc. without touching `internal/ledger` or `internal/wallet` except through existing **port** calls.

## Definition of done

1. Choose one or more [`internal/ports`](../services/core/internal/ports/ports.go) interfaces.
2. Implement under `services/core/internal/integrations/<provider>/` (copy `_template/`).
3. Register in [`internal/integrations/registry.go`](../services/core/internal/integrations/registry.go) — reviewers must see wiring in **one** place.
4. Vault paths: `casino/data/integrations/<provider>/` (see `security/docs/custody-key-management.md`).
5. Webhook URL documented; signature verification inside the adapter.
6. `go test ./internal/integrations/...` passes; golden fixtures for normalized payloads.
7. PR **must not** edit ledger/wallet “just to add a provider” — push back if it does.

## Checklist

- [ ] Port(s) identified
- [ ] Package `internal/integrations/<name>/`
- [ ] `ProviderKey()` stable string
- [ ] Registry updated
- [ ] Vault policy slice (narrow read)
- [ ] Audit log on config change (when DB-driven bindings exist)
- [ ] Docs + env example

## Removing a provider

1. Remove registry entry and delete package.
2. Disable Vault policy example.
3. No ledger migration unless retiring that provider’s id space (separate runbook).
