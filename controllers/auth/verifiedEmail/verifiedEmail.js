const {emailLayout,escapeHtml}=require('../../../helpers/emailLayout');
const { sendEmail } = require('../../../helpers');
const action = require('../../../helpers/accountAction');
const { HttpError } = require('../../../helpers');
const { translations } = require('./translations');

const verifiedEmail = async (req, res) => {
  const { user } = req;
  if (!user.email) throw HttpError(400, 'Email is required');
  const issued = await action.issue(user, 'emailVerification');
  if (!issued) throw HttpError(429, 'Please wait before requesting another email');
  const language = ['cs', 'en', 'uk'].includes(user.language) ? user.language : 'cs';
  const copy = translations[language];
  const origin = (process.env.FRONTEND_URL || 'https://anirakids.cz').replace(/\/+$/, '');
  const confirmationUrl = `${origin}/confirmEmail?verifyToken=${issued.token}`;
  // Presentation tables and inline styles survive email-client HTML sanitization.
  try { await sendEmail({
    to: user.email,
    subject: copy.email_confirmation,
    text: `${copy.email_confirmation}\n\n${copy.confirmation_message.replace(/<br\s*\/?>/g, '\n')}\n\n${copy.confirm_button}: ${confirmationUrl}\n\nANIRAK · GlamGarb Rentals s.r.o.`,
    html: emailLayout({title:copy.email_confirmation,language,body:`<p>${escapeHtml(copy.confirmation_message).replace(/&lt;br\s*\/?&gt;/g,'<br>')}</p><p style="text-align:center;margin:28px 0;"><a href="${escapeHtml(confirmationUrl)}" style="display:inline-block;padding:16px 24px;border-radius:4px;background:#7b6152;color:#ffffff;font-weight:bold;text-decoration:none;">${escapeHtml(copy.confirm_button)}</a></p>`}),
  });
  } catch (error) { await action.revoke(user, 'emailVerification', issued.hash); throw error; }
  res.status(200).json({ message: 'Email confirmation sent successfully.' });
};
module.exports = verifiedEmail;
