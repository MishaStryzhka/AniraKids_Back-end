const mongoose = require('mongoose');

const {
  ProductV2Model,
  VariantV2Model,
} = require('../build/v2/models');
const {
  availabilityService,
} = require('../build/v2/services/availability.service');
const {
  parseDateOnly,
} = require('../build/v2/utils/date-only');

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error('MONGODB_URI is required for Phase 1H.2 verification');
}

const databaseName = decodeURIComponent(
  new URL(uri).pathname.replace(/^\//, '')
);

if (databaseName !== 'AniraKids') {
  throw new Error(
    `Refusing Phase 1H.2 verification: expected AniraKids, received ${databaseName || '<missing>'}`
  );
}

if (/(test|testing|dev|ci)/i.test(databaseName)) {
  throw new Error('Refusing Phase 1H.2 verification against non-production database');
}

mongoose.set('strictQuery', true);
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

const EXPECTED = {
  DET001: {
    name: 'Dětské šaty DET001',
    slug: 'detske-saty-det001',
    ageTags: ['1 rok'],
    studio: 600,
    external: 800,
    size: '74-80-86',
  },
  DET002: {
    name: 'Dětské šaty DET002',
    slug: 'detske-saty-det002',
    ageTags: ['3-5 let'],
    studio: 500,
    external: 700,
    size: '98-104-110-116',
  },
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

const exactSingleKey = (index, field) =>
  index &&
  index.key &&
  Object.keys(index.key).length === 1 &&
  index.key[field] === 1;

const exactCompoundKey = (index, expected) => {
  if (!index?.key) {
    return false;
  }

  const expectedKeys = Object.keys(expected);

  return (
    Object.keys(index.key).length === expectedKeys.length &&
    expectedKeys.every(key => index.key[key] === expected[key])
  );
};

const verifyProduct = (product, expected, code) => {
  assert(product, `${code} ProductV2 missing`);

  assertEqual(product.name, expected.name, `${code} name`);
  assertEqual(product.slug, expected.slug, `${code} slug`);
  assertEqual(product.category, 'dress', `${code} category`);
  assertEqual(product.gender, 'girls', `${code} gender`);
  assertEqual(product.status, 'draft', `${code} status`);
  assertEqual(product.rentalEnabled, true, `${code} rentalEnabled`);
  assertEqual(product.saleEnabled, false, `${code} saleEnabled`);
  assertEqual(product.rentalPrices?.studio, expected.studio, `${code} studio price`);
  assertEqual(product.rentalPrices?.external, expected.external, `${code} external price`);
  assertEqual(product.defaultDeposit, 0, `${code} defaultDeposit`);
  assertEqual(product.seo?.noIndex, true, `${code} seo.noIndex`);

  assert(
    Array.isArray(product.ageTags) &&
      product.ageTags.length === 1 &&
      product.ageTags[0] === expected.ageTags[0],
    `${code} ageTags mismatch`
  );

  assert(
    Array.isArray(product.occasion) &&
      product.occasion.length === 0,
    `${code} occasion must remain empty`
  );

  assert(
    Array.isArray(product.photos) &&
      product.photos.length === 0,
    `${code} photos must remain empty`
  );

  for (const [label, value] of [
    ['description', product.description],
    ['color', product.color],
    ['brand', product.brand],
    ['defaultSalePrice', product.defaultSalePrice],
    ['seo.title', product.seo?.title],
    ['seo.description', product.seo?.description],
  ]) {
    assert(
      value === undefined || value === null,
      `${code} ${label} must remain undefined`
    );
  }
};

const verifyVariant = (variant, expected, productId, code) => {
  assert(variant, `${code} VariantV2 missing`);

  assertEqual(
    variant.productId.toString(),
    productId.toString(),
    `${code} variant productId`
  );
  assertEqual(variant.size, expected.size, `${code} grouped size`);
  assertEqual(variant.status, 'active', `${code} variant status`);
  assertEqual(variant.sortOrder, 0, `${code} sortOrder`);

  for (const [label, value] of [
    ['sku', variant.sku],
    ['rentalPriceOverrides', variant.rentalPriceOverrides],
    ['salePriceOverride', variant.salePriceOverride],
    ['depositOverride', variant.depositOverride],
  ]) {
    assert(
      value === undefined || value === null,
      `${code} ${label} must remain unset`
    );
  }
};

const verifyIndexes = async db => {
  const productIndexes = await db
    .collection('v2_products')
    .listIndexes()
    .toArray();

  const slug = productIndexes.find(
    index => index.name === 'uniq_v2_product_slug'
  );

  assert(
    exactSingleKey(slug, 'slug') && slug.unique === true,
    'uniq_v2_product_slug invalid'
  );

  const variantIndexes = await db
    .collection('v2_variants')
    .listIndexes()
    .toArray();

  const productSize = variantIndexes.find(
    index => index.name === 'uniq_v2_variant_product_size'
  );

  assert(
    exactCompoundKey(productSize, { productId: 1, size: 1 }) &&
      productSize.unique === true,
    'uniq_v2_variant_product_size invalid'
  );

  const sku = variantIndexes.find(
    index => index.name === 'uniq_v2_variant_sku'
  );

  assert(
    exactSingleKey(sku, 'sku') &&
      sku.unique === true &&
      sku.partialFilterExpression?.sku?.$exists === true,
    'uniq_v2_variant_sku invalid'
  );
};

const main = async () => {
  await mongoose.connect(uri, {
    autoIndex: false,
    autoCreate: false,
  });

  try {
    const db = mongoose.connection.db;
    const collectionNames = new Set(
      (
        await db
          .listCollections({}, { nameOnly: true })
          .toArray()
      ).map(item => item.name)
    );

    assert(collectionNames.has('v2_products'), 'v2_products missing');
    assert(collectionNames.has('v2_variants'), 'v2_variants missing');

    const productCount = await ProductV2Model.countDocuments({}).exec();
    const variantCount = await VariantV2Model.countDocuments({}).exec();

    assertEqual(productCount, 2, 'ProductV2 count');
    assertEqual(variantCount, 2, 'VariantV2 count');

    let inventoryCount = 0;

    if (collectionNames.has('v2_inventory_items')) {
      inventoryCount = await db
        .collection('v2_inventory_items')
        .countDocuments({});
    }

    assertEqual(inventoryCount, 0, 'InventoryItemV2 count');

    const reservationCount = await db
      .collection('v2_reservations')
      .countDocuments({});

    assertEqual(reservationCount, 0, 'ReservationV2 count');

    await verifyIndexes(db);

    for (const [code, expected] of Object.entries(EXPECTED)) {
      const product = await ProductV2Model.findOne({
        slug: expected.slug,
      }).exec();

      verifyProduct(product, expected, code);

      const variant = await VariantV2Model.findOne({
        productId: product._id,
        size: expected.size,
      }).exec();

      verifyVariant(variant, expected, product._id, code);

      const availability = await availabilityService.getProductAvailability(
        product._id,
        parseDateOnly('2027-01-10'),
        parseDateOnly('2027-01-12'),
        {
          now: new Date('2026-09-20T12:00:00.000Z'),
        }
      );

      assertEqual(
        availability.available,
        false,
        `${code} availability`
      );

      assert(
        Array.isArray(availability.variants) &&
          availability.variants.length === 0,
        `${code} draft product availability must short-circuit variants`
      );

      console.log(
        `${code}: stored data PASS; availability=false; status=draft`
      );
    }

    assertEqual(
      await ProductV2Model.countDocuments({ status: 'active' }).exec(),
      0,
      'active ProductV2 count'
    );

    console.log('databaseName:', databaseName);
    console.log('ProductV2 count: 2');
    console.log('VariantV2 count: 2');
    console.log('InventoryItemV2 count: 0');
    console.log('ReservationV2 count: 0');
    console.log('DEPOSIT_REQUIRES_OWNER_REVIEW_BEFORE_ACTIVATION');
    console.log('Phase 1H.2 post-write verification passed');
  } finally {
    await mongoose.disconnect();
  }
};

main().catch(async error => {
  console.error(error.message);

  try {
    await mongoose.disconnect();
  } catch (_disconnectError) {
    // Preserve original verification failure.
  }

  process.exitCode = 1;
});
