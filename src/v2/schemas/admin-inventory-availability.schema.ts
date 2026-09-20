import Joi = require('joi');

import {
  AVAILABILITY_BLOCK_REASONS,
  type AvailabilityBlockReason,
} from '../types/domain';
import type {
  CreateAvailabilityBlockAdminInput,
  ListAvailabilityBlocksAdminOptions,
} from '../services/inventory-availability-admin.types';
import type {
  ValidationResult,
} from './admin-catalogue.schema';

const dateOnlyString = Joi.string().trim().min(1).max(32);

const createAvailabilityBlockSchema = Joi.object({
  startDate: dateOnlyString.required(),
  endDate: dateOnlyString.required(),
  reason: Joi.string()
    .valid(...AVAILABILITY_BLOCK_REASONS)
    .required(),
  notes: Joi.string().max(1000).allow('').optional(),
}).unknown(false);

const listAvailabilityBlocksQuerySchema = Joi.object({
  from: dateOnlyString.optional(),
  to: dateOnlyString.optional(),
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

export const validateCreateAvailabilityBlockAdminBody = (
  input: unknown
): ValidationResult<CreateAvailabilityBlockAdminInput> =>
  validate(createAvailabilityBlockSchema, input);

export const validateListAvailabilityBlocksAdminQuery = (
  input: unknown
): ValidationResult<ListAvailabilityBlocksAdminOptions> =>
  validate(listAvailabilityBlocksQuerySchema, input);

export type CreateAvailabilityBlockAdminBody =
  CreateAvailabilityBlockAdminInput;

export interface ListAvailabilityBlocksAdminQuery {
  from?: string;
  to?: string;
}

export const isAvailabilityBlockReason = (
  value: unknown
): value is AvailabilityBlockReason =>
  typeof value === 'string' &&
  (AVAILABILITY_BLOCK_REASONS as readonly string[]).includes(value);
