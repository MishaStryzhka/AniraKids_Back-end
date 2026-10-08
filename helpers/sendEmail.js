const sgMail = require('@sendgrid/mail');

// Configure the verified sender through deployment settings; never keep SMTP
// credentials in source. Callers must await delivery acceptance by the provider.
const sendEmail = async ({ to, text, html, subject }) => {
  if (!process.env.SENDGRID_API_KEY) {
    throw new Error('Email delivery is not configured');
  }
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  try {
    await sgMail.send({
      to,
      from: process.env.EMAIL_FROM || 'no-reply@anirakids.cz',
      replyTo: process.env.EMAIL_REPLY_TO || 'rezervace@anirakids.cz',
      subject,
      text,
      html,
    });
  } catch (_error) {
    // Provider errors may include request bodies, verification links or API data.
    throw new Error('Email provider did not accept the message');
  }
};

module.exports = sendEmail;
