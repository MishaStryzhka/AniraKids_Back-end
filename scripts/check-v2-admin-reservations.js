const { Types } = require('mongoose');

const {
  createV2Router,
} = require('../build/v2/routes');
const {
  ReservationV2Schema,
} = require('../build/v2/models/reservation-v2.model');
const {
  mapAdminApiError,
} = require('../build/v2/http/admin-error-mapper');
const {
  toAdminReservationCalendarEventDto,
  toAdminReservationDetailDto,
  toAdminReservationListItemDto,
} = require('../build/v2/http/admin-response');
const {
  validateCalendarReservationsAdminQuery,
  validateCancelReservationAdminBody,
  validateListReservationsAdminQuery,
  validateUpdateReservationNotesAdminBody,
} = require('../build/v2/schemas/admin-reservations.schema');
const {
  ReservationAdminError,
} = require('../build/v2/services/reservation-admin.types');
const {
  buildReservationAdminCalendarFilter,
  buildReservationAdminListFilter,
  escapeAdminReservationSearchRegex,
  getReservationOccupiedThrough,
  isPendingReservationExpired,
  isReservationAdminOperationAllowed,
  isReservationCalendarBlocking,
  parseReservationAdminDate,
} = require('../build/v2/services/reservation-admin.service');
const {
  parseDateOnly,
} = require('../build/v2/utils/date-only');

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertEqual = (actual, expected, message) => {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${expected}, received ${actual}`
    );
  }
};

const expectValidationFailure = (validator, input, label) => {
  const result = validator(input);
  assert(!result.value, `${label} must fail validation`);
};

const expectErrorCode = (fn, code, label) => {
  let error;

  try {
    fn();
  } catch (caught) {
    error = caught;
  }

  assert(error instanceof ReservationAdminError, `${label} error type`);
  assertEqual(error.code, code, `${label} code`);
};

const checkStatusMatrix = () => {
  const expectations = {
    pending: {
      confirm: true,
      prepare: false,
      rent: false,
      return: false,
      cancel: true,
    },
    confirmed: {
      confirm: true,
      prepare: true,
      rent: false,
      return: false,
      cancel: true,
    },
    prepared: {
      confirm: false,
      prepare: true,
      rent: true,
      return: false,
      cancel: true,
    },
    rented: {
      confirm: false,
      prepare: false,
      rent: true,
      return: true,
      cancel: false,
    },
    returned: {
      confirm: false,
      prepare: false,
      rent: false,
      return: true,
      cancel: false,
    },
    cancelled: {
      confirm: false,
      prepare: false,
      rent: false,
      return: false,
      cancel: true,
    },
  };

  for (const [status, operations] of Object.entries(expectations)) {
    for (const [operation, expected] of Object.entries(operations)) {
      assertEqual(
        isReservationAdminOperationAllowed(status, operation),
        expected,
        `${status} / ${operation}`
      );
    }
  }

  assert(
    !isReservationAdminOperationAllowed('returned', 'cancel'),
    'returned must be terminal against cancel'
  );
  assert(
    !isReservationAdminOperationAllowed('cancelled', 'confirm'),
    'cancelled must be terminal against confirm'
  );
};

const checkValidation = () => {
  const cancel = validateCancelReservationAdminBody({
    reason: '  Klient zrušil rezervaci  ',
  });

  assert(cancel.value, 'cancel reason must validate');
  assertEqual(
    cancel.value.reason,
    'Klient zrušil rezervaci',
    'cancel reason must be trimmed'
  );

  for (const input of [
    { reason: '' },
    { reason: '   ' },
    { reason: 'x'.repeat(501) },
    { reason: 'ok', status: 'cancelled' },
  ]) {
    expectValidationFailure(
      validateCancelReservationAdminBody,
      input,
      'invalid cancel body'
    );
  }

  assert(
    validateUpdateReservationNotesAdminBody({
      notes: '',
    }).value,
    'empty notes must be allowed'
  );

  assert(
    validateUpdateReservationNotesAdminBody({
      notes: 'Interní poznámka',
    }).value,
    'notes text must be allowed'
  );

  expectValidationFailure(
    validateUpdateReservationNotesAdminBody,
    { notes: 'x'.repeat(1501) },
    'notes over max'
  );

  for (const forbidden of [
    { notes: 'ok', status: 'confirmed' },
    { notes: 'ok', paymentStatus: 'paid' },
    { notes: 'ok', startDate: '2026-10-10' },
  ]) {
    expectValidationFailure(
      validateUpdateReservationNotesAdminBody,
      forbidden,
      'notes endpoint forbidden field'
    );
  }

  const list = validateListReservationsAdminQuery({
    status: 'confirmed',
    paymentStatus: 'unpaid',
    rentalMode: 'external',
    from: '2026-10-01',
    to: '2026-10-31',
    q: '  Novak  ',
    page: '2',
    limit: '50',
  });

  assert(list.value, 'valid list query');
  assertEqual(list.value.page, 2, 'list page');
  assertEqual(list.value.limit, 50, 'list limit');
  assertEqual(list.value.q, 'Novak', 'list search trim');

  const defaults = validateListReservationsAdminQuery({});
  assert(defaults.value, 'empty list query');
  assertEqual(defaults.value.page, 1, 'default page');
  assertEqual(defaults.value.limit, 20, 'default limit');

  expectValidationFailure(
    validateListReservationsAdminQuery,
    { limit: '101' },
    'list max limit'
  );
  expectValidationFailure(
    validateListReservationsAdminQuery,
    { unknown: 'x' },
    'list unknown query'
  );
  expectValidationFailure(
    validateListReservationsAdminQuery,
    { q: '   ' },
    'blank search'
  );

  assert(
    validateCalendarReservationsAdminQuery({
      from: '2026-10-01',
      to: '2026-10-31',
    }).value,
    'calendar query valid'
  );

  expectValidationFailure(
    validateCalendarReservationsAdminQuery,
    { from: '2026-10-01' },
    'calendar missing to'
  );
};

const checkDateFilters = () => {
  const from = parseReservationAdminDate('2026-10-10', 'from');
  assertEqual(
    from.toISOString(),
    '2026-10-10T00:00:00.000Z',
    'strict date parse'
  );

  expectErrorCode(
    () => parseReservationAdminDate('2026/10/10', 'from'),
    'INVALID_DATE',
    'slash date'
  );

  expectErrorCode(
    () => buildReservationAdminListFilter({
      from: '2026-10-20',
      to: '2026-10-10',
    }),
    'INVALID_DATE_RANGE',
    'reversed list range'
  );

  const filter = buildReservationAdminListFilter({
    status: 'confirmed',
    paymentStatus: 'unpaid',
    rentalMode: 'external',
    from: '2026-10-10',
    to: '2026-10-20',
  });

  assertEqual(filter.status, 'confirmed', 'status filter');
  assertEqual(filter.paymentStatus, 'unpaid', 'payment filter');
  assertEqual(filter.rentalMode, 'external', 'mode filter');
  assertEqual(
    filter.endDate.$gte.toISOString(),
    '2026-10-10T00:00:00.000Z',
    'from maps to endDate >= from'
  );
  assertEqual(
    filter.startDate.$lte.toISOString(),
    '2026-10-20T00:00:00.000Z',
    'to maps to startDate <= to'
  );

  const calendar = buildReservationAdminCalendarFilter(
    parseDateOnly('2026-10-10'),
    parseDateOnly('2026-10-20'),
    new Date('2026-10-01T12:00:00.000Z')
  );

  assertEqual(
    calendar.endDate.$gte.toISOString(),
    '2026-10-09T00:00:00.000Z',
    'calendar includes cleaning-buffer overlap'
  );
};

const checkSearchEscaping = () => {
  const raw = 'AK-2026-[A-Z].*+?';
  const escaped = escapeAdminReservationSearchRegex(raw);
  const regex = new RegExp(escaped, 'i');

  assert(regex.test(raw), 'escaped regex must match literal input');
  assert(
    !regex.test('AK-2026-ZZZ'),
    'escaped regex must not execute caller regex syntax'
  );

  const filter = buildReservationAdminListFilter({
    q: raw,
  });

  assert(Array.isArray(filter.$or), 'search must build safe OR query');
  assertEqual(filter.$or.length, 5, 'search field count');
};

const reservationFixture = (overrides = {}) => ({
  _id: new Types.ObjectId(),
  reservationNumber: 'AK-2026-ABC123',
  customerId: new Types.ObjectId(),
  guestAccessTokenHash: 'secret-token-hash',
  idempotencyKeyHash: 'a'.repeat(64),
  idempotencyRequestHash: 'b'.repeat(64),
  customerSnapshot: {
    firstName: 'Jan',
    lastName: 'Novák',
    email: 'jan@example.test',
    phone: '+420700000001',
  },
  items: [
    {
      productId: new Types.ObjectId(),
      variantId: new Types.ObjectId(),
      inventoryItemId: new Types.ObjectId(),
      productNameSnapshot: 'Sofia',
      sizeSnapshot: '116',
      rentalPriceSnapshot: 800,
      depositSnapshot: 1000,
    },
  ],
  rentalMode: 'external',
  startDate: parseDateOnly('2026-10-10'),
  endDate: parseDateOnly('2026-10-12'),
  status: 'pending',
  expiresAt: new Date('2026-10-01T12:00:00.000Z'),
  subtotal: 800,
  deposit: 1000,
  totalDue: 1800,
  paymentStatus: 'unpaid',
  fulfillmentMethod: 'pickup',
  notes: 'Interní',
  createdAt: new Date('2026-09-20T10:00:00.000Z'),
  updatedAt: new Date('2026-09-20T10:00:00.000Z'),
  ...overrides,
});

const checkDtoPrivacyAndDerivedState = () => {
  const now = new Date('2026-10-01T12:00:00.000Z');
  const fixture = reservationFixture();

  assertEqual(
    isPendingReservationExpired(fixture, now),
    true,
    'pending expiration boundary'
  );
  assertEqual(
    isPendingReservationExpired(
      {
        status: 'pending',
        expiresAt: new Date('2026-10-01T12:00:01.000Z'),
      },
      now
    ),
    false,
    'active pending'
  );

  const listDto = toAdminReservationListItemDto(fixture, now);
  assertEqual(listDto.pendingExpired, true, 'list pendingExpired');
  assertEqual(listDto.itemCount, 1, 'list item count');

  const inventoryId = fixture.items[0].inventoryItemId.toHexString();
  const detailDto = toAdminReservationDetailDto(
    {
      reservation: fixture,
      inventoryById: new Map([
        [
          inventoryId,
          {
            _id: fixture.items[0].inventoryItemId,
            internalCode: 'SOF-116-01',
            status: 'active',
            condition: 'good',
          },
        ],
      ]),
    },
    now
  );

  assertEqual(
    detailDto.items[0].inventoryCurrent.internalCode,
    'SOF-116-01',
    'detail current inventory metadata'
  );

  const serialized = JSON.stringify({
    listDto,
    detailDto,
  });

  for (const secret of [
    'secret-token-hash',
    'a'.repeat(64),
    'b'.repeat(64),
  ]) {
    assert(
      !serialized.includes(secret),
      'admin reservation DTO must hide token/hash fields'
    );
  }
};

const checkCalendarSemantics = () => {
  const now = new Date('2026-10-01T12:00:00.000Z');

  const cases = [
    ['confirmed', null, true],
    ['prepared', null, true],
    ['rented', null, true],
    ['returned', null, true],
    ['pending', new Date('2026-10-01T12:00:01.000Z'), true],
    ['pending', new Date('2026-10-01T12:00:00.000Z'), false],
    ['cancelled', null, false],
  ];

  for (const [status, expiresAt, expected] of cases) {
    assertEqual(
      isReservationCalendarBlocking({ status, expiresAt }, now),
      expected,
      `calendar blocking ${status}`
    );
  }

  assertEqual(
    getReservationOccupiedThrough(
      parseDateOnly('2026-10-12')
    ).toISOString(),
    '2026-10-13T00:00:00.000Z',
    'occupiedThrough cleaning day'
  );

  const event = toAdminReservationCalendarEventDto(
    reservationFixture({
      status: 'confirmed',
      expiresAt: null,
    })
  );

  assertEqual(event.endDate, '2026-10-12', 'calendar rental end');
  assertEqual(
    event.occupiedThrough,
    '2026-10-13',
    'calendar occupiedThrough'
  );
  assertEqual(event.customerName, 'Jan Novák', 'calendar customer name');
};

const checkErrorMapping = () => {
  const cases = [
    ['INVALID_DATE', 400],
    ['INVALID_DATE_RANGE', 400],
    ['VALIDATION_ERROR', 400],
    ['RESERVATION_NOT_FOUND', 404],
    ['INVALID_RESERVATION_TRANSITION', 409],
    ['RESERVATION_CONFIRMATION_CONFLICT', 409],
    ['RESERVATION_INVENTORY_NOT_ACTIVE', 409],
  ];

  for (const [code, status] of cases) {
    const mapped = mapAdminApiError(
      new ReservationAdminError(code, 'safe')
    );

    assertEqual(mapped.status, status, `${code} status`);
    assertEqual(mapped.body.error.code, code, `${code} code`);
  }
};

const checkRouteRegistration = () => {
  const registrations = [];
  const router = {
    get(path, ...handlers) {
      registrations.push({ method: 'GET', path, handlers });
      return this;
    },
    post(path, ...handlers) {
      registrations.push({ method: 'POST', path, handlers });
      return this;
    },
    patch(path, ...handlers) {
      registrations.push({ method: 'PATCH', path, handlers });
      return this;
    },
    delete(path, ...handlers) {
      registrations.push({ method: 'DELETE', path, handlers });
      return this;
    },
    use(...handlers) {
      registrations.push({ method: 'USE', path: null, handlers });
      return this;
    },
  };

  createV2Router(
    {
      Router: () => router,
    },
    {
      ensureMongoConnection: (_request, _response, next) => next(),
    }
  );

  const expected = [
    ['GET', '/admin/reservations'],
    ['GET', '/admin/reservations/calendar'],
    ['GET', '/admin/reservations/:reservationId'],
    ['PATCH', '/admin/reservations/:reservationId/notes'],
    ['POST', '/admin/reservations/:reservationId/confirm'],
    ['POST', '/admin/reservations/:reservationId/prepare'],
    ['POST', '/admin/reservations/:reservationId/rent'],
    ['POST', '/admin/reservations/:reservationId/return'],
    ['POST', '/admin/reservations/:reservationId/cancel'],
  ];

  for (const [method, path] of expected) {
    assert(
      registrations.some(
        registration =>
          registration.method === method &&
          registration.path === path
      ),
      `admin reservation route missing: ${method} ${path}`
    );
  }

  assert(
    !registrations.some(
      registration =>
        registration.method === 'PATCH' &&
        registration.path === '/admin/reservations/:reservationId'
    ),
    'generic reservation PATCH must not exist'
  );
};

const checkIndexDefinitions = () => {
  const indexes = ReservationV2Schema.indexes();

  assert(
    indexes.some(
      ([key, options]) =>
        key.status === 1 &&
        key.createdAt === -1 &&
        options.name === 'idx_v2_reservation_admin_status_created'
    ),
    'admin status/createdAt index definition'
  );

  assert(
    indexes.some(
      ([key, options]) =>
        key.status === 1 &&
        key.startDate === 1 &&
        key.endDate === 1 &&
        options.name === 'idx_v2_reservation_admin_calendar'
    ),
    'admin calendar index definition'
  );
};

const main = () => {
  checkStatusMatrix();
  checkValidation();
  checkDateFilters();
  checkSearchEscaping();
  checkDtoPrivacyAndDerivedState();
  checkCalendarSemantics();
  checkErrorMapping();
  checkRouteRegistration();
  checkIndexDefinitions();

  console.log('Phase 1H.6 admin reservations pure checks passed');
};

main();
