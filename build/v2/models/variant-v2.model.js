"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VariantV2Model = exports.VariantV2Schema = exports.VARIANT_V2_COLLECTION = exports.VARIANT_V2_MODEL_NAME = void 0;
const mongoose_1 = require("mongoose");
const domain_1 = require("../types/domain");
const validation_1 = require("./validation");
exports.VARIANT_V2_MODEL_NAME = 'VariantV2';
exports.VARIANT_V2_COLLECTION = 'v2_variants';
const normalizeOptionalSku = (value) => {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim().toUpperCase();
    return normalized.length > 0 ? normalized : undefined;
};
const rentalPriceOverridesSchema = new mongoose_1.Schema({
    studio: {
        type: Number,
        validate: {
            validator: validation_1.isMoneyAmount,
            message: 'studio rental price override must be a non-negative integer amount in Kč',
        },
    },
    external: {
        type: Number,
        validate: {
            validator: validation_1.isMoneyAmount,
            message: 'external rental price override must be a non-negative integer amount in Kč',
        },
    },
}, { _id: false });
exports.VariantV2Schema = new mongoose_1.Schema({
    productId: {
        type: mongoose_1.Schema.Types.ObjectId,
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
            validator: validation_1.isMoneyAmount,
            message: 'salePriceOverride must be a non-negative integer amount in Kč',
        },
    },
    depositOverride: {
        type: Number,
        validate: {
            validator: validation_1.isMoneyAmount,
            message: 'depositOverride must be a non-negative integer amount in Kč',
        },
    },
    status: {
        type: String,
        enum: [...domain_1.VARIANT_STATUSES],
        default: 'active',
    },
    sortOrder: {
        type: Number,
        default: 0,
        validate: {
            validator: validation_1.isNonNegativeInteger,
            message: 'sortOrder must be a non-negative integer',
        },
    },
}, {
    collection: exports.VARIANT_V2_COLLECTION,
    timestamps: true,
    versionKey: false,
});
exports.VariantV2Schema.index({ productId: 1, size: 1 }, { unique: true, name: 'uniq_v2_variant_product_size' });
exports.VariantV2Schema.index({ sku: 1 }, {
    unique: true,
    name: 'uniq_v2_variant_sku',
    partialFilterExpression: { sku: { $exists: true } },
});
const existingVariantV2Model = mongoose_1.models[exports.VARIANT_V2_MODEL_NAME];
exports.VariantV2Model = existingVariantV2Model ??
    (0, mongoose_1.model)(exports.VARIANT_V2_MODEL_NAME, exports.VariantV2Schema, exports.VARIANT_V2_COLLECTION);
