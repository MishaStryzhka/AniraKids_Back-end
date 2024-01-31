const loginSchema = require('./loginSchema');
const registerSchema = require('./registerSchema');
const updateSchema = require('./updateSchema');
const refreshPasswordSchema = require('./refreshPasswordSchema');
const refreshEmailSchema = require('./refreshEmailSchema');
const updateBillingDetailsSchema = require('./updateBillingDetailsSchema');
const updateBankAccountSchema = require('./updateBankAccountSchema');

module.exports = {
  loginSchema,
  registerSchema,
  updateSchema,
  refreshPasswordSchema,
  refreshEmailSchema,
  updateBillingDetailsSchema,
  updateBankAccountSchema,
};
