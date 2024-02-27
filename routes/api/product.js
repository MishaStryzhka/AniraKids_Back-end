const express = require('express');

const {
  authenticate,
  //   validateQuery,
  validateBody,
  upload,
  // imageProcessingMiddleware,
} = require('../../middlewares');

const router = express.Router();

const ctrl = require('../../controllers/product');
const { addProductSchemas } = require('../../schemas/product');

router.post(
  '/addProduct',
  authenticate,
  upload.fields([{ name: 'photos', maxCount: 10 }]),
  validateBody(addProductSchemas),
  ctrl.addProdukt
);

router.get(
  '/getCurrentUserProducts',
  authenticate,
  ctrl.getCurrentUserProducts
);

router.get('/getProducts', ctrl.getProducts);
router.get('/getFavorites', authenticate, ctrl.getFavorites);
router.get('/getProductById/:id', ctrl.getProductById);

// DELETE /api/product/:id
router.delete('/:id', authenticate, ctrl.removeProductById);

module.exports = router;
