import {
  Types,
  type FilterQuery,
  type HydratedDocument,
} from 'mongoose';

import {
  InventoryItemV2Model,
  ReservationV2Model,
} from '../models';
import type {
  Reservation,
  ReservationStatus,
} from '../types/domain';
import {
  CLEANING_BUFFER_DAYS,
  FIXED_BLOCKING_RESERVATION_STATUSES,
  getReservationEndConflictThreshold,
  isBlockingReservationState,
} from '../utils/availability';
import {
  addCalendarDays,
  calculateRentalDays,
  compareDateOnly,
  parseDateOnly,
} from '../utils/date-only';
import {
  acquireInventoryItemSerializationPoints,
} from './concurrency.service';
import {
  ConcurrencyError,
} from './concurrency.types';
import {
  assertAvailabilityRange,
  findBlockedInventoryItemIds,
} from './availability.service';
import {
  ReservationAdminError,
  type ReservationAdminCalendarOptions,
  type ReservationAdminCancelInput,
  type ReservationAdminListOptions,
  type ReservationAdminNotesInput,
  type ReservationAdminOperation,
} from './reservation-admin.types';

const MAX_CALENDAR_DAYS = 366;

const resolveNow = (now?: Date): Date => {
  const resolved = now ?? new Date();

  if (!(resolved instanceof Date) || Number.isNaN(resolved.getTime())) {
    throw new TypeError('now must be a valid Date instant');
  }

  return resolved;
};

export const escapeAdminReservationSearchRegex = (
  value: string
): string => value.replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&');

export const isPendingReservationExpired = (
  reservation: Pick<Reservation, 'status' | 'expiresAt'>,
  now: Date
): boolean =>
  reservation.status === 'pending' &&
  reservation.expiresAt instanceof Date &&
  !Number.isNaN(reservation.expiresAt.getTime()) &&
  reservation.expiresAt.getTime() <= now.getTime();

export const getReservationOccupiedThrough = (
  endDate: Date
): Date => addCalendarDays(endDate, CLEANING_BUFFER_DAYS);

export const isReservationCalendarBlocking = (
  reservation: Pick<Reservation, 'status' | 'expiresAt'>,
  now: Date
): boolean =>
  isBlockingReservationState(
    reservation.status,
    reservation.expiresAt,
    now
  );

export const isReservationAdminOperationAllowed = (
  currentStatus: ReservationStatus,
  operation: ReservationAdminOperation
): boolean => {
  switch (operation) {
    case 'confirm':
      return currentStatus === 'pending' || currentStatus === 'confirmed';
    case 'prepare':
      return currentStatus === 'confirmed' || currentStatus === 'prepared';
    case 'rent':
      return currentStatus === 'prepared' || currentStatus === 'rented';
    case 'return':
      return currentStatus === 'rented' || currentStatus === 'returned';
    case 'cancel':
      return (
        currentStatus === 'pending' ||
        currentStatus === 'confirmed' ||
        currentStatus === 'prepared' ||
        currentStatus === 'cancelled'
      );
  }
};

export const parseReservationAdminDate = (
  value: string,
  fieldName: string
): Date => {
  try {
    return parseDateOnly(value);
  } catch (_error) {
    throw new ReservationAdminError(
      'INVALID_DATE',
      `${fieldName} must be a valid YYYY-MM-DD calendar date`
    );
  }
};

const parseOptionalListDateRange = (
  fromValue?: string,
  toValue?: string
): {
  from?: Date;
  to?: Date;
} => {
  const from =
    fromValue === undefined
      ? undefined
      : parseReservationAdminDate(fromValue, 'from');
  const to =
    toValue === undefined
      ? undefined
      : parseReservationAdminDate(toValue, 'to');

  if (from && to && compareDateOnly(from, to) > 0) {
    throw new ReservationAdminError(
      'INVALID_DATE_RANGE',
      'from must be on or before to'
    );
  }

  return {
    from,
    to,
  };
};

export const buildReservationAdminListFilter = (
  options: Pick<
    ReservationAdminListOptions,
    'status' | 'paymentStatus' | 'rentalMode' | 'from' | 'to' | 'q'
  >
): FilterQuery<Reservation> => {
  const filter: FilterQuery<Reservation> = {};

  if (options.status !== undefined) {
    filter.status = options.status;
  }

  if (options.paymentStatus !== undefined) {
    filter.paymentStatus = options.paymentStatus;
  }

  if (options.rentalMode !== undefined) {
    filter.rentalMode = options.rentalMode;
  }

  const { from, to } = parseOptionalListDateRange(
    options.from,
    options.to
  );

  if (from) {
    filter.endDate = {
      $gte: from,
    };
  }

  if (to) {
    filter.startDate = {
      $lte: to,
    };
  }

  if (options.q !== undefined) {
    const normalized = options.q.trim();

    if (normalized.length > 0) {
      const search = new RegExp(
        escapeAdminReservationSearchRegex(normalized),
        'i'
      );

      filter.$or = [
        { reservationNumber: search },
        { 'customerSnapshot.firstName': search },
        { 'customerSnapshot.lastName': search },
        { 'customerSnapshot.email': search },
        { 'customerSnapshot.phone': search },
      ];
    }
  }

  return filter;
};

