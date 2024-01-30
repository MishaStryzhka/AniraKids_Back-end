const { HttpError } = require('../../helpers');
const { User } = require('../../models');

const updateCurrentUserBillingDetails = async (req, res, next) => {
  const { _id } = req.user;

  const user = await User.findById(_id);
  if (!user) {
    next(HttpError(401, 'Not authorized'));
  }

  console.log('user', user);

  //   -> Set / Update User nickname

  const updatedUser = await User.findByIdAndUpdate(
    _id,
    { typeUser: 'owner', billingDetails: { ...req.body }, isFirstLogin: false },
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
      nickname: updatedUser.nickname,

      primaryPhoneNumber: updatedUser.primaryPhoneNumber,
      primaryPhoneNumberVerified: updatedUser.primaryPhoneNumberVerified,

      email: updatedUser.email,
      emailVerified: updatedUser.emailVerified,

      provider: updatedUser.provider,
      typeUser: updatedUser.typeUser,
      billingDetails: updatedUser.billingDetails,
    },
  });
};

module.exports = updateCurrentUserBillingDetails;
