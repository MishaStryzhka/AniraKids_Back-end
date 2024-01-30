const loginSchema = require('./loginSchema');
const registerSchema = require('./registerSchema');
const updateSchema = require('./updateSchema');
const refreshPasswordSchema = require('./refreshPasswordSchema');
const refreshEmailSchema = require('./refreshEmailSchema');
const updateBillingDetailsSchema = require('./updateBillingDetailsSchema');

module.exports = {
  loginSchema,
  registerSchema,
  updateSchema,
  refreshPasswordSchema,
  refreshEmailSchema,
  updateBillingDetailsSchema,
};
