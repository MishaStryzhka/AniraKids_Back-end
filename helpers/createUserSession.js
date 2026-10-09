const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
module.exports = async (user, req) => {
  const token = jwt.sign({ id: user._id }, process.env.SECRET_KEY, { expiresIn: '23h', jwtid: crypto.randomUUID() });
  const device = { userAgent: req.headers['user-agent'] || '', platform: req.headers['sec-ch-ua-platform'] || 'unknown', host: req.headers.origin || '' };
  const index = user.tokens.findIndex(item => item.device?.userAgent === device.userAgent && item.device?.platform === device.platform && item.device?.host === device.host);
  const session = { token, device, lastLogin: new Date() };
  if (index >= 0) user.tokens[index] = session; else user.tokens.push(session);
  await user.save({ validateModifiedOnly: true });
  return token;
};
