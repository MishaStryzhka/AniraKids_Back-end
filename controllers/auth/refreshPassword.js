const bcrypt = require('bcrypt');

const { HttpError } = require('../../helpers');
const { User } = require('../../models');

const refreshPassword = async (req, res) => {
  const { password: reqOldPassword, newPassword } = req.body;
  const { password: currentPassword } = req.user;

  const passwordCompare = await bcrypt.compare(reqOldPassword, currentPassword);

  if (!passwordCompare) {
    throw HttpError(409, 'Not correct password');
  }

  const user = await User.findById(req.user._id);

  if (!user) {
    throw HttpError(401, 'Not authorized');
  }

  const hashPassword = await bcrypt.hash(newPassword, 10);

  const updatedUser = await User.findByIdAndUpdate(
    user._id,
    { password: hashPassword },
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

module.exports = refreshPassword;
