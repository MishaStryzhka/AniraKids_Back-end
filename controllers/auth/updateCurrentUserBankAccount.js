const { HttpError } = require('../../helpers');
const { User } = require('../../models');

const updateCurrentUserBankAccount = async (req, res, next) => {
  const { _id } = req.user;

  const user = await User.findById(_id);
  if (!user) {
    next(HttpError(401, 'Not authorized'));
  }

  const updatedUser = await User.findByIdAndUpdate(
    _id,
    { bankAccount: { ...req.body }, isFirstLogin: false },
    {
      new: true,
    }
  );

  res.status(200).json({
    bankAccount: updatedUser.bankAccount,
  });
};

module.exports = updateCurrentUserBankAccount;
