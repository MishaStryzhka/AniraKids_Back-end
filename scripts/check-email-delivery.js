// No network or credentials: verifies that callers cannot report false success.
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
let message, resolveSend, rejectSend;
Module._load = function (id, ...args) {
  if (id === '@sendgrid/mail') return {
    setApiKey() {},
    send(value) {
      message = value;
      return new Promise((resolve, reject) => { resolveSend = resolve; rejectSend = reject; });
    },
  };
  return originalLoad.call(this, id, ...args);
};
const sendEmail = require('../helpers/sendEmail');
Module._load = originalLoad;
(async () => {
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
  console.log('PASS: sender configuration, awaited acceptance, sanitized delivery failure');
})().catch(error => { console.error(error); process.exitCode = 1; });
