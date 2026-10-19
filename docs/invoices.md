# Faktury (neplátce DPH)

Owner-only `/admin/faktury`. Existing company and bank details come from BOOKING_POLICY and are snapshotted when issued. No VAT calculation or VAT document label.

1. Complete a fitting or return a rental and reconcile its payment ledger.
2. Enter the source number and buyer billing name/address (optional IČO), inspect the preview, then issue.
3. Download the PDF or explicitly confirm sending to the source customer's snapshotted email. There is at most one provider attempt; uncertain delivery must be checked manually, and the PDF remains downloadable.
4. Choose an issue month or whole year to export PDF documents and faktury.csv. platby-a-vratky.csv separately includes all recorded rental payment events and fitting receipts/refunds in that period, including advances and deposits without invoices. Dates are recording dates, not inferred bank transaction dates. Reconcile with bank statements.

MongoDB replica-set transactions atomically allocate a year-based sequential number and insert the immutable accounting snapshot. Unique sourceKey prevents repeated issuance. A source document write inside the transaction detects concurrent service/payment changes. A fingerprint requires a fresh preview. No number is consumed by an aborted transaction. Required unique indexes are created before issuance. Invoice collection is separate from booking/payment records.

A fitting is a 200 Kč service. A rental discount is a separate negative invoice line, not a second cash receipt. Refundable deposits never enter invoice total. PDFs show amounts paid and remaining **at issuance**, not a live payment status. Actual payment/refund changes belong to the source ledger and do not rewrite issued documents.

Full cancellation creates one separate negative correction with the original number and mandatory reason, preserving the original. It does not transfer or refund money. Partial corrections and replacement invoices after full cancellation are not supported by this first version; handle those with the accountant. Existing historical invoices from another system are not imported and must not be reissued here. Numbering starts at YYYY-0001 in a dedicated application register; confirm any pre-existing external register before first use.

PDF font: subset of DejaVu Sans (Latin, Czech and Cyrillic), license in assets/fonts. No external font requests. Long invoices paginate. Export is bounded to 2,000 invoices and 10,000 sources per type; choose a shorter period if necessary.

Verification: `npm run build:v2`, then `NODE_ENV=test INVOICE_TEST_ALLOW=1 INVOICE_MONGOD_BINARY=/path/to/mongod node scripts/check-invoices-integration.js`. The harness starts and destroys its own local replica set and never reads app credentials or sends emails.
