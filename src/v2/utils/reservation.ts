import {
  createHash,
  randomBytes,
  randomInt,
} from 'crypto';

import type {
  CustomerSnapshot,
} from '../types/domain';
import {
  getBusinessDateOnly,
} from './date-only';

const RESERVATION_SUFFIX_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const RESERVATION_SUFFIX_LENGTH = 6;
const GUEST_ACCESS_TOKEN_BYTES = 32;
export const PENDING_RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface GuestAccessToken {
  rawToken: string;
  hash: string;
}

const toBase64Url = (value: Buffer): string =>
  value
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

export const generateReservationNumber = (now: Date): string => {
  const businessDate = getBusinessDateOnly(now);
  const businessYear = businessDate.slice(0, 4);

  let suffix = '';

  for (let index = 0; index < RESERVATION_SUFFIX_LENGTH; index += 1) {
    suffix += RESERVATION_SUFFIX_ALPHABET[
      randomInt(RESERVATION_SUFFIX_ALPHABET.length)
    ];
  }

  return `AK-${businessYear}-${suffix}`;
};

export const hashGuestAccessToken = (rawToken: string): string =>
  createHash('sha256').update(rawToken, 'utf8').digest('hex');

export const generateGuestAccessToken = (): GuestAccessToken => {
  const rawToken = toBase64Url(randomBytes(GUEST_ACCESS_TOKEN_BYTES));

  return {
    rawToken,
    hash: hashGuestAccessToken(rawToken),
  };
};

export const calculatePendingExpiresAt = (now: Date): Date => {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date instant');
  }

  return new Date(now.getTime() + PENDING_RESERVATION_TTL_MS);
};

export const normalizeReservationCustomer = (
  customer: CustomerSnapshot
): CustomerSnapshot => ({
  firstName: customer.firstName.trim(),
  lastName: customer.lastName.trim(),
  email: customer.email.trim().toLowerCase(),
  phone: customer.phone.trim(),
});

export const normalizeReservationNotes = (
  notes: string | undefined
): string | undefined => {
  if (notes === undefined) {
    return undefined;
  }

  const normalized = notes.trim();
  return normalized.length > 0 ? normalized : undefined;
};
