const { HttpError } = require('../../helpers');
const { User } = require('../../models');
const bcrypt = require('bcrypt');
const publicUser = require('../../helpers/publicUser');
const createUserSession = require('../../helpers/createUserSession');
module.exports = async (req, res) => {
  const { password, primaryPhoneNumber } = req.body;
  const email = req.body.email?.trim().toLowerCase();
  if (email && await User.exists({ email })) throw HttpError(409, 'Email in use');
  if (primaryPhoneNumber && await User.exists({ primaryPhoneNumber })) throw HttpError(409, 'Phone number in use');
  if (Buffer.byteLength(password, 'utf8') > 72) throw HttpError(400, 'Password is too long');
  let user;
  try {
    user = await User.create({ ...(email ? { email } : {}), ...(primaryPhoneNumber ? { primaryPhoneNumber } : {}), password: await bcrypt.hash(password, 10), provider: 'AniraKids', language: 'cs' });
  } catch (error) {
    if (error.code === 11000) throw HttpError(409, error.keyPattern?.email ? 'Email in use' : 'Phone number in use');
    throw error;
  }
  const token = await createUserSession(user, req);
  res.set('Cache-Control', 'no-store');
  res.status(201).json({ user: publicUser(user), token });
};
