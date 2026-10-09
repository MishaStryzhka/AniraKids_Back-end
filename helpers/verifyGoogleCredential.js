const axios = require('axios');
const jwt = require('jsonwebtoken');
let certificates;
let expiresAt = 0;
let pending;

async function googleCertificates() {
  if (certificates && Date.now() < expiresAt) return certificates;
  if (!pending) pending = axios.get('https://www.googleapis.com/oauth2/v1/certs', { timeout: 10000 })
    .then(({ data, headers }) => {
      certificates = data;
      const seconds = Number(/max-age=(\d+)/.exec(headers['cache-control'] || '')?.[1] || 300);
      expiresAt = Date.now() + Math.min(seconds, 21600) * 1000;
      return data;
    }).finally(() => { pending = undefined; });
  return pending;
}

module.exports = async function verifyGoogleCredential(credential, audience) {
  // Decode ONLY to select Google's signing certificate; no claims are trusted yet.
  const unverified = jwt.decode(credential, { complete: true });
  if (unverified?.header.alg !== 'RS256' || typeof unverified.header.kid !== 'string') throw new Error('Invalid Google credential');
  const keys = await googleCertificates();
  if (!Object.prototype.hasOwnProperty.call(keys, unverified.header.kid)) throw new Error('Unknown Google signing key');
  const identity = jwt.verify(credential, keys[unverified.header.kid], {
    algorithms: ['RS256'], audience, issuer: ['accounts.google.com', 'https://accounts.google.com'],
  });
  if (!Number.isFinite(identity.exp) || !Number.isFinite(identity.iat) || identity.iat > Date.now() / 1000 + 60 ||
      typeof identity.sub !== 'string' || !identity.sub || identity.email_verified !== true ||
      typeof identity.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email)) throw new Error('Incomplete Google identity');
  return identity;
};
