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

const CRITICAL_INDEXES = [
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
];

const APPROVED_INDEXES = [
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

const readBusinessState = async db => {
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

  return {
    products,
    variants,
    inventoryItems,
    availabilityBlocks,
    reservations,
    activeProducts,
    DET001: det001?.status ?? 'MISSING',
    DET002: det002?.status ?? 'MISSING',
  };
};

const businessStateMatchesExpected = state =>
  state.products === 2 &&
  state.variants === 2 &&
  state.inventoryItems === 0 &&
  state.availabilityBlocks === 0 &&
  state.reservations === 0 &&
  state.activeProducts === 0 &&
  state.DET001 === 'draft' &&
  state.DET002 === 'draft';

const verifyCriticalIndexes = async db => {
  const indexes = await db
    .collection(COLLECTIONS.reservations)
    .listIndexes()
    .toArray();

  return CRITICAL_INDEXES.map(definition => {
    const index = indexes.find(
      candidate => candidate.name === definition.name
    );

    return {
      name: definition.name,
      status: indexMatches(index, definition) ? 'EXACT_MATCH' : 'MISMATCH',
    };
  });
};

const inspectApprovedIndex = async (db, definition) => {
  const indexes = await db
    .collection(COLLECTIONS.reservations)
    .listIndexes()
    .toArray();

  const sameName = indexes.find(
    index => index.name === definition.name
  );

  if (sameName) {
    if (indexMatches(sameName, definition)) {
      return 'ALREADY_CORRECT';
    }

    throw new Error(
      `Index name conflict for ${definition.name}`
    );
  }

  const sameKey = indexes.find(index =>
    exactOrderedObject(index.key, definition.key)
  );

  if (sameKey) {
    throw new Error(
      `Conflicting existing index on approved key for ${definition.name}: ${sameKey.name}`
    );
  }

  return 'CREATE';
};

const verifyApprovedIndex = async (db, definition) => {
  const indexes = await db
    .collection(COLLECTIONS.reservations)
    .listIndexes()
    .toArray();
  const index = indexes.find(
    candidate => candidate.name === definition.name
  );

  return indexMatches(index, definition);
};

const createApprovedIndex = async (db, definition) => {
  const options = {
    name: definition.name,
  };

  if (definition.partialFilterExpression !== undefined) {
    options.partialFilterExpression =
      definition.partialFilterExpression;
  }

  await db
    .collection(COLLECTIONS.reservations)
    .createIndex(definition.key, options);
};

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
      'phase1h6b-indexes';

    let current = 0;

    const next = () => {
      if (current >= chunks.length) {
        resolve();
        return;
      }

      const encoded = encodeURIComponent(chunks[current]);
      const request = https.get(
        'https://anira-kids-back-end.vercel.app/' +
          '__phase1h6b-reservation-index-setup-plain/' +
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
              'AniraKids-Phase1H6B-Controlled-Reservation-Index-Setup',
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
          new Error('Phase 1H.6B setup beacon timeout')
        );
      });
      request.on('error', reject);
    };

    next();
  });

const main = async () => {
  const report = {
    phase: 'PHASE_1H6B_RESERVATION_INDEX_SETUP',
    databaseName: null,
    preWriteGuards: 'NOT_RUN',
    featureFlags,
    preWriteBusinessState: null,
    criticalIndexes: null,
    writes: {},
    businessDocumentsCreated: 0,
    businessDocumentsUpdated: 0,
    businessDocumentsDeleted: 0,
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
    report.preWriteGuards = 'FAIL_FEATURE_FLAGS';
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
      report.preWriteGuards = 'FAIL_DATABASE_GUARD';
      await sendBeacon(report);
      throw new Error(
        'Production database guard failed: expected AniraKids'
      );
    }

    const businessState = await readBusinessState(db);
    report.preWriteBusinessState = businessState;

    if (!businessStateMatchesExpected(businessState)) {
      report.preWriteGuards = 'FAIL_BUSINESS_STATE';
      await sendBeacon(report);
      throw new Error(
        'Production business state changed before Reservation index setup'
      );
    }

    const criticalIndexes = await verifyCriticalIndexes(db);
    report.criticalIndexes = criticalIndexes;

    if (
      criticalIndexes.some(
        index => index.status !== 'EXACT_MATCH'
      )
    ) {
      report.preWriteGuards = 'FAIL_CRITICAL_INDEXES';
      await sendBeacon(report);
      throw new Error(
        'Critical Reservation index verification failed'
      );
    }

    report.preWriteGuards = 'PASS';

    for (const definition of APPROVED_INDEXES) {
      const action = await inspectApprovedIndex(db, definition);

      if (action === 'ALREADY_CORRECT') {
        report.writes[definition.name] = 'ALREADY_CORRECT';
      } else {
        await createApprovedIndex(db, definition);
        report.writes[definition.name] = 'CREATED';
      }

      const verified = await verifyApprovedIndex(db, definition);

      if (!verified) {
        report.writes[definition.name] =
          report.writes[definition.name] + '_VERIFY_FAILED';
        await sendBeacon(report);
        throw new Error(
          `Post-create verification failed for ${definition.name}`
        );
      }
    }

    report.result = 'INDEX_SETUP_COMPLETE';
    await sendBeacon(report);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (report.result !== 'INDEX_SETUP_COMPLETE') {
      try {
        await sendBeacon(report);
      } catch (_beaconError) {
        // Preserve original controlled setup failure.
      }
    }

    throw error;
  } finally {
    await mongoose.disconnect();
  }
};

main().catch(async error => {
  console.error(error.message);

  try {
    await mongoose.disconnect();
  } catch (_disconnectError) {
    // Preserve original controlled setup failure.
  }

  process.exitCode = 1;
});
