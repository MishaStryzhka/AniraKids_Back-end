const Joi = require('joi');

const loginSchema = Joi.object({
  login: Joi.string().required(),
  password: Joi.string().required(),
});

module.exports = loginSchema;
