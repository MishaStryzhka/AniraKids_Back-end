# Rental policy 2026-11

New reservations must acknowledge `rentalPolicyVersion: "2026-11"`. A previously successful idempotent request still replays before this check. Old records retain their monetary snapshots and legacy occupancy rules.

- `studio` is the existing API identifier for **Na focení**: one calendar day, personal pickup and return that day, configured studio price and ordinary product/variant deposit. Public availability is independent of partner cooperation.
- `external` is **Na libovolnou příležitost**: 1–7 inclusive calendar days. Price is the configured external first-day price plus `(days - 1) × additionalDayPrice`. Existing products default to 200 CZK per additional day; admins can override this per product.
- Pickup is free. Balíkovna costs 178 CZK (89 outbound + 89 return); address delivery costs 238 CZK (119 + 119). Charge shipping once per reservation, including multi-item baskets. Existing shipping snapshots remain unchanged.
- Delivery occupies inventory starting **2 working days before** customer use and through **2 working days after**, followed by the existing cleaning buffer (one calendar day for external rentals). Working days exclude weekends and Czech public holidays. These are operational margins, not a carrier guarantee. Transit/cleaning are not paid rental days.
- Save `occupiedStartDate` / `occupiedEndDate` immutably on creation. Calendar, quote, transactional allocation, manual blocks, confirmation and inventory lifecycle must all respect these intervals. Legacy records use their original rental dates plus mode-specific cleaning.
- Return labels are prepared manually close to dispatch and included in the parcel. This change does not create carrier shipments or labels.

Validation: `npm run vercel-build`; `scripts/check-rental-policy-integration.js` uses its own disposable loopback replica set with explicit test opt-in. Public booking regression additionally exercises auth, idempotency, invoices, payments and partner deposit receipt/refund.
