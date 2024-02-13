const { HttpError } = require('../../helpers');
const { User } = require('../../models');

const updateCurrentUser = async (req, res, next) => {
  const { _id } = req.user;

  const user = await User.findById(_id);
  if (!user) {
    next(HttpError(401, 'Not authorized'));
  }

  // -> Set / Update User nickname
  const { nickname } = req.body;
  if (nickname && nickname !== user.nickname) {
    const userByNickname = await User.findOne({ nickname });
    if (userByNickname) {
      next(HttpError(409, 'Nickname must be unique'));
    }
  }

  // -> Set / Update User nickname
  const { email } = req.body;
  if (email) {
    const userByEmail = await User.findOne({ email });
    if (userByEmail) {
      next(HttpError(409, 'Email in use'));
    }
  }

  // -> Set / Update User Avatar
  if (req.files.avatar) {
    req.body.avatar = req.files.avatar[0].path;
    req.body.avatarPublicId = req.files.avatar[0].filename;
  }

  const updatedUser = await User.findByIdAndUpdate(
    _id,
    { ...req.body, isFirstLogin: false },
    {
      new: true,
    }
  );

  // console.log('updatedUser', updatedUser);

  res.status(200).json({
    user: {
      userID: updatedUser._id,
      isFirstLogin: updatedUser.isFirstLogin,
      avatar: updatedUser.avatar,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      companyName: updatedUser.companyName,
      ico: updatedUser.ico,
      nickname: updatedUser.nickname,
      primaryPhoneNumber: updatedUser.primaryPhoneNumber,
      email: updatedUser.email,
      emailVerified: updatedUser.emailVerified,
      primaryPhoneNumberVerified: updatedUser.primaryPhoneNumberVerified,
      provider: updatedUser.provider,
    },
  });
};

module.exports = updateCurrentUser;
