import { Types } from 'mongoose';

import {
  toAdminProductDto,
} from '../http/admin-response';
import type {
  CompleteProductPhotoAdminBody,
  DeleteProductPhotoAdminBody,
  ReorderProductPhotosAdminBody,
  UpdateProductPhotoAltAdminBody,
} from '../schemas/admin-product-media.schema';
import {
  productMediaService,
  type ProductMediaService,
} from '../services/product-media.service';
import type {
  HttpHandler,
} from '../types/http';

const objectIdFromParam = (
  value: string | undefined
): Types.ObjectId => {
  if (!value) {
    throw new Error('Validated route parameter is missing');
  }

  return new Types.ObjectId(value);
};

export interface AdminProductMediaHandlers {
  signProductPhotoUpload: HttpHandler;
  completeProductPhotoUpload: HttpHandler;
  updateProductPhotoAlt: HttpHandler;
  reorderProductPhotos: HttpHandler;
  deleteProductPhoto: HttpHandler;
}

export const createAdminProductMediaHandlers = (
  service: ProductMediaService
): AdminProductMediaHandlers => ({
  signProductPhotoUpload: async (request, response, next) => {
    try {
      const upload = await service.signUpload(
        objectIdFromParam(request.params?.productId)
      );

      return response.status(200).json({ upload });
    } catch (error) {
      return next(error);
    }
  },

  completeProductPhotoUpload: async (request, response, next) => {
    try {
      const product = await service.completeUpload(
        objectIdFromParam(request.params?.productId),
        request.body as CompleteProductPhotoAdminBody
      );

      return response.status(200).json({
        product: toAdminProductDto(product),
      });
    } catch (error) {
      return next(error);
    }
  },

  updateProductPhotoAlt: async (request, response, next) => {
    const body = request.body as UpdateProductPhotoAltAdminBody;

    try {
      const product = await service.updateAlt(
        objectIdFromParam(request.params?.productId),
        body
      );

      return response.status(200).json({
        product: toAdminProductDto(product),
      });
    } catch (error) {
      return next(error);
    }
  },

  reorderProductPhotos: async (request, response, next) => {
    const body = request.body as ReorderProductPhotosAdminBody;

    try {
      const product = await service.reorderPhotos(
        objectIdFromParam(request.params?.productId),
        body.publicIds
      );

      return response.status(200).json({
        product: toAdminProductDto(product),
      });
    } catch (error) {
      return next(error);
    }
  },

  deleteProductPhoto: async (request, response, next) => {
    const body = request.body as DeleteProductPhotoAdminBody;

    try {
      const product = await service.removePhoto(
        objectIdFromParam(request.params?.productId),
        body.publicId
      );

      return response.status(200).json({
        product: toAdminProductDto(product),
      });
    } catch (error) {
      return next(error);
    }
  },
});

export const defaultAdminProductMediaHandlers =
  createAdminProductMediaHandlers(productMediaService);
