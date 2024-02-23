const { default: axios } = require('axios');
const { User } = require('../../models');
const jwt = require('jsonwebtoken');

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

  const { createdAt, updatedAt, token: _, ...user } = dataUser._doc;

  res.status(201).json({
    user,
    token,
  });
};

module.exports = authBySeznam;
