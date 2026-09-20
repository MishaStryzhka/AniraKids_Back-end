import type {
  PaymentStatus,
  RentalMode,
  ReservationStatus,
} from '../types/domain';

export type ReservationAdminErrorCode =
  | 'RESERVATION_NOT_FOUND'
  | 'INVALID_RESERVATION_TRANSITION'
  | 'RESERVATION_CONFIRMATION_CONFLICT'
  | 'RESERVATION_INVENTORY_NOT_ACTIVE'
  | 'INVALID_DATE'
  | 'INVALID_DATE_RANGE'
  | 'VALIDATION_ERROR';

export class ReservationAdminError extends Error {
  constructor(
    public readonly code: ReservationAdminErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ReservationAdminError';
  }
}

export interface ReservationAdminListOptions {
  status?: ReservationStatus;
  paymentStatus?: PaymentStatus;
  rentalMode?: RentalMode;
  from?: string;
  to?: string;
  q?: string;
  page: number;
  limit: number;
  now?: Date;
}

export interface ReservationAdminCalendarOptions {
  from: string;
  to: string;
  now?: Date;
}

export interface ReservationAdminCancelInput {
  reason: string;
}

export interface ReservationAdminNotesInput {
  notes: string;
}

export type ReservationAdminOperation =
  | 'confirm'
  | 'prepare'
  | 'rent'
  | 'return'
  | 'cancel';
