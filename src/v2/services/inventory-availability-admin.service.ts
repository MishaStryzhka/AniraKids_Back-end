import {
  Types,
  type ClientSession,
  type HydratedDocument,
} from 'mongoose';

import {
  AvailabilityBlockV2Model,
  InventoryItemV2Model,
  ReservationV2Model,
} from '../models';
import type {
  AvailabilityBlock,
  InventoryItem,
  InventoryItemStatus,
} from '../types/domain';
import {
  FIXED_BLOCKING_RESERVATION_STATUSES,
  getReservationEndConflictThreshold,
} from '../utils/availability';
import {
  compareDateOnly,
  getBusinessDateOnly,
  parseDateOnly,
} from '../utils/date-only';
import {
  createAvailabilityBlockAtomically,
  touchInventoryItemSerializationPoint,
} from './concurrency.service';
import {
  ConcurrencyError,
} from './concurrency.types';
import {
  InventoryAvailabilityAdminError,
  type CreateAvailabilityBlockAdminInput,
  type InventoryLifecycleOptions,
  type InventoryLifecycleSnapshot,
  type InventoryLifecycleTargetStatus,
  type ListAvailabilityBlocksAdminOptions,
} from './inventory-availability-admin.types';

const resolveNow = (now?: Date): Date => {
  const resolved = now ?? new Date();

  if (!(resolved instanceof Date) || Number.isNaN(resolved.getTime())) {
    throw new TypeError('now must be a valid Date instant');
  }

  return resolved;
};

export const isInventoryLifecycleTransitionAllowed = (
  currentStatus: InventoryItemStatus,
  targetStatus: InventoryLifecycleTargetStatus
): boolean => {
  if (currentStatus === targetStatus) {
    return true;
  }

  if (currentStatus === 'retired') {
    return false;
  }

  if (currentStatus === 'active') {
    return targetStatus === 'maintenance' || targetStatus === 'retired';
  }

  return targetStatus === 'active' || targetStatus === 'retired';
};

export const validateInventoryLifecycleTransition = (
  snapshot: InventoryLifecycleSnapshot,
  targetStatus: InventoryLifecycleTargetStatus
): void => {
  if (
    !isInventoryLifecycleTransitionAllowed(
      snapshot.status,
      targetStatus
    )
  ) {
    throw new InventoryAvailabilityAdminError(
      'INVALID_INVENTORY_TRANSITION',
      `Inventory item cannot transition from ${snapshot.status} to ${targetStatus}`
    );
  }

  if (
    snapshot.status === 'maintenance' &&
    targetStatus === 'active' &&
    snapshot.condition === 'damaged'
  ) {
    throw new InventoryAvailabilityAdminError(
      'DAMAGED_ITEM_CANNOT_BE_ACTIVATED',
      'Damaged inventory item cannot be activated'
    );
  }
};

export const parseAdminDateOnly = (
  value: string,
  fieldName: string
): Date => {
  try {
    return parseDateOnly(value);
  } catch (_error) {
    throw new InventoryAvailabilityAdminError(
      'INVALID_DATE',
      `${fieldName} must be a valid YYYY-MM-DD calendar date`
    );
  }
};

export const parseAvailabilityBlockDateRange = (
  input: Pick<CreateAvailabilityBlockAdminInput, 'startDate' | 'endDate'>,
  now: Date = new Date()
): {
  startDate: Date;
  endDate: Date;
  businessToday: Date;
} => {
  const resolvedNow = resolveNow(now);
  const startDate = parseAdminDateOnly(input.startDate, 'startDate');
  const endDate = parseAdminDateOnly(input.endDate, 'endDate');
  const businessToday = parseDateOnly(getBusinessDateOnly(resolvedNow));

  if (compareDateOnly(endDate, startDate) < 0) {
    throw new InventoryAvailabilityAdminError(
      'INVALID_DATE',
      'endDate must be on or after startDate'
    );
  }

  if (compareDateOnly(startDate, businessToday) < 0) {
    throw new InventoryAvailabilityAdminError(
      'PAST_BLOCK_DATE',
      'Availability block startDate cannot be in the past'
    );
  }

  return {
    startDate,
    endDate,
    businessToday,
  };
};

