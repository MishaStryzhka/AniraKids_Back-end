import type { RentalMode, ReservationStatus } from '../types/domain';
import {
  addCalendarDays,
  compareDateOnly,
  isCanonicalDateOnlyDate,
} from './date-only';

export const CLEANING_BUFFER_DAYS = 1;

// Studio garments stay on site and can be cleaned between sessions.
export const getCleaningBufferDays = (rentalMode: RentalMode = 'external'): number =>
  rentalMode === 'studio' ? 0 : CLEANING_BUFFER_DAYS;

export const FIXED_BLOCKING_RESERVATION_STATUSES = [
  'confirmed',
  'prepared',
  'rented',
  'returned',
] as const;

export const isAvailabilityDateRangeValid = (
  startDate: Date,
  endDate: Date
): boolean =>
  isCanonicalDateOnlyDate(startDate) &&
  isCanonicalDateOnlyDate(endDate) &&
  compareDateOnly(startDate, endDate) <= 0;

export const getReservationEndConflictThreshold = (
  requestedStartDate: Date
): Date => addCalendarDays(requestedStartDate, -CLEANING_BUFFER_DAYS);

export const rangesOverlapInclusive = (
  firstStart: Date,
  firstEnd: Date,
  secondStart: Date,
  secondEnd: Date
): boolean => {
  if (
    !isAvailabilityDateRangeValid(firstStart, firstEnd) ||
    !isAvailabilityDateRangeValid(secondStart, secondEnd)
  ) {
    throw new RangeError('Availability ranges must be canonical and ordered');
  }

  return (
    compareDateOnly(firstStart, secondEnd) <= 0 &&
    compareDateOnly(firstEnd, secondStart) >= 0
  );
};

export const reservationConflictsWithRequestedRange = (
  reservationStartDate: Date,
  reservationEndDate: Date,
  requestedStartDate: Date,
  requestedEndDate: Date,
  reservationRentalMode: RentalMode = 'external'
): boolean => {
  const blockingEndDate = addCalendarDays(
    reservationEndDate,
    getCleaningBufferDays(reservationRentalMode)
  );

  return rangesOverlapInclusive(
    reservationStartDate,
    blockingEndDate,
    requestedStartDate,
    requestedEndDate
  );
};

export const availabilityBlockConflictsWithRequestedRange = (
  blockStartDate: Date,
  blockEndDate: Date,
  requestedStartDate: Date,
  requestedEndDate: Date
): boolean =>
  rangesOverlapInclusive(
    blockStartDate,
    blockEndDate,
    requestedStartDate,
    requestedEndDate
  );

export const isBlockingReservationState = (
  status: ReservationStatus,
  expiresAt: Date | null | undefined,
  now: Date
): boolean => {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date instant');
  }

  if (
    FIXED_BLOCKING_RESERVATION_STATUSES.includes(
      status as (typeof FIXED_BLOCKING_RESERVATION_STATUSES)[number]
    )
  ) {
    return true;
  }

  if (status !== 'pending') {
    return false;
  }

  return (
    expiresAt instanceof Date &&
    !Number.isNaN(expiresAt.getTime()) &&
    expiresAt.getTime() > now.getTime()
  );
};
