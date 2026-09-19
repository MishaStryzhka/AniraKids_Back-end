import { Types } from 'mongoose';

import {
  ReservationV2Model,
} from '../models';
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

interface LegacyUserAuthRecord {
  _id: Types.ObjectId;
  tokens?: Array<{
    token?: string;
  }>;
}

interface LegacyUserQuery {
  select(selection: string): LegacyUserQuery;
  lean(): LegacyUserQuery;
  exec(): Promise<LegacyUserAuthRecord | null>;
}

interface LegacyUserModelLike {
  findById(id: string): LegacyUserQuery;
}

interface JwtModuleLike {
  verify(token: string, secret: string): unknown;
}

const LegacyUserModel = require('../../../models/user') as LegacyUserModelLike;
const jwt = require('jsonwebtoken') as JwtModuleLike;

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
  if (authorization === undefined) {
    return {
      kind: 'guest',
    };
  }

  if (typeof authorization !== 'string') {
    return {
      kind: 'invalid',
    };
  }

  const match = /^Bearer ([^\s]+)$/i.exec(authorization);

  if (!match) {
    return {
      kind: 'invalid',
    };
  }

  return {
    kind: 'bearer',
    token: match[1],
  };
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

const extractJwtUserId = (payload: unknown): string | undefined => {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('id' in payload)
  ) {
    return undefined;
  }

  const id = (payload as { id?: unknown }).id;

  if (typeof id === 'string' && Types.ObjectId.isValid(id)) {
    return id;
  }

  if (id instanceof Types.ObjectId) {
    return id.toHexString();
  }

  return undefined;
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

  const secret = process.env.SECRET_KEY;

  if (!secret) {
    return next(new Error('JWT authentication is not configured'));
  }

  let userId: string;

  try {
    const payload = jwt.verify(parsed.token, secret);
    const extractedUserId = extractJwtUserId(payload);

    if (!extractedUserId) {
      return sendError(
        response,
        401,
        'UNAUTHORIZED',
        'Unauthorized'
      );
    }

    userId = extractedUserId;
  } catch (_error) {
    return sendError(
      response,
      401,
      'UNAUTHORIZED',
      'Unauthorized'
    );
  }

  let user: LegacyUserAuthRecord | null;

  try {
    user = await LegacyUserModel.findById(userId)
      .select('_id tokens.token')
      .lean()
      .exec();
  } catch (error) {
    return next(error);
  }

  const hasActiveToken =
    user?.tokens?.some(item => item.token === parsed.token) ?? false;

  if (!user || !hasActiveToken) {
    return sendError(
      response,
      401,
      'UNAUTHORIZED',
      'Unauthorized'
    );
  }

  request.authenticatedUserId = new Types.ObjectId(user._id);
  return next();
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
