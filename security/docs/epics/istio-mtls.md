# Project plan: Full Istio / mesh mTLS

## Outcome

East-west traffic between workloads in the casino namespace uses **mutual TLS** (Istio sidecar or ambient). Legacy plaintext between services is rejected once strict mode is enabled.

## Phases

1. **Mesh install** — Istio revision, injection labels (or ambient waypoint), CNI, observability stack.
2. **PERMISSIVE → STRICT** — Roll PeerAuthentication gradually; watch mesh dashboards for TLS handshake failures.
3. **Ingress / egress** — Gateways, Egress policies, TLS origination where needed for external SaaS.
4. **NetworkPolicy** — Layer with Kubernetes `NetworkPolicy` (see [`../network-policies.yaml`](../network-policies.yaml)) for defense in depth.

Runbook: [`../../runbooks/istio-mtls-rollout.md`](../../runbooks/istio-mtls-rollout.md).

## In-repo artifacts

- [`../examples/istio-peer-authentication-strict-stub.yaml`](../examples/istio-peer-authentication-strict-stub.yaml)
- [`../examples/istio-destinationrule-mtls.yaml`](../examples/istio-destinationrule-mtls.yaml) (client TLS settings template)
