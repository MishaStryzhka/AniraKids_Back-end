const Joi = require('joi');

const categoryOptions = [
  'forWomen', // 'women`s category'
  'forMen', // 'men`s category'
  'forChildren', // 'children`s category'
  'decorAndToys', // 'decoration category'
];

const addProductSchemas = Joi.object({
  brand: Joi.string(),
  videoUrl: Joi.string()
    .pattern(
      /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})$/
    )
    .messages({
      'string.pattern.base': 'valid video URL',
    }),
  name: Joi.string().min(3).max(50).required().messages({
    'string.base': 'Should be a string',
    'string.empty': 'Required field',
    'string.min': 'minLongText',
    'string.max': 'maxLongText',
    'any.required': 'Required field',
  }),
  description: Joi.string().min(3).max(300).required().messages({
    'string.base': 'Should be a string',
    'string.empty': 'Required field',
    'string.min': 'minLongText',
    'string.max': 'maxLongComments',
    'any.required': 'Required field',
  }),
  brend: Joi.string().min(3).max(50).messages({
    'string.base': 'Should be a string',
    'string.min': 'minLongText',
    'string.max': 'maxLongText',
  }),
  category: Joi.string()
    .valid(...categoryOptions)
    .required()
    .messages({
      'string.base': 'Should be a string',
      'any.only': 'Invalid category',
      'any.required': 'Required category',
    }),
  familyLook: Joi.string(),
  isPregnancy: Joi.boolean(),
  size: Joi.string().when('category', {
    is: Joi.valid('forWomen', 'forMen'),
    then: Joi.required(),
  }),
  subject: Joi.string(),
  outfits: Joi.string(),
  color: Joi.string().required().messages({
    'string.empty': 'Required field',
    'any.required': 'Required field',
  }),
  age: Joi.string().when('category', {
    is: 'forChildren',
    then: Joi.required(),
  }),
  childSize: Joi.string().when('category', {
    is: 'forChildren',
    then: Joi.required(),
  }),
  decor: Joi.string(),
  toys: Joi.string(),
  rental: Joi.boolean(),
  sale: Joi.boolean(),
  dailyRentalPrice: Joi.number().when('rental', {
    is: true,
    then: Joi.required(),
  }),
  hourlyRentalPrice: Joi.number().when('rental', {
    is: true,
    then: Joi.required(),
  }),
  salePrice: Joi.number().when('sale', {
    is: true,
    then: Joi.required(),
  }),
  pickupAddress: Joi.string(),
  keyWord: Joi.string(),
  isAddPhoto: Joi.string().required().messages({
    'string.empty': 'Required field',
    'any.required': 'Required field',
  }),
});

module.exports = addProductSchemas;
