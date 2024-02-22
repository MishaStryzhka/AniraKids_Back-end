const { jwtDecode } = require('jwt-decode');
const { User } = require('../../models');
const jwt = require('jsonwebtoken');

const { SECRET_KEY } = process.env;

const authByGoogle = async (req, res) => {
  const { credential } = req.body;
  const decoded = jwtDecode(credential);

  // eslint-disable-next-line camelcase
  const { email, given_name, family_name, picture } = decoded;

  let dataUser = await User.findOne({ email });
  if (!dataUser) {
    await User.create({
      email,
      firstName: given_name,
      lastName: family_name,
      avatar: picture,
      provider: 'google',
    });

    dataUser = User.findOne({ email });
  }

  const payload = {
    id: dataUser._id,
  };

  const token = jwt.sign(payload, SECRET_KEY, { expiresIn: '23h' });

  await User.findByIdAndUpdate(dataUser._id, { token });

  const { createdAt, updatedAt, token: _, ...user } = dataUser._doc;

  console.log('user', user);

  res.status(201).json({
    user,
    token,
  });
};

module.exports = authByGoogle;
