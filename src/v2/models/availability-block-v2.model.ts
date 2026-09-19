import { model, models, Schema, type Model } from 'mongoose';

import {
  AVAILABILITY_BLOCK_REASONS,
  type AvailabilityBlock,
} from '../types/domain';
import { isDateRangeValid } from './validation';

export const AVAILABILITY_BLOCK_V2_MODEL_NAME = 'AvailabilityBlockV2';
export const AVAILABILITY_BLOCK_V2_COLLECTION = 'v2_availability_blocks';

export const AvailabilityBlockV2Schema = new Schema<AvailabilityBlock>(
  {
    inventoryItemId: {
      type: Schema.Types.ObjectId,
      ref: 'InventoryItemV2',
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
      validate: {
        validator: function validateEndDate(
          this: AvailabilityBlock,
          value: Date
        ): boolean {
          return isDateRangeValid(this.startDate, value);
        },
        message: 'endDate must be on or after startDate',
      },
    },
    reason: {
      type: String,
      enum: [...AVAILABILITY_BLOCK_REASONS],
      required: true,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'user',
      required: true,
    },
  },
  {
    collection: AVAILABILITY_BLOCK_V2_COLLECTION,
    timestamps: {
      createdAt: true,
      updatedAt: false,
    },
    versionKey: false,
  }
);

AvailabilityBlockV2Schema.index(
  { inventoryItemId: 1, startDate: 1, endDate: 1 },
  { name: 'idx_v2_availability_block_inventory_dates' }
);

const existingAvailabilityBlockV2Model = models[
  AVAILABILITY_BLOCK_V2_MODEL_NAME
] as Model<AvailabilityBlock> | undefined;

export const AvailabilityBlockV2Model =
  existingAvailabilityBlockV2Model ??
  model<AvailabilityBlock>(
    AVAILABILITY_BLOCK_V2_MODEL_NAME,
    AvailabilityBlockV2Schema,
    AVAILABILITY_BLOCK_V2_COLLECTION
  );
