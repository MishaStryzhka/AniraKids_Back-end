# Reservation action history

Reservation mutations append to the existing `partnerAudit` field. Its name is retained for compatibility with old partner history and invoice completion dates; it now covers both admin and partner operations.

Each entry stores `action`, server timestamp `at`, and `by` from authenticated server context (`owner:<userId>`, `admin:<userId>`, `partner:<userId>`, or customer identity). Public anonymous creation is explicitly `guest`; unattended service work is `system`. Referral/staff attribution is not the identity of the customer making a booking. Existing payment actors retain their original user IDs.

Covered mutations: creation, confirmation, preparation, handover, garment return, cancellation, note changes, payment receipt/refund and fee entries, fitting payment application/release, account claim, invoice issue/correction, and existing partner source/assignment changes. Payment events also include amount, method and operation ID. Invoice/fitting events carry their document/booking number as `reference`.

Events commit with their mutation in the same MongoDB document write or transaction. Replayed lifecycle, payment, invoice and account-claim requests do not append duplicates. Re-saving unchanged notes also does not append an event. Rejected operations do not become successful history entries; existing request error logging remains separate.

`GET /api/v2/admin/reservations/:reservationId` returns a read-only `history` array sorted by time. It includes authentic pre-existing payment ledger events if not already represented by operation ID. Existing admin authorization applies. Customer/public DTOs do not expose employee history. No API accepts history or actor overrides from a request body.

No speculative historical backfill: actions that previously lacked an actor cannot be attributed retroactively. Existing records are retained. Invoice email delivery state and attempts continue to be tracked on the invoice itself. Pending expiry is time-derived, not a stored reservation status transition.
