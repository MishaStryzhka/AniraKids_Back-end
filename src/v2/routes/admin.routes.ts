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
  createAdminProductMediaHandlers,
} from '../controllers/admin-product-media.controller';
import {
  cancelAdminReservation,
  confirmAdminReservation,
  getAdminReservationCalendar,
  getAdminReservationDetail,
  listAdminReservations,
  prepareAdminReservation,
  rentAdminReservation,
  returnAdminReservation,
  updateAdminReservationNotes,
} from '../controllers/admin-reservations.controller';
import {
  activateAdminInventoryItem,
  createAdminAvailabilityBlock,
  deleteAdminAvailabilityBlock,
  listAdminAvailabilityBlocks,
  moveAdminInventoryItemToMaintenance,
  retireAdminInventoryItem,
} from '../controllers/admin-inventory-availability.controller';
import {
  adminApiConfigurationReady,
  adminApiEnabled,
  requireAdminAuth,
  validateAdminAvailabilityBlockListQuery,
  validateAdminCreateAvailabilityBlock,
  validateAdminCreateInventoryItem,
  validateAdminCreateProduct,
  validateAdminCreateVariant,
  validateAdminProductListQuery,
  validateAdminReservationCalendarQuery,
  validateAdminReservationListQuery,
  validateAdminCancelReservation,
  validateAdminUpdateReservationNotes,
  validateAdminUpdateInventoryItem,
  validateAdminUpdateProduct,
  validateAdminUpdateVariant,
  validateObjectIdParam,
} from '../middleware/admin.middleware';
import {
  productMediaConfigurationReady,
  validateAdminCompleteProductPhoto,
  validateAdminDeleteProductPhoto,
  validateAdminReorderProductPhotos,
  validateAdminUpdateProductPhotoAlt,
} from '../middleware/product-media.middleware';
import {
  productMediaService,
  type ProductMediaService,
} from '../services/product-media.service';
import type {
  HttpHandler,
  RouterLike,
} from '../types/http';

export interface AdminRouteDependencies {
  ensureMongoConnection: HttpHandler;
  productMediaService?: ProductMediaService;
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
  const mediaHandlers = createAdminProductMediaHandlers(
    dependencies.productMediaService ?? productMediaService
  );

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
    '/admin/products/:productId/photos/sign',
    ...guards,
    productMediaConfigurationReady,
    validateObjectIdParam('productId'),
    mediaHandlers.signProductPhotoUpload
  );

  router.post(
    '/admin/products/:productId/photos/complete',
    ...guards,
    productMediaConfigurationReady,
    validateObjectIdParam('productId'),
    validateAdminCompleteProductPhoto,
    mediaHandlers.completeProductPhotoUpload
  );

  router.patch(
    '/admin/products/:productId/photos/order',
    ...guards,
    productMediaConfigurationReady,
    validateObjectIdParam('productId'),
    validateAdminReorderProductPhotos,
    mediaHandlers.reorderProductPhotos
  );

  router.patch(
    '/admin/products/:productId/photos',
    ...guards,
    productMediaConfigurationReady,
    validateObjectIdParam('productId'),
    validateAdminUpdateProductPhotoAlt,
    mediaHandlers.updateProductPhotoAlt
  );

  router.delete(
    '/admin/products/:productId/photos',
    ...guards,
    productMediaConfigurationReady,
    validateObjectIdParam('productId'),
    validateAdminDeleteProductPhoto,
    mediaHandlers.deleteProductPhoto
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

  router.post(
    '/admin/inventory-items/:inventoryItemId/maintenance',
    ...guards,
    validateObjectIdParam('inventoryItemId'),
    moveAdminInventoryItemToMaintenance
  );

  router.post(
    '/admin/inventory-items/:inventoryItemId/activate',
    ...guards,
    validateObjectIdParam('inventoryItemId'),
    activateAdminInventoryItem
  );

  router.post(
    '/admin/inventory-items/:inventoryItemId/retire',
    ...guards,
    validateObjectIdParam('inventoryItemId'),
    retireAdminInventoryItem
  );

  router.get(
    '/admin/inventory-items/:inventoryItemId/availability-blocks',
    ...guards,
    validateObjectIdParam('inventoryItemId'),
    validateAdminAvailabilityBlockListQuery,
    listAdminAvailabilityBlocks
  );

  router.post(
    '/admin/inventory-items/:inventoryItemId/availability-blocks',
    ...guards,
    validateObjectIdParam('inventoryItemId'),
    validateAdminCreateAvailabilityBlock,
    createAdminAvailabilityBlock
  );

  router.delete(
    '/admin/availability-blocks/:availabilityBlockId',
    ...guards,
    validateObjectIdParam('availabilityBlockId'),
    deleteAdminAvailabilityBlock
  );

  router.get(
    '/admin/reservations',
    ...guards,
    validateAdminReservationListQuery,
    listAdminReservations
  );

  router.get(
    '/admin/reservations/calendar',
    ...guards,
    validateAdminReservationCalendarQuery,
    getAdminReservationCalendar
  );

  router.get(
    '/admin/reservations/:reservationId',
    ...guards,
    validateObjectIdParam('reservationId'),
    getAdminReservationDetail
  );

  router.patch(
    '/admin/reservations/:reservationId/notes',
    ...guards,
    validateObjectIdParam('reservationId'),
    validateAdminUpdateReservationNotes,
    updateAdminReservationNotes
  );

  router.post(
    '/admin/reservations/:reservationId/confirm',
    ...guards,
    validateObjectIdParam('reservationId'),
    confirmAdminReservation
  );

  router.post(
    '/admin/reservations/:reservationId/prepare',
    ...guards,
    validateObjectIdParam('reservationId'),
    prepareAdminReservation
  );

  router.post(
    '/admin/reservations/:reservationId/rent',
    ...guards,
    validateObjectIdParam('reservationId'),
    rentAdminReservation
  );

  router.post(
    '/admin/reservations/:reservationId/return',
    ...guards,
    validateObjectIdParam('reservationId'),
    returnAdminReservation
  );

  router.post(
    '/admin/reservations/:reservationId/cancel',
    ...guards,
    validateObjectIdParam('reservationId'),
    validateAdminCancelReservation,
    cancelAdminReservation
  );
};
