const Joi = require('joi');

const updateBankAccountSchema = Joi.object({
  accountName: Joi.string().required().messages({
    'any.required': 'Account name is required',
  }),
  accountNumber: Joi.string()
    .required()
    .pattern(/^\d{10}\/\d{4}$/)
    .messages({
      'any.required': 'Account number is required',
      'string.pattern.base':
        'Invalid account number format (e.g., 1234567890/2010)',
    }),
  IBAN: Joi.string()
    .required()
    .pattern(/^[A-Z]{2}\d{2}[A-Z\d]{11,30}$/)
    .messages({
      'any.required': 'IBAN is required',
      'string.pattern.base':
        'Invalid IBAN format (e.g., CZ6508000000192000145399)',
    }),
  swiftBIC: Joi.string()
    .required()
    .pattern(/^[A-Z]{6}[A-Z\d]{2}([A-Z\d]{3})?$/)
    .messages({
      'any.required': 'SWIFT/BIC is required',
      'string.pattern.base': 'Invalid SWIFT/BIC format (e.g., KOMBCZPP)',
    }),
  currency: Joi.string().required().messages({
    'any.required': 'Currency is required',
  }),
});

module.exports = updateBankAccountSchema;
