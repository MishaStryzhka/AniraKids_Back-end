"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReservationV2Model = exports.ReservationV2Schema = exports.RESERVATION_V2_COLLECTION = exports.RESERVATION_V2_MODEL_NAME = void 0;
const mongoose_1 = require("mongoose");
const domain_1 = require("../types/domain");
const validation_1 = require("./validation");
exports.RESERVATION_V2_MODEL_NAME = 'ReservationV2';
exports.RESERVATION_V2_COLLECTION = 'v2_reservations';
const emailRegexp = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const reservationItemSchema = new mongoose_1.Schema({
    productId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'ProductV2',
        required: true,
    },
    variantId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'VariantV2',
        required: true,
    },
    inventoryItemId: {
        type: mongoose_1.Schema.Types.ObjectId,
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
            validator: validation_1.isMoneyAmount,
            message: 'rentalPriceSnapshot must be a non-negative integer amount in Kč',
        },
    },
    depositSnapshot: {
        type: Number,
        required: true,
        validate: {
            validator: validation_1.isMoneyAmount,
            message: 'depositSnapshot must be a non-negative integer amount in Kč',
        },
    },
}, { _id: false });
const customerSnapshotSchema = new mongoose_1.Schema({
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
}, { _id: false });
exports.ReservationV2Schema = new mongoose_1.Schema({
    reservationNumber: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
        immutable: true,
        match: /^AK-\d{4}-[A-Z0-9]{6}$/,
    },
    customerId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'user',
    },
    guestAccessTokenHash: {
        type: String,
        select: false,
    },
    customerSnapshot: {
        type: customerSnapshotSchema,
        required: true,
    },
    items: {
        type: [reservationItemSchema],
        required: true,
        validate: {
            validator: (items) => Array.isArray(items) && items.length > 0,
            message: 'Reservation must contain at least one item',
        },
    },
    rentalMode: {
        type: String,
        enum: [...domain_1.RENTAL_MODES],
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
            validator: function validateEndDate(value) {
                return (0, validation_1.isDateRangeValid)(this.startDate, value);
            },
            message: 'endDate must be on or after startDate',
        },
    },
    status: {
        type: String,
        enum: [...domain_1.RESERVATION_STATUSES],
        default: 'pending',
    },
    expiresAt: {
        type: Date,
        default: null,
        required: function requirePendingExpiration() {
            return this.status === 'pending';
        },
    },
    subtotal: {
        type: Number,
        required: true,
        validate: {
            validator: validation_1.isMoneyAmount,
            message: 'subtotal must be a non-negative integer amount in Kč',
        },
    },
    deposit: {
        type: Number,
        required: true,
        validate: {
            validator: validation_1.isMoneyAmount,
            message: 'deposit must be a non-negative integer amount in Kč',
        },
    },
    totalDue: {
        type: Number,
        required: true,
        validate: {
            validator: validation_1.isMoneyAmount,
            message: 'totalDue must be a non-negative integer amount in Kč',
        },
    },
    fulfillmentMethod: {
        type: String,
        enum: ['pickup'],
    },
    paymentStatus: {
        type: String,
        enum: [...domain_1.PAYMENT_STATUSES],
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
}, {
    collection: exports.RESERVATION_V2_COLLECTION,
    timestamps: true,
    versionKey: false,
});
exports.ReservationV2Schema.index({ reservationNumber: 1 }, { unique: true, name: 'uniq_v2_reservation_number' });
exports.ReservationV2Schema.index({
    'items.inventoryItemId': 1,
    status: 1,
    startDate: 1,
    endDate: 1,
}, { name: 'idx_v2_reservation_inventory_conflict_lookup' });
exports.ReservationV2Schema.index({ customerId: 1, createdAt: -1 }, {
    name: 'idx_v2_reservation_customer_created',
    partialFilterExpression: { customerId: { $exists: true } },
});
const existingReservationV2Model = mongoose_1.models[exports.RESERVATION_V2_MODEL_NAME];
exports.ReservationV2Model = existingReservationV2Model ??
    (0, mongoose_1.model)(exports.RESERVATION_V2_MODEL_NAME, exports.ReservationV2Schema, exports.RESERVATION_V2_COLLECTION);
