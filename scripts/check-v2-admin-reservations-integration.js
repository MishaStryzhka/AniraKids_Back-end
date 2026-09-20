const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { Types } = mongoose;

const {
  AvailabilityBlockV2Model,
  InventoryItemV2Model,
  ProductV2Model,
  ReservationV2Model,
  VariantV2Model,
} = require('../build/v2/models');
const {
  createV2Router,
} = require('../build/v2/routes');
const {
  createReservationAtomically,
} = require('../build/v2/services/concurrency.service');
const {
  ReservationAdminService,
} = require('../build/v2/services/reservation-admin.service');
const {
  InventoryAvailabilityAdminService,
} = require('../build/v2/services/inventory-availability-admin.service');
const {
  isBlockingReservationState,
} = require('../build/v2/utils/availability');
const {
  parseDateOnly,
} = require('../build/v2/utils/date-only');

const LegacyUserModel = require('../models/user');

const testUri = process.env.TEST_MONGODB_URI;

if (!testUri) {
  throw new Error(
    'TEST_MONGODB_URI is required for Phase 1H.6 admin reservation integration checks'
  );
}

if (process.env.MONGODB_URI && testUri === process.env.MONGODB_URI) {
  throw new Error('Refusing to run: TEST_MONGODB_URI matches MONGODB_URI');
}

