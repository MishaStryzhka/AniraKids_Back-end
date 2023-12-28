const { HttpError } = require('../../helpers');
const { User } = require('../../models');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const { SECRET_KEY } = process.env;

const register = async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });

  if (user) {
    throw HttpError(409, 'Email in use');
  }

  const hashPassword = await bcrypt.hash(password, 10);

  await User.create({
    ...req.body,
    password: hashPassword,
    // isFirstLogin: true,
  });

  const registeredUser = await User.findOne({ email });

  const payload = {
    id: registeredUser._id,
  };

  const token = jwt.sign(payload, SECRET_KEY, { expiresIn: '23h' });

  await User.findByIdAndUpdate(registeredUser._id, { token });
  req.user = registeredUser;

  res.status(201).json({
    user: {
      email: registeredUser.email,
      token,
      // firstLogin: registeredUser.isFirstLogin,
      userType: registeredUser.userType,
      userID: registeredUser.id,
    },
  });
};

module.exports = register;
