import type {
  ClientSession,
  HydratedDocument,
  Types,
} from 'mongoose';

import {
  AvailabilityBlockV2Model,
  InventoryItemV2Model,
  ReservationV2Model,
} from '../models';
import type {
  AvailabilityBlock,
  Reservation,
} from '../types/domain';
import {
  CLEANING_BUFFER_DAYS,
} from '../utils/availability';
import {
  addCalendarDays,
} from '../utils/date-only';
import {
  assertAvailabilityRange,
  findBlockedInventoryItemIds,
} from './availability.service';
import {
  ConcurrencyError,
  type AtomicAvailabilityBlockInput,
  type AtomicReservationInput,
} from './concurrency.types';

const objectIdKey = (id: Types.ObjectId): string => id.toHexString();

const resolveNow = (now?: Date): Date => {
  const resolvedNow = now ?? new Date();

  if (
    !(resolvedNow instanceof Date) ||
    Number.isNaN(resolvedNow.getTime())
  ) {
    throw new TypeError('now must be a valid Date instant');
  }

  return resolvedNow;
};

const sortUniqueInventoryItemIds = (
  inventoryItemIds: readonly Types.ObjectId[]
): Types.ObjectId[] => {
  const seen = new Set<string>();

  for (const id of inventoryItemIds) {
    const key = objectIdKey(id);

    if (seen.has(key)) {
      throw new ConcurrencyError(
        'DUPLICATE_INVENTORY_ITEM',
        `Duplicate inventory item: ${key}`
      );
    }

    seen.add(key);
  }

  return [...inventoryItemIds].sort((left, right) =>
    objectIdKey(left).localeCompare(objectIdKey(right))
  );
};

export const acquireInventoryItemSerializationPoints = async (
  inventoryItemIds: readonly Types.ObjectId[],
  session: ClientSession
): Promise<Types.ObjectId[]> => {
  const sortedIds = sortUniqueInventoryItemIds(inventoryItemIds);

  for (const inventoryItemId of sortedIds) {
    const lockedItem = await InventoryItemV2Model.findOneAndUpdate(
      {
        _id: inventoryItemId,
        status: 'active',
      },
      {
        $inc: {
          bookingRevision: 1,
        },
      },
      {
        new: true,
        session,
      }
    )
      .select('_id status')
      .exec();

    if (lockedItem) {
      continue;
    }

    const existingItem = await InventoryItemV2Model.findById(inventoryItemId)
      .select('_id status')
      .session(session)
      .exec();

    if (!existingItem) {
      throw new ConcurrencyError(
        'INVENTORY_ITEM_NOT_FOUND',
        `Inventory item not found: ${objectIdKey(inventoryItemId)}`
      );
    }

    throw new ConcurrencyError(
      'INVENTORY_ITEM_NOT_ACTIVE',
      `Inventory item is not active: ${objectIdKey(inventoryItemId)}`
    );
  }

  return sortedIds;
};

const assertInventoryItemsAvailable = async (
  inventoryItemIds: readonly Types.ObjectId[],
  startDate: Date,
  endDate: Date,
  now: Date,
  session: ClientSession
): Promise<void> => {
  const blockedIds = await findBlockedInventoryItemIds(
    inventoryItemIds,
    startDate,
    endDate,
    now,
    session
  );

  if (blockedIds.size > 0) {
    throw new ConcurrencyError(
      'INVENTORY_ITEM_NOT_AVAILABLE',
      'One or more inventory items are not available for the requested dates'
    );
  }
};

export const createReservationAtomically = async (
  input: AtomicReservationInput
): Promise<HydratedDocument<Reservation>> => {
  assertAvailabilityRange(input.startDate, input.endDate);

  const now = resolveNow(input.now);
  const inventoryItemIds = input.items.map(item => item.inventoryItemId);
  const requestedOccupiedEnd = addCalendarDays(
    input.endDate,
    CLEANING_BUFFER_DAYS
  );
  const session = await InventoryItemV2Model.db.startSession();

  try {
    const reservation = await session.withTransaction(
      async () => {
        const lockedIds = await acquireInventoryItemSerializationPoints(
          inventoryItemIds,
          session
        );

        await assertInventoryItemsAvailable(
          lockedIds,
          input.startDate,
          requestedOccupiedEnd,
          now,
          session
        );

        const { now: _now, ...reservationData } = input;
        const reservationDocument = new ReservationV2Model(reservationData);

        await reservationDocument.save({ session });

        return reservationDocument;
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

    if (!reservation) {
      throw new Error('Reservation transaction completed without a document');
    }

    return reservation;
  } finally {
    await session.endSession();
  }
};

export const createAvailabilityBlockAtomically = async (
  input: AtomicAvailabilityBlockInput
): Promise<HydratedDocument<AvailabilityBlock>> => {
  assertAvailabilityRange(input.startDate, input.endDate);

  const now = resolveNow(input.now);
  const session = await InventoryItemV2Model.db.startSession();

  try {
    const block = await session.withTransaction(
      async () => {
        const [lockedInventoryItemId] =
          await acquireInventoryItemSerializationPoints(
            [input.inventoryItemId],
            session
          );

        await assertInventoryItemsAvailable(
          [lockedInventoryItemId],
          input.startDate,
          input.endDate,
          now,
          session
        );

        const { now: _now, ...blockData } = input;
        const blockDocument = new AvailabilityBlockV2Model(blockData);

        await blockDocument.save({ session });

        return blockDocument;
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

    if (!block) {
      throw new Error(
        'Availability block transaction completed without a document'
      );
    }

    return block;
  } finally {
    await session.endSession();
  }
};
