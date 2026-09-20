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

const verifyNamedIndex = (
  indexes,
  { name, key, unique, partial }
) => {
  const index = indexes.find(candidate => candidate.name === name);

  if (!index) {
    return { name, status: 'MISSING' };
  }

  const uniqueMatches =
    (index.unique === true) === (unique === true);
  const partialMatches =
    partial === true
      ? Boolean(index.partialFilterExpression)
      : !index.partialFilterExpression;

  return {
    name,
    status:
      exactKey(index.key, key) &&
      uniqueMatches &&
      partialMatches
        ? 'OK'
        : 'INVALID',
    key: index.key,
    unique: index.unique === true,
    partialFilterExpression: Boolean(
      index.partialFilterExpression
    ),
  };
};

const listCollectionNames = async db => {
  const rows = await db.listCollections({}, { nameOnly: true }).toArray();
  return new Set(rows.map(row => row.name));
};

const verifyRegressionIndexes = async db => {
  const productIndexes = await db
    .collection(COLLECTIONS.products)
    .listIndexes()
    .toArray();
  const variantIndexes = await db
    .collection(COLLECTIONS.variants)
    .listIndexes()
    .toArray();
  const reservationIndexes = await db
    .collection(COLLECTIONS.reservations)
    .listIndexes()
    .toArray();

  return {
    product: [
      verifyNamedIndex(productIndexes, {
        name: 'uniq_v2_product_slug',
        key: { slug: 1 },
        unique: true,
        partial: false,
      }),
    ],
    variant: [
      verifyNamedIndex(variantIndexes, {
        name: 'uniq_v2_variant_product_size',
        key: { productId: 1, size: 1 },
        unique: true,
        partial: false,
      }),
      verifyNamedIndex(variantIndexes, {
        name: 'uniq_v2_variant_sku',
        key: { sku: 1 },
        unique: true,
        partial: true,
      }),
    ],
    reservation: [
      verifyNamedIndex(reservationIndexes, {
        name: 'uniq_v2_reservation_number',
        key: { reservationNumber: 1 },
        unique: true,
        partial: false,
      }),
      verifyNamedIndex(reservationIndexes, {
        name: 'uniq_v2_reservation_idempotency_key',
        key: { idempotencyKeyHash: 1 },
        unique: true,
        partial: true,
      }),
    ],
  };
};

const regressionPass = verification =>
  Object.values(verification)
    .flat()
    .every(index => index.status === 'OK');

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
      'phase1h5b-verify';

    let current = 0;

    const next = () => {
      if (current >= chunks.length) {
        resolve();
        return;
      }

      const encoded = encodeURIComponent(chunks[current]);
      const request = https.get(
        'https://anira-kids-back-end.vercel.app/' +
          '__phase1h5b-index-verify-plain/' +
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
              'AniraKids-Phase1H5B-ReadOnly-Index-Verification',
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
          new Error('Phase 1H.5B verification beacon timeout')
        );
      });
      request.on('error', reject);
    };

    next();
  });

