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
} = require('../../schemas/users');

const router = express.Router();

const ctrl = require('../../controllers/auth');
const favorites = require('../../controllers/auth/storefrontFavorites');
const { ctrlWrapper } = require('../../helpers');
router.get('/favorites/storefront', authenticate, ctrlWrapper(favorites.read));
router.post('/favorites/storefront', authenticate, ctrlWrapper(favorites.add));
router.delete('/favorites/storefront/:productId', authenticate, ctrlWrapper(favorites.remove));

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
router.patch(
  '/current/refreshPassword',
  authenticate,
  validateBody(refreshPasswordSchema),
  ctrl.refreshPassword
);

router.patch(
  '/current/update',
  authenticate,
  upload.fields([{ name: 'avatar', maxCount: 1 }]),
  ctrl.updateCurrentUser
);



router.patch(
  '/current/refreshEmail',
  authenticate,
  validateQuery(refreshEmailSchema),
  ctrl.refreshEmail
);

router.patch('/current/verifiedEmail', authenticate, ctrl.verifiedEmail);
router.post('/current/confirmEmail', ctrl.confirmEmail);
const recovery = require('../../controllers/auth/passwordRecovery');
router.post('/password/request-reset', ctrlWrapper(recovery.request));
router.post('/password/reset', ctrlWrapper(recovery.confirm));
router.post('/current/confirmEmailChange', ctrlWrapper(require('../../controllers/auth/confirmEmailChange')));

module.exports = router;
