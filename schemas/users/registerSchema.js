const Joi = require('joi');

const registerSchema = Joi.object({
  primaryPhoneNumber: Joi.string(),
  email: Joi.string(),
  password: Joi.string().required(),
  favorites: Joi.array(),
}).or('primaryPhoneNumber', 'email');

module.exports = registerSchema;
