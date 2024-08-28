const { default: axios } = require('axios');
const { User } = require('../../models');
const jwt = require('jsonwebtoken');
const geoip = require('geoip-lite');

const { SECRET_KEY, SEZNAM_CLIENT_SECRET, SEZNAM_CLIENT_ID } = process.env;

const authBySeznam = async (req, res) => {
  // eslint-disable-next-line camelcase
  const { code, redirect_uri } = req.body;

  const resSeznam = await axios.post(
    'https://login.szn.cz/api/v1/oauth/token',
    {
      grant_type: 'authorization_code',
      code: code,
      redirect_uri,
      client_secret: SEZNAM_CLIENT_SECRET,
      client_id: SEZNAM_CLIENT_ID,
    }
  );

  const { account_name: email } = resSeznam.data;

  let user = await User.findOne({ email });
  if (!user) {
    await User.create({
      email,
      provider: 'seznam',
    });

    user = User.findOne({ email });
  }

  const payload = {
    id: user._id,
  };

  const token = jwt.sign(payload, SECRET_KEY, { expiresIn: '23h' });

  // ================ existing Device ====================
  const deviceInfo = {
    userAgent: req.headers['user-agent'],
    platform: req.headers['user-agent'].match(/\(([^)]+)\)/)[1],
    host: req.headers.origin,
  };

  const ip = req.headers['true-client-ip'] || req.connection.remoteAddress;
  const geo = geoip.lookup(ip);

  if (geo) {
    deviceInfo.location = {
      country: geo.country,
      city: geo.city,
    };
  } else {
    deviceInfo.location = 'Geolocation could not be determined.';
  }

  const existingDeviceIndex = user.tokens.findIndex(
    item =>
      item.device.userAgent === deviceInfo.userAgent &&
      item.device.platform === deviceInfo.platform &&
      item.device.host === deviceInfo.host
  );

  if (existingDeviceIndex !== -1) {
    user.tokens[existingDeviceIndex].token = token;
    user.tokens[existingDeviceIndex].lastLogin = new Date();
  } else {
    user.tokens.push({ token, device: deviceInfo, lastLogin: new Date() });
  }

  await user.save();

  const { createdAt, updatedAt, tokens, token: _, ...userData } = user._doc;

  res.status(201).json({
    user: userData,
    token,
  });
};

module.exports = authBySeznam;
