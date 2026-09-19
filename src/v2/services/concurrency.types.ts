import type {
  AvailabilityBlock,
  Reservation,
} from '../types/domain';

export type ConcurrencyErrorCode =
  | 'INVENTORY_ITEM_NOT_FOUND'
  | 'INVENTORY_ITEM_NOT_ACTIVE'
  | 'INVENTORY_ITEM_NOT_AVAILABLE'
  | 'DUPLICATE_INVENTORY_ITEM';

export class ConcurrencyError extends Error {
  constructor(
    public readonly code: ConcurrencyErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ConcurrencyError';
  }
}

export type AtomicReservationInput = Omit<
  Reservation,
  'createdAt' | 'updatedAt'
> & {
  now?: Date;
};

export type AtomicAvailabilityBlockInput = Omit<
  AvailabilityBlock,
  'createdAt'
> & {
  now?: Date;
};
