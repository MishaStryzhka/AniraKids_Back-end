import type {
  Types,
} from 'mongoose';

import type {
  CustomerSnapshot,
  DateOnlyString,
  RentalMode,
  Reservation,
} from '../types/domain';

export type ReservationServiceErrorCode =
  | 'INVALID_DATE'
  | 'PAST_START_DATE'
  | 'PRODUCT_NOT_FOUND'
  | 'PRODUCT_NOT_RENTABLE'
  | 'VARIANT_NOT_FOUND'
  | 'VARIANT_NOT_ACTIVE'
  | 'VARIANT_PRODUCT_MISMATCH'
  | 'NO_AVAILABLE_INVENTORY'
  | 'RESERVATION_NUMBER_GENERATION_FAILED';

export class ReservationServiceError extends Error {
  constructor(
    public readonly code: ReservationServiceErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ReservationServiceError';
  }
}

export interface CreateReservationCommand {
  productId: Types.ObjectId;
  variantId: Types.ObjectId;
  rentalMode: RentalMode;
  startDate: DateOnlyString;
  endDate: DateOnlyString;
  customerId?: Types.ObjectId;
  customer: CustomerSnapshot;
  notes?: string;
}

export interface CreateReservationOptions {
  now?: Date;
}

export type CreatedReservation = Omit<
  Reservation,
  'guestAccessTokenHash'
> & {
  _id: Types.ObjectId;
};

export interface CreateReservationResult {
  reservation: CreatedReservation;
  guestAccessToken?: string;
}
