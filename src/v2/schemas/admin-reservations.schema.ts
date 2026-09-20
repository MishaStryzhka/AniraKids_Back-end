import Joi = require('joi');

import {
  PAYMENT_STATUSES,
  RENTAL_MODES,
  RESERVATION_STATUSES,
  type PaymentStatus,
  type RentalMode,
  type ReservationStatus,
} from '../types/domain';
import type {
  ReservationAdminCalendarOptions,
  ReservationAdminCancelInput,
  ReservationAdminListOptions,
  ReservationAdminNotesInput,
} from '../services/reservation-admin.types';
import type {
  ValidationResult,
} from './admin-catalogue.schema';

const positiveIntegerStringPattern = /^[1-9]\d*$/;
const dateOnlyInput = Joi.string().min(1).max(32);

const listReservationsQuerySchema = Joi.object({
  status: Joi.string().valid(...RESERVATION_STATUSES).optional(),
  paymentStatus: Joi.string().valid(...PAYMENT_STATUSES).optional(),
  rentalMode: Joi.string().valid(...RENTAL_MODES).optional(),
  from: dateOnlyInput.optional(),
  to: dateOnlyInput.optional(),
  q: Joi.string().max(200).optional(),
  page: Joi.string().pattern(positiveIntegerStringPattern).optional(),
  limit: Joi.string().pattern(positiveIntegerStringPattern).optional(),
}).unknown(false);

const calendarReservationsQuerySchema = Joi.object({
  from: dateOnlyInput.required(),
  to: dateOnlyInput.required(),
}).unknown(false);

const cancelReservationBodySchema = Joi.object({
  reason: Joi.string().max(600).required(),
}).unknown(false);

const updateReservationNotesBodySchema = Joi.object({
  notes: Joi.string().max(1500).allow('').required(),
}).unknown(false);

const validate = <T>(
  schema: any,
  input: unknown
): ValidationResult<T> => {
  const { value, error } = schema.validate(input, {
    abortEarly: false,
    convert: false,
  });

  if (error) {
    return {
      errorMessage: error.details[0]?.message ?? 'Invalid request',
    };
  }

  return {
    value: value as T,
  };
};

export const validateListReservationsAdminQuery = (
  input: unknown
): ValidationResult<ReservationAdminListOptions> => {
  const result = validate<Record<string, string>>(
    listReservationsQuerySchema,
    input
  );

  if (!result.value) {
    return {
      errorMessage: result.errorMessage,
    };
  }

  const raw = result.value;
  const page = raw.page === undefined ? 1 : Number(raw.page);
  const limit = raw.limit === undefined ? 20 : Number(raw.limit);

  if (limit > 100) {
    return {
      errorMessage: '"limit" must be less than or equal to 100',
    };
  }

  const q = raw.q === undefined ? undefined : raw.q.trim();

  if (q !== undefined && q.length === 0) {
    return {
      errorMessage: '"q" must contain non-whitespace characters',
    };
  }

  return {
    value: {
      status: raw.status as ReservationStatus | undefined,
      paymentStatus: raw.paymentStatus as PaymentStatus | undefined,
      rentalMode: raw.rentalMode as RentalMode | undefined,
      from: raw.from,
      to: raw.to,
      q,
      page,
      limit,
    },
  };
};

export const validateCalendarReservationsAdminQuery = (
  input: unknown
): ValidationResult<ReservationAdminCalendarOptions> =>
  validate(calendarReservationsQuerySchema, input);

export const validateCancelReservationAdminBody = (
  input: unknown
): ValidationResult<ReservationAdminCancelInput> => {
  const result = validate<ReservationAdminCancelInput>(
    cancelReservationBodySchema,
    input
  );

  if (!result.value) {
    return result;
  }

  const reason = result.value.reason.trim();

  if (reason.length === 0) {
    return {
      errorMessage: '"reason" must contain non-whitespace characters',
    };
  }

  if (reason.length > 500) {
    return {
      errorMessage: '"reason" must be less than or equal to 500 characters after trimming',
    };
  }

  return {
    value: {
      reason,
    },
  };
};

export const validateUpdateReservationNotesAdminBody = (
  input: unknown
): ValidationResult<ReservationAdminNotesInput> =>
  validate(updateReservationNotesBodySchema, input);
