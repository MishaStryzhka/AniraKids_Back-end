const { calculateDays } = require('../../helpers');
const Order = require('../../models/order');

const addToOrder = async (req, res) => {
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
          quantity: rentalPeriods ? calculateDays(rentalPeriods) : 1,
        },
      ],
      owner,
      rentalPeriods,
      pickupAddress,
      typeRent,
      // expireAt:
    });
  } else if (
    currentOrder.items.some(item => item.product.toString() === productId)
  ) {
    const existingItem = currentOrder.items.find(
      item => item.product.toString() === productId
    );
    existingItem.quantity++;
  } else {
    currentOrder.items.push({
      product: productId,
      price,
      quantity: 1,
    });
  }
  await currentOrder.save();
  res.status(200).json(currentOrder);
};

module.exports = addToOrder;
