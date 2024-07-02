const { User } = require('../../models');
const Order = require('../../models/order');

const addToOrder = async (req, res, next) => {
  const {
    body: {
      productId,
      serviceType,
      price,
      owner,
      rentalPeriods,
      typeRent,
      pickupAddress,
    },
    user: { _id: userId },
  } = req;

  let currentOrder = await Order.findOne({
    userId: userId,
    owner: owner,
    serviceType: serviceType,
    rentalPeriods: rentalPeriods,
    typeRent: typeRent,
  });

  if (!currentOrder) {
    currentOrder = new Order({
      userId,
      serviceType,
      items: [
        {
          product: productId,
          price,
          quantity: 1,
        },
      ],
      quantityHours: typeRent === 'photosession' ? 5 : null,
      owner,
      rentalPeriods,
      pickupAddress,
      typeRent,
    });
  } else if (
    currentOrder.items.some(item => item.product.toString() === productId)
  ) {
    if (serviceType === 'rent') {
      res.status(409).json({
        message: 'Product already exists in the order',
        orderId: currentOrder._id,
      });
    } else {
      const existingItem = currentOrder.items.find(
        item => item.product.toString() === productId
      );
      existingItem.quantity++;
    }
  } else {
    currentOrder.items.push({
      product: productId,
      price,
      quantity: 1,
    });
  }

  await currentOrder.save();

  const user = await User.findById(userId);

  res.status(200).json({ currentOrder, userCart: user.cart });
};

module.exports = addToOrder;
