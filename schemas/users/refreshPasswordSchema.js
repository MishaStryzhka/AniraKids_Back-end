const Joi = require('joi');

const refreshPassword = Joi.object({
  password: Joi.string().required(),
  newPassword: Joi.string().required().min(8).max(72),
});

module.exports = refreshPassword;
