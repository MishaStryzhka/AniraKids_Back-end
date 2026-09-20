import Joi = require('joi');

import {
  INVENTORY_CONDITIONS,
  PRODUCT_CATEGORIES,
  PRODUCT_GENDERS,
  PRODUCT_OCCASIONS,
  PRODUCT_STATUSES,
  VARIANT_STATUSES,
  type InventoryCondition,
  type ProductCategory,
  type ProductGender,
  type ProductOccasion,
  type ProductStatus,
  type VariantStatus,
} from '../types/domain';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const internalCodePattern = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const positiveIntegerStringPattern = /^[1-9]\d*$/;

const money = Joi.number().integer().min(0);
const nonEmptyText = Joi.string().trim().min(1);

const rentalPricesSchema = Joi.object({
  studio: money.optional(),
  external: money.optional(),
}).unknown(false);

const rentalPriceOverridesSchema = Joi.object({
  studio: money.optional(),
  external: money.optional(),
}).unknown(false);

const seoInputSchema = Joi.object({
  title: Joi.string().max(70).allow('').optional(),
  description: Joi.string().max(180).allow('').optional(),
}).unknown(false);

const productFields = {
  name: Joi.string().trim().min(2).max(120),
  slug: Joi.string().trim().lowercase().min(2).max(160).pattern(slugPattern),
  description: Joi.string().max(5000).allow(''),
  category: Joi.string().valid(...PRODUCT_CATEGORIES),
  gender: Joi.string().valid(...PRODUCT_GENDERS),
  color: Joi.string().max(80).allow(''),
  occasion: Joi.array()
    .items(Joi.string().valid(...PRODUCT_OCCASIONS))
    .max(PRODUCT_OCCASIONS.length),
  ageTags: Joi.array().items(Joi.string().trim().min(1).max(40)).max(20),
  brand: Joi.string().max(100).allow(''),
  familyLookGroup: Joi.string().max(100).allow(''),
  rentalEnabled: Joi.boolean(),
  saleEnabled: Joi.boolean(),
  rentalPrices: rentalPricesSchema,
  defaultSalePrice: money,
  defaultDeposit: money,
  seo: seoInputSchema,
};

export interface CreateProductAdminBody {
  name: string;
  slug?: string;
  description?: string;
  category?: ProductCategory;
  gender?: ProductGender;
  color?: string;
  occasion?: ProductOccasion[];
  ageTags?: string[];
  brand?: string;
  familyLookGroup?: string;
  rentalEnabled?: boolean;
  saleEnabled?: boolean;
  rentalPrices?: {
    studio?: number;
    external?: number;
  };
  defaultSalePrice?: number;
  defaultDeposit?: number;
  seo?: {
    title?: string;
    description?: string;
  };
}

export type UpdateProductAdminBody = Partial<CreateProductAdminBody>;

export interface CreateVariantAdminBody {
  size: string;
  sku?: string;
  rentalPriceOverrides?: {
    studio?: number;
    external?: number;
  };
  salePriceOverride?: number;
  depositOverride?: number;
  sortOrder?: number;
  status?: VariantStatus;
}

export type UpdateVariantAdminBody = Partial<CreateVariantAdminBody>;

export interface CreateInventoryItemAdminBody {
  internalCode: string;
  condition?: InventoryCondition;
  notes?: string;
  acquiredAt?: string;
}

export interface UpdateInventoryItemAdminBody {
  condition?: InventoryCondition;
  notes?: string;
  acquiredAt?: string;
}

export interface ListProductsAdminQuery {
  status?: ProductStatus;
  category?: ProductCategory;
  gender?: ProductGender;
  rentalEnabled?: boolean;
  page: number;
  limit: number;
}

const createProductSchema = Joi.object({
  ...productFields,
  name: productFields.name.required(),
}).unknown(false);

const updateProductSchema = Joi.object(productFields)
  .min(1)
  .unknown(false);

const createVariantSchema = Joi.object({
  size: Joi.string().trim().min(1).max(40).required(),
  sku: Joi.string().trim().min(1).max(80).optional(),
  rentalPriceOverrides: rentalPriceOverridesSchema.optional(),
  salePriceOverride: money.optional(),
  depositOverride: money.optional(),
  sortOrder: Joi.number().integer().min(0).optional(),
  status: Joi.string().valid(...VARIANT_STATUSES).optional(),
}).unknown(false);

