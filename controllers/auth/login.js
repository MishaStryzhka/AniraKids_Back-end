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

  const passwordCompare = await bcrypt.compare(password, user.password);
  if (!passwordCompare) {
    throw HttpError(401, 'login or password is wrong');
  }

  const payload = {
    id: user._id,
  };

  const token = jwt.sign(payload, SECRET_KEY, { expiresIn: '23h' });
  await User.findByIdAndUpdate(user._id, { token });
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

      billingDetails: user.billingDetails,
      bankAccount: user.bankAccount,
    },
    token: token,
  });
};

module.exports = login;
