import type {
  HydratedDocument,
  Types,
} from 'mongoose';

import {
  ProductV2Model,
  ReservationV2Model,
  VariantV2Model,
} from '../models';
import type {
  Reservation,
} from '../types/domain';
import {
  calculateReservationTotals,
  resolveRentalPricing,
} from '../utils/pricing';
import {
  compareDateOnly,
  getBusinessDateOnly,
  parseDateOnly,
} from '../utils/date-only';
import {
  calculatePendingExpiresAt,
  generateGuestAccessToken,
  generateReservationNumber,
  normalizeReservationCustomer,
  normalizeReservationNotes,
} from '../utils/reservation';
import {
  availabilityService,
} from './availability.service';
import {
  createReservationAtomically,
} from './concurrency.service';
import {
  ConcurrencyError,
} from './concurrency.types';
import {
  ReservationServiceError,
  type CreateReservationCommand,
  type CreateReservationOptions,
  type CreateReservationResult,
  type CreatedReservation,
  type TrustedReservationIdempotencyContext,
} from './reservation.types';

const MAX_RESERVATION_NUMBER_ATTEMPTS = 5;

const objectIdKey = (id: Types.ObjectId): string => id.toHexString();

const resolveNow = (options?: CreateReservationOptions): Date => {
  const now = options?.now ?? new Date();

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date instant');
  }

  return now;
};

const parseReservationDates = (
  startDateValue: string,
  endDateValue: string
): { startDate: Date; endDate: Date } => {
  try {
    const startDate = parseDateOnly(startDateValue);
    const endDate = parseDateOnly(endDateValue);

    if (compareDateOnly(endDate, startDate) < 0) {
      throw new RangeError('endDate must be on or after startDate');
    }

    return {
      startDate,
      endDate,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Invalid date';

    throw new ReservationServiceError(
      'INVALID_DATE',
      `Invalid rental date: ${detail}`
    );
  }
};

const isDuplicateKeyForField = (
  error: unknown,
  field: string
): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    keyPattern?: unknown;
    keyValue?: unknown;
  };

  if (candidate.code !== 11000) {
    return false;
  }

  const hasField = (value: unknown): boolean =>
    typeof value === 'object' &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, field);

  return hasField(candidate.keyPattern) || hasField(candidate.keyValue);
};

const toSafeReservation = (
  reservationDocument: HydratedDocument<Reservation>
): CreatedReservation => {
  const reservationObject = reservationDocument.toObject();
  const {
    guestAccessTokenHash: _guestAccessTokenHash,
    idempotencyKeyHash: _idempotencyKeyHash,
    idempotencyRequestHash: _idempotencyRequestHash,
    ...safeReservation
  } = reservationObject;

  return safeReservation as CreatedReservation;
};

const toReplayResult = (
  reservationDocument: HydratedDocument<Reservation>,
  idempotency: TrustedReservationIdempotencyContext
): CreateReservationResult => {
  const result: CreateReservationResult = {
    reservation: toSafeReservation(reservationDocument),
    replayed: true,
  };

  if (idempotency.guestAccessToken) {
    result.guestAccessToken = idempotency.guestAccessToken.rawToken;
  }

  return result;
};

export class ReservationService {
  async findIdempotentReplay(
    idempotency: TrustedReservationIdempotencyContext
  ): Promise<CreateReservationResult | undefined> {
    const existingReservation = await ReservationV2Model.findOne({
      idempotencyKeyHash: idempotency.keyHash,
    })
      .select('+idempotencyRequestHash')
      .exec();

    if (!existingReservation) {
      return undefined;
    }

    if (
      existingReservation.idempotencyRequestHash !==
      idempotency.requestHash
    ) {
      throw new ReservationServiceError(
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency key was already used for a different reservation request'
      );
    }

    return toReplayResult(existingReservation, idempotency);
  }

