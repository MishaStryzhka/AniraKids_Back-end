import {
  activateAdminProduct,
  archiveAdminProduct,
  createAdminInventoryItem,
  createAdminProduct,
  createAdminVariant,
  getAdminProductDetail,
  listAdminProducts,
  updateAdminInventoryItem,
  updateAdminProduct,
  updateAdminVariant,
} from '../controllers/admin-catalogue.controller';
import {
  adminApiConfigurationReady,
  adminApiEnabled,
  requireAdminAuth,
  validateAdminCreateInventoryItem,
  validateAdminCreateProduct,
  validateAdminCreateVariant,
  validateAdminProductListQuery,
  validateAdminUpdateInventoryItem,
  validateAdminUpdateProduct,
  validateAdminUpdateVariant,
  validateObjectIdParam,
} from '../middleware/admin.middleware';
import type {
  HttpHandler,
  RouterLike,
} from '../types/http';

export interface AdminRouteDependencies {
  ensureMongoConnection: HttpHandler;
}

const commonAdminGuards = (
  dependencies: AdminRouteDependencies
): HttpHandler[] => [
  adminApiEnabled,
  adminApiConfigurationReady,
  dependencies.ensureMongoConnection,
  requireAdminAuth,
];

export const registerAdminRoutes = (
  router: RouterLike,
  dependencies: AdminRouteDependencies
): void => {
  const guards = commonAdminGuards(dependencies);

  router.get(
    '/admin/products',
    ...guards,
    validateAdminProductListQuery,
    listAdminProducts
  );

  router.get(
    '/admin/products/:productId',
    ...guards,
    validateObjectIdParam('productId'),
    getAdminProductDetail
  );

  router.post(
    '/admin/products',
    ...guards,
    validateAdminCreateProduct,
    createAdminProduct
  );

  router.patch(
    '/admin/products/:productId',
    ...guards,
    validateObjectIdParam('productId'),
    validateAdminUpdateProduct,
    updateAdminProduct
  );

  router.post(
    '/admin/products/:productId/activate',
    ...guards,
    validateObjectIdParam('productId'),
    activateAdminProduct
  );

  router.post(
    '/admin/products/:productId/archive',
    ...guards,
    validateObjectIdParam('productId'),
    archiveAdminProduct
  );

  router.post(
    '/admin/products/:productId/variants',
    ...guards,
    validateObjectIdParam('productId'),
    validateAdminCreateVariant,
    createAdminVariant
  );

  router.patch(
    '/admin/variants/:variantId',
    ...guards,
    validateObjectIdParam('variantId'),
    validateAdminUpdateVariant,
    updateAdminVariant
  );

  router.post(
    '/admin/variants/:variantId/inventory-items',
    ...guards,
    validateObjectIdParam('variantId'),
    validateAdminCreateInventoryItem,
    createAdminInventoryItem
  );

  router.patch(
    '/admin/inventory-items/:inventoryItemId',
    ...guards,
    validateObjectIdParam('inventoryItemId'),
    validateAdminUpdateInventoryItem,
    updateAdminInventoryItem
  );
};
