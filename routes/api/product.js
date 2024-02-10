const express = require('express');

const {
  authenticate,
  //   validateQuery,
  validateBody,
  upload,
} = require('../../middlewares');

const router = express.Router();

const ctrl = require('../../controllers/product');
const { productSchema } = require('../../schemas/product');

router.post(
  '/addProduct',
  authenticate,
  upload.fields([{ name: 'photos', maxCount: 10 }]),
  validateBody(productSchema),
  ctrl.addProdukt
);

router.get(
  '/getCurrentUserProducts',
  authenticate,
  ctrl.getCurrentUserProducts
);

// DELETE /api/product/:id
router.delete('/:id', authenticate, ctrl.removeProductById);

module.exports = router;
