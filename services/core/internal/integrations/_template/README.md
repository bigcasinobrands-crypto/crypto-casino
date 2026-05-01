# Integration package template

Copy this folder to `internal/integrations/acme/` and replace `acme` / `Acme` with your provider name.

## Steps

1. Implement the port interfaces you need from `internal/ports`.
2. Add tests with sanitized JSON fixtures in `testdata/`.
3. Import your package from `internal/integrations/registry.go` and assign to the appropriate field.

## Stub

```go
package acme

import (
	"context"
	"github.com/crypto-casino/core/internal/ports"
)

type Adapter struct{}

var _ ports.SeamlessWalletPort = (*Adapter)(nil)

func (a *Adapter) ProviderKey() string { return "acme_v1" }

func (a *Adapter) ParseRemoteUser(ctx context.Context, remoteID string) (string, error) {
	return "", context.Canceled
}
```
