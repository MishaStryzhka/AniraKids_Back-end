const http = require('http');
const { randomUUID } = require('crypto');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
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
  createV2CorsOptions,
} = require('../build/v2/http/cors');
const {
  addCalendarDays,
  formatDateOnly,
  getBusinessDateOnly,
  parseDateOnly,
} = require('../build/v2/utils/date-only');
const {
  hashIdempotencyKey,
} = require('../build/v2/utils/idempotency');
const {
  hashGuestAccessToken,
} = require('../build/v2/utils/reservation');

const testUri = process.env.TEST_MONGODB_URI;

if (!testUri) {
  throw new Error(
    'TEST_MONGODB_URI is required for Phase 1G.1 hardening integration checks'
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

mongoose.set('strictQuery', true);
mongoose.set('autoIndex', false);

const TEST_ORIGIN = 'https://anirakids-phase1g1.test';
const TEST_GUEST_SECRET =
  'phase-1g1-integration-guest-secret-at-least-32-bytes';

const originalEnvironment = {
  flag: process.env.V2_RESERVATION_API_ENABLED,
  cors: process.env.V2_CORS_ALLOWED_ORIGINS,
  guestSecret: process.env.V2_GUEST_TOKEN_SECRET,
};

process.env.V2_RESERVATION_API_ENABLED = 'true';
process.env.V2_CORS_ALLOWED_ORIGINS = TEST_ORIGIN;
process.env.V2_GUEST_TOKEN_SECRET = TEST_GUEST_SECRET;

const created = {
  products: [],
  variants: [],
  inventoryItems: [],
  directReservationIds: [],
};

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

const restoreEnvironment = () => {
  const restore = (name, value) => {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  };

  restore('V2_RESERVATION_API_ENABLED', originalEnvironment.flag);
  restore('V2_CORS_ALLOWED_ORIGINS', originalEnvironment.cors);
  restore('V2_GUEST_TOKEN_SECRET', originalEnvironment.guestSecret);
};

const ensureTestIdempotencyIndex = async () => {
  const indexes = await ReservationV2Model.collection.indexes();
  const existing = indexes.find(
    index => index.name === 'uniq_v2_reservation_idempotency_key'
  );

  if (existing) {
    assertEqual(existing.unique, true, 'test idempotency index unique');
    assertEqual(
      existing.key?.idempotencyKeyHash,
      1,
      'test idempotency index key'
    );
    assert(
      existing.partialFilterExpression?.idempotencyKeyHash?.$exists === true,
      'test idempotency index must be partial on field existence'
    );
    return;
  }

  await ReservationV2Model.collection.createIndex(
    {
      idempotencyKeyHash: 1,
    },
    {
      unique: true,
      name: 'uniq_v2_reservation_idempotency_key',
      partialFilterExpression: {
        idempotencyKeyHash: {
          $exists: true,
        },
      },
    }
  );

  const verified = (await ReservationV2Model.collection.indexes()).find(
    index => index.name === 'uniq_v2_reservation_idempotency_key'
  );

  assert(verified, 'test idempotency index must exist after test-only setup');
  assertEqual(verified.unique, true, 'created test idempotency index unique');
};

const assertReservationNumberIndex = async () => {
  const indexes = await ReservationV2Model.collection.indexes();
  const index = indexes.find(
    candidate => candidate.name === 'uniq_v2_reservation_number'
  );

  assert(index, 'test DB must have uniq_v2_reservation_number');
  assertEqual(index.unique, true, 'reservationNumber index unique');
  assertEqual(
    index.key?.reservationNumber,
    1,
    'reservationNumber index key'
  );
};

const createProduct = async (overrides = {}) => {
  const product = await ProductV2Model.create({
    name: 'Phase 1G.1 Test Dress',
    slug: `phase-1g1-${new Types.ObjectId().toString()}`,
    description: 'Disposable Phase 1G.1 integration test product.',
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

const createItem = async (variantId, prefix = 'IDEMP') => {
  const item = await InventoryItemV2Model.create({
    variantId,
    internalCode: `${prefix}-${new Types.ObjectId().toString().slice(-10)}`,
    status: 'active',
    condition: 'good',
  });

  created.inventoryItems.push(item._id);
  return item;
};

const createFixture = async (itemCount = 1, prefix = 'IDEMP') => {
  const product = await createProduct();
  const variant = await createVariant(product._id);
  const items = [];

  for (let index = 0; index < itemCount; index += 1) {
    items.push(await createItem(variant._id, `${prefix}${index + 1}`));
  }

  return {
    product,
    variant,
    items,
  };
};

const futureRange = offsetDays => {
  const today = parseDateOnly(getBusinessDateOnly(new Date()));

  return {
    startDate: formatDateOnly(addCalendarDays(today, offsetDays)),
    endDate: formatDateOnly(addCalendarDays(today, offsetDays + 2)),
  };
};

const makeBody = ({
  product,
  variant,
  email,
  startDate,
  endDate,
  ...overrides
}) => {
  const fallback = futureRange(120);

  return {
    productId: product._id.toString(),
    variantId: variant._id.toString(),
    rentalMode: 'external',
    startDate: startDate ?? fallback.startDate,
    endDate: endDate ?? fallback.endDate,
    customer: {
      firstName: 'Anna',
      lastName: 'Nováková',
      email:
        email ??
        `phase1g1-${new Types.ObjectId().toString()}@example.cz`,
      phone: '+420 777 123 456',
    },
    ...overrides,
  };
};

const createTestApp = () => {
  const app = express();

  app.use('/api/v2', cors(createV2CorsOptions()));
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

const sendReservation = (
  server,
  body,
  idempotencyKey,
  extraHeaders = {}
) =>
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
        path: '/api/v2/reservations',
        method: 'POST',
        headers: {
          origin: TEST_ORIGIN,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          'idempotency-key': idempotencyKey,
          ...extraHeaders,
        },
      },
      response => {
        let data = '';

        response.setEncoding('utf8');
        response.on('data', chunk => {
          data += chunk;
        });
        response.on('end', () => {
          let bodyValue;

          try {
            bodyValue = data ? JSON.parse(data) : undefined;
          } catch (_error) {
            reject(
              new Error(
                `Unable to parse reservation API response: ${data}`
              )
            );
            return;
          }

          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: bodyValue,
          });
        });
      }
    );

    request.on('error', reject);
    request.end(payload);
  });

