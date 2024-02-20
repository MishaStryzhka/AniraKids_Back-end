const { ctrlWrapper } = require('../../helpers');
const addProdukt = require('./addProdukt');
const getCurrentUserProducts = require('./getCurrentUserProducts');
const getFavorites = require('./getFavorites');
const getProductById = require('./getProductById');
const getProducts = require('./getProducts');
const removeProductById = require('./removeProductById');

module.exports = {
  addProdukt: ctrlWrapper(addProdukt),
  getCurrentUserProducts: ctrlWrapper(getCurrentUserProducts),
  removeProductById: ctrlWrapper(removeProductById),
  getProducts: ctrlWrapper(getProducts),
  getFavorites: ctrlWrapper(getFavorites),
  getProductById: ctrlWrapper(getProductById),
};
