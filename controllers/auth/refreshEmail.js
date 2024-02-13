const { HttpError, sendEmail } = require('../../helpers');
// const sendEmail = require('../../helpers/sendEmail');
const { User } = require('../../models');

const refreshEmail = async (req, res) => {
  const {
    query: { email },
    user,
  } = req;

  if (await User.findOne({ email })) {
    throw HttpError(409, 'Email in use');
  }

  sendEmail({
    to: email,
    text: `Добрий день ${user?.name ? user?.name : ''},

    Ми отримали запит на зміну вашої електронної пошти на нашому сайті. Для завершення цього процесу, будь ласка, перейдіть за посиланням нижче:
    
    ${process.env.FRONTEND_URL}/confirmEmail?token=${user.token}
    
    Якщо ви не ініціювали цю зміну, проігноруйте цей лист.
    
    Дякуємо за використання нашого сайту.
    
    З повагою,
    Команда AniraKids`,
  });

  // ================
  // ===SEZNAM.CZ====
  // ================

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
      companyName: updatedUser.companyName,
      nickname: updatedUser.nickname,
      email: updatedUser.email,
      emailVerified: updatedUser.emailVerified,
      primaryPhoneNumber: updatedUser.primaryPhoneNumber,
      primaryPhoneNumberVerified: updatedUser.primaryPhoneNumberVerified,
      provider: updatedUser.provider,
      typeUser: updatedUser.typeUser,
    },
  });
};

module.exports = refreshEmail;
