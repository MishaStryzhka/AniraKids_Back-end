// Run locally: node scripts/generate-web-push-keys.js
// Put both generated values in the backend host's environment. Never commit them.
const {generateKeyPairSync} = require('crypto');
const {privateKey} = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
const key = privateKey.export({format: 'jwk'});
const publicKey = Buffer.concat([
  Buffer.from([4]), Buffer.from(key.x, 'base64url'), Buffer.from(key.y, 'base64url'),
]).toString('base64url');
console.log('V2_PUSH_VAPID_PUBLIC_KEY=' + publicKey);
console.log('V2_PUSH_VAPID_PRIVATE_KEY=' + key.d);
console.log('V2_PUSH_VAPID_SUBJECT=mailto:glamgarbrentals@seznam.cz');
