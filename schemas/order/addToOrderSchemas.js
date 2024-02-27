const Joi = require('joi');

const addToOrderSchema = Joi.object({
  productId: Joi.string().required(),
  price: Joi.number().required(),
  serviceType: Joi.string().valid('buy', 'rent').required(),
  owner: Joi.string().required(),
});

module.exports = addToOrderSchema;
