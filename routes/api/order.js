const express = require('express');

const router = express.Router();

const ctrl = require('../../controllers/order');
const { authenticate, validateBody } = require('../../middlewares');
const addToOrderSchema = require('../../schemas/order/addToOrderSchemas');

router.post(
  '/add',
  authenticate,
  validateBody(addToOrderSchema),
  ctrl.addToOrder
);

module.exports = router;