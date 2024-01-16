const { HttpError } = require('../../helpers');
const { User } = require('../../models');

const getCurrentUser = async (req, res, next) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    next(HttpError(401, 'Not authorized'));
  }

  res.status(200).json({
    user: {
      avatar: user.avatar,
      firstName: user.firstName,
      lastName: user.lastName,
      patronymic: user.patronymic,
      companyName: user.companyName,
      ico: user.ico,
      nickname: user.nickname,
      email: user.email,
      emailVerified: user.emailVerified,
      primaryPhoneNumber: user.primaryPhoneNumber,
      primaryPhoneNumberVerified: user.primaryPhoneNumberVerified,
      provider: user.provider,
    },
  });
};

module.exports = getCurrentUser;
