# Fitting discount

A completed, paid fitting may fund one 200 CZK rental **discount**. The fitting remains a separately paid service. Admins with both fitting and reservation permissions select an eligible fitting on reservation detail; the existing fitting-side credit action remains API-compatible but now applies a discount.

The reservation stores `fittingCreditId` (existing unique reuse guard) and an immutable `fittingDiscount` snapshot: number, amount, actor and timestamp. `subtotal` and `totalDue` decrease by 200; item price snapshots and deposit remain unchanged. No payment entry is created. The advance is capped at the new subtotal, not treated as received money. The mutation increments paymentRevision and compares status, subtotal and payment revision atomically to protect against concurrent payments and lifecycle transitions.

Eligibility: matching normalized email, completed and paid fitting, unused fitting and reservation, pending/unexpired or confirmed/prepared rental, reconciled ledger, at least 200 CZK outstanding rental balance. A paid reservation requires manual resolution of overpayment before applying a discount. Same-reservation retries are idempotent. Cancellation does not automatically restore a used fitting discount.

Historical reservations with fittingCreditId but no fittingDiscount keep their original payment entries and amounts. They are displayed as previous payment credits and continue to block reuse. There is no bulk data migration. Partner settlement calculations retain their pre-existing fitting-inclusive share basis; this release does not renegotiate partner commission rules.

GET /admin/reservations/:reservationId/fitting-discount returns minimal fitting options plus the applied/legacy summary. Both permissions are required. Invoices, guest redemption and automatic customer-side redemption are outside this release.
