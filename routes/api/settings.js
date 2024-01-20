const express = require('express');

const {
  validateBody,
  authenticate,
  passport,
  upload,
  validateQuery,
} = require('../../middlewares');

const {
  registerSchema,
  loginSchema,
  refreshPasswordSchema,
  refreshEmailSchema,
  updateSchema,
} = require('../../schemas/users');

const router = express.Router();

const ctrl = require('../../controllers/settings');
const updateLanguageSchema = require('../../schemas/users/updateLanguageSchema');

router.patch(
  '/updateLanguage',
  authenticate,
  validateQuery(updateLanguageSchema),
  ctrl.updateLanguage
);

module.exports = router;
