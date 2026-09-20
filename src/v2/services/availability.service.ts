import type {
  ClientSession,
  FilterQuery,
  Types,
} from 'mongoose';

import {
  AvailabilityBlockV2Model,
  InventoryItemV2Model,
  ProductV2Model,
  ReservationV2Model,
  VariantV2Model,
} from '../models';
import type {
  AvailabilityBlock,
  Reservation,
} from '../types/domain';
import {
  compareDateOnly,
  isCanonicalDateOnlyDate,
} from '../utils/date-only';
import {
  FIXED_BLOCKING_RESERVATION_STATUSES,
  getReservationEndConflictThreshold,
} from '../utils/availability';
import {
  AvailabilityError,
  type AvailabilityOptions,
  type ProductAvailabilityResult,
  type VariantAvailabilityResult,
} from './availability.types';

const resolveNow = (options?: AvailabilityOptions): Date => {
  const now = options?.now ?? new Date();

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new AvailabilityError('INVALID_NOW', 'now must be a valid Date instant');
  }

  return now;
};

export const assertAvailabilityRange = (
  startDate: Date,
  endDate: Date
): void => {
  if (
    !isCanonicalDateOnlyDate(startDate) ||
    !isCanonicalDateOnlyDate(endDate)
  ) {
    throw new AvailabilityError(
      'NON_CANONICAL_DATE',
      'Availability dates must be canonical date-only Dates at 00:00:00.000Z'
    );
  }

  if (compareDateOnly(endDate, startDate) < 0) {
    throw new AvailabilityError(
      'INVALID_DATE_RANGE',
      'endDate must be on or after startDate'
    );
  }
};

const idKey = (id: Types.ObjectId): string => id.toString();

export interface FindBlockedInventoryItemOptions {
  session?: ClientSession;
  excludeReservationId?: Types.ObjectId;
}

const buildBlockingReservationQuery = (
  inventoryItemIds: readonly Types.ObjectId[],
  requestedStartDate: Date,
  requestedEndDate: Date,
  now: Date,
  excludeReservationId?: Types.ObjectId
): FilterQuery<Reservation> => ({
  'items.inventoryItemId': { $in: inventoryItemIds },
  ...(excludeReservationId === undefined
    ? {}
    : { _id: { $ne: excludeReservationId } }),
  startDate: { $lte: requestedEndDate },
  endDate: {
    $gte: getReservationEndConflictThreshold(requestedStartDate),
  },
  $or: [
    {
      status: {
        $in: [...FIXED_BLOCKING_RESERVATION_STATUSES],
      },
    },
    {
      status: 'pending',
      expiresAt: { $gt: now },
    },
  ],
});

const buildAvailabilityBlockQuery = (
  inventoryItemIds: readonly Types.ObjectId[],
  requestedStartDate: Date,
  requestedEndDate: Date
): FilterQuery<AvailabilityBlock> => ({
  inventoryItemId: { $in: inventoryItemIds },
  startDate: { $lte: requestedEndDate },
  endDate: { $gte: requestedStartDate },
});

export const findBlockedInventoryItemIds = async (
  inventoryItemIds: readonly Types.ObjectId[],
  startDate: Date,
  endDate: Date,
  now: Date,
  options: FindBlockedInventoryItemOptions = {}
): Promise<Set<string>> => {
  if (inventoryItemIds.length === 0) {
    return new Set();
  }

  const candidateIds = new Set(inventoryItemIds.map(idKey));

  const reservationQuery = ReservationV2Model.find(
    buildBlockingReservationQuery(
      inventoryItemIds,
      startDate,
      endDate,
      now,
      options.excludeReservationId
    )
  ).select('items.inventoryItemId');

  const blockQuery = AvailabilityBlockV2Model.find(
    buildAvailabilityBlockQuery(inventoryItemIds, startDate, endDate)
  ).select('inventoryItemId');

  if (options.session) {
    reservationQuery.session(options.session);
    blockQuery.session(options.session);
  }

  let reservations;
  let blocks;

  if (options.session) {
    reservations = await reservationQuery.exec();
    blocks = await blockQuery.exec();
  } else {
    [reservations, blocks] = await Promise.all([
      reservationQuery.exec(),
      blockQuery.exec(),
    ]);
  }

  const blockedIds = new Set<string>();

  for (const reservation of reservations) {
    for (const item of reservation.items) {
      const key = idKey(item.inventoryItemId);
      if (candidateIds.has(key)) {
        blockedIds.add(key);
      }
    }
  }

  for (const block of blocks) {
    blockedIds.add(idKey(block.inventoryItemId));
  }

  return blockedIds;
};

