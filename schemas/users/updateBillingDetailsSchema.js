const Joi = require('joi');

const updateBillingDetailsSchema = Joi.object({
  name: Joi.string()
    .required()
    .regex(/^[a-zA-Z\u00C0-\u017F\s]+$/)
    .messages({
      'string.base': 'Name must be a string',
      'string.empty': 'Name is required',
      'string.pattern.base': 'Only Czech characters are allowed in the name',
    }),
  street: Joi.string()
    .required()
    .regex(/^[a-zA-Z\u00C0-\u017F\s]+\s\d+\/\d+$/)
    .messages({
      'string.base': 'Street must be a string',
      'string.empty': 'Street is required',
      'string.pattern.base': 'Invalid street format',
    }),
  city: Joi.string()
    .required()
    .regex(/^[a-zA-Z\u00C0-\u017F\s]+$/)
    .messages({
      'string.base': 'City must be a string',
      'string.empty': 'City is required',
      'string.pattern.base': 'Only Czech characters are allowed in the city',
    }),
  zip: Joi.string()
    .required()
    .regex(/^\d{5}$/)
    .messages({
      'string.base': 'ZIP code must be a string',
      'string.empty': 'ZIP code is required',
      'string.pattern.base': 'Invalid ZIP code',
    }),
  сountry: Joi.string().valid('Česká republika').default('Česká republika'),
  vatMode: Joi.string()
    .valid('non_vat_payer', 'identified_person', 'vat_payer')
    .default('non_vat_payer')
    .required(),
  companyID: Joi.string()
    .allow('')
    .regex(/^[a-zA-Z\u00C0-\u017F\s\d]+$/)
    .messages({
      'string.base': 'CompanyID must be a string',
      'string.pattern.base':
        'Only Czech characters and digits are allowed in the CompanyID',
    }),
  VATID: Joi.string()
    .allow('')
    .regex(/^[a-zA-Z\u00C0-\u017F\s\d]+$/)
    .messages({
      'string.base': 'VATID must be a string',
      'string.pattern.base':
        'Only Czech characters and digits are allowed in the VATID',
    }),
});

module.exports = updateBillingDetailsSchema;
