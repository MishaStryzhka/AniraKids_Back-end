const express = require('express');

const {
  validateBody,
  authenticate,
  passport,
} = require('../../middlewares');

const {
  registerSchema,
  loginSchema,
  refreshPasswordSchema,
  refreshEmailSchema,
} = require('../../schemas/users');

const router = express.Router();

const ctrl = require('../../controllers/auth');

router.get(
  '/google',
  passport.authenticate('google', { scope: ['email', 'profile'] })
);

router.get(
  '/google/callback',
  passport.authenticate('google', { session: false }),
  ctrl.googleAuth
);

router.post('/register', validateBody(registerSchema), ctrl.register);
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
  '/current/refreshEmail',
  authenticate,
  validateBody(refreshEmailSchema),
  ctrl.refreshEmail
);

module.exports = router;
