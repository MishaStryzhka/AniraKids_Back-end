const publicUser = require('../../helpers/publicUser');
const { HttpError } = require('../../helpers');
const { User } = require('../../models');

const getCurrentUser = async (req, res, next) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    return next(HttpError(401, 'Not authorized'));
  }

  res.set('Cache-Control', 'no-store');
  res.status(200).json({
    user: publicUser(user),
  });
};

module.exports = getCurrentUser;
