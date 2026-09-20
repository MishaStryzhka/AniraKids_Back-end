import {
  ConcurrencyError,
} from '../services/concurrency.types';
import {
  ReservationServiceError,
} from '../services/reservation.types';
import {
  PricingError,
} from '../utils/pricing';
import {
  IdempotencyConfigurationError,
} from '../utils/idempotency';
import type {
  HttpErrorHandler,
} from '../types/http';

export interface ReservationApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export interface MappedReservationApiError {
  status: number;
  body: ReservationApiErrorBody;
}

const mapped = (
  status: number,
  code: string,
  message: string
): MappedReservationApiError => ({
  status,
  body: {
    error: {
      code,
      message,
    },
  },
});

export const mapReservationApiError = (
  error: unknown
): MappedReservationApiError => {
  if (error instanceof ReservationServiceError) {
    switch (error.code) {
      case 'INVALID_DATE':
        return mapped(400, error.code, 'Invalid rental date');
      case 'PAST_START_DATE':
        return mapped(
          400,
          error.code,
          'Rental start date cannot be in the past'
        );
      case 'VARIANT_PRODUCT_MISMATCH':
        return mapped(
          400,
          error.code,
          'Variant does not belong to the requested product'
        );
      case 'PRODUCT_NOT_FOUND':
        return mapped(404, error.code, 'Product not found');
      case 'VARIANT_NOT_FOUND':
        return mapped(404, error.code, 'Variant not found');
      case 'PRODUCT_NOT_RENTABLE':
        return mapped(
          409,
          error.code,
          'Product is not available for rental'
        );
      case 'VARIANT_NOT_ACTIVE':
        return mapped(409, error.code, 'Variant is not available');
      case 'NO_AVAILABLE_INVENTORY':
        return mapped(
          409,
          error.code,
          'No inventory is available for the requested dates'
        );
      case 'IDEMPOTENCY_KEY_REUSED':
        return mapped(
          409,
          error.code,
          'Idempotency key was already used for a different request'
        );
      case 'RESERVATION_NUMBER_GENERATION_FAILED':
        return mapped(
          500,
          'INTERNAL_ERROR',
          'Unable to create reservation'
        );
    }
  }

  if (
    error instanceof ConcurrencyError &&
    error.code === 'INVENTORY_ITEM_NOT_AVAILABLE'
  ) {
    return mapped(
      409,
      error.code,
      'Requested inventory is no longer available'
    );
  }

  if (error instanceof IdempotencyConfigurationError) {
    return mapped(
      503,
      'RESERVATION_API_CONFIGURATION_ERROR',
      'Reservation API is not fully configured'
    );
  }

  if (error instanceof PricingError) {
    return mapped(
      500,
      'INTERNAL_ERROR',
      'Unable to create reservation'
    );
  }

  return mapped(
    500,
    'INTERNAL_ERROR',
    'Unable to create reservation'
  );
};

export const reservationApiErrorHandler: HttpErrorHandler = (
  error,
  _request,
  response,
  _next
) => {
  const mappedError = mapReservationApiError(error);

  if (mappedError.status >= 500) {
    console.error('V2 reservation API error', {
      code: mappedError.body.error.code,
      status: mappedError.status,
    });
  }

  return response
    .status(mappedError.status)
    .json(mappedError.body);
};
