const { User } = require('../../models');
const jwt = require('jsonwebtoken');
const { HttpError } = require('../../helpers');
const publicUser = require('../../helpers/publicUser');
const verifyGoogleCredential = require('../../helpers/verifyGoogleCredential');

module.exports = async (req, res) => {
  const { credential } = req.body || {};
  if (typeof credential !== 'string' || !credential || credential.length > 16384)
    throw HttpError(400, 'Invalid Google sign-in request');
  const { SECRET_KEY, GOOGLE_CLIENT_ID } = process.env;
  if (!SECRET_KEY || !GOOGLE_CLIENT_ID) throw HttpError(503, 'Google sign-in is temporarily unavailable');
  let identity;
  try { identity = await verifyGoogleCredential(credential, GOOGLE_CLIENT_ID); }
  catch { throw HttpError(401, 'Google sign-in could not be verified. Please try again.'); }
  const email = identity.email.trim().toLowerCase();
  const authoritativeEmail = email.endsWith('@gmail.com') || !!identity.hd;
  let user = await User.findOne({ googleId: identity.sub });
  if (!user) user = await User.findOne({ email });
  if (user && user.googleId !== identity.sub && (user.googleId || !authoritativeEmail))
    throw HttpError(409, 'Sign in using your existing account method to link this email.');
  if (!user) {
    // Provider names may legitimately be shorter than the legacy profile minimum.
    const name = value => typeof value === 'string' && value.trim().length >= 3 ? value.trim() : undefined;
    try {
      user = await User.create({ email, googleId: identity.sub, provider: 'google', language: 'cs',
        firstName: name(identity.given_name), lastName: name(identity.family_name),
        avatar: typeof identity.picture === 'string' ? identity.picture : undefined });
    } catch (error) {
      if (error.code !== 11000) throw error;
      user = await User.findOne({ googleId: identity.sub }) || await User.findOne({ email });
      if (!user || (user.googleId !== identity.sub && (user.googleId || !authoritativeEmail))) throw error;
    }
  }
  user.googleId = identity.sub;
  const token = jwt.sign({ id: user._id }, SECRET_KEY, { expiresIn: '23h' });
  const userAgent = req.headers['user-agent'] || '';
  const device = { userAgent,
    platform: req.headers['sec-ch-ua-platform'] || userAgent.match(/\(([^)]+)\)/)?.[1] || 'unknown',
    host: req.headers.origin || '' };
  const index = user.tokens.findIndex(item => item.device?.userAgent === device.userAgent && item.device?.platform === device.platform && item.device?.host === device.host);
  if (index >= 0) { user.tokens[index].token = token; user.tokens[index].lastLogin = new Date(); }
  else user.tokens.push({ token, device, lastLogin: new Date() });
  await user.save({ validateModifiedOnly: true });
  res.set('Cache-Control', 'no-store');
  return res.status(201).json({ user: publicUser(user), token });
};
