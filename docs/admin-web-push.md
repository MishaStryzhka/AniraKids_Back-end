# ANIRAK — owner Web Push

An owner can opt in separately on each device in **Admin → Nastavení → Upozornění**. The supported events are **Nová rezervace zkoušky** (`fitting_created`) after a new fitting is saved, and **Klient oznámil odeslání platby za zkoušku** (`fitting_payment_reported`) when a valid fitting changes from `pending` to `review`. The backend sends only an encrypted event type; no customer name, contact details, reservation identifier or bank information is included.

Rental reservations also support **Klient oznámil odeslání platby za pronájem** (`reservation_payment_reported`) for a reported advance or remaining transfer, and **Klient zvolil platbu hotově při převzetí** (`reservation_cash_selected`) for a saved cash arrangement.

Web Push is **not a payment confirmation**. Verify the bank transfer or actual cash receipt before recording money received.

## Server activation (required)

Generate a long-lived VAPID P-256 key pair locally:

```sh
node scripts/generate-web-push-keys.js
```

Configure these three environment variables **only in the backend deployment's secret settings**, never in Git or frontend builds:
- `V2_PUSH_VAPID_PUBLIC_KEY` (URL-safe base64 uncompressed 65-byte public point)
- `V2_PUSH_VAPID_PRIVATE_KEY` (URL-safe base64 32-byte private scalar)
- `V2_PUSH_VAPID_SUBJECT=mailto:glamgarbrentals@seznam.cz`

Redeploy backend so the settings are available. `GET /api/v2/admin/push/config` requires owner authentication and returns `enabled:false` until valid keys are present. Do not rotate keys casually: it invalidates device subscriptions.

Deploy frontend (including `/admin-push-sw.js`), then open **Admin → Nastavení → Upozornění → Zapnout upozornění** and allow notifications in the browser. Re-enable separately on each desired device.

On iPhone/iPad, install the ANIRAK website **to the Home Screen** and open it from the installed icon before enabling notifications; ordinary browser tabs do not support iOS Web Push.

## Security / behavior

- Owner-only subscribe/unsubscribe API protected by existing Admin bearer authentication.
- Only known push provider hostnames are accepted, HTTPS only, redirects disabled (SSRF protection).
- Limit: 10 device subscriptions per owner. Stale endpoints removed on 404 or 410.
- Creation alerts send only after the winning database insert. Idempotent replays, concurrent retries and rejected bookings do not send another creation alert.
- Payment alerts send only on real `pending → review` transitions; repeats cannot generate another push.
- Rental payment/cash alerts send only after the winning report write. Concurrent/idempotent retries, rejected reports and repeated selection of the same pending cash amount do not send another alert. Switching cash to a reported transfer sends the transfer alert.
- Failed delivery never changes fitting/payment status or creates retries that double-notify.
- The worker selects fixed Czech text by event type and links to `/admin/zkousky` for fittings or `/admin/rezervace` for rental payment/cash reports. Click destinations are allowlisted; payload URLs cannot redirect elsewhere. Separate alerts do not replace each other.
- Device subscriptions live in MongoDB collection `v2_admin_push_subscriptions`.
- Browser notification permission remains under the user's browser/OS settings.

Notification delivery is best effort. Browser, OS focus modes, connectivity and push provider may delay or drop notifications. Continue to use the admin fitting list as the source of truth.


## Upozornění — subscriptions

Manage subscriptions in **Admin → Nastavení → Upozornění**. Each device stores `topics` separately. New subscriptions initially select all four events; existing subscriptions keep their saved selection. Enable the two new **Rezervace** options on each existing device to receive rental transfer/cash alerts. Opening Settings updates the service worker without asking again for browser notification permission.

The owner-scoped `POST /api/v2/admin/push/preferences` accepts `{endpoint}` and returns `{subscribed,topics}`. `POST /api/v2/admin/push/subscribe` accepts `{endpoint,topics,keys:{p256dh,auth}}`. Browser encryption keys are validated and required for every topic except the original fitting-payment alert. Empty topics silence all events without revoking OS permission. Unknown/duplicate topics are rejected. Legacy subscriptions without encryption keys continue to receive empty-payload fitting-payment alerts; other event types are never sent as misleading legacy alerts. Deploy the backend before the frontend; VAPID keys do not change.