const main = async () => {
  const report = {
    phase: 'PHASE_1H5B_POST_WRITE_VERIFICATION',
    databaseName: null,
    featureFlags,
    collections: {},
    catalogue: {},
    indexes: {},
    regressionIndexes: null,
    mongoWrites: 'ZERO',
    result: 'FAILED',
  };

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

    for (const collectionName of Object.values(COLLECTIONS)) {
      const exists = names.has(collectionName);
      report.collections[collectionName] = {
        exists,
        count: exists
          ? await db
              .collection(collectionName)
              .countDocuments({})
          : 0,
      };
    }

    const products = db.collection(COLLECTIONS.products);
    const det001 = await products.findOne(
      { slug: 'detske-saty-det001' },
      { projection: { _id: 0, status: 1 } }
    );
    const det002 = await products.findOne(
      { slug: 'detske-saty-det002' },
      { projection: { _id: 0, status: 1 } }
    );
    const activeProducts = await products.countDocuments({
      status: 'active',
    });

    report.catalogue = {
      DET001: det001?.status ?? 'MISSING',
      DET002: det002?.status ?? 'MISSING',
      activeProducts,
    };

    const inventoryIndexes = names.has(COLLECTIONS.inventory)
      ? await db
          .collection(COLLECTIONS.inventory)
          .listIndexes()
          .toArray()
      : [];
    const availabilityIndexes = names.has(
      COLLECTIONS.availabilityBlocks
    )
      ? await db
          .collection(COLLECTIONS.availabilityBlocks)
          .listIndexes()
          .toArray()
      : [];

    const inventoryIndexNames = inventoryIndexes
      .map(index => index.name)
      .sort();
    const availabilityIndexNames = availabilityIndexes
      .map(index => index.name)
      .sort();

    const expectedInventoryNames = [
      '_id_',
      'idx_v2_inventory_variant_status',
      'uniq_v2_inventory_internal_code',
    ].sort();

    const expectedAvailabilityNames = [
      '_id_',
      'idx_v2_availability_block_inventory_dates',
    ].sort();

    const sameNames = (actual, expected) =>
      actual.length === expected.length &&
      actual.every((value, index) => value === expected[index]);

    const inventoryChecks = [
      verifyNamedIndex(inventoryIndexes, {
        name: 'uniq_v2_inventory_internal_code',
        key: { internalCode: 1 },
        unique: true,
        partial: false,
      }),
      verifyNamedIndex(inventoryIndexes, {
        name: 'idx_v2_inventory_variant_status',
        key: { variantId: 1, status: 1 },
        unique: false,
        partial: false,
      }),
    ];

    const availabilityChecks = [
      verifyNamedIndex(availabilityIndexes, {
        name: 'idx_v2_availability_block_inventory_dates',
        key: { inventoryItemId: 1, startDate: 1, endDate: 1 },
        unique: false,
        partial: false,
      }),
    ];

    report.indexes = {
      v2_inventory_items: {
        exactIndexSet: sameNames(
          inventoryIndexNames,
          expectedInventoryNames
        ),
        names: inventoryIndexNames,
        checks: inventoryChecks,
      },
      v2_availability_blocks: {
        exactIndexSet: sameNames(
          availabilityIndexNames,
          expectedAvailabilityNames
        ),
        names: availabilityIndexNames,
        checks: availabilityChecks,
      },
    };

    report.regressionIndexes = await verifyRegressionIndexes(db);

    const businessStateOk =
      report.collections.v2_products.exists === true &&
      report.collections.v2_products.count === 2 &&
      report.collections.v2_variants.exists === true &&
      report.collections.v2_variants.count === 2 &&
      report.collections.v2_inventory_items.exists === true &&
      report.collections.v2_inventory_items.count === 0 &&
      report.collections.v2_availability_blocks.exists === true &&
      report.collections.v2_availability_blocks.count === 0 &&
      report.collections.v2_reservations.exists === true &&
      report.collections.v2_reservations.count === 0 &&
      report.catalogue.DET001 === 'draft' &&
      report.catalogue.DET002 === 'draft' &&
      report.catalogue.activeProducts === 0;

    const indexStateOk =
      report.indexes.v2_inventory_items.exactIndexSet === true &&
      inventoryChecks.every(index => index.status === 'OK') &&
      report.indexes.v2_availability_blocks.exactIndexSet === true &&
      availabilityChecks.every(index => index.status === 'OK') &&
      regressionPass(report.regressionIndexes);

    if (!businessStateOk || !indexStateOk) {
      report.result = 'POST_WRITE_VERIFICATION_FAILED';
      await sendBeacon(report);
      throw new Error(
        'Phase 1H.5B post-write verification failed'
      );
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
    // Preserve the original read-only verification failure.
  }

  process.exitCode = 1;
});
