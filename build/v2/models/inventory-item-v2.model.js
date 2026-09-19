"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryItemV2Model = exports.InventoryItemV2Schema = exports.INVENTORY_ITEM_V2_COLLECTION = exports.INVENTORY_ITEM_V2_MODEL_NAME = void 0;
const mongoose_1 = require("mongoose");
const domain_1 = require("../types/domain");
const validation_1 = require("./validation");
exports.INVENTORY_ITEM_V2_MODEL_NAME = 'InventoryItemV2';
exports.INVENTORY_ITEM_V2_COLLECTION = 'v2_inventory_items';
const normalizeInternalCode = (value) => typeof value === 'string' ? value.trim().toUpperCase() : value;
exports.InventoryItemV2Schema = new mongoose_1.Schema({
    variantId: {
        type: mongoose_1.Schema.Types.ObjectId,
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
        enum: [...domain_1.INVENTORY_ITEM_STATUSES],
        default: 'active',
    },
    condition: {
        type: String,
        enum: [...domain_1.INVENTORY_CONDITIONS],
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
            validator: validation_1.isNonNegativeInteger,
            message: 'bookingRevision must be a non-negative integer',
        },
    },
}, {
    collection: exports.INVENTORY_ITEM_V2_COLLECTION,
    timestamps: true,
    versionKey: false,
});
exports.InventoryItemV2Schema.index({ internalCode: 1 }, { unique: true, name: 'uniq_v2_inventory_internal_code' });
exports.InventoryItemV2Schema.index({ variantId: 1, status: 1 }, { name: 'idx_v2_inventory_variant_status' });
const existingInventoryItemV2Model = mongoose_1.models[exports.INVENTORY_ITEM_V2_MODEL_NAME];
exports.InventoryItemV2Model = existingInventoryItemV2Model ??
    (0, mongoose_1.model)(exports.INVENTORY_ITEM_V2_MODEL_NAME, exports.InventoryItemV2Schema, exports.INVENTORY_ITEM_V2_COLLECTION);
