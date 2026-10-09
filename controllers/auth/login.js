const bcrypt = require('bcrypt');
const { HttpError } = require('../../helpers');
const { User } = require('../../models');
const publicUser = require('../../helpers/publicUser');
const createUserSession = require('../../helpers/createUserSession');
module.exports = async (req, res) => {
  const login = req.body.login.trim();
  const user = await User.findOne(login.includes('@') ? { email: login.toLowerCase() } : { primaryPhoneNumber: login });
  if (!user?.password || !await bcrypt.compare(req.body.password, user.password)) throw HttpError(401, 'login or password is wrong');
  const token = await createUserSession(user, req);
  res.set('Cache-Control', 'no-store');
  res.status(201).json({ user: publicUser(user), token });
};
