import type { Types } from 'mongoose';

export type AvailabilityErrorCode =
  | 'NON_CANONICAL_DATE'
  | 'INVALID_DATE_RANGE'
  | 'INVALID_NOW'
  | 'PRODUCT_NOT_FOUND'
  | 'VARIANT_NOT_FOUND'
  | 'INVENTORY_ITEM_NOT_FOUND';

export class AvailabilityError extends Error {
  constructor(
    public readonly code: AvailabilityErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AvailabilityError';
  }
}

export interface AvailabilityOptions {
  now?: Date;
}

export interface VariantAvailabilityResult {
  variantId: Types.ObjectId;
  size: string;
  available: boolean;
  availableItemCount: number;
}

export interface ProductAvailabilityResult {
  productId: Types.ObjectId;
  available: boolean;
  variants: VariantAvailabilityResult[];
}
