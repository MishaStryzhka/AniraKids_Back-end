const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
let message;
Module._load = function (id, ...args) {
  if (id === '../../../helpers/accountAction') return { issue: async () => ({ token: 'a'.repeat(64), hash: 'fixture' }), revoke: async () => {} };
  if (id === '../../../helpers') return { sendEmail: async value => { message = value; } };
  return originalLoad.call(this, id, ...args);
};
const verifiedEmail = require('../controllers/auth/verifiedEmail/verifiedEmail');
Module._load = originalLoad;
(async () => {
  for (const language of [undefined, null, '', 'de', '__proto__', 'cs', 'uk', 'en']) {
    let status, response;
    await verifiedEmail({ user: { email: 'test@example.test', token: 'test-only', language } }, {
      status(value) { status = value; return this; }, json(value) { response = value; },
    });
    assert.equal(status, 200);
    assert.equal(response.message, 'Email confirmation sent successfully.');
    assert.equal(message.to, 'test@example.test');
    assert.ok(message.subject);
    assert.ok(message.html.includes('verifyToken='));
    assert.ok(!message.html.includes('test-only'));

    assert.ok(message.html.includes('https://anirakids.cz/ucet'));
    assert.ok(message.html.includes('https://anirakids.cz/saty'));
    assert.ok(!/forWomen|forMen|forChildren|decorAndToys|2023 - 2024/.test(message.html));
    const expected = ['cs', 'en', 'uk'].includes(language) ? language : 'cs';
    assert.ok(message.html.includes('<html lang="' + expected + '">'));
    if (expected === 'cs') assert.equal(message.subject, 'Potvrzení e-mailu');
  }
  console.log('PASS: verification mail supports missing/unknown languages and all supported locales');
})().catch(error => { console.error(error); process.exitCode = 1; });
