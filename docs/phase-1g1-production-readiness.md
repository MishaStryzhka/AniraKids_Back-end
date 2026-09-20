# AniraKids v2 Production Reservation Readiness

Phase 1G.1 prepares production hardening. It does **not** enable the public reservation API.

## Required environment

- `MONGODB_URI` — required by the deployed backend.
- `SECRET_KEY` — required for optional legacy Bearer authentication.
- `V2_RESERVATION_API_ENABLED` — must remain unset or not equal to `true` until every go-live gate below is complete.
- `V2_CORS_ALLOWED_ORIGINS` — comma-separated exact browser origins allowed to call v2.
- `V2_GUEST_TOKEN_SECRET` — dedicated secret, at least 32 bytes, never reuse `SECRET_KEY`.

## Go-live gates

- [ ] `uniq_v2_reservation_number` exists in production and is unique on `reservationNumber`.
- [ ] `uniq_v2_reservation_idempotency_key` exists in production and is unique/partial on `idempotencyKeyHash`.
- [ ] `V2_GUEST_TOKEN_SECRET` is configured in Production.
- [ ] `V2_CORS_ALLOWED_ORIGINS` contains the exact approved production origins and no wildcard.
- [ ] Vercel Firewall/WAF rule for `POST /api/v2/reservations` is published with per-IP rate limiting.
- [ ] `V2_CATALOG_DATA_READY`: rentable production catalogue has `ProductV2 -> VariantV2 -> active InventoryItemV2` for the models intended for launch.
- [ ] Controlled production smoke-test plan is approved.
- [ ] Only after all gates pass, deliberately set `V2_RESERVATION_API_ENABLED=true`.

## Production database safety

The manual command `npm run check:v2-production-indexes` is read-only. It connects using explicit `MONGODB_URI` and calls only `listIndexes()`.

It does not call `createIndexes()`, `syncIndexes()`, insert, update, delete, migration, seed, or `dropDatabase()`.

## Catalogue data

Phase 1G.1 does not migrate or seed catalogue data. `V2_CATALOG_DATA_READY` remains a separate production go-live blocker until real v2 inventory is prepared through a dedicated migration/admin phase.

## WAF target

- Path: `/api/v2/reservations`
- Method: `POST`
- Key: client IP
- Desired threshold: 10 requests / 15 minutes / IP
- Action: rate limit / HTTP 429

Use the exact window supported by the project's Vercel Firewall UI/API. Do not add an in-memory Node fallback if the project cannot express 900 seconds.
