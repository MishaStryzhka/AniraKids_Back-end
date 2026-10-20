import {adminBookingCreate} from '../controllers/admin-booking-create.controller';
import {invoiceHandler} from '../controllers/invoice.controller';
import {adminAccess,administrators} from '../controllers/admin-access.controller';
import {fittingHandler} from '../controllers/fitting.controller';
import {adminPushHandler} from '../controllers/admin-push.controller';
import {readSiteSettings, updateSiteSettings} from '../controllers/site-settings.controller';
import {productAssistantHandler} from '../controllers/product-assistant.controller';
import { adminOverview } from '../controllers/admin-overview.controller';
import { adminPayments, adminRecordPayment } from '../controllers/admin-payments.controller';
import {
  activateAdminProduct,
  hideAdminProduct,
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
  requireAdminPermission,
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
  router.get('/admin/invoices', ...guards, invoiceHandler('list'));
  router.get('/admin/invoices/pending', ...guards, invoiceHandler('pending'));
  router.post('/admin/invoices/process', ...guards, invoiceHandler('process'));
  router.post('/admin/invoices/preview', ...guards, invoiceHandler('preview'));
  router.post('/admin/invoices', ...guards, invoiceHandler('issue'));
  router.get('/admin/invoices/export', ...guards, invoiceHandler('export'));
  router.get('/admin/invoices/:invoiceId/pdf', ...guards, invoiceHandler('pdf'));
  router.post('/admin/invoices/:invoiceId/send', ...guards, invoiceHandler('send'));
  router.post('/admin/invoices/:invoiceId/correct', ...guards, invoiceHandler('correct'));
  router.get('/admin/access', ...guards, adminAccess);
  router.get('/admin/administrators', ...guards, requireAdminPermission('administrators'), administrators('list'));
  router.post('/admin/administrators/lookup', ...guards, requireAdminPermission('administrators'), administrators('lookup'));
  router.patch('/admin/administrators/:userId', ...guards, requireAdminPermission('administrators'), administrators('save'));
  router.get('/admin/fitting-settings', ...guards, requireAdminPermission('settings'), fittingHandler('settings'));
  router.patch('/admin/fitting-settings', ...guards, requireAdminPermission('settings'), fittingHandler('save-settings'));
  router.get('/admin/push/config', ...guards, requireAdminPermission('fittings'), adminPushHandler('config'));
  router.post('/admin/push/subscribe', ...guards, requireAdminPermission('fittings'), adminPushHandler('subscribe'));
  router.post('/admin/push/unsubscribe', ...guards, requireAdminPermission('fittings'), adminPushHandler('unsubscribe'));
  router.post('/admin/push/preferences', ...guards, requireAdminPermission('fittings'), adminPushHandler('preferences'));
  router.get('/admin/reservations/:reservationId/fitting-discount', ...guards, requireAdminPermission('reservations'), requireAdminPermission('fittings'), fittingHandler('discount-options'));
  router.get('/admin/booking-catalogue', ...guards, requireAdminPermission('reservations'), adminBookingCreate('catalogue'));
  router.post('/admin/reservations', ...guards, requireAdminPermission('reservations'), adminBookingCreate('reservation'));
  router.post('/admin/fittings', ...guards, requireAdminPermission('fittings'), adminBookingCreate('fitting'));
  router.get('/admin/fittings', ...guards, requireAdminPermission('fittings'), fittingHandler('list'));
  router.get('/admin/fittings/:fittingId', ...guards, requireAdminPermission('fittings'), fittingHandler('detail'));
  router.post('/admin/fittings/:fittingId/actions', ...guards, requireAdminPermission('fittings'), fittingHandler('act'));
  router.get('/admin/settings', ...guards, requireAdminPermission('settings'), readSiteSettings);
  router.patch('/admin/settings', ...guards, requireAdminPermission('settings'), updateSiteSettings);
  router.post('/admin/product-drafts', ...guards, requireAdminPermission('products'), productAssistantHandler('create'));
  router.post('/admin/product-drafts/:draftId/photos/sign', ...guards, requireAdminPermission('products'), productMediaConfigurationReady, productAssistantHandler('sign'));
  router.post('/admin/product-drafts/:draftId/photos/complete', ...guards, requireAdminPermission('products'), productMediaConfigurationReady, productAssistantHandler('complete'));
  router.post('/admin/product-drafts/:draftId/photos/remove', ...guards, requireAdminPermission('products'), productAssistantHandler('remove'));
  router.post('/admin/product-drafts/:draftId/suggest', ...guards, requireAdminPermission('products'), productAssistantHandler('suggest'));
  router.post('/admin/product-drafts/:draftId/save', ...guards, requireAdminPermission('products'), productAssistantHandler('save'));
  router.get('/admin/overview', ...guards, requireAdminPermission('reservations'), adminOverview);
  router.get('/admin/reservations/:reservationId/payments', ...guards, requireAdminPermission('reservations'), validateObjectIdParam('reservationId'), adminPayments);
  router.post('/admin/reservations/:reservationId/payments', ...guards, requireAdminPermission('reservations'), validateObjectIdParam('reservationId'), adminRecordPayment);
  const mediaHandlers = createAdminProductMediaHandlers(
    dependencies.productMediaService ?? productMediaService
  );

  router.get(
    '/admin/products',
    ...guards, requireAdminPermission('products'),
    validateAdminProductListQuery,
    listAdminProducts
  );

  router.get(
    '/admin/products/:productId',
    ...guards, requireAdminPermission('products'),
    validateObjectIdParam('productId'),
    getAdminProductDetail
  );

  router.post(
    '/admin/products',
    ...guards, requireAdminPermission('products'),
    validateAdminCreateProduct,
    createAdminProduct
  );

  router.patch(
    '/admin/products/:productId',
    ...guards, requireAdminPermission('products'),
    validateObjectIdParam('productId'),
    validateAdminUpdateProduct,
    updateAdminProduct
  );

  router.post(
    '/admin/products/:productId/photos/sign',
    ...guards, requireAdminPermission('products'),
    productMediaConfigurationReady,
    validateObjectIdParam('productId'),
    mediaHandlers.signProductPhotoUpload
  );

  router.post(
    '/admin/products/:productId/photos/complete',
    ...guards, requireAdminPermission('products'),
    productMediaConfigurationReady,
    validateObjectIdParam('productId'),
    validateAdminCompleteProductPhoto,
    mediaHandlers.completeProductPhotoUpload
  );

  router.patch(
    '/admin/products/:productId/photos/order',
    ...guards, requireAdminPermission('products'),
    productMediaConfigurationReady,
    validateObjectIdParam('productId'),
    validateAdminReorderProductPhotos,
    mediaHandlers.reorderProductPhotos
  );

  router.patch(
    '/admin/products/:productId/photos',
    ...guards, requireAdminPermission('products'),
    productMediaConfigurationReady,
    validateObjectIdParam('productId'),
    validateAdminUpdateProductPhotoAlt,
    mediaHandlers.updateProductPhotoAlt
  );

  router.delete(
    '/admin/products/:productId/photos',
    ...guards, requireAdminPermission('products'),
    productMediaConfigurationReady,
    validateObjectIdParam('productId'),
    validateAdminDeleteProductPhoto,
    mediaHandlers.deleteProductPhoto
  );

  router.post(
    '/admin/products/:productId/activate',
    ...guards, requireAdminPermission('products'),
    validateObjectIdParam('productId'),
    activateAdminProduct
  );

  router.post(
    '/admin/products/:productId/hide',
    ...guards, requireAdminPermission('products'),
    validateObjectIdParam('productId'),
    hideAdminProduct
  );

  router.post(
    '/admin/products/:productId/archive',
    ...guards, requireAdminPermission('products'),
    validateObjectIdParam('productId'),
    archiveAdminProduct
  );

  router.post(
    '/admin/products/:productId/variants',
    ...guards, requireAdminPermission('products'),
    validateObjectIdParam('productId'),
    validateAdminCreateVariant,
    createAdminVariant
  );

  router.patch(
    '/admin/variants/:variantId',
    ...guards, requireAdminPermission('products'),
    validateObjectIdParam('variantId'),
    validateAdminUpdateVariant,
    updateAdminVariant
  );

  router.post(
    '/admin/variants/:variantId/inventory-items',
    ...guards, requireAdminPermission('products'),
    validateObjectIdParam('variantId'),
    validateAdminCreateInventoryItem,
    createAdminInventoryItem
  );

  router.patch(
    '/admin/inventory-items/:inventoryItemId',
    ...guards, requireAdminPermission('products'),
    validateObjectIdParam('inventoryItemId'),
    validateAdminUpdateInventoryItem,
    updateAdminInventoryItem
  );

  router.post(
    '/admin/inventory-items/:inventoryItemId/maintenance',
    ...guards, requireAdminPermission('products'),
    validateObjectIdParam('inventoryItemId'),
    moveAdminInventoryItemToMaintenance
  );

  router.post(
    '/admin/inventory-items/:inventoryItemId/activate',
    ...guards, requireAdminPermission('products'),
    validateObjectIdParam('inventoryItemId'),
    activateAdminInventoryItem
  );

  router.post(
    '/admin/inventory-items/:inventoryItemId/retire',
    ...guards, requireAdminPermission('products'),
    validateObjectIdParam('inventoryItemId'),
    retireAdminInventoryItem
  );

  router.get(
    '/admin/inventory-items/:inventoryItemId/availability-blocks',
    ...guards, requireAdminPermission('products'),
    validateObjectIdParam('inventoryItemId'),
    validateAdminAvailabilityBlockListQuery,
    listAdminAvailabilityBlocks
  );

  router.post(
    '/admin/inventory-items/:inventoryItemId/availability-blocks',
    ...guards, requireAdminPermission('products'),
    validateObjectIdParam('inventoryItemId'),
    validateAdminCreateAvailabilityBlock,
    createAdminAvailabilityBlock
  );

  router.delete(
    '/admin/availability-blocks/:availabilityBlockId',
    ...guards, requireAdminPermission('products'),
    validateObjectIdParam('availabilityBlockId'),
    deleteAdminAvailabilityBlock
  );

  router.get(
    '/admin/reservations',
    ...guards, requireAdminPermission('reservations'),
    validateAdminReservationListQuery,
    listAdminReservations
  );

  router.get(
    '/admin/reservations/calendar',
    ...guards, requireAdminPermission('reservations'),
    validateAdminReservationCalendarQuery,
    getAdminReservationCalendar
  );

  router.get(
    '/admin/reservations/:reservationId',
    ...guards, requireAdminPermission('reservations'),
    validateObjectIdParam('reservationId'),
    getAdminReservationDetail
  );

  router.patch(
    '/admin/reservations/:reservationId/notes',
    ...guards, requireAdminPermission('reservations'),
    validateObjectIdParam('reservationId'),
    validateAdminUpdateReservationNotes,
    updateAdminReservationNotes
  );

  router.post(
    '/admin/reservations/:reservationId/confirm',
    ...guards, requireAdminPermission('reservations'),
    validateObjectIdParam('reservationId'),
    confirmAdminReservation
  );

  router.post(
    '/admin/reservations/:reservationId/prepare',
    ...guards, requireAdminPermission('reservations'),
    validateObjectIdParam('reservationId'),
    prepareAdminReservation
  );

  router.post(
    '/admin/reservations/:reservationId/rent',
    ...guards, requireAdminPermission('reservations'),
    validateObjectIdParam('reservationId'),
    rentAdminReservation
  );

  router.post(
    '/admin/reservations/:reservationId/return',
    ...guards, requireAdminPermission('reservations'),
    validateObjectIdParam('reservationId'),
    returnAdminReservation
  );

  router.post(
    '/admin/reservations/:reservationId/cancel',
    ...guards, requireAdminPermission('reservations'),
    validateObjectIdParam('reservationId'),
    validateAdminCancelReservation,
    cancelAdminReservation
  );
};