export const getLifecycleReservationEndThreshold = (
  now: Date = new Date()
): Date => {
  const resolvedNow = resolveNow(now);
  const businessToday = parseDateOnly(getBusinessDateOnly(resolvedNow));

  return getReservationEndConflictThreshold(businessToday);
};

const transitionRemovesAvailability = (
  currentStatus: InventoryItemStatus,
  targetStatus: InventoryLifecycleTargetStatus
): boolean =>
  (currentStatus === 'active' && targetStatus === 'maintenance') ||
  (currentStatus === 'active' && targetStatus === 'retired') ||
  (currentStatus === 'maintenance' && targetStatus === 'retired');

const hasBlockingReservationForLifecycle = async (
  inventoryItemId: Types.ObjectId,
  now: Date,
  session: ClientSession
): Promise<boolean> => {
  const threshold = getLifecycleReservationEndThreshold(now);

  const reservation = await ReservationV2Model.findOne({
    'items.inventoryItemId': inventoryItemId,
    endDate: {
      $gte: threshold,
    },
    $or: [
      {
        status: {
          $in: [...FIXED_BLOCKING_RESERVATION_STATUSES],
        },
      },
      {
        status: 'pending',
        expiresAt: {
          $gt: now,
        },
      },
    ],
  })
    .select('_id')
    .session(session)
    .lean()
    .exec();

  return reservation !== null;
};

const translateLifecycleConcurrencyError = (error: unknown): never => {
  if (
    error instanceof ConcurrencyError &&
    error.code === 'INVENTORY_ITEM_NOT_FOUND'
  ) {
    throw new InventoryAvailabilityAdminError(
      'INVENTORY_ITEM_NOT_FOUND',
      'Inventory item not found'
    );
  }

  throw error;
};

const translateBlockConcurrencyError = (error: unknown): never => {
  if (error instanceof ConcurrencyError) {
    switch (error.code) {
      case 'INVENTORY_ITEM_NOT_FOUND':
        throw new InventoryAvailabilityAdminError(
          'INVENTORY_ITEM_NOT_FOUND',
          'Inventory item not found'
        );
      case 'INVENTORY_ITEM_NOT_ACTIVE':
        throw new InventoryAvailabilityAdminError(
          'INVENTORY_ITEM_NOT_ACTIVE',
          'Availability blocks can only be created for active inventory items'
        );
      case 'INVENTORY_ITEM_NOT_AVAILABLE':
        throw new InventoryAvailabilityAdminError(
          'AVAILABILITY_BLOCK_CONFLICT',
          'Availability block conflicts with an existing reservation or block'
        );
      case 'DUPLICATE_INVENTORY_ITEM':
        break;
    }
  }

  throw error;
};

export class InventoryAvailabilityAdminService {
  private async transitionInventoryItem(
    inventoryItemId: Types.ObjectId,
    targetStatus: InventoryLifecycleTargetStatus,
    options?: InventoryLifecycleOptions
  ): Promise<HydratedDocument<InventoryItem>> {
    const now = resolveNow(options?.now);
    const session = await InventoryItemV2Model.db.startSession();
    let transitionedItem: HydratedDocument<InventoryItem> | undefined;

    try {
      await session.withTransaction(
        async () => {
          transitionedItem = undefined;

          const item = await touchInventoryItemSerializationPoint(
            inventoryItemId,
            session
          );

          validateInventoryLifecycleTransition(
            {
              status: item.status,
              condition: item.condition,
            },
            targetStatus
          );

          if (item.status === targetStatus) {
            transitionedItem = item;
            return;
          }

          if (
            transitionRemovesAvailability(
              item.status,
              targetStatus
            ) &&
            await hasBlockingReservationForLifecycle(
              inventoryItemId,
              now,
              session
            )
          ) {
            throw new InventoryAvailabilityAdminError(
              'INVENTORY_HAS_CURRENT_OR_FUTURE_RESERVATION',
              'Inventory item has a current or future blocking reservation'
            );
          }

          item.status = targetStatus;

          if (targetStatus === 'retired') {
            item.retiredAt = now;
          } else if (targetStatus === 'active') {
            item.retiredAt = undefined;
          }

          await item.save({ session });
          transitionedItem = item;
        },
        {
          readConcern: {
            level: 'snapshot',
          },
          writeConcern: {
            w: 'majority',
          },
        }
      );

      if (!transitionedItem) {
        throw new Error(
          'Inventory lifecycle transaction completed without an inventory item'
        );
      }

      return transitionedItem;
    } catch (error) {
      return translateLifecycleConcurrencyError(error);
    } finally {
      await session.endSession();
    }
  }