const reservationCountForKey = key =>
  ReservationV2Model.countDocuments({
    idempotencyKeyHash: hashIdempotencyKey(key),
  });

const loadReservationForKey = key =>
  ReservationV2Model.findOne({
    idempotencyKeyHash: hashIdempotencyKey(key),
  })
    .select(
      '+guestAccessTokenHash +idempotencyKeyHash +idempotencyRequestHash'
    )
    .exec();

const checkFirstIdempotentCreate = async server => {
  const fixture = await createFixture(1, 'FIRST');
  const dates = futureRange(125);
  const body = makeBody({
    ...fixture,
    ...dates,
  });
  const key = randomUUID();

  const first = await sendReservation(server, body, key);

  assertEqual(first.status, 201, 'first idempotent create status');
  assert(
    first.body?.reservation?.reservationNumber,
    'first idempotent create must return reservationNumber'
  );
  assert(
    first.body?.guestAccessToken,
    'first idempotent create must return guest token'
  );
  assertEqual(
    await reservationCountForKey(key),
    1,
    'first idempotent create DB count'
  );
};

const checkSequentialReplay = async server => {
  const fixture = await createFixture(1, 'SEQ');
  const dates = futureRange(130);
  const email =
    `phase1g1-seq-${new Types.ObjectId().toString()}@example.cz`;
  const body = makeBody({
    ...fixture,
    email,
    ...dates,
  });
  const key = randomUUID();

  const first = await sendReservation(server, body, key);
  const replay = await sendReservation(server, body, key);

  assertEqual(first.status, 201, 'sequential first status');
  assertEqual(replay.status, 200, 'sequential replay status');
  assertEqual(
    replay.body.reservation.reservationNumber,
    first.body.reservation.reservationNumber,
    'sequential replay reservationNumber'
  );
  assertEqual(
    replay.body.guestAccessToken,
    first.body.guestAccessToken,
    'sequential guest replay token'
  );
  assertEqual(
    await reservationCountForKey(key),
    1,
    'sequential replay DB count'
  );

  const stored = await loadReservationForKey(key);

  assert(stored, 'sequential reservation must exist');
  assertEqual(
    stored.guestAccessTokenHash,
    hashGuestAccessToken(first.body.guestAccessToken),
    'sequential stored guest token hash'
  );
  assert(
    !JSON.stringify(stored.toObject()).includes(key),
    'raw idempotency key must not be stored'
  );

  return {
    fixture,
    body,
    key,
    first,
  };
};

