const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error('MONGODB_URI is not available in this execution environment');
}

mongoose.set('autoIndex', false);

const normalizeEnabled = value =>
  typeof value === 'string' && value.trim().toLowerCase() === 'true';

const adminApiEnabled = normalizeEnabled(process.env.V2_ADMIN_API_ENABLED);
const reservationApiEnabled = normalizeEnabled(
  process.env.V2_RESERVATION_API_ENABLED
);

const COLLECTIONS = [
  'v2_products',
  'v2_variants',
  'v2_inventory_items',
  'v2_availability_blocks',
  'v2_reservations',
];

const exactKey = (actual, expected) => {
  if (!actual || typeof actual !== 'object') {
    return false;
  }

  const actualEntries = Object.entries(actual);
  const expectedEntries = Object.entries(expected);

  return (
    actualEntries.length === expectedEntries.length &&
    actualEntries.every(
      ([key, value], index) =>
        key === expectedEntries[index][0] && value === expectedEntries[index][1]
    )
  );
};

const summarizeIndexes = indexes =>
  indexes.map(index => ({
    name: index.name,
    key: index.key,
    ...(index.unique === true ? { unique: true } : {}),
    ...(index.partialFilterExpression
      ? { partialFilterExpression: true }
      : {}),
  }));

const verifyIndex = (indexes, definition) => {
  const index = indexes.find(candidate => candidate.name === definition.name);

  if (!index) {
    return {
      name: definition.name,
      status: 'MISSING',
    };
  }

  const valid =
    exactKey(index.key, definition.key) &&
    (definition.unique === undefined || index.unique === definition.unique) &&
    (!definition.partialFilterExpression ||
      Boolean(index.partialFilterExpression));

  return {
    name: definition.name,
    status: valid ? 'OK' : 'INVALID',
    key: index.key,
    unique: index.unique === true,
    partialFilterExpression: Boolean(index.partialFilterExpression),
  };
};

const inspectOptionalFutureIndex = (indexes, definition) => {
  const index = indexes.find(candidate => candidate.name === definition.name);

  if (!index) {
    return {
      name: definition.name,
      status: 'ABSENT',
    };
  }

  const valid =
    exactKey(index.key, definition.key) &&
    (definition.unique === undefined || index.unique === definition.unique);

  return {
    name: definition.name,
    status: valid ? 'PRESENT_OK' : 'PRESENT_INVALID',
    key: index.key,
    unique: index.unique === true,
  };
};