const findAvailableInventoryIdsForVariants = async (
  variantIds: readonly Types.ObjectId[],
  startDate: Date,
  endDate: Date,
  now: Date
): Promise<Map<string, Types.ObjectId[]>> => {
  const availableByVariant = new Map<string, Types.ObjectId[]>();

  for (const variantId of variantIds) {
    availableByVariant.set(idKey(variantId), []);
  }

  if (variantIds.length === 0) {
    return availableByVariant;
  }

  const inventoryItems = await InventoryItemV2Model.find({
    variantId: { $in: variantIds },
    status: 'active',
  })
    .select('_id variantId')
    .exec();

  const inventoryIds = inventoryItems.map(item => item._id);
  const blockedIds = await findBlockedInventoryItemIds(
    inventoryIds,
    startDate,
    endDate,
    now
  );

  for (const item of inventoryItems) {
    if (blockedIds.has(idKey(item._id))) {
      continue;
    }

    const variantKey = idKey(item.variantId);
    const availableIds = availableByVariant.get(variantKey);

    if (availableIds) {
      availableIds.push(item._id);
    }
  }

  return availableByVariant;
};

export class AvailabilityService {
  async isInventoryItemAvailable(
    inventoryItemId: Types.ObjectId,
    startDate: Date,
    endDate: Date,
    options?: AvailabilityOptions
  ): Promise<boolean> {
    assertAvailabilityRange(startDate, endDate);
    const now = resolveNow(options);

    const inventoryItem = await InventoryItemV2Model.findById(inventoryItemId)
      .select('_id status')
      .exec();

    if (!inventoryItem) {
      throw new AvailabilityError(
        'INVENTORY_ITEM_NOT_FOUND',
        'Inventory item not found'
      );
    }

    if (inventoryItem.status !== 'active') {
      return false;
    }

    const blockedIds = await findBlockedInventoryItemIds(
      [inventoryItem._id],
      startDate,
      endDate,
      now
    );

    return !blockedIds.has(idKey(inventoryItem._id));
  }

  async findAvailableInventoryItems(
    variantId: Types.ObjectId,
    startDate: Date,
    endDate: Date,
    options?: AvailabilityOptions
  ): Promise<Types.ObjectId[]> {
    assertAvailabilityRange(startDate, endDate);
    const now = resolveNow(options);

    const variant = await VariantV2Model.findById(variantId)
      .select('_id status')
      .exec();

    if (!variant) {
      throw new AvailabilityError('VARIANT_NOT_FOUND', 'Variant not found');
    }

    if (variant.status !== 'active') {
      return [];
    }

    const availableByVariant = await findAvailableInventoryIdsForVariants(
      [variant._id],
      startDate,
      endDate,
      now
    );

    return availableByVariant.get(idKey(variant._id)) ?? [];
  }

  async getVariantAvailability(
    variantId: Types.ObjectId,
    startDate: Date,
    endDate: Date,
    options?: AvailabilityOptions
  ): Promise<VariantAvailabilityResult> {
    assertAvailabilityRange(startDate, endDate);
    const now = resolveNow(options);

    const variant = await VariantV2Model.findById(variantId)
      .select('_id size status')
      .exec();

    if (!variant) {
      throw new AvailabilityError('VARIANT_NOT_FOUND', 'Variant not found');
    }

    if (variant.status !== 'active') {
      return {
        variantId: variant._id,
        size: variant.size,
        available: false,
        availableItemCount: 0,
      };
    }

    const availableByVariant = await findAvailableInventoryIdsForVariants(
      [variant._id],
      startDate,
      endDate,
      now
    );
    const availableItems = availableByVariant.get(idKey(variant._id)) ?? [];

    return {
      variantId: variant._id,
      size: variant.size,
      available: availableItems.length > 0,
      availableItemCount: availableItems.length,
    };
  }

  async getProductAvailability(
    productId: Types.ObjectId,
    startDate: Date,
    endDate: Date,
    options?: AvailabilityOptions
  ): Promise<ProductAvailabilityResult> {
    assertAvailabilityRange(startDate, endDate);
    const now = resolveNow(options);

    const product = await ProductV2Model.findById(productId)
      .select('_id status rentalEnabled')
      .exec();

    if (!product) {
      throw new AvailabilityError('PRODUCT_NOT_FOUND', 'Product not found');
    }

    if (product.status !== 'active' || !product.rentalEnabled) {
      return {
        productId: product._id,
        available: false,
        variants: [],
      };
    }

    const variants = await VariantV2Model.find({
      productId: product._id,
      status: 'active',
    })
      .select('_id size sortOrder')
      .sort({ sortOrder: 1, size: 1 })
      .exec();

    const variantIds = variants.map(variant => variant._id);
    const availableByVariant = await findAvailableInventoryIdsForVariants(
      variantIds,
      startDate,
      endDate,
      now
    );

    const variantAvailability = variants.map(variant => {
      const availableItems =
        availableByVariant.get(idKey(variant._id)) ?? [];

      return {
        variantId: variant._id,
        size: variant.size,
        available: availableItems.length > 0,
        availableItemCount: availableItems.length,
      };
    });

    return {
      productId: product._id,
      available: variantAvailability.some(variant => variant.available),
      variants: variantAvailability,
    };
  }
}

export const availabilityService = new AvailabilityService();
