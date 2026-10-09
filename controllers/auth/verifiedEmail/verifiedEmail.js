const { sendEmail } = require('../../../helpers');
const { translations } = require('./translations');

const verifiedEmail = async (req, res) => {
  const { user } = req;
  const language = ['cs', 'en', 'uk'].includes(user.language) ? user.language : 'cs';
  const copy = translations[language];
  const origin = (process.env.FRONTEND_URL || 'https://anirakids.cz').replace(/\/+$/, '');
  const confirmationUrl = `${origin}/confirmEmail?token=${encodeURIComponent(user.token)}`;
  // Presentation tables and inline styles survive email-client HTML sanitization.
  await sendEmail({
    to: user.email,
    subject: copy.email_confirmation,
    text: `${copy.email_confirmation}\n\n${copy.confirmation_message.replace(/<br\s*\/?>/g, '\n')}\n\n${copy.confirm_button}: ${confirmationUrl}\n\nANIRAK · GlamGarb Rentals s.r.o.`,
    html: `<!DOCTYPE html>
<html lang="${language}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${copy.email_confirmation}</title></head>
<body style="margin:0;padding:0;background-color:#ffffff;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background-color:#ffffff;">
<tr><td align="center" style="padding:16px 12px;text-align:center;">
<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto;border-collapse:collapse;">
<tr><td align="center" style="padding:24px 12px 16px;text-align:center;">
<a href="https://anirakids.cz" style="display:inline-block;font-family:Georgia,serif;font-size:30px;line-height:36px;color:#403a37;text-decoration:none;">ANIRAK</a>
</td></tr>
<tr><td align="center" style="padding:0 8px 24px;border-bottom:1px solid #ebdad1;text-align:center;">
<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:360px;margin:0 auto;border-collapse:collapse;">
<tr>
<td align="center" width="25%" style="text-align:center;"><a href="https://anirakids.cz/saty" style="display:block;padding:12px 2px;font:14px/20px Arial,sans-serif;color:#403a37;text-decoration:none;white-space:nowrap;">Šaty</a></td>
<td align="center" width="25%" style="text-align:center;"><a href="https://anirakids.cz/obleky" style="display:block;padding:12px 2px;font:14px/20px Arial,sans-serif;color:#403a37;text-decoration:none;white-space:nowrap;">Obleky</a></td>
<td align="center" width="25%" style="text-align:center;"><a href="https://anirakids.cz/pronajem" style="display:block;padding:12px 2px;font:14px/20px Arial,sans-serif;color:#403a37;text-decoration:none;white-space:nowrap;">Pronájem</a></td>
<td align="center" width="25%" style="text-align:center;"><a href="https://anirakids.cz/ucet" style="display:block;padding:12px 2px;font:14px/20px Arial,sans-serif;color:#403a37;text-decoration:none;white-space:nowrap;">Můj účet</a></td>
</tr></table>
</td></tr>
<tr><td align="center" style="padding:32px 16px 16px;text-align:center;">
<h1 style="margin:0;font-family:Georgia,serif;font-size:26px;line-height:1.3;font-weight:700;color:#403a37;text-align:center;">${copy.email_confirmation}</h1>
</td></tr>
<tr><td align="center" style="padding:0 16px 24px;text-align:center;">
<p style="margin:0;font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#403a37;text-align:center;">${copy.confirmation_message}</p>
</td></tr>
<tr><td align="center" style="padding:0 16px 32px;text-align:center;">
<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:280px;margin:0 auto;border-collapse:separate;">
<tr><td align="center" bgcolor="#ffffff" style="border:1px solid #6c6158;border-radius:2px;text-align:center;">
<a href="${confirmationUrl}" style="display:block;padding:16px 12px;font-family:Arial,sans-serif;font-size:16px;line-height:24px;font-weight:700;color:#6c6158;text-decoration:none;text-transform:uppercase;text-align:center;">${copy.confirm_button}</a>
</td></tr></table>
</td></tr>
<tr><td align="center" bgcolor="#ebdad1" style="padding:24px 16px;background-color:#ebdad1;text-align:center;">
<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:1.6;color:#403a37;text-align:center;">ANIRAK © ${new Date().getFullYear()}<br>GlamGarb Rentals s.r.o.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`,
  });
  res.status(200).json({ message: 'Email confirmation sent successfully.' });
};
module.exports = verifiedEmail;
