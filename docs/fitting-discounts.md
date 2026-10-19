# Fitting discount

A completed, paid fitting may fund one 200 CZK rental **discount**. The fitting remains a separately paid service. Admins with both fitting and reservation permissions select an eligible fitting on reservation detail; the existing fitting-side credit action remains API-compatible but now applies a discount.

The reservation stores `fittingCreditId` (existing unique reuse guard) and an immutable `fittingDiscount` snapshot: number, amount, actor and timestamp. `subtotal` and `totalDue` decrease by 200; item price snapshots and deposit remain unchanged. No payment entry is created. The advance is capped at the new subtotal, not treated as received money. The mutation increments paymentRevision and compares status, subtotal and payment revision atomically to protect against concurrent payments and lifecycle transitions.

Eligibility: matching normalized email, completed and paid fitting, unused fitting and reservation, pending/unexpired or confirmed/prepared rental, reconciled ledger, a rental subtotal of at least 200 CZK. A fully paid open reservation may receive the discount: its payment ledger stays unchanged and the resulting overpayment must be refunded manually. An existing invoice blocks this mutation; issued documents must not silently change. Same-reservation retries are idempotent. Cancelled or expired never-paid holds release the discount and restore their original gross totals. Any payment history, even subsequently refunded, prevents automatic release.

Historical reservations with fittingCreditId but no fittingDiscount keep their original payment entries and amounts. They are displayed as previous payment credits and continue to block reuse. There is no bulk data migration. Partner settlement calculations retain their pre-existing fitting-inclusive share basis; this release does not renegotiate partner commission rules.

GET /admin/reservations/:reservationId/fitting-discount returns minimal fitting options plus the applied/legacy summary. Both permissions are required. Automatic invoice issuance is outside this release.

## Customer redemption

POST /fitting-discounts/options accepts either an authenticated account or a private fitting number/token pair. Email alone grants no access. Paid, completed and unused fittings are returned with minimal metadata. Checkout optionally submits fittingDiscount: {number, token?}; the server validates ownership and matching contact email, locks the fitting and creates the discounted reservation in the inventory transaction. The unique fittingCreditId index prevents reuse. The selection participates in the idempotency fingerprint; token material is hashed there.

Completing a paid fitting sends a single personal catalogue link. Only its hash is stored on the fitting. The browser removes the fragment from the address bar and keeps the capability in session storage. Original private fitting links also authorize redemption. Existing completed fittings are available in accounts without bulk emails. Failed or ambiguous completion email sends are recorded and are not retried automatically.

The option picker is advisory: availability is rechecked at reservation creation. A never-paid expired/cancelled reservation releases its discount when options are queried or another claim is attempted. Paid cancelled reservations retain it for manual resolution. Manual linking remains available in the reservation detail for customers who omitted the discount. No money transfer or invoice issuance is triggered by linking.
