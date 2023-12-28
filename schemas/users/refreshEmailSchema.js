const Joi = require('joi');

const refreshEmailSchema = Joi.object({
  email: Joi.string().required().min(6),
  newEmail: Joi.string().required().min(6),
});

module.exports = refreshEmailSchema;
