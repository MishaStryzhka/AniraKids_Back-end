const User = require('../models/user');

const setOrderIdInUsersCart = async function (next) {
  try {
    const user = await User.findById(this.userId);

    if (!user) {
      throw new Error('User not found');
    }

    if (!user.cart.includes(this._id)) {
      user.cart.push(this._id);
      await user.save();
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = setOrderIdInUsersCart;
