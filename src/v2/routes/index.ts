import {authorizeBillingCron,partnerBillingCron} from '../controllers/partner-billing.controller';
import {fittingHandler} from '../controllers/fitting.controller';
import {partnerHandler} from '../controllers/partner.controller';
import {PartnerModel} from '../models/partner.model';
import {adminApiEnabled} from '../middleware/admin.middleware';
import {reservationApiEnabled,optionalLegacyAuth} from '../middleware/reservation.middleware';
import {customerFittingHandler} from '../controllers/customer-fittings.controller';
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
  router.get('/partner-billing/cron',authorizeBillingCron,dependencies.ensureMongoConnection,partnerBillingCron);
  router.get('/partner-policy',dependencies.ensureMongoConnection,async(_req,res,next)=>{try{res.setHeader?.('Cache-Control','no-store');return res.status(200).json({additionalDressDiscount:await PartnerModel.exists({_id:'blaze',enabled:true,cooperationActive:true})?20:0});}catch(e){return next(e);}});
  router.get('/referrals/:code',dependencies.ensureMongoConnection,partnerHandler('referral'));
  for(const action of ['access','members','balance','billing','billing-pdf','reservations','fittings','catalogue'])
    router.get('/partner/'+action,adminApiEnabled,dependencies.ensureMongoConnection,partnerHandler(action));
  for(const action of ['cooperation','billing-settings','billing-close','billing-send','setup','save-member','settle','create-reservation','create-fitting'])
    router.post('/partner/'+action,adminApiEnabled,dependencies.ensureMongoConnection,partnerHandler(action));
  router.post('/partner/reservations/:id',adminApiEnabled,dependencies.ensureMongoConnection,partnerHandler('reservation-action'));
  router.post('/partner/fittings/:id',adminApiEnabled,dependencies.ensureMongoConnection,partnerHandler('fitting-action'));
  router.get('/booking-policy', (_request, response) => response.status(200).json(BOOKING_POLICY));

  router.get('/site-settings', dependencies.ensureMongoConnection, readSiteSettings);
  router.get('/fittings/slots', reservationApiEnabled, dependencies.ensureMongoConnection, fittingHandler('slots'));
  router.post('/fittings', reservationApiEnabled, dependencies.ensureMongoConnection, optionalLegacyAuth, fittingHandler('create'));
  router.get('/account/fittings', reservationApiEnabled, dependencies.ensureMongoConnection, customerFittingHandler('list'));
  router.get('/account/fittings/:number', reservationApiEnabled, dependencies.ensureMongoConnection, customerFittingHandler('read'));
  router.post('/account/fittings/:number/claim', reservationApiEnabled, dependencies.ensureMongoConnection, customerFittingHandler('claim'));
  router.post('/account/fittings/:number/payment-sent', reservationApiEnabled, dependencies.ensureMongoConnection, customerFittingHandler('report'));
  router.post('/account/fittings/:number/cancel', reservationApiEnabled, dependencies.ensureMongoConnection, customerFittingHandler('cancel'));
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
