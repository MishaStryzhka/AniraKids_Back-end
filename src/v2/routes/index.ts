import {fittingHandler} from '../controllers/fitting.controller';
import {reservationApiEnabled} from '../middleware/reservation.middleware';
import {readSiteSettings} from '../controllers/site-settings.controller';
import { BOOKING_POLICY } from '../services/booking-policy';
import { getHealth } from '../controllers/health.controller';
import { registerCatalogueRoutes, catalogueApiErrorHandler } from './catalogue.routes';
import {
  adminApiErrorHandler,
} from '../http/admin-error-mapper';
import {
  reservationApiErrorHandler,
} from '../http/error-mapper';
import {
  registerAdminRoutes,
  type AdminRouteDependencies,
} from './admin.routes';
import {
  registerReservationRoutes,
  type ReservationRouteDependencies,
} from './reservations.routes';
import type { ExpressLike, RouterLike } from '../types/http';

export type V2RouteDependencies =
  ReservationRouteDependencies &
  AdminRouteDependencies;

export const createV2Router = (
  express: ExpressLike,
  dependencies: V2RouteDependencies
): RouterLike => {
  const router = express.Router();

  router.get('/health', getHealth);
  router.get('/booking-policy', (_request, response) => response.status(200).json(BOOKING_POLICY));

  router.get('/site-settings', dependencies.ensureMongoConnection, readSiteSettings);
  router.get('/fittings/slots', reservationApiEnabled, dependencies.ensureMongoConnection, fittingHandler('slots'));
  router.post('/fittings', reservationApiEnabled, dependencies.ensureMongoConnection, fittingHandler('create'));
  router.get('/fittings/:number', reservationApiEnabled, dependencies.ensureMongoConnection, fittingHandler('read'));
  router.post('/fittings/:number/payment-sent', reservationApiEnabled, dependencies.ensureMongoConnection, fittingHandler('report'));
  router.post('/fittings/:number/cancel', reservationApiEnabled, dependencies.ensureMongoConnection, fittingHandler('cancel'));
  registerCatalogueRoutes(router, dependencies);
  router.use(catalogueApiErrorHandler);

  registerAdminRoutes(router, dependencies);
  router.use(adminApiErrorHandler);

  registerReservationRoutes(router, dependencies);
  router.use(reservationApiErrorHandler);

  return router;
};
