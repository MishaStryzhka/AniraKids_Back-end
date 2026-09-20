const mongoose = require('mongoose');
const https = require('https');

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error('MONGODB_URI is not available in this execution environment');
}

mongoose.set('autoIndex', false);

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
  inventory: 'v2_inventory_items',
  availabilityBlocks: 'v2_availability_blocks',
  reservations: 'v2_reservations',
};

const APPROVED_INDEXES = [
  {
    collection: COLLECTIONS.inventory,
    name: 'uniq_v2_inventory_internal_code',
    key: { internalCode: 1 },
    unique: true,
  },
  {
    collection: COLLECTIONS.inventory,
    name: 'idx_v2_inventory_variant_status',
    key: { variantId: 1, status: 1 },
    unique: false,
  },
  {
    collection: COLLECTIONS.availabilityBlocks,
    name: 'idx_v2_availability_block_inventory_dates',
    key: { inventoryItemId: 1, startDate: 1, endDate: 1 },
    unique: false,
  },
];

const REGRESSION_INDEXES = {
  product: [
    {
      collection: COLLECTIONS.products,
      name: 'uniq_v2_product_slug',
      key: { slug: 1 },
      unique: true,
      partial: false,
    },
  ],
  variant: [
    {
      collection: COLLECTIONS.variants,
      name: 'uniq_v2_variant_product_size',
      key: { productId: 1, size: 1 },
      unique: true,
      partial: false,
    },
    {
      collection: COLLECTIONS.variants,
      name: 'uniq_v2_variant_sku',
      key: { sku: 1 },
      unique: true,
      partial: true,
    },
  ],
  reservation: [
    {
      collection: COLLECTIONS.reservations,
      name: 'uniq_v2_reservation_number',
      key: { reservationNumber: 1 },
      unique: true,
      partial: false,
    },
    {
      collection: COLLECTIONS.reservations,
      name: 'uniq_v2_reservation_idempotency_key',
      key: { idempotencyKeyHash: 1 },
      unique: true,
      partial: true,
    },
  ],
};

const exactKey = (actual, expected) => {
  if (!actual || typeof actual !== 'object') return false;

  const actualEntries = Object.entries(actual);
  const expectedEntries = Object.entries(expected);

  return (
    actualEntries.length === expectedEntries.length &&
    actualEntries.every(
      ([key, value], index) =>
        key === expectedEntries[index][0] &&
        value === expectedEntries[index][1]
    )
  );
};

const indexMatches = (index, definition) => {
  if (!index || index.name !== definition.name) return false;
  if (!exactKey(index.key, definition.key)) return false;

  const expectedUnique = definition.unique === true;
  const actualUnique = index.unique === true;

  if (actualUnique !== expectedUnique) return false;

  if (definition.partial === true && !index.partialFilterExpression) {
    return false;
  }

  if (definition.partial === false && index.partialFilterExpression) {
    return false;
  }

  return true;
};

const listCollectionNames = async db => {
  const rows = await db.listCollections({}, { nameOnly: true }).toArray();
  return new Set(rows.map(row => row.name));
};

const listIndexesIfExists = async (db, collectionName, names) => {
  if (!names.has(collectionName)) return null;
  return db.collection(collectionName).listIndexes().toArray();
};

const verifyRegressionIndexes = async (db, names) => {
  const result = {};

  for (const [group, definitions] of Object.entries(REGRESSION_INDEXES)) {
    result[group] = [];

    for (const definition of definitions) {
      if (!names.has(definition.collection)) {
        result[group].push({
          name: definition.name,
          status: 'MISSING_COLLECTION',
        });
        continue;
      }

      const indexes = await db
        .collection(definition.collection)
        .listIndexes()
        .toArray();
      const index = indexes.find(
        candidate => candidate.name === definition.name
      );

      result[group].push({
        name: definition.name,
        status: indexMatches(index, definition) ? 'OK' : 'INVALID',
      });
    }
  }

  return result;
};

const allRegressionIndexesPass = verification =>
  Object.values(verification)
    .flat()
    .every(index => index.status === 'OK');

const readBusinessState = async db => {
  const names = await listCollectionNames(db);

  const count = async collectionName =>
    names.has(collectionName)
      ? db.collection(collectionName).countDocuments({})
      : 0;

  const productsCount = await count(COLLECTIONS.products);
  const variantsCount = await count(COLLECTIONS.variants);
  const inventoryCount = await count(COLLECTIONS.inventory);
  const availabilityBlocksCount = await count(
    COLLECTIONS.availabilityBlocks
  );
  const reservationsCount = await count(COLLECTIONS.reservations);

  const products = db.collection(COLLECTIONS.products);

  const det001 = names.has(COLLECTIONS.products)
    ? await products.findOne(
        { slug: 'detske-saty-det001' },
        { projection: { _id: 0, status: 1 } }
      )
    : null;

  const det002 = names.has(COLLECTIONS.products)
    ? await products.findOne(
        { slug: 'detske-saty-det002' },
        { projection: { _id: 0, status: 1 } }
      )
    : null;

  const activeProducts = names.has(COLLECTIONS.products)
    ? await products.countDocuments({ status: 'active' })
    : 0;

  return {
    names,
    report: {
      v2_products: {
        exists: names.has(COLLECTIONS.products),
        count: productsCount,
      },
      v2_variants: {
        exists: names.has(COLLECTIONS.variants),
        count: variantsCount,
      },
      v2_inventory_items: {
        exists: names.has(COLLECTIONS.inventory),
        count: inventoryCount,
      },
      v2_availability_blocks: {
        exists: names.has(COLLECTIONS.availabilityBlocks),
        count: availabilityBlocksCount,
      },
      v2_reservations: {
        exists: names.has(COLLECTIONS.reservations),
        count: reservationsCount,
      },
      DET001: det001?.status ?? 'MISSING',
      DET002: det002?.status ?? 'MISSING',
      activeProducts,
    },
  };
};

