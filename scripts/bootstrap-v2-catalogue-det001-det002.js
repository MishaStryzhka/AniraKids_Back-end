const mongoose = require('mongoose');

const {
  ProductV2Model,
  VariantV2Model,
} = require('../build/v2/models');

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error('MONGODB_URI is required for Phase 1H.2 catalogue bootstrap');
}

const databaseName = decodeURIComponent(
  new URL(uri).pathname.replace(/^\//, '')
);

if (databaseName !== 'AniraKids') {
  throw new Error(
    `Refusing Phase 1H.2 write: expected AniraKids, received ${databaseName || '<missing>'}`
  );
}

if (/(test|testing|dev|ci)/i.test(databaseName)) {
  throw new Error('Refusing Phase 1H.2 write against non-production database');
}

if (process.env.V2_RESERVATION_API_ENABLED === 'true') {
  throw new Error(
    'Refusing Phase 1H.2 bootstrap while V2_RESERVATION_API_ENABLED=true'
  );
}

mongoose.set('strictQuery', true);
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

const MANIFEST = [
  {
    code: 'DET001',
    product: {
      name: 'Dětské šaty DET001',
      slug: 'detske-saty-det001',
      category: 'dress',
      gender: 'girls',
      ageTags: ['1 rok'],
      rentalEnabled: true,
      saleEnabled: false,
      rentalPrices: {
        studio: 600,
        external: 800,
      },
      defaultDeposit: 0,
      photos: [],
      status: 'draft',
      occasion: [],
      seo: {
        noIndex: true,
      },
    },
    variant: {
      size: '74-80-86',
      status: 'active',
      sortOrder: 0,
    },
  },
  {
    code: 'DET002',
    product: {
      name: 'Dětské šaty DET002',
      slug: 'detske-saty-det002',
      category: 'dress',
      gender: 'girls',
      ageTags: ['3-5 let'],
      rentalEnabled: true,
      saleEnabled: false,
      rentalPrices: {
        studio: 500,
        external: 700,
      },
      defaultDeposit: 0,
      photos: [],
      status: 'draft',
      occasion: [],
      seo: {
        noIndex: true,
      },
    },
    variant: {
      size: '98-104-110-116',
      status: 'active',
      sortOrder: 0,
    },
  },
];

const TARGET_SLUGS = new Set(MANIFEST.map(item => item.product.slug));

const sameStringArray = (actual, expected) =>
  Array.isArray(actual) &&
  actual.length === expected.length &&
  actual.every((value, index) => value === expected[index]);

const absent = value => value === undefined || value === null;

const assertProductMatches = (product, expected, code) => {
  const mismatches = [];

  const expectEqual = (label, actual, value) => {
    if (actual !== value) {
      mismatches.push(label);
    }
  };

  expectEqual('name', product.name, expected.name);
  expectEqual('slug', product.slug, expected.slug);
  expectEqual('category', product.category, expected.category);
  expectEqual('gender', product.gender, expected.gender);
  expectEqual('rentalEnabled', product.rentalEnabled, true);
  expectEqual('saleEnabled', product.saleEnabled, false);
  expectEqual('rentalPrices.studio', product.rentalPrices?.studio, expected.rentalPrices.studio);
  expectEqual('rentalPrices.external', product.rentalPrices?.external, expected.rentalPrices.external);
  expectEqual('defaultDeposit', product.defaultDeposit, 0);
  expectEqual('status', product.status, 'draft');
  expectEqual('seo.noIndex', product.seo?.noIndex, true);

  if (!sameStringArray(product.ageTags, expected.ageTags)) {
    mismatches.push('ageTags');
  }

  if (!sameStringArray(product.occasion, [])) {
    mismatches.push('occasion');
  }

  if (!Array.isArray(product.photos) || product.photos.length !== 0) {
    mismatches.push('photos');
  }

  for (const [label, value] of [
    ['description', product.description],
    ['color', product.color],
    ['brand', product.brand],
    ['familyLookGroup', product.familyLookGroup],
    ['defaultSalePrice', product.defaultSalePrice],
    ['seo.title', product.seo?.title],
    ['seo.description', product.seo?.description],
  ]) {
    if (!absent(value)) {
      mismatches.push(label);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `${code} ProductV2 conflict: ${mismatches.join(', ')}`
    );
  }
};

const assertVariantMatches = (variant, expected, code) => {
  const mismatches = [];

  if (variant.size !== expected.size) mismatches.push('size');
  if (variant.status !== 'active') mismatches.push('status');
  if (variant.sortOrder !== 0) mismatches.push('sortOrder');

  for (const [label, value] of [
    ['sku', variant.sku],
    ['rentalPriceOverrides', variant.rentalPriceOverrides],
    ['salePriceOverride', variant.salePriceOverride],
    ['depositOverride', variant.depositOverride],
  ]) {
    if (!absent(value)) {
      mismatches.push(label);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `${code} VariantV2 conflict: ${mismatches.join(', ')}`
    );
  }
};

const assertGlobalStateSafe = async db => {
  const collections = await db
    .listCollections({}, { nameOnly: true })
    .toArray();
  const names = new Set(collections.map(item => item.name));

  if (!names.has('v2_products') || !names.has('v2_variants')) {
    throw new Error('Catalogue collections/indexes are not prepared');
  }

  if (names.has('v2_inventory_items')) {
    const inventoryCount = await db
      .collection('v2_inventory_items')
      .countDocuments({});

    if (inventoryCount !== 0) {
      throw new Error(
        `Safety failure: expected zero InventoryItems, found ${inventoryCount}`
      );
    }
  }

  const reservationCount = await db
    .collection('v2_reservations')
    .countDocuments({});

  if (reservationCount !== 0) {
    throw new Error(
      `Safety failure: expected zero v2 reservations, found ${reservationCount}`
    );
  }

  const existingProducts = await ProductV2Model.find({})
    .select('_id slug')
    .lean()
    .exec();

  for (const product of existingProducts) {
    if (!TARGET_SLUGS.has(product.slug)) {
      throw new Error(
        `Unexpected ProductV2 already exists: ${product.slug}`
      );
    }
  }

  if (existingProducts.length > MANIFEST.length) {
    throw new Error('Unexpected ProductV2 count before bootstrap');
  }

  const allowedProductIds = new Set(
    existingProducts.map(product => product._id.toString())
  );

  const existingVariants = await VariantV2Model.find({})
    .select('_id productId size')
    .lean()
    .exec();

  for (const variant of existingVariants) {
    if (!allowedProductIds.has(variant.productId.toString())) {
      throw new Error(
        'Unexpected VariantV2 references a non-bootstrap product'
      );
    }
  }

  if (existingVariants.length > MANIFEST.length) {
    throw new Error('Unexpected VariantV2 count before bootstrap');
  }
};

const bootstrapPair = async item => {
  const session = await ProductV2Model.db.startSession();

  try {
    await session.withTransaction(
      async () => {
        let product = await ProductV2Model.findOne({
          slug: item.product.slug,
        })
          .session(session)
          .exec();

        if (product) {
          assertProductMatches(product, item.product, item.code);
        } else {
          const createdProducts = await ProductV2Model.create(
            [item.product],
            { session }
          );

          product = createdProducts[0];

          if (!product) {
            throw new Error(`${item.code} ProductV2 create returned no document`);
          }

          assertProductMatches(product, item.product, item.code);
        }

        const otherVariants = await VariantV2Model.find({
          productId: product._id,
          size: {
            $ne: item.variant.size,
          },
        })
          .select('_id size')
          .session(session)
          .lean()
          .exec();

        if (otherVariants.length > 0) {
          throw new Error(
            `${item.code} ProductV2 already has unexpected variants`
          );
        }

        let variant = await VariantV2Model.findOne({
          productId: product._id,
          size: item.variant.size,
        })
          .session(session)
          .exec();

        if (variant) {
          assertVariantMatches(variant, item.variant, item.code);
        } else {
          const createdVariants = await VariantV2Model.create(
            [
              {
                productId: product._id,
                ...item.variant,
              },
            ],
            { session }
          );

          variant = createdVariants[0];

          if (!variant) {
            throw new Error(`${item.code} VariantV2 create returned no document`);
          }

          assertVariantMatches(variant, item.variant, item.code);
        }
      },
      {
        readConcern: {
          level: 'snapshot',
        },
        writeConcern: {
          w: 'majority',
        },
      }
    );

    console.log(`${item.code}: ProductV2 + VariantV2 transaction PASS`);
  } finally {
    await session.endSession();
  }
};

const main = async () => {
  await mongoose.connect(uri, {
    autoIndex: false,
    autoCreate: false,
  });

  try {
    const db = mongoose.connection.db;

    await assertGlobalStateSafe(db);

    for (const item of MANIFEST) {
      await bootstrapPair(item);
    }

    console.log('DEPOSIT_REQUIRES_OWNER_REVIEW_BEFORE_ACTIVATION');
    console.log('InventoryItemV2 created: 0');
    console.log('Phase 1H.2 DET001/DET002 bootstrap passed');
  } finally {
    await mongoose.disconnect();
  }
};

main().catch(async error => {
  console.error(error.message);

  try {
    await mongoose.disconnect();
  } catch (_disconnectError) {
    // Preserve original bootstrap failure.
  }

  process.exitCode = 1;
});
