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

  registerCatalogueRoutes(router, dependencies);
  router.use(catalogueApiErrorHandler);

  registerAdminRoutes(router, dependencies);
  router.use(adminApiErrorHandler);

  registerReservationRoutes(router, dependencies);
  router.use(reservationApiErrorHandler);

  return router;
};
