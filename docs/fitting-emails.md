# Fitting email notifications

New customer and partner-created fittings send a Czech creation email to the booking's customer address. A successful `confirm` transition sends a separate payment/appointment confirmation. Reporting payment, late payments, cancellation and completion do not send confirmation emails. Existing appointments are not bulk mailed.

The creation email links to the existing private `/zkouska/:number#token` page. The token is used only in the outgoing message; it is not stored in plaintext. Confirmation contains the appointment details and map link but no payment CTA or new guest credential. SendGrid click/open tracking is disabled to preserve private links. The agreed company signature includes inline PNG Instagram and WhatsApp icons, with visible text links as fallback. Header and footer retain the verification-email appearance; this template uses full available width.

## Configuration

Uses `helpers/sendEmail.js` and existing `EMAIL_PROVIDER`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, SendGrid or Seznam SMTP configuration. No new mail credentials are required. `FRONTEND_URL` defaults to `https://anirakids.cz` and must be HTTPS. Preview deployments should not inherit real mail credentials.

Before enabling customer use, set **Nastavení → Zkoušky → Adresa** to **Plzeňská 782/112, 150 00 Praha**. Emails use the address snapshot on the fitting, so the site and email agree. Existing appointment addresses are not rewritten. The footer's company name is not a fitting location.

## Delivery semantics

An atomic per-event `emailDelivery.created` / `.confirmed` claim allows at most one provider attempt, including concurrent create retries. Provider acceptance sets `sent`; failure sets `failed` and appends an `email_created_failed` or `email_confirmed_failed` audit event. A crash after claim can leave `sending`. There is no automatic retry of failed/ambiguous attempts because the provider may already have accepted the message. No mail error reverses a booking or payment. These status fields are private, and logs omit customer details and tokens. `sent` means provider acceptance, not proof of inbox delivery.

Creation retries can recover an unattempted email while the reservation is still pending and within its hold; they cannot replay messages after cancellation/expiry/confirmation. This implementation is request-awaited delivery, not a background queue. Monitor `FITTING_EMAIL_FAILED` and `FITTING_EMAIL_STATUS_UNAVAILABLE` before adding a future reviewed resend workflow.

## Validation

`node scripts/check-fitting-email.js`, `node scripts/check-email-delivery.js` and the fitting lifecycle integration suite use fixtures, never real recipients. The integration harness installs a fake sender before loading routes. A real received-message check in Seznam/Outlook is still required to establish inbox rendering and delivery.
