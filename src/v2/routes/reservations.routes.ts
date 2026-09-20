import {
  createReservation,
} from '../controllers/reservation.controller';
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