const updateVariantSchema = Joi.object({
  size: Joi.string().trim().min(1).max(40).optional(),
  sku: Joi.string().trim().min(1).max(80).optional(),
  rentalPriceOverrides: rentalPriceOverridesSchema.optional(),
  salePriceOverride: money.optional(),
  depositOverride: money.optional(),
  sortOrder: Joi.number().integer().min(0).optional(),
  status: Joi.string().valid(...VARIANT_STATUSES).optional(),
})
  .min(1)
  .unknown(false);

const createInventoryItemSchema = Joi.object({
  internalCode: Joi.string()
    .trim()
    .min(2)
    .max(80)
    .pattern(internalCodePattern)
    .required(),
  condition: Joi.string().valid(...INVENTORY_CONDITIONS).optional(),
  notes: Joi.string().max(1000).allow('').optional(),
  acquiredAt: Joi.string().isoDate().optional(),
}).unknown(false);

const updateInventoryItemSchema = Joi.object({
  condition: Joi.string().valid(...INVENTORY_CONDITIONS).optional(),
  notes: Joi.string().max(1000).allow('').optional(),
  acquiredAt: Joi.string().isoDate().optional(),
})
  .min(1)
  .unknown(false);

const listProductsQuerySchema = Joi.object({
  status: Joi.string().valid(...PRODUCT_STATUSES).optional(),
  category: Joi.string().valid(...PRODUCT_CATEGORIES).optional(),
  gender: Joi.string().valid(...PRODUCT_GENDERS).optional(),
  rentalEnabled: Joi.string().valid('true', 'false').optional(),
  page: Joi.string().pattern(positiveIntegerStringPattern).optional(),
  limit: Joi.string().pattern(positiveIntegerStringPattern).optional(),
}).unknown(false);

export interface ValidationResult<T> {
  value?: T;
  errorMessage?: string;
}

const validate = <T>(
  schema: Joi.ObjectSchema,
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

export const validateCreateProductAdminBody = (
  input: unknown
): ValidationResult<CreateProductAdminBody> =>
  validate(createProductSchema, input);

export const validateUpdateProductAdminBody = (
  input: unknown
): ValidationResult<UpdateProductAdminBody> =>
  validate(updateProductSchema, input);

export const validateCreateVariantAdminBody = (
  input: unknown
): ValidationResult<CreateVariantAdminBody> =>
  validate(createVariantSchema, input);

export const validateUpdateVariantAdminBody = (
  input: unknown
): ValidationResult<UpdateVariantAdminBody> =>
  validate(updateVariantSchema, input);

export const validateCreateInventoryItemAdminBody = (
  input: unknown
): ValidationResult<CreateInventoryItemAdminBody> =>
  validate(createInventoryItemSchema, input);

export const validateUpdateInventoryItemAdminBody = (
  input: unknown
): ValidationResult<UpdateInventoryItemAdminBody> =>
  validate(updateInventoryItemSchema, input);

export const validateListProductsAdminQuery = (
  input: unknown
): ValidationResult<ListProductsAdminQuery> => {
  const validation = validate<Record<string, string>>(
    listProductsQuerySchema,
    input
  );

  if (!validation.value) {
    return validation as ValidationResult<ListProductsAdminQuery>;
  }

  const raw = validation.value;
  const page = raw.page === undefined ? 1 : Number(raw.page);
  const limit = raw.limit === undefined ? 20 : Number(raw.limit);

  if (limit > 100) {
    return {
      errorMessage: '"limit" must be less than or equal to 100',
    };
  }

  return {
    value: {
      status: raw.status as ProductStatus | undefined,
      category: raw.category as ProductCategory | undefined,
      gender: raw.gender as ProductGender | undefined,
      rentalEnabled:
        raw.rentalEnabled === undefined
          ? undefined
          : raw.rentalEnabled === 'true',
      page,
      limit,
    },
  };
};

export const hasNonWhitespace = (value: unknown): boolean =>
  typeof value === 'string' && nonEmptyText.validate(value).error === undefined;
