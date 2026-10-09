const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { generateKeyPairSync } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
let requests = 0;
const context = { module: { exports: {} }, require: name => name === 'axios' ? { get: async url => {
  assert.equal(url, 'https://www.googleapis.com/oauth2/v1/certs'); requests++;
  return { data: { fixture: publicKey.export({ type: 'spki', format: 'pem' }) }, headers: { 'cache-control': 'max-age=3600' } };
} } : require(name) };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../helpers/verifyGoogleCredential.js'), 'utf8'), context);
const verify = context.module.exports;
function sign(overrides = {}, options = {}) {
  const payload = { sub: 'fixture-sub', email: 'fixture@gmail.com', email_verified: true,
    aud: 'fixture-client', iss: 'https://accounts.google.com', exp: Math.floor(Date.now()/1000) + 3600, ...overrides };
  for (const key of Object.keys(payload)) if (payload[key] === undefined) delete payload[key];
  return jwt.sign(payload, privateKey, { algorithm: 'RS256', keyid: 'fixture', ...options });
}
(async () => {
  assert.equal((await verify(sign(), 'fixture-client')).sub, 'fixture-sub');
  await verify(sign(), 'fixture-client'); assert.equal(requests, 1);
  for (const payload of [{ aud: 'another-client' }, { iss: 'attacker.invalid' }, { exp: 1 },
    { exp: undefined }, { sub: undefined }, { email_verified: false }, { iat: Math.floor(Date.now()/1000)+3600 }])
    await assert.rejects(verify(sign(payload), 'fixture-client'));
  await assert.rejects(verify(sign({}, { keyid: 'unknown' }), 'fixture-client'));
  await assert.rejects(verify(jwt.sign({ email: 'fixture@gmail.com' }, 'forged'), 'fixture-client'));
  const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const forged = jwt.sign({ sub: 'fake' }, otherKey, { algorithm: 'RS256', keyid: 'fixture' });
  await assert.rejects(verify(forged, 'fixture-client'));
  console.log('PASS: Google signature, audience, issuer, expiry, issued-at, subject, verified email, algorithm and certificate cache');
})().catch(error => { console.error(error); process.exitCode = 1; });
