import { model, models, Schema, type Model } from 'mongoose';

import {
  PAYMENT_STATUSES,
  RENTAL_MODES,
  RESERVATION_STATUSES,
  type Reservation,
} from '../types/domain';
import { isDateRangeValid, isMoneyAmount } from './validation';

export const RESERVATION_V2_MODEL_NAME = 'ReservationV2';
export const RESERVATION_V2_COLLECTION = 'v2_reservations';

const emailRegexp = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const reservationItemSchema = new Schema(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'ProductV2',
      required: true,
    },
    variantId: {
      type: Schema.Types.ObjectId,
      ref: 'VariantV2',
      required: true,
    },
    inventoryItemId: {
      type: Schema.Types.ObjectId,
      ref: 'InventoryItemV2',
      required: true,
    },
    productNameSnapshot: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    sizeSnapshot: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
    },
    rentalPriceSnapshot: {
      type: Number,
      required: true,
      validate: {
        validator: isMoneyAmount,
        message: 'rentalPriceSnapshot must be a non-negative integer amount in Kč',
      },
    },
    depositSnapshot: {
      type: Number,
      required: true,
      validate: {
        validator: isMoneyAmount,
        message: 'depositSnapshot must be a non-negative integer amount in Kč',
      },
    },
  },
  { _id: false }
);

const customerSnapshotSchema = new Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: emailRegexp,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      minlength: 5,
      maxlength: 32,
    },
  },
  { _id: false }
);

export const ReservationV2Schema = new Schema<Reservation>(
  {
    reservationNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      immutable: true,
      match: /^AK-\d{4}-[A-Z0-9]{6}$/,
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'user',
    },
    guestAccessTokenHash: {
      type: String,
      select: false,
    },
    idempotencyKeyHash: {
      type: String,
      immutable: true,
      select: false,
      match: /^[a-f0-9]{64}$/,
    },
    idempotencyRequestHash: {
      type: String,
      immutable: true,
      select: false,
      match: /^[a-f0-9]{64}$/,
    },
    customerSnapshot: {
      type: customerSnapshotSchema,
      required: true,
    },
    items: {
      type: [reservationItemSchema],
      required: true,
      validate: {
        validator: (items: unknown[]): boolean => Array.isArray(items) && items.length > 0,
        message: 'Reservation must contain at least one item',
      },
    },
    rentalMode: {
      type: String,
      enum: [...RENTAL_MODES],
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
          this: Reservation,
          value: Date
        ): boolean {
          return isDateRangeValid(this.startDate, value);
        },
        message: 'endDate must be on or after startDate',
      },
    },
    status: {
      type: String,
      enum: [...RESERVATION_STATUSES],
      default: 'pending',
    },
    expiresAt: {
      type: Date,
      default: null,
      required: function requirePendingExpiration(this: Reservation): boolean {
        return this.status === 'pending';
      },
    },
    subtotal: {
      type: Number,
      required: true,
      validate: {
        validator: isMoneyAmount,
        message: 'subtotal must be a non-negative integer amount in Kč',
      },
    },
    deposit: {
      type: Number,
      required: true,
      validate: {
        validator: isMoneyAmount,
        message: 'deposit must be a non-negative integer amount in Kč',
      },
    },
    totalDue: {
      type: Number,
      required: true,
      validate: {
        validator: isMoneyAmount,
        message: 'totalDue must be a non-negative integer amount in Kč',
      },
    },
    fulfillmentMethod: {
      type: String,
      enum: ['pickup'],
    },
    paymentStatus: {
      type: String,
      enum: [...PAYMENT_STATUSES],
      default: 'unpaid',
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1500,
    },
    cancelledAt: {
      type: Date,
    },
    cancellationReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  {
    collection: RESERVATION_V2_COLLECTION,
    timestamps: true,
    versionKey: false,
  }
);

ReservationV2Schema.index(
  { reservationNumber: 1 },
  { unique: true, name: 'uniq_v2_reservation_number' }
);

ReservationV2Schema.index(
  { idempotencyKeyHash: 1 },
  {
    unique: true,
    name: 'uniq_v2_reservation_idempotency_key',
    partialFilterExpression: {
      idempotencyKeyHash: { $exists: true },
    },
  }
);

ReservationV2Schema.index(
  {
    'items.inventoryItemId': 1,
    status: 1,
    startDate: 1,
    endDate: 1,
  },
  { name: 'idx_v2_reservation_inventory_conflict_lookup' }
);

ReservationV2Schema.index(
  { customerId: 1, createdAt: -1 },
  {
    name: 'idx_v2_reservation_customer_created',
    partialFilterExpression: { customerId: { $exists: true } },
  }
);

const existingReservationV2Model = models[RESERVATION_V2_MODEL_NAME] as
  | Model<Reservation>
  | undefined;

export const ReservationV2Model =
  existingReservationV2Model ??
  model<Reservation>(
    RESERVATION_V2_MODEL_NAME,
    ReservationV2Schema,
    RESERVATION_V2_COLLECTION
  );
