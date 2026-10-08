import { ReservationV2Model } from '../models';
import { authenticateLegacyBearer, parseBearerAuthorization } from '../auth/legacy-bearer';
import { toPublicReservationResponse } from '../http/reservation-response';
import { hashGuestAccessToken } from '../utils/reservation';
import type { HttpHandler } from '../types/http';

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
    const guest = /^Reservation ([A-Za-z0-9_-]{43})$/.exec(authorization);
    let access: Record<string, unknown>;
    if (guest) {
      access = { guestAccessTokenHash: hashGuestAccessToken(guest[1]) };
    } else {
      const bearer = parseBearerAuthorization(authorization);
      if (bearer.kind !== 'bearer') return unavailable();
      const identity = await authenticateLegacyBearer(bearer.token);
      if (!identity) return unavailable();
      access = { customerId: identity.userId };
    }
    const reservation = await ReservationV2Model.findOne({
      reservationNumber: number,
      ...access,
    }).exec();
    if (!reservation) return unavailable();
    // Explicit projection omits customer data, notes, internal ledger and hashes.
    return response.status(200).json(toPublicReservationResponse(reservation.toObject()));
  } catch (error) {
    return next(error);
  }
};
