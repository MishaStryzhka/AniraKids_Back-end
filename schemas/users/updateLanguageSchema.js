const Joi = require('joi');

const updateLanguageSchema = Joi.object({
  language: Joi.string().required(),
});

module.exports = updateLanguageSchema;