  async moveToMaintenance(
    inventoryItemId: Types.ObjectId,
    options?: InventoryLifecycleOptions
  ) {
    return this.transitionInventoryItem(
      inventoryItemId,
      'maintenance',
      options
    );
  }

  async activate(
    inventoryItemId: Types.ObjectId,
    options?: InventoryLifecycleOptions
  ) {
    return this.transitionInventoryItem(
      inventoryItemId,
      'active',
      options
    );
  }

  async retire(
    inventoryItemId: Types.ObjectId,
    options?: InventoryLifecycleOptions
  ) {
    return this.transitionInventoryItem(
      inventoryItemId,
      'retired',
      options
    );
  }

  async listAvailabilityBlocks(
    inventoryItemId: Types.ObjectId,
    options: ListAvailabilityBlocksAdminOptions = {}
  ): Promise<HydratedDocument<AvailabilityBlock>[]> {
    const itemExists = await InventoryItemV2Model.exists({
      _id: inventoryItemId,
    }).exec();

    if (!itemExists) {
      throw new InventoryAvailabilityAdminError(
        'INVENTORY_ITEM_NOT_FOUND',
        'Inventory item not found'
      );
    }

    const now = resolveNow(options.now);
    const from = options.from === undefined
      ? parseDateOnly(getBusinessDateOnly(now))
      : parseAdminDateOnly(options.from, 'from');
    const to = options.to === undefined
      ? undefined
      : parseAdminDateOnly(options.to, 'to');

    if (to && compareDateOnly(from, to) > 0) {
      throw new InventoryAvailabilityAdminError(
        'INVALID_DATE',
        'from must be on or before to'
      );
    }

    const filter: Record<string, unknown> = {
      inventoryItemId,
      endDate: {
        $gte: from,
      },
    };

    if (to) {
      filter.startDate = {
        $lte: to,
      };
    }

    return AvailabilityBlockV2Model.find(filter)
      .sort({
        startDate: 1,
        endDate: 1,
      })
      .exec();
  }

  async createAvailabilityBlock(
    inventoryItemId: Types.ObjectId,
    createdBy: Types.ObjectId,
    input: CreateAvailabilityBlockAdminInput,
    options?: InventoryLifecycleOptions
  ) {
    const now = resolveNow(options?.now);
    const { startDate, endDate } =
      parseAvailabilityBlockDateRange(input, now);

    try {
      return await createAvailabilityBlockAtomically({
        inventoryItemId,
        startDate,
        endDate,
        reason: input.reason,
        notes: input.notes,
        createdBy,
        now,
      });
    } catch (error) {
      return translateBlockConcurrencyError(error);
    }
  }

  async deleteAvailabilityBlock(
    availabilityBlockId: Types.ObjectId
  ): Promise<void> {
    const block = await AvailabilityBlockV2Model.findById(
      availabilityBlockId
    ).exec();

    if (!block) {
      throw new InventoryAvailabilityAdminError(
        'AVAILABILITY_BLOCK_NOT_FOUND',
        'Availability block not found'
      );
    }

    await block.deleteOne();
  }
}

export const inventoryAvailabilityAdminService =
  new InventoryAvailabilityAdminService();
