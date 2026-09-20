import cloudinaryModule = require('cloudinary');

import {
  getProductMediaConfig,
} from './product-media.config';
import {
  PRODUCT_MEDIA_ALLOWED_FORMATS,
  PRODUCT_MEDIA_ROOT_FOLDER,
  buildProductMediaFolder,
  generateProductMediaAssetBasename,
} from './product-media.policy';
import {
  ProductMediaGatewayError,
  type ProductMediaGateway,
  type ProductMediaSignedUpload,
  type VerifiedProductMediaAsset,
} from './product-media.gateway';

const cloudinary = cloudinaryModule.v2;

interface CloudinaryResourceLike {
  public_id?: unknown;
  secure_url?: unknown;
  resource_type?: unknown;
  format?: unknown;
  bytes?: unknown;
  width?: unknown;
  height?: unknown;
}

interface CloudinaryDestroyResultLike {
  result?: unknown;
}

const stringValue = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const numberValue = (value: unknown): number =>
  typeof value === 'number' ? value : Number.NaN;

export class CloudinaryProductMediaGateway
implements ProductMediaGateway {
  constructor(
    private readonly rootFolder = PRODUCT_MEDIA_ROOT_FOLDER
  ) {}

  getProductFolder(productId: string): string {
    return buildProductMediaFolder(productId, this.rootFolder);
  }

  createSignedUploadRequest(productId: string): ProductMediaSignedUpload {
    const config = getProductMediaConfig();
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = this.getProductFolder(productId);
    const publicId = generateProductMediaAssetBasename();
    const params = {
      timestamp,
      folder,
      public_id: publicId,
      overwrite: false as const,
      allowed_formats: PRODUCT_MEDIA_ALLOWED_FORMATS.join(','),
    };

    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
    });

    try {
      return {
        cloudName: config.cloudName,
        apiKey: config.apiKey,
        signature: cloudinary.utils.api_sign_request(
          params,
          config.apiSecret
        ),
        resourceType: 'image',
        params,
      };
    } catch (_error) {
      throw new ProductMediaGatewayError(
        'Unable to create Cloudinary upload signature'
      );
    }
  }

  async verifyUploadedImage(
    publicId: string
  ): Promise<VerifiedProductMediaAsset> {
    const config = getProductMediaConfig();

    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
    });

    try {
      const resource = (await cloudinary.api.resource(publicId, {
        resource_type: 'image',
        type: 'upload',
      })) as CloudinaryResourceLike;

      return {
        publicId: stringValue(resource.public_id),
        secureUrl: stringValue(resource.secure_url),
        resourceType: stringValue(resource.resource_type),
        format: stringValue(resource.format).toLowerCase(),
        bytes: numberValue(resource.bytes),
        width: numberValue(resource.width),
        height: numberValue(resource.height),
      };
    } catch (_error) {
      throw new ProductMediaGatewayError(
        'Unable to verify Cloudinary image'
      );
    }
  }

  async destroyImage(publicId: string): Promise<void> {
    const config = getProductMediaConfig();

    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
    });

    try {
      const result = (await cloudinary.uploader.destroy(publicId, {
        resource_type: 'image',
      })) as CloudinaryDestroyResultLike;

      if (result.result !== 'ok' && result.result !== 'not found') {
        throw new ProductMediaGatewayError(
          'Cloudinary image cleanup was not confirmed'
        );
      }
    } catch (error) {
      if (error instanceof ProductMediaGatewayError) {
        throw error;
      }

      throw new ProductMediaGatewayError(
        'Unable to destroy Cloudinary image'
      );
    }
  }
}
