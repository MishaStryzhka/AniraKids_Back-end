const { Order } = require('../../models');

const setQuantity = async (req, res, next) => {
  const { _id: userId } = req.user;
  const { productId, quantity } = req.body;

  const updatedOrder = await Order.findOneAndUpdate(
    { userId, 'items._id': productId },
    {
      $set: {
        'items.$.quantity': quantity,
      },
    },
    { new: true, upsert: true }
  ).populate({
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

  const updatedItem = updatedOrder.items.find(
    item => item._id.toString() === productId
  );

  res.status(201).json({ updatedItem });
};

module.exports = setQuantity;
