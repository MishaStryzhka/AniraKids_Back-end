const { Order } = require('../../models');

const orderConfirmByUser = async (req, res, next) => {
  const { orderId } = req.params;
  const { address, deliveryService, email, firstName, lastName, phoneNumber } =
    req.body;
  console.log(
    'address, deliveryService, email, firstName, lastName, phoneNumber',
    address,
    deliveryService,
    email,
    firstName,
    lastName,
    phoneNumber
  );

  const order = await Order.findOne({
    _id: orderId,
  });

  if (!order) {
    return res.status(404).json({ message: 'Order not found' });
  }

  // update status and add recipient
  order.status = 'pending by owner';

  order.deliveryService = deliveryService;

  order.recipient = { firstName, lastName, phoneNumber, email, address };
  await order.save();

  res.status(200).json({ message: 'Order confirmed', order });
};

module.exports = orderConfirmByUser;
