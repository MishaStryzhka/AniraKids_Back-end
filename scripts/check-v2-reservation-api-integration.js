const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { Types } = mongoose;

const { createV2Router } = require('../build/v2/routes');
const {
  InventoryItemV2Model,
  ProductV2Model,
  ReservationV2Model,
  VariantV2Model,
} = require('../build/v2/models');
const {
  addCalendarDays,
  formatDateOnly,
  getBusinessDateOnly,
  parseDateOnly,
} = require('../build/v2/utils/date-only');
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
    'SECRET_KEY is required for Phase 1G authenticated API integration checks'
  );
}

mongoose.set('strictQuery', true);
mongoose.set('autoIndex', false);

const created = {
  products: [],
  variants: [],
  inventoryItems: [],
  users: [],
};

const testMarker = new Types.ObjectId().toString();

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
    name: 'Phase 1G API Test Dress',
    slug: `phase-1g-${new Types.ObjectId().toString()}`,
    description: 'Disposable Phase 1G API integration test product.',
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

const makeFutureRange = offset => {
  const today = parseDateOnly(getBusinessDateOnly(new Date()));

  return {
    startDate: formatDateOnly(addCalendarDays(today, offset)),
    endDate: formatDateOnly(addCalendarDays(today, offset + 2)),
  };
};

const makeBody = ({ product, variant, email, ...overrides }) => {
  const dates = makeFutureRange(90);

  return {
    productId: product._id.toString(),
    variantId: variant._id.toString(),
    rentalMode: 'external',
    startDate: dates.startDate,
    endDate: dates.endDate,
    customer: {
      firstName: 'Anna',
      lastName: 'Nováková',
      email:
        email ??
        `phase1g-${new Types.ObjectId().toString()}@example.cz`,
      phone: '+420 777 123 456',
    },
    ...overrides,
  };
};

const createTestApp = () => {
  const app = express();

  app.use(express.json());
  app.use(
    '/api/v2',
    createV2Router(express, {
      ensureMongoConnection: (_request, _response, next) => next(),
    })
  );

  return app;
};

const startServer = app =>
  new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });

const sendJson = (server, path, body, headers = {}) =>
  new Promise((resolve, reject) => {
    const address = server.address();

    if (!address || typeof address === 'string') {
      reject(new Error('Test server did not expose a TCP address'));
      return;
    }

    const payload = JSON.stringify(body);

    const request = http.request(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...headers,
        },
      },
      response => {
        let data = '';

        response.setEncoding('utf8');
        response.on('data', chunk => {
          data += chunk;
        });
        response.on('end', () => {
          let parsed;

          try {
            parsed = data ? JSON.parse(data) : undefined;
          } catch (error) {
            reject(
              new Error(
                `Unable to parse test API response: ${data}`
              )
            );
            return;
          }

          resolve({
            status: response.statusCode,
            body: parsed,
          });
        });
      }
    );

    request.on('error', reject);
    request.end(payload);
  });

const findReservationByNumber = async reservationNumber => {
  const reservation = await ReservationV2Model.findOne({
    reservationNumber,
  })
    .select('+guestAccessTokenHash')
    .exec();

  assert(reservation, `Reservation ${reservationNumber} must exist`);
  return reservation;
};

const countMarkerReservations = () =>
  ReservationV2Model.countDocuments({
    'customerSnapshot.email': {
      $regex: `phase1g-.*${testMarker}|pending-${testMarker}|expired-${testMarker}`,
      $options: 'i',
    },
  });

const assertUniqueReservationNumberIndex = async () => {
  const indexes = await ReservationV2Model.collection.indexes();
  const index = indexes.find(candidate =>
    candidate.name === 'uniq_v2_reservation_number'
  );

  assert(
    index,
    'Test DB is missing uniq_v2_reservation_number index'
  );
  assertEqual(
    index.unique,
    true,
    'Test DB reservationNumber index must be unique'
  );
  assertEqual(
    index.key.reservationNumber,
    1,
    'Test DB reservationNumber index key'
  );

  console.log('Phase 1G test DB reservationNumber unique index: present');
};

