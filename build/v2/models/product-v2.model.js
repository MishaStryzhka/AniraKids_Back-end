"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductV2Model = exports.ProductV2Schema = exports.PRODUCT_V2_COLLECTION = exports.PRODUCT_V2_MODEL_NAME = void 0;
const mongoose_1 = require("mongoose");
const domain_1 = require("../types/domain");
const validation_1 = require("./validation");
exports.PRODUCT_V2_MODEL_NAME = 'ProductV2';
exports.PRODUCT_V2_COLLECTION = 'v2_products';
const productPhotoSchema = new mongoose_1.Schema({
    url: {
        type: String,
        required: true,
        trim: true,
    },
    publicId: {
        type: String,
        required: true,
        trim: true,
    },
    alt: {
        type: String,
        trim: true,
        maxlength: 180,
    },
}, { _id: false });
const rentalPricesSchema = new mongoose_1.Schema({
    studio: {
        type: Number,
        validate: {
            validator: validation_1.isMoneyAmount,
            message: 'studio rental price must be a non-negative integer amount in Kč',
        },
    },
    external: {
        type: Number,
        validate: {
            validator: validation_1.isMoneyAmount,
            message: 'external rental price must be a non-negative integer amount in Kč',
        },
    },
}, { _id: false });
const seoSchema = new mongoose_1.Schema({
    title: {
        type: String,
        trim: true,
        maxlength: 70,
    },
    description: {
        type: String,
        trim: true,
        maxlength: 180,
    },
    noIndex: {
        type: Boolean,
        default: false,
    },
}, { _id: false });
exports.ProductV2Schema = new mongoose_1.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        minlength: 2,
        maxlength: 120,
    },
    slug: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        minlength: 2,
        maxlength: 160,
        match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    description: {
        type: String,
        trim: true,
        maxlength: 5000,
    },
    category: {
        type: String,
        enum: [...domain_1.PRODUCT_CATEGORIES],
    },
    gender: {
        type: String,
        enum: [...domain_1.PRODUCT_GENDERS],
    },
    color: {
        type: String,
        trim: true,
        maxlength: 80,
    },
    occasion: {
        type: [
            {
                type: String,
                enum: [...domain_1.PRODUCT_OCCASIONS],
            },
        ],
        default: [],
    },
    ageTags: {
        type: [
            {
                type: String,
                trim: true,
                maxlength: 40,
            },
        ],
        default: [],
    },
    brand: {
        type: String,
        trim: true,
        maxlength: 100,
    },
    familyLookGroup: {
        type: String,
        trim: true,
        maxlength: 100,
    },
    rentalEnabled: {
        type: Boolean,
        default: false,
    },
    saleEnabled: {
        type: Boolean,
        default: false,
    },
    rentalPrices: {
        type: rentalPricesSchema,
        default: undefined,
    },
    defaultSalePrice: {
        type: Number,
        validate: {
            validator: validation_1.isMoneyAmount,
            message: 'defaultSalePrice must be a non-negative integer amount in Kč',
        },
    },
    defaultDeposit: {
        type: Number,
        default: 0,
        validate: {
            validator: validation_1.isMoneyAmount,
            message: 'defaultDeposit must be a non-negative integer amount in Kč',
        },
    },
    photos: {
        type: [productPhotoSchema],
        default: [],
    },
    status: {
        type: String,
        enum: [...domain_1.PRODUCT_STATUSES],
        default: 'draft',
    },
    seo: {
        type: seoSchema,
        default: () => ({ noIndex: false }),
    },
}, {
    collection: exports.PRODUCT_V2_COLLECTION,
    timestamps: true,
    versionKey: false,
});
exports.ProductV2Schema.pre('validate', function validateActiveProduct(next) {
    if (this.status !== 'active') {
        return next();
    }
    const requiredActiveFields = ['description', 'category', 'gender', 'color'];
    for (const field of requiredActiveFields) {
        if (!this[field]) {
            this.invalidate(field, `${field} is required for an active product`);
        }
    }
    if (this.rentalEnabled) {
        if (this.rentalPrices?.studio === undefined) {
            this.invalidate('rentalPrices.studio', 'studio rental price is required for an active rentable product');
        }
        if (this.rentalPrices?.external === undefined) {
            this.invalidate('rentalPrices.external', 'external rental price is required for an active rentable product');
        }
    }
    return next();
});
exports.ProductV2Schema.index({ slug: 1 }, { unique: true, name: 'uniq_v2_product_slug' });
const existingProductV2Model = mongoose_1.models[exports.PRODUCT_V2_MODEL_NAME];
exports.ProductV2Model = existingProductV2Model ??
    (0, mongoose_1.model)(exports.PRODUCT_V2_MODEL_NAME, exports.ProductV2Schema, exports.PRODUCT_V2_COLLECTION);
