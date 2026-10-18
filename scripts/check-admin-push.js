const assert = require('node:assert/strict');
const {generateKeyPairSync, verify} = require('node:crypto');
const {validPushEndpoint, pushVapidConfig, makeAuthorization, parsePushTopics, PUSH_TOPICS} = require('../build/v2/services/admin-push.service');

const pair = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
const privateJwk = pair.privateKey.export({format: 'jwk'});
process.env.V2_PUSH_VAPID_PUBLIC_KEY = Buffer.concat([
  Buffer.from([4]), Buffer.from(privateJwk.x, 'base64url'), Buffer.from(privateJwk.y, 'base64url'),
]).toString('base64url');
process.env.V2_PUSH_VAPID_PRIVATE_KEY = privateJwk.d;
process.env.V2_PUSH_VAPID_SUBJECT = 'mailto:glamgarbrentals@seznam.cz';

assert.deepEqual(PUSH_TOPICS,['fitting_created','fitting_payment_reported']);
assert.deepEqual(parsePushTopics(['fitting_created','fitting_payment_reported']),['fitting_created','fitting_payment_reported']);
assert.deepEqual(parsePushTopics(['fitting_payment_reported']),['fitting_payment_reported']);
assert.deepEqual(parsePushTopics([]),[]);
assert.equal(parsePushTopics(['new_reservation']),null);
assert.equal(parsePushTopics('fitting_payment_reported'),null);
assert.equal(parsePushTopics(['fitting_payment_reported','fitting_payment_reported']),null);
const cfg = pushVapidConfig();
assert.equal(cfg.enabled, true);
const endpoint = 'https://fcm.googleapis.com/fcm/send/abc1230123456789abcdef';
assert.equal(validPushEndpoint(endpoint), true);
assert.equal(validPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc1231234567890'), true);
assert.equal(validPushEndpoint('https://web.push.apple.com/3/device/abcdef123456789'), true);
assert.equal(validPushEndpoint('https://example.com/collect/abc1231234567890'), false);
assert.equal(validPushEndpoint('http://fcm.googleapis.com/fcm/send/abc1231234567890'), false);
assert.equal(validPushEndpoint('https://fcm.googleapis.com.evil.test/fcm/send/abc123'), false);
assert.equal(validPushEndpoint('https://user:pass@fcm.googleapis.com/fcm/send/abc1231234567890'), false);
assert.equal(validPushEndpoint('https://fcm.googleapis.com:8443/fcm/send/abc1231234567890'), false);

const auth = makeAuthorization(endpoint, cfg);
const match = /^vapid t=([^,]+), k=(.+)$/.exec(auth);
assert.ok(match, 'RFC8292 authorization header');
assert.equal(match[2], cfg.publicKey);
const [header, payload, signature] = match[1].split('.');
assert.deepEqual(JSON.parse(Buffer.from(header,'base64url').toString()), {typ:'JWT',alg:'ES256'});
const claims = JSON.parse(Buffer.from(payload,'base64url').toString());
assert.equal(claims.aud, 'https://fcm.googleapis.com');
assert.equal(claims.sub, process.env.V2_PUSH_VAPID_SUBJECT);
assert.ok(claims.exp > Date.now()/1000 && claims.exp <= Date.now()/1000 + 3601);
assert.equal(verify('sha256',Buffer.from(header+'.'+payload),
  {key:pair.publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')),true);
delete process.env.V2_PUSH_VAPID_PRIVATE_KEY;
assert.equal(pushVapidConfig().enabled,false);
console.log('ADMIN_PUSH_PROTOCOL=PASS');
