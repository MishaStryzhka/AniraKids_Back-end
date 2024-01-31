const { HttpError } = require('../../helpers');
const { User } = require('../../models');

const getCurrentUser = async (req, res, next) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    next(HttpError(401, 'Not authorized'));
  }

  res.status(200).json({
    user: {
      userID: user._id,
      isFirstLogin: user.isFirstLogin,
      avatar: user.avatar,
      firstName: user.firstName,
      lastName: user.lastName,
      nickname: user.nickname,

      primaryPhoneNumber: user.primaryPhoneNumber,
      primaryPhoneNumberVerified: user.primaryPhoneNumberVerified,

      email: user.email,
      emailVerified: user.emailVerified,

      provider: user.provider,
      typeUser: user.typeUser,
      billingDetails: user.billingDetails,
      bankAccount: user.bankAccount,
    },
  });
};

module.exports = getCurrentUser;
