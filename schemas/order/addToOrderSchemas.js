const Joi = require('joi');

const addToOrderSchema = Joi.object({
  productId: Joi.string().required(),
  price: Joi.required(),
  owner: Joi.string().required(),
  serviceType: Joi.string().valid('buy', 'rent').required(),
  rentalPeriods: Joi.alternatives().conditional('serviceType', {
    is: 'rent',
    then: Joi.string().required(),
  }),
  pickupAddress: Joi.object(),
  typeRent: Joi.alternatives().conditional('serviceType', {
    is: 'rent',
    then: Joi.string().valid('celebration', 'photosession').required(),
  }),
});

module.exports = addToOrderSchema;
