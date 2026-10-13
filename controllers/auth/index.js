const { ctrlWrapper } = require('../../helpers');
const register = require('./register');
const login = require('./login');
const logout = require('./logout');
const getCurrentUser = require('./getCurrentUser');
const updateCurrentUser = require('./updateCurrentUser');
const deleteById = require('./deleteById');
const refreshPassword = require('./refreshPassword');
const refreshEmail = require('./refreshEmail');
const confirmEmail = require('./confirmEmail');

const googleAuth = require('./googleAuth');
const verifiedEmail = require('./verifiedEmail/verifiedEmail');
const authByGoogle = require('./authByGoogle');
const authBySeznam = require('./authBySeznam');

module.exports = {
  register: ctrlWrapper(register),
  login: ctrlWrapper(login),
  logout: ctrlWrapper(logout),
  getCurrentUser: ctrlWrapper(getCurrentUser),
  updateCurrentUser: ctrlWrapper(updateCurrentUser),
  googleAuth: ctrlWrapper(googleAuth),
  deleteById: ctrlWrapper(deleteById),
  refreshPassword: ctrlWrapper(refreshPassword),
  refreshEmail: ctrlWrapper(refreshEmail),
  confirmEmail: ctrlWrapper(confirmEmail),
  verifiedEmail: ctrlWrapper(verifiedEmail),
  authByGoogle: ctrlWrapper(authByGoogle),
  authBySeznam: ctrlWrapper(authBySeznam),
};
