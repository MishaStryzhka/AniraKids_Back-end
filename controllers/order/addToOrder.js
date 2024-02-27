const Order = require('../../models/order');

const addToOrder = async (req, res) => {
  const {
    body: { productId, serviceType, price, owner },
    user: { _id: userId },
  } = req;

  let currentOrder = await Order.findOne({
    userId: userId,
    items: { $elemMatch: { owner: owner, serviceType: serviceType } },
  });

  // Якщо замовлення не знайдено, створюємо нове
  if (!currentOrder) {
    currentOrder = new Order({
      userId,
      items: [{ product: productId, serviceType, price, quantity: 1, owner }],
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
      serviceType,
      price,
      quantity: 1,
      owner,
    });
  }
  await currentOrder.save();
  res.status(200).json(currentOrder);
};

module.exports = addToOrder;
