const Joi = require('joi');

const addToOrderSchema = Joi.object({
  productId: Joi.string().required(),
  price: Joi.number().required(),
  owner: Joi.string().required(),
  serviceType: Joi.string().valid('buy', 'rent').required(),
  rentalPeriods: Joi.alternatives().conditional('serviceType', {
    is: 'rent',
    then: Joi.string().required(),
  }),
});

module.exports = addToOrderSchema;
