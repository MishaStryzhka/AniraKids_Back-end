// No network or credentials: verifies that callers cannot report false success.
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
let message, resolveSend, rejectSend, smtpOptions;
let sendgridCalls = 0;
Module._load = function (id, ...args) {
  if (id === '@sendgrid/mail') return {
    setApiKey() {},
    send(value) {
      sendgridCalls += 1;
      message = value;
      return new Promise((resolve, reject) => { resolveSend = resolve; rejectSend = reject; });
    },
  };
  if (id === 'nodemailer') return {
    createTransport(options) {
      smtpOptions = options;
      return { sendMail(value) {
        message = value;
        return new Promise((resolve, reject) => { resolveSend = resolve; rejectSend = reject; });
      } };
    },
  };
  return originalLoad.call(this, id, ...args);
};
const sendEmail = require('../helpers/sendEmail');
Module._load = originalLoad;
(async () => {
  delete process.env.EMAIL_PROVIDER;
  delete process.env.SENDGRID_API_KEY;
  await assert.rejects(sendEmail({ to: 'test@example.test' }), /not configured/);
  process.env.SENDGRID_API_KEY = 'unit-test-not-a-credential';
  delete process.env.EMAIL_FROM;
  delete process.env.EMAIL_REPLY_TO;
  let settled = false;
  const pending = sendEmail({ to: 'test@example.test', subject: 'Test', text: 'Test' }).then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(message.from, 'no-reply@anirakids.cz');
  assert.equal(message.replyTo, 'rezervace@anirakids.cz');
  resolveSend(); await pending;
  const failed = sendEmail({ to: 'test@example.test' });
  rejectSend(new Error('private provider payload'));
  await assert.rejects(failed, error => error.message === 'Email provider did not accept the message');
  const previousCalls = sendgridCalls;
  process.env.EMAIL_PROVIDER = 'seznam';
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;
  await assert.rejects(sendEmail({ to: 'test@example.test' }), /not configured/);
  process.env.SMTP_USER = 'no-reply@anirakids.cz';
  await assert.rejects(sendEmail({ to: 'test@example.test' }), /not configured/);
  process.env.SMTP_PASSWORD = 'unit-test-not-a-credential';
  settled = false;
  const smtpPending = sendEmail({ to: 'test@example.test', subject: 'SMTP test', text: 'Test' })
    .then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(smtpOptions.host, 'smtp.seznam.cz');
  assert.equal(smtpOptions.port, 465);
  assert.equal(smtpOptions.secure, true);
  assert.deepEqual(smtpOptions.auth, { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD });
  assert.equal(message.from, 'no-reply@anirakids.cz');
  assert.equal(message.replyTo, 'rezervace@anirakids.cz');
  resolveSend({ accepted: ['test@example.test'], rejected: [] });
  await smtpPending;
  const smtpFailed = sendEmail({ to: 'test@example.test' });
  rejectSend(new Error('private SMTP credentials'));
  await assert.rejects(smtpFailed, error => error.message === 'Email provider did not accept the message');
  for (const result of [{ accepted: [], rejected: ['test@example.test'] },
    { accepted: ['a@example.test'], rejected: ['b@example.test'] }]) {
    const rejected = sendEmail({ to: 'test@example.test' });
    resolveSend(result);
    await assert.rejects(rejected, /did not accept/);
  }
  assert.equal(sendgridCalls, previousCalls, 'SMTP never falls back to SendGrid');
  process.env.EMAIL_PROVIDER = 'unknown';
  await assert.rejects(sendEmail({ to: 'test@example.test' }), /not supported/);
  console.log('PASS: both providers, TLS configuration, awaited acceptance, sanitized failures, rejected recipients, no fallback');
})().catch(error => { console.error(error); process.exitCode = 1; });