  async createReservation(
    command: CreateReservationCommand,
    options?: CreateReservationOptions
  ): Promise<CreateReservationResult> {
    const now = resolveNow(options);

    if (options?.idempotency) {
      const replay = await this.findIdempotentReplay(
        options.idempotency
      );

      if (replay) {
        return replay;
      }
    }

    const {
      startDate,
      endDate,
    } = parseReservationDates(command.startDate, command.endDate);

    const businessToday = parseDateOnly(getBusinessDateOnly(now));

    if (compareDateOnly(startDate, businessToday) < 0) {
      throw new ReservationServiceError(
        'PAST_START_DATE',
        'Rental startDate cannot be in the past'
      );
    }

    const product = await ProductV2Model.findById(command.productId).exec();

    if (!product) {
      throw new ReservationServiceError(
        'PRODUCT_NOT_FOUND',
        'Product not found'
      );
    }

    if (product.status !== 'active' || !product.rentalEnabled) {
      throw new ReservationServiceError(
        'PRODUCT_NOT_RENTABLE',
        'Product is not available for rental'
      );
    }

    const variant = await VariantV2Model.findById(command.variantId).exec();

    if (!variant) {
      throw new ReservationServiceError(
        'VARIANT_NOT_FOUND',
        'Variant not found'
      );
    }

    if (variant.status !== 'active') {
      throw new ReservationServiceError(
        'VARIANT_NOT_ACTIVE',
        'Variant is not active'
      );
    }

    if (!variant.productId.equals(product._id)) {
      throw new ReservationServiceError(
        'VARIANT_PRODUCT_MISMATCH',
        'Variant does not belong to the requested Product'
      );
    }

    const resolvedPricing = resolveRentalPricing(
      product,
      variant,
      command.rentalMode
    );
    const totals = calculateReservationTotals([resolvedPricing]);

    const candidateInventoryItemIds =
      await availabilityService.findAvailableInventoryItems(
        variant._id,
        startDate,
        endDate,
        {
          now,
        }
      );

    const sortedCandidates = [...candidateInventoryItemIds].sort(
      (left, right) => objectIdKey(left).localeCompare(objectIdKey(right))
    );

    if (sortedCandidates.length === 0) {
      throw new ReservationServiceError(
        'NO_AVAILABLE_INVENTORY',
        'No physical inventory item is available for the requested dates'
      );
    }

    const normalizedCustomer = normalizeReservationCustomer(command.customer);
    const normalizedNotes = normalizeReservationNotes(command.notes);
    const expiresAt = calculatePendingExpiresAt(now);

    const guestToken = command.customerId
      ? undefined
      : options?.idempotency?.guestAccessToken ??
        generateGuestAccessToken();

    if (
      !command.customerId &&
      options?.idempotency &&
      !options.idempotency.guestAccessToken
    ) {
      throw new Error(
        'Guest idempotent reservation requires a trusted guest access token'
      );
    }

    for (const inventoryItemId of sortedCandidates) {
      let candidateUnavailable = false;

      for (
        let numberAttempt = 0;
        numberAttempt < MAX_RESERVATION_NUMBER_ATTEMPTS;
        numberAttempt += 1
      ) {
        const reservationNumber = generateReservationNumber(now);

        try {
          const reservationDocument = await createReservationAtomically({
            reservationNumber,
            customerId: command.customerId,
            guestAccessTokenHash: guestToken?.hash,
            idempotencyKeyHash: options?.idempotency?.keyHash,
            idempotencyRequestHash: options?.idempotency?.requestHash,
            customerSnapshot: normalizedCustomer,
            items: [
              {
                productId: product._id,
                variantId: variant._id,
                inventoryItemId,
                productNameSnapshot: product.name,
                sizeSnapshot: variant.size,
                rentalPriceSnapshot: resolvedPricing.rentalPrice,
                depositSnapshot: resolvedPricing.deposit,
              },
            ],
            rentalMode: command.rentalMode,
            startDate,
            endDate,
            status: 'pending',
            expiresAt,
            subtotal: totals.subtotal,
            deposit: totals.deposit,
            totalDue: totals.totalDue,
            fulfillmentMethod:
              command.rentalMode === 'external' ? 'pickup' : undefined,
            paymentStatus: 'unpaid',
            notes: normalizedNotes,
            now,
          });

          const result: CreateReservationResult = {
            reservation: toSafeReservation(reservationDocument),
          };

          if (guestToken) {
            result.guestAccessToken = guestToken.rawToken;
          }

          return result;
        } catch (error) {
          if (
            options?.idempotency &&
            isDuplicateKeyForField(error, 'idempotencyKeyHash')
          ) {
            const replay = await this.findIdempotentReplay(
              options.idempotency
            );

            if (replay) {
              return replay;
            }

            throw error;
          }

          if (
            error instanceof ConcurrencyError &&
            error.code === 'INVENTORY_ITEM_NOT_AVAILABLE'
          ) {
            if (options?.idempotency) {
              const replay = await this.findIdempotentReplay(
                options.idempotency
              );

              if (replay) {
                return replay;
              }
            }

            candidateUnavailable = true;
            break;
          }

          if (isDuplicateKeyForField(error, 'reservationNumber')) {
            if (numberAttempt + 1 === MAX_RESERVATION_NUMBER_ATTEMPTS) {
              throw new ReservationServiceError(
                'RESERVATION_NUMBER_GENERATION_FAILED',
                'Unable to generate a unique reservation number'
              );
            }

            continue;
          }

          throw error;
        }
      }

      if (candidateUnavailable) {
        continue;
      }
    }

    throw new ReservationServiceError(
      'NO_AVAILABLE_INVENTORY',
      'No physical inventory item remained available during reservation'
    );
  }
}

export const reservationService = new ReservationService();
