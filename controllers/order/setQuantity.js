const { HttpError } = require('../../helpers');
const { Order } = require('../../models');

const setQuantity = async (req, res, next) => {
  const { _id: userId } = req.user;
  const { productId, quantity } = req.body;

  const order = await Order.findOne({
    userId,
    'items._id': productId,
  })
    .populate({
      path: 'items',
      select: 'product serviceType quantity price owner',
      populate: [
        {
          path: 'owner',
          select: 'nickname',
        },
        {
          path: 'product',
          select: 'photos name price status',
        },
      ],
    })
    .populate('owner', 'nickname');

  if (!order) {
    next(HttpError(404, 'Order not found'));
  }

  // Оновлення кількості товарів в замовленні
  const updatedItem = order.items.find(item => item._id.equals(productId));

  if (updatedItem) {
    updatedItem.quantity = quantity;
    await order.save();
    res.status(201).json({ order, updatedItem });
  } else {
    next(HttpError(404, 'Item not found in order'));
  }
};

module.exports = setQuantity;
