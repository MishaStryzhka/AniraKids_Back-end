const express = require('express');

const router = express.Router();

// Keep old clients from invoking the retired peer-to-peer marketplace.
// The new catalogue, bookings, account and admin APIs use separate routes.
router.use([
  '/api/product',
  '/api/order',
  '/api/users/current/update-billing-details',
  '/api/users/current/update-bank-account',
  '/api/users/favorites/add',
  '/api/users/favorites/remove',
  '/api/users/user',
  '/api/internal/cron/update-abandoned-orders',
], (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(410).json({
    code: 'MARKETPLACE_RETIRED',
    message: 'The peer-to-peer rental service is no longer available.',
  });
});

module.exports = router;
