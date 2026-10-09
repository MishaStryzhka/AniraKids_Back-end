const sgMail = require('@sendgrid/mail');
const nodemailer = require('nodemailer');

// Keep the current provider until SMTP credentials have been provisioned.
// Never automatically retry through another provider: acceptance can be ambiguous.
const sendEmail = async ({ to, text, html, subject }) => {
  const provider = process.env.EMAIL_PROVIDER || 'sendgrid';
  const message = {
    to,
    from: process.env.EMAIL_FROM || 'no-reply@anirakids.cz',
    replyTo: process.env.EMAIL_REPLY_TO || 'rezervace@anirakids.cz',
    subject, text, html,
  };
  if (!['sendgrid', 'seznam'].includes(provider)) {
    throw new Error('Email provider is not supported');
  }
  if (provider === 'seznam') {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
      throw new Error('Email delivery is not configured');
    }
    try {
      const transport = nodemailer.createTransport({
        host: 'smtp.seznam.cz', port: 465, secure: true,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
        logger: false, debug: false,
      });
      const result = await transport.sendMail(message);
      if (!result.accepted || result.accepted.length === 0 ||
          (result.rejected && result.rejected.length > 0)) {
        throw new Error('SMTP did not accept every recipient');
      }
    } catch (_error) {
      // Never expose SMTP authentication data or message contents to callers.
      throw new Error('Email provider did not accept the message');
    }
    return;
  }
  if (!process.env.SENDGRID_API_KEY) {
    throw new Error('Email delivery is not configured');
  }
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  try {
    await sgMail.send(message);
  } catch (_error) {
    throw new Error('Email provider did not accept the message');
  }
};

module.exports = sendEmail;
