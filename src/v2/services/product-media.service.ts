import { Types } from 'mongoose';

import {
  ProductV2Model,
} from '../models';
import {
  CloudinaryProductMediaGateway,
} from '../media/cloudinary-product-media.gateway';
import {
  ProductMediaConfigurationError,
} from '../media/product-media.config';
import {
  ProductMediaGatewayError,
  type ProductMediaGateway,
  type VerifiedProductMediaAsset,
} from '../media/product-media.gateway';
import {
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_PRODUCT_PHOTOS,
  PRODUCT_MEDIA_ALLOWED_FORMATS,
  canRemoveProductPhoto,
  hasProductPhoto,
  hasReachedProductPhotoLimit,
  isPublicIdInProductFolder,
  normalizeProductPhotoAlt,
  reorderProductPhotosExact,
} from '../media/product-media.policy';
import {
  CatalogueAdminError,
} from './catalogue-admin.types';
import {
  ProductMediaError,
} from './product-media.types';

const allowedFormats = new Set<string>(PRODUCT_MEDIA_ALLOWED_FORMATS);

const translateProviderError = (error: unknown): never => {
  if (error instanceof ProductMediaConfigurationError) {
    throw new ProductMediaError(
      'MEDIA_CONFIGURATION_ERROR',
      'Product media is not fully configured'
    );
  }

  if (error instanceof ProductMediaGatewayError) {
    throw new ProductMediaError(
      'CLOUDINARY_OPERATION_FAILED',
      'Product media provider operation failed'
    );
  }

  throw error;
};

const isVerifiedAssetValid = (
  asset: VerifiedProductMediaAsset,
  expectedPublicId: string
): boolean =>
  asset.publicId === expectedPublicId &&
  asset.resourceType === 'image' &&
  asset.secureUrl.startsWith('https://') &&
  allowedFormats.has(asset.format) &&
  Number.isFinite(asset.bytes) &&
  asset.bytes >= 0 &&
  Number.isFinite(asset.width) &&
  asset.width > 0 &&
  Number.isFinite(asset.height) &&
  asset.height > 0;

export class ProductMediaService {
  constructor(
    private readonly gateway: ProductMediaGateway
  ) {}

  async signUpload(productId: Types.ObjectId) {
    const product = await ProductV2Model.findById(productId)
      .select('_id photos')
      .lean()
      .exec();

    if (!product) {
      throw new ProductMediaError(
        'PRODUCT_NOT_FOUND',
        'Product not found'
      );
    }

    if (hasReachedProductPhotoLimit(product.photos.length)) {
      throw new ProductMediaError(
        'PHOTO_LIMIT_REACHED',
        'Product photo limit has been reached'
      );
    }

    try {
      return this.gateway.createSignedUploadRequest(
        productId.toHexString()
      );
    } catch (error) {
      return translateProviderError(error);
    }
  }

