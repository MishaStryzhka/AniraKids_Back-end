# Seznam transactional email

The shared email helper supports Seznam SMTP for existing account emails and future reservation notifications. Booking lifecycle notifications are not introduced by this change.

Configure the production backend in Vercel, keeping the password in a sensitive environment variable:

- `SMTP_USER=no-reply@anirakids.cz`
- `SMTP_PASSWORD`: enter the mailbox password directly in Vercel. With Seznam two-factor authentication use its dedicated mail-client password. Do not commit or paste it into chat.
- `EMAIL_FROM=no-reply@anirakids.cz`
- `EMAIL_REPLY_TO=rezervace@anirakids.cz`
- `EMAIL_PROVIDER=seznam`

Provision credentials before changing EMAIL_PROVIDER, then redeploy. SMTP uses smtp.seznam.cz:465 with TLS and certificate verification. No automatic cross-provider retry is attempted. Success means provider acceptance, not guaranteed inbox delivery.

After deployment, test one account verification email to an owner-controlled address, check delivery and reply routing, and inspect authentication results (SPF/DKIM/DMARC) in the received headers. Do not guess DNS values: obtain them from Seznam domain settings. Disable/remove the unused SendGrid key after delivery is verified. To roll back, explicitly set EMAIL_PROVIDER=sendgrid and redeploy while its key remains valid.

If the mailbox password was previously committed, rotate it manually before enabling SMTP; never reuse the exposed value. Preview deployments must not inherit production mailbox credentials automatically.

Official settings: https://o-seznam.cz/napoveda/email/mohlo-by-se-hodit/postovni-programy-a-aplikace/
Two-factor mail password: https://o-seznam.cz/napoveda/ucet/dvoufazove-overeni/postovni-programy/

Run `node scripts/check-email-delivery.js` for isolated provider contract checks (no real mail is sent).
