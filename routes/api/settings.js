const express = require('express');

const { authenticate, validateQuery } = require('../../middlewares');

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
