const { jwtDecode } = require('jwt-decode');
const { User } = require('../../models');
const jwt = require('jsonwebtoken');

const { SECRET_KEY } = process.env;

const authBySeznam = async (req, res) => {
  console.log('req.body', req.body);

  // eslint-disable-next-line no-unused-vars
  const { account_name: email } = req.body;

  let dataUser = await User.findOne({ email });
  if (!dataUser) {
    await User.create({
      email,
      provider: 'seznam',
    });

    dataUser = User.findOne({ email });
  }

  const payload = {
    id: dataUser._id,
  };

  const token = jwt.sign(payload, SECRET_KEY, { expiresIn: '23h' });

  await User.findByIdAndUpdate(dataUser._id, { token });

  const { createdAt, updatedAt, ...user } = dataUser._doc;

  console.log('user', user);

  res.status(201).json({
    user,
    token,
  });
};

module.exports = authBySeznam;
