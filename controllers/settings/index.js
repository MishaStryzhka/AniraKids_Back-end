const { ctrlWrapper } = require('../../helpers');
const updateLanguage = require('./updateLanguage');

module.exports = {
  updateLanguage: ctrlWrapper(updateLanguage),
};
