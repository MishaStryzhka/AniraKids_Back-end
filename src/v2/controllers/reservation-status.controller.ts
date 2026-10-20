import { ReservationV2Model } from '../models';
import { authenticateLegacyBearer, parseBearerAuthorization } from '../auth/legacy-bearer';
import { toPublicReservationResponse } from '../http/reservation-response';
import { hashGuestAccessToken } from '../utils/reservation';
import type { HttpHandler } from '../types/http';
import { reportReservationPayment } from '../services/reservation-payment-report.service';
import { PaymentError } from '../services/payment.types';
import { Types } from 'mongoose';

const reservationAccess = async (authorization: unknown): Promise<
  {filter:{customerId:Types.ObjectId}|{guestAccessTokenHash:string};actor:string}|null
> => {
  if (typeof authorization !== 'string') return null;
  const guest = /^Reservation ([A-Za-z0-9_-]{43})$/.exec(authorization);
  if (guest) return {filter:{guestAccessTokenHash:hashGuestAccessToken(guest[1])},actor:'guest'};
  const bearer = parseBearerAuthorization(authorization);
  const identity = bearer.kind === 'bearer' ? await authenticateLegacyBearer(bearer.token) : null;
  return identity ? {filter:{customerId:identity.userId},actor:'customer:'+identity.userId.toHexString()} : null;
};

// A reservation number is an identifier, never authorization. Guest capabilities
// travel only in the Authorization header, not query strings or access logs.
export const getReservationStatus: HttpHandler = async (request, response, next) => {
  response.setHeader?.('Cache-Control', 'private, no-store');
  response.setHeader?.('Pragma', 'no-cache');
  response.setHeader?.('Vary', 'Authorization');
  const unavailable = () => response.status(404).json({
    error: { code: 'RESERVATION_NOT_FOUND', message: 'Reservation unavailable' },
  });
  const number = request.params?.reservationNumber;
  const authorization = request.headers.authorization;
  if (!number || !/^AK-\d{4}-[A-Z0-9]{6}$/.test(number) || typeof authorization !== 'string') {
    return unavailable();
  }
  try {
    const access = await reservationAccess(authorization);
    if (!access) return unavailable();
    const reservation = await ReservationV2Model.findOne({
      reservationNumber: number,
      ...access.filter,
    }).exec();
    if (!reservation) return unavailable();
    // Explicit projection omits customer data, notes, internal ledger and hashes.
    return response.status(200).json(toPublicReservationResponse(reservation.toObject()));
  } catch (error) {
    return next(error);
  }
};

export const reportReservationTransfer: HttpHandler = async (request,response,next) => {
  response.setHeader?.('Cache-Control','private, no-store');
  response.setHeader?.('Vary','Authorization');
  try {
    const number = request.params?.reservationNumber;
    const access = await reservationAccess(request.headers.authorization);
    if (!access || !number || !/^AK-\d{4}-[A-Z0-9]{6}$/.test(number))
      throw new PaymentError('RESERVATION_NOT_FOUND',404);
    const reservation = await reportReservationPayment(number,access.filter,request.body,access.actor);
    return response.status(200).json(toPublicReservationResponse(reservation));
  } catch(error) {
    if (error instanceof PaymentError)
      return response.status(error.status).json({error:{code:error.code,message:error.message}});
    return next(error);
  }
};
