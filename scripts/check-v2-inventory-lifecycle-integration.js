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
  AvailabilityService,
} = require('../build/v2/services/availability.service');
const {
  CatalogueAdminError,
} = require('../build/v2/services/catalogue-admin.types');
const {
  CatalogueAdminService,
} = require('../build/v2/services/catalogue-admin.service');
const {
  createReservationAtomically,
} = require('../build/v2/services/concurrency.service');
const {
  InventoryAvailabilityAdminError,
} = require('../build/v2/services/inventory-availability-admin.types');
const {
  InventoryAvailabilityAdminService,
} = require('../build/v2/services/inventory-availability-admin.service');
const { parseDateOnly } = require('../build/v2/utils/date-only');

const testUri = process.env.TEST_MONGODB_URI;

if (!testUri) {
  throw new Error(
    'TEST_MONGODB_URI is required for Phase 1H.5 inventory lifecycle integration checks'
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

const lifecycleService = new InventoryAvailabilityAdminService();
const catalogueService = new CatalogueAdminService();
const availabilityService = new AvailabilityService();

const NOW = new Date('2026-10-01T12:00:00.000Z');
const ADMIN_ID = new Types.ObjectId();

const created = {
  products: [],
  variants: [],
  inventoryItems: [],
  reservations: [],
  blocks: [],
};

let sequence = 0;
const nextReservationNumber = () => {
  sequence += 1;
  return `AK-2026-${sequence.toString(36).toUpperCase().padStart(6, '0')}`;
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

const expectError = async (operation, ErrorType, code, label) => {
  let error;

  try {
    await operation();
  } catch (caught) {
    error = caught;
  }

  assert(error instanceof ErrorType, `${label} must throw ${ErrorType.name}`);
  assertEqual(error.code, code, `${label} error code`);
};

const createRequiredIndexes = async () => {
  await InventoryItemV2Model.collection.createIndex(
    { internalCode: 1 },
    { unique: true, name: 'uniq_v2_inventory_internal_code' }
  );
  await InventoryItemV2Model.collection.createIndex(
    { variantId: 1, status: 1 },
    { name: 'idx_v2_inventory_variant_status' }
  );
  await AvailabilityBlockV2Model.collection.createIndex(
    { inventoryItemId: 1, startDate: 1, endDate: 1 },
    { name: 'idx_v2_availability_block_inventory_dates' }
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
    'Phase 1H.5 integration requires transaction-capable MongoDB'
  );

  console.log('Phase 1H.5 Mongo topology:', {
    topology,
    setName: hello.setName ?? null,
  });
};

const createProduct = async () => {
  const product = await ProductV2Model.create({
    name: 'Phase 1H.5 Test Product',
    slug: `phase-1h5-${new Types.ObjectId().toHexString()}`,
    description: 'Disposable lifecycle integration fixture.',
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
  return product;
};

const createVariant = async (productId, size = '116') => {
  const variant = await VariantV2Model.create({
    productId,
    size: `${size}-${new Types.ObjectId().toHexString().slice(-4)}`,
    status: 'active',
    sortOrder: 0,
  });

  created.variants.push(variant._id);
  return variant;
};

const createItem = async (variantId, prefix, overrides = {}) => {
  const item = await InventoryItemV2Model.create({
    variantId,
    internalCode: `${prefix}-${new Types.ObjectId().toHexString().slice(-10)}`,
    status: 'active',
    condition: 'good',
    ...overrides,
  });

  created.inventoryItems.push(item._id);
  return item;
};

const reservationData = ({
  fixture,
  item,
  startDate,
  endDate,
  status = 'confirmed',
  expiresAt = null,
  now = NOW,
}) => ({
  reservationNumber: nextReservationNumber(),
  customerSnapshot: {
    firstName: 'Phase',
    lastName: 'Lifecycle',
    email: `phase1h5-${new Types.ObjectId().toHexString()}@example.test`,
    phone: '+420700000000',
  },
  items: [
    {
      productId: fixture.product._id,
      variantId: fixture.variant._id,
      inventoryItemId: item._id,
      productNameSnapshot: 'Phase 1H.5 Test Product',
      sizeSnapshot: fixture.variant.size,
      rentalPriceSnapshot: 800,
      depositSnapshot: 1000,
    },
  ],
  rentalMode: 'external',
  startDate: parseDateOnly(startDate),
  endDate: parseDateOnly(endDate),
  status,
  expiresAt,
  subtotal: 800,
  deposit: 1000,
  totalDue: 1800,
  paymentStatus: 'unpaid',
  now,
});

const createExistingReservation = async input => {
  const { now: _now, ...data } = input;
  const reservation = await ReservationV2Model.create(data);
  created.reservations.push(reservation._id);
  return reservation;
};

const createAtomicReservation = async input => {
  const reservation = await createReservationAtomically(input);
  created.reservations.push(reservation._id);
  return reservation;
};

const trackBlock = block => {
  created.blocks.push(block._id);
  return block;
};

const readItem = id =>
  InventoryItemV2Model.findById(id)
    .select('_id status condition retiredAt')
    .lean()
    .exec();

const checkLifecycleBasics = async fixture => {
  const a = await createItem(fixture.variant._id, 'H5A');
  const maintenance = await lifecycleService.moveToMaintenance(
    a._id,
    { now: NOW }
  );
  assertEqual(maintenance.status, 'maintenance', 'A active -> maintenance');

  const active = await lifecycleService.activate(a._id, { now: NOW });
  assertEqual(active.status, 'active', 'B maintenance -> active');

  const c = await createItem(fixture.variant._id, 'H5C');
  const retired = await lifecycleService.retire(c._id, { now: NOW });
  assertEqual(retired.status, 'retired', 'C active -> retired');
  assert(
    retired.retiredAt instanceof Date &&
      retired.retiredAt.getTime() === NOW.getTime(),
    'C retiredAt must be set to transition instant'
  );

  const d = await createItem(
    fixture.variant._id,
    'H5D',
    { status: 'maintenance' }
  );
  const retiredFromMaintenance = await lifecycleService.retire(
    d._id,
    { now: NOW }
  );
  assertEqual(
    retiredFromMaintenance.status,
    'retired',
    'D maintenance -> retired'
  );

  await expectError(
    () => lifecycleService.activate(c._id, { now: NOW }),
    InventoryAvailabilityAdminError,
    'INVALID_INVENTORY_TRANSITION',
    'E retired -> active'
  );

  await expectError(
    () => lifecycleService.moveToMaintenance(c._id, { now: NOW }),
    InventoryAvailabilityAdminError,
    'INVALID_INVENTORY_TRANSITION',
    'F retired -> maintenance'
  );
};

const checkLifecycleReservationGuards = async fixture => {
  const future = await createItem(fixture.variant._id, 'H5GH');
  await createExistingReservation(
    reservationData({
      fixture,
      item: future,
      startDate: '2026-10-10',
      endDate: '2026-10-12',
    })
  );

  await expectError(
    () => lifecycleService.moveToMaintenance(future._id, { now: NOW }),
    InventoryAvailabilityAdminError,
    'INVENTORY_HAS_CURRENT_OR_FUTURE_RESERVATION',
    'G future confirmed maintenance'
  );

  await expectError(
    () => lifecycleService.retire(future._id, { now: NOW }),
    InventoryAvailabilityAdminError,
    'INVENTORY_HAS_CURRENT_OR_FUTURE_RESERVATION',
    'H future confirmed retire'
  );

  const activePending = await createItem(fixture.variant._id, 'H5I');
  await createExistingReservation(
    reservationData({
      fixture,
      item: activePending,
      startDate: '2026-10-20',
      endDate: '2026-10-20',
      status: 'pending',
      expiresAt: new Date('2026-10-01T12:00:01.000Z'),
    })
  );

  await expectError(
    () => lifecycleService.moveToMaintenance(activePending._id, { now: NOW }),
    InventoryAvailabilityAdminError,
    'INVENTORY_HAS_CURRENT_OR_FUTURE_RESERVATION',
    'I active pending maintenance'
  );

  await expectError(
    () => lifecycleService.retire(activePending._id, { now: NOW }),
    InventoryAvailabilityAdminError,
    'INVENTORY_HAS_CURRENT_OR_FUTURE_RESERVATION',
    'I active pending retire'
  );

  const expiredPending = await createItem(fixture.variant._id, 'H5J');
  await createExistingReservation(
    reservationData({
      fixture,
      item: expiredPending,
      startDate: '2026-10-20',
      endDate: '2026-10-20',
      status: 'pending',
      expiresAt: new Date('2026-10-01T12:00:00.000Z'),
    })
  );
  const j = await lifecycleService.moveToMaintenance(
    expiredPending._id,
    { now: NOW }
  );
  assertEqual(j.status, 'maintenance', 'J expired pending does not block');

  const cancelled = await createItem(fixture.variant._id, 'H5K');
  await createExistingReservation(
    reservationData({
      fixture,
      item: cancelled,
      startDate: '2026-10-20',
      endDate: '2026-10-20',
      status: 'cancelled',
    })
  );
  const k = await lifecycleService.retire(cancelled._id, { now: NOW });
  assertEqual(k.status, 'retired', 'K cancelled does not block');

  const yesterday = await createItem(fixture.variant._id, 'H5L');
  await createExistingReservation(
    reservationData({
      fixture,
      item: yesterday,
      startDate: '2026-09-29',
      endDate: '2026-09-30',
    })
  );
  await expectError(
    () => lifecycleService.moveToMaintenance(yesterday._id, { now: NOW }),
    InventoryAvailabilityAdminError,
    'INVENTORY_HAS_CURRENT_OR_FUTURE_RESERVATION',
    'L yesterday reservation cleaning buffer'
  );

  const beforeToday = await createItem(fixture.variant._id, 'H5M');
  await createExistingReservation(
    reservationData({
      fixture,
      item: beforeToday,
      startDate: '2026-09-27',
      endDate: '2026-09-29',
    })
  );
  const m = await lifecycleService.moveToMaintenance(
    beforeToday._id,
    { now: NOW }
  );
  assertEqual(
    m.status,
    'maintenance',
    'M occupancy ended before business today'
  );
};

const checkDamagedRules = async fixture => {
  const damaged = await createItem(
    fixture.variant._id,
    'H5N',
    {
      status: 'maintenance',
      condition: 'damaged',
    }
  );

  await expectError(
    () => lifecycleService.activate(damaged._id, { now: NOW }),
    InventoryAvailabilityAdminError,
    'DAMAGED_ITEM_CANNOT_BE_ACTIVATED',
    'N damaged maintenance activation'
  );

  const active = await createItem(fixture.variant._id, 'H5O');
  await expectError(
    () => catalogueService.updateInventoryItem(
      active._id,
      { condition: 'damaged' }
    ),
    CatalogueAdminError,
    'DAMAGED_ITEM_REQUIRES_MAINTENANCE',
    'O active generic condition damaged'
  );

  await expectError(
    () => catalogueService.createInventoryItem(
      fixture.variant._id,
      {
        internalCode: `H5CREATE-${new Types.ObjectId().toHexString().slice(-8)}`,
        condition: 'damaged',
      }
    ),
    CatalogueAdminError,
    'DAMAGED_ITEM_REQUIRES_MAINTENANCE',
    'create active damaged'
  );
};

const checkLifecycleRace = async (
  fixture,
  transition,
  expectedStatus,
  label
) => {
  const item = await createItem(fixture.variant._id, label);
  const input = reservationData({
    fixture,
    item,
    startDate: '2026-12-10',
    endDate: '2026-12-12',
  });

  const results = await Promise.allSettled([
    createReservationAtomically(input),
    transition(item._id),
  ]);

  const successes = results.filter(result => result.status === 'fulfilled');
  const failures = results.filter(result => result.status === 'rejected');

  assertEqual(successes.length, 1, `${label} success count`);
  assertEqual(failures.length, 1, `${label} failure count`);

  if (
    results[0].status === 'fulfilled' &&
    results[0].value
  ) {
    created.reservations.push(results[0].value._id);
  }

  const reservationCount = await ReservationV2Model.countDocuments({
    'items.inventoryItemId': item._id,
  });
  const finalItem = await readItem(item._id);

  assert(finalItem, `${label} final item exists`);

  if (reservationCount === 1) {
    assertEqual(
      finalItem.status,
      'active',
      `${label} reservation winner keeps item active`
    );
  } else {
    assertEqual(
      reservationCount,
      0,
      `${label} lifecycle winner reservation count`
    );
    assertEqual(
      finalItem.status,
      expectedStatus,
      `${label} lifecycle winner status`
    );
  }
};

const checkRaces = async fixture => {
  await checkLifecycleRace(
    fixture,
    id => lifecycleService.moveToMaintenance(id, { now: NOW }),
    'maintenance',
    'R1'
  );

  await checkLifecycleRace(
    fixture,
    id => lifecycleService.retire(id, { now: NOW }),
    'retired',
    'R2'
  );

  const item = await createItem(fixture.variant._id, 'R3');
  const results = await Promise.allSettled([
    createReservationAtomically(
      reservationData({
        fixture,
        item,
        startDate: '2027-01-10',
        endDate: '2027-01-12',
      })
    ),
    lifecycleService.createAvailabilityBlock(
      item._id,
      ADMIN_ID,
      {
        startDate: '2027-01-11',
        endDate: '2027-01-11',
        reason: 'repair',
      },
      { now: NOW }
    ),
  ]);

  const successes = results.filter(result => result.status === 'fulfilled');
  assertEqual(successes.length, 1, 'R3 exactly one conflicting operation succeeds');

  if (results[0].status === 'fulfilled') {
    created.reservations.push(results[0].value._id);
  }

  if (results[1].status === 'fulfilled') {
    created.blocks.push(results[1].value._id);
  }

  const reservationCount = await ReservationV2Model.countDocuments({
    'items.inventoryItemId': item._id,
  });
  const blockCount = await AvailabilityBlockV2Model.countDocuments({
    inventoryItemId: item._id,
  });

  assertEqual(
    reservationCount + blockCount,
    1,
    'R3 final persisted conflict count'
  );
};

const checkAvailabilityBlocks = async fixture => {
  const b1 = await createItem(fixture.variant._id, 'B1');
  const future = trackBlock(
    await lifecycleService.createAvailabilityBlock(
      b1._id,
      ADMIN_ID,
      {
        startDate: '2026-11-01',
        endDate: '2026-11-02',
        reason: 'repair',
      },
      { now: NOW }
    )
  );
  assertEqual(future.reason, 'repair', 'B1 future block');

  const b2 = await createItem(fixture.variant._id, 'B2');
  const sameDay = trackBlock(
    await lifecycleService.createAvailabilityBlock(
      b2._id,
      ADMIN_ID,
      {
        startDate: '2026-10-01',
        endDate: '2026-10-01',
        reason: 'internal_use',
      },
      { now: NOW }
    )
  );
  assertEqual(
    sameDay.startDate.toISOString(),
    '2026-10-01T00:00:00.000Z',
    'B2 same-day block'
  );

  const b3 = await createItem(fixture.variant._id, 'B3');
  await createExistingReservation(
    reservationData({
      fixture,
      item: b3,
      startDate: '2026-11-10',
      endDate: '2026-11-12',
    })
  );
  await expectError(
    () => lifecycleService.createAvailabilityBlock(
      b3._id,
      ADMIN_ID,
      {
        startDate: '2026-11-11',
        endDate: '2026-11-11',
        reason: 'repair',
      },
      { now: NOW }
    ),
    InventoryAvailabilityAdminError,
    'AVAILABILITY_BLOCK_CONFLICT',
    'B3 reservation overlap'
  );

  const b4 = await createItem(fixture.variant._id, 'B4');
  trackBlock(
    await lifecycleService.createAvailabilityBlock(
      b4._id,
      ADMIN_ID,
      {
        startDate: '2026-11-20',
        endDate: '2026-11-22',
        reason: 'repair',
      },
      { now: NOW }
    )
  );
  await expectError(
    () => lifecycleService.createAvailabilityBlock(
      b4._id,
      ADMIN_ID,
      {
        startDate: '2026-11-22',
        endDate: '2026-11-23',
        reason: 'other',
      },
      { now: NOW }
    ),
    InventoryAvailabilityAdminError,
    'AVAILABILITY_BLOCK_CONFLICT',
    'B4 block overlap'
  );

  const b5 = await createItem(fixture.variant._id, 'B5');
  trackBlock(
    await lifecycleService.createAvailabilityBlock(
      b5._id,
      ADMIN_ID,
      {
        startDate: '2026-12-10',
        endDate: '2026-12-12',
        reason: 'repair',
      },
      { now: NOW }
    )
  );
  trackBlock(
    await lifecycleService.createAvailabilityBlock(
      b5._id,
      ADMIN_ID,
      {
        startDate: '2026-12-13',
        endDate: '2026-12-13',
        reason: 'cleaning',
      },
      { now: NOW }
    )
  );

  assertEqual(
    await availabilityService.isInventoryItemAvailable(
      b5._id,
      parseDateOnly('2026-12-14'),
      parseDateOnly('2026-12-14'),
      { now: NOW }
    ),
    true,
    'B5 blocks have no automatic cleaning buffer'
  );

  const b6 = await createItem(fixture.variant._id, 'B6');
  await expectError(
    () => lifecycleService.createAvailabilityBlock(
      b6._id,
      ADMIN_ID,
      {
        startDate: '2026-09-30',
        endDate: '2026-10-01',
        reason: 'other',
      },
      { now: NOW }
    ),
    InventoryAvailabilityAdminError,
    'PAST_BLOCK_DATE',
    'B6 past start'
  );

  const b7 = await createItem(
    fixture.variant._id,
    'B7',
    { status: 'maintenance' }
  );
  await expectError(
    () => lifecycleService.createAvailabilityBlock(
      b7._id,
      ADMIN_ID,
      {
        startDate: '2026-11-01',
        endDate: '2026-11-01',
        reason: 'repair',
      },
      { now: NOW }
    ),
    InventoryAvailabilityAdminError,
    'INVENTORY_ITEM_NOT_ACTIVE',
    'B7 maintenance block'
  );

  const b8 = await createItem(
    fixture.variant._id,
    'B8',
    { status: 'retired', retiredAt: NOW }
  );
  await expectError(
    () => lifecycleService.createAvailabilityBlock(
      b8._id,
      ADMIN_ID,
      {
        startDate: '2026-11-01',
        endDate: '2026-11-01',
        reason: 'repair',
      },
      { now: NOW }
    ),
    InventoryAvailabilityAdminError,
    'INVENTORY_ITEM_NOT_ACTIVE',
    'B8 retired block'
  );

  const listItem = await createItem(fixture.variant._id, 'B9');
  const historical = await AvailabilityBlockV2Model.create({
    inventoryItemId: listItem._id,
    startDate: parseDateOnly('2026-09-01'),
    endDate: parseDateOnly('2026-09-02'),
    reason: 'other',
    createdBy: ADMIN_ID,
  });
  created.blocks.push(historical._id);

  const listBlockA = trackBlock(
    await lifecycleService.createAvailabilityBlock(
      listItem._id,
      ADMIN_ID,
      {
        startDate: '2026-10-05',
        endDate: '2026-10-06',
        reason: 'photoshoot',
      },
      { now: NOW }
    )
  );
  const listBlockB = trackBlock(
    await lifecycleService.createAvailabilityBlock(
      listItem._id,
      ADMIN_ID,
      {
        startDate: '2026-10-20',
        endDate: '2026-10-22',
        reason: 'repair',
      },
      { now: NOW }
    )
  );

  const defaultList = await lifecycleService.listAvailabilityBlocks(
    listItem._id,
    { now: NOW }
  );
  assertEqual(defaultList.length, 2, 'B9 default from today result count');
  assertEqual(
    defaultList[0]._id.toString(),
    listBlockA._id.toString(),
    'B9 list ordering first'
  );
  assertEqual(
    defaultList[1]._id.toString(),
    listBlockB._id.toString(),
    'B9 list ordering second'
  );

  const overlapList = await lifecycleService.listAvailabilityBlocks(
    listItem._id,
    {
      from: '2026-10-21',
      to: '2026-10-21',
      now: NOW,
    }
  );
  assertEqual(overlapList.length, 1, 'B10 overlap list count');
  assertEqual(
    overlapList[0]._id.toString(),
    listBlockB._id.toString(),
    'B10 overlap result'
  );

  const deleteItem = await createItem(fixture.variant._id, 'B11');
  const deleteBlock = trackBlock(
    await lifecycleService.createAvailabilityBlock(
      deleteItem._id,
      ADMIN_ID,
      {
        startDate: '2026-11-15',
        endDate: '2026-11-15',
        reason: 'other',
      },
      { now: NOW }
    )
  );
  await lifecycleService.deleteAvailabilityBlock(deleteBlock._id);
  assertEqual(
    await AvailabilityBlockV2Model.countDocuments({ _id: deleteBlock._id }),
    0,
    'B11 delete block'
  );

  await expectError(
    () => lifecycleService.deleteAvailabilityBlock(new Types.ObjectId()),
    InventoryAvailabilityAdminError,
    'AVAILABILITY_BLOCK_NOT_FOUND',
    'B12 delete missing block'
  );
};

const checkAvailabilityLifecycleRegression = async fixture => {
  const item = await createItem(fixture.variant._id, 'AVAIL');

  assertEqual(
    await availabilityService.isInventoryItemAvailable(
      item._id,
      parseDateOnly('2027-02-01'),
      parseDateOnly('2027-02-01'),
      { now: NOW }
    ),
    true,
    'active item initially available'
  );

  await lifecycleService.moveToMaintenance(item._id, { now: NOW });
  assertEqual(
    await availabilityService.isInventoryItemAvailable(
      item._id,
      parseDateOnly('2027-02-01'),
      parseDateOnly('2027-02-01'),
      { now: NOW }
    ),
    false,
    'maintenance item unavailable'
  );

  await lifecycleService.activate(item._id, { now: NOW });
  assertEqual(
    await availabilityService.isInventoryItemAvailable(
      item._id,
      parseDateOnly('2027-02-01'),
      parseDateOnly('2027-02-01'),
      { now: NOW }
    ),
    true,
    'maintenance -> active restores availability without conflicts'
  );

  const retired = await createItem(fixture.variant._id, 'AVRET');
  await lifecycleService.retire(retired._id, { now: NOW });
  assertEqual(
    await availabilityService.isInventoryItemAvailable(
      retired._id,
      parseDateOnly('2027-02-01'),
      parseDateOnly('2027-02-01'),
      { now: NOW }
    ),
    false,
    'retired item unavailable'
  );
};

const cleanup = async () => {
  if (created.blocks.length) {
    await AvailabilityBlockV2Model.deleteMany({
      _id: { $in: created.blocks },
    });
  }

  if (created.reservations.length) {
    await ReservationV2Model.deleteMany({
      _id: { $in: created.reservations },
    });
  }

  if (created.inventoryItems.length) {
    await InventoryItemV2Model.deleteMany({
      _id: { $in: created.inventoryItems },
    });
  }

  if (created.variants.length) {
    await VariantV2Model.deleteMany({
      _id: { $in: created.variants },
    });
  }

  if (created.products.length) {
    await ProductV2Model.deleteMany({
      _id: { $in: created.products },
    });
  }
};

const main = async () => {
  await mongoose.connect(testUri, {
    autoIndex: false,
    autoCreate: false,
  });

  try {
    await checkTransactionTopology();
    await createRequiredIndexes();

    const product = await createProduct();
    const variant = await createVariant(product._id);
    const fixture = { product, variant };

    await checkLifecycleBasics(fixture);
    await checkLifecycleReservationGuards(fixture);
    await checkDamagedRules(fixture);
    await checkRaces(fixture);
    await checkAvailabilityBlocks(fixture);
    await checkAvailabilityLifecycleRegression(fixture);

    console.log('Phase 1H.5 inventory lifecycle integration checks passed');
  } finally {
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
    console.error('Phase 1H.5 cleanup failed:', cleanupError);
  }

  process.exitCode = 1;
});
