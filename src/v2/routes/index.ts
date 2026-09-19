import { getHealth } from '../controllers/health.controller';
import {
  reservationApiErrorHandler,
} from '../http/error-mapper';
import {
  registerReservationRoutes,
  type ReservationRouteDependencies,
} from './reservations.routes';
import type { ExpressLike, RouterLike } from '../types/http';

export const createV2Router = (
  express: ExpressLike,
  dependencies: ReservationRouteDependencies
): RouterLike => {
  const router = express.Router();

  router.get('/health', getHealth);
  registerReservationRoutes(router, dependencies);
  router.use(reservationApiErrorHandler);

  return router;
};
