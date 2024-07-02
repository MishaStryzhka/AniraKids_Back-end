const User = require('../models/user');

const removeOrderIdInUsersCart = async function (next) {
  try {
    const order = await this.model.findOne(this.getFilter());
    if (!order) {
      throw new Error('Order not found');
    }

    const user = await User.findById(order.userId);
    if (!user) {
      throw new Error('User not found');
    }
    user.cart = user.cart.filter(cartOrder => {
      return !cartOrder?.equals(order._id);
    });
    await user.save();

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = removeOrderIdInUsersCart;
