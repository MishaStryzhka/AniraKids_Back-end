const { User } = require('../../models');

const confirmEmail = async (req, res) => {
  const { user } = req;
  console.log('user', user);

  const updatedUser = await User.findByIdAndUpdate(
    user._id,
    { emailVerified: true },
    {
      new: true,
    }
  );

  console.log('updatedUser', updatedUser);

  res.status(200).json({
    user: {
      avatar: updatedUser.avatar,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      patronymic: updatedUser.patronymic,
      companyName: updatedUser.companyName,
      nickname: updatedUser.nickname,
      email: updatedUser.email,
      emailVerified: updatedUser.emailVerified,
      primaryPhoneNumber: updatedUser.primaryPhoneNumber,
      primaryPhoneNumberVerified: updatedUser.primaryPhoneNumberVerified,
      provider: updatedUser.provider,
    },
  });
};

module.exports = confirmEmail;
