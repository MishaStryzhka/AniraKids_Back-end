const { User } = require('../../models');

const confirmEmail = async (req, res) => {
  const { user } = req;

  const updatedUser = await User.findByIdAndUpdate(
    user._id,
    { emailVerified: true },
    {
      new: true,
    }
  );


  res.status(200).json({
    user: {
      avatar: updatedUser.avatar,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
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
