const { Order } = require('../../models');

const removeOrder = async (req, res, next) => {
  const { _id: userId } = req.user;
  const { orderId } = req.params;

  const result = await Order.deleteOne({ userId, 'items.id': orderId });

  if (result.deletedCount === 1) {
    res.status(200).json({ message: 'Order successfully removed' });
  } else {
    res.status(404).json({ message: 'Order not found or already removed' });
  }
};

module.exports = removeOrder;
