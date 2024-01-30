const { ctrlWrapper } = require('../../helpers');
const register = require('./register');
const login = require('./login');
const logout = require('./logout');
const getCurrentUser = require('./getCurrentUser');
const getUserById = require('./getUserById');
const updateCurrentUser = require('./updateCurrentUser');
const deleteById = require('./deleteById');
const refreshPassword = require('./refreshPassword');
const refreshEmail = require('./refreshEmail');
const confirmEmail = require('./confirmEmail');
const updateCurrentUserBillingDetails = require('./updateCurrentUserBillingDetails');

const googleAuth = require('./googleAuth');

module.exports = {
  register: ctrlWrapper(register),
  login: ctrlWrapper(login),
  logout: ctrlWrapper(logout),
  getCurrentUser: ctrlWrapper(getCurrentUser),
  getUserById: ctrlWrapper(getUserById),
  updateCurrentUser: ctrlWrapper(updateCurrentUser),
  googleAuth: ctrlWrapper(googleAuth),
  deleteById: ctrlWrapper(deleteById),
  refreshPassword: ctrlWrapper(refreshPassword),
  refreshEmail: ctrlWrapper(refreshEmail),
  confirmEmail: ctrlWrapper(confirmEmail),
  updateCurrentUserBillingDetails: ctrlWrapper(updateCurrentUserBillingDetails),
};
