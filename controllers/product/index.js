const { ctrlWrapper } = require('../../helpers');
const addProdukt = require('./addProdukt');
const getCurrentUserProducts = require('./getCurrentUserProducts');
const removeProductById = require('./removeProductById');

module.exports = {
  addProdukt: ctrlWrapper(addProdukt),
  getCurrentUserProducts: ctrlWrapper(getCurrentUserProducts),
  removeProductById: ctrlWrapper(removeProductById),
};
