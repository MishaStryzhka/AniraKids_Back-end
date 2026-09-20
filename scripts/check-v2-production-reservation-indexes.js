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
    partialFilterExpression: undefined,
    critical: true,
  },
  {
    name: 'uniq_v2_reservation_idempotency_key',
    key: { idempotencyKeyHash: 1 },
    unique: true,
    partialFilterExpression: {
      idempotencyKeyHash: { $exists: true },
    },
    critical: true,
  },
  {
    name: 'idx_v2_reservation_inventory_conflict_lookup',
    key: {
      'items.inventoryItemId': 1,
      status: 1,
      startDate: 1,
      endDate: 1,
    },
    unique: false,
    partialFilterExpression: undefined,
    critical: false,
  },
  {
    name: 'idx_v2_reservation_customer_created',
    key: {
      customerId: 1,
      createdAt: -1,
    },
    unique: false,
    partialFilterExpression: {
      customerId: { $exists: true },
    },
    critical: false,
  },
  {
    name: 'idx_v2_reservation_admin_status_created',
    key: {
      status: 1,
      createdAt: -1,
    },
    unique: false,
    partialFilterExpression: undefined,
    critical: false,
  },
  {
    name: 'idx_v2_reservation_admin_calendar',
    key: {
      status: 1,
      startDate: 1,
      endDate: 1,
    },
    unique: false,
    partialFilterExpression: undefined,
    critical: false,
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

    if (key !== expectedKey) {
      return false;
    }

    return exactOrderedObject(value, expectedValue);
  });
};

const exactPartialFilter = (actual, expected) => {
  if (expected === undefined) {
    return actual === undefined;
  }

  return exactOrderedObject(actual, expected);
};

const classifyExpectedIndex = (indexes, definition) => {
  const index = indexes.find(candidate => candidate.name === definition.name);

  if (!index) {
    return {
      result: 'MISSING',
    };
  }

  const exact =
    exactOrderedObject(index.key, definition.key) &&
    (index.unique === true) === (definition.unique === true) &&
    exactPartialFilter(
      index.partialFilterExpression,
      definition.partialFilterExpression
    );

  return {
    result: exact ? 'EXACT_MATCH' : 'MISMATCH',
    actual: {
      key: index.key,
      unique: index.unique === true,
      ...(index.partialFilterExpression === undefined
        ? {}
        : {
            partialFilterExpression: index.partialFilterExpression,
          }),
    },
  };
};

const summarizeUnexpectedIndex = index => ({
  name: index.name,
  key: index.key,
  unique: index.unique === true,
  ...(index.partialFilterExpression === undefined
    ? {}
    : {
        partialFilterExpression: index.partialFilterExpression,
      }),
});

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
      'phase1h6b-preflight';

    let current = 0;

    const next = () => {
      if (current >= chunks.length) {
        resolve();
        return;
      }

      const encoded = encodeURIComponent(chunks[current]);
      const request = https.get(
        'https://anira-kids-back-end.vercel.app/' +
          '__phase1h6b-reservation-index-preflight-plain/' +
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
              'AniraKids-Phase1H6B-ReadOnly-Reservation-Index-Preflight',
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
          new Error('Phase 1H.6B preflight beacon timeout')
        );
      });
      request.on('error', reject);
    };

    next();
  });

const main = async () => {
  const report = {
    phase: 'PHASE_1H6B_RESERVATION_INDEX_PREFLIGHT',
    databaseName: null,
    featureFlags,
    businessState: null,
    indexes: {},
    unexpectedIndexes: [],
    requiredMetadataWrites: [],
    mongoWrites: 'ZERO',
    result: 'PREFLIGHT_STATE_MISMATCH',
  };

  if (!uri) {
    report.result = 'PREFLIGHT_ENV_UNAVAILABLE';
    await sendBeacon(report);
    console.log(JSON.stringify(report, null, 2));
    throw new Error(
      'MONGODB_URI is not available in this execution environment'
    );
  }

  if (
    featureFlags.adminApiEnabled ||
    featureFlags.reservationApiEnabled
  ) {
    report.result = 'PREFLIGHT_STATE_MISMATCH';
    await sendBeacon(report);
    console.log(JSON.stringify(report, null, 2));
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
      report.result = 'PREFLIGHT_STATE_MISMATCH';
      await sendBeacon(report);
      console.log(JSON.stringify(report, null, 2));
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

    const businessStateMatches =
      names.has(COLLECTIONS.products) &&
      names.has(COLLECTIONS.variants) &&
      names.has(COLLECTIONS.reservations) &&
      products === 2 &&
      variants === 2 &&
      inventoryItems === 0 &&
      availabilityBlocks === 0 &&
      reservations === 0 &&
      activeProducts === 0 &&
      det001?.status === 'draft' &&
      det002?.status === 'draft';

    if (!businessStateMatches) {
      report.result = 'PREFLIGHT_STATE_MISMATCH';
      await sendBeacon(report);
      console.log(JSON.stringify(report, null, 2));
      throw new Error(
        'Production business state does not match Phase 1H.6B preflight invariant'
      );
    }

    const reservationIndexes = await db
      .collection(COLLECTIONS.reservations)
      .listIndexes()
      .toArray();

    for (const definition of EXPECTED_INDEXES) {
      report.indexes[definition.name] = classifyExpectedIndex(
        reservationIndexes,
        definition
      ).result;
    }

    const expectedNames = new Set(
      EXPECTED_INDEXES.map(definition => definition.name)
    );

    report.unexpectedIndexes = reservationIndexes
      .filter(
        index =>
          index.name !== '_id_' &&
          !expectedNames.has(index.name)
      )
      .map(summarizeUnexpectedIndex);

    report.requiredMetadataWrites = EXPECTED_INDEXES
      .filter(
        definition =>
          report.indexes[definition.name] === 'MISSING'
      )
      .map(definition => definition.name);

    const criticalMismatch = EXPECTED_INDEXES
      .filter(definition => definition.critical)
      .some(
        definition =>
          report.indexes[definition.name] !== 'EXACT_MATCH'
      );

    const nonUniqueMismatch = EXPECTED_INDEXES
      .filter(definition => !definition.critical)
      .some(
        definition =>
          report.indexes[definition.name] === 'MISMATCH'
      );

    if (criticalMismatch) {
      report.result = 'PREFLIGHT_CRITICAL_INDEX_MISMATCH';
    } else if (nonUniqueMismatch) {
      report.result = 'PREFLIGHT_INDEX_MISMATCH';
    } else {
      report.result = 'READY_FOR_RESERVATION_INDEX_SETUP';
    }

    await sendBeacon(report);
    console.log(JSON.stringify(report, null, 2));

    if (report.result !== 'READY_FOR_RESERVATION_INDEX_SETUP') {
      throw new Error(report.result);
    }
  } finally {
    await mongoose.disconnect();
  }
};

main().catch(async error => {
  console.error(error.message);

  try {
    await mongoose.disconnect();
  } catch (_disconnectError) {
    // Preserve the original read-only preflight failure.
  }

  process.exitCode = 1;
});
