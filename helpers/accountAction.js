const crypto = require('node:crypto');
const { User } = require('../models');
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const validToken = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
async function issue(user, field) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const value = { hash: hashToken(token), email: user.email, requestedAt: new Date(now), expiresAt: new Date(now + 30 * 60 * 1000) };
  const result = await User.updateOne({ _id: user._id, email: user.email, [`${field}.requestedAt`]: { $not: { $gt: new Date(now - 60000) } } }, { $set: { [field]: value } });
  return result.modifiedCount ? { token, hash: value.hash } : null;
}
async function revoke(user, field, hash) { await User.updateOne({ _id: user._id, [`${field}.hash`]: hash }, { $unset: { [field]: '' } }); }
module.exports = { hashToken, validToken, issue, revoke };
