# AniraKids_Back-end

### Blaze monthly invoices

Partner managers configure supplier details, VAT treatment, the recipient, invoice series and issuing consent under **Platby a vyúčtování → Měsíční faktury**. No invoice is issued until enabled. Saving settings starts the reward ledger; only documented current-period accruals enter the initial baseline, never undated legacy balances. Agreed rewards are treated as gross amounts including any configured VAT. Confirm the supplier tax settings before activation.

Production Vercel cron calls `/api/v2/partner-billing/cron` with `Authorization: Bearer $CRON_SECRET`. Two daily UTC schedules cover Prague midnight in both seasons and retry missed runs. Only completed calendar months close; the immutable invoice is dated the last day at 23:59 Europe/Prague, due 14 calendar days later. A unique partner/month index and transactional partner lock prevent duplicate closure. Empty months produce reports only; negative totals carry forward. Later corrections enter the next open period and never rewrite an issued invoice.

Each positive invoice has one compact email with the PDF. An uncertain delivery is visible in the cabinet and requires checking the recipient mailbox before explicit retry; it is not automatically resent. `sending` attempts can only be retried after ten minutes. PDF downloads always render the issued snapshot. Deposits and cash handovers are excluded from rewards. Tracking errors block closing until reconciliation succeeds; the daily job reconciles before closing.

Verification: `NODE_ENV=test PUBLIC_BOOKING_TEST_ALLOW=1 PUBLIC_BOOKING_MONGOD_BINARY=/path/to/mongod node scripts/check-v2-public-booking-integration.js` after `npm run build:v2`. The harness owns a disposable loopback replica set and mocks every email.
