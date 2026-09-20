import type { Types } from 'mongoose';

import {
  formatDateOnly,
} from '../utils/date-only';
import {
  getReservationOccupiedThrough,
  isPendingReservationExpired,
} from '../services/reservation-admin.service';

const toPlainObject = (
  input: unknown
): Record<string, unknown> => {
  if (
    typeof input === 'object' &&
    input !== null &&
    'toObject' in input &&
    typeof (input as { toObject?: unknown }).toObject === 'function'
  ) {
    return (input as { toObject(): Record<string, unknown> }).toObject();
  }

  if (typeof input === 'object' && input !== null) {
    return input as Record<string, unknown>;
  }

  throw new Error('Admin DTO source must be an object');
};

const toId = (value: unknown): string => {
  if (
    typeof value === 'object' &&
    value !== null &&
    'toString' in value &&
    typeof (value as { toString?: unknown }).toString === 'function'
  ) {
    return (value as { toString(): string }).toString();
  }

  return String(value);
};

const copyDefined = (
  source: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  for (const key of keys) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }

  return result;
};

export const toAdminProductDto = (input: unknown) => {
  const source = toPlainObject(input);

  return {
    id: toId(source._id),
    ...copyDefined(source, [
      'name',
      'slug',
      'description',
      'category',
      'gender',
      'color',
      'occasion',
      'ageTags',
      'brand',
      'familyLookGroup',
      'rentalEnabled',
      'saleEnabled',
      'rentalPrices',
      'defaultSalePrice',
      'defaultDeposit',
      'photos',
      'status',
      'seo',
      'createdAt',
      'updatedAt',
    ]),
  };
};

export const toAdminVariantDto = (input: unknown) => {
  const source = toPlainObject(input);

  return {
    id: toId(source._id),
    productId: toId(source.productId),
    ...copyDefined(source, [
      'size',
      'sku',
      'rentalPriceOverrides',
      'salePriceOverride',
      'depositOverride',
      'status',
      'sortOrder',
      'createdAt',
      'updatedAt',
    ]),
  };
};

export const toAdminInventoryItemDto = (input: unknown) => {
  const source = toPlainObject(input);

  return {
    id: toId(source._id),
    variantId: toId(source.variantId),
    ...copyDefined(source, [
      'internalCode',
      'status',
      'condition',
      'notes',
      'acquiredAt',
      'retiredAt',
      'createdAt',
      'updatedAt',
    ]),
  };
};

export const toAdminProductDetailDto = (input: {
  product: unknown;
  variants: Array<{
    variant: unknown;
    inventory: unknown[];
  }>;
}) => ({
  product: toAdminProductDto(input.product),
  variants: input.variants.map(item => ({
    ...toAdminVariantDto(item.variant),
    inventory: item.inventory.map(toAdminInventoryItemDto),
  })),
});

