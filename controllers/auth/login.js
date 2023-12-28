const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const { HttpError } = require('../../helpers');
const { User } = require('../../models');

const { SECRET_KEY } = process.env;

const login = async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });

  if (!user) {
    throw HttpError(401, 'Email or password is wrong');
  }

  const passwordCompare = await bcrypt.compare(password, user.password);
  if (!passwordCompare) {
    throw HttpError(401, 'Email or password is wrong');
  }

  const payload = {
    id: user._id,
  };

  const token = jwt.sign(payload, SECRET_KEY, { expiresIn: '23h' });
  await User.findByIdAndUpdate(user._id, { token, isFirstLogin: false });
  req.user = user;

  res.status(201).json({
    user: {
      name: user.name,
      email: user.email,
      userType: user.userType,
      isFirstLogin: !user.isFirstLogin,
      token: token,
    },
  });
};

module.exports = login;
