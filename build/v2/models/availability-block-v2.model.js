"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AvailabilityBlockV2Model = exports.AvailabilityBlockV2Schema = exports.AVAILABILITY_BLOCK_V2_COLLECTION = exports.AVAILABILITY_BLOCK_V2_MODEL_NAME = void 0;
const mongoose_1 = require("mongoose");
const domain_1 = require("../types/domain");
const validation_1 = require("./validation");
exports.AVAILABILITY_BLOCK_V2_MODEL_NAME = 'AvailabilityBlockV2';
exports.AVAILABILITY_BLOCK_V2_COLLECTION = 'v2_availability_blocks';
exports.AvailabilityBlockV2Schema = new mongoose_1.Schema({
    inventoryItemId: {
        type: mongoose_1.Schema.Types.ObjectId,
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
            validator: function validateEndDate(value) {
                return (0, validation_1.isDateRangeValid)(this.startDate, value);
            },
            message: 'endDate must be on or after startDate',
        },
    },
    reason: {
        type: String,
        enum: [...domain_1.AVAILABILITY_BLOCK_REASONS],
        required: true,
    },
    notes: {
        type: String,
        trim: true,
        maxlength: 1000,
    },
    createdBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'user',
        required: true,
    },
}, {
    collection: exports.AVAILABILITY_BLOCK_V2_COLLECTION,
    timestamps: {
        createdAt: true,
        updatedAt: false,
    },
    versionKey: false,
});
exports.AvailabilityBlockV2Schema.index({ inventoryItemId: 1, startDate: 1, endDate: 1 }, { name: 'idx_v2_availability_block_inventory_dates' });
const existingAvailabilityBlockV2Model = mongoose_1.models[exports.AVAILABILITY_BLOCK_V2_MODEL_NAME];
exports.AvailabilityBlockV2Model = existingAvailabilityBlockV2Model ??
    (0, mongoose_1.model)(exports.AVAILABILITY_BLOCK_V2_MODEL_NAME, exports.AvailabilityBlockV2Schema, exports.AVAILABILITY_BLOCK_V2_COLLECTION);
