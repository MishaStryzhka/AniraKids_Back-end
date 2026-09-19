import { model, models, Schema, type Model } from 'mongoose';

import {
  PRODUCT_CATEGORIES,
  PRODUCT_GENDERS,
  PRODUCT_OCCASIONS,
  PRODUCT_STATUSES,
  type ProductV2,
} from '../types/domain';
import { isMoneyAmount } from './validation';

export const PRODUCT_V2_MODEL_NAME = 'ProductV2';
export const PRODUCT_V2_COLLECTION = 'v2_products';

const productPhotoSchema = new Schema(
  {
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
  },
  { _id: false }
);

const rentalPricesSchema = new Schema(
  {
    studio: {
      type: Number,
      validate: {
        validator: isMoneyAmount,
        message: 'studio rental price must be a non-negative integer amount in Kč',
      },
    },
    external: {
      type: Number,
      validate: {
        validator: isMoneyAmount,
        message: 'external rental price must be a non-negative integer amount in Kč',
      },
    },
  },
  { _id: false }
);

const seoSchema = new Schema(
  {
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
  },
  { _id: false }
);

export const ProductV2Schema = new Schema<ProductV2>(
  {
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
      enum: [...PRODUCT_CATEGORIES],
    },
    gender: {
      type: String,
      enum: [...PRODUCT_GENDERS],
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
          enum: [...PRODUCT_OCCASIONS],
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
        validator: isMoneyAmount,
        message: 'defaultSalePrice must be a non-negative integer amount in Kč',
      },
    },
    defaultDeposit: {
      type: Number,
      default: 0,
      validate: {
        validator: isMoneyAmount,
        message: 'defaultDeposit must be a non-negative integer amount in Kč',
      },
    },
    photos: {
      type: [productPhotoSchema],
      default: [],
    },
    status: {
      type: String,
      enum: [...PRODUCT_STATUSES],
      default: 'draft',
    },
    seo: {
      type: seoSchema,
      default: () => ({ noIndex: false }),
    },
  },
  {
    collection: PRODUCT_V2_COLLECTION,
    timestamps: true,
    versionKey: false,
  }
);

ProductV2Schema.pre('validate', function validateActiveProduct(next) {
  if (this.status !== 'active') {
    return next();
  }

  const requiredActiveFields: Array<keyof Pick<
    ProductV2,
    'description' | 'category' | 'gender' | 'color'
  >> = ['description', 'category', 'gender', 'color'];

  for (const field of requiredActiveFields) {
    if (!this[field]) {
      this.invalidate(field, `${field} is required for an active product`);
    }
  }

  if (this.rentalEnabled) {
    if (this.rentalPrices?.studio === undefined) {
      this.invalidate(
        'rentalPrices.studio',
        'studio rental price is required for an active rentable product'
      );
    }

    if (this.rentalPrices?.external === undefined) {
      this.invalidate(
        'rentalPrices.external',
        'external rental price is required for an active rentable product'
      );
    }
  }

  return next();
});

ProductV2Schema.index(
  { slug: 1 },
  { unique: true, name: 'uniq_v2_product_slug' }
);

const existingProductV2Model = models[PRODUCT_V2_MODEL_NAME] as
  | Model<ProductV2>
  | undefined;

export const ProductV2Model =
  existingProductV2Model ??
  model<ProductV2>(
    PRODUCT_V2_MODEL_NAME,
    ProductV2Schema,
    PRODUCT_V2_COLLECTION
  );
