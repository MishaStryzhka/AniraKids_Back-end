import { Types } from 'mongoose';

import {
  LegacyAuthConfigurationError,
  authenticateLegacyBearer,
  parseBearerAuthorization,
} from '../auth/legacy-bearer';
import {
  validateCreateInventoryItemAdminBody,
  validateCreateProductAdminBody,
  validateCreateVariantAdminBody,
  validateListProductsAdminQuery,
  validateUpdateInventoryItemAdminBody,
  validateUpdateProductAdminBody,
  validateUpdateVariantAdminBody,
  type ValidationResult,
} from '../schemas/admin-catalogue.schema';
import {
  validateCreateAvailabilityBlockAdminBody,
  validateListAvailabilityBlocksAdminQuery,
} from '../schemas/admin-inventory-availability.schema';
import {
  validateCalendarReservationsAdminQuery,
  validateCancelReservationAdminBody,
  validateListReservationsAdminQuery,
  validateUpdateReservationNotesAdminBody,
} from '../schemas/admin-reservations.schema';
import type {
  HttpHandler,
  HttpRequest,
  JsonResponse,
} from '../types/http';

const objectIdPattern = /^[0-9a-fA-F]{24}$/;

export class AdminApiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminApiConfigurationError';
  }
}

export const parseAdminUserIds = (
  raw = process.env.V2_ADMIN_USER_IDS
): Set<string> => {
  if (!raw || raw.trim().length === 0) {
    throw new AdminApiConfigurationError(
      'V2_ADMIN_USER_IDS is not configured'
    );
  }

  const values = raw
    .split(',')
    .map(value => value.trim())
    .filter(value => value.length > 0);

  if (values.length === 0) {
    throw new AdminApiConfigurationError(
      'V2_ADMIN_USER_IDS is not configured'
    );
  }

  const ids = new Set<string>();

  for (const value of values) {
    if (!objectIdPattern.test(value)) {
      throw new AdminApiConfigurationError(
        'V2_ADMIN_USER_IDS contains an invalid ObjectId'
      );
    }

    ids.add(value.toLowerCase());
  }

  return ids;
};

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

export const adminApiEnabled: HttpHandler = (
  _request,
  response,
  next
) => {
  if (process.env.V2_ADMIN_API_ENABLED !== 'true') {
    return sendError(
      response,
      503,
      'ADMIN_API_DISABLED',
      'Admin API is temporarily unavailable'
    );
  }

  return next();
};

export const adminApiConfigurationReady: HttpHandler = (
  _request,
  response,
  next
) => {
  try {
    if (!process.env.SECRET_KEY) {
      throw new AdminApiConfigurationError(
        'SECRET_KEY is not configured'
      );
    }

    parseAdminUserIds();
    return next();
  } catch (error) {
    if (error instanceof AdminApiConfigurationError) {
      return sendError(
        response,
        503,
        'ADMIN_API_CONFIGURATION_ERROR',
        'Admin API is not fully configured'
      );
    }

    return next(error);
  }
};

export const requireAdminAuth: HttpHandler = async (
  request,
  response,
  next
) => {
  const parsed = parseBearerAuthorization(
    getAuthorizationHeader(request)
  );

  if (parsed.kind !== 'bearer') {
    return sendError(
      response,
      401,
      'ADMIN_UNAUTHORIZED',
      'Admin authentication is required'
    );
  }

  try {
    const identity = await authenticateLegacyBearer(parsed.token);

    if (!identity) {
      return sendError(
        response,
        401,
        'ADMIN_UNAUTHORIZED',
        'Admin authentication is required'
      );
    }

    const adminIds = parseAdminUserIds();

    if (!adminIds.has(identity.userId.toHexString().toLowerCase())) {
      return sendError(
        response,
        403,
        'ADMIN_FORBIDDEN',
        'Admin access is forbidden'
      );
    }

    request.authenticatedUserId = identity.userId;
    return next();
  } catch (error) {
    if (
      error instanceof LegacyAuthConfigurationError ||
      error instanceof AdminApiConfigurationError
    ) {
      return sendError(
        response,
        503,
        'ADMIN_API_CONFIGURATION_ERROR',
        'Admin API is not fully configured'
      );
    }

    return next(error);
  }
};

