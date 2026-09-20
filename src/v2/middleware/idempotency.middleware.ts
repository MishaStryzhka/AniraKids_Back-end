import {
  deriveIdempotentGuestAccessToken,
  hashIdempotencyKey,
  hashReservationFingerprint,
  isCanonicalUuidV4,
  requireGuestTokenSecret,
} from '../utils/idempotency';
import {
  reservationService,
} from '../services/reservation.service';
import type {
  HttpHandler,
  HttpRequest,
  JsonResponse,
} from '../types/http';
import type {
  ReservationRequestBody,
} from '../schemas/reservation.schema';
import {
  toPublicCreateReservationResponse,
} from '../http/reservation-response';

const sendError = (
  response: JsonResponse,
  status: number,
  code: string,
  message: string
): unknown =>
  response.status(status).json({
    error: {
      code,
      message,
    },
  });

const getIdempotencyHeader = (
  request: HttpRequest
): string | string[] | undefined =>
  request.headers['idempotency-key'] ??
  request.headers['Idempotency-Key'];

export const reservationApiHardeningReady: HttpHandler = (
  _request,
  response,
  next
) => {
  try {
    requireGuestTokenSecret();
    return next();
  } catch (_error) {
    return sendError(
      response,
      503,
      'RESERVATION_API_CONFIGURATION_ERROR',
      'Reservation API is not fully configured'
    );
  }
};

export const requireReservationIdempotencyKey: HttpHandler = (
  request,
  response,
  next
) => {
  const rawKey = getIdempotencyHeader(request);

  if (rawKey === undefined) {
    return sendError(
      response,
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key header is required'
    );
  }

  if (
    typeof rawKey !== 'string' ||
    !isCanonicalUuidV4(rawKey)
  ) {
    return sendError(
      response,
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency-Key must be a canonical UUID v4'
    );
  }

  request.reservationIdempotencyKey = rawKey;
  return next();
};

export const resolveReservationIdempotency: HttpHandler = async (
  request,
  response,
  next
) => {
  const body = request.body as ReservationRequestBody;
  const rawKey = request.reservationIdempotencyKey;

  if (!rawKey) {
    return next(
      new Error('Validated idempotency key is missing from request context')
    );
  }

  try {
    const keyHash = hashIdempotencyKey(rawKey);
    const requestHash = hashReservationFingerprint({
      productId: body.productId,
      variantId: body.variantId,
      rentalMode: body.rentalMode,
      startDate: body.startDate,
      endDate: body.endDate,
      customer: body.customer,
      notes: body.notes,
      authenticatedUserId: request.authenticatedUserId,
    });

    const guestAccessToken = request.authenticatedUserId
      ? undefined
      : deriveIdempotentGuestAccessToken(rawKey);

    request.reservationIdempotency = {
      keyHash,
      requestHash,
      guestAccessToken,
    };

    request.reservationIdempotencyKey = undefined;

    const replay = await reservationService.findIdempotentReplay(
      request.reservationIdempotency
    );

    if (replay) {
      return response
        .status(200)
        .json(toPublicCreateReservationResponse(replay));
    }

    return next();
  } catch (error) {
    request.reservationIdempotencyKey = undefined;
    return next(error);
  }
};
