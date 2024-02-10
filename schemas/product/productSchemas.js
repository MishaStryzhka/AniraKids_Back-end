const Joi = require('joi');

const categoryOptions = [
  'women`s category',
  'men`s category',
  'children`s category',
  'decoration category',
];

const subjectOptions = [
  'Christmas',
  'Ukrainian-symbols',
  'Animals',
  'ballet-&-princesses',
  'Dinosaurs',
  'Flowers-&-butterflies',
  'Hearts',
  'unicors-&-rainbows',
];

const productSchema = Joi.object({
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
    is: Joi.valid('women`s category', 'men`s category'),
    then: Joi.required(),
  }),
  subject: Joi.string().when('category', {
    is: 'children`s category',
    then: Joi.string().valid(...subjectOptions),
    otherwise: Joi.string().allow(''),
  }),
  color: Joi.string().required().messages({
    'string.empty': 'Required field',
    'any.required': 'Required field',
  }),
  age: Joi.string().when('category', {
    is: 'children`s category',
    then: Joi.required(),
  }),
  childSize: Joi.string().when('category', {
    is: 'children`s category',
    then: Joi.required(),
  }),
  decor: Joi.string(),
  toys: Joi.string().when('category', {
    is: 'decoration category',
    then: Joi.required(),
  }),
  rental: Joi.boolean(),
  sale: Joi.boolean(),
  rentalPrice: Joi.number().when('rental', {
    is: true,
    then: Joi.required(),
  }),
  salePrice: Joi.number().when('sale', {
    is: true,
    then: Joi.required(),
  }),
  keyWord: Joi.string(),
  isAddPhoto: Joi.string().required().messages({
    'string.empty': 'Required field',
    'any.required': 'Required field',
  }),
});

module.exports = productSchema;