const checkGuestValid = async server => {
  const product = await createProduct();
  const variant = await createVariant(product._id, { size: '116' });
  await createItem(variant._id, 'GUEST');

  const body = makeBody({
    product,
    variant,
    email: `phase1g-guest-${testMarker}@example.cz`,
  });

  const response = await sendJson(
    server,
    '/api/v2/reservations',
    body
  );

  assertEqual(response.status, 201, 'guest valid request status');
  assert(
    response.body.guestAccessToken,
    'guest response must return raw guestAccessToken'
  );
  assert(
    !JSON.stringify(response.body).includes('inventoryItemId'),
    'guest public DTO must hide inventoryItemId'
  );
  assert(
    !JSON.stringify(response.body).includes('guestAccessTokenHash'),
    'guest public DTO must hide token hash'
  );
  assert(
    !JSON.stringify(response.body).includes('customerId'),
    'guest public DTO must hide customerId'
  );
  assert(
    !JSON.stringify(response.body).includes('"_id"'),
    'guest public DTO must hide Mongo _id'
  );

  const stored = await findReservationByNumber(
    response.body.reservation.reservationNumber
  );
  assert(
    stored.guestAccessTokenHash,
    'guest DB record must store access-token hash'
  );
  assert(
    stored.guestAccessTokenHash !== response.body.guestAccessToken,
    'guest DB record must not store raw guest token'
  );
};

const checkTrustedFieldInjection = async server => {
  const product = await createProduct();
  const variant = await createVariant(product._id);
  await createItem(variant._id, 'INJECT');

  const email = `phase1g-inject-${testMarker}@example.cz`;
  const body = {
    ...makeBody({ product, variant, email }),
    inventoryItemId: new Types.ObjectId().toString(),
    subtotal: 1,
    status: 'confirmed',
  };

  const before = await ReservationV2Model.countDocuments({
    'customerSnapshot.email': email,
  });
  const response = await sendJson(
    server,
    '/api/v2/reservations',
    body
  );
  const after = await ReservationV2Model.countDocuments({
    'customerSnapshot.email': email,
  });

  assertEqual(response.status, 400, 'trusted field injection status');
  assertEqual(
    response.body.error.code,
    'VALIDATION_ERROR',
    'trusted field injection code'
  );
  assertEqual(after, before, 'trusted field injection must create nothing');
};

const checkInvalidAndPastDates = async server => {
  const product = await createProduct();
  const variant = await createVariant(product._id);
  await createItem(variant._id, 'DATE');

  const invalid = await sendJson(
    server,
    '/api/v2/reservations',
    makeBody({
      product,
      variant,
      email: `phase1g-invalid-date-${testMarker}@example.cz`,
      startDate: '2027-02-30',
      endDate: '2027-03-01',
    })
  );

  assertEqual(invalid.status, 400, 'invalid calendar date status');
  assertEqual(invalid.body.error.code, 'INVALID_DATE', 'invalid calendar date code');

  const past = await sendJson(
    server,
    '/api/v2/reservations',
    makeBody({
      product,
      variant,
      email: `phase1g-past-${testMarker}@example.cz`,
      startDate: '2020-01-01',
      endDate: '2020-01-01',
    })
  );

  assertEqual(past.status, 400, 'past date status');
  assertEqual(past.body.error.code, 'PAST_START_DATE', 'past date code');
};

const checkNotFoundMismatchAndNoInventory = async server => {
  const noInventoryProduct = await createProduct();
  const noInventoryVariant = await createVariant(noInventoryProduct._id);

  const noInventory = await sendJson(
    server,
    '/api/v2/reservations',
    makeBody({
      product: noInventoryProduct,
      variant: noInventoryVariant,
      email: `phase1g-noinv-${testMarker}@example.cz`,
    })
  );

  assertEqual(noInventory.status, 409, 'no inventory status');
  assertEqual(
    noInventory.body.error.code,
    'NO_AVAILABLE_INVENTORY',
    'no inventory code'
  );

  const realProduct = await createProduct();
  const realVariant = await createVariant(realProduct._id);
  await createItem(realVariant._id, 'NF');

  const missingProduct = await sendJson(
    server,
    '/api/v2/reservations',
    {
      ...makeBody({
        product: realProduct,
        variant: realVariant,
        email: `phase1g-missing-product-${testMarker}@example.cz`,
      }),
      productId: new Types.ObjectId().toString(),
    }
  );

  assertEqual(missingProduct.status, 404, 'missing product status');
  assertEqual(
    missingProduct.body.error.code,
    'PRODUCT_NOT_FOUND',
    'missing product code'
  );

  const missingVariant = await sendJson(
    server,
    '/api/v2/reservations',
    {
      ...makeBody({
        product: realProduct,
        variant: realVariant,
        email: `phase1g-missing-variant-${testMarker}@example.cz`,
      }),
      variantId: new Types.ObjectId().toString(),
    }
  );

  assertEqual(missingVariant.status, 404, 'missing variant status');
  assertEqual(
    missingVariant.body.error.code,
    'VARIANT_NOT_FOUND',
    'missing variant code'
  );

  const otherProduct = await createProduct();
  const otherVariant = await createVariant(otherProduct._id);
  await createItem(otherVariant._id, 'MISMATCH');

  const mismatch = await sendJson(
    server,
    '/api/v2/reservations',
    makeBody({
      product: realProduct,
      variant: otherVariant,
      email: `phase1g-mismatch-${testMarker}@example.cz`,
    })
  );

  assertEqual(mismatch.status, 400, 'variant/product mismatch status');
  assertEqual(
    mismatch.body.error.code,
    'VARIANT_PRODUCT_MISMATCH',
    'variant/product mismatch code'
  );
};

