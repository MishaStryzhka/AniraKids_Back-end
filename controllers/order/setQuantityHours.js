const { Order } = require('../../models');

const setQuantityHours = async (req, res, next) => {
  const { _id: userId } = req.user;
  const { orderId, quantityHours } = req.body;

  const order = await Order.findOne({
    userId,
    orderId,
  }).populate({
    path: 'items',
    select: 'product serviceType quantity price owner',
    populate: [
      {
        path: 'owner',
        select: 'nickname',
      },
      {
        path: 'product',
        select: 'photos name price',
      },
    ],
  });

  if (!order) {
    next(HttpError(404, 'Order not found'));
  }

  order.quantityHours = quantityHours;
  await order.save();

  res.status(201).json({ order });
};

module.exports = setQuantityHours;