export const validateObjectIdParam = (
  paramName: string
): HttpHandler => (
  request,
  response,
  next
) => {
  const value = request.params?.[paramName];

  if (
    typeof value !== 'string' ||
    !objectIdPattern.test(value) ||
    !Types.ObjectId.isValid(value)
  ) {
    return sendError(
      response,
      400,
      'INVALID_ID',
      'Invalid resource id'
    );
  }

  return next();
};

const createBodyValidator = <T>(
  validator: (input: unknown) => ValidationResult<T>
): HttpHandler => (
  request,
  response,
  next
) => {
  const result = validator(request.body);

  if (!result.value) {
    return sendError(
      response,
      400,
      'VALIDATION_ERROR',
      result.errorMessage ?? 'Invalid request body'
    );
  }

  request.body = result.value;
  return next();
};

export const validateAdminCreateProduct =
  createBodyValidator(validateCreateProductAdminBody);

export const validateAdminUpdateProduct =
  createBodyValidator(validateUpdateProductAdminBody);

export const validateAdminCreateVariant =
  createBodyValidator(validateCreateVariantAdminBody);

export const validateAdminUpdateVariant =
  createBodyValidator(validateUpdateVariantAdminBody);

export const validateAdminCreateInventoryItem =
  createBodyValidator(validateCreateInventoryItemAdminBody);

export const validateAdminUpdateInventoryItem =
  createBodyValidator(validateUpdateInventoryItemAdminBody);

export const validateAdminCreateAvailabilityBlock =
  createBodyValidator(validateCreateAvailabilityBlockAdminBody);

export const validateAdminCancelReservation =
  createBodyValidator(validateCancelReservationAdminBody);

export const validateAdminUpdateReservationNotes =
  createBodyValidator(validateUpdateReservationNotesAdminBody);

export const validateAdminProductListQuery: HttpHandler = (
  request,
  response,
  next
) => {
  const result = validateListProductsAdminQuery(
    request.query ?? {}
  );

  if (!result.value) {
    return sendError(
      response,
      400,
      'VALIDATION_ERROR',
      result.errorMessage ?? 'Invalid query parameters'
    );
  }

  request.query = result.value as unknown as Record<string, unknown>;
  return next();
};


export const validateAdminAvailabilityBlockListQuery: HttpHandler = (
  request,
  response,
  next
) => {
  const result = validateListAvailabilityBlocksAdminQuery(
    request.query ?? {}
  );

  if (!result.value) {
    return sendError(
      response,
      400,
      'VALIDATION_ERROR',
      result.errorMessage ?? 'Invalid query parameters'
    );
  }

  request.query = result.value as unknown as Record<string, unknown>;
  return next();
};


export const validateAdminReservationListQuery: HttpHandler = (
  request,
  response,
  next
) => {
  const result = validateListReservationsAdminQuery(
    request.query ?? {}
  );

  if (!result.value) {
    return sendError(
      response,
      400,
      'VALIDATION_ERROR',
      result.errorMessage ?? 'Invalid query parameters'
    );
  }

  request.query = result.value as unknown as Record<string, unknown>;
  return next();
};

export const validateAdminReservationCalendarQuery: HttpHandler = (
  request,
  response,
  next
) => {
  const result = validateCalendarReservationsAdminQuery(
    request.query ?? {}
  );

  if (!result.value) {
    return sendError(
      response,
      400,
      'VALIDATION_ERROR',
      result.errorMessage ?? 'Invalid query parameters'
    );
  }

  request.query = result.value as unknown as Record<string, unknown>;
  return next();
};
