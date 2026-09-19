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
  ConcurrencyError,
} = require('../build/v2/services/concurrency.types');
const {
  createAvailabilityBlockAtomically,
  createReservationAtomically,
} = require('../build/v2/services/concurrency.service');
const { parseDateOnly } = require('../build/v2/utils/date-only');

const testUri = process.env.TEST_MONGODB_URI;

if (!testUri) {
  throw new Error(
    'TEST_MONGODB_URI is required for Phase 1E concurrency integration checks'
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
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
};

const createProduct = async () => {
  const product = await ProductV2Model.create({
    name: 'Phase 1E Test Product',
    slug: `phase-1e-${new Types.ObjectId().toString()}`,
    description: 'Disposable Phase 1E integration test product.',
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
  });

  created.products.push(product._id);
  return product;
};

const createVariant = async (productId, size = '116') => {
  const variant = await VariantV2Model.create({
    productId,
    size,
    status: 'active',
    sortOrder: 0,
  });

  created.variants.push(variant._id);
  return variant;
};

const createItem = async (variantId, prefix = 'CNC', overrides = {}) => {
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

const reservationInput = ({
  productId,
  variantId,
  inventoryItemId,
  startDate,
  endDate,
  status = 'confirmed',
  expiresAt = null,
  rentalMode = 'external',
  now = new Date('2026-10-01T12:00:00.000Z'),
}) => ({
  reservationNumber: nextReservationNumber(),
  customerSnapshot: {
    firstName: 'Phase',
    lastName: 'Concurrency',
    email: `phase1e-${new Types.ObjectId().toString()}@example.test`,
    phone: '+420700000000',
  },
  items: [
    {
      productId,
      variantId,
      inventoryItemId,
      productNameSnapshot: 'Phase 1E Test Product',
      sizeSnapshot: '116',
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
  paymentStatus: 'unpaid',
  now,
});

const trackReservation = reservation => {
  created.reservations.push(reservation._id);
  return reservation;
};

const trackBlock = block => {
  created.blocks.push(block._id);
  return block;
};

const getBookingRevision = async inventoryItemId => {
  const item = await InventoryItemV2Model.findById(inventoryItemId)
    .select('+bookingRevision')
    .exec();

  assert(item, 'Inventory item must exist for bookingRevision assertion');
  return item.bookingRevision;
};

const countReservationsForItem = async inventoryItemId =>
  ReservationV2Model.countDocuments({
    'items.inventoryItemId': inventoryItemId,
  });

const createExistingReservation = async input => {
  const { now: _now, ...data } = input;
  const reservation = await ReservationV2Model.create(data);
  return trackReservation(reservation);
};

const assertOneSuccessOneConflict = async (operations, label) => {
  const results = await Promise.allSettled(operations);
  const successes = results.filter(result => result.status === 'fulfilled');
  const failures = results.filter(result => result.status === 'rejected');

  assertEqual(successes.length, 1, `${label} success count`);
  assertEqual(failures.length, 1, `${label} failure count`);

  const failure = failures[0].reason;
  assert(
    failure instanceof ConcurrencyError,
    `${label} failure must be ConcurrencyError`
  );
  assertEqual(
    failure.code,
    'INVENTORY_ITEM_NOT_AVAILABLE',
    `${label} conflict code`
  );

  const successfulDocument = successes[0].value;

  if (successfulDocument.constructor.modelName === 'ReservationV2') {
    trackReservation(successfulDocument);
  } else {
    trackBlock(successfulDocument);
  }

  return successfulDocument;
};

const checkTransactionTopology = async () => {
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });

  const topology =
    hello.msg === 'isdbgrid'
      ? 'sharded'
      : hello.setName
        ? 'replicaSet'
        : 'standalone';

  const transactionsSupported =
    topology === 'replicaSet' || topology === 'sharded';

  console.log('Phase 1E Mongo topology:', {
    topology,
    setName: hello.setName ?? null,
    transactionsSupported,
  });

  if (!transactionsSupported) {
    throw new Error(
      'Phase 1E concurrency checks require a replica set or sharded cluster'
    );
  }
};

const checkSameItemSameDate = async fixture => {
  const item = await createItem(fixture.variant._id, 'SAME');
  const inputA = reservationInput({
    ...fixture,
    inventoryItemId: item._id,
    startDate: '2026-10-10',
    endDate: '2026-10-12',
  });
  const inputB = reservationInput({
    ...fixture,
    inventoryItemId: item._id,
    startDate: '2026-10-10',
    endDate: '2026-10-12',
  });

  await assertOneSuccessOneConflict(
    [
      createReservationAtomically(inputA),
      createReservationAtomically(inputB),
    ],
    'same item / same date'
  );

  assertEqual(
    await countReservationsForItem(item._id),
    1,
    'same item / same date final reservation count'
  );
  assertEqual(
    await getBookingRevision(item._id),
    1,
    'same item / same date bookingRevision'
  );
};

const checkDifferentItemsSameDate = async fixture => {
  const itemA = await createItem(fixture.variant._id, 'DIFFA');
  const itemB = await createItem(fixture.variant._id, 'DIFFB');

  const [reservationA, reservationB] = await Promise.all([
    createReservationAtomically(
      reservationInput({
        ...fixture,
        inventoryItemId: itemA._id,
        startDate: '2026-11-10',
        endDate: '2026-11-12',
      })
    ),
    createReservationAtomically(
      reservationInput({
        ...fixture,
        inventoryItemId: itemB._id,
        startDate: '2026-11-10',
        endDate: '2026-11-12',
      })
    ),
  ]);

  trackReservation(reservationA);
  trackReservation(reservationB);

  assertEqual(
    await countReservationsForItem(itemA._id),
    1,
    'different item A reservation count'
  );
  assertEqual(
    await countReservationsForItem(itemB._id),
    1,
    'different item B reservation count'
  );
  assertEqual(await getBookingRevision(itemA._id), 1, 'item A revision');
  assertEqual(await getBookingRevision(itemB._id), 1, 'item B revision');
};

const checkSameItemNonOverlapping = async fixture => {
  const item = await createItem(fixture.variant._id, 'NONOV');

  const [reservationA, reservationB] = await Promise.all([
    createReservationAtomically(
      reservationInput({
        ...fixture,
        inventoryItemId: item._id,
        startDate: '2026-12-10',
        endDate: '2026-12-12',
      })
    ),
    createReservationAtomically(
      reservationInput({
        ...fixture,
        inventoryItemId: item._id,
        startDate: '2026-12-20',
        endDate: '2026-12-22',
      })
    ),
  ]);

  trackReservation(reservationA);
  trackReservation(reservationB);

  assertEqual(
    await countReservationsForItem(item._id),
    2,
    'non-overlapping reservations must both persist'
  );
  assertEqual(
    await getBookingRevision(item._id),
    2,
    'non-overlapping transactions must both advance bookingRevision'
  );
};

const checkCleaningBufferRace = async fixture => {
  const item = await createItem(fixture.variant._id, 'BUFFER');

  await assertOneSuccessOneConflict(
    [
      createReservationAtomically(
        reservationInput({
          ...fixture,
          inventoryItemId: item._id,
          startDate: '2027-01-10',
          endDate: '2027-01-12',
        })
      ),
      createReservationAtomically(
        reservationInput({
          ...fixture,
          inventoryItemId: item._id,
          startDate: '2027-01-13',
          endDate: '2027-01-13',
        })
      ),
    ],
    'cleaning buffer race'
  );

  assertEqual(
    await countReservationsForItem(item._id),
    1,
    'cleaning buffer race final reservation count'
  );
  assertEqual(
    await getBookingRevision(item._id),
    1,
    'cleaning buffer race bookingRevision'
  );
};

const checkReservationVsBlockRace = async fixture => {
  const item = await createItem(fixture.variant._id, 'RVB');

  await assertOneSuccessOneConflict(
    [
      createReservationAtomically(
        reservationInput({
          ...fixture,
          inventoryItemId: item._id,
          startDate: '2027-02-10',
          endDate: '2027-02-12',
        })
      ),
      createAvailabilityBlockAtomically({
        inventoryItemId: item._id,
        startDate: parseDateOnly('2027-02-11'),
        endDate: parseDateOnly('2027-02-11'),
        reason: 'repair',
        createdBy: new Types.ObjectId(),
        now: new Date('2026-10-01T12:00:00.000Z'),
      }),
    ],
    'reservation vs availability block'
  );

  const reservationCount = await countReservationsForItem(item._id);
  const blockCount = await AvailabilityBlockV2Model.countDocuments({
    inventoryItemId: item._id,
  });

  assertEqual(
    reservationCount + blockCount,
    1,
    'reservation vs block must persist exactly one conflicting operation'
  );
  assertEqual(
    await getBookingRevision(item._id),
    1,
    'reservation vs block bookingRevision'
  );
};

const checkExpiredPending = async fixture => {
  const item = await createItem(fixture.variant._id, 'EXPP');
  const now = new Date('2027-03-01T12:00:00.000Z');

  await createExistingReservation(
    reservationInput({
      ...fixture,
      inventoryItemId: item._id,
      startDate: '2027-03-10',
      endDate: '2027-03-10',
      status: 'pending',
      expiresAt: new Date('2027-03-01T12:00:00.000Z'),
      now,
    })
  );

  const reservation = await createReservationAtomically(
    reservationInput({
      ...fixture,
      inventoryItemId: item._id,
      startDate: '2027-03-10',
      endDate: '2027-03-10',
      now,
    })
  );
  trackReservation(reservation);

  assertEqual(
    await countReservationsForItem(item._id),
    2,
    'expired pending must not prevent new reservation'
  );
  assertEqual(
    await getBookingRevision(item._id),
    1,
    'expired pending successful bookingRevision'
  );
};

const checkActivePending = async fixture => {
  const item = await createItem(fixture.variant._id, 'ACTP');
  const now = new Date('2027-04-01T12:00:00.000Z');

  await createExistingReservation(
    reservationInput({
      ...fixture,
      inventoryItemId: item._id,
      startDate: '2027-04-10',
      endDate: '2027-04-10',
      status: 'pending',
      expiresAt: new Date('2027-04-01T12:00:01.000Z'),
      now,
    })
  );

  let error;

  try {
    await createReservationAtomically(
      reservationInput({
        ...fixture,
        inventoryItemId: item._id,
        startDate: '2027-04-10',
        endDate: '2027-04-10',
        now,
      })
    );
  } catch (caught) {
    error = caught;
  }

  assert(error instanceof ConcurrencyError, 'active pending must reject');
  assertEqual(
    error.code,
    'INVENTORY_ITEM_NOT_AVAILABLE',
    'active pending conflict code'
  );
  assertEqual(
    await countReservationsForItem(item._id),
    1,
    'active pending must leave only existing reservation'
  );
  assertEqual(
    await getBookingRevision(item._id),
    0,
    'failed active-pending transaction must roll back bookingRevision'
  );
};

const checkDomainErrors = async fixture => {
  const duplicateItem = await createItem(fixture.variant._id, 'DUP');

  const duplicateInput = reservationInput({
    ...fixture,
    inventoryItemId: duplicateItem._id,
    startDate: '2027-05-10',
    endDate: '2027-05-10',
  });
  duplicateInput.items.push({ ...duplicateInput.items[0] });

  let duplicateError;
  try {
    await createReservationAtomically(duplicateInput);
  } catch (caught) {
    duplicateError = caught;
  }

  assert(
    duplicateError instanceof ConcurrencyError,
    'duplicate inventory item must throw ConcurrencyError'
  );
  assertEqual(
    duplicateError.code,
    'DUPLICATE_INVENTORY_ITEM',
    'duplicate inventory error code'
  );

  const maintenanceItem = await createItem(
    fixture.variant._id,
    'MNT',
    { status: 'maintenance' }
  );

  let inactiveError;
  try {
    await createReservationAtomically(
      reservationInput({
        ...fixture,
        inventoryItemId: maintenanceItem._id,
        startDate: '2027-05-20',
        endDate: '2027-05-20',
      })
    );
  } catch (caught) {
    inactiveError = caught;
  }

  assert(
    inactiveError instanceof ConcurrencyError,
    'maintenance item must throw ConcurrencyError'
  );
  assertEqual(
    inactiveError.code,
    'INVENTORY_ITEM_NOT_ACTIVE',
    'maintenance item error code'
  );

  let missingError;
  try {
    await createReservationAtomically(
      reservationInput({
        ...fixture,
        inventoryItemId: new Types.ObjectId(),
        startDate: '2027-05-25',
        endDate: '2027-05-25',
      })
    );
  } catch (caught) {
    missingError = caught;
  }

  assert(
    missingError instanceof ConcurrencyError,
    'missing item must throw ConcurrencyError'
  );
  assertEqual(
    missingError.code,
    'INVENTORY_ITEM_NOT_FOUND',
    'missing item error code'
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

    const product = await createProduct();
    const variant = await createVariant(product._id);
    const fixture = {
      productId: product._id,
      variantId: variant._id,
      variant,
    };

    await checkSameItemSameDate(fixture);
    await checkDifferentItemsSameDate(fixture);
    await checkSameItemNonOverlapping(fixture);
    await checkCleaningBufferRace(fixture);
    await checkReservationVsBlockRace(fixture);
    await checkExpiredPending(fixture);
    await checkActivePending(fixture);
    await checkDomainErrors(fixture);

    console.log('Phase 1E concurrency integration checks passed');
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
    console.error('Phase 1E cleanup failed:', cleanupError);
  }

  process.exitCode = 1;
});