const checkConcurrentReplay = async server => {
  const fixture = await createFixture(2, 'CON');
  const dates = futureRange(160);
  const body = makeBody({
    ...fixture,
    ...dates,
  });
  const key = randomUUID();

  const [left, right] = await Promise.all([
    sendReservation(server, body, key),
    sendReservation(server, body, key),
  ]);

  const statuses = [left.status, right.status].sort();

  assertEqual(
    JSON.stringify(statuses),
    JSON.stringify([200, 201]),
    'concurrent replay statuses'
  );
  assertEqual(
    left.body.reservation.reservationNumber,
    right.body.reservation.reservationNumber,
    'concurrent replay reservationNumber'
  );
  assertEqual(
    left.body.guestAccessToken,
    right.body.guestAccessToken,
    'concurrent replay guest token'
  );
  assertEqual(
    await reservationCountForKey(key),
    1,
    'concurrent replay DB count'
  );
};

const checkReusedKeyDifferentSemantics = async (
  server,
  sequential
) => {
  const changedDates = await sendReservation(
    server,
    {
      ...sequential.body,
      endDate: formatDateOnly(
        addCalendarDays(
          parseDateOnly(sequential.body.endDate),
          1
        )
      ),
    },
    sequential.key
  );

  assertEqual(changedDates.status, 409, 'changed dates status');
  assertEqual(
    changedDates.body.error.code,
    'IDEMPOTENCY_KEY_REUSED',
    'changed dates code'
  );

  const otherProduct = await createProduct();
  const otherVariant = await createVariant(otherProduct._id);
  await createItem(otherVariant._id, 'OTHERP');

  const changedProduct = await sendReservation(
    server,
    {
      ...sequential.body,
      productId: otherProduct._id.toString(),
      variantId: otherVariant._id.toString(),
    },
    sequential.key
  );

  assertEqual(changedProduct.status, 409, 'changed product status');
  assertEqual(
    changedProduct.body.error.code,
    'IDEMPOTENCY_KEY_REUSED',
    'changed product code'
  );

  const secondVariant = await createVariant(
    sequential.fixture.product._id
  );
  await createItem(secondVariant._id, 'OTHERV');

  const changedVariant = await sendReservation(
    server,
    {
      ...sequential.body,
      variantId: secondVariant._id.toString(),
    },
    sequential.key
  );

  assertEqual(changedVariant.status, 409, 'changed variant status');
  assertEqual(
    changedVariant.body.error.code,
    'IDEMPOTENCY_KEY_REUSED',
    'changed variant code'
  );

  const changedCustomer = await sendReservation(
    server,
    {
      ...sequential.body,
      customer: {
        ...sequential.body.customer,
        email: `changed-${new Types.ObjectId().toString()}@example.cz`,
      },
    },
    sequential.key
  );

  assertEqual(changedCustomer.status, 409, 'changed customer status');
  assertEqual(
    changedCustomer.body.error.code,
    'IDEMPOTENCY_KEY_REUSED',
    'changed customer code'
  );

  assertEqual(
    await reservationCountForKey(sequential.key),
    1,
    'reused key must still reference one DB reservation'
  );
};

const checkDifferentKeysNormalSemantics = async server => {
  const fixture = await createFixture(2, 'DIFF');
  const dates = futureRange(190);
  const email =
    `phase1g1-different-${new Types.ObjectId().toString()}@example.cz`;
  const body = makeBody({
    ...fixture,
    email,
    ...dates,
  });
  const keyA = randomUUID();
  const keyB = randomUUID();

  const first = await sendReservation(server, body, keyA);
  const second = await sendReservation(server, body, keyB);

  assertEqual(first.status, 201, 'different key A status');
  assertEqual(second.status, 201, 'different key B status');
  assert(
    first.body.reservation.reservationNumber !==
      second.body.reservation.reservationNumber,
    'different keys may create distinct logical reservations'
  );

  const count = await ReservationV2Model.countDocuments({
    idempotencyKeyHash: {
      $in: [
        hashIdempotencyKey(keyA),
        hashIdempotencyKey(keyB),
      ],
    },
  });

  assertEqual(count, 2, 'different keys DB count');
};

