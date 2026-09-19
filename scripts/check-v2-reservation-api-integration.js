const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { Types } = mongoose;

const {
  InventoryItemV2Model,
  ProductV2Model,
  ReservationV2Model,
  VariantV2Model,
} = require('../build/v2/models');
const {
  createV2Router,
} = require('../build/v2/routes');
const {
  addCalendarDays,
  formatDateOnly,
  getBusinessDateOnly,
  parseDateOnly,
} = require('../build/v2/utils/date-only');
const {
  hashGuestAccessToken,
} = require('../build/v2/utils/reservation');
const LegacyUserModel = require('../models/user');

const testUri = process.env.TEST_MONGODB_URI;

if (!testUri) {
  throw new Error(
    'TEST_MONGODB_URI is required for Phase 1G reservation API integration checks'
  );
}

if (process.env.MONGODB_URI && testUri === process.env.MONGODB_URI) {
  throw new Error('Refusing to run: TEST_MONGODB_URI matches MONGODB_URI');
}

const getExplicitDatabaseName = uri => {
  const parsed = new URL(uri);
  return decodeURIComponent(parsed.pathname.replace(/^\//, ''));
};

const databaseName = getExplicitDatabaseName(testUri);

if (
  !databaseName ||
  !/(test|testing|ci|dev)/i.test(databaseName) ||
  /(prod|production)/i.test(databaseName)
) {
  throw new Error(
    'TEST_MONGODB_URI must contain an explicit non-production database name with test/testing/ci/dev'
  );
}

if (!process.env.SECRET_KEY) {
  throw new Error(
    'SECRET_KEY is required for authenticated Phase 1G integration checks'
  );
}

mongoose.set('strictQuery', true);
mongoose.set('autoIndex', false);

const created = {
  products: [],
  variants: [],
  inventoryItems: [],
  reservations: [],
  users: [],
};

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

const createProduct = async (overrides = {}) => {
  const product = await ProductV2Model.create({
    name: 'Phase 1G Test Dress',
    slug: `phase-1g-${new Types.ObjectId().toString()}`,
    description: 'Disposable Phase 1G integration test product.',
    category: 'dress',
    gender: 'girls',
    color: 'white',
    rentalEnabled: true,
    saleEnabled: false,
    rentalPrices: {
      studio: 600,
      external: 800,
    },
    defaultDeposit: 1000,
    photos: [],
    status: 'active',
    seo: {
      noIndex: true,
    },
    ...overrides,
  });

  created.products.push(product._id);
  return product;
};

const createVariant = async (productId, overrides = {}) => {
  const variant = await VariantV2Model.create({
    productId,
    size: `S-${new Types.ObjectId().toString().slice(-6)}`,
    status: 'active',
    sortOrder: 0,
    ...overrides,
  });

  created.variants.push(variant._id);
  return variant;
};

const createItem = async (variantId, prefix = 'API', overrides = {}) => {
  const item = await InventoryItemV2Model.create({
    variantId,
    internalCode: `${prefix}-${new Types.ObjectId().toString().slice(-10)}`,
    status: 'active',
    condition: 'good',
    ...overrides,
  });

  created.inventoryItems.push(item._id);
  return item;
};

const createFixture = async (prefix = 'API') => {
  const product = await createProduct();
  const variant = await createVariant(product._id);
  const item = await createItem(variant._id, prefix);

  return {
    product,
    variant,
    item,
  };
};

const requestBody = ({
  product,
  variant,
  startDate = '2027-06-10',
  endDate = startDate,
  rentalMode = 'external',
  email = 'api-guest@example.cz',
  notes,
}) => {
  const body = {
    productId: product._id.toString(),
    variantId: variant._id.toString(),
    rentalMode,
    startDate,
    endDate,
    customer: {
      firstName: 'Anna',
      lastName: 'Nováková',
      email,
      phone: '+420 777 123 456',
    },
  };

  if (notes !== undefined) {
    body.notes = notes;
  }

  return body;
};

const createCapturedRoute = () => {
  let postHandlers;
  let errorHandler;

  const router = {
    get() {
      return this;
    },
    post(path, ...handlers) {
      if (path === '/reservations') {
        postHandlers = handlers;
      }
      return this;
    },
    use(...handlers) {
      errorHandler = handlers[handlers.length - 1];
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

  assert(postHandlers, 'POST /reservations handler chain must be registered');
  assert(errorHandler, 'v2 reservation error handler must be registered');

  return {
    postHandlers,
    errorHandler,
  };
};

const route = createCapturedRoute();

const createFakeResponse = () => ({
  statusCode: 200,
  body: undefined,
  finished: false,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    this.finished = true;
    return body;
  },
});

const invokeReservationApi = async ({
  body,
  authorization,
}) => {
  const request = {
    body,
    headers: authorization
      ? {
          authorization,
        }
      : {},
  };
  const response = createFakeResponse();

  const dispatch = async (index, error) => {
    if (error !== undefined) {
      await route.errorHandler(
        error,
        request,
        response,
        () => undefined
      );
      return;
    }

    if (response.finished) {
      return;
    }

    const handler = route.postHandlers[index];

    if (!handler) {
      return;
    }

    let nextPromise;

    const next = nextError => {
      nextPromise = dispatch(index + 1, nextError);
      return nextPromise;
    };

    const returned = handler(request, response, next);

    if (returned && typeof returned.then === 'function') {
      await returned;
    }

    if (nextPromise) {
      await nextPromise;
    }
  };

  await dispatch(0);

  return {
    request,
    response,
  };
};

const trackStoredApiReservation = async response => {
  assertEqual(response.statusCode, 201, 'API response must be 201 before tracking');
  const reservationNumber = response.body.reservation.reservationNumber;

  const stored = await ReservationV2Model.findOne({
    reservationNumber,
  })
    .select('+guestAccessTokenHash')
    .exec();

  assert(stored, 'API-created reservation must exist in DB');
  created.reservations.push(stored._id);
  return stored;
};

const countReservations = async () =>
  ReservationV2Model.countDocuments({
    _id: {
      $in: created.reservations,
    },
  });

const assertPublicDtoSanitized = response => {
  const serialized = JSON.stringify(response.body);

  assert(!serialized.includes('inventoryItemId'), 'public DTO must hide inventoryItemId');
  assert(!serialized.includes('guestAccessTokenHash'), 'public DTO must hide guestAccessTokenHash');
  assert(!serialized.includes('customerId'), 'public DTO must hide customerId');
  assert(!serialized.includes('internalCode'), 'public DTO must hide internalCode');
  assert(!serialized.includes('bookingRevision'), 'public DTO must hide bookingRevision');
  assert(!serialized.includes('"_id"'), 'public DTO must hide _id');
};

const createDirectPending = async ({
  email,
  expiresAt,
}) => {
  const id = new Types.ObjectId();
  const reservation = await ReservationV2Model.create({
    reservationNumber: `AK-2028-${id.toString().slice(-6).toUpperCase()}`,
    customerSnapshot: {
      firstName: 'Pending',
      lastName: 'Guard',
      email,
      phone: '+420700000000',
    },
    items: [{
      productId: new Types.ObjectId(),
      variantId: new Types.ObjectId(),
      inventoryItemId: new Types.ObjectId(),
      productNameSnapshot: 'Guard fixture',
      sizeSnapshot: '116',
      rentalPriceSnapshot: 800,
      depositSnapshot: 1000,
    }],
    rentalMode: 'external',
    startDate: parseDateOnly('2028-01-10'),
    endDate: parseDateOnly('2028-01-10'),
    status: 'pending',
    expiresAt,
    subtotal: 800,
    deposit: 1000,
    totalDue: 1800,
    fulfillmentMethod: 'pickup',
    paymentStatus: 'unpaid',
  });

  created.reservations.push(reservation._id);
  return reservation;
};

const assertReservationNumberIndex = async () => {
  const indexes = await ReservationV2Model.collection.indexes();
  const index = indexes.find(
    candidate => candidate.name === 'uniq_v2_reservation_number'
  );

  assert(index, 'test DB must have uniq_v2_reservation_number index');
  assertEqual(index.unique, true, 'reservation number index must be unique');
  assertEqual(
    index.key?.reservationNumber,
    1,
    'reservation number index key'
  );

  console.log('Phase 1G test DB reservationNumber index verified', {
    name: index.name,
    unique: index.unique,
  });
};

const checkGuestValidRequest = async () => {
  const fixture = await createFixture('GUEST');

  const { response } = await invokeReservationApi({
    body: requestBody({
      ...fixture,
      startDate: '2027-06-10',
      endDate: '2027-06-12',
      email: 'Guest.API@Example.CZ',
      notes: '  Prosím zavolat.  ',
    }),
  });

  assertEqual(response.statusCode, 201, 'guest create status');
  assertPublicDtoSanitized(response);
  assert(response.body.guestAccessToken, 'guest response must contain raw access token');
  assertEqual(response.body.reservation.startDate, '2027-06-10', 'date-only response start');
  assertEqual(response.body.reservation.endDate, '2027-06-12', 'date-only response end');
  assertEqual(response.body.reservation.subtotal, 800, 'guest flat subtotal');

  const stored = await trackStoredApiReservation(response);

  assertEqual(
    stored.items[0].inventoryItemId.toString(),
    fixture.item._id.toString(),
    'guest DB physical item'
  );
  assertEqual(stored.customerSnapshot.email, 'guest.api@example.cz', 'guest normalized DB email');
  assert(stored.guestAccessTokenHash, 'guest hash stored');
  assertEqual(
    stored.guestAccessTokenHash,
    hashGuestAccessToken(response.body.guestAccessToken),
    'guest returned token must match stored hash'
  );
  assert(
    !JSON.stringify(stored.toObject()).includes(response.body.guestAccessToken),
    'raw guest token must not be stored'
  );
};

const checkTrustedFieldInjection = async () => {
  const fixture = await createFixture('INJECT');
  const before = await ReservationV2Model.countDocuments({
    'items.variantId': fixture.variant._id,
  });

  const body = {
    ...requestBody({
      ...fixture,
      startDate: '2027-06-20',
    }),
    inventoryItemId: fixture.item._id.toString(),
    subtotal: 1,
    status: 'confirmed',
  };

  const { response } = await invokeReservationApi({
    body,
  });

  assertEqual(response.statusCode, 400, 'trusted field injection status');
  assertEqual(response.body.error.code, 'VALIDATION_ERROR', 'trusted field injection code');

  const after = await ReservationV2Model.countDocuments({
    'items.variantId': fixture.variant._id,
  });
  assertEqual(after, before, 'trusted field injection must not write reservation');
};

const checkInvalidAndPastDate = async () => {
  const fixture = await createFixture('DATE');

  const invalid = await invokeReservationApi({
    body: requestBody({
      ...fixture,
      startDate: '2027-02-30',
      endDate: '2027-02-30',
    }),
  });

  assertEqual(invalid.response.statusCode, 400, 'invalid calendar date status');
  assertEqual(invalid.response.body.error.code, 'INVALID_DATE', 'invalid calendar date code');

  const today = parseDateOnly(getBusinessDateOnly(new Date()));
  const yesterday = formatDateOnly(addCalendarDays(today, -1));

  const past = await invokeReservationApi({
    body: requestBody({
      ...fixture,
      startDate: yesterday,
      endDate: yesterday,
    }),
  });

  assertEqual(past.response.statusCode, 400, 'past date status');
  assertEqual(past.response.body.error.code, 'PAST_START_DATE', 'past date code');
};

const checkNoInventory = async () => {
  const product = await createProduct();
  const variant = await createVariant(product._id);

  const { response } = await invokeReservationApi({
    body: requestBody({
      product,
      variant,
      startDate: '2027-07-10',
    }),
  });

  assertEqual(response.statusCode, 409, 'no inventory status');
  assertEqual(response.body.error.code, 'NO_AVAILABLE_INVENTORY', 'no inventory code');
};

const checkNotFoundAndMismatch = async () => {
  const randomProduct = {
    _id: new Types.ObjectId(),
  };
  const randomVariant = {
    _id: new Types.ObjectId(),
  };

  const missingProduct = await invokeReservationApi({
    body: requestBody({
      product: randomProduct,
      variant: randomVariant,
      startDate: '2027-07-20',
    }),
  });

  assertEqual(missingProduct.response.statusCode, 404, 'missing product status');
  assertEqual(missingProduct.response.body.error.code, 'PRODUCT_NOT_FOUND', 'missing product code');

  const product = await createProduct();

  const missingVariant = await invokeReservationApi({
    body: requestBody({
      product,
      variant: randomVariant,
      startDate: '2027-07-21',
    }),
  });

  assertEqual(missingVariant.response.statusCode, 404, 'missing variant status');
  assertEqual(missingVariant.response.body.error.code, 'VARIANT_NOT_FOUND', 'missing variant code');

  const productA = await createProduct();
  const productB = await createProduct();
  const variantB = await createVariant(productB._id);
  await createItem(variantB._id, 'MISMATCH');

  const mismatch = await invokeReservationApi({
    body: requestBody({
      product: productA,
      variant: variantB,
      startDate: '2027-07-22',
    }),
  });

  assertEqual(mismatch.response.statusCode, 400, 'variant/product mismatch status');
  assertEqual(
    mismatch.response.body.error.code,
    'VARIANT_PRODUCT_MISMATCH',
    'variant/product mismatch code'
  );
};

const checkInvalidBearerDoesNotFallback = async () => {
  const fixture = await createFixture('BADAUTH');
  const before = await ReservationV2Model.countDocuments({
    'items.variantId': fixture.variant._id,
  });

  const { response } = await invokeReservationApi({
    body: requestBody({
      ...fixture,
      startDate: '2027-08-10',
    }),
    authorization: 'Bearer definitely.invalid.token',
  });

  assertEqual(response.statusCode, 401, 'invalid bearer status');
  assertEqual(response.body.error.code, 'UNAUTHORIZED', 'invalid bearer code');

  const after = await ReservationV2Model.countDocuments({
    'items.variantId': fixture.variant._id,
  });
  assertEqual(after, before, 'invalid bearer must not fallback to guest write');
};

const createAuthenticatedUser = async () => {
  const user = await LegacyUserModel.create({
    provider: 'Google',
    email: `phase1g-${new Types.ObjectId().toString()}@example.cz`,
    tokens: [],
  });

  created.users.push(user._id);

  const token = jwt.sign(
    {
      id: user._id,
    },
    process.env.SECRET_KEY,
    {
      expiresIn: '23h',
    }
  );

  user.tokens.push({
    token,
    device: {
      test: 'phase-1g',
    },
    lastLogin: new Date(),
  });
  await user.save();

  return {
    user,
    token,
  };
};

const checkAuthenticatedCustomer = async () => {
  const fixture = await createFixture('AUTH');
  const auth = await createAuthenticatedUser();

  const { response } = await invokeReservationApi({
    body: requestBody({
      ...fixture,
      startDate: '2027-08-20',
      email: 'booking-contact@example.cz',
    }),
    authorization: `Bearer ${auth.token}`,
  });

  assertEqual(response.statusCode, 201, 'authenticated create status');
  assertEqual(response.body.guestAccessToken, undefined, 'authenticated response guest token');
  assertPublicDtoSanitized(response);

  const stored = await trackStoredApiReservation(response);

  assertEqual(
    stored.customerId.toString(),
    auth.user._id.toString(),
    'authenticated reservation customerId must come from token user'
  );
  assertEqual(
    stored.customerSnapshot.email,
    'booking-contact@example.cz',
    'authenticated reservation must retain request contact snapshot'
  );
  assertEqual(stored.guestAccessTokenHash, undefined, 'authenticated DB guest hash');
};

const checkActivePendingEmailGuard = async () => {
  const normalizedEmail = 'pending-limit@example.cz';
  const activeExpiry = new Date(Date.now() + 60 * 60 * 1000);

  await createDirectPending({
    email: normalizedEmail,
    expiresAt: activeExpiry,
  });
  await createDirectPending({
    email: normalizedEmail,
    expiresAt: activeExpiry,
  });
  await createDirectPending({
    email: normalizedEmail,
    expiresAt: activeExpiry,
  });

  const fixture = await createFixture('LIMIT');
  const before = await ReservationV2Model.countDocuments({
    'items.variantId': fixture.variant._id,
  });

  const limited = await invokeReservationApi({
    body: requestBody({
      ...fixture,
      startDate: '2027-09-10',
      email: 'PENDING-LIMIT@EXAMPLE.CZ',
    }),
  });

  assertEqual(limited.response.statusCode, 429, '4th active pending status');
  assertEqual(
    limited.response.body.error.code,
    'TOO_MANY_ACTIVE_PENDING_RESERVATIONS',
    '4th active pending code'
  );

  const after = await ReservationV2Model.countDocuments({
    'items.variantId': fixture.variant._id,
  });
  assertEqual(after, before, '4th active pending must not write');

  const expiredEmail = 'expired-does-not-count@example.cz';

  await createDirectPending({
    email: expiredEmail,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  await createDirectPending({
    email: expiredEmail,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  await createDirectPending({
    email: expiredEmail,
    expiresAt: new Date(Date.now() - 60 * 60 * 1000),
  });

  const expiredFixture = await createFixture('EXPIRED');
  const allowed = await invokeReservationApi({
    body: requestBody({
      ...expiredFixture,
      startDate: '2027-09-20',
      email: 'EXPIRED-DOES-NOT-COUNT@EXAMPLE.CZ',
    }),
  });

  assertEqual(allowed.response.statusCode, 201, 'expired pending must not count');
  await trackStoredApiReservation(allowed.response);
};

const checkDisabledApiNoWrite = async () => {
  const fixture = await createFixture('DISABLED');
  const before = await ReservationV2Model.countDocuments({
    'items.variantId': fixture.variant._id,
  });

  const previousFlag = process.env.V2_RESERVATION_API_ENABLED;
  process.env.V2_RESERVATION_API_ENABLED = 'false';

  try {
    const { response } = await invokeReservationApi({
      body: requestBody({
        ...fixture,
        startDate: '2027-10-10',
      }),
    });

    assertEqual(response.statusCode, 503, 'disabled API status');
    assertEqual(
      response.body.error.code,
      'RESERVATION_API_DISABLED',
      'disabled API code'
    );
  } finally {
    if (previousFlag === undefined) {
      delete process.env.V2_RESERVATION_API_ENABLED;
    } else {
      process.env.V2_RESERVATION_API_ENABLED = previousFlag;
    }
  }

  const after = await ReservationV2Model.countDocuments({
    'items.variantId': fixture.variant._id,
  });
  assertEqual(after, before, 'disabled API must not write');
};

const cleanup = async () => {
  if (created.reservations.length) {
    await ReservationV2Model.deleteMany({
      _id: {
        $in: created.reservations,
      },
    });
  }

  if (created.inventoryItems.length) {
    await InventoryItemV2Model.deleteMany({
      _id: {
        $in: created.inventoryItems,
      },
    });
  }

  if (created.variants.length) {
    await VariantV2Model.deleteMany({
      _id: {
        $in: created.variants,
      },
    });
  }

  if (created.products.length) {
    await ProductV2Model.deleteMany({
      _id: {
        $in: created.products,
      },
    });
  }

  if (created.users.length) {
    await LegacyUserModel.deleteMany({
      _id: {
        $in: created.users,
      },
    });
  }
};

const main = async () => {
  await mongoose.connect(testUri, {
    autoIndex: false,
    autoCreate: false,
  });

  const previousFlag = process.env.V2_RESERVATION_API_ENABLED;
  process.env.V2_RESERVATION_API_ENABLED = 'true';

  try {
    await assertReservationNumberIndex();

    await checkGuestValidRequest();
    await checkTrustedFieldInjection();
    await checkInvalidAndPastDate();
    await checkNoInventory();
    await checkNotFoundAndMismatch();
    await checkInvalidBearerDoesNotFallback();
    await checkAuthenticatedCustomer();
    await checkActivePendingEmailGuard();
    await checkDisabledApiNoWrite();

    assert(
      await countReservations() >= 1,
      'integration suite must have exercised real reservation writes'
    );

    console.log('Phase 1G reservation API integration checks passed');
  } finally {
    if (previousFlag === undefined) {
      delete process.env.V2_RESERVATION_API_ENABLED;
    } else {
      process.env.V2_RESERVATION_API_ENABLED = previousFlag;
    }

    await cleanup();
    await mongoose.disconnect();
  }
};

main().catch(async error => {
  console.error(error);

  try {
    await cleanup();
    await mongoose.disconnect();
  } catch (cleanupError) {
    console.error('Phase 1G cleanup failed:', cleanupError);
  }

  process.exitCode = 1;
});
