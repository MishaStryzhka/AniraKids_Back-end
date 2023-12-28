const Joi = require('joi');

const updateSchema = Joi.object({
  firstName: Joi.string().min(3),
  email: Joi.string(),
});

module.exports = updateSchema;
