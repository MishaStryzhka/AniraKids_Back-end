const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error('MONGODB_URI is required for production readiness audit');
}

const parseDatabaseName = value => {
  const parsed = new URL(value);
  return decodeURIComponent(parsed.pathname.replace(/^\//, ''));
};

const databaseName = parseDatabaseName(uri);

if (!databaseName) {
  throw new Error('MONGODB_URI must contain an explicit database name');
}

if (/(^|[_-])(test|testing|ci|dev)([_-]|$)/i.test(databaseName)) {
  throw new Error(
    `Refusing production audit against non-production database: ${databaseName}`
  );
}

mongoose.set('strictQuery', true);
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

const COLLECTIONS = {
  reservations: 'v2_reservations',
  products: 'v2_products',
  variants: 'v2_variants',
  inventory: 'v2_inventory_items',
};

const isNonNegativeInteger = value =>
  Number.isInteger(value) && value >= 0;

const configuredPriceMissingQuery = field => ({
  $or: [
    { [field]: { $exists: false } },
    { [field]: null },
  ],
});

const configuredPriceInvalidExpression = field => ({
  $and: [
    { $ne: [{ $type: `$${field}` }, 'missing'] },
    { $ne: [`$${field}`, null] },
    {
      $not: [
        {
          $and: [
            { $eq: [{ $type: `$${field}` }, 'int'] },
            { $gte: [`$${field}`, 0] },
          ],
        },
      ],
    },
  ],
});

const listCollectionNames = async db => {
  const rows = await db.listCollections({}, { nameOnly: true }).toArray();
  return new Set(rows.map(row => row.name));
};

const getIndexes = async (db, collectionName, exists) => {
  if (!exists) {
    return [];
  }

  return db.collection(collectionName).listIndexes().toArray();
};

const classifyReservationNumberIndex = indexes => {
  const index = indexes.find(
    candidate => candidate.name === 'uniq_v2_reservation_number'
  );

  if (!index) {
    return 'MISSING';
  }

  const exactKey =
    index.key &&
    Object.keys(index.key).length === 1 &&
    index.key.reservationNumber === 1;

  return exactKey && index.unique === true ? 'PASS' : 'INVALID';
};

const classifyIdempotencyIndex = indexes => {
  const index = indexes.find(
    candidate => candidate.name === 'uniq_v2_reservation_idempotency_key'
  );

  if (!index) {
    return 'MISSING';
  }

  const exactKey =
    index.key &&
    Object.keys(index.key).length === 1 &&
    index.key.idempotencyKeyHash === 1;

  const partialExists =
    index.partialFilterExpression &&
    index.partialFilterExpression.idempotencyKeyHash &&
    index.partialFilterExpression.idempotencyKeyHash.$exists === true;

  return exactKey && index.unique === true && partialExists
    ? 'PASS'
    : 'INVALID';
};

const aggregateCount = async (collection, pipeline) => {
  const rows = await collection
    .aggregate([...pipeline, { $count: 'count' }], { allowDiskUse: false })
    .toArray();

  return rows[0]?.count ?? 0;
};

const buildReport = async db => {
  const names = await listCollectionNames(db);

  const collectionExists = {
    reservations: names.has(COLLECTIONS.reservations),
    products: names.has(COLLECTIONS.products),
    variants: names.has(COLLECTIONS.variants),
    inventory: names.has(COLLECTIONS.inventory),
  };

  const counts = {
    reservations: collectionExists.reservations
      ? await db.collection(COLLECTIONS.reservations).countDocuments({})
      : 0,
    products: collectionExists.products
      ? await db.collection(COLLECTIONS.products).countDocuments({})
      : 0,
    variants: collectionExists.variants
      ? await db.collection(COLLECTIONS.variants).countDocuments({})
      : 0,
    inventory: collectionExists.inventory
      ? await db.collection(COLLECTIONS.inventory).countDocuments({})
      : 0,
  };

  const reservationIndexes = await getIndexes(
    db,
    COLLECTIONS.reservations,
    collectionExists.reservations
  );

  let activeRentableProducts = 0;
  let activeVariantsForRentableProducts = 0;
  let productsWithoutActiveVariant = 0;
  let activeInventoryItems = 0;
  let variantsWithoutActiveInventory = 0;
  let orphanVariants = 0;
  let orphanInventoryItems = 0;
  let missingInternalCodes = 0;
  let duplicateInternalCodes = 0;
  let productsWithMissingStudioPrice = 0;
  let productsWithMissingExternalPrice = 0;
  let productsWithInvalidStudioPrice = 0;
  let productsWithInvalidExternalPrice = 0;
  let invalidVariantOverrides = 0;

  if (collectionExists.products) {
    const products = db.collection(COLLECTIONS.products);

    activeRentableProducts = await products.countDocuments({
      status: 'active',
      rentalEnabled: true,
    });

    productsWithMissingStudioPrice = await products.countDocuments({
      status: 'active',
      rentalEnabled: true,
      ...configuredPriceMissingQuery('rentalPrices.studio'),
    });

    productsWithMissingExternalPrice = await products.countDocuments({
      status: 'active',
      rentalEnabled: true,
      ...configuredPriceMissingQuery('rentalPrices.external'),
    });

    productsWithInvalidStudioPrice = await aggregateCount(products, [
      {
        $match: {
          status: 'active',
          rentalEnabled: true,
        },
      },
      {
        $match: {
          $expr: configuredPriceInvalidExpression('rentalPrices.studio'),
        },
      },
    ]);

    productsWithInvalidExternalPrice = await aggregateCount(products, [
      {
        $match: {
          status: 'active',
          rentalEnabled: true,
        },
      },
      {
        $match: {
          $expr: configuredPriceInvalidExpression('rentalPrices.external'),
        },
      },
    ]);

    if (collectionExists.variants) {
      activeVariantsForRentableProducts = await aggregateCount(
        db.collection(COLLECTIONS.variants),
        [
          {
            $match: {
              status: 'active',
            },
          },
          {
            $lookup: {
              from: COLLECTIONS.products,
              localField: 'productId',
              foreignField: '_id',
              as: 'product',
            },
          },
          {
            $match: {
              product: {
                $elemMatch: {
                  status: 'active',
                  rentalEnabled: true,
                },
              },
            },
          },
        ]
      );

      productsWithoutActiveVariant = await aggregateCount(products, [
        {
          $match: {
            status: 'active',
            rentalEnabled: true,
          },
        },
        {
          $lookup: {
            from: COLLECTIONS.variants,
            let: { productId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$productId', '$$productId'] },
                      { $eq: ['$status', 'active'] },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: 'activeVariants',
          },
        },
        {
          $match: {
            'activeVariants.0': { $exists: false },
          },
        },
      ]);
    }
  }

  if (collectionExists.variants) {
    const variants = db.collection(COLLECTIONS.variants);

    orphanVariants = collectionExists.products
      ? await aggregateCount(variants, [
          {
            $lookup: {
              from: COLLECTIONS.products,
              localField: 'productId',
              foreignField: '_id',
              as: 'product',
            },
          },
          {
            $match: {
              'product.0': { $exists: false },
            },
          },
        ])
      : counts.variants;

    invalidVariantOverrides = await aggregateCount(variants, [
      {
        $match: {
          $expr: {
            $or: [
              configuredPriceInvalidExpression(
                'rentalPriceOverrides.studio'
              ),
              configuredPriceInvalidExpression(
                'rentalPriceOverrides.external'
              ),
              configuredPriceInvalidExpression('depositOverride'),
            ],
          },
        },
      },
    ]);

    if (collectionExists.inventory && collectionExists.products) {
      const activeRentableVariantPipeline = [
        {
          $match: {
            status: 'active',
          },
        },
        {
          $lookup: {
            from: COLLECTIONS.products,
            localField: 'productId',
            foreignField: '_id',
            as: 'product',
          },
        },
        {
          $match: {
            product: {
              $elemMatch: {
                status: 'active',
                rentalEnabled: true,
              },
            },
          },
        },
      ];

      variantsWithoutActiveInventory = await aggregateCount(variants, [
        ...activeRentableVariantPipeline,
        {
          $lookup: {
            from: COLLECTIONS.inventory,
            let: { variantId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$variantId', '$$variantId'] },
                      { $eq: ['$status', 'active'] },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: 'activeInventory',
          },
        },
        {
          $match: {
            'activeInventory.0': { $exists: false },
          },
        },
      ]);

      activeInventoryItems = await aggregateCount(
        db.collection(COLLECTIONS.inventory),
        [
          {
            $match: {
              status: 'active',
            },
          },
          {
            $lookup: {
              from: COLLECTIONS.variants,
              localField: 'variantId',
              foreignField: '_id',
              as: 'variant',
            },
          },
          {
            $unwind: '$variant',
          },
          {
            $match: {
              'variant.status': 'active',
            },
          },
          {
            $lookup: {
              from: COLLECTIONS.products,
              localField: 'variant.productId',
              foreignField: '_id',
              as: 'product',
            },
          },
          {
            $match: {
              product: {
                $elemMatch: {
                  status: 'active',
                  rentalEnabled: true,
                },
              },
            },
          },
        ]
      );
    }
  }

  if (collectionExists.inventory) {
    const inventory = db.collection(COLLECTIONS.inventory);

    orphanInventoryItems = collectionExists.variants
      ? await aggregateCount(inventory, [
          {
            $lookup: {
              from: COLLECTIONS.variants,
              localField: 'variantId',
              foreignField: '_id',
              as: 'variant',
            },
          },
          {
            $match: {
              'variant.0': { $exists: false },
            },
          },
        ])
      : counts.inventory;

    missingInternalCodes = await inventory.countDocuments({
      status: 'active',
      $or: [
        { internalCode: { $exists: false } },
        { internalCode: null },
        { internalCode: '' },
        { internalCode: { $regex: /^\s*$/ } },
      ],
    });

    duplicateInternalCodes = await aggregateCount(inventory, [
      {
        $match: {
          internalCode: {
            $exists: true,
            $type: 'string',
            $ne: '',
          },
        },
      },
      {
        $group: {
          _id: '$internalCode',
          count: { $sum: 1 },
        },
      },
      {
        $match: {
          count: { $gt: 1 },
        },
      },
    ]);
  }

  return {
    databaseName,
    collections: {
      v2_reservations: {
        exists: collectionExists.reservations,
        count: counts.reservations,
      },
      v2_products: {
        exists: collectionExists.products,
        count: counts.products,
      },
      v2_variants: {
        exists: collectionExists.variants,
        count: counts.variants,
      },
      v2_inventory_items: {
        exists: collectionExists.inventory,
        count: counts.inventory,
      },
    },
    reservationNumberIndex: classifyReservationNumberIndex(
      reservationIndexes
    ),
    idempotencyIndex: classifyIdempotencyIndex(reservationIndexes),
    activeRentableProducts,
    activeVariantsForRentableProducts,
    productsWithoutActiveVariant,
    activeInventoryItems,
    variantsWithoutActiveInventory,
    orphanVariants,
    orphanInventoryItems,
    missingInternalCodes,
    duplicateInternalCodes,
    productsWithMissingStudioPrice,
    productsWithMissingExternalPrice,
    productsWithInvalidStudioPrice,
    productsWithInvalidExternalPrice,
    invalidVariantOverrides,
    existingV2Reservations: counts.reservations,
  };
};

const getByPath = (value, path) =>
  path.split('.').reduce(
    (current, key) =>
      current === undefined || current === null
        ? undefined
        : current[key],
    value
  );

const parseExpectedValue = raw => {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return raw;
};

const runAssertions = report => {
  const args = process.argv.slice(2);

  if (args[0] === '--assert-db-name') {
    const expected = args[1];

    if (!expected || report.databaseName !== expected) {
      throw new Error(
        `Production database name assertion failed: expected ${expected ?? '<missing>'}`
      );
    }

    return;
  }

  if (args[0] === '--assert-empty-v2') {
    const expectedDatabaseName = args[1];

    if (
      expectedDatabaseName &&
      report.databaseName !== expectedDatabaseName
    ) {
      throw new Error('Production database name assertion failed');
    }

    const collectionStates = Object.values(report.collections);
    const allMissing = collectionStates.every(
      state => state.exists === false && state.count === 0
    );

    if (!allMissing) {
      throw new Error('Expected all v2 collections to be missing');
    }

    if (
      report.reservationNumberIndex !== 'MISSING' ||
      report.idempotencyIndex !== 'MISSING'
    ) {
      throw new Error('Expected reservation indexes to be missing');
    }

    return;
  }

  if (args[0] === '--assert-field') {
    const path = args[1];
    const expectedRaw = args[2];

    if (!path || expectedRaw === undefined) {
      throw new Error(
        'Usage: --assert-field <path> <expected>'
      );
    }

    const actual = getByPath(report, path);
    const expected = parseExpectedValue(expectedRaw);

    if (actual !== expected) {
      throw new Error(
        `Production readiness assertion failed for ${path}`
      );
    }

    return;
  }

  if (args.length > 0) {
    throw new Error('Unknown production readiness audit argument');
  }

  console.log(JSON.stringify(report, null, 2));
};

const main = async () => {
  await mongoose.connect(uri, {
    autoIndex: false,
    autoCreate: false,
  });

  try {
    const report = await buildReport(mongoose.connection.db);
    runAssertions(report);
  } finally {
    await mongoose.disconnect();
  }
};

main().catch(async error => {
  console.error(error.message);

  try {
    await mongoose.disconnect();
  } catch (_disconnectError) {
    // Audit is already failing; preserve the original failure reason.
  }

  process.exitCode = 1;
});