  async completeUpload(
    productId: Types.ObjectId,
    input: {
      publicId: string;
      alt?: string;
    }
  ) {
    const product = await ProductV2Model.findById(productId).exec();

    if (!product) {
      throw new ProductMediaError(
        'PRODUCT_NOT_FOUND',
        'Product not found'
      );
    }

    const publicId = input.publicId.trim();

    if (hasProductPhoto(product.photos, publicId)) {
      return product;
    }

    const expectedFolder = this.gateway.getProductFolder(
      productId.toHexString()
    );

    if (!isPublicIdInProductFolder(publicId, expectedFolder)) {
      throw new ProductMediaError(
        'PHOTO_WRONG_PRODUCT',
        'Uploaded image does not belong to this Product'
      );
    }

    if (hasReachedProductPhotoLimit(product.photos.length)) {
      throw new ProductMediaError(
        'PHOTO_LIMIT_REACHED',
        'Product photo limit has been reached'
      );
    }

    let asset: VerifiedProductMediaAsset;

    try {
      asset = await this.gateway.verifyUploadedImage(publicId);
    } catch (error) {
      return translateProviderError(error);
    }

    if (!isVerifiedAssetValid(asset, publicId)) {
      throw new ProductMediaError(
        'PHOTO_INVALID_RESOURCE',
        'Uploaded image resource is invalid'
      );
    }

    if (asset.bytes > MAX_PRODUCT_IMAGE_BYTES) {
      try {
        await this.gateway.destroyImage(publicId);
      } catch (_error) {
        console.warn('V2 product media cleanup failed', {
          productId: productId.toHexString(),
          publicId,
        });
      }

      throw new ProductMediaError(
        'IMAGE_TOO_LARGE',
        'Uploaded image exceeds the maximum allowed size'
      );
    }

    const photo = {
      url: asset.secureUrl,
      publicId: asset.publicId,
      alt: normalizeProductPhotoAlt(input.alt, product.name),
    };

    const updated = await ProductV2Model.findOneAndUpdate(
      {
        _id: productId,
        'photos.publicId': {
          $ne: publicId,
        },
        $expr: {
          $lt: [
            {
              $size: '$photos',
            },
            MAX_PRODUCT_PHOTOS,
          ],
        },
      },
      {
        $push: {
          photos: photo,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    ).exec();

    if (updated) {
      return updated;
    }

    const latest = await ProductV2Model.findById(productId).exec();

    if (!latest) {
      throw new ProductMediaError(
        'PRODUCT_NOT_FOUND',
        'Product not found'
      );
    }

    if (hasProductPhoto(latest.photos, publicId)) {
      return latest;
    }

    if (hasReachedProductPhotoLimit(latest.photos.length)) {
      throw new ProductMediaError(
        'PHOTO_LIMIT_REACHED',
        'Product photo limit has been reached'
      );
    }

    throw new ProductMediaError(
      'CLOUDINARY_OPERATION_FAILED',
      'Product photo attachment could not be completed'
    );
  }

  async updateAlt(
    productId: Types.ObjectId,
    input: {
      publicId: string;
      alt: string;
    }
  ) {
    const product = await ProductV2Model.findById(productId).exec();

    if (!product) {
      throw new ProductMediaError(
        'PRODUCT_NOT_FOUND',
        'Product not found'
      );
    }

    const photo = product.photos.find(
      item => item.publicId === input.publicId
    );

    if (!photo) {
      throw new ProductMediaError(
        'PHOTO_NOT_FOUND',
        'Product photo not found'
      );
    }

    photo.alt = input.alt.trim();
    product.markModified('photos');
    return product.save();
  }

  async reorderPhotos(
    productId: Types.ObjectId,
    publicIds: string[]
  ) {
    const product = await ProductV2Model.findById(productId).exec();

    if (!product) {
      throw new ProductMediaError(
        'PRODUCT_NOT_FOUND',
        'Product not found'
      );
    }

    const reordered = reorderProductPhotosExact(
      product.photos,
      publicIds
    );

    if (!reordered) {
      throw new CatalogueAdminError(
        'VALIDATION_ERROR',
        'Photo order must contain exactly the currently attached publicIds'
      );
    }

    product.photos = reordered;
    product.markModified('photos');
    return product.save();
  }

  async removePhoto(
    productId: Types.ObjectId,
    publicIdInput: string
  ) {
    const publicId = publicIdInput.trim();
    const product = await ProductV2Model.findById(productId).exec();

    if (!product) {
      throw new ProductMediaError(
        'PRODUCT_NOT_FOUND',
        'Product not found'
      );
    }

    if (!hasProductPhoto(product.photos, publicId)) {
      throw new ProductMediaError(
        'PHOTO_NOT_FOUND',
        'Product photo not found'
      );
    }

    if (!canRemoveProductPhoto(product.status, product.photos.length)) {
      throw new ProductMediaError(
        'PRODUCT_PHOTO_REQUIRED',
        'Active Product must retain at least one photo'
      );
    }

    const updated = await ProductV2Model.findOneAndUpdate(
      {
        _id: productId,
        'photos.publicId': publicId,
        $or: [
          {
            status: {
              $ne: 'active',
            },
          },
          {
            'photos.1': {
              $exists: true,
            },
          },
        ],
      },
      {
        $pull: {
          photos: {
            publicId,
          },
        },
      },
      {
        new: true,
        runValidators: true,
      }
    ).exec();

    if (!updated) {
      const latest = await ProductV2Model.findById(productId).exec();

      if (!latest) {
        throw new ProductMediaError(
          'PRODUCT_NOT_FOUND',
          'Product not found'
        );
      }

      if (!hasProductPhoto(latest.photos, publicId)) {
        throw new ProductMediaError(
          'PHOTO_NOT_FOUND',
          'Product photo not found'
        );
      }

      if (!canRemoveProductPhoto(latest.status, latest.photos.length)) {
        throw new ProductMediaError(
          'PRODUCT_PHOTO_REQUIRED',
          'Active Product must retain at least one photo'
        );
      }

      throw new ProductMediaError(
        'CLOUDINARY_OPERATION_FAILED',
        'Product photo deletion could not be completed'
      );
    }

    try {
      await this.gateway.destroyImage(publicId);
    } catch (_error) {
      console.warn('V2 product media cleanup failed', {
        productId: productId.toHexString(),
        publicId,
      });
    }

    return updated;
  }
}

export const productMediaService = new ProductMediaService(
  new CloudinaryProductMediaGateway()
);
