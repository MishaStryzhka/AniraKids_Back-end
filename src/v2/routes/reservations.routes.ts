import {customerFittingDiscounts} from '../controllers/fitting-discount.controller';
import { listCustomerReservations, claimCustomerReservation } from '../controllers/customer-reservations.controller';
import {
  createReservation,
} from '../controllers/reservation.controller';
import { getReservationStatus, reportReservationTransfer } from '../controllers/reservation-status.controller';
import {
  activePendingEmailGuard,
  optionalLegacyAuth,
  rejectMalformedOptionalAuthorization,
  reservationApiEnabled,
  validateReservationBody,
} from '../middleware/reservation.middleware';
import {
  requireReservationIdempotencyKey,
  reservationApiHardeningReady,
  resolveReservationIdempotency,
} from '../middleware/idempotency.middleware';
import type {
  HttpHandler,
  RouterLike,
} from '../types/http';

export interface ReservationRouteDependencies {
  ensureMongoConnection: HttpHandler;
}

export const registerReservationRoutes = (
  router: RouterLike,
  dependencies: ReservationRouteDependencies
): void => {
  router.post('/fitting-discounts/options', reservationApiEnabled, rejectMalformedOptionalAuthorization, dependencies.ensureMongoConnection, optionalLegacyAuth, customerFittingDiscounts);
  router.post('/account/reservations/:reservationNumber/claim', reservationApiEnabled, dependencies.ensureMongoConnection, claimCustomerReservation);
  router.get('/account/reservations', reservationApiEnabled, dependencies.ensureMongoConnection, listCustomerReservations);
  router.post('/reservations/:reservationNumber/payment-report',
    reservationApiEnabled, dependencies.ensureMongoConnection, reportReservationTransfer);
  router.get(
    '/reservations/:reservationNumber',
    reservationApiEnabled,
    dependencies.ensureMongoConnection,
    getReservationStatus
  );
  router.post(
    '/reservations',
    reservationApiEnabled,
    reservationApiHardeningReady,
    validateReservationBody,
    requireReservationIdempotencyKey,
    rejectMalformedOptionalAuthorization,
    dependencies.ensureMongoConnection,
    optionalLegacyAuth,
    resolveReservationIdempotency,
    activePendingEmailGuard,
    createReservation
  );
};
