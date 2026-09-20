import type {
  FulfillmentMethod,
  PaymentStatus,
  RentalMode,
  ReservationStatus,
} from '../types/domain';
import type {
  CreateReservationResult,
  CreatedReservation,
} from '../services/reservation.types';
import {
  formatDateOnly,
} from '../utils/date-only';

export interface PublicReservationItemDto {
  productId: string;
  variantId: string;
  productName: string;
  size: string;
  rentalPrice: number;
  deposit: number;
}

export interface PublicReservationDto {
  reservationNumber: string;
  status: ReservationStatus;
  rentalMode: RentalMode;
  startDate: string;
  endDate: string;
  expiresAt: string | null;
  item: PublicReservationItemDto;
  subtotal: number;
  deposit: number;
  totalDue: number;
  fulfillmentMethod?: FulfillmentMethod;
  paymentStatus: PaymentStatus;
}

export interface PublicCreateReservationResponse {
  reservation: PublicReservationDto;
  guestAccessToken?: string;
}

export const toPublicReservationResponse = (
  reservation: CreatedReservation,
  guestAccessToken?: string
): PublicCreateReservationResponse => {
  const item = reservation.items[0];

  if (!item) {
    throw new Error('Reservation response requires one reservation item');
  }

  const publicReservation: PublicReservationDto = {
    reservationNumber: reservation.reservationNumber,
    status: reservation.status,
    rentalMode: reservation.rentalMode,
    startDate: formatDateOnly(reservation.startDate),
    endDate: formatDateOnly(reservation.endDate),
    expiresAt:
      reservation.expiresAt instanceof Date
        ? reservation.expiresAt.toISOString()
        : null,
    item: {
      productId: item.productId.toHexString(),
      variantId: item.variantId.toHexString(),
      productName: item.productNameSnapshot,
      size: item.sizeSnapshot,
      rentalPrice: item.rentalPriceSnapshot,
      deposit: item.depositSnapshot,
    },
    subtotal: reservation.subtotal,
    deposit: reservation.deposit,
    totalDue: reservation.totalDue,
    paymentStatus: reservation.paymentStatus,
  };

  if (reservation.fulfillmentMethod) {
    publicReservation.fulfillmentMethod = reservation.fulfillmentMethod;
  }

  const response: PublicCreateReservationResponse = {
    reservation: publicReservation,
  };

  if (guestAccessToken) {
    response.guestAccessToken = guestAccessToken;
  }

  return response;
};

export const toPublicCreateReservationResponse = (
  result: CreateReservationResult
): PublicCreateReservationResponse =>
  toPublicReservationResponse(
    result.reservation,
    result.guestAccessToken
  );
