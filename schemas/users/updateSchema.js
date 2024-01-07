const Joi = require('joi');

const updateSchema = Joi.object({
  firstName: Joi.string().min(3),
  email: Joi.string().email(),
  avatar: Joi.string(),
  lastName: Joi.string(),
  patronymic: Joi.string(),
  nickname: Joi.string()
    .pattern(/^@[a-zA-Z0-9_-]+$/)
    .message(
      'Використовуйте лише латинські літери, цифри, тире і підкреслення'
    ),
  primaryPhoneNumber: Joi.string()
    .pattern(/^\+\d{1,4}\d{1,14}$/)
    .message('Невірний формат номеру телефону.'),
  newPassword: Joi.string()
    .min(8)
    .pattern(/^(?=.*[A-Z])(?=.*\d).{8,16}$/)
    .message(
      'Пароль повинен містити мінімум 8 латинських символів, одну велику літеру, одну цифру'
    ),
  companyName: Joi.string().min(3).max(255),
});
module.exports = updateSchema;
