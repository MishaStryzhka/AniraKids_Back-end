const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const { HttpError } = require('../../helpers');
const { User } = require('../../models');

const { SECRET_KEY } = process.env;

const login = async (req, res) => {
  const { login: email, login: primaryPhoneNumber, password } = req.body;

  const user =
    (await User.findOne({ email })) ||
    (await User.findOne({ primaryPhoneNumber }));

  if (!user) {
    throw HttpError(401, 'login or password is wrong');
  }

  const passwordCompare =
    user.password && (await bcrypt.compare(password, user.password));
  if (!passwordCompare) {
    throw HttpError(401, 'login or password is wrong');
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

  req.user = user;

  res.status(201).json({
    user: {
      email: user.email,
      emailVerified: user.emailVerified,
      primaryPhoneNumber: user.primaryPhoneNumber,
      primaryPhoneNumberVerified: user.primaryPhoneNumberVerified,
      provider: user.provider,
      isFirstLogin: user.isFirstLogin,
      avatar: user.avatar,
      firstName: user.firstName,
      lastName: user.lastName,
      companyName: user.companyName,
      ico: user.ico,
      nickname: user.nickname,
      typeUser: user.typeUser,

      favorites: user?.favorites || [],

      billingDetails: user.billingDetails,
      bankAccount: user.bankAccount,
    },
    token: token,
  });
};

module.exports = login;
