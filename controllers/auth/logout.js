const { HttpError } = require('../../helpers');
const { User } = require('../../models');

const logout = async (req, res, next) => {
  const { token } = req.user;
  const user = await User.findById(req.user._id);
  if (!user) {
    next(HttpError(401, 'Not authorized'));
  }

  user.tokens = user.tokens.filter(item => item.token !== token);

  await user.save();

  res.sendStatus(204);
};

module.exports = logout;
