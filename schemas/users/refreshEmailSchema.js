const Joi = require('joi');

const refreshEmailSchema = Joi.object({
  email: Joi.string().required().email(),
});

module.exports = refreshEmailSchema;
