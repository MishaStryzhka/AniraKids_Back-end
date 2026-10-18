# ANIRAK — owner payment report Web Push

An owner with access to **Admin → Zkoušky** can opt in separately on each device. When a customer changes a valid fitting from `pending` to `review` by clicking **Platba odeslána**, the backend attempts one generic, empty-payload Web Push notification. No customer name, contact details, reservation identifier or bank information is transmitted to the push service.

Web Push is **not a payment confirmation**. Verify the bank transfer before changing a fitting to `confirmed / paid`.

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

Deploy frontend (including `/admin-push-sw.js`), then open **Admin → Zkoušky → Zapnout upozornění** and allow notifications in the browser. Re-enable separately on each desired device.

On iPhone/iPad, install the ANIRAK website **to the Home Screen** and open it from the installed icon before enabling notifications; ordinary browser tabs do not support iOS Web Push.

## Security / behavior

- Owner-only subscribe/unsubscribe API protected by existing Admin bearer authentication.
- Only known push provider hostnames are accepted, HTTPS only, redirects disabled (SSRF protection).
- Limit: 10 device subscriptions per owner. Stale endpoints removed on 404 or 410.
- Only real `pending → review` transitions send; repeats cannot generate another push.
- Failed delivery never changes fitting/payment status or creates retries that double-notify.
- The worker displays a fixed, generic text and links to `/admin/zkousky`.
- Device subscriptions live in MongoDB collection `v2_admin_push_subscriptions`.
- Browser notification permission remains under the user's browser/OS settings.

Notification delivery is best effort. Browser, OS focus modes, connectivity and push provider may delay or drop notifications. Continue to use the admin fitting list as the source of truth.
