# Data Durability Checklist

This project must preserve customer and admin data across deploys, restarts, and horizontal scaling.

## Non-negotiable requirements

- Use a persistent Postgres instance (no ephemeral DB).
- Run migrations before serving production traffic.
- Keep `SKIP_DB_MIGRATIONS_ON_START` disabled in production.
- Enable automated backups and restore testing (including point-in-time recovery when available).
- Do not store critical CMS media only on local server disk.

## Implemented safeguards

- CMS content is stored in `site_content` (Postgres).
- CMS uploaded media is stored in `cms_uploaded_assets` (Postgres `BYTEA`).
- `/v1/uploads/*` serves uploaded assets from DB first.
- Legacy disk-only uploads are auto-backfilled to DB when requested.
- API startup validates required durability tables exist.
- Production startup fails if migrations are skipped.

## Deployment validation

Run these checks after each deploy:

1. Open admin CMS and confirm latest edits are visible.
2. Open player homepage/auth modal and confirm uploaded images render.
3. Call `GET /v1/admin/ops/content-health` and confirm:
   - `ok = true`
   - `broken_upload_refs = 0`
   - `blob_refs_detected = 0`
4. Restart API service and re-check steps 1-3.

## Disaster recovery drill

- Restore latest backup into staging.
- Validate row counts for `users`, `site_content`, and `cms_uploaded_assets`.
- Spot-check recent customer records and CMS image rendering.
- Document RTO/RPO and any gaps.