const checkReplayBeforePendingGuard = async server => {
  const fixture = await createFixture(3, 'PEND');
  const dates = futureRange(220);
  const email =
    `phase1g1-pending-${new Types.ObjectId().toString()}@example.cz`;
  const body = makeBody({
    ...fixture,
    email,
    ...dates,
  });

  const keys = [randomUUID(), randomUUID(), randomUUID()];
  const responses = [];

  for (const key of keys) {
    responses.push(await sendReservation(server, body, key));
  }

  for (const response of responses) {
    assertEqual(
      response.status,
      201,
      'first three pending reservations must be created'
    );
  }

  const activeBefore = await ReservationV2Model.countDocuments({
    'customerSnapshot.email': email,
    status: 'pending',
    expiresAt: {
      $gt: new Date(),
    },
  });

  assertEqual(activeBefore, 3, 'pending guard fixture count');

  const replay = await sendReservation(
    server,
    body,
    keys[0]
  );

  assertEqual(
    replay.status,
    200,
    'idempotent replay must bypass pending email rejection'
  );
  assertEqual(
    replay.body.reservation.reservationNumber,
    responses[0].body.reservation.reservationNumber,
    'pending replay reservationNumber'
  );

  const activeAfter = await ReservationV2Model.countDocuments({
    'customerSnapshot.email': email,
    status: 'pending',
    expiresAt: {
      $gt: new Date(),
    },
  });

  assertEqual(
    activeAfter,
    3,
    'pending replay must not create a fourth reservation'
  );
};

const checkUniqueIndexEnforcement = async sequential => {
  const duplicateId = new Types.ObjectId();
  created.directReservationIds.push(duplicateId);

  let duplicateError;

  try {
    await ReservationV2Model.collection.insertOne({
      _id: duplicateId,
      reservationNumber:
        `AK-2099-${new Types.ObjectId()
          .toString()
          .slice(-6)
          .toUpperCase()}`,
      idempotencyKeyHash: hashIdempotencyKey(
        sequential.key
      ),
      marker: 'phase-1g1-duplicate-index-check',
    });
  } catch (error) {
    duplicateError = error;
  }

  assert(
    duplicateError &&
      duplicateError.code === 11000,
    'duplicate idempotency hash must be rejected by Mongo unique index'
  );
};

const cleanup = async () => {
  if (created.products.length) {
    await ReservationV2Model.deleteMany({
      'items.productId': {
        $in: created.products,
      },
    });
  }

  if (created.directReservationIds.length) {
    await ReservationV2Model.collection.deleteMany({
      _id: {
        $in: created.directReservationIds,
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
};

const main = async () => {
  let server;

  await mongoose.connect(testUri, {
    autoIndex: false,
    autoCreate: false,
  });

  try {
    await assertReservationNumberIndex();
    await ensureTestIdempotencyIndex();

    const group = process.argv[2] ?? 'all';

    if (group === 'index') {
      console.log('Phase 1G.1 hardening integration index check passed');
      return;
    }

    server = await startServer(createTestApp());

    const groups = {
      first: async () => {
        await checkFirstIdempotentCreate(server);
      },
      sequential: async () => {
        const sequential = await checkSequentialReplay(server);
        await checkUniqueIndexEnforcement(sequential);
      },
      concurrent: async () => {
        await checkConcurrentReplay(server);
      },
      reused: async () => {
        const sequential = await checkSequentialReplay(server);
        await checkReusedKeyDifferentSemantics(server, sequential);
      },
      different: async () => {
        await checkDifferentKeysNormalSemantics(server);
      },
      pending: async () => {
        await checkReplayBeforePendingGuard(server);
      },
    };

    if (group === 'all') {
      for (const groupName of [
        'sequential',
        'concurrent',
        'reused',
        'different',
        'pending',
      ]) {
        await groups[groupName]();
      }
    } else {
      const runGroup = groups[group];

      if (!runGroup) {
        throw new Error(
          `Unknown Phase 1G.1 hardening integration group: ${group}`
        );
      }

      await runGroup();
    }

    console.log(
      `Phase 1G.1 reservation hardening integration checks passed: ${group}`
    );
  } finally {
    if (server) {
      await closeServer(server);
    }

    await cleanup();
    await mongoose.disconnect();
    restoreEnvironment();
  }
};

main().catch(async error => {
  console.error(error);

  try {
    await cleanup();
    await mongoose.disconnect();
  } catch (cleanupError) {
    console.error(
      'Phase 1G.1 cleanup failed:',
      cleanupError
    );
  }

  restoreEnvironment();
  process.exitCode = 1;
});
