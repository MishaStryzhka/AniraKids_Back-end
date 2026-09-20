import { Types } from 'mongoose';

import {
  toAdminAvailabilityBlockDto,
  toAdminInventoryItemDto,
} from '../http/admin-response';
import type {
  CreateAvailabilityBlockAdminBody,
  ListAvailabilityBlocksAdminQuery,
} from '../schemas/admin-inventory-availability.schema';
import {
  inventoryAvailabilityAdminService,
} from '../services/inventory-availability-admin.service';
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

const authenticatedAdminId = (
  value: Types.ObjectId | undefined
): Types.ObjectId => {
  if (!value) {
    throw new Error('Authenticated admin identity is missing');
  }

  return value;
};

export const moveAdminInventoryItemToMaintenance: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    const item = await inventoryAvailabilityAdminService.moveToMaintenance(
      objectIdFromParam(request.params?.inventoryItemId)
    );

    return response.status(200).json({
      inventoryItem: toAdminInventoryItemDto(item),
    });
  } catch (error) {
    return next(error);
  }
};

export const activateAdminInventoryItem: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    const item = await inventoryAvailabilityAdminService.activate(
      objectIdFromParam(request.params?.inventoryItemId)
    );

    return response.status(200).json({
      inventoryItem: toAdminInventoryItemDto(item),
    });
  } catch (error) {
    return next(error);
  }
};

export const retireAdminInventoryItem: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    const item = await inventoryAvailabilityAdminService.retire(
      objectIdFromParam(request.params?.inventoryItemId)
    );

    return response.status(200).json({
      inventoryItem: toAdminInventoryItemDto(item),
    });
  } catch (error) {
    return next(error);
  }
};

export const listAdminAvailabilityBlocks: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    const query = request.query as unknown as ListAvailabilityBlocksAdminQuery;
    const blocks = await inventoryAvailabilityAdminService.listAvailabilityBlocks(
      objectIdFromParam(request.params?.inventoryItemId),
      {
        from: query.from,
        to: query.to,
      }
    );

    return response.status(200).json({
      items: blocks.map(toAdminAvailabilityBlockDto),
    });
  } catch (error) {
    return next(error);
  }
};

export const createAdminAvailabilityBlock: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    const block = await inventoryAvailabilityAdminService.createAvailabilityBlock(
      objectIdFromParam(request.params?.inventoryItemId),
      authenticatedAdminId(request.authenticatedUserId),
      request.body as CreateAvailabilityBlockAdminBody
    );

    return response.status(201).json({
      availabilityBlock: toAdminAvailabilityBlockDto(block),
    });
  } catch (error) {
    return next(error);
  }
};

export const deleteAdminAvailabilityBlock: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    await inventoryAvailabilityAdminService.deleteAvailabilityBlock(
      objectIdFromParam(request.params?.availabilityBlockId)
    );

    return response.status(204).json({});
  } catch (error) {
    return next(error);
  }
};
