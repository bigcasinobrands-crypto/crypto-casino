# Bonus offer deduplication

Live offers cannot share the same **exclusivity key** when both are granting:

- If `dedupe_group_key` is set on `promotion_versions`, the key is `g:{dedupe_group_key}`.
- Otherwise the key is `f:{offer_family}|{eligibility_fingerprint}`.

`eligibility_fingerprint` is SHA-256 hex of canonical JSON (sorted keys) built from trigger (type, first_deposit_only, nth_deposit, channels), segment (VIP, tags, countries, explicit_targeting_only), reward **shape** only (not amounts), and `offer_family`.

**Tie-break** when evaluating multiple matches (same payment): `priority DESC`, then `published_at DESC`, then `id DESC`.

Publish flow computes `offer_family` and `eligibility_fingerprint` and returns `409` if another live offer shares the key.
