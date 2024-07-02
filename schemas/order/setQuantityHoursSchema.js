const Joi = require('joi');

const setQuantityHoursSchema = Joi.object({
  orderId: Joi.string().required(),
  quantityHours: Joi.number().required(),
});

module.exports = setQuantityHoursSchema;
