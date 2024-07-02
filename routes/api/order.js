const express = require('express');

const router = express.Router();

const ctrl = require('../../controllers/order');
const { authenticate, validateBody } = require('../../middlewares');
const {
  addToOrderSchema,
  setQuantitySchema,
  setQuantityHoursSchema,
} = require('../../schemas/order');

router.post(
  '/add',
  authenticate,
  validateBody(addToOrderSchema),
  ctrl.addToOrder
);

router.get('/get_orders', authenticate, ctrl.getOrders);
router.patch(
  '/set_quantity',
  authenticate,
  validateBody(setQuantitySchema),
  ctrl.setQuantity
);
router.patch(
  '/set_quantity_hours',
  authenticate,
  validateBody(setQuantityHoursSchema),
  ctrl.setQuantityHours
);

router.delete('/remove_orders', authenticate, ctrl.removeOrder);
router.delete(
  '/remove_product_from_order',
  authenticate,
  ctrl.removeProductFromOrder
);

module.exports = router;
