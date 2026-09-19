import { model, models, Schema, type Model } from 'mongoose';

import {
  INVENTORY_CONDITIONS,
  INVENTORY_ITEM_STATUSES,
  type InventoryItem,
} from '../types/domain';
import { isNonNegativeInteger } from './validation';

export const INVENTORY_ITEM_V2_MODEL_NAME = 'InventoryItemV2';
export const INVENTORY_ITEM_V2_COLLECTION = 'v2_inventory_items';

const normalizeInternalCode = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export const InventoryItemV2Schema = new Schema<InventoryItem>(
  {
    variantId: {
      type: Schema.Types.ObjectId,
      ref: 'VariantV2',
      required: true,
    },
    internalCode: {
      type: String,
      required: true,
      trim: true,
      set: normalizeInternalCode,
      immutable: true,
      minlength: 2,
      maxlength: 80,
      match: /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
    },
    status: {
      type: String,
      enum: [...INVENTORY_ITEM_STATUSES],
      default: 'active',
    },
    condition: {
      type: String,
      enum: [...INVENTORY_CONDITIONS],
      default: 'good',
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    acquiredAt: {
      type: Date,
    },
    retiredAt: {
      type: Date,
    },
    bookingRevision: {
      type: Number,
      default: 0,
      select: false,
      validate: {
        validator: isNonNegativeInteger,
        message: 'bookingRevision must be a non-negative integer',
      },
    },
  },
  {
    collection: INVENTORY_ITEM_V2_COLLECTION,
    timestamps: true,
    versionKey: false,
  }
);

InventoryItemV2Schema.index(
  { internalCode: 1 },
  { unique: true, name: 'uniq_v2_inventory_internal_code' }
);

InventoryItemV2Schema.index(
  { variantId: 1, status: 1 },
  { name: 'idx_v2_inventory_variant_status' }
);

const existingInventoryItemV2Model = models[INVENTORY_ITEM_V2_MODEL_NAME] as
  | Model<InventoryItem>
  | undefined;

export const InventoryItemV2Model =
  existingInventoryItemV2Model ??
  model<InventoryItem>(
    INVENTORY_ITEM_V2_MODEL_NAME,
    InventoryItemV2Schema,
    INVENTORY_ITEM_V2_COLLECTION
  );
