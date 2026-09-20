import {
  ReservationV2Model,
} from '../models';
import {
  LegacyAuthConfigurationError,
  authenticateLegacyBearer,
  parseBearerAuthorization,
} from '../auth/legacy-bearer';
import type {
  HttpHandler,
  HttpRequest,
  JsonResponse,
} from '../types/http';
import type {
  ReservationRequestBody,
} from '../schemas/reservation.schema';
import {
  validateReservationRequestBody,
} from '../schemas/reservation.schema';

type OptionalBearerResult =
  | { kind: 'guest' }
  | { kind: 'bearer'; token: string }
  | { kind: 'invalid' };

const getAuthorizationHeader = (
  request: HttpRequest
): string | string[] | undefined =>
  request.headers.authorization ?? request.headers.Authorization;

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

export const parseOptionalBearerAuthorization = (
  authorization: string | string[] | undefined
): OptionalBearerResult => {
  const parsed = parseBearerAuthorization(authorization);

  if (parsed.kind === 'missing') {
    return {
      kind: 'guest',
    };
  }

  return parsed;
};

export const reservationApiEnabled: HttpHandler = (
  _request,
  response,
  next
) => {
  if (process.env.V2_RESERVATION_API_ENABLED !== 'true') {
    return sendError(
      response,
      503,
      'RESERVATION_API_DISABLED',
      'Reservation API is temporarily unavailable'
    );
  }

  return next();
};

export const validateReservationBody: HttpHandler = (
  request,
  response,
  next
) => {
  const validation = validateReservationRequestBody(request.body);

  if (!validation.value) {
    return sendError(
      response,
      400,
      'VALIDATION_ERROR',
      validation.errorMessage ?? 'Invalid request body'
    );
  }

  request.body = validation.value;
  return next();
};

export const rejectMalformedOptionalAuthorization: HttpHandler = (
  request,
  response,
  next
) => {
  const parsed = parseOptionalBearerAuthorization(
    getAuthorizationHeader(request)
  );

  if (parsed.kind === 'invalid') {
    return sendError(
      response,
      401,
      'UNAUTHORIZED',
      'Unauthorized'
    );
  }

  return next();
};

export const optionalLegacyAuth: HttpHandler = async (
  request,
  response,
  next
) => {
  const parsed = parseOptionalBearerAuthorization(
    getAuthorizationHeader(request)
  );

  if (parsed.kind === 'guest') {
    return next();
  }

  if (parsed.kind === 'invalid') {
    return sendError(
      response,
      401,
      'UNAUTHORIZED',
      'Unauthorized'
    );
  }

  try {
    const identity = await authenticateLegacyBearer(parsed.token);

    if (!identity) {
      return sendError(
        response,
        401,
        'UNAUTHORIZED',
        'Unauthorized'
      );
    }

    request.authenticatedUserId = identity.userId;
    return next();
  } catch (error) {
    if (error instanceof LegacyAuthConfigurationError) {
      return next(new Error('JWT authentication is not configured'));
    }

    return next(error);
  }
};

export const normalizeReservationEmail = (email: string): string =>
  email.trim().toLowerCase();

export const activePendingEmailGuard: HttpHandler = async (
  request,
  response,
  next
) => {
  const body = request.body as ReservationRequestBody;
  const normalizedEmail = normalizeReservationEmail(body.customer.email);
  const now = new Date();

  request.reservationRequestNow = now;

  try {
    const count = await ReservationV2Model.countDocuments({
      'customerSnapshot.email': normalizedEmail,
      status: 'pending',
      expiresAt: {
        $gt: now,
      },
    }).exec();

    if (count >= 3) {
      return sendError(
        response,
        429,
        'TOO_MANY_ACTIVE_PENDING_RESERVATIONS',
        'Too many active pending reservations for this email'
      );
    }

    return next();
  } catch (error) {
    return next(error);
  }
};
