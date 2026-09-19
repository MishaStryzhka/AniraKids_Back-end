import { model, models, Schema, type Model } from 'mongoose';

import { VARIANT_STATUSES, type Variant } from '../types/domain';
import { isMoneyAmount, isNonNegativeInteger } from './validation';

export const VARIANT_V2_MODEL_NAME = 'VariantV2';
export const VARIANT_V2_COLLECTION = 'v2_variants';

const normalizeOptionalSku = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : undefined;
};

const rentalPriceOverridesSchema = new Schema(
  {
    studio: {
      type: Number,
      validate: {
        validator: isMoneyAmount,
        message: 'studio rental price override must be a non-negative integer amount in Kč',
      },
    },
    external: {
      type: Number,
      validate: {
        validator: isMoneyAmount,
        message: 'external rental price override must be a non-negative integer amount in Kč',
      },
    },
  },
  { _id: false }
);

export const VariantV2Schema = new Schema<Variant>(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'ProductV2',
      required: true,
    },
    size: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 40,
    },
    sku: {
      type: String,
      set: normalizeOptionalSku,
      maxlength: 80,
    },
    rentalPriceOverrides: {
      type: rentalPriceOverridesSchema,
      default: undefined,
    },
    salePriceOverride: {
      type: Number,
      validate: {
        validator: isMoneyAmount,
        message: 'salePriceOverride must be a non-negative integer amount in Kč',
      },
    },
    depositOverride: {
      type: Number,
      validate: {
        validator: isMoneyAmount,
        message: 'depositOverride must be a non-negative integer amount in Kč',
      },
    },
    status: {
      type: String,
      enum: [...VARIANT_STATUSES],
      default: 'active',
    },
    sortOrder: {
      type: Number,
      default: 0,
      validate: {
        validator: isNonNegativeInteger,
        message: 'sortOrder must be a non-negative integer',
      },
    },
  },
  {
    collection: VARIANT_V2_COLLECTION,
    timestamps: true,
    versionKey: false,
  }
);

VariantV2Schema.index(
  { productId: 1, size: 1 },
  { unique: true, name: 'uniq_v2_variant_product_size' }
);

VariantV2Schema.index(
  { sku: 1 },
  {
    unique: true,
    name: 'uniq_v2_variant_sku',
    partialFilterExpression: { sku: { $exists: true } },
  }
);

const existingVariantV2Model = models[VARIANT_V2_MODEL_NAME] as
  | Model<Variant>
  | undefined;

export const VariantV2Model =
  existingVariantV2Model ??
  model<Variant>(
    VARIANT_V2_MODEL_NAME,
    VariantV2Schema,
    VARIANT_V2_COLLECTION
  );
