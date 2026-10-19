import Joi = require('joi');

import type {
  RentalMode,
} from '../types/domain';

export interface ReservationRequestBody {
  fittingDiscount?: import('../services/fitting-discount.service').FittingDiscountSelection;
  referralToken?: string;
  items?: Array<{ productId: string; variantId: string }>;
  productId: string;
  variantId: string;
  rentalMode: RentalMode;
  startDate: string;
  endDate: string;
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  notes?: string;
}

export interface ReservationBodyValidationResult {
  value?: ReservationRequestBody;
  errorMessage?: string;
}

const objectIdPattern = /^[0-9a-fA-F]{24}$/;
const dateOnlyShapePattern = /^\d{4}-\d{2}-\d{2}$/;
const hasNonWhitespacePattern = /\S/;

const customerSchema = Joi.object({
  firstName: Joi.string()
    .pattern(hasNonWhitespacePattern)
    .max(100)
    .required(),
  lastName: Joi.string()
    .pattern(hasNonWhitespacePattern)
    .max(100)
    .required(),
  email: Joi.string()
    .email({ tlds: false })
    .max(254)
    .required(),
  phone: Joi.string()
    .pattern(hasNonWhitespacePattern)
    .min(5)
    .max(32)
    .required(),
})
  .unknown(false)
  .required();

export const reservationRequestSchema = Joi.object({
  fittingDiscount: Joi.object({number:Joi.string().pattern(/^ZK-[A-F0-9]{12}$/).required(),token:Joi.string().pattern(/^[a-f0-9]{64}$/)}).unknown(false),
  referralToken: Joi.string().max(1200),
  productId: Joi.string().pattern(objectIdPattern),
  variantId: Joi.string().pattern(objectIdPattern),
  items: Joi.array().items(Joi.object({
    productId: Joi.string().pattern(objectIdPattern).required(),
    variantId: Joi.string().pattern(objectIdPattern).required(),
  }).unknown(false)).min(1).max(20),
  rentalMode: Joi.string().valid('studio', 'external').required(),
  startDate: Joi.string().pattern(dateOnlyShapePattern).required(),
  endDate: Joi.string().pattern(dateOnlyShapePattern).required(),
  customer: customerSchema,
  notes: Joi.string().max(1500).allow('').optional(),
}).unknown(false).xor('productId', 'items').and('productId', 'variantId').without('items', 'variantId');

export const validateReservationRequestBody = (
  input: unknown
): ReservationBodyValidationResult => {
  const { value, error } = reservationRequestSchema.validate(input, {
    abortEarly: false,
    convert: false,
  });

  if (error) {
    return {
      errorMessage: error.details[0]?.message ?? 'Invalid request body',
    };
  }

  return {
    value: { ...value, ...(value.items ? {
      productId: value.items[0].productId, variantId: value.items[0].variantId,
    } : {}) } as ReservationRequestBody,
  };
};