export const toAdminProductListDto = (input: {
  items: unknown[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}) => ({
  items: input.items.map(toAdminProductDto),
  pagination: input.pagination,
});


export const toAdminAvailabilityBlockDto = (input: unknown) => {
  const source = toPlainObject(input);

  if (!(source.startDate instanceof Date) || !(source.endDate instanceof Date)) {
    throw new Error('Availability block dates must be Date values');
  }

  return {
    id: toId(source._id),
    inventoryItemId: toId(source.inventoryItemId),
    startDate: formatDateOnly(source.startDate),
    endDate: formatDateOnly(source.endDate),
    reason: source.reason,
    ...(source.notes === undefined ? {} : { notes: source.notes }),
    createdBy: toId(source.createdBy),
    createdAt: source.createdAt,
  };
};


const toAdminCustomerSnapshot = (
  input: unknown
): Record<string, unknown> => {
  const source = toPlainObject(input);

  return copyDefined(source, [
    'firstName',
    'lastName',
    'email',
    'phone',
  ]);
};

const toAdminReservationItemSnapshot = (
  input: unknown,
  inventoryById?: Map<string, unknown>
) => {
  const source = toPlainObject(input);
  const inventoryItemId = toId(source.inventoryItemId);
  const currentInventory = inventoryById?.get(inventoryItemId);

  return {
    productId: toId(source.productId),
    variantId: toId(source.variantId),
    inventoryItemId,
    ...copyDefined(source, [
      'productNameSnapshot',
      'sizeSnapshot',
      'rentalPriceSnapshot',
      'depositSnapshot',
    ]),
    ...(inventoryById === undefined
      ? {}
      : {
          inventoryCurrent:
            currentInventory === undefined
              ? null
              : copyDefined(
                  toPlainObject(currentInventory),
                  ['internalCode', 'status', 'condition']
                ),
        }),
  };
};

export const toAdminReservationListItemDto = (
  input: unknown,
  now: Date
) => {
  const source = toPlainObject(input);

  if (!(source.startDate instanceof Date) || !(source.endDate instanceof Date)) {
    throw new Error('Reservation dates must be Date values');
  }

  const expiresAt =
    source.expiresAt instanceof Date ? source.expiresAt : null;
  const items = Array.isArray(source.items) ? source.items : [];

  return {
    id: toId(source._id),
    reservationNumber: source.reservationNumber,
    status: source.status,
    paymentStatus: source.paymentStatus,
    rentalMode: source.rentalMode,
    startDate: formatDateOnly(source.startDate),
    endDate: formatDateOnly(source.endDate),
    ...(expiresAt === null ? {} : { expiresAt }),
    pendingExpired: isPendingReservationExpired(
      {
        status: source.status as any,
        expiresAt,
      },
      now
    ),
    customer: toAdminCustomerSnapshot(source.customerSnapshot),
    itemCount: items.length,
    subtotal: source.subtotal,
    deposit: source.deposit,
    totalDue: source.totalDue,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
};

export const toAdminReservationListDto = (input: {
  items: unknown[];
  now: Date;
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}) => ({
  items: input.items.map(item =>
    toAdminReservationListItemDto(item, input.now)
  ),
  pagination: input.pagination,
});

export const toAdminReservationDetailDto = (
  input: {
    reservation: unknown;
    inventoryById: Map<string, unknown>;
  },
  now: Date = new Date()
) => {
  const source = toPlainObject(input.reservation);

  if (!(source.startDate instanceof Date) || !(source.endDate instanceof Date)) {
    throw new Error('Reservation dates must be Date values');
  }

  const expiresAt =
    source.expiresAt instanceof Date ? source.expiresAt : null;
  const items = Array.isArray(source.items) ? source.items : [];

  return {
    id: toId(source._id),
    reservationNumber: source.reservationNumber,
    ...(source.customerId === undefined
      ? {}
      : { customerId: toId(source.customerId) }),
    customerSnapshot: toAdminCustomerSnapshot(source.customerSnapshot),
    items: items.map(item =>
      toAdminReservationItemSnapshot(item, input.inventoryById)
    ),
    rentalMode: source.rentalMode,
    startDate: formatDateOnly(source.startDate),
    endDate: formatDateOnly(source.endDate),
    status: source.status,
    expiresAt,
    pendingExpired: isPendingReservationExpired(
      {
        status: source.status as any,
        expiresAt,
      },
      now
    ),
    paymentStatus: source.paymentStatus,
    subtotal: source.subtotal,
    deposit: source.deposit,
    totalDue: source.totalDue,
    ...copyDefined(source, [
      'fulfillmentMethod',
      'notes',
      'cancelledAt',
      'cancellationReason',
      'createdAt',
      'updatedAt',
    ]),
  };
};

export const toAdminReservationOperationDto = (
  input: unknown,
  now: Date = new Date()
) => {
  const source = toPlainObject(input);
  const expiresAt =
    source.expiresAt instanceof Date ? source.expiresAt : null;

  return {
    id: toId(source._id),
    reservationNumber: source.reservationNumber,
    status: source.status,
    paymentStatus: source.paymentStatus,
    ...(expiresAt === null ? {} : { expiresAt }),
    pendingExpired: isPendingReservationExpired(
      {
        status: source.status as any,
        expiresAt,
      },
      now
    ),
    ...copyDefined(source, [
      'notes',
      'cancelledAt',
      'cancellationReason',
      'updatedAt',
    ]),
  };
};

export const toAdminReservationCalendarEventDto = (
  input: unknown
) => {
  const source = toPlainObject(input);

  if (!(source.startDate instanceof Date) || !(source.endDate instanceof Date)) {
    throw new Error('Reservation dates must be Date values');
  }

  const customer = toPlainObject(source.customerSnapshot);
  const items = Array.isArray(source.items) ? source.items : [];
  const occupiedThrough = getReservationOccupiedThrough(source.endDate);

  return {
    id: toId(source._id),
    reservationNumber: source.reservationNumber,
    status: source.status,
    rentalMode: source.rentalMode,
    startDate: formatDateOnly(source.startDate),
    endDate: formatDateOnly(source.endDate),
    occupiedThrough: formatDateOnly(occupiedThrough),
    customerName: [customer.firstName, customer.lastName]
      .filter(value => typeof value === 'string' && value.length > 0)
      .join(' '),
    items: items.map(item => {
      const snapshot = toPlainObject(item);

      return {
        inventoryItemId: toId(snapshot.inventoryItemId),
        productName: snapshot.productNameSnapshot,
        size: snapshot.sizeSnapshot,
      };
    }),
    ...(source.expiresAt instanceof Date
      ? { expiresAt: source.expiresAt }
      : {}),
  };
};

export const toAdminReservationCalendarDto = (input: {
  items: unknown[];
}) => ({
  items: input.items.map(toAdminReservationCalendarEventDto),
});
