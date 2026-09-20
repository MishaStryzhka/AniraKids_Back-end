export type ProductMediaErrorCode =
  | 'MEDIA_CONFIGURATION_ERROR'
  | 'PRODUCT_NOT_FOUND'
  | 'PHOTO_NOT_FOUND'
  | 'PHOTO_LIMIT_REACHED'
  | 'PHOTO_INVALID_RESOURCE'
  | 'PHOTO_WRONG_PRODUCT'
  | 'IMAGE_TOO_LARGE'
  | 'PRODUCT_PHOTO_REQUIRED'
  | 'CLOUDINARY_OPERATION_FAILED';

export class ProductMediaError extends Error {
  constructor(
    public readonly code: ProductMediaErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ProductMediaError';
  }
}
