const Joi = require('joi');

const orderConfirmByUserSchema = Joi.object({
  firstName: Joi.string().required(),
  lastName: Joi.string().required(),
  phoneNumber: Joi.string()
    .pattern(/^\+\d{12}$/)
    .required(),
  email: Joi.string().email().required(),
  deliveryService: Joi.string()
    .valid('selfPickup', 'Balikovna', 'POST_OFFICE')
    .required(),
  deliveryType: Joi.string().allow(''),
  address: Joi.string().allow(''),
});

module.exports = orderConfirmByUserSchema;
