const Joi = require('joi');
module.exports = Joi.object({
  primaryPhoneNumber: Joi.string().trim().pattern(/^\+\d{7,15}$/),
  email: Joi.string().trim().lowercase().email(),
  password: Joi.string().min(8).max(72).required(),
  favorites: Joi.array().items(Joi.string().hex().length(24)).max(100),
}).or('primaryPhoneNumber', 'email');
