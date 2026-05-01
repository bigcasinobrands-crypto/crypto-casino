# Runbook: Istio mTLS rollout

## Preconditions

- Istio control plane healthy; injection/ambient enabled for `casino-*` namespaces.
- Golden signals dashboards ready (mTLS handshake failures, 503s between services).

## Rollout

1. **PERMISSIVE** — Confirm all workloads have sidecars (or waypoints) and inter-service traffic shows mesh badges.
2. **STRICT** — Apply `PeerAuthentication` with `mode: STRICT` to namespace (see [`../k8s/examples/istio-peer-authentication-strict-stub.yaml`](../k8s/examples/istio-peer-authentication-strict-stub.yaml)).
3. Watch for workloads that bypass mesh (e.g. `hostNetwork`, raw Pod IP callers). Fix or exempt explicitly.
4. Add `DestinationRule` traffic policies only when you need explicit TLS subsetting (see [`../k8s/examples/istio-destinationrule-mtls.yaml`](../k8s/examples/istio-destinationrule-mtls.yaml)).

## Rollback

- Set PeerAuthentication to `PERMISSIVE` for the namespace; investigate failing source/destination pair from Istio access logs.

## Notes

- Combine with Kubernetes `NetworkPolicy` for non-Istio workloads or node compromise scenarios.
