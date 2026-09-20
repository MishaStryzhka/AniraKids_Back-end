const mongoose = require('mongoose');
const https = require('https');

mongoose.set('autoIndex', false);

const uri = process.env.MONGODB_URI;

const normalizeEnabled = value =>
  typeof value === 'string' && value.trim().toLowerCase() === 'true';

const featureFlags = {
  adminApiEnabled: normalizeEnabled(process.env.V2_ADMIN_API_ENABLED),
  reservationApiEnabled: normalizeEnabled(
    process.env.V2_RESERVATION_API_ENABLED
  ),
};

const COLLECTIONS = {
  products: 'v2_products',
  variants: 'v2_variants',
  inventoryItems: 'v2_inventory_items',
  availabilityBlocks: 'v2_availability_blocks',
  reservations: 'v2_reservations',
};

const EXPECTED_INDEXES = [
  {
    name: 'uniq_v2_reservation_number',
    key: { reservationNumber: 1 },
    unique: true,
  },
  {
    name: 'uniq_v2_reservation_idempotency_key',
    key: { idempotencyKeyHash: 1 },
    unique: true,
    partialFilterExpression: {
      idempotencyKeyHash: { $exists: true },
    },
  },
  {
    name: 'idx_v2_reservation_inventory_conflict_lookup',
    key: {
      'items.inventoryItemId': 1,
      status: 1,
      startDate: 1,
      endDate: 1,
    },
  },
  {
    name: 'idx_v2_reservation_customer_created',
    key: {
      customerId: 1,
      createdAt: -1,
    },
    partialFilterExpression: {
      customerId: { $exists: true },
    },
  },
  {
    name: 'idx_v2_reservation_admin_status_created',
    key: {
      status: 1,
      createdAt: -1,
    },
  },
  {
    name: 'idx_v2_reservation_admin_calendar',
    key: {
      status: 1,
      startDate: 1,
      endDate: 1,
    },
  },
];

const exactOrderedObject = (actual, expected) => {
  if (
    actual === null ||
    expected === null ||
    typeof actual !== 'object' ||
    typeof expected !== 'object' ||
    Array.isArray(actual) ||
    Array.isArray(expected)
  ) {
    return actual === expected;
  }

  const actualEntries = Object.entries(actual);
  const expectedEntries = Object.entries(expected);

  if (actualEntries.length !== expectedEntries.length) {
    return false;
  }

  return actualEntries.every(([key, value], index) => {
    const [expectedKey, expectedValue] = expectedEntries[index];

    return (
      key === expectedKey &&
      exactOrderedObject(value, expectedValue)
    );
  });
};

const indexMatches = (index, definition) => {
  if (!index || index.name !== definition.name) {
    return false;
  }

  if (!exactOrderedObject(index.key, definition.key)) {
    return false;
  }

  if ((index.unique === true) !== (definition.unique === true)) {
    return false;
  }

  if (definition.partialFilterExpression === undefined) {
    return index.partialFilterExpression === undefined;
  }

  return exactOrderedObject(
    index.partialFilterExpression,
    definition.partialFilterExpression
  );
};

const listCollectionNames = async db => {
  const rows = await db.listCollections({}, { nameOnly: true }).toArray();
  return new Set(rows.map(row => row.name));
};

const countIfExists = async (db, names, collectionName) =>
  names.has(collectionName)
    ? db.collection(collectionName).countDocuments({})
    : 0;

const sendBeacon = report =>
  new Promise((resolve, reject) => {
    if (!process.argv.includes('--summary-beacon')) {
      resolve();
      return;
    }

    const serialized = JSON.stringify(report);
    const chunks = serialized.match(/.{1,700}/g) ?? [];
    const beaconId =
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ??
      'phase1h6b-verify';

    let current = 0;

    const next = () => {
      if (current >= chunks.length) {
        resolve();
        return;
      }

      const encoded = encodeURIComponent(chunks[current]);
      const request = https.get(
        'https://anira-kids-back-end.vercel.app/' +
          '__phase1h6b-reservation-index-verify-plain/' +
          beaconId +
          '/' +
          current +
          '-' +
          chunks.length +
          '/' +
          encoded,
        {
          timeout: 10000,
          headers: {
            'user-agent':
              'AniraKids-Phase1H6B-ReadOnly-Reservation-Index-Verification',
          },
        },
        response => {
          response.resume();
          response.on('end', () => {
            current += 1;
            next();
          });
        }
      );

      request.on('timeout', () => {
        request.destroy(
          new Error('Phase 1H.6B verification beacon timeout')
        );
      });
      request.on('error', reject);
    };

    next();
  });