const checkInvalidBearerDoesNotFallback = async server => {
  const product = await createProduct();
  const variant = await createVariant(product._id);
  await createItem(variant._id, 'BADJWT');
  const email = `phase1g-badjwt-${testMarker}@example.cz`;

  const before = await ReservationV2Model.countDocuments({
    'customerSnapshot.email': email,
  });

  const response = await sendJson(
    server,
    '/api/v2/reservations',
    makeBody({ product, variant, email }),
    {
      authorization: 'Bearer definitely-not-a-valid-jwt',
    }
  );

  const after = await ReservationV2Model.countDocuments({
    'customerSnapshot.email': email,
  });

  assertEqual(response.status, 401, 'invalid bearer status');
  assertEqual(response.body.error.code, 'UNAUTHORIZED', 'invalid bearer code');
  assertEqual(after, before, 'invalid bearer must not fall back to guest');
};

const createAuthenticatedUser = async () => {
  const userId = new Types.ObjectId();
  const token = jwt.sign(
    {
      id: userId.toString(),
    },
    process.env.SECRET_KEY,
    {
      expiresIn: '23h',
    }
  );

  const user = await LegacyUserModel.create({
    _id: userId,
    provider: 'Google',
    email: `phase1g-user-${testMarker}@example.cz`,
    tokens: [{
      token,
      device: {
        purpose: 'phase-1g-integration',
      },
      lastLogin: new Date(),
    }],
  });

  created.users.push(user._id);

  return {
    user,
    token,
  };
};

const checkAuthenticatedUser = async server => {
  const { user, token } = await createAuthenticatedUser();
  const product = await createProduct();
  const variant = await createVariant(product._id);
  await createItem(variant._id, 'AUTH');
  const email = `phase1g-auth-booking-${testMarker}@example.cz`;

  const response = await sendJson(
    server,
    '/api/v2/reservations',
    makeBody({ product, variant, email }),
    {
      authorization: `Bearer ${token}`,
    }
  );

  assertEqual(response.status, 201, 'authenticated request status');
  assertEqual(
    response.body.guestAccessToken,
    undefined,
    'authenticated response must omit guest token'
  );

  const stored = await findReservationByNumber(
    response.body.reservation.reservationNumber
  );

  assert(
    stored.customerId,
    'authenticated reservation must store customerId'
  );
  assertEqual(
    stored.customerId.toString(),
    user._id.toString(),
    'customerId must come from authenticated token identity'
  );
  assertEqual(
    stored.customerSnapshot.email,
    email,
    'authenticated booking contact snapshot must come from request body'
  );
};

const checkMissingAuthorizationGuest = async server => {
  const product = await createProduct();
  const variant = await createVariant(product._id);
  await createItem(variant._id, 'NOAUTH');

  const response = await sendJson(
    server,
    '/api/v2/reservations',
    makeBody({
      product,
      variant,
      email: `phase1g-noauth-${testMarker}@example.cz`,
    })
  );

  assertEqual(response.status, 201, 'missing Authorization guest status');
  assert(
    response.body.guestAccessToken,
    'missing Authorization must use guest flow'
  );
};

const checkPendingEmailGuard = async server => {
  const product = await createProduct();
  const variant = await createVariant(product._id);
  await createItem(variant._id, 'PEND1');
  await createItem(variant._id, 'PEND2');
  await createItem(variant._id, 'PEND3');
  await createItem(variant._id, 'PEND4');

  const email = `pending-${testMarker}@example.cz`;
  const dates = makeFutureRange(180);

  for (let index = 0; index < 3; index += 1) {
    const response = await sendJson(
      server,
      '/api/v2/reservations',
      makeBody({
        product,
        variant,
        email: index % 2 === 0 ? email.toUpperCase() : `  ${email}  `,
        startDate: dates.startDate,
        endDate: dates.endDate,
      })
    );

    assertEqual(
      response.status,
      201,
      `active pending reservation ${index + 1} status`
    );
  }

  const fourth = await sendJson(
    server,
    '/api/v2/reservations',
    makeBody({
      product,
      variant,
      email,
      startDate: dates.startDate,
      endDate: dates.endDate,
    })
  );

  assertEqual(fourth.status, 429, 'fourth active pending status');
  assertEqual(
    fourth.body.error.code,
    'TOO_MANY_ACTIVE_PENDING_RESERVATIONS',
    'fourth active pending code'
  );
};

