const { Order } = require('../../models');

const getOrders = async (req, res, next) => {
  const { _id: userId } = req.user;

  const orders = await Order.find({ userId })
    .populate({
      path: 'items',
      select: 'product quantity price',
      populate: [
        {
          path: 'product',
          select: 'photos name price',
        },
      ],
    })
    .populate('owner', 'nickname');
  console.log('orders', orders);

  const totalOrders = await Order.find({ userId }).length;

  res.status(201).json({ totalOrders, orders });
};

module.exports = getOrders;
