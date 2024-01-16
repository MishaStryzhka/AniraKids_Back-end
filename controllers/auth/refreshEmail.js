const { HttpError, sendConfirmationEmail } = require('../../helpers');
// const sendEmail = require('../../helpers/sendConfirmationEmail');
const { User } = require('../../models');

const refreshEmail = async (req, res) => {
  const {
    query: { email },
    user,
  } = req;

  if (await User.findOne({ email })) {
    throw HttpError(409, 'Email in use');
  }

  sendConfirmationEmail(
    email,
    `${process.env.FRONTEND_URL}/confirmEmail?token=${user.token}`
  );

  //================
  //===SEZNAM.CZ====
  //================

  // sendEmail({
  //   from: 'no-reply@anirakids.cz',
  //   to: email,
  //   subject: 'Confirm Email',
  //   text: `${process.env.FRONTEND_URL}/confirmEmail?token=${user.token}`,
  // });

  const updatedUser = await User.findByIdAndUpdate(
    user._id,
    { email, emailVerified: false },
    {
      new: true,
    }
  );

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

module.exports = refreshEmail;
