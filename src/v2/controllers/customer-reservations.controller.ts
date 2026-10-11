import { hashGuestAccessToken } from '../utils/reservation';
import { ReservationV2Model } from '../models';
import { authenticateLegacyBearer, parseBearerAuthorization } from '../auth/legacy-bearer';
import { toPublicReservationResponse } from '../http/reservation-response';
import type { HttpHandler } from '../types/http';
export const listCustomerReservations: HttpHandler = async (request, response, next) => {
  response.setHeader?.('Cache-Control', 'private, no-store');
  response.setHeader?.('Vary', 'Authorization');
  try {
    const bearer = parseBearerAuthorization(request.headers.authorization);
    const identity = bearer.kind === 'bearer' ? await authenticateLegacyBearer(bearer.token) : null;
    if (!identity) return response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } });
    const raw = request.query?.page ?? '1';
    if (typeof raw !== 'string' || !/^[1-9]\d{0,4}$/.test(raw)) return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid page' } });
    const page = Number(raw), limit = 20;
    const filter = { customerId: identity.userId };
    const [records, total] = await Promise.all([
      ReservationV2Model.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).exec(),
      ReservationV2Model.countDocuments(filter).exec(),
    ]);
    return response.status(200).json({ items: records.map(record => toPublicReservationResponse(record.toObject())), page, limit, total });
  } catch (error) { return next(error); }
};

/** Explicit capability-based claim; never infer ownership from an email or number. */
export const claimCustomerReservation: HttpHandler = async (request, response, next) => {
  response.setHeader?.('Cache-Control', 'private, no-store');
  response.setHeader?.('Vary', 'Authorization');
  try {
    const bearer = parseBearerAuthorization(request.headers.authorization);
    const identity = bearer.kind === 'bearer' ? await authenticateLegacyBearer(bearer.token) : null;
    if (!identity) return response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } });
    const number = request.params?.reservationNumber;
    const body = request.body;
    if (!number || !/^AK-\d{4}-[A-Z0-9]{6}$/.test(number) || !body ||
        typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).length !== 1 || !('guestAccessToken' in body) ||
        typeof body.guestAccessToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.guestAccessToken)) {
      return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid claim' } });
    }
    // Same-owner replay succeeds; a concurrent or later different owner cannot take over.
    // Keep the existing capability valid so saved links and original guest retries still work.
    const record = await ReservationV2Model.findOneAndUpdate({
      reservationNumber: number,
      guestAccessTokenHash: hashGuestAccessToken(body.guestAccessToken),
      $or: [{ customerId: null }, { customerId: identity.userId }],
    }, { $set: { customerId: identity.userId } }, { new: true, runValidators: true }).exec();
    if (!record) return response.status(404).json({ error: { code: 'RESERVATION_NOT_FOUND', message: 'Reservation unavailable' } });
    return response.status(200).json(toPublicReservationResponse(record.toObject()));
  } catch (error) { return next(error); }
};
