# Embedded Revolut payments

This implements reservation advances and full outstanding rental/deposit payments. It does not activate the merchant account, charge any live card.

## Configuration and rollout

Backend environment variables (Vercel, server only):

- `REVOLUT_ENABLED=true` enables new checkout creation. Unset/false is the default and returns null public configuration.
- `REVOLUT_MODE=sandbox` first; `prod` only after acceptance testing.
- `REVOLUT_SECRET_KEY`: Merchant API secret for that environment. Never use a frontend variable, commit it, or put it in chat/logs.
- `REVOLUT_PUBLIC_KEY`: matching merchant public key. This is the only key returned to the browser.
- `REVOLUT_WEBHOOK_SECRET`: signing secret from webhook registration in that environment.

Register HTTPS endpoint `/api/v2/payments/revolut/webhook` on the deployed backend for ORDER_COMPLETED, ORDER_CANCELLED, ORDER_FAILED, ORDER_AUTHORISED. Preserve the raw JSON bytes; proxy middleware must not rewrite the request body. Signature verification uses the original timestamp and constant-time HMAC comparison. Verify delivery in the provider dashboard.

Deploy the backend and frontend with checkout disabled first. Use a separate sandbox deployment/database and configure the merchant payment methods/domains using Revolut's dashboard. Follow Revolut's Apple Pay domain verification instructions for the actual checkout domains (including www if used); never synthesize the domain association file. Verify card/3DS, declined card, customer cancellation, refresh, wallet return, duplicate webhook and delayed completion. Check advance then balance, full rental+deposit, and automatic invoice issuance in sandbox. Finally check Apple Pay on a real eligible iPhone and Google Pay on a supported device. A browser fixture cannot certify wallet availability.

Enable production only after those tests and domain registration pass. Turning `REVOLUT_ENABLED` off stops new orders; keep credentials and webhook configured so existing payments still reconcile. Do not switch modes/keys while that deployment has pending orders from the previous environment.

## Integrity and recovery

The server calculates all amounts in Kč from the reservation ledger and sends minor units to Revolut. No client amount is accepted. A durable reservation lock and payment revision compare-and-swap serialize creation and ledger updates. The provider order reference binds a payment to one immutable split of rental and deposit. Manual payment entries and transfer reports are blocked while a card order is active. QR instructions are withheld during active/review payments.

The SDK's success event and return URL are hints only. Reconciliation fetches the provider order and checks order ID, reference, currency and amount. A completed order adds rental/deposit entries atomically once. After the durable money write, a valid pending reservation is confirmed through the existing inventory transaction. The transaction requires a paid advance, an unexpired hold and available physical items. It does not extend an expired hold. Replayed events resume confirmation if a process failure interrupted that step. Late/overlapping payments are retained, marked for review and do not queue an automatic invoice. Review is visible in payment entry notes and audit (`revolut_payment_review`); contact the customer and resolve availability/refund before closing the incident.

Create-order retries are intentionally conservative: the current API does not document an idempotency key for order creation. If the response is lost, the attempt remains locked. A subsequent signed webhook can recover it using merchant reference. For a stuck creating attempt, the operator must find the matching reference in Revolut and reconcile/cancel that order. Never blindly clear the lock or create another charge. If no order can be found, confirm with the provider that no order exists before a controlled database correction; there is no customer-facing force-unlock.

Refunds are not sent by this integration. Perform approved refunds in Revolut and record the actual refund in the existing admin ledger with its reference. Refund/chargeback event synchronization is not implemented; reconcile provider statements operationally. Review flags require an operator's controlled resolution; they are not cleared by customer refresh.

Existing automatic invoice processing is reused for normal payments; it is idempotent and has its existing retry queue. Revolut confirmation is automatic after verified payment and availability checks. QR/cash verification remains manual.

## Verification

`npm run vercel-build`

`NODE_ENV=test PUBLIC_BOOKING_MONGOD_BINARY=/path/to/mongod node scripts/check-revolut-integration.js`

The integration test owns a disposable loopback database and mocks Revolut, invoices and notifications. It verifies concurrent creation, repeat delivery, immutable amounts, cancellation, lost response recovery, late completion, automatic advance/full confirmation, conflict/expiry at confirmation, recovery after interruption, request signatures and missing authorization. This is not a live payment test.

References: https://developer.revolut.com/docs/sdks/merchant-web-sdk/payment-methods/embedded-checkout and https://developer.revolut.com/docs/guides/merchant/monitor-and-observe/webhooks/verify-the-payload-signature . Merchant API version: 2026-08-17.
