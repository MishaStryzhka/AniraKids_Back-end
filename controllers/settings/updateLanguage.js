const { HttpError } = require('../../helpers');
const { User } = require('../../models');

const updateLanguage = async (req, res, next) => {
  const { _id } = req.user;
  const user = await User.findById(_id);

  console.log('req', req.query);

  if (!user) {
    next(HttpError(401, 'Not authorized'));
  }

  const updatedUser = await User.findByIdAndUpdate(
    _id,
    { ...req.query },
    {
      new: true,
    }
  );

  console.log('updatedUser', updatedUser);

  res.status(200).json({
    user: {
      userID: updatedUser._id,
      isFirstLogin: updatedUser.isFirstLogin,
      avatar: updatedUser.avatar,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      patronymic: updatedUser.patronymic,
      companyName: updatedUser.companyName,
      ico: updatedUser.ico,
      nickname: updatedUser.nickname,
      primaryPhoneNumber: updatedUser.primaryPhoneNumber,
      email: updatedUser.email,
      emailVerified: updatedUser.emailVerified,
      primaryPhoneNumberVerified: updatedUser.primaryPhoneNumberVerified,
      provider: updatedUser.provider,
      language: updatedUser.language,
    },
  });
};

module.exports = updateLanguage;
