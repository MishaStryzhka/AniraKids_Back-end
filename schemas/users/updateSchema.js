const Joi = require('joi');

const updateSchema = Joi.object({
  firstName: Joi.string().min(3),
  email: Joi.string().email(),
  avatar: Joi.string(),
  lastName: Joi.string(),
  patronymic: Joi.string(),
  nickname: Joi.string()
    .pattern(/^@[a-zA-Z0-9_.-]+$/)
    .message(
      'Přezdívka musí začínat znakem @ a obsahovat pouze písmena latinky, číslice, tečky, pomlčky nebo podtržítka.'
    ),
  primaryPhoneNumber: Joi.string()
    .pattern(/^\+\d{1,4}\d{1,14}$/)
    .message('Zadejte platné telefonní číslo včetně mezinárodní předvolby.'),
  newPassword: Joi.string()
    .min(8)
    .pattern(/^(?=.*[A-Z])(?=.*\d).{8,16}$/)
    .message(
      'Heslo musí obsahovat alespoň 8 znaků, jedno velké písmeno latinky a jednu číslici.'
    ),
  confirmNewPassword: Joi.string(),
  ico: Joi.string().max(32),
  companyName: Joi.string().min(3).max(255),
});
module.exports = updateSchema;
