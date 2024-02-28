const Joi = require('joi');

const setQuantitySchema = Joi.object({
  productId: Joi.string().required(),
  quantity: Joi.number().required(),
});

module.exports = setQuantitySchema;
