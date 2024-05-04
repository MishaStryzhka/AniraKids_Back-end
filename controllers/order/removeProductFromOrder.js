const { Order } = require('../../models');

const removeProductFromOrder = async (req, res, next) => {
  const { _id: userId } = req.user;
  const { orderId, productId } = req.query;

  const order = await Order.findOne({
    userId: userId.toString(),
    _id: orderId,
  });

  if (!order || !order.items || order.items.length === 0) {
    return res.status(404).json({ message: 'Order not found or empty' });
  }

  order.items = order.items.filter(item => item._id.toString() !== productId);

  await order.save();

  res
    .status(200)
    .json({ message: 'Product successfully removed from order', order });
};

module.exports = removeProductFromOrder;
