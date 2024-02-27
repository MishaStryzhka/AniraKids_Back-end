const { ctrlWrapper } = require('../../helpers');
const addToOrder = require('./addToOrder');
const getOrders = require('./getOrders');

module.exports = {
  addToOrder: ctrlWrapper(addToOrder),
  getOrders: ctrlWrapper(getOrders),
};
