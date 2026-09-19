import {
  createHash,
  createHmac,
} from 'crypto';
import type {
  Types,
} from 'mongoose';

import type {
  CustomerSnapshot,
  RentalMode,
} from '../types/domain';
import {
  hashGuestAccessToken,
  normalizeReservationCustomer,
  normalizeReservationNotes,
  type GuestAccessToken,
} from './reservation';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GUEST_TOKEN_CONTEXT = 'anirakids:v2:guest:';
const MIN_GUEST_TOKEN_SECRET_BYTES = 32;

export class IdempotencyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyConfigurationError';
  }
}

export interface ReservationFingerprintInput {
  productId: string;
  variantId: string;
  rentalMode: RentalMode;
  startDate: string;
  endDate: string;
  customer: CustomerSnapshot;
  notes?: string;
  authenticatedUserId?: Types.ObjectId | string;
}

export interface CanonicalReservationFingerprint {
  productId: string;
  variantId: string;
  rentalMode: RentalMode;
  startDate: string;
  endDate: string;
  customer: CustomerSnapshot;
  notes: string | null;
  authenticatedUserId: string | null;
}

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const toBase64Url = (value: Buffer): string =>
  value
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

export const isCanonicalUuidV4 = (value: string): boolean =>
  UUID_V4_PATTERN.test(value);

export const hashIdempotencyKey = (rawKey: string): string =>
  sha256Hex(rawKey);

export const normalizeReservationFingerprint = (
  input: ReservationFingerprintInput
): CanonicalReservationFingerprint => {
  const customer = normalizeReservationCustomer(input.customer);
  const notes = normalizeReservationNotes(input.notes) ?? null;
  const authenticatedUserId =
    input.authenticatedUserId === undefined
      ? null
      : input.authenticatedUserId.toString().toLowerCase();

  return {
    productId: input.productId.toLowerCase(),
    variantId: input.variantId.toLowerCase(),
    rentalMode: input.rentalMode,
    startDate: input.startDate,
    endDate: input.endDate,
    customer: {
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone,
    },
    notes,
    authenticatedUserId,
  };
};

export const hashReservationFingerprint = (
  input: ReservationFingerprintInput
): string =>
  sha256Hex(
    JSON.stringify(normalizeReservationFingerprint(input))
  );

export const requireGuestTokenSecret = (
  secret = process.env.V2_GUEST_TOKEN_SECRET
): string => {
  if (
    typeof secret !== 'string' ||
    Buffer.byteLength(secret, 'utf8') < MIN_GUEST_TOKEN_SECRET_BYTES
  ) {
    throw new IdempotencyConfigurationError(
      'V2_GUEST_TOKEN_SECRET must contain at least 32 bytes'
    );
  }

  return secret;
};

export const deriveIdempotentGuestAccessToken = (
  rawIdempotencyKey: string,
  secret = requireGuestTokenSecret()
): GuestAccessToken => {
  const rawToken = toBase64Url(
    createHmac('sha256', secret)
      .update(`${GUEST_TOKEN_CONTEXT}${rawIdempotencyKey}`, 'utf8')
      .digest()
  );

  return {
    rawToken,
    hash: hashGuestAccessToken(rawToken),
  };
};
