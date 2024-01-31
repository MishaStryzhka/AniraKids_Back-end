const { HttpError } = require('../../helpers');
const { User } = require('../../models');

const updateCurrentUserBillingDetails = async (req, res, next) => {
  const { _id } = req.user;

  const user = await User.findById(_id);
  if (!user) {
    next(HttpError(401, 'Not authorized'));
  }

  //   -> Set / Update User nickname

  const updatedUser = await User.findByIdAndUpdate(
    _id,
    { typeUser: 'owner', billingDetails: { ...req.body }, isFirstLogin: false },
    {
      new: true,
    }
  );

  res.status(200).json({
    billingDetails: updatedUser.billingDetails,
  });
};

module.exports = updateCurrentUserBillingDetails;