const main = async () => {
  if (adminApiEnabled || reservationApiEnabled) {
    console.log(
      JSON.stringify(
        {
          phase: 'PHASE_1H5B_PREFLIGHT',
          featureFlags: {
            adminApiEnabled,
            reservationApiEnabled,
          },
          result: 'PREFLIGHT_STATE_MISMATCH',
        },
        null,
        2
      )
    );

    throw new Error(
      'Production API feature flags must both be disabled for Phase 1H.5B-A'
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

    if (
      databaseName !== 'AniraKids' ||
      ['test', 'testing', 'dev', 'ci'].some(token =>
        lowerDatabaseName.includes(token)
      )
    ) {
      throw new Error(
        'Production database guard failed: expected databaseName AniraKids'
      );
    }

    const existingCollections = await db
      .listCollections({}, { nameOnly: true })
      .toArray();
    const existingNames = new Set(
      existingCollections.map(collection => collection.name)
    );

    const collections = {};
    const rawIndexes = {};

    for (const name of COLLECTIONS) {
      const exists = existingNames.has(name);

      collections[name] = {
        exists,
        count: exists ? await db.collection(name).countDocuments({}) : 0,
      };

      rawIndexes[name] = exists
        ? await db.collection(name).listIndexes().toArray()
        : null;
    }

    const productsCollection = db.collection('v2_products');
    const det001 = collections.v2_products.exists
      ? await productsCollection.findOne(
          { slug: 'detske-saty-det001' },
          { projection: { _id: 0, status: 1 } }
        )
      : null;
    const det002 = collections.v2_products.exists
      ? await productsCollection.findOne(
          { slug: 'detske-saty-det002' },
          { projection: { _id: 0, status: 1 } }
        )
      : null;
    const activeProducts = collections.v2_products.exists
      ? await productsCollection.countDocuments({ status: 'active' })
      : 0;

    const productIndexVerification = rawIndexes.v2_products
      ? [
          verifyIndex(rawIndexes.v2_products, {
            name: 'uniq_v2_product_slug',
            key: { slug: 1 },
            unique: true,
          }),
        ]
      : [{ name: 'uniq_v2_product_slug', status: 'MISSING_COLLECTION' }];

    const variantIndexVerification = rawIndexes.v2_variants
      ? [
          verifyIndex(rawIndexes.v2_variants, {
            name: 'uniq_v2_variant_product_size',
            key: { productId: 1, size: 1 },
            unique: true,
          }),
          verifyIndex(rawIndexes.v2_variants, {
            name: 'uniq_v2_variant_sku',
            key: { sku: 1 },
            unique: true,
            partialFilterExpression: true,
          }),
        ]
      : [
          {
            name: 'uniq_v2_variant_product_size',
            status: 'MISSING_COLLECTION',
          },
          { name: 'uniq_v2_variant_sku', status: 'MISSING_COLLECTION' },
        ];

    const reservationIndexVerification = rawIndexes.v2_reservations
      ? [
          verifyIndex(rawIndexes.v2_reservations, {
            name: 'uniq_v2_reservation_number',
            key: { reservationNumber: 1 },
            unique: true,
          }),
          verifyIndex(rawIndexes.v2_reservations, {
            name: 'uniq_v2_reservation_idempotency_key',
            key: { idempotencyKeyHash: 1 },
            unique: true,
            partialFilterExpression: true,
          }),
        ]
      : [
          {
            name: 'uniq_v2_reservation_number',
            status: 'MISSING_COLLECTION',
          },
          {
            name: 'uniq_v2_reservation_idempotency_key',
            status: 'MISSING_COLLECTION',
          },
        ];

    const inventoryIndexVerification = rawIndexes.v2_inventory_items
      ? [
          inspectOptionalFutureIndex(rawIndexes.v2_inventory_items, {
            name: 'uniq_v2_inventory_internal_code',
            key: { internalCode: 1 },
            unique: true,
          }),
          inspectOptionalFutureIndex(rawIndexes.v2_inventory_items, {
            name: 'idx_v2_inventory_variant_status',
            key: { variantId: 1, status: 1 },
          }),
        ]
      : [
          {
            name: 'uniq_v2_inventory_internal_code',
            status: 'MISSING_COLLECTION',
          },
          {
            name: 'idx_v2_inventory_variant_status',
            status: 'MISSING_COLLECTION',
          },
        ];

    const availabilityBlockIndexVerification =
      rawIndexes.v2_availability_blocks
        ? [
            inspectOptionalFutureIndex(rawIndexes.v2_availability_blocks, {
              name: 'idx_v2_availability_block_inventory_dates',
              key: { inventoryItemId: 1, startDate: 1, endDate: 1 },
            }),
          ]
        : [
            {
              name: 'idx_v2_availability_block_inventory_dates',
              status: 'MISSING_COLLECTION',
            },
          ];

    const exactCounts =
      collections.v2_products.count === 2 &&
      collections.v2_variants.count === 2 &&
      collections.v2_inventory_items.count === 0 &&
      collections.v2_availability_blocks.count === 0 &&
      collections.v2_reservations.count === 0;

    const catalogueState =
      det001?.status === 'draft' &&
      det002?.status === 'draft' &&
      activeProducts === 0;

    const criticalIndexesOk = [
      ...productIndexVerification,
      ...variantIndexVerification,
      ...reservationIndexVerification,
    ].every(index => index.status === 'OK');

    const futureIndexesNotInvalid = [
      ...inventoryIndexVerification,
      ...availabilityBlockIndexVerification,
    ].every(index => index.status !== 'PRESENT_INVALID');

    const ready =
      exactCounts &&
      catalogueState &&
      criticalIndexesOk &&
      futureIndexesNotInvalid;

    const report = {
      phase: 'PHASE_1H5B_PREFLIGHT',
      databaseName,
      featureFlags: {
        adminApiEnabled,
        reservationApiEnabled,
      },
      collections,
      catalogue: {
        DET001: det001?.status ?? 'MISSING',
        DET002: det002?.status ?? 'MISSING',
        activeProducts,
      },
      indexes: {
        v2_inventory_items: rawIndexes.v2_inventory_items
          ? {
              existing: summarizeIndexes(rawIndexes.v2_inventory_items),
              expectedFuture: inventoryIndexVerification,
            }
          : 'MISSING_COLLECTION',
        v2_availability_blocks: rawIndexes.v2_availability_blocks
          ? {
              existing: summarizeIndexes(rawIndexes.v2_availability_blocks),
              expectedFuture: availabilityBlockIndexVerification,
            }
          : 'MISSING_COLLECTION',
        product: productIndexVerification,
        variant: variantIndexVerification,
        reservation: reservationIndexVerification,
      },
      mongoWrites: 'ZERO',
      result: ready
        ? 'READY_FOR_CONTROLLED_INDEX_SETUP'
        : 'PREFLIGHT_STATE_MISMATCH',
    };

    console.log(JSON.stringify(report, null, 2));

    if (!ready) {
      throw new Error('Phase 1H.5B-A production preflight state mismatch');
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
    // Preserve the original preflight failure.
  }

  process.exitCode = 1;
});
