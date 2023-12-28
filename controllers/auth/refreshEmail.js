const { HttpError } = require('../../helpers');
const { User } = require('../../models');

const refreshEmail = async (req, res) => {
  const { email: reqOldEmail, newEmail } = req.body;
  const { email: currentEmail } = req.user;

  if (reqOldEmail !== currentEmail) {
    throw HttpError(409, 'Not correct email');
  }

  if (newEmail === currentEmail) {
    throw HttpError(409, 'Email in use');
  }

  const user = await User.findById(req.user._id);

  if (!user) {
    throw HttpError(401, 'Not authorized');
  }

  const updatedUser = await User.findByIdAndUpdate(
    user._id,
    { email: newEmail },
    {
      new: true,
    }
  );

  res.status(200).json({
    user: {
      userID: updatedUser.id,
      userType: updatedUser.userType,
      email: updatedUser.email,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      patronymic: updatedUser.patronymic,
      avatar: updatedUser.avatar,
    },
  });
};

module.exports = refreshEmail;
