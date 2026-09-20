import type { Types } from 'mongoose';

import {
  formatDateOnly,
} from '../utils/date-only';

const toPlainObject = (
  input: unknown
): Record<string, unknown> => {
  if (
    typeof input === 'object' &&
    input !== null &&
    'toObject' in input &&
    typeof (input as { toObject?: unknown }).toObject === 'function'
  ) {
    return (input as { toObject(): Record<string, unknown> }).toObject();
  }

  if (typeof input === 'object' && input !== null) {
    return input as Record<string, unknown>;
  }

  throw new Error('Admin DTO source must be an object');
};

const toId = (value: unknown): string => {
  if (
    typeof value === 'object' &&
    value !== null &&
    'toString' in value &&
    typeof (value as { toString?: unknown }).toString === 'function'
  ) {
    return (value as { toString(): string }).toString();
  }

  return String(value);
};

const copyDefined = (
  source: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  for (const key of keys) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }

  return result;
};

export const toAdminProductDto = (input: unknown) => {
  const source = toPlainObject(input);

  return {
    id: toId(source._id),
    ...copyDefined(source, [
      'name',
      'slug',
      'description',
      'category',
      'gender',
      'color',
      'occasion',
      'ageTags',
      'brand',
      'familyLookGroup',
      'rentalEnabled',
      'saleEnabled',
      'rentalPrices',
      'defaultSalePrice',
      'defaultDeposit',
      'photos',
      'status',
      'seo',
      'createdAt',
      'updatedAt',
    ]),
  };
};

export const toAdminVariantDto = (input: unknown) => {
  const source = toPlainObject(input);

  return {
    id: toId(source._id),
    productId: toId(source.productId),
    ...copyDefined(source, [
      'size',
      'sku',
      'rentalPriceOverrides',
      'salePriceOverride',
      'depositOverride',
      'status',
      'sortOrder',
      'createdAt',
      'updatedAt',
    ]),
  };
};

export const toAdminInventoryItemDto = (input: unknown) => {
  const source = toPlainObject(input);

  return {
    id: toId(source._id),
    variantId: toId(source.variantId),
    ...copyDefined(source, [
      'internalCode',
      'status',
      'condition',
      'notes',
      'acquiredAt',
      'retiredAt',
      'createdAt',
      'updatedAt',
    ]),
  };
};

export const toAdminProductDetailDto = (input: {
  product: unknown;
  variants: Array<{
    variant: unknown;
    inventory: unknown[];
  }>;
}) => ({
  product: toAdminProductDto(input.product),
  variants: input.variants.map(item => ({
    ...toAdminVariantDto(item.variant),
    inventory: item.inventory.map(toAdminInventoryItemDto),
  })),
});

export const toAdminProductListDto = (input: {
  items: unknown[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}) => ({
  items: input.items.map(toAdminProductDto),
  pagination: input.pagination,
});


export const toAdminAvailabilityBlockDto = (input: unknown) => {
  const source = toPlainObject(input);

  if (!(source.startDate instanceof Date) || !(source.endDate instanceof Date)) {
    throw new Error('Availability block dates must be Date values');
  }

  return {
    id: toId(source._id),
    inventoryItemId: toId(source.inventoryItemId),
    startDate: formatDateOnly(source.startDate),
    endDate: formatDateOnly(source.endDate),
    reason: source.reason,
    ...(source.notes === undefined ? {} : { notes: source.notes }),
    createdBy: toId(source.createdBy),
    createdAt: source.createdAt,
  };
};
