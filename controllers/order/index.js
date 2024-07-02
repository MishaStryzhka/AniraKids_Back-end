const { ctrlWrapper } = require('../../helpers');
const addToOrder = require('./addToOrder');
const getOrders = require('./getOrders');
const removeOrder = require('./removeOrder');
const removeProductFromOrder = require('./removeProductFromOrder');
const setQuantity = require('./setQuantity');
const setQuantityHours = require('./setQuantityHours');

module.exports = {
  addToOrder: ctrlWrapper(addToOrder),
  getOrders: ctrlWrapper(getOrders),
  setQuantity: ctrlWrapper(setQuantity),
  removeOrder: ctrlWrapper(removeOrder),
  removeProductFromOrder: ctrlWrapper(removeProductFromOrder),
  setQuantityHours: ctrlWrapper(setQuantityHours),
};