const databaseName = decodeURIComponent(
  new URL(testUri).pathname.replace(/^\//, '')
);

if (
  !databaseName ||
  !/(test|testing|dev|ci)/i.test(databaseName) ||
  /(prod|production)/i.test(databaseName) ||
  databaseName === 'AniraKids'
) {
  throw new Error(
    'TEST_MONGODB_URI must contain an explicit non-production test/testing/dev/ci database name'
  );
}

mongoose.set('strictQuery', true);
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

const TEST_SECRET =
  'phase-1h6-admin-reservation-integration-secret-at-least-32-bytes';
const TEST_NOW = new Date('2026-10-01T12:00:00.000Z');
const ACTIVE_PENDING_EXPIRY = new Date('2030-01-01T00:00:00.000Z');
const EXPIRED_PENDING_EXPIRY = new Date('2020-01-01T00:00:00.000Z');
const marker = new Types.ObjectId().toHexString().slice(-10).toUpperCase();

const reservationAdminService = new ReservationAdminService();
const inventoryLifecycleService = new InventoryAvailabilityAdminService();

const originalEnvironment = {
  adminFlag: process.env.V2_ADMIN_API_ENABLED,
  adminIds: process.env.V2_ADMIN_USER_IDS,
  secret: process.env.SECRET_KEY,
  reservationFlag: process.env.V2_RESERVATION_API_ENABLED,
};

const created = {
  users: [],
  products: [],
  variants: [],
  inventory: [],
  reservations: [],
  blocks: [],
};

let reservationSequence = 0;

const nextReservationNumber = () => {
  reservationSequence += 1;
  return `AK-2026-${reservationSequence
    .toString(36)
    .toUpperCase()
    .padStart(6, '0')}`;
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

  restore('V2_ADMIN_API_ENABLED', originalEnvironment.adminFlag);
  restore('V2_ADMIN_USER_IDS', originalEnvironment.adminIds);
  restore('SECRET_KEY', originalEnvironment.secret);
  restore(
    'V2_RESERVATION_API_ENABLED',
    originalEnvironment.reservationFlag
  );
};

const ensureTestIndexes = async () => {
  const db = mongoose.connection.db;

  await db.collection('v2_products').createIndex(
    { slug: 1 },
    { unique: true, name: 'uniq_v2_product_slug' }
  );
  await db.collection('v2_variants').createIndex(
    { productId: 1, size: 1 },
    { unique: true, name: 'uniq_v2_variant_product_size' }
  );
  await db.collection('v2_inventory_items').createIndex(
    { internalCode: 1 },
    { unique: true, name: 'uniq_v2_inventory_internal_code' }
  );
  await db.collection('v2_inventory_items').createIndex(
    { variantId: 1, status: 1 },
    { name: 'idx_v2_inventory_variant_status' }
  );
  await db.collection('v2_availability_blocks').createIndex(
    { inventoryItemId: 1, startDate: 1, endDate: 1 },
    { name: 'idx_v2_availability_block_inventory_dates' }
  );
  await db.collection('v2_reservations').createIndex(
    { reservationNumber: 1 },
    { unique: true, name: 'uniq_v2_reservation_number' }
  );
  await db.collection('v2_reservations').createIndex(
    { idempotencyKeyHash: 1 },
    {
      unique: true,
      name: 'uniq_v2_reservation_idempotency_key',
      partialFilterExpression: {
        idempotencyKeyHash: { $exists: true },
      },
    }
  );
  await db.collection('v2_reservations').createIndex(
    {
      'items.inventoryItemId': 1,
      status: 1,
      startDate: 1,
      endDate: 1,
    },
    { name: 'idx_v2_reservation_inventory_conflict_lookup' }
  );
  await db.collection('v2_reservations').createIndex(
    { status: 1, createdAt: -1 },
    { name: 'idx_v2_reservation_admin_status_created' }
  );
  await db.collection('v2_reservations').createIndex(
    { status: 1, startDate: 1, endDate: 1 },
    { name: 'idx_v2_reservation_admin_calendar' }
  );
};

const checkTransactionTopology = async () => {
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  const topology =
    hello.msg === 'isdbgrid'
      ? 'sharded'
      : hello.setName
        ? 'replicaSet'
        : 'standalone';

  assert(
    topology === 'replicaSet' || topology === 'sharded',
    'Phase 1H.6 race checks require transaction-capable MongoDB'
  );

  console.log('Phase 1H.6 Mongo topology:', {
    topology,
    setName: hello.setName ?? null,
  });
};

const createLegacyAdmin = async () => {
  const _id = new Types.ObjectId();
  const token = jwt.sign(
    {
      id: _id.toHexString(),
    },
    TEST_SECRET
  );

  const user = await LegacyUserModel.create({
    _id,
    email: `phase1h6-admin-${marker}@example.cz`,
    provider: 'Google',
    tokens: [
      {
        token,
        device: {
          phase1h6: true,
        },
      },
    ],
  });

  created.users.push(user._id);

  process.env.V2_ADMIN_API_ENABLED = 'true';
  process.env.V2_ADMIN_USER_IDS = user._id.toHexString();
  process.env.SECRET_KEY = TEST_SECRET;
  process.env.V2_RESERVATION_API_ENABLED = 'false';

  return {
    id: user._id,
    token,
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

const sendJson = (
  server,
  method,
  path,
  {
    token,
    body,
  } = {}
) =>
  new Promise((resolve, reject) => {
    const address = server.address();

    if (!address || typeof address === 'string') {
      reject(new Error('Test server did not expose a TCP address'));
      return;
    }

    const payload =
      body === undefined ? undefined : JSON.stringify(body);
    const headers = {};

    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    if (payload !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }

    const request = http.request(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path,
        method,
        headers,
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
          } catch (_error) {
            reject(
              new Error(
                `Unable to parse admin reservation response: ${data}`
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

    if (payload !== undefined) {
      request.write(payload);
    }

    request.end();
  });

const createProductFixture = async () => {
  const product = await ProductV2Model.create({
    name: `Phase 1H.6 Dress ${marker}`,
    slug: `phase-1h6-${marker.toLowerCase()}`,
    description: 'Disposable Phase 1H.6 integration fixture.',
    category: 'dress',
    gender: 'girls',
    color: 'ivory',
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
  });

  created.products.push(product._id);

  const variant = await VariantV2Model.create({
    productId: product._id,
    size: `116-${marker.slice(-4)}`,
    status: 'active',
    sortOrder: 0,
  });

  created.variants.push(variant._id);

  return {
    product,
    variant,
  };
};

const createItem = async (variantId, prefix, overrides = {}) => {
  const item = await InventoryItemV2Model.create({
    variantId,
    internalCode:
      `H6-${prefix}-${new Types.ObjectId().toHexString().slice(-8)}`,
    status: 'active',
    condition: 'good',
    ...overrides,
  });

  created.inventory.push(item._id);
  return item;
};

const createReservation = async ({
  fixture,
  item,
  startDate,
  endDate,
  status = 'confirmed',
  expiresAt = null,
  rentalMode = 'external',
  paymentStatus = 'unpaid',
  customer = {},
  notes,
  secretHashes = false,
}) => {
  const reservationNumber = nextReservationNumber();

  const reservation = await ReservationV2Model.create({
    reservationNumber,
    ...(secretHashes
      ? {
          guestAccessTokenHash: 'c'.repeat(64),
          idempotencyKeyHash: new Types.ObjectId()
            .toHexString()
            .padEnd(64, 'a')
            .slice(0, 64),
          idempotencyRequestHash: new Types.ObjectId()
            .toHexString()
            .padEnd(64, 'b')
            .slice(0, 64),
        }
      : {}),
    customerSnapshot: {
      firstName: customer.firstName ?? `Ada${marker}`,
      lastName: customer.lastName ?? `Novak${marker}`,
      email:
        customer.email ??
        `phase1h6-${marker.toLowerCase()}@example.test`,
      phone: customer.phone ?? `+4207${marker.slice(-8)}`,
    },
    items: [
      {
        productId: fixture.product._id,
        variantId: fixture.variant._id,
        inventoryItemId: item._id,
        productNameSnapshot: fixture.product.name,
        sizeSnapshot: fixture.variant.size,
        rentalPriceSnapshot: 800,
        depositSnapshot: 1000,
      },
    ],
    rentalMode,
    startDate: parseDateOnly(startDate),
    endDate: parseDateOnly(endDate),
    status,
    expiresAt,
    subtotal: 800,
    deposit: 1000,
    totalDue: 1800,
    fulfillmentMethod: rentalMode === 'external' ? 'pickup' : undefined,
    paymentStatus,
    notes,
  });

  created.reservations.push(reservation._id);
  return reservation;
};

const atomicReservationInput = ({
  fixture,
  item,
  startDate,
  endDate,
  now = TEST_NOW,
}) => ({
  reservationNumber: nextReservationNumber(),
  customerSnapshot: {
    firstName: 'Race',
    lastName: marker,
    email: `race-${new Types.ObjectId().toHexString()}@example.test`,
    phone: '+420700000777',
  },
  items: [
    {
      productId: fixture.product._id,
      variantId: fixture.variant._id,
      inventoryItemId: item._id,
      productNameSnapshot: fixture.product.name,
      sizeSnapshot: fixture.variant.size,
      rentalPriceSnapshot: 800,
      depositSnapshot: 1000,
    },
  ],
  rentalMode: 'external',
  startDate: parseDateOnly(startDate),
  endDate: parseDateOnly(endDate),
  status: 'pending',
  expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
  subtotal: 800,
  deposit: 1000,
  totalDue: 1800,
  fulfillmentMethod: 'pickup',
  paymentStatus: 'unpaid',
  now,
});

const rememberAtomicReservation = result => {
  if (result?.status === 'fulfilled' && result.value?._id) {
    created.reservations.push(result.value._id);
  }
};

const getBookingRevision = async itemId => {
  const item = await InventoryItemV2Model.findById(itemId)
    .select('+bookingRevision')
    .exec();

  assert(item, 'Inventory item must exist for bookingRevision');
  return item.bookingRevision;
};

const checkBasicAdminApi = async (
  server,
  admin,
  fixture
) => {
  const empty = await sendJson(
    server,
    'GET',
    `/api/v2/admin/reservations?q=${encodeURIComponent(
      `EMPTY-${marker}`
    )}`,
    { token: admin.token }
  );

  assertEqual(empty.status, 200, 'A list empty HTTP status');
  assertEqual(empty.body.items.length, 0, 'A list empty');

  const confirmedItem = await createItem(fixture.variant._id, 'BASIC1');
  const preparedItem = await createItem(fixture.variant._id, 'BASIC2');
  const activePendingItem = await createItem(fixture.variant._id, 'BASIC3');
  const expiredPendingItem = await createItem(fixture.variant._id, 'BASIC4');
  const cancelledItem = await createItem(fixture.variant._id, 'BASIC5');

  const confirmed = await createReservation({
    fixture,
    item: confirmedItem,
    startDate: '2035-05-10',
    endDate: '2035-05-12',
    status: 'confirmed',
    rentalMode: 'external',
    paymentStatus: 'unpaid',
    customer: {
      firstName: `Klara${marker}`,
      lastName: `SearchName${marker}`,
      email: `search-email-${marker.toLowerCase()}@example.test`,
      phone: `+420600${marker.slice(-6)}`,
    },
    secretHashes: true,
  });

  const prepared = await createReservation({
    fixture,
    item: preparedItem,
    startDate: '2035-05-20',
    endDate: '2035-05-22',
    status: 'prepared',
    rentalMode: 'studio',
    paymentStatus: 'paid',
  });

  const activePending = await createReservation({
    fixture,
    item: activePendingItem,
    startDate: '2035-05-15',
    endDate: '2035-05-16',
    status: 'pending',
    expiresAt: ACTIVE_PENDING_EXPIRY,
  });

  const expiredPending = await createReservation({
    fixture,
    item: expiredPendingItem,
    startDate: '2035-05-17',
    endDate: '2035-05-18',
    status: 'pending',
    expiresAt: EXPIRED_PENDING_EXPIRY,
  });

  const cancelled = await createReservation({
    fixture,
    item: cancelledItem,
    startDate: '2035-05-25',
    endDate: '2035-05-26',
    status: 'cancelled',
  });

  const list = await sendJson(
    server,
    'GET',
    `/api/v2/admin/reservations?q=${encodeURIComponent(marker)}&page=1&limit=2`,
    { token: admin.token }
  );

  assertEqual(list.status, 200, 'B list pagination status');
  assertEqual(list.body.items.length, 2, 'B page size');
  assert(
    list.body.pagination.total >= 5,
    'B pagination total must include suite fixtures'
  );

  const statusFilter = await sendJson(
    server,
    'GET',
    `/api/v2/admin/reservations?status=prepared&q=${encodeURIComponent(marker)}`,
    { token: admin.token }
  );
  assertEqual(statusFilter.status, 200, 'C status filter status');
  assert(
    statusFilter.body.items.some(
      item => item.id === prepared._id.toHexString()
    ),
    'C prepared reservation included'
  );
  assert(
    statusFilter.body.items.every(item => item.status === 'prepared'),
    'C only prepared reservations'
  );

  const modeFilter = await sendJson(
    server,
    'GET',
    `/api/v2/admin/reservations?rentalMode=studio&q=${encodeURIComponent(marker)}`,
    { token: admin.token }
  );
  assertEqual(modeFilter.status, 200, 'D rentalMode filter status');
  assert(
    modeFilter.body.items.some(
      item => item.id === prepared._id.toHexString()
    ),
    'D studio reservation included'
  );
  assert(
    modeFilter.body.items.every(item => item.rentalMode === 'studio'),
    'D only studio reservations'
  );

  const paymentFilter = await sendJson(
    server,
    'GET',
    `/api/v2/admin/reservations?paymentStatus=paid&q=${encodeURIComponent(marker)}`,
    { token: admin.token }
  );
  assertEqual(paymentFilter.status, 200, 'E payment filter status');
  assert(
    paymentFilter.body.items.some(
      item => item.id === prepared._id.toHexString()
    ),
    'E paid reservation included'
  );
  assert(
    paymentFilter.body.items.every(item => item.paymentStatus === 'paid'),
    'E only paid reservations'
  );

  const overlap = await sendJson(
    server,
    'GET',
    `/api/v2/admin/reservations?from=2035-05-11&to=2035-05-11&q=${encodeURIComponent(marker)}`,
    { token: admin.token }
  );
  assertEqual(overlap.status, 200, 'F overlap filter status');
  assert(
    overlap.body.items.some(
      item => item.id === confirmed._id.toHexString()
    ),
    'F confirmed overlap included'
  );
  assert(
    !overlap.body.items.some(
      item => item.id === prepared._id.toHexString()
    ),
    'F non-overlap excluded'
  );

  const reservationNumberSearch = await sendJson(
    server,
    'GET',
    `/api/v2/admin/reservations?q=${encodeURIComponent(
      confirmed.reservationNumber
    )}`,
    { token: admin.token }
  );
  assertEqual(reservationNumberSearch.status, 200, 'G number search status');
  assert(
    reservationNumberSearch.body.items.some(
      item => item.id === confirmed._id.toHexString()
    ),
    'G reservation number search'
  );

  for (const [label, query] of [
    ['H email', `search-email-${marker.toLowerCase()}`],
    ['H name', `SearchName${marker}`],
    ['H phone', `600${marker.slice(-6)}`],
  ]) {
    const result = await sendJson(
      server,
      'GET',
      `/api/v2/admin/reservations?q=${encodeURIComponent(query)}`,
      { token: admin.token }
    );

    assertEqual(result.status, 200, `${label} status`);
    assert(
      result.body.items.some(
        item => item.id === confirmed._id.toHexString()
      ),
      `${label} result`
    );
  }

  const detail = await sendJson(
    server,
    'GET',
    `/api/v2/admin/reservations/${confirmed._id.toHexString()}`,
    { token: admin.token }
  );
  assertEqual(detail.status, 200, 'I detail status');
  assertEqual(
    detail.body.customerSnapshot.firstName,
    `Klara${marker}`,
    'I detail customer'
  );
  assertEqual(detail.body.items.length, 1, 'I detail item snapshots');
  assertEqual(
    detail.body.items[0].productNameSnapshot,
    fixture.product.name,
    'I historical product snapshot'
  );
  assertEqual(
    detail.body.items[0].inventoryCurrent.internalCode,
    confirmedItem.internalCode,
    'I current inventory metadata'
  );

  const serializedDetail = JSON.stringify(detail.body);
  for (const secret of [
    'guestAccessTokenHash',
    'idempotencyKeyHash',
    'idempotencyRequestHash',
    'c'.repeat(64),
  ]) {
    assert(
      !serializedDetail.includes(secret),
      `J detail hides ${secret}`
    );
  }

  const notes = await sendJson(
    server,
    'PATCH',
    `/api/v2/admin/reservations/${confirmed._id.toHexString()}/notes`,
    {
      token: admin.token,
      body: {
        notes: '  Interní poznámka Phase 1H.6  ',
      },
    }
  );
  assertEqual(notes.status, 200, 'K notes update status');
  assertEqual(
    notes.body.reservation.notes,
    'Interní poznámka Phase 1H.6',
    'K notes normalization'
  );

  const calendar = await sendJson(
    server,
    'GET',
    '/api/v2/admin/reservations/calendar?from=2035-05-01&to=2035-05-31',
    { token: admin.token }
  );
  assertEqual(calendar.status, 200, 'L-O calendar status');

  const calendarIds = new Set(calendar.body.items.map(item => item.id));

  assert(
    calendarIds.has(confirmed._id.toHexString()),
    'L calendar confirmed included'
  );
  assert(
    calendarIds.has(activePending._id.toHexString()),
    'M calendar active pending included'
  );
  assert(
    !calendarIds.has(expiredPending._id.toHexString()),
    'N calendar expired pending excluded'
  );
  assert(
    !calendarIds.has(cancelled._id.toHexString()),
    'O calendar cancelled excluded'
  );

  const confirmedEvent = calendar.body.items.find(
    item => item.id === confirmed._id.toHexString()
  );
  assertEqual(
    confirmedEvent.occupiedThrough,
    '2035-05-13',
    'calendar occupiedThrough'
  );
};

const checkStatusFlow = async (
  server,
  admin,
  fixture
) => {
  const flowItem = await createItem(fixture.variant._id, 'FLOW');
  const flow = await createReservation({
    fixture,
    item: flowItem,
    startDate: '2036-01-10',
    endDate: '2036-01-12',
    status: 'pending',
    expiresAt: ACTIVE_PENDING_EXPIRY,
  });

  const confirm = await sendJson(
    server,
    'POST',
    `/api/v2/admin/reservations/${flow._id.toHexString()}/confirm`,
    { token: admin.token }
  );
  assertEqual(confirm.status, 200, 'S1 confirm status');
  assertEqual(confirm.body.reservation.status, 'confirmed', 'S1 confirmed');
  assert(
    confirm.body.reservation.expiresAt === undefined,
    'S1 expiresAt removed from DTO after normalization'
  );

  const confirmAgain = await sendJson(
    server,
    'POST',
    `/api/v2/admin/reservations/${flow._id.toHexString()}/confirm`,
    { token: admin.token }
  );
  assertEqual(confirmAgain.status, 200, 'S10 confirm idempotent status');
  assertEqual(
    confirmAgain.body.reservation.status,
    'confirmed',
    'S10 confirm idempotent state'
  );

  const prepare = await sendJson(
    server,
    'POST',
    `/api/v2/admin/reservations/${flow._id.toHexString()}/prepare`,
    { token: admin.token }
  );
  assertEqual(prepare.status, 200, 'S2 prepare status');
  assertEqual(prepare.body.reservation.status, 'prepared', 'S2 prepared');

  const prepareAgain = await sendJson(
    server,
    'POST',
    `/api/v2/admin/reservations/${flow._id.toHexString()}/prepare`,
    { token: admin.token }
  );
  assertEqual(prepareAgain.status, 200, 'S10 prepare idempotent status');

  const rent = await sendJson(
    server,
    'POST',
    `/api/v2/admin/reservations/${flow._id.toHexString()}/rent`,
    { token: admin.token }
  );
  assertEqual(rent.status, 200, 'S3 rent status');
  assertEqual(rent.body.reservation.status, 'rented', 'S3 rented');

  const returned = await sendJson(
    server,
    'POST',
    `/api/v2/admin/reservations/${flow._id.toHexString()}/return`,
    { token: admin.token }
  );
  assertEqual(returned.status, 200, 'S4 return status');
  assertEqual(returned.body.reservation.status, 'returned', 'S4 returned');

  const cancelReturned = await sendJson(
    server,
    'POST',
    `/api/v2/admin/reservations/${flow._id.toHexString()}/cancel`,
    {
      token: admin.token,
      body: {
        reason: 'Should fail',
      },
    }
  );
  assertEqual(cancelReturned.status, 409, 'S5 returned cancel status');
  assertEqual(
    cancelReturned.body.error.code,
    'INVALID_RESERVATION_TRANSITION',
    'S5 returned cancel code'
  );

  for (const [label, initialStatus] of [
    ['S6', 'pending'],
    ['S7', 'confirmed'],
    ['S8', 'prepared'],
  ]) {
    const item = await createItem(fixture.variant._id, label);
    const reservation = await createReservation({
      fixture,
      item,
      startDate: `2036-02-${label === 'S6' ? '10' : label === 'S7' ? '15' : '20'}`,
      endDate: `2036-02-${label === 'S6' ? '11' : label === 'S7' ? '16' : '21'}`,
      status: initialStatus,
      expiresAt:
        initialStatus === 'pending' ? ACTIVE_PENDING_EXPIRY : null,
    });

    const cancelled = await sendJson(
      server,
      'POST',
      `/api/v2/admin/reservations/${reservation._id.toHexString()}/cancel`,
      {
        token: admin.token,
        body: {
          reason: `Cancel ${label}`,
        },
      }
    );

    assertEqual(cancelled.status, 200, `${label} cancel status`);
    assertEqual(
      cancelled.body.reservation.status,
      'cancelled',
      `${label} cancelled state`
    );

    const stored = await ReservationV2Model.findById(reservation._id).lean();
    assertEqual(stored.expiresAt, null, `${label} expiresAt normalized`);

    const repeat = await sendJson(
      server,
      'POST',
      `/api/v2/admin/reservations/${reservation._id.toHexString()}/cancel`,
      {
        token: admin.token,
        body: {
          reason: `Replacement ${label}`,
        },
      }
    );

    assertEqual(repeat.status, 200, `${label} cancel idempotent status`);

    const repeatedStored = await ReservationV2Model.findById(
      reservation._id
    ).lean();
    assertEqual(
      repeatedStored.cancellationReason,
      `Cancel ${label}`,
      `${label} idempotent cancel preserves original reason`
    );

    if (label === 'S6') {
      const confirmCancelled = await sendJson(
        server,
        'POST',
        `/api/v2/admin/reservations/${reservation._id.toHexString()}/confirm`,
        { token: admin.token }
      );

      assertEqual(confirmCancelled.status, 409, 'S9 cancelled confirm status');
      assertEqual(
        confirmCancelled.body.error.code,
        'INVALID_RESERVATION_TRANSITION',
        'S9 cancelled confirm code'
      );
    }
  }
};

const checkConfirmationCases = async (
  server,
  admin,
  fixture
) => {
  const activeItem = await createItem(fixture.variant._id, 'CONFA');
  const activePending = await createReservation({
    fixture,
    item: activeItem,
    startDate: '2037-01-10',
    endDate: '2037-01-12',
    status: 'pending',
    expiresAt: ACTIVE_PENDING_EXPIRY,
  });

  const revisionBefore = await getBookingRevision(activeItem._id);

  const activeConfirm = await sendJson(
    server,
    'POST',
    `/api/v2/admin/reservations/${activePending._id.toHexString()}/confirm`,
    { token: admin.token }
  );

  assertEqual(activeConfirm.status, 200, 'active pending confirm status');
  assertEqual(
    activeConfirm.body.reservation.status,
    'confirmed',
    'active pending confirmed'
  );

  const activeStored = await ReservationV2Model.findById(
    activePending._id
  ).lean();
  assertEqual(activeStored.expiresAt, null, 'active pending expiresAt null');
  assertEqual(
    await getBookingRevision(activeItem._id),
    revisionBefore + 1,
    'active pending bookingRevision committed'
  );

  const expiredItem = await createItem(fixture.variant._id, 'CONFE');
  const expiredPending = await createReservation({
    fixture,
    item: expiredItem,
    startDate: '2037-02-10',
    endDate: '2037-02-12',
    status: 'pending',
    expiresAt: EXPIRED_PENDING_EXPIRY,
  });

  const expiredConfirm = await sendJson(
    server,
    'POST',
    `/api/v2/admin/reservations/${expiredPending._id.toHexString()}/confirm`,
    { token: admin.token }
  );

  assertEqual(expiredConfirm.status, 200, 'expired pending confirm status');
  assertEqual(
    expiredConfirm.body.reservation.status,
    'confirmed',
    'expired pending may confirm when still free'
  );

  const conflictItem = await createItem(fixture.variant._id, 'CONFC');
  const oldExpired = await createReservation({
    fixture,
    item: conflictItem,
    startDate: '2037-03-10',
    endDate: '2037-03-12',
    status: 'pending',
    expiresAt: EXPIRED_PENDING_EXPIRY,
  });

  await createReservation({
    fixture,
    item: conflictItem,
    startDate: '2037-03-10',
    endDate: '2037-03-12',
    status: 'confirmed',
  });

  const conflict = await sendJson(
    server,
    'POST',
    `/api/v2/admin/reservations/${oldExpired._id.toHexString()}/confirm`,
    { token: admin.token }
  );

  assertEqual(conflict.status, 409, 'expired conflict status');
  assertEqual(
    conflict.body.error.code,
    'RESERVATION_CONFIRMATION_CONFLICT',
    'expired conflict code'
  );

  const oldStillPending = await ReservationV2Model.findById(
    oldExpired._id
  ).lean();
  assertEqual(
    oldStillPending.status,
    'pending',
    'expired conflict leaves old reservation pending'
  );

  const blockItem = await createItem(fixture.variant._id, 'CONFB');
  const blockedPending = await createReservation({
    fixture,
    item: blockItem,
    startDate: '2037-04-10',
    endDate: '2037-04-12',
    status: 'pending',
    expiresAt: EXPIRED_PENDING_EXPIRY,
  });

  const block = await inventoryLifecycleService.createAvailabilityBlock(
    blockItem._id,
    admin.id,
    {
      startDate: '2037-04-11',
      endDate: '2037-04-11',
      reason: 'repair',
    },
    {
      now: TEST_NOW,
    }
  );
  created.blocks.push(block._id);

  const blockedConfirm = await sendJson(
    server,
    'POST',
    `/api/v2/admin/reservations/${blockedPending._id.toHexString()}/confirm`,
    { token: admin.token }
  );

  assertEqual(blockedConfirm.status, 409, 'block confirmation status');
  assertEqual(
    blockedConfirm.body.error.code,
    'RESERVATION_CONFIRMATION_CONFLICT',
    'block confirmation code'
  );

  const maintenanceItem = await createItem(fixture.variant._id, 'CONFM');
  const maintenancePending = await createReservation({
    fixture,
    item: maintenanceItem,
    startDate: '2037-05-10',
    endDate: '2037-05-12',
    status: 'pending',
    expiresAt: EXPIRED_PENDING_EXPIRY,
  });

  await inventoryLifecycleService.moveToMaintenance(
    maintenanceItem._id,
    { now: TEST_NOW }
  );

  const maintenanceConfirm = await sendJson(
    server,
    'POST',
    `/api/v2/admin/reservations/${maintenancePending._id.toHexString()}/confirm`,
    { token: admin.token }
  );

  assertEqual(
    maintenanceConfirm.status,
    409,
    'non-active inventory confirmation status'
  );
  assertEqual(
    maintenanceConfirm.body.error.code,
    'RESERVATION_INVENTORY_NOT_ACTIVE',
    'non-active inventory confirmation code'
  );
};

const blockingReservationsForItem = async (
  inventoryItemId,
  now
) => {
  const reservations = await ReservationV2Model.find({
    'items.inventoryItemId': inventoryItemId,
  })
    .select('status expiresAt')
    .lean();

  return reservations.filter(reservation =>
    isBlockingReservationState(
      reservation.status,
      reservation.expiresAt,
      now
    )
  );
};

const checkCriticalRaces = async (
  admin,
  fixture
) => {
  const r1Item = await createItem(fixture.variant._id, 'R1');
  const r1Old = await createReservation({
    fixture,
    item: r1Item,
    startDate: '2038-01-10',
    endDate: '2038-01-12',
    status: 'pending',
    expiresAt: EXPIRED_PENDING_EXPIRY,
  });

  const r1 = await Promise.allSettled([
    reservationAdminService.confirm(r1Old._id, { now: TEST_NOW }),
    createReservationAtomically(
      atomicReservationInput({
        fixture,
        item: r1Item,
        startDate: '2038-01-10',
        endDate: '2038-01-12',
      })
    ),
  ]);

  rememberAtomicReservation(r1[1]);
  assertEqual(
    r1.filter(result => result.status === 'fulfilled').length,
    1,
    'R1 exactly one operation succeeds'
  );
  assertEqual(
    (await blockingReservationsForItem(r1Item._id, TEST_NOW)).length,
    1,
    'R1 exactly one blocking reservation remains'
  );

  const r2Item = await createItem(fixture.variant._id, 'R2');
  const r2Old = await createReservation({
    fixture,
    item: r2Item,
    startDate: '2038-02-10',
    endDate: '2038-02-12',
    status: 'pending',
    expiresAt: EXPIRED_PENDING_EXPIRY,
  });

  const r2 = await Promise.allSettled([
    reservationAdminService.confirm(r2Old._id, { now: TEST_NOW }),
    inventoryLifecycleService.moveToMaintenance(
      r2Item._id,
      { now: TEST_NOW }
    ),
  ]);

  assertEqual(
    r2.filter(result => result.status === 'fulfilled').length,
    1,
    'R2 exactly one operation succeeds'
  );

  const r2StoredReservation = await ReservationV2Model.findById(
    r2Old._id
  ).lean();
  const r2StoredItem = await InventoryItemV2Model.findById(
    r2Item._id
  ).lean();

  assert(
    !(
      r2StoredReservation.status === 'confirmed' &&
      r2StoredItem.status === 'maintenance'
    ),
    'R2 must never commit confirmed + maintenance together'
  );

  const r3Item = await createItem(fixture.variant._id, 'R3');
  const r3Old = await createReservation({
    fixture,
    item: r3Item,
    startDate: '2038-03-10',
    endDate: '2038-03-12',
    status: 'pending',
    expiresAt: EXPIRED_PENDING_EXPIRY,
  });

  const r3 = await Promise.allSettled([
    reservationAdminService.confirm(r3Old._id, { now: TEST_NOW }),
    inventoryLifecycleService.createAvailabilityBlock(
      r3Item._id,
      admin.id,
      {
        startDate: '2038-03-11',
        endDate: '2038-03-11',
        reason: 'repair',
      },
      {
        now: TEST_NOW,
      }
    ),
  ]);

  if (r3[1].status === 'fulfilled') {
    created.blocks.push(r3[1].value._id);
  }

  assertEqual(
    r3.filter(result => result.status === 'fulfilled').length,
    1,
    'R3 exactly one operation succeeds'
  );

  const r3Reservation = await ReservationV2Model.findById(
    r3Old._id
  ).lean();
  const r3BlockCount = await AvailabilityBlockV2Model.countDocuments({
    inventoryItemId: r3Item._id,
    startDate: { $lte: parseDateOnly('2038-03-12') },
    endDate: { $gte: parseDateOnly('2038-03-10') },
  });

  assert(
    !(
      r3Reservation.status === 'confirmed' &&
      r3BlockCount > 0
    ),
    'R3 must never commit confirmed reservation + overlapping block'
  );
};

const checkCancellationRace = async fixture => {
  const item = await createItem(fixture.variant._id, 'CRACE');
  const existing = await createReservation({
    fixture,
    item,
    startDate: '2038-04-10',
    endDate: '2038-04-12',
    status: 'confirmed',
  });

  const race = await Promise.allSettled([
    reservationAdminService.cancel(
      existing._id,
      {
        reason: 'Race cancellation',
      },
      {
        now: TEST_NOW,
      }
    ),
    createReservationAtomically(
      atomicReservationInput({
        fixture,
        item,
        startDate: '2038-04-10',
        endDate: '2038-04-12',
      })
    ),
  ]);

  rememberAtomicReservation(race[1]);

  assertEqual(race[0].status, 'fulfilled', 'cancellation must succeed');

  const existingStored = await ReservationV2Model.findById(
    existing._id
  ).lean();
  assertEqual(
    existingStored.status,
    'cancelled',
    'cancellation race original status'
  );

  const blocking = await blockingReservationsForItem(
    item._id,
    TEST_NOW
  );

  assert(
    blocking.length <= 1,
    'cancellation race must never leave double booking'
  );
};

const cleanup = async () => {
  if (created.blocks.length > 0) {
    await AvailabilityBlockV2Model.deleteMany({
      _id: { $in: created.blocks },
    });
  }

  if (created.reservations.length > 0) {
    await ReservationV2Model.deleteMany({
      _id: { $in: created.reservations },
    });
  }

  if (created.inventory.length > 0) {
    await InventoryItemV2Model.deleteMany({
      _id: { $in: created.inventory },
    });
  }

  if (created.variants.length > 0) {
    await VariantV2Model.deleteMany({
      _id: { $in: created.variants },
    });
  }

  if (created.products.length > 0) {
    await ProductV2Model.deleteMany({
      _id: { $in: created.products },
    });
  }

  if (created.users.length > 0) {
    await LegacyUserModel.deleteMany({
      _id: { $in: created.users },
    });
  }
};

const main = async () => {
  await mongoose.connect(testUri, {
    autoIndex: false,
    autoCreate: false,
  });

  let server;

  try {
    await checkTransactionTopology();
    await ensureTestIndexes();

    const admin = await createLegacyAdmin();
    const fixture = await createProductFixture();

    server = await startServer(createTestApp());

    await checkBasicAdminApi(server, admin, fixture);
    await checkStatusFlow(server, admin, fixture);
    await checkConfirmationCases(server, admin, fixture);
    await checkCriticalRaces(admin, fixture);
    await checkCancellationRace(fixture);

    console.log('Phase 1H.6 admin reservation integration checks passed');
  } finally {
    if (server) {
      await closeServer(server);
    }

    restoreEnvironment();
    await cleanup();
    await mongoose.disconnect();
  }
};

main().catch(async error => {
  console.error(error);

  try {
    restoreEnvironment();
    await cleanup();
    await mongoose.disconnect();
  } catch (cleanupError) {
    console.error('Phase 1H.6 cleanup failed:', cleanupError);
  }

  process.exitCode = 1;
});
