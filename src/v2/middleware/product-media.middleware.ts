import {
  ProductMediaConfigurationError,
  getProductMediaConfig,
} from '../media/product-media.config';
import {
  validateCompleteProductPhotoAdminBody,
  validateDeleteProductPhotoAdminBody,
  validateReorderProductPhotosAdminBody,
  validateUpdateProductPhotoAltAdminBody,
  type ProductMediaValidationResult,
} from '../schemas/admin-product-media.schema';
import type {
  HttpHandler,
} from '../types/http';

export const productMediaConfigurationReady: HttpHandler = (
  _request,
  response,
  next
) => {
  try {
    getProductMediaConfig();
    return next();
  } catch (error) {
    if (error instanceof ProductMediaConfigurationError) {
      return response.status(503).json({
        error: {
          code: 'MEDIA_CONFIGURATION_ERROR',
          message: 'Product media is not fully configured',
        },
      });
    }

    return next(error);
  }
};

const createBodyValidator = <T>(
  validator: (input: unknown) => ProductMediaValidationResult<T>
): HttpHandler => (
  request,
  response,
  next
) => {
  const result = validator(request.body);

  if (!result.value) {
    return response.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: result.errorMessage ?? 'Invalid request body',
      },
    });
  }

  request.body = result.value;
  return next();
};

export const validateAdminCompleteProductPhoto =
  createBodyValidator(validateCompleteProductPhotoAdminBody);

export const validateAdminUpdateProductPhotoAlt =
  createBodyValidator(validateUpdateProductPhotoAltAdminBody);

export const validateAdminReorderProductPhotos =
  createBodyValidator(validateReorderProductPhotosAdminBody);

export const validateAdminDeleteProductPhoto =
  createBodyValidator(validateDeleteProductPhotoAdminBody);
