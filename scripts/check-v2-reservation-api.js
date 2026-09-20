const { Types } = require('mongoose');

const {
  createV2Router,
} = require('../build/v2/routes');
const {
  mapReservationApiError,
} = require('../build/v2/http/error-mapper');
const {
  toPublicCreateReservationResponse,
} = require('../build/v2/http/reservation-response');
const {
  normalizeReservationEmail,
  parseOptionalBearerAuthorization,
  rejectMalformedOptionalAuthorization,
  reservationApiEnabled,
} = require('../build/v2/middleware/reservation.middleware');
const {
  validateReservationRequestBody,
} = require('../build/v2/schemas/reservation.schema');
const {
  ReservationServiceError,
} = require('../build/v2/services/reservation.types');
const {
  ConcurrencyError,
} = require('../build/v2/services/concurrency.types');

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertEqual = (actual, expected, message) => {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
};

const validBody = () => ({
  productId: new Types.ObjectId().toString(),
  variantId: new Types.ObjectId().toString(),
  rentalMode: 'external',
  startDate: '2027-10-10',
  endDate: '2027-10-12',
  customer: {
    firstName: 'Anna',
    lastName: 'Nováková',
    email: 'anna@example.cz',
    phone: '+420 777 123 456',
  },
  notes: 'Prosím zavolat.',
});

const expectValidationFailure = (body, label) => {
  const result = validateReservationRequestBody(body);
  assert(!result.value, `${label} must fail validation`);
  assert(result.errorMessage, `${label} must return validation message`);
};

const checkSchema = () => {
  assert(validateReservationRequestBody(validBody()).value, 'valid body');

  expectValidationFailure(
    {
      ...validBody(),
      unexpected: true,
    },
    'unknown top-level field'
  );

  expectValidationFailure(
    {
      ...validBody(),
      customer: {
        ...validBody().customer,
        customerId: new Types.ObjectId().toString(),
      },
    },
    'unknown customer field'
  );

  for (const field of [
    'inventoryItemId',
    'subtotal',
    'price',
    'status',
    'expiresAt',
    'paymentStatus',
    'fulfillmentMethod',
    'guestAccessToken',
    'guestAccessTokenHash',
  ]) {
    expectValidationFailure(
      {
        ...validBody(),
        [field]: field === 'subtotal' || field === 'price' ? 1 : 'injected',
      },
      `trusted field ${field}`
    );
  }

  expectValidationFailure(
    {
      ...validBody(),
      productId: 'not-an-object-id',
    },
    'invalid productId'
  );

  expectValidationFailure(
    {
      ...validBody(),
      rentalMode: 'delivery',
    },
    'invalid rentalMode'
  );

  expectValidationFailure(
    {
      ...validBody(),
      startDate: '2027-1-1',
    },
    'malformed date shape'
  );

  expectValidationFailure(
    {
      ...validBody(),
      customer: {
        ...validBody().customer,
        firstName: 123,
      },
    },
    'string coercion must remain disabled'
  );
};

const checkResponseMapper = () => {
  const productId = new Types.ObjectId();
  const variantId = new Types.ObjectId();
  const inventoryItemId = new Types.ObjectId();

  const guest = toPublicCreateReservationResponse({
    reservation: {
      _id: new Types.ObjectId(),
      reservationNumber: 'AK-2027-ABC123',
      customerSnapshot: {
        firstName: 'Anna',
        lastName: 'Nováková',
        email: 'anna@example.cz',
        phone: '+420777123456',
      },
      items: [{
        productId,
        variantId,
        inventoryItemId,
        productNameSnapshot: 'Dress',
        sizeSnapshot: '116',
        rentalPriceSnapshot: 800,
        depositSnapshot: 1000,
      }],
      rentalMode: 'external',
      startDate: new Date('2027-10-10T00:00:00.000Z'),
      endDate: new Date('2027-10-12T00:00:00.000Z'),
      status: 'pending',
      expiresAt: new Date('2027-10-01T12:00:00.000Z'),
      subtotal: 800,
      deposit: 1000,
      totalDue: 1800,
      fulfillmentMethod: 'pickup',
      paymentStatus: 'unpaid',
      notes: 'internal-to-response',
    },
    guestAccessToken: 'raw-guest-token',
  });

  assertEqual(guest.reservation.startDate, '2027-10-10', 'public startDate');
  assertEqual(guest.reservation.endDate, '2027-10-12', 'public endDate');
  assertEqual(guest.guestAccessToken, 'raw-guest-token', 'guest token response');
  assertEqual(guest.reservation.item.productId, productId.toString(), 'public productId');
  assertEqual(guest.reservation.item.variantId, variantId.toString(), 'public variantId');

  const serialized = JSON.stringify(guest);
  assert(!serialized.includes(inventoryItemId.toString()), 'inventoryItemId must stay hidden');
  assert(!serialized.includes('guestAccessTokenHash'), 'guestAccessTokenHash must stay hidden');
  assert(!serialized.includes('customerId'), 'customerId must stay hidden');
  assert(!serialized.includes('internal-to-response'), 'notes must stay hidden');
  assert(!serialized.includes('"_id"'), '_id must stay hidden');

  const authenticated = toPublicCreateReservationResponse({
    reservation: {
      _id: new Types.ObjectId(),
      reservationNumber: 'AK-2027-DEF456',
      customerId: new Types.ObjectId(),
      customerSnapshot: {
        firstName: 'Anna',
        lastName: 'Nováková',
        email: 'anna@example.cz',
        phone: '+420777123456',
      },
      items: [{
        productId,
        variantId,
        inventoryItemId,
        productNameSnapshot: 'Dress',
        sizeSnapshot: '116',
        rentalPriceSnapshot: 800,
        depositSnapshot: 1000,
      }],
      rentalMode: 'studio',
      startDate: new Date('2027-11-10T00:00:00.000Z'),
      endDate: new Date('2027-11-10T00:00:00.000Z'),
      status: 'pending',
      expiresAt: new Date('2027-11-01T12:00:00.000Z'),
      subtotal: 800,
      deposit: 1000,
      totalDue: 1800,
      paymentStatus: 'unpaid',
    },
  });

  assertEqual(
    authenticated.guestAccessToken,
    undefined,
    'authenticated response must omit guest token'
  );
};

