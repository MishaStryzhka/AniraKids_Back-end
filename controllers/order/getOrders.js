const { Order } = require('../../models');

const getOrders = async (req, res, next) => {
  const { _id: userId } = req.user;

  const orders = await Order.find({ userId }).populate({
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
  console.log('orders', orders);

  const totalOrders = await Order.find({ userId }).length;

  res.status(201).json({ totalOrders, orders });
};

module.exports = getOrders;
