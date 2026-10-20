# Faktury (neplátce DPH)

Owner-only `/admin/faktury`. Existing company and bank details come from BOOKING_POLICY and are snapshotted when issued. No VAT calculation or VAT document label.

1. Confirm a received fitting payment, or record the first rental/advance payment. The automatic invoice is issued immediately and emailed as a PDF; completing/returning the service is no longer the automatic trigger. Manual issuance with entered billing details remains available after service completion.
2. Automatic invoices use the recorded customer name and email. No missing billing address or company ID is invented. For historical confirmed payments, the owner can explicitly select “Vystavit a odeslat z přijaté platby”; no bulk historical sending occurs.
3. Download the PDF and inspect delivery status. A provider failure or timeout never rolls back the payment. Automatic sends claim the document before contacting the provider; ambiguous attempts are not automatically retried. An explicit owner resend acknowledges possible duplicate delivery and compares the previous attempt timestamp. An in-progress attempt is protected for ten minutes.
4. Choose an issue month or whole year to export PDF documents and faktury.csv. platby-a-vratky.csv separately includes all recorded rental payment events and fitting receipts/refunds in that period, including advances and deposits without invoices. Dates are recording dates, not inferred bank transaction dates. Reconcile with bank statements.

MongoDB replica-set transactions atomically allocate a year-based sequential number and insert the immutable accounting snapshot. Unique sourceKey prevents repeated issuance. A source document write inside the transaction detects concurrent service/payment changes. A fingerprint requires a fresh preview. No number is consumed by an aborted transaction. Required unique indexes are created before issuance. Invoice collection is separate from booking/payment records.

A fitting is a 200 Kč service. A rental discount is a separate negative invoice line, not a second cash receipt. Refundable deposits never enter invoice total. PDFs show amounts paid and remaining **at issuance**, not a live payment status. Actual payment/refund changes belong to the source ledger and do not rewrite issued documents.

Full cancellation creates one separate negative correction with the original number and mandatory reason, preserving the original. It does not transfer or refund money. Partial corrections and replacement invoices after full cancellation are not supported by this first version; handle those with the accountant. Existing historical invoices from another system are not imported and must not be reissued here. Numbering starts at YYYY-0001 in a dedicated application register; confirm any pre-existing external register before first use.

PDF font: subset of DejaVu Sans (Latin, Czech and Cyrillic), license in assets/fonts. No external font requests. Long invoices paginate. Export is bounded to 2,000 invoices and 10,000 sources per type; choose a shorter period if necessary.

Verification: `npm run build:v2`, then `NODE_ENV=test INVOICE_TEST_ALLOW=1 INVOICE_MONGOD_BINARY=/path/to/mongod node scripts/check-invoices-integration.js`. The harness starts and destroys its own local replica set and never reads app credentials or sends emails.

## Automatic issuance and recovery

A durable invoiceAutomation marker is written in the same single-document CAS as payment confirmation. The controller processes it after the payment commits. Issuance uses the existing transaction, unique source key and yearly counter; the source marker becomes issued in that transaction. The invoice email starts pending, so interrupted PDF preparation can be safely retried without a second document or number. Owner-only pending/process endpoints expose unfinished issuance and allow recovery. A source's invoiceIssuedId also prevents a manual discount CAS from changing the price after invoice issuance wins a race.

For rental advances the document covers the full agreed rental price, including any fitting discount, and shows paid/remaining at issuance. Subsequent payments, deposits and refunds do not generate a second invoice or mutate the snapshot. A deposit-only receipt or a late transfer on a cancelled service does not automatically invoice a service. Future service dates are explicitly labelled planned; payment recording date is separate and is never inferred from a bank transfer.

Delivery statuses: pending (no provider attempt), sending (claimed), sent (provider accepted; not proof of inbox delivery), failed (acceptance unverified). A failed PDF remains pending. Resends reuse the same numbered snapshot and require an explicit owner action. A failed issue remains in the pending source queue. There is no background cron; interruption recovery is available through payment replay and the owner queue.

Verify automatic behavior with scripts/check-automatic-invoices-integration.js in the same disposable replica-set environment. Tests mock the mail provider, cover actual confirmation/payment controllers, duplicate confirmations, partial/full payments, deposits, cancellation, provider/PDF failures, recovery and retry compare-and-set.

## PDF layout

All invoice downloads, email attachments, and ZIP exports use the same reference-based IBM Plex Sans template (two party columns, grey rules, item prices, total and registry footer). Fonts are bundled under the SIL Open Font License. Existing issued amounts, numbers and customer snapshots are preserved. The QR contains only the outstanding service amount at issuance, with the source booking reference and invoice number as the variable symbol; deposits are excluded. Fully paid documents and corrections have no payment QR. Later payments do not rewrite the original invoice. Long item lists continue on additional pages.

Payment confirmation now uses one compact email with the PDF attachment. Fitting confirmation no longer sends its own separate message; the combined message includes the current appointment time and address. Initial booking/payment instructions, actual rescheduling and post-visit discount messages remain separate lifecycle events. Issuance or PDF failures leave the combined email pending for owner recovery; there is no competing fallback confirmation.

All outgoing email types share `helpers/emailLayout.js`, extracted from Rezervace zkoušky: ANIRAK navigation, typography, warm detail panel, contact signature and inline social icons. There remains one PDF attachment and one message per invoice send; social icons are inline MIME parts, deduplicated by CID at the delivery boundary. Rental invoices use “Pronájem potvrzen · Faktura …” only when the source reservation is confirmed/prepared/rented/returned and the issued snapshot records a positive payment. Pending, cancelled, missing sources and correction documents never claim a confirmed rental. Authentication links and token lifecycles are unchanged.

For an automatic rental invoice whose reservation is still pending, the PDF is issued but its email stays pending. Both admin and partner confirmation actions resume delivery after successful reservation confirmation; payment after confirmation delivers immediately. Existing email claims prevent duplicates on retried actions.