const checkErrorMapping = () => {
  const cases = [
    [new ReservationServiceError('INVALID_DATE', 'x'), 400, 'INVALID_DATE'],
    [new ReservationServiceError('PAST_START_DATE', 'x'), 400, 'PAST_START_DATE'],
    [new ReservationServiceError('VARIANT_PRODUCT_MISMATCH', 'x'), 400, 'VARIANT_PRODUCT_MISMATCH'],
    [new ReservationServiceError('PRODUCT_NOT_FOUND', 'x'), 404, 'PRODUCT_NOT_FOUND'],
    [new ReservationServiceError('VARIANT_NOT_FOUND', 'x'), 404, 'VARIANT_NOT_FOUND'],
    [new ReservationServiceError('PRODUCT_NOT_RENTABLE', 'x'), 409, 'PRODUCT_NOT_RENTABLE'],
    [new ReservationServiceError('VARIANT_NOT_ACTIVE', 'x'), 409, 'VARIANT_NOT_ACTIVE'],
    [new ReservationServiceError('NO_AVAILABLE_INVENTORY', 'x'), 409, 'NO_AVAILABLE_INVENTORY'],
    [new ReservationServiceError('RESERVATION_NUMBER_GENERATION_FAILED', 'x'), 500, 'INTERNAL_ERROR'],
    [new ConcurrencyError('INVENTORY_ITEM_NOT_AVAILABLE', 'x'), 409, 'INVENTORY_ITEM_NOT_AVAILABLE'],
    [new Error('sensitive'), 500, 'INTERNAL_ERROR'],
  ];

  for (const [error, status, code] of cases) {
    const result = mapReservationApiError(error);
    assertEqual(result.status, status, `error status ${code}`);
    assertEqual(result.body.error.code, code, `error code ${code}`);
    assert(
      !JSON.stringify(result.body).includes('sensitive'),
      'unexpected error details must stay hidden'
    );
  }
};

const createFakeResponse = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return body;
  },
});

const checkOptionalAuthAndFeatureFlag = () => {
  assertEqual(
    normalizeReservationEmail('  ANNA@EXAMPLE.CZ  '),
    'anna@example.cz',
    'active pending email normalization must trim and lowercase'
  );
  assertEqual(
    parseOptionalBearerAuthorization(undefined).kind,
    'guest',
    'missing authorization must be guest'
  );
  assertEqual(
    parseOptionalBearerAuthorization('Bearer valid-token').kind,
    'bearer',
    'valid Bearer shape'
  );
  assertEqual(
    parseOptionalBearerAuthorization('Bearer').kind,
    'invalid',
    'malformed Bearer'
  );
  assertEqual(
    parseOptionalBearerAuthorization('Basic abc').kind,
    'invalid',
    'wrong auth scheme'
  );

  let nextCount = 0;
  const guestResponse = createFakeResponse();
  rejectMalformedOptionalAuthorization(
    { body: {}, headers: {} },
    guestResponse,
    () => {
      nextCount += 1;
    }
  );
  assertEqual(nextCount, 1, 'missing authorization middleware guest path');

  const malformedResponse = createFakeResponse();
  rejectMalformedOptionalAuthorization(
    { body: {}, headers: { authorization: 'Bearer' } },
    malformedResponse,
    () => {
      throw new Error('malformed auth must not call next');
    }
  );
  assertEqual(malformedResponse.statusCode, 401, 'malformed auth status');
  assertEqual(malformedResponse.body.error.code, 'UNAUTHORIZED', 'malformed auth code');

  const originalFlag = process.env.V2_RESERVATION_API_ENABLED;
  delete process.env.V2_RESERVATION_API_ENABLED;

  const disabledResponse = createFakeResponse();
  reservationApiEnabled(
    { body: {}, headers: {} },
    disabledResponse,
    () => {
      throw new Error('disabled API must not call next');
    }
  );

  assertEqual(disabledResponse.statusCode, 503, 'feature flag disabled status');
  assertEqual(
    disabledResponse.body.error.code,
    'RESERVATION_API_DISABLED',
    'feature flag disabled code'
  );

  process.env.V2_RESERVATION_API_ENABLED = 'true';
  let enabledNext = 0;
  reservationApiEnabled(
    { body: {}, headers: {} },
    createFakeResponse(),
    () => {
      enabledNext += 1;
    }
  );
  assertEqual(enabledNext, 1, 'feature flag enabled path');

  if (originalFlag === undefined) {
    delete process.env.V2_RESERVATION_API_ENABLED;
  } else {
    process.env.V2_RESERVATION_API_ENABLED = originalFlag;
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

  const health = registrations.find(
    item => item.method === 'GET' && item.path === '/health'
  );
  const reservation = registrations.find(
    item => item.method === 'POST' && item.path === '/reservations'
  );

  assert(health, 'health route must remain registered');
  assert(reservation, 'reservation POST route must be registered');
  assertEqual(reservation.handlers.length, 10, 'reservation middleware chain length');
};

const main = () => {
  checkSchema();
  checkResponseMapper();
  checkErrorMapping();
  checkOptionalAuthAndFeatureFlag();
  checkRouteRegistration();

  console.log('Phase 1G reservation API checks passed');
};

main();
