# Kubernetes stubs (network + future mesh)

Examples here are **templates**, not a full chart. Apply labels and namespaces to match your cluster.

## Network policies

See `examples/core-api-netpol.yaml`: restricts the core API pod to **ingress only from** your ingress controller namespace and **egress** to Kubernetes DNS + Postgres + Redis + known provider endpoints. **Tighten CIDR / namespace selectors** before production.

- Adjust `namespaceSelector` / `podSelector` to your ingress controller (e.g. `ingress-nginx`).
- Add `egress` rules for Fystack/BlueOcean API hosts or use a **default-deny** namespace policy plus explicit allows.

## mTLS / Istio / Linkerd

- **Istio:** see `examples/istio-peer-authentication-strict-stub.yaml` for namespace **STRICT** `PeerAuthentication`; optional `examples/istio-destinationrule-mtls.yaml` for explicit `ISTIO_MUTUAL` client TLS to a Service host.
- **Linkerd:** follow their automatic mTLS install; annotate namespaces/pods per vendor guide.

This repo does **not** ship a full mesh; operators copy patterns from their platform team.

## Cert expiry

Use `security/scripts/check_cert_expiry.sh` against public HTTPS endpoints or PEM files in monitoring (cron / GitHub Actions scheduled workflow).
