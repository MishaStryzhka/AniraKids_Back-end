const { default: axios } = require('axios');
const { User } = require('../../models');
const jwt = require('jsonwebtoken');
const { HttpError } = require('../../helpers');
const publicUser = require('../../helpers/publicUser');

module.exports = async (req, res) => {
  const { code, redirect_uri } = req.body || {};
  const redirects = ['https://anirakids.cz', 'https://www.anirakids.cz'];
  if (process.env.NODE_ENV === 'development') redirects.push('http://localhost:3000');
  if (typeof code !== 'string' || !code || code.length > 4096 || !redirects.includes(redirect_uri))
    throw HttpError(400, 'Invalid Seznam sign-in request');
  const { SECRET_KEY, SEZNAM_CLIENT_SECRET, SEZNAM_CLIENT_ID } = process.env;
  if (!SECRET_KEY || !SEZNAM_CLIENT_SECRET || !SEZNAM_CLIENT_ID)
    throw HttpError(503, 'Seznam sign-in is temporarily unavailable');
  let identity;
  try {
    const result = await axios.post('https://login.szn.cz/api/v1/oauth/token', {
      grant_type: 'authorization_code', code, redirect_uri,
      client_secret: SEZNAM_CLIENT_SECRET, client_id: SEZNAM_CLIENT_ID,
    }, { timeout: 10000, headers: { Accept: 'application/json' } });
    if (typeof result.data.access_token !== 'string' || !result.data.access_token) throw new Error('Missing token');
    const profile = await axios.get('https://login.szn.cz/api/v1/user', {
      timeout: 10000, headers: { Authorization: `Bearer ${result.data.access_token}`, Accept: 'application/json' },
    });
    identity = profile.data;
  } catch {
    // Never expose upstream request configuration, client secret or provider token.
    throw HttpError(401, 'Seznam sign-in could not be completed. Please try again.');
  }
  if (typeof identity?.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email))
    throw HttpError(400, 'Your Seznam account must provide an email address');
  const email = identity.email.trim().toLowerCase();
  let user = await User.findOne({ seznamEmail: email }) || await User.findOne({ email });
  if (!user) {
    try { user = await User.create({ email, seznamEmail: email, provider: 'seznam', language: 'cs' }); }
    catch (error) {
      if (error.code !== 11000) throw error;
      user = await User.findOne({ seznamEmail: email }) || await User.findOne({ email });
      if (!user) throw error;
    }
  }
  if (user.seznamEmail && user.seznamEmail !== email) throw HttpError(409, 'Seznam account is already linked');
  user.seznamEmail = email;
  const token = jwt.sign({ id: user._id }, SECRET_KEY, { expiresIn: '23h' });
  const userAgent = req.headers['user-agent'] || '';
  const device = {
    userAgent,
    platform: req.headers['sec-ch-ua-platform'] || userAgent.match(/\(([^)]+)\)/)?.[1] || 'unknown',
    host: req.headers.origin || '',
  };
  const index = user.tokens.findIndex(item => item.device?.userAgent === device.userAgent && item.device?.platform === device.platform && item.device?.host === device.host);
  if (index >= 0) { user.tokens[index].token = token; user.tokens[index].lastLogin = new Date(); }
  else user.tokens.push({ token, device, lastLogin: new Date() });
  // Signing in changes the session only, not legacy profile fields.
  await user.save({ validateModifiedOnly: true });
  res.set('Cache-Control', 'no-store');
  return res.status(201).json({ user: publicUser(user), token });
};
