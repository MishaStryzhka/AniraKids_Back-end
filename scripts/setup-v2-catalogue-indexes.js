const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error('MONGODB_URI is required for Phase 1H.2 catalogue index setup');
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

mongoose.set('strictQuery', true);
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

const exactSingleKey = (index, field) =>
  index &&
  index.key &&
  Object.keys(index.key).length === 1 &&
  index.key[field] === 1;

const exactCompoundKey = (index, expected) => {
  if (!index?.key) {
    return false;
  }

  const keys = Object.keys(index.key);
  const expectedKeys = Object.keys(expected);

  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every(key => index.key[key] === expected[key])
  );
};

const main = async () => {
  await mongoose.connect(uri, {
    autoIndex: false,
    autoCreate: false,
  });

  try {
    const db = mongoose.connection.db;

    const products = db.collection('v2_products');

    await products.createIndex(
      { slug: 1 },
      {
        unique: true,
        name: 'uniq_v2_product_slug',
      }
    );

    let indexes = await products.listIndexes().toArray();
    const slugIndex = indexes.find(
      index => index.name === 'uniq_v2_product_slug'
    );

    if (
      !exactSingleKey(slugIndex, 'slug') ||
      slugIndex.unique !== true
    ) {
      throw new Error('Product slug index verification failed');
    }

    console.log('uniq_v2_product_slug: PASS');

    const variants = db.collection('v2_variants');

    await variants.createIndex(
      { productId: 1, size: 1 },
      {
        unique: true,
        name: 'uniq_v2_variant_product_size',
      }
    );

    indexes = await variants.listIndexes().toArray();
    const productSizeIndex = indexes.find(
      index => index.name === 'uniq_v2_variant_product_size'
    );

    if (
      !exactCompoundKey(productSizeIndex, {
        productId: 1,
        size: 1,
      }) ||
      productSizeIndex.unique !== true
    ) {
      throw new Error('Variant product/size index verification failed');
    }

    console.log('uniq_v2_variant_product_size: PASS');

    await variants.createIndex(
      { sku: 1 },
      {
        unique: true,
        name: 'uniq_v2_variant_sku',
        partialFilterExpression: {
          sku: {
            $exists: true,
          },
        },
      }
    );

    indexes = await variants.listIndexes().toArray();
    const skuIndex = indexes.find(
      index => index.name === 'uniq_v2_variant_sku'
    );

    if (
      !exactSingleKey(skuIndex, 'sku') ||
      skuIndex.unique !== true ||
      skuIndex.partialFilterExpression?.sku?.$exists !== true
    ) {
      throw new Error('Variant SKU index verification failed');
    }

    console.log('uniq_v2_variant_sku: PASS');

    const collectionNames = new Set(
      (
        await db
          .listCollections({}, { nameOnly: true })
          .toArray()
      ).map(item => item.name)
    );

    if (collectionNames.has('v2_inventory_items')) {
      throw new Error(
        'Safety failure: v2_inventory_items was materialized during catalogue index setup'
      );
    }

    console.log('v2_inventory_items: MISSING');
    console.log('Phase 1H.2 catalogue index setup passed');
  } finally {
    await mongoose.disconnect();
  }
};

main().catch(async error => {
  console.error(error.message);

  try {
    await mongoose.disconnect();
  } catch (_disconnectError) {
    // Preserve original failure.
  }

  process.exitCode = 1;
});
