const { jwtDecode } = require('jwt-decode');
const { User } = require('../../models');
const jwt = require('jsonwebtoken');
const geoip = require('geoip-lite');

const { SECRET_KEY } = process.env;

const authByGoogle = async (req, res) => {
  const { credential } = req.body;
  const decoded = jwtDecode(credential);

  // eslint-disable-next-line camelcase
  const { email, given_name, family_name, picture } = decoded;

  let user = await User.findOne({ email });
  if (!user) {
    await User.create({
      email,
      firstName: given_name,
      lastName: family_name,
      avatar: picture,
      provider: 'google',
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
    platform: req.headers['sec-ch-ua-platform'],
    host: req.headers.host,
  };

  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
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

  const { createdAt, updatedAt, token: _, ...userData } = user._doc;

  res.status(201).json({
    user: userData,
    token,
  });
};

module.exports = authByGoogle;