const createExpiredPending = async ({
  product,
  variant,
  item,
  email,
  reservationNumber,
  dates,
}) => {
  await ReservationV2Model.create({
    reservationNumber,
    customerSnapshot: {
      firstName: 'Expired',
      lastName: 'Pending',
      email,
      phone: '+420700000002',
    },
    items: [{
      productId: product._id,
      variantId: variant._id,
      inventoryItemId: item._id,
      productNameSnapshot: product.name,
      sizeSnapshot: variant.size,
      rentalPriceSnapshot: 800,
      depositSnapshot: 1000,
    }],
    rentalMode: 'external',
    startDate: parseDateOnly(dates.startDate),
    endDate: parseDateOnly(dates.endDate),
    status: 'pending',
    expiresAt: new Date(Date.now() - 60_000),
    subtotal: 800,
    deposit: 1000,
    totalDue: 1800,
    paymentStatus: 'unpaid',
  });
};

const checkExpiredPendingDoesNotCount = async server => {
  const product = await createProduct();
  const variant = await createVariant(product._id);
  const item = await createItem(variant._id, 'EXP');
  const email = `expired-${testMarker}@example.cz`;
  const dates = makeFutureRange(240);

  for (let index = 0; index < 3; index += 1) {
    await createExpiredPending({
      product,
      variant,
      item,
      email,
      reservationNumber:
        `AK-2099-E${String(index).padStart(5, '0')}`,
      dates,
    });
  }

  const response = await sendJson(
    server,
    '/api/v2/reservations',
    makeBody({
      product,
      variant,
      email,
      startDate: dates.startDate,
      endDate: dates.endDate,
    })
  );

  assertEqual(
    response.status,
    201,
    'expired pending reservations must not count toward email guard'
  );
};

const checkDisabledApiNoWrite = async server => {
  const product = await createProduct();
  const variant = await createVariant(product._id);
  await createItem(variant._id, 'DISABLED');
  const email = `phase1g-disabled-${testMarker}@example.cz`;

  const before = await ReservationV2Model.countDocuments({
    'customerSnapshot.email': email,
  });

  process.env.V2_RESERVATION_API_ENABLED = 'false';

  const response = await sendJson(
    server,
    '/api/v2/reservations',
    makeBody({ product, variant, email })
  );

  process.env.V2_RESERVATION_API_ENABLED = 'true';

  const after = await ReservationV2Model.countDocuments({
    'customerSnapshot.email': email,
  });

  assertEqual(response.status, 503, 'disabled API status');
  assertEqual(
    response.body.error.code,
    'RESERVATION_API_DISABLED',
    'disabled API code'
  );
  assertEqual(after, before, 'disabled API must not create reservation');
};

const cleanup = async () => {
  if (created.products.length) {
    await ReservationV2Model.deleteMany({
      'items.productId': {
        $in: created.products,
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

const closeServer = server =>
  new Promise((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const main = async () => {
  const originalFlag = process.env.V2_RESERVATION_API_ENABLED;
  let server;

  await mongoose.connect(testUri, {
    autoIndex: false,
    autoCreate: false,
  });

  try {
    await assertUniqueReservationNumberIndex();

    process.env.V2_RESERVATION_API_ENABLED = 'true';

    server = await startServer(createTestApp());

    const group = process.argv[2] ?? 'all';

    const groups = {
      basics: async () => {
        await checkGuestValid(server);
        await checkTrustedFieldInjection(server);
        await checkInvalidAndPastDates(server);
        await checkNotFoundMismatchAndNoInventory(server);
      },
      auth: async () => {
        await checkInvalidBearerDoesNotFallback(server);
        await checkAuthenticatedUser(server);
        await checkMissingAuthorizationGuest(server);
      },
      pending: async () => {
        await checkPendingEmailGuard(server);
        await checkExpiredPendingDoesNotCount(server);
      },
      disabled: async () => {
        await checkDisabledApiNoWrite(server);
      },
    };

    if (group === 'all') {
      for (const runGroup of Object.values(groups)) {
        await runGroup();
      }
    } else {
      const runGroup = groups[group];

      if (!runGroup) {
        throw new Error(`Unknown Phase 1G integration test group: ${group}`);
      }

      await runGroup();
    }

    console.log(
      `Phase 1G reservation API integration checks passed: ${group}`
    );
  } finally {
    if (server) {
      await closeServer(server);
    }

    if (originalFlag === undefined) {
      delete process.env.V2_RESERVATION_API_ENABLED;
    } else {
      process.env.V2_RESERVATION_API_ENABLED = originalFlag;
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
