const { ctrlWrapper } = require('../../helpers');
const addProdukt = require('./addProdukt');
const updateProdukt = require('./updateProduct');
const getCurrentUserProducts = require('./getCurrentUserProducts');
const getFavorites = require('./getFavorites');
const getPopular = require('./getPopular');
const getProductById = require('./getProductById');
const getProducts = require('./getProducts');
const removeProductById = require('./removeProductById');

module.exports = {
  addProdukt: ctrlWrapper(addProdukt),
  updateProdukt: ctrlWrapper(updateProdukt),
  getCurrentUserProducts: ctrlWrapper(getCurrentUserProducts),
  removeProductById: ctrlWrapper(removeProductById),
  getProducts: ctrlWrapper(getProducts),
  getFavorites: ctrlWrapper(getFavorites),
  getProductById: ctrlWrapper(getProductById),
  getPopular: ctrlWrapper(getPopular),
};