const main = async () => {
  const report = {
    phase: 'PHASE_1H6B_RESERVATION_INDEX_VERIFICATION',
    databaseName: null,
    featureFlags,
    businessState: null,
    indexes: {},
    indexNames: [],
    unexpectedIndexes: [],
    totalReservationIndexes: 0,
    mongoWrites: 'ZERO',
    result: 'FAILED',
  };

  if (!uri) {
    await sendBeacon(report);
    throw new Error(
      'MONGODB_URI is not available in this execution environment'
    );
  }

  if (
    featureFlags.adminApiEnabled ||
    featureFlags.reservationApiEnabled
  ) {
    await sendBeacon(report);
    throw new Error(
      'Production API feature flags must both be disabled'
    );
  }

  await mongoose.connect(uri, {
    autoIndex: false,
    autoCreate: false,
  });

  try {
    const db = mongoose.connection.db;
    const databaseName = db.databaseName;
    const lowerDatabaseName = databaseName.toLowerCase();

    report.databaseName = databaseName;

    if (
      databaseName !== 'AniraKids' ||
      ['test', 'testing', 'dev', 'ci'].some(token =>
        lowerDatabaseName.includes(token)
      )
    ) {
      await sendBeacon(report);
      throw new Error(
        'Production database guard failed: expected AniraKids'
      );
    }

    const names = await listCollectionNames(db);

    const products = await countIfExists(
      db,
      names,
      COLLECTIONS.products
    );
    const variants = await countIfExists(
      db,
      names,
      COLLECTIONS.variants
    );
    const inventoryItems = await countIfExists(
      db,
      names,
      COLLECTIONS.inventoryItems
    );
    const availabilityBlocks = await countIfExists(
      db,
      names,
      COLLECTIONS.availabilityBlocks
    );
    const reservations = await countIfExists(
      db,
      names,
      COLLECTIONS.reservations
    );

    const productCollection = db.collection(COLLECTIONS.products);
    const det001 = names.has(COLLECTIONS.products)
      ? await productCollection.findOne(
          { slug: 'detske-saty-det001' },
          { projection: { _id: 0, status: 1 } }
        )
      : null;
    const det002 = names.has(COLLECTIONS.products)
      ? await productCollection.findOne(
          { slug: 'detske-saty-det002' },
          { projection: { _id: 0, status: 1 } }
        )
      : null;
    const activeProducts = names.has(COLLECTIONS.products)
      ? await productCollection.countDocuments({ status: 'active' })
      : 0;

    report.businessState = {
      products,
      variants,
      inventoryItems,
      availabilityBlocks,
      reservations,
      activeProducts,
      DET001: det001?.status ?? 'MISSING',
      DET002: det002?.status ?? 'MISSING',
    };

    if (!names.has(COLLECTIONS.reservations)) {
      await sendBeacon(report);
      throw new Error('v2_reservations collection is missing');
    }

    const reservationIndexes = await db
      .collection(COLLECTIONS.reservations)
      .listIndexes()
      .toArray();

    report.indexNames = reservationIndexes
      .map(index => index.name)
      .sort();
    report.totalReservationIndexes = reservationIndexes.length;

    for (const definition of EXPECTED_INDEXES) {
      const index = reservationIndexes.find(
        candidate => candidate.name === definition.name
      );

      report.indexes[definition.name] = indexMatches(
        index,
        definition
      )
        ? 'EXACT_MATCH'
        : index
          ? 'MISMATCH'
          : 'MISSING';
    }

    const expectedNames = new Set([
      '_id_',
      ...EXPECTED_INDEXES.map(definition => definition.name),
    ]);

    report.unexpectedIndexes = reservationIndexes
      .filter(index => !expectedNames.has(index.name))
      .map(index => ({
        name: index.name,
        key: index.key,
        unique: index.unique === true,
        ...(index.partialFilterExpression === undefined
          ? {}
          : {
              partialFilterExpression:
                index.partialFilterExpression,
            }),
      }));

    const expectedSortedNames = [...expectedNames].sort();
    const exactIndexSet =
      report.indexNames.length === expectedSortedNames.length &&
      report.indexNames.every(
        (name, index) => name === expectedSortedNames[index]
      );

    const businessStateOk =
      products === 2 &&
      variants === 2 &&
      inventoryItems === 0 &&
      availabilityBlocks === 0 &&
      reservations === 0 &&
      activeProducts === 0 &&
      det001?.status === 'draft' &&
      det002?.status === 'draft';

    const indexesOk =
      exactIndexSet &&
      Object.values(report.indexes).every(
        status => status === 'EXACT_MATCH'
      ) &&
      report.unexpectedIndexes.length === 0;

    if (!businessStateOk || !indexesOk) {
      report.result = 'POST_WRITE_VERIFICATION_FAILED';
      await sendBeacon(report);
      console.log(JSON.stringify(report, null, 2));
      throw new Error(report.result);
    }

    report.result = 'POST_WRITE_VERIFICATION_PASS';
    await sendBeacon(report);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await mongoose.disconnect();
  }
};

main().catch(async error => {
  console.error(error.message);

  try {
    await mongoose.disconnect();
  } catch (_disconnectError) {
    // Preserve original read-only verification failure.
  }

  process.exitCode = 1;
});
