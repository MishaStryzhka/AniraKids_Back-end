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
