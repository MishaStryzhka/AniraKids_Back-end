const { ctrlWrapper } = require('../../helpers');
const addToOrder = require('./addToOrder');

module.exports = {
  addToOrder: ctrlWrapper(addToOrder),
};