export const buildReservationAdminCalendarFilter = (
  from: Date,
  to: Date,
  now: Date
): FilterQuery<Reservation> => ({
  startDate: {
    $lte: to,
  },
  endDate: {
    $gte: getReservationEndConflictThreshold(from),
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
});

const invalidTransition = (
  currentStatus: ReservationStatus,
  operation: ReservationAdminOperation
): never => {
  throw new ReservationAdminError(
    'INVALID_RESERVATION_TRANSITION',
    `Reservation in status ${currentStatus} cannot perform ${operation}`
  );
};

const getReservationOrThrow = async (
  reservationId: Types.ObjectId
): Promise<HydratedDocument<Reservation>> => {
  const reservation = await ReservationV2Model.findById(
    reservationId
  ).exec();

  if (!reservation) {
    throw new ReservationAdminError(
      'RESERVATION_NOT_FOUND',
      'Reservation not found'
    );
  }

  return reservation;
};

const uniqueSortedInventoryItemIds = (
  reservation: Pick<Reservation, 'items'>
): Types.ObjectId[] => {
  const byId = new Map<string, Types.ObjectId>();

  for (const item of reservation.items) {
    byId.set(item.inventoryItemId.toHexString(), item.inventoryItemId);
  }

  return [...byId.values()].sort((left, right) =>
    left.toHexString().localeCompare(right.toHexString())
  );
};

const translateConfirmationConcurrencyError = (
  error: unknown
): never => {
  if (error instanceof ConcurrencyError) {
    if (
      error.code === 'INVENTORY_ITEM_NOT_FOUND' ||
      error.code === 'INVENTORY_ITEM_NOT_ACTIVE'
    ) {
      throw new ReservationAdminError(
        'RESERVATION_INVENTORY_NOT_ACTIVE',
        'One or more reservation inventory items are missing or not active'
      );
    }

    if (error.code === 'INVENTORY_ITEM_NOT_AVAILABLE') {
      throw new ReservationAdminError(
        'RESERVATION_CONFIRMATION_CONFLICT',
        'Reservation inventory is no longer available'
      );
    }
  }

  throw error;
};

export class ReservationAdminService {
  async listReservations(options: ReservationAdminListOptions) {
    const now = resolveNow(options.now);
    const filter = buildReservationAdminListFilter(options);
    const skip = (options.page - 1) * options.limit;

    const [items, total] = await Promise.all([
      ReservationV2Model.find(filter)
        .select(
          '_id reservationNumber status paymentStatus rentalMode startDate endDate expiresAt customerSnapshot items subtotal deposit totalDue createdAt updatedAt'
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .lean()
        .exec(),
      ReservationV2Model.countDocuments(filter).exec(),
    ]);

    return {
      items,
      now,
      pagination: {
        page: options.page,
        limit: options.limit,
        total,
        pages: total === 0 ? 0 : Math.ceil(total / options.limit),
      },
    };
  }

  async getReservationDetail(reservationId: Types.ObjectId) {
    const reservation = await ReservationV2Model.findById(reservationId)
      .select(
        '_id reservationNumber customerId customerSnapshot items rentalMode startDate endDate status expiresAt subtotal deposit totalDue fulfillmentMethod paymentStatus notes cancelledAt cancellationReason createdAt updatedAt'
      )
      .lean()
      .exec();

    if (!reservation) {
      throw new ReservationAdminError(
        'RESERVATION_NOT_FOUND',
        'Reservation not found'
      );
    }

    const inventoryItemIds = uniqueSortedInventoryItemIds(reservation);

    const currentInventory = inventoryItemIds.length === 0
      ? []
      : await InventoryItemV2Model.find({
          _id: {
            $in: inventoryItemIds,
          },
        })
          .select('_id internalCode status condition')
          .lean()
          .exec();

    const inventoryById = new Map(
      currentInventory.map(item => [
        item._id.toHexString(),
        item,
      ])
    );

    return {
      reservation,
      inventoryById,
    };
  }

  async updateNotes(
    reservationId: Types.ObjectId,
    input: ReservationAdminNotesInput
  ) {
    const normalized = input.notes.trim();
    const update =
      normalized.length === 0
        ? { $unset: { notes: 1 } }
        : { $set: { notes: normalized } };

    const reservation = await ReservationV2Model.findOneAndUpdate(
      {
        _id: reservationId,
      },
      update,
      {
        new: true,
        runValidators: true,
      }
    ).exec();

    if (!reservation) {
      throw new ReservationAdminError(
        'RESERVATION_NOT_FOUND',
        'Reservation not found'
      );
    }

    return reservation;
  }

  private async transitionStatus(
    reservationId: Types.ObjectId,
    operation: Exclude<ReservationAdminOperation, 'confirm' | 'cancel'>,
    expectedStatus: ReservationStatus,
    targetStatus: ReservationStatus
  ) {
    const updated = await ReservationV2Model.findOneAndUpdate(
      {
        _id: reservationId,
        status: expectedStatus,
      },
      {
        $set: {
          status: targetStatus,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    ).exec();

    if (updated) {
      return updated;
    }

    const current = await getReservationOrThrow(reservationId);

    if (current.status === targetStatus) {
      return current;
    }

    return invalidTransition(current.status, operation);
  }

  async prepare(reservationId: Types.ObjectId) {
    return this.transitionStatus(
      reservationId,
      'prepare',
      'confirmed',
      'prepared'
    );
  }

  async rent(reservationId: Types.ObjectId) {
    return this.transitionStatus(
      reservationId,
      'rent',
      'prepared',
      'rented'
    );
  }

  async returnReservation(reservationId: Types.ObjectId) {
    return this.transitionStatus(
      reservationId,
      'return',
      'rented',
      'returned'
    );
  }

  async cancel(
    reservationId: Types.ObjectId,
    input: ReservationAdminCancelInput,
    options?: { now?: Date }
  ) {
    const now = resolveNow(options?.now);
    const reason = input.reason.trim();

    const updated = await ReservationV2Model.findOneAndUpdate(
      {
        _id: reservationId,
        status: {
          $in: ['pending', 'confirmed', 'prepared'],
        },
      },
      {
        $set: {
          status: 'cancelled',
          cancelledAt: now,
          cancellationReason: reason,
          expiresAt: null,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    ).exec();

    if (updated) {
      return updated;
    }

    const current = await getReservationOrThrow(reservationId);

    if (current.status === 'cancelled') {
      return current;
    }

    return invalidTransition(current.status, 'cancel');
  }

  async confirm(
    reservationId: Types.ObjectId,
    options?: { now?: Date }
  ): Promise<HydratedDocument<Reservation>> {
    const now = resolveNow(options?.now);
    const session = await ReservationV2Model.db.startSession();
    let confirmedReservation: HydratedDocument<Reservation> | undefined;

    try {
      await session.withTransaction(
        async () => {
          confirmedReservation = undefined;

          const reservation = await ReservationV2Model.findById(
            reservationId
          )
            .session(session)
            .exec();

          if (!reservation) {
            throw new ReservationAdminError(
              'RESERVATION_NOT_FOUND',
              'Reservation not found'
            );
          }

          if (reservation.status === 'confirmed') {
            confirmedReservation = reservation;
            return;
          }

          if (reservation.status !== 'pending') {
            invalidTransition(reservation.status, 'confirm');
          }

          assertAvailabilityRange(
            reservation.startDate,
            reservation.endDate
          );

          const inventoryItemIds =
            uniqueSortedInventoryItemIds(reservation);

          if (inventoryItemIds.length === 0) {
            throw new ReservationAdminError(
              'RESERVATION_CONFIRMATION_CONFLICT',
              'Reservation has no physical inventory items'
            );
          }

          await acquireInventoryItemSerializationPoints(
            inventoryItemIds,
            session
          );

          const occupiedEnd = getReservationOccupiedThrough(
            reservation.endDate
          );

          const blockedIds = await findBlockedInventoryItemIds(
            inventoryItemIds,
            reservation.startDate,
            occupiedEnd,
            now,
            {
              session,
              excludeReservationId: reservation._id,
            }
          );

          if (blockedIds.size > 0) {
            throw new ReservationAdminError(
              'RESERVATION_CONFIRMATION_CONFLICT',
              'Reservation inventory is no longer available'
            );
          }

          reservation.status = 'confirmed';
          reservation.expiresAt = null;

          await reservation.save({ session });
          confirmedReservation = reservation;
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

      if (!confirmedReservation) {
        throw new Error(
          'Reservation confirmation transaction completed without a reservation'
        );
      }

      return confirmedReservation;
    } catch (error) {
      return translateConfirmationConcurrencyError(error);
    } finally {
      await session.endSession();
    }
  }

  async getCalendar(options: ReservationAdminCalendarOptions) {
    const now = resolveNow(options.now);
    const from = parseReservationAdminDate(options.from, 'from');
    const to = parseReservationAdminDate(options.to, 'to');

    if (compareDateOnly(from, to) > 0) {
      throw new ReservationAdminError(
        'INVALID_DATE_RANGE',
        'from must be on or before to'
      );
    }

    if (calculateRentalDays(from, to) > MAX_CALENDAR_DAYS) {
      throw new ReservationAdminError(
        'INVALID_DATE_RANGE',
        `Calendar range cannot exceed ${MAX_CALENDAR_DAYS} days`
      );
    }

    const filter = buildReservationAdminCalendarFilter(
      from,
      to,
      now
    );

    const items = await ReservationV2Model.find(filter)
      .select(
        '_id reservationNumber status rentalMode startDate endDate expiresAt customerSnapshot items'
      )
      .sort({
        startDate: 1,
        reservationNumber: 1,
      })
      .lean()
      .exec();

    return {
      items,
      from,
      to,
      now,
    };
  }
}

export const reservationAdminService =
  new ReservationAdminService();
