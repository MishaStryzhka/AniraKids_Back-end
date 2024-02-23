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
  updateBillingDetailsSchema,
  updateBankAccountSchema,
} = require('../../schemas/users');

const router = express.Router();

const ctrl = require('../../controllers/auth');

router.get(
  '/google',
  passport.authenticate('google', { scope: ['email', 'profile'] })
);

router.get(
  '/google/callback',
  // passport.authenticate('google', { session: false }),
  ctrl.googleAuth
);

router.post('/register', validateBody(registerSchema), ctrl.register);
router.post(
  '/authByGoogle',
  // validateBody(registerSchema),
  ctrl.authByGoogle
);
router.post(
  '/authBySeznam',
  // validateBody(registerSchema),
  ctrl.authBySeznam
);
router.post('/login', validateBody(loginSchema), ctrl.login);
router.post('/logout', authenticate, ctrl.logout);
router.get('/current', authenticate, ctrl.getCurrentUser);
router.get('/user/:id', ctrl.getUserById);
router.patch(
  '/current/refreshPassword',
  authenticate,
  validateBody(refreshPasswordSchema),
  ctrl.refreshPassword
);

router.patch(
  '/current/update',
  authenticate,
  validateBody(updateSchema),
  upload.fields([{ name: 'avatar', maxCount: 1 }]),
  ctrl.updateCurrentUser
);

router.patch(
  '/current/update-billing-details',
  authenticate,
  validateBody(updateBillingDetailsSchema),
  ctrl.updateCurrentUserBillingDetails
);

router.patch(
  '/current/update-bank-account',
  authenticate,
  validateBody(updateBankAccountSchema),
  ctrl.updateCurrentUserBankAccount
);

router.patch(
  '/current/refreshEmail',
  authenticate,
  validateQuery(refreshEmailSchema),
  ctrl.refreshEmail
);

router.patch('/current/verifiedEmail', authenticate, ctrl.verifiedEmail);
router.post('/current/confirmEmail', authenticate, ctrl.confirmEmail);

router.patch('/favorites/add/:productId', authenticate, ctrl.addToFavorites);
router.delete(
  '/favorites/remove/:productId',
  authenticate,
  ctrl.removeFromFavorites
);
module.exports = router;