const businessStateMatchesExpected = state =>
  state.v2_products.exists === true &&
  state.v2_products.count === 2 &&
  state.v2_variants.exists === true &&
  state.v2_variants.count === 2 &&
  state.v2_inventory_items.count === 0 &&
  state.v2_availability_blocks.count === 0 &&
  state.v2_reservations.exists === true &&
  state.v2_reservations.count === 0 &&
  state.DET001 === 'draft' &&
  state.DET002 === 'draft' &&
  state.activeProducts === 0;

const inspectApprovedIndex = async (db, definition) => {
  const names = await listCollectionNames(db);

  if (!names.has(definition.collection)) {
    return {
      collectionExists: false,
      action: 'CREATE',
    };
  }

  const indexes = await db
    .collection(definition.collection)
    .listIndexes()
    .toArray();

  const sameName = indexes.find(
    index => index.name === definition.name
  );

  if (sameName) {
    if (indexMatches(sameName, definition)) {
      return {
        collectionExists: true,
        action: 'ALREADY_CORRECT',
      };
    }

    throw new Error(
      `Index name conflict for ${definition.name}`
    );
  }

  const sameKey = indexes.find(index =>
    exactKey(index.key, definition.key)
  );

  if (sameKey) {
    throw new Error(
      `Unexpected existing index on approved key for ${definition.name}`
    );
  }

  return {
    collectionExists: true,
    action: 'CREATE',
  };
};

const verifyApprovedIndex = async (db, definition) => {
  const names = await listCollectionNames(db);

  if (!names.has(definition.collection)) {
    return false;
  }

  const indexes = await db
    .collection(definition.collection)
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

  if (definition.unique === true) {
    options.unique = true;
  }

  await db.collection(definition.collection).createIndex(
    definition.key,
    options
  );
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
      'phase1h5b-indexes';

    let index = 0;

    const next = () => {
      if (index >= chunks.length) {
        resolve();
        return;
      }

      const chunk = encodeURIComponent(chunks[index]);
      const request = https.get(
        'https://anira-kids-back-end.vercel.app/' +
          '__phase1h5b-index-setup-plain/' +
          beaconId +
          '/' +
          index +
          '-' +
          chunks.length +
          '/' +
          chunk,
        {
          timeout: 10000,
          headers: {
            'user-agent':
              'AniraKids-Phase1H5B-Controlled-Index-Setup',
          },
        },
        response => {
          response.resume();
          response.on('end', () => {
            index += 1;
            next();
          });
        }
      );

      request.on('timeout', () => {
        request.destroy(
          new Error('Phase 1H.5B index setup beacon timeout')
        );
      });
      request.on('error', reject);
    };

    next();
  });

const main = async () => {
  const report = {
    phase: 'PHASE_1H5B_INDEX_SETUP',
    databaseName: null,
    featureFlags,
    preWriteGuard: 'NOT_RUN',
    preWriteBusinessState: null,
    regressionIndexes: null,
    writes: {},
    businessDocumentsCreated: 0,
    businessDocumentsUpdated: 0,
    businessDocumentsDeleted: 0,
    result: 'FAILED',
  };

  if (
    featureFlags.adminApiEnabled ||
    featureFlags.reservationApiEnabled
  ) {
    report.preWriteGuard = 'FAIL_FEATURE_FLAGS';
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
      report.preWriteGuard = 'FAIL_DATABASE_GUARD';
      await sendBeacon(report);
      throw new Error(
        'Production database guard failed: expected AniraKids'
      );
    }

    const businessState = await readBusinessState(db);
    report.preWriteBusinessState = businessState.report;

    if (!businessStateMatchesExpected(businessState.report)) {
      report.preWriteGuard = 'FAIL_BUSINESS_STATE';
      await sendBeacon(report);
      throw new Error(
        'Production business state changed before index setup'
      );
    }

    const regressionIndexes = await verifyRegressionIndexes(
      db,
      businessState.names
    );
    report.regressionIndexes = regressionIndexes;

    if (!allRegressionIndexesPass(regressionIndexes)) {
      report.preWriteGuard = 'FAIL_REGRESSION_INDEXES';
      await sendBeacon(report);
      throw new Error(
        'Critical production regression index verification failed'
      );
    }

    report.preWriteGuard = 'PASS';

    for (const definition of APPROVED_INDEXES) {
      const inspection = await inspectApprovedIndex(db, definition);

      if (inspection.action === 'ALREADY_CORRECT') {
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
        // Preserve the original controlled setup failure.
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
    // Preserve the original controlled setup failure.
  }

  process.exitCode = 1;
});
