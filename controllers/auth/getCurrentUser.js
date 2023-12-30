const { HttpError } = require('../../helpers');
const { User } = require('../../models');

const getCurrentUser = async (req, res, next) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    next(HttpError(401, 'Not authorized'));
  }

  const {
    id: userID,
    email,
    emailVerified,
    primaryPhoneNumber,
    primaryPhoneNumberVerified,
    provider,
  } = user;

  res.status(200).json({
    user: {
      userID,
      email,
      emailVerified,
      primaryPhoneNumber,
      primaryPhoneNumberVerified,
      provider,
    },
  });
};

module.exports = getCurrentUser;
