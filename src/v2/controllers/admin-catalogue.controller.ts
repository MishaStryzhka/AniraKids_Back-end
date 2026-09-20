import { Types } from 'mongoose';

import {
  toAdminInventoryItemDto,
  toAdminProductDetailDto,
  toAdminProductDto,
  toAdminProductListDto,
  toAdminVariantDto,
} from '../http/admin-response';
import type {
  CreateInventoryItemAdminBody,
  CreateProductAdminBody,
  CreateVariantAdminBody,
  ListProductsAdminQuery,
  UpdateInventoryItemAdminBody,
  UpdateProductAdminBody,
  UpdateVariantAdminBody,
} from '../schemas/admin-catalogue.schema';
import {
  catalogueAdminService,
} from '../services/catalogue-admin.service';
import type {
  HttpHandler,
} from '../types/http';

const objectIdFromParam = (
  value: string | undefined
): Types.ObjectId => new Types.ObjectId(value);

export const listAdminProducts: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    const result = await catalogueAdminService.listProducts(
      request.query as unknown as ListProductsAdminQuery
    );

    return response
      .status(200)
      .json(toAdminProductListDto(result));
  } catch (error) {
    return next(error);
  }
};

export const getAdminProductDetail: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    const result = await catalogueAdminService.getProductDetail(
      objectIdFromParam(request.params?.productId)
    );

    return response
      .status(200)
      .json(toAdminProductDetailDto(result));
  } catch (error) {
    return next(error);
  }
};

export const createAdminProduct: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    const product = await catalogueAdminService.createProduct(
      request.body as CreateProductAdminBody
    );

    return response.status(201).json({
      product: toAdminProductDto(product),
    });
  } catch (error) {
    return next(error);
  }
};

export const updateAdminProduct: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    const product = await catalogueAdminService.updateProduct(
      objectIdFromParam(request.params?.productId),
      request.body as UpdateProductAdminBody
    );

    return response.status(200).json({
      product: toAdminProductDto(product),
    });
  } catch (error) {
    return next(error);
  }
};

export const activateAdminProduct: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    const product = await catalogueAdminService.activateProduct(
      objectIdFromParam(request.params?.productId)
    );

    return response.status(200).json({
      product: toAdminProductDto(product),
    });
  } catch (error) {
    return next(error);
  }
};

export const archiveAdminProduct: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    const product = await catalogueAdminService.archiveProduct(
      objectIdFromParam(request.params?.productId)
    );

    return response.status(200).json({
      product: toAdminProductDto(product),
    });
  } catch (error) {
    return next(error);
  }
};

export const createAdminVariant: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    const variant = await catalogueAdminService.createVariant(
      objectIdFromParam(request.params?.productId),
      request.body as CreateVariantAdminBody
    );

    return response.status(201).json({
      variant: toAdminVariantDto(variant),
    });
  } catch (error) {
    return next(error);
  }
};

export const updateAdminVariant: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    const variant = await catalogueAdminService.updateVariant(
      objectIdFromParam(request.params?.variantId),
      request.body as UpdateVariantAdminBody
    );

    return response.status(200).json({
      variant: toAdminVariantDto(variant),
    });
  } catch (error) {
    return next(error);
  }
};

export const createAdminInventoryItem: HttpHandler = async (
  request,
  response,
  next
) => {
  const body = request.body as CreateInventoryItemAdminBody;

  try {
    const item = await catalogueAdminService.createInventoryItem(
      objectIdFromParam(request.params?.variantId),
      {
        internalCode: body.internalCode,
        condition: body.condition,
        notes: body.notes,
        acquiredAt:
          body.acquiredAt === undefined
            ? undefined
            : new Date(body.acquiredAt),
      }
    );

    return response.status(201).json({
      inventoryItem: toAdminInventoryItemDto(item),
    });
  } catch (error) {
    return next(error);
  }
};

export const updateAdminInventoryItem: HttpHandler = async (
  request,
  response,
  next
) => {
  const body = request.body as UpdateInventoryItemAdminBody;

  try {
    const item = await catalogueAdminService.updateInventoryItem(
      objectIdFromParam(request.params?.inventoryItemId),
      {
        condition: body.condition,
        notes: body.notes,
        acquiredAt:
          body.acquiredAt === undefined
            ? undefined
            : new Date(body.acquiredAt),
      }
    );

    return response.status(200).json({
      inventoryItem: toAdminInventoryItemDto(item),
    });
  } catch (error) {
    return next(error);
  }
};
