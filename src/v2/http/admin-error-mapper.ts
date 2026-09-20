import {
  CatalogueAdminError,
} from '../services/catalogue-admin.types';
import type {
  HttpErrorHandler,
} from '../types/http';

export interface AdminApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: string[];
  };
}

export interface MappedAdminApiError {
  status: number;
  body: AdminApiErrorBody;
}

const mapped = (
  status: number,
  code: string,
  message: string,
  details?: string[]
): MappedAdminApiError => ({
  status,
  body: {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  },
});

export const mapAdminApiError = (
  error: unknown
): MappedAdminApiError => {
  if (error instanceof CatalogueAdminError) {
    switch (error.code) {
      case 'VALIDATION_ERROR':
        return mapped(400, error.code, error.message, error.details);
      case 'PRODUCT_NOT_FOUND':
      case 'VARIANT_NOT_FOUND':
      case 'INVENTORY_ITEM_NOT_FOUND':
        return mapped(404, error.code, error.message);
      case 'SLUG_ALREADY_EXISTS':
      case 'VARIANT_SIZE_ALREADY_EXISTS':
      case 'SKU_ALREADY_EXISTS':
      case 'INVENTORY_CODE_ALREADY_EXISTS':
      case 'PRODUCT_NOT_READY':
      case 'PRODUCT_ARCHIVE_REQUIRES_RESERVATION_REVIEW':
        return mapped(
          409,
          error.code,
          error.message,
          error.details
        );
    }
  }

  return mapped(
    500,
    'INTERNAL_ERROR',
    'Admin operation failed'
  );
};

export const adminApiErrorHandler: HttpErrorHandler = (
  error,
  _request,
  response,
  _next
) => {
  const result = mapAdminApiError(error);

  if (result.status >= 500) {
    console.error('V2 admin API error', {
      code: result.body.error.code,
      status: result.status,
    });
  }

  return response.status(result.status).json(result.body);
};
